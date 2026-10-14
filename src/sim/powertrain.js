// Camper-van powertrain for drive mode (pure, no rendering): a performance-tuned turbo-diesel with a
// 9-speed automatic. The drive force is traction-limited torque (constant force) up to the speed where
// the engine runs out of power, then constant power; upshifts cost a brief torque dip, as they do in
// a real automatic. The tachometer and the engine sound read rpm from the same gear schedule.

export const VAN_ENGINE = {
  powerW: 225e3, // W at the wheels (game tuning: a "Stage 2" tune of the diesel; the stock 2.0 L makes ≈ 125 kW there)
  forceMax: 15500, // N available in first gear (torque × ratio ÷ wheel radius)
  idleRpm: 760,
  redline: 4200,
  shiftDipT: 0.28, // s of reduced torque while the gearbox swaps ratios
  shiftDip: 0.3, // fraction of torque that remains during the shift
  // upshift speeds (km/h) per gear band of the 9-speed automatic
  bands: [0, 18, 32, 46, 60, 75, 90, 105, 122, 145],
};

/** Gear index (0 = first) for a speed in km/h, from the shift schedule. */
export function vanGearIndex(kmh, E = VAN_ENGINE) {
  const b = E.bands;
  let i = 0;
  while (i < b.length - 2 && kmh > b[i + 1]) i++;
  return i;
}

/** Engine speed (rpm) at a road speed and throttle position. */
export function vanRpm(kmh, throttle = 0, E = VAN_ENGINE) {
  if (kmh < 2) return E.idleRpm + throttle * 600;
  const i = vanGearIndex(kmh, E);
  const f = Math.min(1, (kmh - E.bands[i]) / (E.bands[i + 1] - E.bands[i]));
  return 1050 + f * 1250 + throttle * 220;
}

/**
 * Tractive force (N, positive) for a throttle 0..1 at speed v (m/s). `shift` is the time left in a
 * gear change; during it the torque is cut to `shiftDip`, blended back in over the last 40 %.
 */
export function vanDriveForce(v, throttle, shift = 0, E = VAN_ENGINE) {
  const base = Math.min(E.forceMax, E.powerW / Math.max(Math.abs(v), 2.5));
  let k = 1;
  if (shift > 0) {
    const u = Math.min(1, shift / (E.shiftDipT * 0.4));
    k = E.shiftDip + (1 - E.shiftDip) * (1 - u);
  }
  return base * Math.max(0, throttle) * k;
}

/** Simulate a flat-road full-throttle run; returns seconds to reach each speed in km/h. Used by tests and tuning. */
export function accelerationTimes(mass, { crr = 0.012, cda = 0.37 * 4.6, targets = [50, 80, 100, 120], vMax = 38, E = VAN_ENGINE } = {}) {
  const G = 9.81, RHO = 1.2, h = 0.01;
  const out = {};
  let v = 0, t = 0, gear = 0, shift = 0;
  while (t < 90 && v < vMax) {
    const gi = vanGearIndex(v * 3.6, E);
    if (gi > gear) shift = E.shiftDipT;
    gear = gi;
    shift = Math.max(0, shift - h);
    const resist = crr * mass * G + 0.5 * RHO * cda * v * v;
    v = Math.min(vMax, v + ((vanDriveForce(v, 1, shift, E) - resist) / mass) * h);
    t += h;
    for (const k of targets) if (out[k] === undefined && v * 3.6 >= k) out[k] = +t.toFixed(2);
  }
  out.vTop = v * 3.6;
  out.tTop = +t.toFixed(1);
  return out;
}
