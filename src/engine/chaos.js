/**
 * Chaos Engine — Failure injection for autonomous adaptation demo
 */
export const CHAOS_EVENTS = [
  { id: 'battery_failure', name: 'Battery Failure', icon: '🔋', description: 'BESS North goes offline — thermal runaway protection', severity: 'critical', duration: 12,
    apply: (o) => { o.agents.voltaic.disabled = true; o.agents.voltaic.batteryStates[0].currentAction = 'offline'; o.log('🚨 Battery failure detected'); },
    revert: (o) => { o.agents.voltaic.disabled = false; o.log('✅ Battery restored'); } },
  { id: 'cloud_cover', name: 'Sudden Storm', icon: '🌩️', description: 'Unexpected storm reduces solar by 85%', severity: 'high', duration: 8,
    apply: (o, w) => { w.triggerStorm(o.history.length, 8); o.log('🚨 Storm detected — solar critical'); },
    revert: (o) => { o.log('✅ Storm cleared'); } },
  { id: 'price_spike', name: 'Price Spike', icon: '📈', description: 'Electricity prices surge 200%', severity: 'high', duration: 6,
    apply: (o, w, m) => { m.triggerPriceSpike(o.history.length, 6); o.log('🚨 Price spike — optimizing for profit'); },
    revert: (o) => { o.log('✅ Prices normalized'); } },
  { id: 'demand_surge', name: 'Demand Surge', icon: '🏭', description: 'Industrial demand increases 40%', severity: 'medium', duration: 10,
    apply: (o) => { o.log('🚨 Industrial demand surge'); },
    revert: (o) => { o.log('✅ Demand normalized'); } },
  { id: 'transmission_failure', name: 'Line Trip', icon: '⚡', description: 'Northern Corridor trips — capacity halved', severity: 'critical', duration: 8,
    apply: (o) => { o.log('🚨 Transmission failure — grid at risk'); },
    revert: (o) => { o.log('✅ Transmission restored'); } },
  { id: 'wind_gust', name: 'Extreme Wind', icon: '🌪️', description: 'Wind >25 m/s — turbine safety shutdown', severity: 'high', duration: 6,
    apply: (o, w) => { w.seed += 100; o.log('🚨 Extreme wind — safety protocols'); },
    revert: (o, w) => { w.seed -= 100; o.log('✅ Wind normalized'); } },
];

export class ChaosEngine {
  constructor() { this.activeEvents = []; this.eventLog = []; }

  inject(eventId, orchestrator, weatherEngine, marketEngine, tick) {
    const template = CHAOS_EVENTS.find(e => e.id === eventId);
    if (!template || this.activeEvents.find(e => e.id === eventId)) return;
    const event = { ...template, startTick: tick, endTick: tick + template.duration };
    template.apply(orchestrator, weatherEngine, marketEngine);
    this.activeEvents.push(event);
    this.eventLog.push({ id: event.id, name: event.name, icon: event.icon, timestamp: Date.now(), action: 'injected' });
    return event;
  }

  update(tick, orchestrator, weatherEngine, marketEngine) {
    const expired = this.activeEvents.filter(e => tick >= e.endTick);
    for (const e of expired) { e.revert(orchestrator, weatherEngine, marketEngine); this.eventLog.push({ id: e.id, name: e.name, timestamp: Date.now(), action: 'resolved' }); }
    this.activeEvents = this.activeEvents.filter(e => tick < e.endTick);
  }

  randomChaos(orchestrator, weatherEngine, marketEngine, tick) {
    const available = CHAOS_EVENTS.filter(e => !this.activeEvents.find(a => a.id === e.id));
    if (!available.length) return null;
    return this.inject(available[Math.floor(Math.random() * available.length)].id, orchestrator, weatherEngine, marketEngine, tick);
  }
}
