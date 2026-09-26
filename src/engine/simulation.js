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
