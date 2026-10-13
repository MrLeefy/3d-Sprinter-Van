// Four-season environment scenarios and the daily-living schedule that drives the
// resource simulation and the Daily-living demonstration.

const SUNNY = { cloud: 0.05, rain: 0, snow: 0 };

export const SCENARIOS = [
  {
    id: 'summer', name: 'Hot summer sun', icon: '☀', days: 1,
    weather: [{ Tmin: 24, Tmax: 38, rhMin: 22, rhMax: 50, ghiPeak: 920, sunrise: 5.8, sunset: 20.4, ...SUNNY, wind: 2 }],
    visuals: { sky: 0x8ec5ff, horizon: 0xf3e2c0, ground: 0xc8b48a, sun: 1.0, haze: 0.0 },
    climate: { heatDay: 18, heatNight: 16, coolDay: 26, coolNight: 24, covers: 'reflective-day' },
    story: 'Parked in full sun at 38 °C. The white roof and reflective window covers cut solar gain; the 12 V roof AC runs from the battery with no engine idling, while 1 kW of solar offsets part of the load. Expect the battery to fall during hot afternoons — a 1–2 h drive or shore hook-up every couple of days keeps daytime AC sustainable.',
  },
  {
    id: 'winter', name: 'Cold winter', icon: '❄', days: 1,
    weather: [{ Tmin: -18, Tmax: -6, rhMin: 70, rhMax: 90, ghiPeak: 380, sunrise: 7.9, sunset: 16.6, cloud: 0.2, rain: 0, snow: 0.4, wind: 4 }],
    visuals: { sky: 0xb9c7d6, horizon: 0xe8eef5, ground: 0xf4f7fa, sun: 0.55, haze: 0.15, snowGround: true },
    climate: { heatDay: 20, heatNight: 16, coolDay: 26, coolNight: 26, covers: 'always' },
    story: 'Down to -18 °C. The Combi D 6 E burns diesel from the vehicle tank (room-sealed, exhaust outside) to heat the cabin and water. All fresh-water plumbing is inside the heated envelope; the grey tank has a heated jacket. Ventilation keeps running to control CO₂ and condensation, which costs heat — the simulation shows the real diesel bill.',
  },
  {
    id: 'rain', name: 'Heavy rain', icon: '☂', days: 1,
    weather: [{ Tmin: 9, Tmax: 13, rhMin: 88, rhMax: 98, ghiPeak: 140, sunrise: 6.6, sunset: 19.4, cloud: 0.85, rain: 1, snow: 0, wind: 6 }],
    visuals: { sky: 0x6c7a89, horizon: 0x9aa5b1, ground: 0x5d6b52, sun: 0.25, haze: 0.35 },
    climate: { heatDay: 19, heatNight: 16, coolDay: 26, coolNight: 26, covers: 'night' },
    story: 'A full day of heavy rain: solar drops to ~15 %, doors stay shut. Cooking is all-electric induction with the hood ducted to the roof, and the rain-capped roof fans keep humidity down so windows do not stream with condensation. Battery is the limit — after about two rain days without driving or shore power, load-shedding begins.',
  },
  {
    id: 'humid', name: 'Humid heat', icon: '💧', days: 1,
    weather: [{ Tmin: 25, Tmax: 32, rhMin: 70, rhMax: 95, ghiPeak: 720, sunrise: 6.2, sunset: 19.0, cloud: 0.35, rain: 0, snow: 0, wind: 1 }],
    visuals: { sky: 0xa7c4c9, horizon: 0xe4e9de, ground: 0x6f8f4e, sun: 0.75, haze: 0.45 },
    climate: { heatDay: 18, heatNight: 16, coolDay: 25, coolNight: 24, covers: 'reflective-day' },
    story: 'Muggy 32 °C and 85 % RH. The AC removes moisture as well as heat (condensate drains to the roof gutter — several litres per day); the bath fan extracts shower steam at source. Without dehumidification the interior would reach the dew point on cold surfaces.',
  },
  {
    id: 'overnight', name: 'Overnight off-grid', icon: '☾', days: 1, startHour: 17,
    weather: [{ Tmin: 6, Tmax: 17, rhMin: 45, rhMax: 85, ghiPeak: 820, sunrise: 6.4, sunset: 19.6, ...SUNNY, wind: 2 }],
    visuals: { sky: 0x1b2a4a, horizon: 0x4a5a7a, ground: 0x4c5a3e, sun: 0.15, haze: 0.1, night: true },
    climate: { heatDay: 20, heatNight: 15, coolDay: 26, coolNight: 26, covers: 'night' },
    story: 'Arrive at a trailhead at 17:00 with no hookups. Cook dinner, shower, sleep with the heater on a 15 °C night setback and the fresh-air fan sweeping the bed area — CO₂ stays below 1,000 ppm with every door and window closed.',
  },
  {
    id: 'multiday', name: '5 days without hookups', icon: '⧗', days: 5,
    weather: [
      { Tmin: 7, Tmax: 21, rhMin: 40, rhMax: 80, ghiPeak: 820, sunrise: 6.5, sunset: 19.3, ...SUNNY, wind: 2 },
      { Tmin: 9, Tmax: 18, rhMin: 55, rhMax: 85, ghiPeak: 420, sunrise: 6.5, sunset: 19.3, cloud: 0.6, rain: 0, snow: 0, wind: 3 },
      { Tmin: 8, Tmax: 12, rhMin: 85, rhMax: 97, ghiPeak: 150, sunrise: 6.5, sunset: 19.3, cloud: 0.9, rain: 1, snow: 0, wind: 5 },
      { Tmin: 5, Tmax: 19, rhMin: 45, rhMax: 80, ghiPeak: 800, sunrise: 6.5, sunset: 19.3, ...SUNNY, wind: 2 },
      { Tmin: 6, Tmax: 22, rhMin: 40, rhMax: 75, ghiPeak: 840, sunrise: 6.5, sunset: 19.3, ...SUNNY, wind: 2 },
    ],
    driveHours: [0, 0, 1.5, 0, 0],
    visuals: { sky: 0x9cbbe0, horizon: 0xe6e2d3, ground: 0x7a8c56, sun: 0.85, haze: 0.05 },
    climate: { heatDay: 20, heatNight: 16, coolDay: 26, coolNight: 25, covers: 'night' },
    story: 'Spring shoulder season, two people, remote work every day, showers every other day. A 1.5 h drive on day 3 tops up the battery via the alternator. Watch which resource runs out first — usually grey water and the urine bottle, not power.',
  },
];

