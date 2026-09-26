/**
 * Weather Engine — Real-time weather API integration + procedural fallback
 */
import fetch from 'node-fetch';
import { SOLAR_FARMS, WIND_FARMS } from './config.js';

export class WeatherEngine {
  constructor() {
    this.seed = Math.random() * 1000;
    this.stormActive = false;
    this.stormStart = -1;
    this.stormDuration = 0;
    
    // Live data cache per farm
    this.liveData = {
      solar: SOLAR_FARMS.map(() => ({ temp: 28, clouds: 0, desc: 'Sunny' })),
      wind: WIND_FARMS.map(() => ({ temp: 28, speed: 8, desc: 'Breezy' })),
      lastUpdate: 0
    };
    
    this.apiKey = process.env.OPENWEATHER_API_KEY;
    this.useLiveData = !!this.apiKey;
    
    if (this.useLiveData) {
      console.log('☁️ WeatherEngine: Live data enabled via OpenWeather API');
      this.fetchLiveData();
      setInterval(() => this.fetchLiveData(), 10 * 60 * 1000); // 10 mins
    }
  }

  async fetchLiveData() {
    if (!this.apiKey) return;
    try {
      // Fetch for all solar farms
      for (let i = 0; i < SOLAR_FARMS.length; i++) {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${SOLAR_FARMS[i].lat}&lon=${SOLAR_FARMS[i].lon}&appid=${this.apiKey}&units=metric`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          this.liveData.solar[i] = {
            temp: data.main.temp,
            clouds: data.clouds.all / 100,
            desc: data.weather[0].main
          };
        } else {
          const err = await res.text();
          throw new Error(err);
        }
      }
      
      // Fetch for all wind farms
      for (let i = 0; i < WIND_FARMS.length; i++) {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${WIND_FARMS[i].lat}&lon=${WIND_FARMS[i].lon}&appid=${this.apiKey}&units=metric`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          this.liveData.wind[i] = {
            temp: data.main.temp,
            speed: data.wind.speed,
            desc: data.weather[0].main
          };
        }
      }
      
      this.liveData.lastUpdate = Date.now();
      console.log(`✅ Real-time weather synchronized across ${SOLAR_FARMS.length + WIND_FARMS.length} geographical nodes.`);
    } catch (e) {
      console.error('⚠️ Weather API failed, falling back to procedural:', e.message);
    }
  }

  smoothNoise(t, frequency = 1, offset = 0) {
    const x = (t + offset) * frequency;
    return Math.sin(x * 0.7 + this.seed) * 0.4 + Math.sin(x * 1.3 + this.seed * 2.1) * 0.3 +
      Math.sin(x * 2.9 + this.seed * 0.7) * 0.2 + Math.sin(x * 5.1 + this.seed * 1.3) * 0.1;
  }

  getSolarIrradiance(tick, farmIndex = 0) {
    const hour = (tick / 4) % 24;
    let solar = 0;
    if (hour >= 6 && hour <= 18) {
      const normalized = (hour - 6) / 12;
      solar = Math.pow(Math.sin(normalized * Math.PI), 1.2);
    }
    
    const clouds = (this.useLiveData && this.liveData.lastUpdate > 0) 
      ? this.liveData.solar[farmIndex].clouds 
      : this.getProceduralCloudCover(tick, farmIndex);
      
    solar *= (1 - clouds * 0.8);
    
    if (!this.useLiveData || this.liveData.lastUpdate === 0) {
      solar *= 0.9 + this.smoothNoise(tick, 0.05, farmIndex * 100) * 0.2;
    }
    
    if (this.stormActive) solar *= 0.15;
    return Math.max(0, Math.min(1, solar));
  }

  getWindSpeed(tick, farmIndex = 0) {
    let windSpeed = 8;
    if (this.useLiveData && this.liveData.lastUpdate > 0) {
      windSpeed = this.liveData.wind[farmIndex].speed;
      windSpeed += this.smoothNoise(tick, 0.5, farmIndex) * 1.0; // slight variation
    } else {
      const hour = (tick / 4) % 24;
      const diurnal = 8 + 4 * Math.sin((hour - 14) / 24 * Math.PI * 2);
      const turbulence = this.smoothNoise(tick, 0.15, farmIndex * 200 + 500) * 6;
      const gusts = Math.max(0, this.smoothNoise(tick, 0.8, farmIndex * 300) * 4);
      windSpeed = diurnal + turbulence + gusts;
    }
    
    if (this.stormActive) windSpeed += 15 + Math.random() * 10;
    return Math.max(0, Math.min(25, windSpeed));
  }

  getProceduralCloudCover(tick, farmIndex = 0) {
    const base = 0.3 + this.smoothNoise(tick, 0.08, farmIndex * 150 + 700) * 0.4;
    if (this.stormActive) return Math.min(1, base + 0.5);
    return Math.max(0, Math.min(1, base));
  }

  getTemperature(tick, type = 'solar', farmIndex = 0) {
    if (this.useLiveData && this.liveData.lastUpdate > 0) {
      return this.liveData[type][farmIndex].temp + this.smoothNoise(tick, 0.1, farmIndex) * 0.5;
    }
    const hour = (tick / 4) % 24;
    return 28 + 8 * Math.sin((hour - 14) / 24 * Math.PI * 2) + this.smoothNoise(tick, 0.03, farmIndex) * 4;
  }

  triggerStorm(tick, duration = 8) {
    this.stormActive = true;
    this.stormStart = tick;
    this.stormDuration = duration;
  }

  updateStorm(tick) {
    if (this.stormActive && tick - this.stormStart >= this.stormDuration) this.stormActive = false;
  }

  getWeatherState(tick) {
    this.updateStorm(tick);
    
    const solarNodes = SOLAR_FARMS.map((f, i) => ({
      name: f.name,
      temp: this.getTemperature(tick, 'solar', i),
      clouds: (this.useLiveData && this.liveData.lastUpdate > 0) ? this.liveData.solar[i].clouds : this.getProceduralCloudCover(tick, i),
      irradiance: this.getSolarIrradiance(tick, i),
      desc: (this.useLiveData && this.liveData.lastUpdate > 0) ? this.liveData.solar[i].desc : (this.stormActive ? 'Storm' : 'Clear')
    }));

    const windNodes = WIND_FARMS.map((f, i) => ({
      name: f.name,
      temp: this.getTemperature(tick, 'wind', i),
      speed: this.getWindSpeed(tick, i),
      desc: (this.useLiveData && this.liveData.lastUpdate > 0) ? this.liveData.wind[i].desc : (this.stormActive ? 'Storm' : 'Breezy')
    }));

    return {
      solarNodes,
      windNodes,
      stormActive: this.stormActive,
      usingLiveData: this.useLiveData && this.liveData.lastUpdate > 0,
      temperature: solarNodes[0].temp, // global average proxy
      cloudCover: solarNodes[0].clouds
    };
  }
}
