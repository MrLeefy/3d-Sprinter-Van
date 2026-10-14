// Coupled time-step model of the camper: heat, moisture, CO₂, electrical power,
// water and diesel. Used by the live dashboard, Daily-living mode and the
// 24-hour / multi-day resource simulation.
import { BANK, INVERTER, SOURCES, LOADS, loadById } from '../data/electrical.js';
import { AIR, HEATER, AC, acCapacityW, acCOP, heatPumpCOP, PEOPLE, VENT_RATES } from '../data/climate.js';
import { WATER } from '../data/plumbing.js';
import { VAN } from '../data/vehicle.js';
import { weatherAt, scheduleAt } from '../data/scenarios.js';
import { envelopeUA, infiltrationWK, ventWK, solarGains, humidityRatio, relHumidity, dewPoint, dieselLph } from './thermal.js';

export const CATEGORIES = {
  hvac: 'Heating & cooling',
  cooking: 'Cooking',
  fridge: 'Refrigeration',
  vent: 'Ventilation',
  lights: 'Lighting',
  devices: 'Devices & internet',
  water: 'Water pump & tank heat',
  base: 'Standby & monitoring',
  losses: 'Inverter losses',
};

const CAT_OF = {
  ac: 'hvac', heater: 'hvac', heaterElec: 'hvac', heatPump: 'hvac', greyHeat: 'water',
  induction: 'cooking', microwave: 'cooking', hood: 'cooking',
  fridge: 'fridge', fanMain: 'vent', fanBath: 'vent', freshFan: 'vent', toiletFan: 'vent',
  lights: 'lights', usb: 'devices', starlink: 'devices', outlets: 'devices', pump: 'water', monitor: 'base', slideout: 'base',
};

export function defaultControls() {
  return {
    climate: { mode: 'auto', heatDay: 20, heatNight: 16, coolDay: 25, coolNight: 23, heaterSource: 'diesel', quietNight: true, autoVent: true },
    covers: null, // null → follow scenario policy
    shore: { connected: false, limitA: 15 },
    driving: false,
    solar: true,
    heatPumpInstalled: false,
    useSchedule: true,
    manualLoads: {}, // id → level index (overrides schedule)
    occupants: 2,
    boondock: null, // Boondocking site ratings: { solarExposure, windShelter, levelness }
  };
}

export function initialState(opts = {}) {
  return {
    t: opts.startHour ?? 8, // hours since midnight of day 0
    soc: opts.soc ?? 0.9,
    Tin: opts.Tin ?? 20,
    x: opts.x ?? 7.5, // g/kg
    co2: 650,
    freshL: WATER.freshUsableL,
    boilerT: 55,
    greyL: 0,
    urineL: 0,
    solidsUses: 0,
    fuelL: VAN.fuelTank.v * 0.75,
    dieselHeaterL: 0,
    condensateL: 0,
    acOn: false,
    heatOn: false,
    lastActivity: null,
    activityStart: 0,
    acc: { solarWh: 0, altWh: 0, shoreWh: 0, loadWh: 0, byCat: Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0])), waterL: 0, dieselL: 0 },
    events: [],
    flags: {},
  };
}

function isNight(h) {
  return h >= 22.5 || h < 6.5;
}

function levelW(id, idx) {
  const l = loadById[id];
  if (!l) return 0;
  const lev = l.levels[Math.min(idx, l.levels.length - 1)];
  return typeof lev.w === 'number' ? lev.w : 0;
}

function batteryVoltage(soc, amps) {
  // LiFePO4 rest curve (flat ~13.2 V) with ~3 mΩ bank resistance
  const rest = soc < 0.1 ? 12.0 + soc * 9 : soc > 0.95 ? 13.35 + (soc - 0.95) * 4 : 13.0 + (soc - 0.1) * 0.35 / 0.85;
  return rest + amps * 0.003;
}

/**
 * Advance the model by dt seconds.
 * @returns snapshot of instantaneous flows for dashboards
 */