export const scenarioById = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

// Daily-living schedule (hours). Loads use LOADS level indices. `water` uses litres.
// `person` drives the mannequin in Daily-living mode; `acts` sets actuators.
export const DAY_SCHEDULE = [
  { t: 0, end: 6.5, id: 'sleep', label: 'Sleeping — heater/AC on night setpoint, fresh-air fan sweeping the bed', occ: 2, metab: 'sleep',
    loads: { freshFan: 1, fanBath: 1 }, person: { at: 'bed', pose: 'lie' }, acts: { covers: 1, slideOut: 1, bedLounge: 0, bedStep: 1, seatSwivel: 1, table: 0, lightsOn: 0 } },
  { t: 6.5, end: 6.8, id: 'wake', label: 'Wake up, pod in, bed folds to lounge', occ: 2, metab: 'active',
    loads: { lights: 1, freshFan: 1 }, water: { handWash: 1.5 }, person: { at: 'aisleRear', pose: 'stand' }, acts: { slideOut: 0, bedLounge: 1, covers: 0, lightsOn: 1 } },
  { t: 6.8, end: 7.15, id: 'cook', label: 'Cooking breakfast indoors — induction + range hood', occ: 2, metab: 'active', cooking: true,
    loads: { induction: 2, hood: 1, lights: 1 }, water: { cooking: 1.5 }, moistureG: 250, person: { at: 'galley', pose: 'cook' }, acts: { sinkCover: 1, drawers: 0.6, prepBoard: 1 } },
  { t: 7.15, end: 7.6, id: 'eat', label: 'Breakfast at the swivel-seat dinette', occ: 2, metab: 'rest',
    loads: { lights: 1 }, person: { at: 'dinette', pose: 'sit' }, acts: { table: 1, seatSwivel: 1, prepBoard: 0, drawers: 0 } },
  { t: 7.6, end: 7.85, id: 'dishes', label: 'Washing up (hot water from the Combi)', occ: 2, metab: 'active',
    loads: { pump: 1 }, water: { dishesBreakfast: 6 }, hotFrac: 0.5, person: { at: 'sink', pose: 'cook' }, acts: {} },
  { t: 7.85, end: 12, id: 'work', label: 'Remote work — laptops, monitor, satellite internet', occ: 2, metab: 'rest',
    loads: { usb: 3, starlink: 1 }, person: { at: 'dinette', pose: 'work' }, acts: { table: 1 } },
  { t: 12, end: 12.2, id: 'lunch', label: 'Reheating lunch in the convection microwave', occ: 2, metab: 'active',
    loads: { microwave: 1, usb: 2, starlink: 1 }, person: { at: 'tower', pose: 'stand' }, acts: { microwaveDoor: 0.2 } },
  { t: 12.2, end: 13, id: 'work2', label: 'Lunch & afternoon work', occ: 2, metab: 'rest',
    loads: { usb: 3, starlink: 1 }, person: { at: 'dinette', pose: 'work' }, acts: { microwaveDoor: 0 } },
  { t: 13, end: 17, id: 'away', label: 'Out exploring — van locked, fridge & climate in away mode', occ: 0, metab: 'rest',
    loads: {}, person: { at: 'outside', pose: 'hidden' }, acts: { table: 0, seatSwivel: 0 } },
  { t: 17, end: 17.4, id: 'store', label: 'Storing bikes / gear in the garage through the rear doors', occ: 2, metab: 'active',
    loads: {}, person: { at: 'rear', pose: 'stand' }, acts: { rearDoors: 1, outdoorKitchen: 0 } },
  { t: 17.4, end: 18, id: 'outdoor', label: 'Prep at the pull-out outdoor kitchen', occ: 1, metab: 'active',
    loads: { outlets: 1 }, water: { cooking: 1 }, person: { at: 'outdoorKitchen', pose: 'cook' }, acts: { rearDoors: 1, outdoorKitchen: 1 } },
  { t: 18, end: 18.6, id: 'cook2', label: 'Cooking dinner indoors — induction + range hood on boost', occ: 2, metab: 'active', cooking: true,
    loads: { induction: 2, hood: 2, lights: 2 }, water: { cooking: 2 }, moistureG: 450, person: { at: 'galley', pose: 'cook' },
    acts: { rearDoors: 0, outdoorKitchen: 0, drawers: 0.8, sinkCover: 1, lightsOn: 1 } },
  { t: 18.6, end: 19.2, id: 'dinner', label: 'Dinner', occ: 2, metab: 'rest',
    loads: { lights: 2 }, person: { at: 'dinette', pose: 'sit' }, acts: { table: 1, seatSwivel: 1, drawers: 0 } },
  { t: 19.2, end: 19.5, id: 'dishes2', label: 'Washing up', occ: 2, metab: 'active',
    loads: { pump: 1, lights: 2 }, water: { dishesDinner: 8 }, hotFrac: 0.5, person: { at: 'sink', pose: 'cook' }, acts: {} },
  { t: 19.5, end: 20.1, id: 'relax', label: 'Laptop / phone time', occ: 2, metab: 'rest',
    loads: { usb: 2, lights: 1, starlink: 1 }, person: { at: 'dinette', pose: 'work' }, acts: {} },
  { t: 20.1, end: 20.5, id: 'shower', label: 'Showers (navy style, thermostatic hot water) — bath fan on high', occ: 2, metab: 'active', shower: true,
    loads: { pump: 1, fanBath: 3, lights: 1 }, water: { shower: 24 }, hotFrac: 0.55, moistureG: 500, person: { at: 'wetbath', pose: 'shower' }, acts: { wetbathDoor: 0 } },
  { t: 20.5, end: 20.6, id: 'toilet', label: 'Drawer toilet slid into the wet bath', occ: 2, metab: 'rest',
    loads: { fanBath: 1 }, person: { at: 'wetbath', pose: 'sitToilet' }, acts: { toilet: 1 } },
  { t: 20.6, end: 22.3, id: 'lounge', label: 'Reading in the bed-lounge', occ: 2, metab: 'rest',
    loads: { lights: 1, usb: 1 }, person: { at: 'bed', pose: 'lounge' }, acts: { toilet: 0, bedLounge: 1, table: 0, seatSwivel: 0, bedStep: 1 } },
  { t: 22.3, end: 22.6, id: 'convert', label: 'Converting to bedroom — bed flat, pod out, covers on', occ: 2, metab: 'active',
    loads: { lights: 1, slideout: 1 }, person: { at: 'aisleRear', pose: 'stand' }, acts: { bedLounge: 0, slideOut: 1, covers: 1 } },
  { t: 22.6, end: 24, id: 'sleep2', label: 'Sleeping', occ: 2, metab: 'sleep',
    loads: { freshFan: 1, fanBath: 1 }, person: { at: 'bed', pose: 'lie' }, acts: { covers: 1, slideOut: 1, lightsOn: 0 } },
];

