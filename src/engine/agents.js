/**
 * NEXUS Multi-Agent System — 7 autonomous agents with Nash Bargaining
 * Upgraded with Gemini AI Real-Time LLM Reasoning
 */
import { SOLAR_FARMS, WIND_FARMS, BATTERIES, GRID } from './config.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini API (safely handles missing key)
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-3.8-flash" }) : null;

class BaseAgent {
  constructor(name, codename) {
    this.name = name; this.codename = codename; this.status = 'idle';
    this.lastDecision = null; this.reasoningChain = []; this.health = 100; this.disabled = false;
    this.lastLLMTick = -999;
    this.llmThinking = false;
  }
  log(message) {
    this.reasoningChain.push({ timestamp: Date.now(), message, agent: this.codename });
    if (this.reasoningChain.length > 20) this.reasoningChain.shift();
  }
  
  async askGemini(prompt, tick) {
    if (!model || this.llmThinking || tick - this.lastLLMTick < 10) return; // Throttle to every 10 ticks (~20s)
    this.llmThinking = true;
    this.lastLLMTick = tick;
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text().replace(/\*/g, '').trim().substring(0, 150); // Keep it concise for UI
      this.log(`✨ AI Insight: ${text}`);
    } catch (err) {
      console.error(`Gemini API Error for ${this.name}:`, err.message);
    } finally {
      this.llmThinking = false;
    }
  }
}

export class HeliosAgent extends BaseAgent {
  constructor() { super('HELIOS', 'helios'); }
  propose(ws) {
    this.status = 'analyzing'; const actions = []; let totalMW = 0, curtailMW = 0;
    for (let i = 0; i < SOLAR_FARMS.length; i++) {
      const farm = SOLAR_FARMS[i]; const node = ws.weather.solarNodes[i]; const irr = node.irradiance;
      const tempDerate = Math.max(0.7, 1 - Math.max(0, node.temp - 25) * 0.004);
      let output = farm.capacity * irr * tempDerate; let curtailed = 0;
      if ((ws.supplyDemandRatio || 1) > 1.3 && ws.market.electricityPrice < 3000) {
        curtailed = output * 0.3; output -= curtailed; curtailMW += curtailed;
        this.log(`Curtailing ${farm.name} by ${curtailed.toFixed(0)} MW (Grid Oversupply)`);
      }
      actions.push({ type: 'solar_generate', farmId: farm.id, farmName: farm.name, outputMW: Math.round(output * 10) / 10, irradiance: Math.round(irr * 100) / 100 });
      totalMW += output;
    }
    this.log(`Aggregated ${totalMW.toFixed(0)} MW across ${SOLAR_FARMS.length} regions.`);
    this.status = 'active'; this.lastDecision = { totalMW: Math.round(totalMW), curtailmentMW: Math.round(curtailMW), farmCount: SOLAR_FARMS.length };
    return { agent: 'helios', actions, totalGenerationMW: totalMW, curtailmentMW: curtailMW, utility: totalMW * 0.8 - curtailMW * 0.3 };
  }
}

export class AeolusAgent extends BaseAgent {
  constructor() { super('AEOLUS', 'aeolus'); }
  windPowerCurve(ws) { if (ws < 3) return 0; if (ws > 25) return 0; if (ws >= 12) return 1; return Math.pow((ws - 3) / 9, 3); }
  propose(ws) {
    this.status = 'analyzing'; const actions = []; let totalMW = 0, curtailMW = 0;
    for (let i = 0; i < WIND_FARMS.length; i++) {
      const farm = WIND_FARMS[i]; const node = ws.weather.windNodes[i]; const windSpeed = node.speed;
      const ratio = this.windPowerCurve(windSpeed); let output = farm.capacity * ratio;
      if (windSpeed > 20) { const safety = output * 0.2; output -= safety; curtailMW += safety; this.log(`${farm.name}: Pitching blades for safety (${windSpeed.toFixed(1)} m/s)`); }
      if ((ws.supplyDemandRatio || 1) > 1.4 && ws.market.electricityPrice < 2500) { const econ = output * 0.25; output -= econ; curtailMW += econ; }
      actions.push({ type: 'wind_generate', farmId: farm.id, farmName: farm.name, outputMW: Math.round(output * 10) / 10, windSpeed: Math.round(windSpeed * 10) / 10 });
      totalMW += output;
    }
    this.log(`Harvested ${totalMW.toFixed(0)} MW wind energy.`); this.status = 'active';
    this.lastDecision = { totalMW: Math.round(totalMW), curtailmentMW: Math.round(curtailMW), farmCount: WIND_FARMS.length };
    return { agent: 'aeolus', actions, totalGenerationMW: totalMW, curtailmentMW: curtailMW, utility: totalMW * 0.8 - curtailMW * 0.25 };
  }
}