export function step(state, scn, ctrl, dt = 60) {
  const day = Math.floor(state.t / 24);
  const hour = state.t - day * 24;
  const wx = scn.wxDirect || weatherAt(scn, day, hour);
  const night = isNight(hour);
  const act = ctrl.useSchedule ? (scn.schDirect !== undefined ? scn.schDirect : scheduleAt(hour)) : null;
  const driveH = scn.driveHours ? scn.driveHours[Math.min(day, scn.driveHours.length - 1)] || 0 : 0;
  const driving = ctrl.driving || (ctrl.useSchedule && driveH > 0 && hour >= 13 && hour < 13 + driveH);
  const occ = act ? (driving ? 2 : act.occ) * (ctrl.occupants / 2) : ctrl.occupants;
  const metab = act ? act.metab : night ? 'sleep' : 'rest';

  // Track activity transitions (for one-off water draws & events)
  if (act && state.lastActivity !== act.id + day) {
    state.lastActivity = act.id + day;
    state.activityStart = state.t;
  }

  // ── Loads requested ───────────────────────────────────────────
  const lv = {};
  for (const l of LOADS) lv[l.id] = 0;
  lv.monitor = 0;
  lv.fridge = 1;
  lv.toiletFan = 1;
  lv.greyHeat = 1;
  lv.heater = 1;
  if (act && !driving) Object.assign(lv, act.loads);
  if (ctrl.useSchedule && act && act.id === 'away') lv.lights = 0;
  for (const [k, v] of Object.entries(ctrl.manualLoads || {})) if (v !== null && v !== undefined) lv[k] = v;
  if (!ctrl.heatPumpInstalled) lv.heatPump = 0;

  // Window covers
  const coverPolicy = scn.climate?.covers || 'night';
  let covers = ctrl.covers;
  if (covers === null || covers === undefined) {
    if (driving) covers = 0;
    else if (coverPolicy === 'always') covers = 1;
    else if (coverPolicy === 'reflective-day') covers = night || (wx.ghi > 150 && act?.id !== 'cook') ? 1 : 0;
    else covers = night || act?.id === 'away' ? 1 : 0;
  }
  const podOut = ctrl.podOut ?? (act ? (act.acts?.slideOut ?? (night ? 1 : 0)) > 0.5 && !driving : false);

  // ── Ventilation ───────────────────────────────────────────────
  const cl = ctrl.climate;
  if (cl.autoVent && !driving) {
    if (state.co2 > 1100 && lv.freshFan < 2) lv.freshFan = 2;
    else if (state.co2 > 850 && lv.freshFan < 1) lv.freshFan = 1;
    const rhIn = relHumidity(state.Tin, state.x);
    if (rhIn > 65 && occ > 0 && lv.fanMain < 1 && humidityRatio(wx.T, wx.rh) < state.x) lv.fanMain = 1;
    if (act?.shower && lv.fanBath < 3) lv.fanBath = 3;
    if (act?.cooking && lv.hood < 1) lv.hood = 1;
  }
  if (cl.mode === 'vent' && lv.fanMain < 2) lv.fanMain = 2;
  const exhaust = VENT_RATES.fanMain[lv.fanMain] + VENT_RATES.fanBath[lv.fanBath] + VENT_RATES.hood[lv.hood];
  const supply = VENT_RATES.freshFan[lv.freshFan];
  // ── Boondocking site characteristics (solar exposure, wind shelter, levelness) ─
  const boondock = ctrl.boondock || ctrl.campSpot || ctrl.site || state.boondock || null;
  const solarFactor = boondock != null ? Math.max(0, Math.min(1, boondock.solarExposure ?? boondock.solarRating ?? 1)) : 1;
  const windShelterFactor = boondock != null ? Math.max(0, Math.min(1, boondock.windShelter ?? boondock.windRating ?? 0)) : 0;
  const levelnessVal = boondock != null ? Math.max(0, Math.min(1, boondock.levelness ?? boondock.levelnessRating ?? 1)) : 1;
  const effectiveWind = wx.wind * (1 - 0.7 * windShelterFactor);

  // An open sliding or rear door exchanges roughly 500–900 m³/h depending on wind
  const doorM3h = (ctrl.doorsOpen || 0) * (500 + 80 * effectiveWind);
  const ventM3h = Math.max(exhaust, supply) + (driving ? 60 : 0) + doorM3h;
  const infM3h = AIR.infiltrationACH * AIR.volumeM3 * (1 + effectiveWind * 0.05);
  const totalAir = ventM3h + infM3h;

  // ── Thermal balance ───────────────────────────────────────────
  const ua = envelopeUA({ covers, podOut }).total;
  const Qcond = ua * (wx.T - state.Tin);
  const Qair = ventWK(totalAir) * (wx.T - state.Tin);
  const sol = solarGains(wx.ghi * solarFactor, covers);
  const peopleW = occ * PEOPLE.sensibleW[metab];

  // Requested load powers before climate control
  const req = {};
  for (const l of LOADS) req[l.id] = levelW(l.id, lv[l.id]);
  req.monitor = 6;
  const tiltFridgeMult = levelnessVal < 0.7 ? 1 + 0.25 * ((0.7 - levelnessVal) / 0.7) : 1;
  req.fridge = lv.fridge ? (18 * (1 + 0.035 * (state.Tin - 25)) + (state.Tin > 30 ? 4 : 0)) * tiltFridgeMult : 0;
  req.greyHeat = wx.T < 2 && lv.greyHeat ? Math.min(60, 60 * (0.25 + 0.035 * (2 - wx.T))) : 0;
  req.pump = 0; // computed from water draw

  // Water draw this step (litres) — activity volume spread over its duration
  let drawL = 0;
  let hotL = 0;
  let showerToday = true;
  if (act?.shower) showerToday = day % (WATER.showerEveryDays || 1) === 0;
  if (act?.water && occ > 0 && !driving) {
    let litres = Object.values(act.water).reduce((a, b) => a + b, 0) * (ctrl.occupants / 2);
    if (act.shower && !showerToday) litres = 0;
    const dur = (act.end - act.t) * 3600;
    drawL = (litres * dt) / dur;
    hotL = drawL * (act.hotFrac || 0.3);
  }
  // Drinking / cooking consumption that does not reach grey (spread over waking hours)
  const drinkL = occ > 0 && !night ? (WATER.uses.drinkCook * (ctrl.occupants / 2) * dt) / (16 * 3600) : 0;
  let waterOk = true;
  if (state.freshL <= 0.1) {
    waterOk = false;
    drawL = 0;
    hotL = 0;
  }
  if (state.greyL >= WATER.greyL - 0.1) {
    drawL = 0; // cannot drain → activities stop using water
    hotL = 0;
  }
  if (drawL > 0) req.pump = 80 * Math.min(1, drawL / ((WATER.faucetLpm * dt) / 60) + 0.15);

  // Internal heat from equipment (W): electrical use that ends up as heat inside
  const hoodCapture = lv.hood ? 0.55 : 0;
  const cookHeat = (req.induction * 0.85 + req.microwave * 0.9) * (1 - hoodCapture);
  const equipHeat = req.fridge + req.lights + req.usb + req.starlink + req.outlets * 0.9 + req.monitor + cookHeat + 15;

  // Climate control setpoints
  // Away setback, but pre-condition the cabin for the last 45 min before people return
  const away = occ === 0 && !driving && (!act || act.end - hour > 0.75);
  const heatSP = away ? Math.min(cl.heatNight, 12) : night ? cl.heatNight : cl.heatDay;
  const coolSP = away ? Math.max(cl.coolDay, 33) : night ? cl.coolNight : cl.coolDay;
  const C = AIR.thermalMassJK;
  const passive = Qcond + Qair + sol.total + peopleW + equipHeat; // W into the cabin
  const shed = state.soc <= BANK.shedSoc && !ctrl.shore.connected;
  const dead = state.soc <= BANK.minSoc && !ctrl.shore.connected && !driving;

  // Heating
  let Qheat = 0;
  let heaterDcW = 0;
  let heaterAcW = 0;
  let heatPumpW = 0;
  let dieselLh = 0;
  const heatMode = (cl.mode === 'auto' || cl.mode === 'heat') && !driving;
  const fuelAvail = state.fuelL > VAN.fuelTank.v * 0.25; // standpipe
  if (heatMode && !dead) {
    if (state.Tin < heatSP - 0.3 || (passive < -150 && state.Tin < heatSP + 0.1)) state.heatOn = true;
    if (state.Tin > heatSP + 0.4) state.heatOn = false;
    if (state.heatOn) {
      const need = Math.max(0, -passive + ((heatSP + 0.3 - state.Tin) * C) / 900);
      let src = cl.heaterSource;
      if (src === 'heatpump' && (!ctrl.heatPumpInstalled || heatPumpCOP(wx.T) === 0 || shed)) src = 'diesel';
      if (src === 'electric' && !ctrl.shore.connected && state.soc < 0.5) src = 'diesel';
      if (src === 'diesel' && (!fuelAvail || lv.heater === 0)) src = ctrl.shore.connected ? 'electric' : 'none';
      if (src === 'diesel') {
        Qheat = Math.min(need, HEATER.dieselStagesW[2] * (night ? 0.67 : 1));
        Qheat = Math.max(Qheat, need > 0 ? 400 : 0);
        dieselLh = dieselLph(Qheat);
        heaterDcW = Qheat > 4000 ? 48 : 30;
      } else if (src === 'electric') {
        const cap = ctrl.shore.connected && ctrl.shore.limitA >= 20 ? 1800 : 900;
        Qheat = Math.min(need, cap);
        heaterAcW = Qheat > 900 ? 1800 : Qheat > 0 ? 900 : 0;
        Qheat = Math.min(need, heaterAcW);
        heaterDcW = 12;
      } else if (src === 'heatpump') {
        const cop = heatPumpCOP(wx.T);
        Qheat = Math.min(need, 1900 * Math.min(1, 0.6 + wx.T * 0.02 + 0.4));
        heatPumpW = Qheat / cop;
      }
    }
  } else state.heatOn = false;

  // Boiler (hot water) — Combi heats water when below 50 °C (diesel 2 kW or electric 900 W)
  const boilerMass = WATER.boilerL;
  let boilerHeatW = 0;
  if (hotL > 0) state.boilerT = (state.boilerT * (boilerMass - hotL) + WATER.coldInletC * hotL) / boilerMass;
  // Standby loss of the boiler (~25 W) warms the garage
  const boilerLoss = 0.0025 * (state.boilerT - state.Tin) * 10;
  state.boilerT -= (boilerLoss * dt) / (boilerMass * 4186);
  if (!dead && !driving && state.boilerT < 50 && (fuelAvail || ctrl.shore.connected)) {
    boilerHeatW = fuelAvail ? 2000 : 900;
    if (fuelAvail) {
      dieselLh += 0.22 * (Qheat > 0 ? 0.6 : 1);
      heaterDcW = Math.max(heaterDcW, 30);
    } else heaterAcW = Math.max(heaterAcW, 900);
    state.boilerT = Math.min(62, state.boilerT + (boilerHeatW * 0.9 * dt) / (boilerMass * 4186));
  }

  // Cooling
  let Qcool = 0;
  let acW = 0;
  const coolMode = (cl.mode === 'auto' || cl.mode === 'cool') && !driving;
  const acLevel = lv.ac; // 0 off, 1 quiet, 2 auto, 3 max
  const acAllowed = wx.T >= AC.ambientMinC && !shed && !dead;
  if (acAllowed && (acLevel > 0 || (coolMode && cl.mode !== 'heat'))) {
    const autoMode = acLevel === 2 || (acLevel === 0 && coolMode);
    if (autoMode) {
      if (state.Tin > coolSP + 0.5 || (passive > 150 && state.Tin > coolSP - 0.1)) state.acOn = true;
      if (state.Tin < coolSP - 0.5) state.acOn = false;
    } else state.acOn = acLevel > 0;
    if (state.acOn) {
      let cap = acCapacityW(wx.T);
      if (acLevel === 1 || (night && cl.quietNight && autoMode)) cap *= AC.quietMaxFrac;
      const needCool = Math.max(0, passive + ((state.Tin - (coolSP - 0.5)) * C) / 900);
      Qcool = acLevel === 3 ? cap : Math.min(cap, Math.max(needCool, 0.35 * cap));
      acW = Math.max(AC.minElecW, Qcool / acCOP(wx.T));
      if (acLevel === 3) acW = AC.maxElecW;
      if (acLevel === 1) acW = Math.min(acW, 250 + 150);
    }
  } else state.acOn = false;

  const Qnet = passive + Qheat - Qcool;
  state.Tin += (Qnet * dt) / C;

  // ── Moisture & CO₂ ───────────────────────────────────────────
  const airMass = AIR.volumeM3 * 1.2 * 4; // ×4: hygroscopic buffering of linings & textiles
  const xo = humidityRatio(wx.T, wx.rh);
  let moistG = occ * PEOPLE.latentGph[metab] * (dt / 3600);
  if (act?.moistureG && occ > 0) {
    const capture = act.cooking ? (lv.hood ? 0.65 : 0) : act.shower ? (lv.fanBath >= 2 ? 0.75 : 0.2) : 0;
    const factor = act.shower && !showerToday ? 0 : 1;
    moistG += (factor * act.moistureG * (1 - capture) * dt) / ((act.end - act.t) * 3600);
  }
  const ventKgS = (totalAir / 3600) * 1.2;
  let condensG = 0;
  if (Qcool > 0) {
    const latentW = (Qcool * (1 - AC.shr)) / AC.shr;
    const coilX = humidityRatio(11, 95); // saturated coil surface ≈ 11 °C
    const eff = Math.max(0, Math.min(1, (state.x - coilX) / 3));
    condensG = ((latentW * eff) / 2.45e6) * 1000 * dt;
  }
  state.x += (moistG - (state.x - xo) * ventKgS * dt - condensG) / airMass;
  state.x = Math.max(0.5, state.x);
  state.condensateL += condensG / 1000;
  const co2Gen = (occ * PEOPLE.co2Lph[metab]) / 1000; // m³/h
  state.co2 += ((co2Gen * 1e6 - totalAir * (state.co2 - 420)) / AIR.volumeM3) * (dt / 3600);
  state.co2 = Math.max(420, state.co2);

  // ── Electrical ───────────────────────────────────────────────
  req.ac = acW;
  req.heater = heaterDcW;
  req.heaterElec = heaterAcW;
  req.heatPump = heatPumpW;
  // Load management on the AC bus
  if (req.microwave > 0) req.induction = Math.min(req.induction, 600);
  if (req.outlets >= 1200) { req.induction = Math.min(req.induction, 1200); req.microwave = 0; }
  if (shed) { req.induction = 0; req.microwave = 0; req.outlets = Math.min(req.outlets, 300); }
  if (dead) for (const k of Object.keys(req)) req[k] = 0;

  let dcW = 0;
  let acBusW = 0;
  const byLoad = {};
  for (const l of LOADS) {
    const w = req[l.id] || 0;
    byLoad[l.id] = w;
    if (l.bus === 'dc') dcW += w;
    else acBusW += w;
  }
  const garageT = state.Tin + 3;
  const invCont = garageT > 40 ? INVERTER.continuousW40 : INVERTER.continuousW25;
  let invOut = 0;
  let shoreToLoads = 0;
  let shoreCharge = 0;
  if (ctrl.shore.connected) {
    const shoreMax = ctrl.shore.limitA * 120;
    shoreToLoads = Math.min(acBusW, shoreMax);
    invOut = acBusW - shoreToLoads; // PowerAssist
    shoreCharge = Math.min(INVERTER.chargerA * 14.2, Math.max(0, shoreMax - shoreToLoads) * 0.94) * (state.soc > 0.97 ? 0.15 : 1);
  } else invOut = acBusW;
  // Inverter idles in search mode (≈ 4 W) when nothing on the AC bus is drawing
  const invIdle = dead ? 0 : invOut > 0 ? INVERTER.idleW : 4;
  const invIn = invOut > 0 ? invOut / INVERTER.efficiency + invIdle : invIdle;
  const overload = invOut > invCont;
  const trip = invOut > INVERTER.peakW;

  // Sources
  let solarW = 0;
  if (ctrl.solar && wx.ghi > 0) {
    const effGhi = wx.ghi * solarFactor;
    const Tcell = wx.T + 0.03 * effGhi;
    solarW = SOURCES.solar.wp * (effGhi / 1000) * SOURCES.solar.derate * (1 - 0.004 * Math.max(0, Tcell - 25));
    solarW = Math.min(solarW, SOURCES.solar.mpptMaxA * 14.0);
    if (scn.weather[Math.min(day, scn.weather.length - 1)].snow > 0.3 && hour < 11) solarW *= 0.2; // snow on panels until cleared
  }
  const altW = driving ? SOURCES.alternator.chargers * SOURCES.alternator.ampsEach * SOURCES.alternator.v * (state.soc > 0.95 ? 0.2 : 1) : 0;
  let chargeW = solarW + altW + shoreCharge;
  const loadW = dcW + invIn;
  let batW = chargeW - loadW;
  if (state.soc >= 0.999 && batW > 0) {
    // Battery full: chargers throttle back to the load
    const curtail = batW;
    chargeW -= curtail;
    solarW = Math.max(0, solarW - curtail);
    batW = 0;
  }
  const V = batteryVoltage(state.soc, batW / 13);
  const batA = batW / V;
  state.soc += ((batW > 0 ? batW * BANK.chargeEff : batW) * dt) / 3600 / BANK.capacityWh;
  state.soc = Math.max(0, Math.min(1, state.soc));

  // Water bookkeeping
  const used = drawL + drinkL;
  state.freshL = Math.max(0, state.freshL - used);
  state.greyL = Math.min(WATER.greyL, state.greyL + drawL);
  state.urineL = Math.min(WATER.urineL, state.urineL + (occ * 1.0 * dt) / 86400); // ~1.0 L/person/day used in-van
  state.solidsUses += (occ * 0.5 * dt) / 86400;
  state.dieselHeaterL += (dieselLh * dt) / 3600;
  // Driving fuel: a fixed 70 km/h cruise, or the live speed from drive mode (idle ≈ 0.9 L/h, ≈ 12 L/100 km at 70–100 km/h)
  const kmh = ctrl.driveKmh;
  const driveLph = kmh == null ? (11.5 / 100) * 70 : 0.9 + 0.095 * kmh + 0.0002 * kmh * kmh;
  // driveFuelScale compresses distance in the drive game (settlements are ~2 km apart, not ~60 km)
  state.fuelL -= (dieselLh * dt) / 3600 + (driving ? driveLph * (ctrl.driveFuelScale ?? 1) * (dt / 3600) : 0);

  // Accumulators
  const h = dt / 3600;
  const A = state.acc;
  A.solarWh += solarW * h;
  A.altWh += altW * h;
  A.shoreWh += (shoreCharge + shoreToLoads) * h;
  A.loadWh += loadW * h;
  for (const [id, w] of Object.entries(byLoad)) {
    const l = loadById[id];
    const cat = CAT_OF[id] || 'base';
    A.byCat[cat] += (l.bus === 'ac' ? (Math.max(0, w - (ctrl.shore.connected ? w : 0)) / INVERTER.efficiency) : w) * h;
  }
  A.byCat.losses += (invOut > 0 ? invOut / INVERTER.efficiency - invOut + invIdle : invIdle) * h;
  A.waterL += used;
  A.dieselL += (dieselLh * dt) / 3600;

  state.t += dt / 3600;

  const rhIn = relHumidity(state.Tin, state.x);
  const glassT = covers > 0.5 ? state.Tin - (state.Tin - wx.T) * 0.55 : state.Tin - (state.Tin - wx.T) * (5.7 / 8);
  const dp = dewPoint(state.Tin, rhIn);
  const freezeRisk = wx.T < -25 || (wx.T < 0 && (dead || req.greyHeat === 0) && state.greyL > 5) || state.Tin < 2;

  return {
    hour, day, wx, act, driving, occ, covers, podOut,
    Tin: state.Tin, rhIn, co2: state.co2, dewPoint: dp, glassT, condensation: glassT < dp,
    Qcond, Qair, Qsolar: sol.total, Qpeople: peopleW, Qequip: equipHeat, Qheat, Qcool, ventM3h: totalAir,
    heatSP, coolSP, dieselLh, heaterSource: cl.heaterSource,
    solarW, altW, shoreCharge, shoreToLoads, dcW, acBusW, invIn, invOut, invCont, overload, trip, loadW, batW, batA, V,
    soc: state.soc, shed, dead, byLoad, levels: lv,
    freshL: state.freshL, greyL: state.greyL, boilerT: state.boilerT, urineL: state.urineL, waterOk, drawL, freezeRisk,
    peakDcA: (dcW + invIn) / V,
    boondock: boondock ? { ...boondock, solarExposure: solarFactor, windShelter: windShelterFactor, levelness: levelnessVal } : null,
    effectiveWind,
    levelness: levelnessVal,
    unlevel: levelnessVal < 0.65,
  };
}

