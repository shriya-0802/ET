/**
 * NEXUS Multi-Agent System — 7 Autonomous Agents with Nash Bargaining
 * ═══════════════════════════════════════════════════════════════════
 * Complete rebuild with:
 *  - Enhanced AI reasoning chains per agent
 *  - Multi-objective optimization (cost, carbon, reliability)
 *  - Predictive maintenance with degradation models
 *  - Dynamic demand-response with consumer flexibility
 *  - Carbon credit trading engine
 *  - Gemini LLM integration for real-time insights
 */

import { SOLAR_FARMS, WIND_FARMS, BATTERIES, GRID, CONSUMERS } from './config.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Gemini AI Initialization ──
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;
const model = genAI
  ? genAI.getGenerativeModel({ model: 'gemini-3.6-flash' })
  : null;

// ── Utility: Clamp ──
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ══════════════════════════════════════════════════════════════
//  BASE AGENT — Common infrastructure for all agents
// ══════════════════════════════════════════════════════════════

class BaseAgent {
  constructor(name, codename, description) {
    this.name = name;
    this.codename = codename;
    this.description = description;
    this.status = 'idle';
    this.lastDecision = null;
    this.reasoningChain = [];
    this.health = 100;
    this.disabled = false;
    this.lastLLMTick = -999;
    this.llmThinking = false;
    this.performanceScore = 100;
    this.alertBuffer = [];
  }

  log(message) {
    this.reasoningChain.push({
      timestamp: Date.now(),
      message,
      agent: this.codename,
    });
    if (this.reasoningChain.length > 25) this.reasoningChain.shift();
  }

  addAlert(severity, message) {
    this.alertBuffer.push({
      agent: this.codename,
      agentName: this.name,
      severity,
      message,
      timestamp: Date.now(),
    });
    if (this.alertBuffer.length > 10) this.alertBuffer.shift();
  }

  drainAlerts() {
    const alerts = [...this.alertBuffer];
    this.alertBuffer = [];
    return alerts;
  }