export class VoltaicAgent extends BaseAgent {
  constructor() {
    super('VOLTAIC', 'voltaic');
    this.batteryStates = BATTERIES.map(b => ({ id: b.id, soc: 0.5, cycleCount: 0, health: 1.0, currentAction: 'idle', maintenanceAlert: false }));
  }
  propose(ws) {
    this.status = 'analyzing'; const actions = []; let chargeMW = 0, dischargeMW = 0;
    for (let i = 0; i < BATTERIES.length; i++) {
      const b = BATTERIES[i]; const st = this.batteryStates[i];
      if (this.disabled && i === 0) { actions.push({ type: 'battery_offline', batteryId: b.id, batteryName: b.name }); st.currentAction = 'offline'; this.log(`🚨 ${b.name} OFFLINE`); continue; }
      const avgTemp = ws.weather.temperature;
      if (avgTemp > 38 && st.cycleCount > 50 && st.health < 0.95) { st.maintenanceAlert = true; this.log(`⚠️ AI Alert: ${b.name} cooling stress.`); } 
      else { st.maintenanceAlert = false; }
      const price = ws.market.electricityPrice; const deficit = ws.market.demand.total - (ws.totalRenewable || 0);
      let action = 'idle', power = 0;
      const activeMaxDischarge = st.maintenanceAlert ? b.maxDischargeMW * 0.7 : b.maxDischargeMW;
      if (deficit < -50 && st.soc < 0.9 && price < 4000) {
        action = 'charge'; power = Math.min(b.maxChargeMW, Math.abs(deficit) * 0.4, (0.9 - st.soc) * b.capacityMWh * 4);
        st.soc = Math.min(0.95, st.soc + (power * 0.25 * b.efficiency) / b.capacityMWh); chargeMW += power;
        this.log(`${b.name}: Charging ${power.toFixed(0)} MW (SoC: ${(st.soc * 100).toFixed(0)}%)`);
      } else if ((deficit > 30 || price > 6000) && st.soc > 0.2) {
        action = 'discharge'; power = Math.max(0, Math.min(activeMaxDischarge, deficit * 0.5, (st.soc - 0.1) * b.capacityMWh * 4));
        st.soc = Math.max(0.05, st.soc - (power * 0.25) / (b.capacityMWh * b.efficiency)); dischargeMW += power;
        st.cycleCount += power > 10 ? 0.05 : 0.01; st.health = Math.max(0.7, st.health - (b.degradationPerCycle * (avgTemp > 35 ? 1.5 : 1)));
        this.log(`${b.name}: Discharging ${power.toFixed(0)} MW (SoC: ${(st.soc * 100).toFixed(0)}%)`);
      } else { action = 'reserve'; this.log(`${b.name}: Holding reserve (SoC: ${(st.soc * 100).toFixed(0)}%)`); }
      st.currentAction = action;
      actions.push({ type: `battery_${action}`, batteryId: b.id, batteryName: b.name, powerMW: Math.round(power * 10) / 10, soc: Math.round(st.soc * 1000) / 10, health: Math.round(st.health * 1000) / 10 });
    }
    
    // LLM Reasoning for Battery Fleet
    if (model && (chargeMW > 50 || dischargeMW > 50)) {
      this.askGemini(`You are VOLTAIC, an AI battery agent. The fleet is ${chargeMW>0?'charging '+chargeMW+'MW':'discharging '+dischargeMW+'MW'}. Average SoC is ${(this.batteryStates.reduce((a,b)=>a+b.soc,0)/this.batteryStates.length*100).toFixed(0)}%. Price is ${ws.market.electricityPrice}. Give a 1-sentence tactical rationale.`, ws.tick);
    }

    this.status = 'active'; this.lastDecision = { chargeMW: Math.round(chargeMW), dischargeMW: Math.round(dischargeMW), avgSoC: Math.round(this.batteryStates.reduce((s, b) => s + b.soc, 0) / this.batteryStates.length * 100) };
    return { agent: 'voltaic', actions, chargeMW, dischargeMW, batteryStates: this.batteryStates.map(s => ({ ...s })), utility: dischargeMW * 0.6 - chargeMW * 0.2 };
  }
}