/** Run a scenario for N days, sampling every `sampleMin` minutes. */
export function runScenario(scn, ctrlOverrides = {}, { days = scn.days, dt = 60, sampleMin = 10, startHour = scn.startHour ?? 0, init = {} } = {}) {
  const ctrl = { ...defaultControls(), ...ctrlOverrides, climate: { ...defaultControls().climate, ...(scn.climate || {}), ...(ctrlOverrides.climate || {}) } };
  const w0 = weatherAt(scn, 0, startHour);
  const night0 = isNight(startHour);
  const lo = night0 ? ctrl.climate.heatNight : ctrl.climate.heatDay;
  const hi = night0 ? ctrl.climate.coolNight : ctrl.climate.coolDay;
  const state = initialState({ startHour, soc: 0.95, Tin: Math.min(hi, Math.max(lo, w0.T)), x: Math.min(humidityRatio(w0.T, w0.rh), 12), ...init });
  const steps = Math.round((days * 24 * 3600) / dt);
  const every = Math.max(1, Math.round((sampleMin * 60) / dt));
  const samples = [];
  const limits = {};
  let minSoc = state.soc;
  let maxCO2 = 0;
  let minT = 99;
  let maxT = -99;
  let overloadMin = 0;
  let condMin = 0;
  const start = state.t;
  for (let i = 0; i < steps; i++) {
    const s = step(state, scn, ctrl, dt);
    const tRel = state.t - start;
    minSoc = Math.min(minSoc, s.soc);
    if (s.occ > 0) {
      maxCO2 = Math.max(maxCO2, s.co2);
      minT = Math.min(minT, s.Tin);
      maxT = Math.max(maxT, s.Tin);
    }
    if (s.overload) overloadMin += dt / 60;
    if (s.condensation && s.occ > 0) condMin += dt / 60;
    if (!limits.battery && s.soc <= BANK.shedSoc) limits.battery = tRel;
    if (!limits.fresh && s.freshL <= 1) limits.fresh = tRel;
    if (!limits.grey && s.greyL >= WATER.greyL - 1) limits.grey = tRel;
    if (!limits.urine && state.urineL >= WATER.urineL - 0.05) limits.urine = tRel;
    if (!limits.solids && state.solidsUses >= WATER.solidsUses) limits.solids = tRel;
    if (!limits.fuel && state.fuelL <= VAN.fuelTank.v * 0.25) limits.fuel = tRel;
    if (i % every === 0) {
      samples.push({
        t: tRel, hour: s.hour, day: s.day, soc: s.soc, Tin: s.Tin, Tout: s.wx.T, rh: s.rhIn, co2: s.co2,
        solarW: s.solarW, altW: s.altW, loadW: s.loadW, acW: s.byLoad.ac, heatW: s.Qheat, coolW: s.Qcool,
        fresh: s.freshL, grey: s.greyL, boilerT: s.boilerT, diesel: state.dieselHeaterL, act: s.act?.id, ghi: s.wx.ghi,
      });
    }
  }
  const A = state.acc;
  const nd = days;
  return {
    scenario: scn.id, days, samples, ctrl,
    perDay: {
      solarWh: A.solarWh / nd, altWh: A.altWh / nd, loadWh: A.loadWh / nd, waterL: A.waterL / nd, dieselL: A.dieselL / nd,
      byCat: Object.fromEntries(Object.entries(A.byCat).map(([k, v]) => [k, v / nd])),
      condensateL: state.condensateL / nd,
    },
    totals: { ...A, condensateL: state.condensateL },
    final: { soc: state.soc, freshL: state.freshL, greyL: state.greyL, urineL: state.urineL, fuelL: state.fuelL, Tin: state.Tin },
    minSoc, maxCO2, minT, maxT, overloadMin, condMin, limits,
  };
}