export function scheduleAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  return DAY_SCHEDULE.find((s) => h >= s.t && h < s.end) || DAY_SCHEDULE[0];
}

/** Weather sample for a scenario day at a given hour. */
export function weatherAt(scn, day, hour) {
  const w = scn.weather[Math.min(day, scn.weather.length - 1)];
  const h = ((hour % 24) + 24) % 24;
  // Temperature: minimum near sunrise, maximum mid-afternoon (15 h)
  const mean = (w.Tmin + w.Tmax) / 2;
  const amp = (w.Tmax - w.Tmin) / 2;
  const T = mean + amp * Math.cos((2 * Math.PI * (h - 15)) / 24);
  // Relative humidity roughly anti-phase with temperature
  const rh = (w.rhMin + w.rhMax) / 2 - ((w.rhMax - w.rhMin) / 2) * Math.cos((2 * Math.PI * (h - 15)) / 24);
  let ghi = 0;
  if (h > w.sunrise && h < w.sunset) {
    const u = (h - w.sunrise) / (w.sunset - w.sunrise);
    ghi = w.ghiPeak * Math.pow(Math.sin(Math.PI * u), 1.5);
  }
  const sunAlt = h > w.sunrise && h < w.sunset ? Math.sin(Math.PI * (h - w.sunrise) / (w.sunset - w.sunrise)) : 0;
  return { T, rh, ghi, sunAlt, cloud: w.cloud, rain: w.rain, snow: w.snow, wind: w.wind, sunrise: w.sunrise, sunset: w.sunset };
}