export class MercuryAgent extends BaseAgent {
  constructor() { super('MERCURY', 'mercury'); this.totalRevenue = 0; this.totalCost = 0; this.carbonCredits = 5000; }
  propose(ws) {
    this.status = 'analyzing'; const actions = []; const price = ws.market.electricityPrice;
    const surplus = (ws.totalRenewable || 0) - ws.market.demand.total + (ws.batteryDischarge || 0) - (ws.batteryCharge || 0);
    let gridImport = 0, gridExport = 0; let creditsDelta = 0;

    if (surplus > 20 && price > 3500) {
      gridExport = Math.min(surplus * 0.8, GRID.maxExportMW); const rev = gridExport * price * 0.25 / 1000; this.totalRevenue += rev;
      creditsDelta = gridExport * 0.25 * 0.5; this.carbonCredits += creditsDelta;
      this.log(`Selling ${gridExport.toFixed(0)} MW | +${creditsDelta.toFixed(1)} Carbon Credits`);
      actions.push({ type: 'grid_sell', powerMW: Math.round(gridExport), pricePerMWh: price, revenueK: Math.round(rev * 10) / 10 });
    } else if (surplus < -10) {
      gridImport = Math.min(Math.abs(surplus) * 1.1, GRID.maxImportMW); const cost = gridImport * price * 0.25 / 1000; this.totalCost += cost;
      creditsDelta = -(gridImport * 0.25 * 0.85); this.carbonCredits += creditsDelta;
      if (price > 7000 || this.carbonCredits < 1000) { 
        gridImport *= 0.6; actions.push({ type: 'demand_response', reductionMW: Math.round(Math.abs(surplus) * 0.3) }); 
        this.log(`⚠️ Carbon/Cost limit: Reducing import to ${gridImport.toFixed(0)} MW`);
      } else { this.log(`Buying ${gridImport.toFixed(0)} MW | Spent ${Math.abs(creditsDelta).toFixed(1)} Carbon Credits`); }
      actions.push({ type: 'grid_buy', powerMW: Math.round(gridImport), pricePerMWh: price, costK: Math.round(cost * 10) / 10 });
    } else { this.log(`Grid balanced. Carbon Ledger: ${Math.round(this.carbonCredits)} CC`); }
    
    // LLM Market Reasoning
    if (model && (gridExport > 100 || gridImport > 100)) {
      this.askGemini(`You are MERCURY, energy market agent. You are ${gridExport>0?'selling '+gridExport+'MW':'buying '+gridImport+'MW'} at ₹${price}/MWh. Carbon credits: ${Math.round(this.carbonCredits)}. Give a 1-sentence financial rationale.`, ws.tick);
    }

    this.status = 'active'; this.lastDecision = { gridImportMW: Math.round(gridImport), gridExportMW: Math.round(gridExport), totalRevenueK: Math.round(this.totalRevenue), totalCostK: Math.round(this.totalCost), carbonCredits: Math.round(this.carbonCredits) };
    return { agent: 'mercury', actions, gridImportMW: gridImport, gridExportMW: gridExport, carbonCredits: this.carbonCredits, creditsDelta, utility: gridExport * 0.5 - gridImport * 0.3 };
  }
}

export class SentinelAgent extends BaseAgent {
  constructor() { super('SENTINEL', 'sentinel'); this.frequency = 50.0; this.transmissionLoad = {}; this.demandResponseActive = false; }
  propose(ws) {
    this.status = 'analyzing'; const actions = [];
    const supply = (ws.totalRenewable || 0) + (ws.batteryDischarge || 0) + (ws.gridImport || 0);
    const demand = ws.market.demand.total + (ws.batteryCharge || 0);
    const imbalance = demand > 0 ? (supply - demand) / demand : 0;
    this.frequency = Math.max(49.0, Math.min(51.0, 50.0 + imbalance * 2));
    if (Math.abs(this.frequency - 50.0) > GRID.frequencyTolerance) {
      this.log(`⚠️ Frequency deviation: ${this.frequency.toFixed(2)} Hz. Injecting synthetic inertia.`);
      actions.push({ type: 'frequency_correction', frequency: Math.round(this.frequency * 100) / 100 });
    }
    for (const line of GRID.transmissionLines) {
      const load = (supply / GRID.transmissionLines.length) * (0.8 + Math.random() * 0.4);
      const pct = (load / line.capacityMW) * 100; this.transmissionLoad[line.id] = pct;
      if (pct > 90) { this.log(`🔴 ${line.name}: Critical Load (${pct.toFixed(0)}%) - Re-routing flow`); actions.push({ type: 'transmission_alert', lineName: line.name, loadPercent: Math.round(pct) }); }
    }
    if (imbalance < -0.1) { this.demandResponseActive = true; } else { this.demandResponseActive = false; }
    this.status = 'active'; this.lastDecision = { frequency: Math.round(this.frequency * 100) / 100, demandResponse: this.demandResponseActive, maxLineLoad: Math.round(Math.max(0, ...Object.values(this.transmissionLoad))) };
    return { agent: 'sentinel', actions, frequency: this.frequency, transmissionLoad: { ...this.transmissionLoad }, utility: (1 - Math.abs(this.frequency - 50) / 2) * 10 };
  }
}

