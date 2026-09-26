/**
 * Market Engine — Electricity prices and demand simulation
 */
import { MARKET, CONSUMERS } from './config.js';

export class MarketEngine {
  constructor() {
    this.seed = Math.random() * 1000;
    this.priceSpike = false;
    this.spikeStart = -1;
    this.spikeDuration = 0;
  }

  smoothNoise(t, frequency = 1) {
    const x = t * frequency;
    return Math.sin(x * 0.5 + this.seed) * 0.5 + Math.sin(x * 1.7 + this.seed * 1.5) * 0.3 + Math.sin(x * 3.1 + this.seed * 0.8) * 0.2;
  }

  getElectricityPrice(tick) {
    const hour = (tick / 4) % 24;
    const isPeak = MARKET.peakHours.includes(Math.floor(hour));
    let price = MARKET.basePricePerMWh;
    price *= isPeak ? 1.4 + this.smoothNoise(tick, 0.2) * 0.3 : MARKET.offPeakDiscount + this.smoothNoise(tick, 0.15) * 0.15;
    price += this.smoothNoise(tick, 0.3) * price * 0.15;
    if (this.priceSpike) price *= 2.0 + Math.random() * 1.5;
    return Math.max(1000, Math.round(price));
  }

  getCarbonPrice(tick) {
    return Math.max(500, Math.round(MARKET.carbonPricePerTon + this.smoothNoise(tick, 0.05) * MARKET.carbonPricePerTon * 0.2));
  }

  getDemandResponseIncentive(tick) {
    const hour = (tick / 4) % 24;
    const isPeak = MARKET.peakHours.includes(Math.floor(hour));
    let incentive = MARKET.demandResponseIncentive;
    if (isPeak) incentive *= 1.5;
    if (this.priceSpike) incentive *= 2.5;
    return Math.round(incentive + this.smoothNoise(tick, 0.1) * 200);
  }

  getDemand(tick) {
    const hour = (tick / 4) % 24;
    const dayFactor = 0.6 + Math.exp(-Math.pow(hour - 10, 2) / 8) * 0.3 + Math.exp(-Math.pow(hour - 19, 2) / 6) * 0.4;
    let totalDemand = 0;
    const consumerDemands = [];
    for (const consumer of CONSUMERS) {
      let demand = consumer.baseDemand * dayFactor + this.smoothNoise(tick, 0.12, consumer.baseDemand) * consumer.baseDemand * 0.1;
      demand = Math.max(consumer.baseDemand * 0.3, demand);
      consumerDemands.push({ ...consumer, currentDemand: Math.round(demand) });
      totalDemand += demand;
    }
    return { total: Math.round(totalDemand), consumers: consumerDemands };
  }

  triggerPriceSpike(tick, duration = 6) { this.priceSpike = true; this.spikeStart = tick; this.spikeDuration = duration; }
  updateSpike(tick) { if (this.priceSpike && tick - this.spikeStart >= this.spikeDuration) this.priceSpike = false; }

  getMarketState(tick) {
    this.updateSpike(tick);
    return {
      electricityPrice: this.getElectricityPrice(tick),
      carbonPrice: this.getCarbonPrice(tick),
      demandResponseIncentive: this.getDemandResponseIncentive(tick),
      demand: this.getDemand(tick),
      priceSpike: this.priceSpike,
      priceForecast: Array.from({ length: 8 }, (_, i) => ({
        tick: tick + i + 1,
        price: this.getElectricityPrice(tick + i + 1) + (Math.random() - 0.5) * 500,
        confidence: Math.max(0.3, 1 - (i + 1) * 0.08),
      })),
    };
  }
}
