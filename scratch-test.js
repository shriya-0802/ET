import { Simulation } from './src/engine/simulation.js';
const sim = new Simulation();
try {
  sim.step();
  console.log("Success");
} catch (e) {
  console.error("Simulation failed:", e);
}