export class OracleAgent extends BaseAgent {
  constructor() { super('ORACLE', 'oracle'); }
  propose(ws) {
    this.status = 'analyzing'; const actions = []; const w = ws.weather;
    if (w.usingLiveData) this.log(`🌐 Live OpenWeather API sync complete.`);
    if (w.stormActive) { this.log(`🌩️ STORM ACTIVE in grid zone`); actions.push({ type: 'storm_warning', severity: 'high' }); }
    if (w.temperature > 40) { this.log(`🌡️ Extreme heat anomaly: ${w.temperature.toFixed(1)}°C. Triggering solar derating.`); }
    
    // LLM Weather Forecasting
    if (model) {
      this.askGemini(`You are ORACLE, grid weather forecaster. Temp: ${w.temperature.toFixed(1)}C, Clouds: ${(w.cloudCover*100).toFixed(0)}%, Storm Active: ${w.stormActive}. Give a 1-sentence forecast impact on renewables.`, ws.tick);
    }

    this.status = 'active'; this.lastDecision = { stormActive: w.stormActive, cloudCover: Math.round(w.cloudCover * 100), temperature: Math.round(w.temperature) };
    return { agent: 'oracle', actions, weatherSummary: { solar: w.solarIrradiance, wind: w.windSpeeds, clouds: w.cloudCover, temp: w.temperature, storm: w.stormActive }, utility: 5 };
  }
}

export class NexusOrchestrator extends BaseAgent {
  constructor() {
    super('NEXUS', 'nexus');
    this.agents = { helios: new HeliosAgent(), aeolus: new AeolusAgent(), voltaic: new VoltaicAgent(), mercury: new MercuryAgent(), oracle: new OracleAgent(), sentinel: new SentinelAgent() };
    this.history = []; this.metrics = { totalCostK: 0, totalRevenueK: 0, totalRenewableMWh: 0, totalCurtailmentMWh: 0, totalCarbonTons: 0, avgFrequency: 50.0, avgReliability: 100 };
    this.paretoFrontier = [];
  }

  nashBargaining(proposals) {
    const dp = { helios: 0, aeolus: 0, voltaic: -5, mercury: -10, oracle: 0, sentinel: 5 };
    let nashProduct = 1; const surpluses = {};
    for (const p of proposals) { const s = Math.max(0.001, p.utility - (dp[p.agent] || 0)); surpluses[p.agent] = s; nashProduct *= s; }
    const total = Object.values(surpluses).reduce((a, b) => a + b, 0);
    const weights = {}; for (const [a, s] of Object.entries(surpluses)) weights[a] = s / total;
    return { nashProduct, weights, surpluses };
  }

