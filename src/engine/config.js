/**
 * NEXUS Global Configuration
 */
export const TICK_INTERVAL_MS = 2000;
export const TICKS_PER_HOUR = 4;
export const TOTAL_TICKS_24H = 96;

export const SOLAR_FARMS = [
  { id: 'solar-1', name: 'Rajasthan Alpha', capacity: 150, lat: 26.9, lon: 70.9 },
  { id: 'solar-2', name: 'Gujarat Beta', capacity: 120, lat: 23.2, lon: 72.6 },
  { id: 'solar-3', name: 'Tamil Nadu Gamma', capacity: 100, lat: 11.1, lon: 78.7 },
  { id: 'solar-4', name: 'Karnataka Delta', capacity: 80, lat: 15.3, lon: 75.7 },
  { id: 'solar-5', name: 'Madhya Pradesh Epsilon', capacity: 130, lat: 23.5, lon: 77.4 },
];

export const WIND_FARMS = [
  { id: 'wind-1', name: 'Jaisalmer Vortex', capacity: 200, lat: 26.9, lon: 70.9 },
  { id: 'wind-2', name: 'Kutch Cyclone', capacity: 160, lat: 23.8, lon: 69.7 },
  { id: 'wind-3', name: 'Kanyakumari Gale', capacity: 140, lat: 8.1, lon: 77.5 },
];

export const BATTERIES = [
  { id: 'bess-1', name: 'BESS North', capacityMWh: 400, maxChargeMW: 100, maxDischargeMW: 100, efficiency: 0.92, degradationPerCycle: 0.00005 },
  { id: 'bess-2', name: 'BESS South', capacityMWh: 300, maxChargeMW: 80, maxDischargeMW: 80, efficiency: 0.90, degradationPerCycle: 0.00006 },
];

export const GRID = {
  maxImportMW: 500,
  maxExportMW: 400,
  transmissionLines: [
    { id: 'tl-north', name: 'Northern Corridor', capacityMW: 300 },
    { id: 'tl-south', name: 'Southern Link', capacityMW: 250 },
    { id: 'tl-east', name: 'Eastern Backbone', capacityMW: 200 },
  ],
  frequencyTarget: 50.0,
  frequencyTolerance: 0.5,
};

export const CONSUMERS = [
  { id: 'ind-1', name: 'Steel Manufacturing', baseDemand: 120, flexibility: 0.15, priority: 'high' },
  { id: 'ind-2', name: 'Data Center', baseDemand: 80, flexibility: 0.05, priority: 'critical' },
  { id: 'ind-3', name: 'Textile Mill', baseDemand: 60, flexibility: 0.30, priority: 'medium' },
  { id: 'ind-4', name: 'Chemical Plant', baseDemand: 90, flexibility: 0.10, priority: 'high' },
  { id: 'com-1', name: 'City District', baseDemand: 200, flexibility: 0.20, priority: 'medium' },
];

export const MARKET = {
  basePricePerMWh: 4500,
  carbonPricePerTon: 1200,
  demandResponseIncentive: 800,
  peakHours: [9, 10, 11, 12, 17, 18, 19, 20],
  offPeakDiscount: 0.6,
};
