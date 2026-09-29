# NEXUS: Multi-Agent Renewable Energy Orchestrator 🌍⚡

Link-> https://nexus-xgjl.onrender.com

> **Built for the ET AI Hackathon 2026 | Powered by Accenture**

NEXUS is an advanced, real-time AI grid orchestrator that leverages a **Multi-Agent System (MAS)** and the **Gemini LLM** to dynamically manage, route, and optimize renewable energy distribution across a simulated national grid. 

## 🏆 Key Features for Judges

### 1. 🤖 7 Autonomous AI Agents (Gemini-Powered)
The core of NEXUS is powered by 7 distinct, specialized AI agents working in tandem. Each agent evaluates telemetry every tick and contributes to a decentralized **Nash Bargaining** resolution to optimize the grid:
- **NEXUS (Chief Orchestrator)**: Balances the priorities of all other agents to maintain global grid stability.
- **HELIOS (Solar Agent)**: Manages solar farm curtailment based on live irradiance and weather data.
- **AEOLUS (Wind Agent)**: Optimizes wind generation and tracks aerodynamic turbulence.
- **VOLTAIC (Battery Fleet)**: Manages BESS (Battery Energy Storage Systems) charge/discharge cycles and predictive degradation.
- **MERCURY (Market Trader)**: Executes P2P energy trading and manages the Carbon Credit ledger.
- **SENTINEL (Grid Security)**: Monitors grid frequency (Hz) and prevents transmission line overloads.
- **ORACLE (Weather Forecaster)**: Ingests live OpenWeatherMap API data to predict anomalies.

### 2. 📍 Personalized Real-Time Telemetry (Dynamic Node Injection)
When a user signs up on the platform and enters their **City and State**, the backend dynamically geocodes the location and injects it as a new **Regional Node (100MW)** into the core simulation. 
- The **OpenWeather API** instantly begins fetching real-time weather, temperature, and cloud cover specifically for the user's city.
- The User Dashboard dynamically adapts to show localized metrics and a personalized **Weather Disruption Heatmap** based solely on the live meteorological conditions of their city.

### 3. 🌪️ Chaos Engineering & Predictive Anomaly Detection
The Admin Dashboard features a **Chaos Engine** capable of injecting real-time disasters into the grid (e.g., *Cyberattacks, Super Cyclones, Solar Eclipses, Transmission Failures*). The Multi-Agent system dynamically reacts to these anomalies in real time, re-routing power and draining batteries to keep the grid online. 

### 4. 📈 Real-Time WebSockets & Interactive Dashboard
The entire simulation runs on a high-frequency backend loop (`server.js`), streaming live telemetry and agent reasoning logs to all connected clients via WebSockets.
- **Admin Control Center**: Inject chaos, monitor agent health, and supervise global generation.
- **User Dashboard**: Monitor localized city weather, historical outage heatmaps, carbon credit ledgers, and interactive grid topology.

---

## 🚀 How to Run the Project (Step-by-Step)

### Step 1: Install Dependencies
Ensure you have Node.js (v18+) installed, then run:
```bash
npm install
```

### Step 2: Configure Environment Variables
Create a `.env` file in the root directory and add the following keys:
```env
# Required for AI Agent Reasoning
GEMINI_API_KEY=your_gemini_api_key_here

# Required for Live Weather Sync & Geocoding
OPENWEATHER_API_KEY=your_openweather_api_key_here
```

### Step 3: Start the NEXUS Server
Launch the backend simulation engine:
```bash
npm start
```
The server will initialize the WebSockets, spin up the 7 AI Agents, and begin the simulation loop.

### Step 4: Access the Dashboards
Open your browser and navigate to:
**`http://localhost:3000`**

1. **Test the Admin Flow (Chaos Engine):**
   - Click "Sign In" and use the default admin credentials: 
     - **Email**: `admin@nexus.energy`
     - **Password**: `admin123`
   - You will be routed to the **Admin Control Center**. Try clicking **"Inject Random Anomaly"** and watch the AI Agents react in real-time to stabilize the grid.

2. **Test the Personalized User Flow (Live Weather):**
   - Log out or open an incognito window.
   - Click **"Sign Up"** and select the **USER** role.
   - Enter your real **City** and **State** (e.g., `Udaipur`, `RJ`).
   - The engine will dynamically ping the OpenWeather API, locate your city, inject a 100MW solar farm into the global grid at your coordinates, and instantly customize your dashboard with your local telemetry and disruption heatmap!

---
*Built with ❤️ for the ET AI Hackathon*