  orchestrate(worldState) {
    this.status = 'orchestrating';
    const oP = this.agents.oracle.propose(worldState);
    const hP = this.agents.helios.propose(worldState);
    const aP = this.agents.aeolus.propose(worldState);
    const totalRenewable = (hP.totalGenerationMW || 0) + (aP.totalGenerationMW || 0);
    worldState.totalRenewable = totalRenewable;
    worldState.supplyDemandRatio = worldState.market.demand.total > 0 ? totalRenewable / worldState.market.demand.total : 1;
    const vP = this.agents.voltaic.propose(worldState);
    worldState.batteryCharge = vP.chargeMW; worldState.batteryDischarge = vP.dischargeMW;
    const mP = this.agents.mercury.propose(worldState);
    worldState.gridImport = mP.gridImportMW;
    const sP = this.agents.sentinel.propose(worldState);

    const proposals = [hP, aP, vP, mP, oP, sP];
    const nash = this.nashBargaining(proposals);
    const gridImport = mP.gridImportMW || 0; const demand = worldState.market.demand.total;
    const carbonTons = gridImport * 0.25 * 0.85;
    const renewableUtil = demand > 0 ? Math.min(100, Math.round(totalRenewable / demand * 100)) : 0;
    const cost = gridImport * worldState.market.electricityPrice * 0.25 / 1000;
    const revenue = (mP.gridExportMW || 0) * worldState.market.electricityPrice * 0.25 / 1000;
    const reliability = Math.max(0, 100 - Math.abs((sP.frequency || 50) - 50) * 40);

    this.metrics.totalCostK += cost; this.metrics.totalRevenueK += revenue;
    this.metrics.totalRenewableMWh += totalRenewable * 0.25; this.metrics.totalCarbonTons += carbonTons;
    this.metrics.avgFrequency = sP.frequency; this.metrics.avgReliability = reliability;
    this.metrics.totalCurtailmentMWh += ((hP.curtailmentMW || 0) + (aP.curtailmentMW || 0)) * 0.25;

    this.paretoFrontier.push({ cost: Math.round(cost * 10) / 10, carbon: Math.round(carbonTons * 100) / 100, reliability: Math.round(reliability), renewableUtil });
    if (this.paretoFrontier.length > 50) this.paretoFrontier.shift();

    this.log(`Consensus reached | Nash Product: ${nash.nashProduct.toExponential(2)}`);
    
    // LLM High-Level Orchestration Summary
    if (model) {
      this.askGemini(`You are NEXUS, the CEO AI Orchestrator. Grid demand: ${Math.round(demand)}MW. Renewable supply: ${Math.round(totalRenewable)}MW. Nash Product: ${nash.nashProduct.toExponential(2)}. Give a 1-sentence executive summary of the grid's current balance and agent cooperation.`, worldState.tick);
    }

    this.status = 'active';

    const snapshot = {
      tick: worldState.tick, hour: Math.round(((worldState.tick / 4) % 24) * 100) / 100,
      weather: worldState.weather, market: worldState.market, nash,
      paretoMetrics: { cost: Math.round(cost * 10) / 10, revenue: Math.round(revenue * 10) / 10, carbon: Math.round(carbonTons * 100) / 100, renewableUtil, curtailment: Math.round((hP.curtailmentMW || 0) + (aP.curtailmentMW || 0)), reliability: Math.round(reliability), totalRenewable: Math.round(totalRenewable), gridImport: Math.round(gridImport), batteryCharge: Math.round(vP.chargeMW || 0), batteryDischarge: Math.round(vP.dischargeMW || 0) },
      cumulativeMetrics: { ...this.metrics },
      agents: {
        nexus: { status: this.status, reasoning: [...this.reasoningChain].slice(-3), health: this.health },
        helios: { status: this.agents.helios.status, decision: this.agents.helios.lastDecision, reasoning: [...this.agents.helios.reasoningChain].slice(-3), health: this.agents.helios.health },
        aeolus: { status: this.agents.aeolus.status, decision: this.agents.aeolus.lastDecision, reasoning: [...this.agents.aeolus.reasoningChain].slice(-3), health: this.agents.aeolus.health },
        voltaic: { status: this.agents.voltaic.status, decision: this.agents.voltaic.lastDecision, reasoning: [...this.agents.voltaic.reasoningChain].slice(-3), health: this.agents.voltaic.health, batteryStates: this.agents.voltaic.batteryStates.map(s => ({ ...s })) },
        mercury: { status: this.agents.mercury.status, decision: this.agents.mercury.lastDecision, reasoning: [...this.agents.mercury.reasoningChain].slice(-3), health: this.agents.mercury.health, carbonCredits: this.agents.mercury.carbonCredits },
        oracle: { status: this.agents.oracle.status, decision: this.agents.oracle.lastDecision, reasoning: [...this.agents.oracle.reasoningChain].slice(-3), health: this.agents.oracle.health },
        sentinel: { status: this.agents.sentinel.status, decision: this.agents.sentinel.lastDecision, reasoning: [...this.agents.sentinel.reasoningChain].slice(-3), health: this.agents.sentinel.health },
      },
      energyFlow: { solar: hP.totalGenerationMW || 0, wind: aP.totalGenerationMW || 0, batteryCharge: vP.chargeMW || 0, batteryDischarge: vP.dischargeMW || 0, gridImport: mP.gridImportMW || 0, gridExport: mP.gridExportMW || 0, demand, curtailment: Math.round((hP.curtailmentMW || 0) + (aP.curtailmentMW || 0)) },
      paretoFrontier: [...this.paretoFrontier],
    };
    this.history.push(snapshot); if (this.history.length > 200) this.history.shift();
    return snapshot;
  }
}