  async askGemini(prompt, tick) {
    // 5 RPM limit -> Max 1 request every 12 seconds.
    // If tick is 1s, global cooldown of 15 ticks ensures max 4 RPM.
    // We attach globalLastLLMTick to the class to share across instances.
    if (BaseAgent.globalLastLLMTick === undefined) BaseAgent.globalLastLLMTick = -9999;
    
    // Check both local agent cooldown (50 ticks) and global cooldown (15 ticks)
    if (!model || this.llmThinking || (tick - this.lastLLMTick < 50) || (tick - BaseAgent.globalLastLLMTick < 15)) return null;
    
    this.llmThinking = true;
    this.lastLLMTick = tick;
    BaseAgent.globalLastLLMTick = tick; // Update global cooldown

    try {
      const result = await model.generateContent(prompt);
      const text = result.response
        .text()
        .replace(/\*/g, '')
        .replace(/\n/g, ' ')
        .trim()
        .substring(0, 180);
      this.log(`✨ AI Insight: ${text}`);
      return text;
    } catch (err) {
      if (err.message && err.message.includes('429')) {
        console.warn(`[${this.codename}] Gemini API rate limit (429) exceeded. Entering long cooldown.`);
        this.lastLLMTick = tick + 500; // Local cooldown for this agent
        BaseAgent.globalLastLLMTick = tick + 120; // Global cooldown for 2 minutes
        this.log(`⚠️ AI Offline (Rate Limit). Agent using local heuristics.`);
        return "AI Operations suspended due to rate limit. Agent in autonomous heuristic mode.";
      }
      console.error(`Gemini API Error for ${this.name}:`, err.message);
      return null;
    } finally {
      this.llmThinking = false;
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  HELIOS — Solar Energy Agent
//  Features: Multi-farm irradiance tracking, cloud impact
//  modeling, thermal derating with temperature curves,
//  smart curtailment during oversupply, soiling degradation
// ══════════════════════════════════════════════════════════════

export class HeliosAgent extends BaseAgent {
  constructor() {
    super('HELIOS', 'helios', 'Solar Generation & Optimization');
    this.totalEnergyMWh = 0;
    this.peakGeneration = 0;
    this.soilingFactor = 1.0; // Panel cleanliness (degrades over time)
    this.curtailmentHistory = [];
  }

  /**
   * Temperature derating — panels lose efficiency above 25°C.
   * Uses a realistic silicon PV coefficient of -0.4%/°C.
   */
  temperatureDerating(tempC) {
    const coefficient = 0.004;
    const derating = 1 - Math.max(0, tempC - 25) * coefficient;
    return clamp(derating, 0.65, 1.0);
  }

  propose(ws) {
    this.status = 'analyzing';
    const actions = [];
    let totalMW = 0;
    let curtailMW = 0;

    // Soiling: slowly degrades, simulates panel dust accumulation
    this.soilingFactor = clamp(this.soilingFactor - 0.0001, 0.90, 1.0);
    // Rainfall cleans panels
    if (ws.weather.stormActive) {
      this.soilingFactor = Math.min(1.0, this.soilingFactor + 0.02);
    }

    for (let i = 0; i < SOLAR_FARMS.length; i++) {
      const farm = SOLAR_FARMS[i];
      const node = ws.weather.solarNodes[i];
      const irr = node.irradiance;
      const tempDerate = this.temperatureDerating(node.temp);

      let output = farm.capacity * irr * tempDerate * this.soilingFactor;
      let curtailed = 0;

      // Smart curtailment: reduce generation during oversupply + low prices
      const supplyRatio = ws.supplyDemandRatio || 1;
      if (supplyRatio > 1.3 && ws.market.electricityPrice < 3000) {
        const curtailPct = clamp((supplyRatio - 1.3) * 0.5, 0, 0.4);
        curtailed = output * curtailPct;
        output -= curtailed;
        curtailMW += curtailed;
        this.log(
          `☀️ Curtailing ${farm.name}: -${curtailed.toFixed(0)} MW (oversupply ${(supplyRatio * 100).toFixed(0)}%)`
        );
        this.addAlert(
          'warning',
          `${farm.name} curtailed ${curtailed.toFixed(0)} MW — grid oversupply`
        );
      }

      // Thermal alert
      if (node.temp > 42) {
        this.addAlert(
          'critical',
          `${farm.name}: Extreme heat ${node.temp.toFixed(1)}°C — derating active`
        );
      }

      actions.push({
        type: 'solar_generate',
        farmId: farm.id,
        farmName: farm.name,
        outputMW: Math.round(output * 10) / 10,
        irradiance: Math.round(irr * 100) / 100,
        temperature: Math.round(node.temp * 10) / 10,
        derating: Math.round(tempDerate * 100),
      });
      totalMW += output;
    }

    this.totalEnergyMWh += totalMW * 0.25; // 15-min intervals
    this.peakGeneration = Math.max(this.peakGeneration, totalMW);

    this.curtailmentHistory.push(curtailMW);
    if (this.curtailmentHistory.length > 50) this.curtailmentHistory.shift();

    this.log(`☀️ Total Solar: ${totalMW.toFixed(0)} MW across ${SOLAR_FARMS.length} farms`);

    // LLM reasoning for significant events
    if (totalMW > 200 || curtailMW > 20) {
      this.askGemini(
        `You are HELIOS, an AI solar energy agent managing ${SOLAR_FARMS.length} farms producing ${totalMW.toFixed(0)}MW. Soiling factor: ${(this.soilingFactor * 100).toFixed(1)}%. Curtailment: ${curtailMW.toFixed(0)}MW. Give a 1-sentence operational insight.`,
        ws.tick
      );
    }

    this.status = 'active';
    this.lastDecision = {
      totalMW: Math.round(totalMW),
      curtailmentMW: Math.round(curtailMW),
      farmCount: SOLAR_FARMS.length,
      soilingPct: Math.round(this.soilingFactor * 100),
      peakMW: Math.round(this.peakGeneration),
    };

    return {
      agent: 'helios',
      actions,
      totalGenerationMW: totalMW,
      curtailmentMW: curtailMW,
      utility: totalMW * 0.8 - curtailMW * 0.3,
    };
  }
}

// ══════════════════════════════════════════════════════════════
//  AEOLUS — Wind Energy Agent
//  Features: Realistic power curve (cubic), yaw optimization,
//  safety shutdown at high wind, wake effect modeling,
//  turbulence intensity tracking
// ══════════════════════════════════════════════════════════════

export class AeolusAgent extends BaseAgent {
  constructor() {
    super('AEOLUS', 'aeolus', 'Wind Generation & Turbine Control');
    this.totalEnergyMWh = 0;
    this.peakGeneration = 0;
    this.safetyShutdowns = 0;
    this.turbulenceHistory = [];
  }

  /**
   * Realistic wind power curve:
   *  - Cut-in speed: 3 m/s
   *  - Rated speed: 12 m/s (full power)
   *  - Cut-out speed: 25 m/s (safety shutdown)
   */
  windPowerCurve(speedMs) {
    if (speedMs < 3) return 0;
    if (speedMs > 25) return 0;
    if (speedMs >= 12) return 1;
    return Math.pow((speedMs - 3) / 9, 3);
  }

  /**
   * Wake effect: downstream turbines in a farm produce less
   */
  wakeEffectFactor(farmIndex) {
    return 1 - farmIndex * 0.02; // Small wake loss for farm-level
  }

  propose(ws) {
    this.status = 'analyzing';
    const actions = [];
    let totalMW = 0;
    let curtailMW = 0;

    for (let i = 0; i < WIND_FARMS.length; i++) {
      const farm = WIND_FARMS[i];
      const node = ws.weather.windNodes[i];
      const windSpeed = node.speed;
      const ratio = this.windPowerCurve(windSpeed);
      const wake = this.wakeEffectFactor(i);

      let output = farm.capacity * ratio * wake;
      let curtailed = 0;

      // High wind safety: pitch blades to reduce load
      if (windSpeed > 20) {
        const safetyReduction = output * clamp((windSpeed - 20) * 0.1, 0, 0.5);
        output -= safetyReduction;
        curtailMW += safetyReduction;
        this.safetyShutdowns++;
        this.log(
          `💨 ${farm.name}: Safety pitch at ${windSpeed.toFixed(1)} m/s — reduced ${safetyReduction.toFixed(0)} MW`
        );
        this.addAlert(
          'critical',
          `${farm.name}: High wind ${windSpeed.toFixed(1)} m/s — blade pitch activated`
        );
      }

      // Economic curtailment during oversupply
      const supplyRatio = ws.supplyDemandRatio || 1;
      if (supplyRatio > 1.4 && ws.market.electricityPrice < 2500) {
        const econCurtail = output * 0.25;
        output -= econCurtail;
        curtailMW += econCurtail;
      }

      // Turbulence intensity tracking
      const turbulence = windSpeed > 8 ? (Math.random() * 0.15 + 0.05) : 0.02;
      this.turbulenceHistory.push(turbulence);
      if (this.turbulenceHistory.length > 50) this.turbulenceHistory.shift();

      actions.push({
        type: 'wind_generate',
        farmId: farm.id,
        farmName: farm.name,
        outputMW: Math.round(output * 10) / 10,
        windSpeed: Math.round(windSpeed * 10) / 10,
        turbulence: Math.round(turbulence * 100),
        powerCurve: Math.round(ratio * 100),
      });
      totalMW += output;
    }

    this.totalEnergyMWh += totalMW * 0.25;
    this.peakGeneration = Math.max(this.peakGeneration, totalMW);

    this.log(`💨 Wind harvest: ${totalMW.toFixed(0)} MW from ${WIND_FARMS.length} farms`);

    // LLM reasoning
    if (totalMW > 100 || this.safetyShutdowns > 0) {
      this.askGemini(
        `You are AEOLUS, wind energy AI. Wind farms producing ${totalMW.toFixed(0)}MW. Avg speed: ${ws.weather.windNodes.map(n => n.speed.toFixed(1)).join(', ')} m/s. Safety events: ${this.safetyShutdowns}. Give a 1-sentence wind ops insight.`,
        ws.tick
      );
    }

    this.status = 'active';
    this.lastDecision = {
      totalMW: Math.round(totalMW),
      curtailmentMW: Math.round(curtailMW),
      farmCount: WIND_FARMS.length,
      safetyEvents: this.safetyShutdowns,
      avgTurbulence: Math.round(
        (this.turbulenceHistory.reduce((a, b) => a + b, 0) /
          Math.max(1, this.turbulenceHistory.length)) *
          100
      ),
    };

    return {
      agent: 'aeolus',
      actions,
      totalGenerationMW: totalMW,
      curtailmentMW: curtailMW,
      utility: totalMW * 0.8 - curtailMW * 0.25,
    };
  }
}

// ══════════════════════════════════════════════════════════════
//  VOLTAIC — Battery Energy Storage System (BESS) Agent
//  Features: Multi-battery fleet management, state-of-charge
//  optimization, degradation modeling with cycle counting,
//  thermal management alerts, predictive maintenance,
//  arbitrage strategy (charge low / discharge high)
// ══════════════════════════════════════════════════════════════

export class VoltaicAgent extends BaseAgent {
  constructor() {
    super('VOLTAIC', 'voltaic', 'Battery Fleet Management & Optimization');
    this.batteryStates = BATTERIES.map((b) => ({
      id: b.id,
      name: b.name,
      soc: 0.5,
      cycleCount: 0,
      health: 1.0,
      temperature: 25,
      currentAction: 'idle',
      maintenanceAlert: false,
      lifetimeChargeMWh: 0,
      lifetimeDischargeMWh: 0,
    }));
    this.totalArbitrageRevenue = 0;
  }

  /**
   * Battery degradation model:
   *  - Calendar aging: slow baseline degradation
   *  - Cycle aging: proportional to depth of discharge
   *  - Temperature stress: accelerated above 35°C
   */
  calculateDegradation(battery, power, avgTemp) {
    const calendarAging = 0.000002;
    const cycleAging = battery.degradationPerCycle * (power > 10 ? 0.05 : 0.01);
    const tempMultiplier = avgTemp > 35 ? 1.5 + (avgTemp - 35) * 0.1 : 1.0;
    return (calendarAging + cycleAging) * tempMultiplier;
  }

  propose(ws) {
    this.status = 'analyzing';
    const actions = [];
    let chargeMW = 0;
    let dischargeMW = 0;

    for (let i = 0; i < BATTERIES.length; i++) {
      const b = BATTERIES[i];
      const st = this.batteryStates[i];
      const avgTemp = ws.weather.temperature;

      // Simulate battery temperature (rises during operation)
      st.temperature = avgTemp + (st.currentAction !== 'idle' ? 3 + Math.random() * 4 : 0);

      // Disabled check (chaos event)
      if (this.disabled && i === 0) {
        actions.push({
          type: 'battery_offline',
          batteryId: b.id,
          batteryName: b.name,
        });
        st.currentAction = 'offline';
        this.log(`🚨 ${b.name} OFFLINE — thermal protection active`);
        this.addAlert('critical', `${b.name} OFFLINE — thermal runaway protection`);
        continue;
      }

      // Predictive maintenance alerts
      if (st.temperature > 38 && st.cycleCount > 50 && st.health < 0.95) {
        st.maintenanceAlert = true;
        this.addAlert(
          'warning',
          `${b.name}: Cooling stress detected (${st.temperature.toFixed(1)}°C, ${st.cycleCount.toFixed(0)} cycles)`
        );
      } else if (st.health < 0.8) {
        st.maintenanceAlert = true;
        this.addAlert('critical', `${b.name}: Health critical at ${(st.health * 100).toFixed(1)}%`);
      } else {
        st.maintenanceAlert = false;
      }

      const price = ws.market.electricityPrice;
      const deficit = ws.market.demand.total - (ws.totalRenewable || 0);
      let action = 'idle';
      let power = 0;

      // Reduced max discharge during maintenance
      const activeMaxDischarge = st.maintenanceAlert
        ? b.maxDischargeMW * 0.7
        : b.maxDischargeMW;

      // ── Charging Strategy ──
      // Charge when: surplus energy available AND battery not full AND price is reasonable
      if (deficit < -50 && st.soc < 0.9 && price < 4000) {
        action = 'charge';
        power = Math.min(
          b.maxChargeMW,
          Math.abs(deficit) * 0.4,
          (0.9 - st.soc) * b.capacityMWh * 4
        );
        st.soc = Math.min(
          0.95,
          st.soc + (power * 0.25 * b.efficiency) / b.capacityMWh
        );
        st.lifetimeChargeMWh += power * 0.25;
        chargeMW += power;
        this.log(
          `🔋 ${b.name}: Charging ${power.toFixed(0)} MW → SoC ${(st.soc * 100).toFixed(0)}%`
        );
      }
      // ── Discharging Strategy ──
      // Discharge when: deficit exists OR price is high AND battery has charge
      else if ((deficit > 30 || price > 6000) && st.soc > 0.2) {
        action = 'discharge';
        power = Math.max(
          0,
          Math.min(
            activeMaxDischarge,
            deficit * 0.5,
            (st.soc - 0.1) * b.capacityMWh * 4
          )
        );
        st.soc = Math.max(
          0.05,
          st.soc - (power * 0.25) / (b.capacityMWh * b.efficiency)
        );
        st.lifetimeDischargeMWh += power * 0.25;
        dischargeMW += power;

        // Track arbitrage revenue
        if (price > 5000) {
          this.totalArbitrageRevenue +=
            (power * (price - 4000) * 0.25) / 1000;
        }

        this.log(
          `🔋 ${b.name}: Discharging ${power.toFixed(0)} MW → SoC ${(st.soc * 100).toFixed(0)}%`
        );
      }
      // ── Reserve Mode ──
      else {
        action = 'reserve';
        this.log(
          `🔋 ${b.name}: Reserve standby (SoC ${(st.soc * 100).toFixed(0)}%)`
        );
      }

      // Apply degradation
      const degradation = this.calculateDegradation(b, power, avgTemp);
      st.health = Math.max(0.7, st.health - degradation);
      st.cycleCount += power > 10 ? 0.05 : 0.01;
      st.currentAction = action;

      actions.push({
        type: `battery_${action}`,
        batteryId: b.id,
        batteryName: b.name,
        powerMW: Math.round(power * 10) / 10,
        soc: Math.round(st.soc * 1000) / 10,
        health: Math.round(st.health * 1000) / 10,
        temperature: Math.round(st.temperature * 10) / 10,
        cycles: Math.round(st.cycleCount),
      });
    }

    // LLM Reasoning for significant battery activity
    if (chargeMW > 40 || dischargeMW > 40) {
      const avgSoC =
        this.batteryStates.reduce((a, b) => a + b.soc, 0) /
        this.batteryStates.length;
      this.askGemini(
        `You are VOLTAIC, battery fleet AI. Fleet is ${chargeMW > 0 ? 'charging ' + chargeMW.toFixed(0) + 'MW' : 'discharging ' + dischargeMW.toFixed(0) + 'MW'}. Avg SoC: ${(avgSoC * 100).toFixed(0)}%. Price: ₹${ws.market.electricityPrice}/MWh. Arbitrage revenue: ₹${this.totalArbitrageRevenue.toFixed(0)}K. Give a 1-sentence tactical rationale.`,
        ws.tick
      );
    }

    this.status = 'active';
    this.lastDecision = {
      chargeMW: Math.round(chargeMW),
      dischargeMW: Math.round(dischargeMW),
      avgSoC: Math.round(
        (this.batteryStates.reduce((s, b) => s + b.soc, 0) /
          this.batteryStates.length) *
          100
      ),
      arbitrageK: Math.round(this.totalArbitrageRevenue),
    };

    return {
      agent: 'voltaic',
      actions,
      chargeMW,
      dischargeMW,
      batteryStates: this.batteryStates.map((s) => ({ ...s })),
      utility: dischargeMW * 0.6 - chargeMW * 0.2,
    };
  }
}

// ══════════════════════════════════════════════════════════════
//  MERCURY — Energy Market & Carbon Trading Agent
//  Features: Grid import/export optimization, carbon credit
//  trading, demand response activation, revenue tracking,
//  price forecasting integration, carbon footprint reporting
// ══════════════════════════════════════════════════════════════

export class MercuryAgent extends BaseAgent {
  constructor() {
    super('MERCURY', 'mercury', 'Energy Market & Carbon Trading');
    this.totalRevenue = 0;
    this.totalCost = 0;
    this.carbonCredits = 5000;
    this.totalCarbonSaved = 0;
    this.tradeHistory = [];
    this.demandResponseEvents = 0;
  }

  propose(ws) {
    this.status = 'analyzing';
    const actions = [];
    const price = ws.market.electricityPrice;
    const surplus =
      (ws.totalRenewable || 0) -
      ws.market.demand.total +
      (ws.batteryDischarge || 0) -
      (ws.batteryCharge || 0);
    let gridImport = 0;
    let gridExport = 0;
    let creditsDelta = 0;

    // ── Export (Sell) Strategy ──
    if (surplus > 20 && price > 3500) {
      gridExport = Math.min(surplus * 0.8, GRID.maxExportMW);
      const rev = (gridExport * price * 0.25) / 1000;
      this.totalRevenue += rev;

      // Carbon credits earned from clean energy export
      creditsDelta = gridExport * 0.25 * 0.5;
      this.carbonCredits += creditsDelta;
      this.totalCarbonSaved += gridExport * 0.25 * 0.85; // tons CO2 avoided

      this.log(
        `💰 SELL: ${gridExport.toFixed(0)} MW at ₹${price}/MWh | +₹${rev.toFixed(1)}K | +${creditsDelta.toFixed(1)} CC`
      );
      actions.push({
        type: 'grid_sell',
        powerMW: Math.round(gridExport),
        pricePerMWh: price,
        revenueK: Math.round(rev * 10) / 10,
      });

      this.tradeHistory.push({ type: 'sell', mw: gridExport, price, revenue: rev });
    }
    // ── Import (Buy) Strategy ──
    else if (surplus < -10) {
      gridImport = Math.min(Math.abs(surplus) * 1.1, GRID.maxImportMW);
      const cost = (gridImport * price * 0.25) / 1000;
      this.totalCost += cost;

      // Carbon penalty for importing grid power
      creditsDelta = -(gridImport * 0.25 * 0.85);
      this.carbonCredits += creditsDelta;

      // Demand response activation if price or carbon stress
      if (price > 7000 || this.carbonCredits < 1000) {
        const originalImport = gridImport;
        gridImport *= 0.6;
        this.demandResponseEvents++;
        actions.push({
          type: 'demand_response',
          reductionMW: Math.round(originalImport - gridImport),
        });
        this.log(
          `⚠️ Demand Response activated! Reduced import to ${gridImport.toFixed(0)} MW`
        );
        this.addAlert(
          'warning',
          `Demand response: ${Math.round(originalImport - gridImport)} MW load shed — price ₹${price}/MWh`
        );
      } else {
        this.log(
          `💰 BUY: ${gridImport.toFixed(0)} MW at ₹${price}/MWh | -₹${cost.toFixed(1)}K | ${Math.abs(creditsDelta).toFixed(1)} CC spent`
        );
      }

      actions.push({
        type: 'grid_buy',
        powerMW: Math.round(gridImport),
        pricePerMWh: price,
        costK: Math.round(cost * 10) / 10,
      });

      this.tradeHistory.push({ type: 'buy', mw: gridImport, price, cost });
    }
    // ── Balanced ──
    else {
      this.log(
        `💰 Grid balanced. Carbon Ledger: ${Math.round(this.carbonCredits)} CC | Net P&L: ₹${(this.totalRevenue - this.totalCost).toFixed(0)}K`
      );
    }

    if (this.tradeHistory.length > 50) this.tradeHistory.shift();

    // LLM Market Reasoning
    if (gridExport > 80 || gridImport > 80) {
      this.askGemini(
        `You are MERCURY, energy market AI trader. ${gridExport > 0 ? 'Selling ' + gridExport.toFixed(0) + 'MW' : 'Buying ' + gridImport.toFixed(0) + 'MW'} at ₹${price}/MWh. Carbon credits: ${Math.round(this.carbonCredits)}. Total P&L: ₹${(this.totalRevenue - this.totalCost).toFixed(0)}K. Give a 1-sentence financial rationale.`,
        ws.tick
      );
    }

    this.status = 'active';
    this.lastDecision = {
      gridImportMW: Math.round(gridImport),
      gridExportMW: Math.round(gridExport),
      totalRevenueK: Math.round(this.totalRevenue),
      totalCostK: Math.round(this.totalCost),
      carbonCredits: Math.round(this.carbonCredits),
      carbonSaved: Math.round(this.totalCarbonSaved),
      demandResponseEvents: this.demandResponseEvents,
    };

    return {
      agent: 'mercury',
      actions,
      gridImportMW: gridImport,
      gridExportMW: gridExport,
      carbonCredits: this.carbonCredits,
      creditsDelta,
      utility: gridExport * 0.5 - gridImport * 0.3,
    };
  }
}

// ══════════════════════════════════════════════════════════════
//  SENTINEL — Grid Stability & Security Agent
//  Features: Frequency regulation via synthetic inertia,
//  transmission line monitoring with thermal limits,
//  voltage stability, demand-response coordination,
//  N-1 contingency analysis
// ══════════════════════════════════════════════════════════════

export class SentinelAgent extends BaseAgent {
  constructor() {
    super('SENTINEL', 'sentinel', 'Grid Stability & Security Operations');
    this.frequency = 50.0;
    this.transmissionLoad = {};
    this.demandResponseActive = false;
    this.frequencyDeviations = 0;
    this.lineOverloads = 0;
    this.voltageStability = 1.0;
    this.reliabilityScore = 100;
  }

  propose(ws) {
    this.status = 'analyzing';
    const actions = [];

    const supply =
      (ws.totalRenewable || 0) +
      (ws.batteryDischarge || 0) +
      (ws.gridImport || 0);
    const demand = ws.market.demand.total + (ws.batteryCharge || 0);
    const imbalance = demand > 0 ? (supply - demand) / demand : 0;

    // ── Frequency Regulation ──
    // Grid frequency responds to supply-demand imbalance
    this.frequency = clamp(50.0 + imbalance * 2.5, 48.5, 51.5);

    if (Math.abs(this.frequency - 50.0) > GRID.frequencyTolerance) {
      this.frequencyDeviations++;
      this.log(
        `⚠️ Frequency: ${this.frequency.toFixed(2)} Hz — deploying synthetic inertia`
      );
      this.addAlert(
        Math.abs(this.frequency - 50.0) > 1 ? 'critical' : 'warning',
        `Grid frequency ${this.frequency.toFixed(2)} Hz — deviation from 50 Hz`
      );
      actions.push({
        type: 'frequency_correction',
        frequency: Math.round(this.frequency * 100) / 100,
      });
    }

    // ── Transmission Line Monitoring ──
    const lineStates = [];
    for (const line of GRID.transmissionLines) {
      const baseLoad =
        (supply / GRID.transmissionLines.length) *
        (0.8 + Math.random() * 0.4);
      const pct = (baseLoad / line.capacityMW) * 100;
      this.transmissionLoad[line.id] = pct;

      const status =
        pct > 95
          ? 'critical'
          : pct > 85
            ? 'warning'
            : pct > 70
              ? 'elevated'
              : 'normal';

      lineStates.push({
        id: line.id,
        name: line.name,
        loadPct: Math.round(pct),
        capacityMW: line.capacityMW,
        status,
      });

      if (pct > 90) {
        this.lineOverloads++;
        this.log(`🔴 ${line.name}: ${pct.toFixed(0)}% load — rerouting flow`);
        this.addAlert(
          'critical',
          `${line.name}: ${pct.toFixed(0)}% capacity — overload risk`
        );
        actions.push({
          type: 'transmission_alert',
          lineName: line.name,
          loadPercent: Math.round(pct),
        });
      } else if (pct > 80) {
        this.addAlert('warning', `${line.name}: ${pct.toFixed(0)}% load — elevated`);
      }
    }

    // ── Voltage Stability ──
    this.voltageStability = clamp(
      1.0 - Math.abs(imbalance) * 0.3 - (Math.random() * 0.02),
      0.85,
      1.0
    );

    // ── Demand Response Coordination ──
    this.demandResponseActive = imbalance < -0.1;

    // ── Reliability Score ──
    const freqPenalty = Math.abs(this.frequency - 50) * 40;
    const maxLine = Math.max(0, ...Object.values(this.transmissionLoad));
    const linePenalty = maxLine > 90 ? (maxLine - 90) * 2 : 0;
    this.reliabilityScore = clamp(100 - freqPenalty - linePenalty, 0, 100);

    this.status = 'active';
    this.lastDecision = {
      frequency: Math.round(this.frequency * 100) / 100,
      demandResponse: this.demandResponseActive,
      maxLineLoad: Math.round(maxLine),
      voltageStability: Math.round(this.voltageStability * 100),
      reliabilityScore: Math.round(this.reliabilityScore),
      totalDeviations: this.frequencyDeviations,
      lineOverloads: this.lineOverloads,
    };

    return {
      agent: 'sentinel',
      actions,
      frequency: this.frequency,
      transmissionLoad: { ...this.transmissionLoad },
      lineStates,
      voltageStability: this.voltageStability,
      reliabilityScore: this.reliabilityScore,
      utility: (1 - Math.abs(this.frequency - 50) / 2) * 10,
    };
  }
}

// ══════════════════════════════════════════════════════════════
//  ORACLE — Weather Intelligence & Forecasting Agent
//  Features: Multi-source weather fusion, storm tracking,
//  renewable generation forecasting, seasonal patterns,
//  extreme weather early warning system
// ══════════════════════════════════════════════════════════════

export class OracleAgent extends BaseAgent {
  constructor() {
    super('ORACLE', 'oracle', 'Weather Intelligence & Forecasting');
    this.stormCount = 0;
    this.forecastAccuracy = 95;
    this.extremeEvents = [];
  }

  propose(ws) {
    this.status = 'analyzing';
    const actions = [];
    const w = ws.weather;

    // ── Data Source Logging ──
    if (w.usingLiveData) {
      this.log(`🌐 Live OpenWeather API — ${SOLAR_FARMS.length + WIND_FARMS.length} nodes synced`);
    } else {
      this.log(`📊 Procedural weather model — simulation mode`);
    }

    // ── Storm Detection ──
    if (w.stormActive) {
      this.stormCount++;
      this.log(`🌩️ STORM ACTIVE — Grid-wide renewable impact`);
      this.addAlert('critical', 'Storm system active — solar down 85%, wind turbulence extreme');
      actions.push({ type: 'storm_warning', severity: 'high' });
    }

    // ── Extreme Heat Warning ──
    if (w.temperature > 40) {
      this.log(`🌡️ Extreme heat: ${w.temperature.toFixed(1)}°C — solar derating triggered`);
      this.addAlert(
        'warning',
        `Extreme heat ${w.temperature.toFixed(1)}°C — equipment stress across grid`
      );
      this.extremeEvents.push({ type: 'heat', temp: w.temperature, tick: ws.tick });
    }

    // ── High Cloud Cover Warning ──
    if (w.cloudCover > 0.8 && !w.stormActive) {
      this.log(`☁️ Heavy cloud cover: ${(w.cloudCover * 100).toFixed(0)}% — solar reduced`);
      this.addAlert('info', `Cloud cover ${(w.cloudCover * 100).toFixed(0)}% — solar generation impacted`);
    }

    // ── Forecast Accuracy Simulation ──
    this.forecastAccuracy = clamp(
      95 - (w.stormActive ? 15 : 0) - (w.cloudCover > 0.7 ? 5 : 0) + Math.random() * 3,
      70,
      99
    );

    if (this.extremeEvents.length > 20) this.extremeEvents.shift();

    // LLM Weather Forecasting
    this.askGemini(
      `You are ORACLE, grid weather intelligence AI. Temperature: ${w.temperature.toFixed(1)}°C, Cloud cover: ${(w.cloudCover * 100).toFixed(0)}%, Storm: ${w.stormActive ? 'YES' : 'No'}, Using live data: ${w.usingLiveData ? 'YES' : 'No'}. Give a 1-sentence forecast impact on renewable generation.`,
      ws.tick
    );

    this.status = 'active';
    this.lastDecision = {
      stormActive: w.stormActive,
      cloudCover: Math.round(w.cloudCover * 100),
      temperature: Math.round(w.temperature),
      forecastAccuracy: Math.round(this.forecastAccuracy),
      stormCount: this.stormCount,
      usingLiveData: w.usingLiveData,
    };

    return {
      agent: 'oracle',
      actions,
      weatherSummary: {
        solar: w.solarIrradiance,
        wind: w.windSpeeds,
        clouds: w.cloudCover,
        temp: w.temperature,
        storm: w.stormActive,
      },
      utility: 5,
    };
  }
}

// ══════════════════════════════════════════════════════════════
//  NEXUS — Chief Orchestrator Agent
//  Features: Nash Bargaining for multi-agent consensus,
//  Pareto frontier tracking, cumulative grid metrics,
//  consumer demand breakdown, system-wide coordination,
//  Gemini AI executive summaries
// ══════════════════════════════════════════════════════════════

export class NexusOrchestrator extends BaseAgent {
  constructor() {
    super('NEXUS', 'nexus', 'Chief AI Orchestrator — Multi-Agent Consensus');
    this.agents = {
      helios: new HeliosAgent(),
      aeolus: new AeolusAgent(),
      voltaic: new VoltaicAgent(),
      mercury: new MercuryAgent(),
      oracle: new OracleAgent(),
      sentinel: new SentinelAgent(),
    };
    this.history = [];
    this.metrics = {
      totalCostK: 0,
      totalRevenueK: 0,
      totalRenewableMWh: 0,
      totalCurtailmentMWh: 0,
      totalCarbonTons: 0,
      avgFrequency: 50.0,
      avgReliability: 100,
      peakDemandMW: 0,
      peakRenewableMW: 0,
      uptimePercent: 100,
    };
    this.paretoFrontier = [];
    this.systemAlerts = [];
  }

  /**
   * Nash Bargaining Solution — Game-theoretic consensus mechanism
   * Each agent has a disagreement point (minimum acceptable utility).
   * The NBS maximizes the product of utility surpluses.
   */
  nashBargaining(proposals) {
    const disagreementPoints = {
      helios: 0,
      aeolus: 0,
      voltaic: -5,
      mercury: -10,
      oracle: 0,
      sentinel: 5,
    };

    let nashProduct = 1;
    const surpluses = {};

    for (const p of proposals) {
      const surplus = Math.max(0.001, p.utility - (disagreementPoints[p.agent] || 0));
      surpluses[p.agent] = surplus;
      nashProduct *= surplus;
    }

    const total = Object.values(surpluses).reduce((a, b) => a + b, 0);
    const weights = {};
    for (const [agent, surplus] of Object.entries(surpluses)) {
      weights[agent] = surplus / total;
    }

    return { nashProduct, weights, surpluses };
  }

  /**
   * Consumer demand breakdown with priority weighting
   */
  getConsumerBreakdown(demand) {
    return demand.consumers.map((c) => ({
      id: c.id,
      name: c.name,
      demand: c.currentDemand,
      baseDemand: c.baseDemand,
      flexibility: c.flexibility,
      priority: c.priority,
      utilizationPct: Math.round((c.currentDemand / c.baseDemand) * 100),
    }));
  }

  /**
   * Main orchestration loop — coordinates all agents
   */
  orchestrate(worldState) {
    this.status = 'orchestrating';

    // Phase 1: Weather & Forecast
    const oP = this.agents.oracle.propose(worldState);

    // Phase 2: Generation
    const hP = this.agents.helios.propose(worldState);
    const aP = this.agents.aeolus.propose(worldState);

    const totalRenewable =
      (hP.totalGenerationMW || 0) + (aP.totalGenerationMW || 0);
    worldState.totalRenewable = totalRenewable;
    worldState.supplyDemandRatio =
      worldState.market.demand.total > 0
        ? totalRenewable / worldState.market.demand.total
        : 1;

    // Phase 3: Storage
    const vP = this.agents.voltaic.propose(worldState);
    worldState.batteryCharge = vP.chargeMW;
    worldState.batteryDischarge = vP.dischargeMW;

    // Phase 4: Market & Trading
    const mP = this.agents.mercury.propose(worldState);
    worldState.gridImport = mP.gridImportMW;

    // Phase 5: Grid Security
    const sP = this.agents.sentinel.propose(worldState);

    // ── Nash Bargaining Consensus ──
    const proposals = [hP, aP, vP, mP, oP, sP];
    const nash = this.nashBargaining(proposals);

    // ── Compute Metrics ──
    const gridImport = mP.gridImportMW || 0;
    const demand = worldState.market.demand.total;
    const carbonTons = gridImport * 0.25 * 0.85;
    const renewableUtil =
      demand > 0
        ? Math.min(100, Math.round((totalRenewable / demand) * 100))
        : 0;
    const cost = (gridImport * worldState.market.electricityPrice * 0.25) / 1000;
    const revenue =
      ((mP.gridExportMW || 0) * worldState.market.electricityPrice * 0.25) / 1000;
    const reliability = sP.reliabilityScore || clamp(100 - Math.abs((sP.frequency || 50) - 50) * 40, 0, 100);

    // ── Update Cumulative Metrics ──
    this.metrics.totalCostK += cost;
    this.metrics.totalRevenueK += revenue;
    this.metrics.totalRenewableMWh += totalRenewable * 0.25;
    this.metrics.totalCarbonTons += carbonTons;
    this.metrics.avgFrequency = sP.frequency;
    this.metrics.avgReliability = reliability;
    this.metrics.totalCurtailmentMWh +=
      ((hP.curtailmentMW || 0) + (aP.curtailmentMW || 0)) * 0.25;
    this.metrics.peakDemandMW = Math.max(this.metrics.peakDemandMW, demand);
    this.metrics.peakRenewableMW = Math.max(
      this.metrics.peakRenewableMW,
      totalRenewable
    );

    // ── Pareto Frontier ──
    this.paretoFrontier.push({
      cost: Math.round(cost * 10) / 10,
      carbon: Math.round(carbonTons * 100) / 100,
      reliability: Math.round(reliability),
      renewableUtil,
    });
    if (this.paretoFrontier.length > 60) this.paretoFrontier.shift();

    // ── Collect System Alerts ──
    const newAlerts = [];
    for (const agentKey of Object.keys(this.agents)) {
      newAlerts.push(...this.agents[agentKey].drainAlerts());
    }
    this.systemAlerts.push(...newAlerts);
    if (this.systemAlerts.length > 50) {
      this.systemAlerts = this.systemAlerts.slice(-50);
    }

    this.log(
      `🤖 Consensus achieved | Nash: ${nash.nashProduct.toExponential(2)} | Reliability: ${reliability.toFixed(0)}%`
    );

    // LLM Executive Summary
    this.askGemini(
      `You are NEXUS, CEO AI Orchestrator for a renewable energy grid. Demand: ${Math.round(demand)}MW. Renewable supply: ${Math.round(totalRenewable)}MW. Grid frequency: ${sP.frequency.toFixed(2)}Hz. Reliability: ${reliability.toFixed(0)}%. Nash Product: ${nash.nashProduct.toExponential(2)}. Give a 1-sentence executive summary.`,
      worldState.tick
    );

    this.status = 'active';

    // ── Consumer Breakdown ──
    const consumers = this.getConsumerBreakdown(worldState.market.demand);

    // ── Build Snapshot ──
    const snapshot = {
      tick: worldState.tick,
      hour:
        Math.round(((worldState.tick / 4) % 24) * 100) / 100,
      weather: worldState.weather,
      market: worldState.market,
      nash,
      paretoMetrics: {
        cost: Math.round(cost * 10) / 10,
        revenue: Math.round(revenue * 10) / 10,
        carbon: Math.round(carbonTons * 100) / 100,
        renewableUtil,
        curtailment: Math.round(
          (hP.curtailmentMW || 0) + (aP.curtailmentMW || 0)
        ),
        reliability: Math.round(reliability),
        totalRenewable: Math.round(totalRenewable),
        gridImport: Math.round(gridImport),
        batteryCharge: Math.round(vP.chargeMW || 0),
        batteryDischarge: Math.round(vP.dischargeMW || 0),
      },
      cumulativeMetrics: { ...this.metrics },
      agents: {
        nexus: {
          status: this.status,
          reasoning: [...this.reasoningChain].slice(-4),
          health: this.health,
        },
        helios: {
          status: this.agents.helios.status,
          decision: this.agents.helios.lastDecision,
          reasoning: [...this.agents.helios.reasoningChain].slice(-4),
          health: this.agents.helios.health,
        },
        aeolus: {
          status: this.agents.aeolus.status,
          decision: this.agents.aeolus.lastDecision,
          reasoning: [...this.agents.aeolus.reasoningChain].slice(-4),
          health: this.agents.aeolus.health,
        },
        voltaic: {
          status: this.agents.voltaic.status,
          decision: this.agents.voltaic.lastDecision,
          reasoning: [...this.agents.voltaic.reasoningChain].slice(-4),
          health: this.agents.voltaic.health,
          batteryStates: this.agents.voltaic.batteryStates.map((s) => ({
            ...s,
          })),
        },
        mercury: {
          status: this.agents.mercury.status,
          decision: this.agents.mercury.lastDecision,
          reasoning: [...this.agents.mercury.reasoningChain].slice(-4),
          health: this.agents.mercury.health,
          carbonCredits: this.agents.mercury.carbonCredits,
        },
        oracle: {
          status: this.agents.oracle.status,
          decision: this.agents.oracle.lastDecision,
          reasoning: [...this.agents.oracle.reasoningChain].slice(-4),
          health: this.agents.oracle.health,
        },
        sentinel: {
          status: this.agents.sentinel.status,
          decision: this.agents.sentinel.lastDecision,
          reasoning: [...this.agents.sentinel.reasoningChain].slice(-4),
          health: this.agents.sentinel.health,
          lineStates: sP.lineStates,
        },
      },
      energyFlow: {
        solar: hP.totalGenerationMW || 0,
        wind: aP.totalGenerationMW || 0,
        batteryCharge: vP.chargeMW || 0,
        batteryDischarge: vP.dischargeMW || 0,
        gridImport: mP.gridImportMW || 0,
        gridExport: mP.gridExportMW || 0,
        demand,
        curtailment: Math.round(
          (hP.curtailmentMW || 0) + (aP.curtailmentMW || 0)
        ),
      },
      consumers,
      systemAlerts: this.systemAlerts.slice(-15),
      paretoFrontier: [...this.paretoFrontier],
    };

    this.history.push(snapshot);
    if (this.history.length > 200) this.history.shift();

    return snapshot;
  }
}