/** Endurance: run long (up to maxDays) with no resupply and report the first limit reached. */
export function endurance(scn, ctrlOverrides = {}, maxDays = 10) {
  const r = runScenario({ ...scn, weather: scn.weather, days: maxDays }, ctrlOverrides, { days: maxDays, dt: 120, sampleMin: 60 });
  const entries = Object.entries(r.limits).sort((a, b) => a[1] - b[1]);
  const names = { battery: 'Battery reaches 20 % (load-shedding)', fresh: 'Fresh water empty', grey: 'Grey tank full', urine: 'Urine bottle full', solids: 'Toilet solids full', fuel: 'Fuel at ¼ (heater standpipe)' };
  return {
    first: entries[0] ? { id: entries[0][0], name: names[entries[0][0]], days: entries[0][1] / 24 } : null,
    all: entries.map(([id, h]) => ({ id, name: names[id], days: h / 24 })),
    run: r,
  };
}

/**
 * Step the camper model forward with optional direct weather and schedule overrides.
 */
export function stepModel(state, ctrl, dt = 60, wx = null, sch = null) {
  const scn = {
    id: 'step_model',
    days: 30,
    weather: [{ Tmin: wx?.T ?? 20, Tmax: wx?.T ?? 20, rhMin: wx?.rh ?? 50, rhMax: wx?.rh ?? 50, ghiPeak: wx?.ghi ?? 500, sunrise: 6, sunset: 18, cloud: 0, rain: 0, snow: 0, wind: wx?.wspd ?? wx?.wind ?? 2 }],
    wxDirect: wx ? {
      T: wx.T ?? 20,
      rh: wx.rh ?? 50,
      ghi: wx.ghi ?? 0,
      wind: wx.wspd ?? wx.wind ?? 2,
      cloud: wx.cloud ?? 0,
      rain: wx.rain ?? 0,
      snow: wx.snow ?? 0,
    } : null,
    schDirect: sch,
    climate: {},
  };

  const stepSize = Math.min(dt, 60);
  let elapsed = 0;
  let lastSnap = null;
  while (elapsed < dt) {
    const curDt = Math.min(stepSize, dt - elapsed);
    lastSnap = step(state, scn, ctrl, curDt);
    elapsed += curDt;
  }
  return lastSnap;
}

