// Steady-state design calculations and psychrometric helpers.
import { ENVELOPE, POD_ENVELOPE, AIR, HEATER, AC, acCapacityW, PEOPLE, VENT_RATES } from '../data/climate.js';

/** Saturation vapour pressure (Pa) — Magnus formula. */
export function psat(T) {
  return 610.94 * Math.exp((17.625 * T) / (T + 243.04));
}

/** Humidity ratio (g water / kg dry air) from T (°C) and RH (%). */
export function humidityRatio(T, rh) {
  const pv = (psat(T) * rh) / 100;
  return 622 * pv / (101325 - pv);
}

/** RH (%) from T and humidity ratio (g/kg). */
export function relHumidity(T, x) {
  const pv = (x * 101325) / (622 + x);
  return Math.min(100, (100 * pv) / psat(T));
}

/** Dew point (°C) from T and RH. */
export function dewPoint(T, rh) {
  const g = Math.log(Math.max(rh, 1) / 100) + (17.625 * T) / (243.04 + T);
  return (243.04 * g) / (17.625 - g);
}

/** Envelope conductance breakdown (W/K). covers: 0‥1, podOut: boolean. */
export function envelopeUA({ covers = 0, podOut = false } = {}) {
  const items = ENVELOPE.map((e) => {
    const U = e.glass ? e.U * (1 - covers) + e.Ucov * covers : e.U;
    return { id: e.id, name: e.name, area: e.area, U, UA: e.area * U, glass: !!e.glass };
  });
  if (podOut) items.push({ id: 'pod', name: POD_ENVELOPE.name, area: POD_ENVELOPE.area, U: POD_ENVELOPE.U, UA: POD_ENVELOPE.area * POD_ENVELOPE.U });
  const total = items.reduce((s, i) => s + i.UA, 0);
  return { items, total };
}

export function infiltrationWK() {
  return (AIR.rhoCp * AIR.infiltrationACH * AIR.volumeM3) / 3600;
}

export function ventWK(m3h) {
  return (AIR.rhoCp * m3h) / 3600;
}

/** Solar gains (W) for a global horizontal irradiance, window-cover fraction and sun altitude factor. */
export function solarGains(ghi, covers = 0) {
  let opaque = 0;
  let glass = 0;
  const ho = 20; // exterior film coefficient W/m²K
  for (const e of ENVELOPE) {
    if (e.glass) {
      const shgc = e.shgc * (1 - covers) + e.shgcCov * covers;
      const irr = e.orient === 'front' ? 0.5 * ghi : 0.35 * ghi; // vertical-surface share (one side sunlit)
      glass += shgc * e.area * irr;
    } else if (e.alpha) {
      const irr = e.orient === 'roof' ? ghi : 0.5 * ghi * (e.orient === 'side' ? 0.5 : 0.6);
      opaque += (e.alpha * irr * e.area * e.U) / ho;
    }
  }
  return { opaque, glass, total: opaque + glass };
}

/** Night ventilation needed to hold CO₂ at a target (ppm) for n sleeping occupants. */
export function ventForCO2(n = 2, targetPpm = 1000, outdoorPpm = 420, state = 'sleep') {
  const gen = (n * PEOPLE.co2Lph[state]) / 1000; // m³/h
  return gen / ((targetPpm - outdoorPpm) * 1e-6);
}

export function steadyCO2(n, m3h, state = 'sleep', outdoorPpm = 420) {
  const gen = (n * PEOPLE.co2Lph[state]) / 1000;
  return outdoorPpm + (gen / Math.max(m3h, 0.1)) * 1e6;
}

/** Design-day heat loss (W). */
export function designHeatLoss({ Tout = -20, Tin = 20, covers = 1, podOut = false, ventM3h = 45 } = {}) {
  const ua = envelopeUA({ covers, podOut });
  const dT = Tin - Tout;
  const cond = ua.total * dT;
  const inf = infiltrationWK() * dT;
  const vent = ventWK(ventM3h) * dT;
  const total = cond + inf + vent;
  return { dT, UA: ua.total, ua, cond, inf, vent, total };
}

/** Design-day cooling load (W) at peak sun. */
export function designCoolingLoad({ Tout = 38, Tin = 25, ghi = 950, covers = 1, occupants = 2, ventM3h = 45, rhOut = 40 } = {}) {
  const ua = envelopeUA({ covers });
  const dT = Tout - Tin;
  const cond = ua.total * dT;
  const inf = infiltrationWK() * dT;
  const vent = ventWK(ventM3h) * dT;
  const solar = solarGains(ghi, covers);
  const people = occupants * PEOPLE.sensibleW.rest;
  const equipment = 30 /* fridge */ + 60 /* electronics */ + 10 /* lights */ + 30 /* AC fan, inverter idle */;
  const sensible = cond + inf + vent + solar.total + people + equipment;
  const xo = humidityRatio(Tout, rhOut);
  const xi = humidityRatio(Tin, 50);
  const latentVent = Math.max(0, ((xo - xi) / 1000) * 1.2 * (ventM3h / 3600) * 2.45e6);
  const latentPeople = (occupants * PEOPLE.latentGph.rest * 2450) / 3600;
  const latent = latentVent + latentPeople;
  return { cond, inf, vent, solar, people, equipment, sensible, latent, total: sensible + latent, capacity: acCapacityW(Tout) };
}

export function dieselLph(Wout) {
  // Interpolate Truma Combi D 6 E consumption; below 2 kW the burner cycles (avg 110 mL/h @1 kW)
  if (Wout <= 0) return 0;
  const pts = [[0, 0], [1000, 0.11], [2000, 0.22], [4000, 0.4], [6000, 0.63]];
  for (let i = 1; i < pts.length; i++) {
    if (Wout <= pts[i][0]) {
      const [w0, l0] = pts[i - 1];
      const [w1, l1] = pts[i];
      return l0 + ((l1 - l0) * (Wout - w0)) / (w1 - w0);
    }
  }
  return 0.63;
}

export const HEATER_MAX_W = Math.max(...HEATER.dieselStagesW);
export { AC };

/** Night ventilation provided by the scheduled fans (m³/h). */
export function nightVentM3h() {
  // Inlet fan supplies, bath fan (low) exhausts: exchange = the larger of the two, plus infiltration
  return Math.max(VENT_RATES.freshFan[1], VENT_RATES.fanBath[1]);
}
