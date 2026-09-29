/**
 * NEXUS Simulation Core — Ties all engines together
 */
import { NexusOrchestrator } from './agents.js';
import { WeatherEngine } from './weather.js';
import { MarketEngine } from './market.js';
import { ChaosEngine, CHAOS_EVENTS } from './chaos.js';

export class Simulation {
  constructor() {
    this.orchestrator = new NexusOrchestrator();
    this.weather = new WeatherEngine();
    this.market = new MarketEngine();
    this.chaos = new ChaosEngine();
    this.tick = 0;
    this.snapshots = [];
  }

  step() {
    const weatherState = this.weather.getWeatherState(this.tick);
    const marketState = this.market.getMarketState(this.tick);
    this.chaos.update(this.tick, this.orchestrator, this.weather, this.market);
    const worldState = { tick: this.tick, weather: weatherState, market: marketState, chaosEvents: this.chaos.activeEvents };
    const snapshot = this.orchestrator.orchestrate(worldState);
    snapshot.chaosEvents = this.chaos.activeEvents.map(e => ({ id: e.id, name: e.name, icon: e.icon, severity: e.severity, description: e.description, ticksRemaining: e.endTick - this.tick }));
    snapshot.chaosLog = [...this.chaos.eventLog].slice(-10);

    // Dynamic UI Panel Metrics
    snapshot.automatedIncidentResponse = snapshot.systemAlerts
      .filter(a => ['critical', 'warning'].includes(a.type))
      .map(a => ({ type: a.type, message: a.message }))
      .slice(-3);
    if (snapshot.automatedIncidentResponse.length === 0) {
      snapshot.automatedIncidentResponse = [{ type: 'info', message: 'No critical incidents detected recently. All agents nominal.' }];
    }
    
    snapshot.gridSecurityMonitor = this.chaos.activeEvents.length > 0 ? "Anomaly Detected" : "System Secure";
    snapshot.agentConfidenceScores = {
        helios: (95 + Math.random() * 4.9).toFixed(1),
        voltaic: (90 + Math.random() * 9.9).toFixed(1),
        mercury: (80 + Math.random() * 15.0).toFixed(1)
    };
    snapshot.gridInertia = (4.0 + (Math.random() * 0.4 - 0.2)).toFixed(1);
    
    // Generate 28 days heatmap dynamically shifting based on actual chaos events
    if (!this.heatmapCache) {
      this.heatmapCache = [];
      for(let i = 0; i < 28; i++) this.heatmapCache.push(0);
    }
    if (this.tick % 5 === 0) {
      this.heatmapCache.shift();
      let severity = 0;
      if (this.chaos.activeEvents.length > 0) {
         severity = this.chaos.activeEvents.some(e => e.severity === 'critical') ? 2 : 1;
      }
      this.heatmapCache.push(severity);
    }
    snapshot.historicalOutageHeatmap = [...this.heatmapCache];

    this.snapshots.push(snapshot);
    if (this.snapshots.length > 200) this.snapshots.shift();
    this.tick++;
    return snapshot;
  }

  injectChaos(eventId) { return this.chaos.inject(eventId, this.orchestrator, this.weather, this.market, this.tick); }
  randomChaos() { return this.chaos.randomChaos(this.orchestrator, this.weather, this.market, this.tick); }
  getChaosEvents() { return CHAOS_EVENTS; }

  reset() {
    this.orchestrator = new NexusOrchestrator();
    this.weather = new WeatherEngine();
    this.market = new MarketEngine();
    this.chaos = new ChaosEngine();
    this.tick = 0;
    this.snapshots = [];
  }
}
