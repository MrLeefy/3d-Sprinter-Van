// Camper-van handling model for drive mode (pure, no rendering): a dynamic single-track ("bicycle")
// model with real tyre forces, load transfer, a roll and tip model, and driver aids on top.
//
//   tyres      brush model per axle: lateral force from slip angle, saturating at μ·Fz, with the
//              friction circle shared with braking and driving, cornering stiffness and "dig-in" that
//              depend on the surface, and a lateral-load-transfer penalty
//   load       static split from the weight model (this build is rear-heavy), longitudinal transfer
//              from braking and acceleration
//   roll/tip   sprung-mass roll with springs and dampers, the wheels lifting when the load transfer
//              reaches the whole axle load, then a rigid tip about the outer wheels that either falls
//              back or goes over. Abrupt steering at speed excites it, so a hard swerve at motorway
//              speed can put the van on its side
//   aids       steering lock that follows speed, traction control, ABS, stability control and a
//              roll-over guard, each scaled by the driving-assist setting
//
// Conventions: body x forward, "right" lateral velocity vy, yaw rate r positive turning left (counter-
// clockwise from above), front wheel angle δ positive steers left, roll φ positive tilts the roof to the
// right. Forces on the van are in body axes; a lateral acceleration to the right is positive.
import { weightReport } from './weight.js';

const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ── Vehicle ───────────────────────────────────────────────────────────────────
const W = weightReport();
const L = 4.325; // wheelbase
const m = W.gvw;
const b = clamp(W.cg[0], 1.2, 2.6); // CG ahead of the rear axle
const a = L - b; // CG behind the front axle
const hCg = 1.18; // CG height (the weight model gives 1.04 m; roof boxes, bikes, water and a full fridge put a camper higher)
const track = 1.72;
const ms = 0.88 * m; // sprung mass
const hRoll = hCg - 0.4; // CG above the roll axis
const Iroll = ms * (0.9 * 0.9 + hRoll * hRoll);

export const VAN_DYN = {
  m, L, a, b, hCg, track,
  Iz: m * 3.3, // yaw inertia (radius of gyration ≈ 1.8 m: weight at both ends of a long, rear-heavy camper)
  wheelR: 0.395,
  // tyre cornering stiffness per unit load (1/rad) on a firm surface: the front a little softer for a safe understeer
  cFront: 12,
  cRear: 15,
  brakeBias: 0.66, // share of the brake force on the front axle
  muFront: 0.94, // the front tyres also steer and brake: they use up their grip first, so the van pushes on before it spins
  // roll
  ms, hRoll, Iroll, Kroll: 260e3, Croll: 19e3, bumpStop: 0.1, Itip: m * (hCg * hCg + (track / 2) ** 2 + 0.8),
  tipCrit: Math.atan(track / 2 / hCg), // rad of tip beyond which gravity takes the van over
  cda: 0.37 * 4.6,
};
const LOCKED = 0.9; // a locked, skidding tyre keeps a little less of the grip than one rolling at the peak (why ABS stops shorter)
export const AY_TIP = (G * (track / 2)) / hCg; // lateral acceleration at which a rigid van starts to tip (≈ 7.7 m/s²)

// Surface behaviour of the tyres beyond the friction coefficient μ (which the land supplies):
// stiff = cornering stiffness relative to tarmac, slide = grip kept once sliding, dig = extra lateral
// force from soil building up against the tyre when sliding sideways fast (what trips a van on soft ground).
export const SURF_TIRE = {
  asphalt: { stiff: 1, slide: 0.9, dig: 0 }, county: { stiff: 1, slide: 0.9, dig: 0 }, street: { stiff: 1, slide: 0.9, dig: 0 },
  plowed: { stiff: 0.7, slide: 0.85, dig: 0.05 }, rock: { stiff: 0.8, slide: 0.9, dig: 0.05 }, arrester: { stiff: 0.5, slide: 0.95, dig: 0.3 },
  gravel: { stiff: 0.62, slide: 0.88, dig: 0.3 }, dirt: { stiff: 0.55, slide: 0.88, dig: 0.45 }, grass: { stiff: 0.5, slide: 0.88, dig: 0.5 },
  forest: { stiff: 0.45, slide: 0.88, dig: 0.5 }, sand: { stiff: 0.4, slide: 0.88, dig: 0.6 }, mud: { stiff: 0.35, slide: 0.9, dig: 0.5 },
  snow: { stiff: 0.45, slide: 0.9, dig: 0.3 }, packed: { stiff: 0.4, slide: 0.85, dig: 0.1 }, ice: { stiff: 0.3, slide: 0.8, dig: 0 },
  shallow: { stiff: 0.4, slide: 0.9, dig: 0.2 }, water: { stiff: 0.2, slide: 0.9, dig: 0 },
};
export const tireOf = (key) => SURF_TIRE[key] || SURF_TIRE.asphalt;

/** Mutable dynamic state of the van (positions live in the driver). */
export function makeVanDyn() {
  return {
    u: 0, vy: 0, r: 0, // body-frame speeds: forward, to the right, yaw rate
    phi: 0, phid: 0, // suspension roll (roof right positive) and its rate
    tip: 0, tipd: 0, tipSide: 1, // tip angle beyond wheel lift (always ≥ 0) and which way the roof goes
    ax: 0, ay: 0, // last body accelerations (forward, to the right)
    lam: 0, // 0..1+: how close the inner wheels are to leaving the ground
    zf: 0, zr: 0, // how far each axle is into its slip peak (≥ 1: sliding)
    fyR: 0, // lateral force on the rear axle (N, + to the right)
    spin: 0, lock: 0, esc: 0, // wheelspin, brake lock-up and stability-control intervention, 0..1
    rolled: false,
  };
}

// ── Tyres ─────────────────────────────────────────────────────────────────────
/**
 * Lateral force of one axle (N, ≥ 0 magnitude, caller applies the sign) from the slip tangent `s`.
 * fyMax is the lateral force the friction circle leaves, cAlpha the cornering stiffness (N/rad),
 * slide the share of grip kept when sliding and dig the soil build-up (a share of fyMax, already scaled by how fast the tyre
 * ploughs sideways). Returns { f, z } where z ≥ 1 is sliding.
 */
export function brush(s, fyMax, cAlpha, slide = 0.9, dig = 0) {
  const x = Math.abs(s);
  if (fyMax <= 1) return { f: 0, z: 0 };
  const z = (cAlpha * x) / (3 * fyMax);
  let f;
  if (z < 1) f = fyMax * (3 * z - 3 * z * z + z * z * z);
  else f = fyMax * (slide + (1 - slide) * Math.exp(-(z - 1) * 1.6));
  if (dig > 0) f += fyMax * dig; // soil piles up against a tyre sliding sideways
  return { f, z };
}

/**
 * Lateral steering lock (rad) the driver can use at this speed. The geometric lock is 0.5 rad; above
 * parking speeds it is limited so that full stick asks for `cap` times the lateral acceleration at
 * which the van starts to tip: Easy stays below it, Standard goes a little beyond, Pro is raw. The
 * cap only opens up above ~65 km/h, so a corner in town is never a roll-over.
 */
export function steerLock(speed, cap, P = VAN_DYN) {
  const v = Math.max(Math.abs(speed), 0.5);
  const open = smooth(17, 28, v);
  const ratio = 0.8 + (cap - 0.8) * open;
  const ay = ratio * AY_TIP;
  const delta = (P.L / (v * v) + KUS) * ay;
  return clamp(delta, 0.012, 0.5);
}

/** Understeer gradient (rad per m/s²): tyre stiffness grows with the load, so only the stiffness per unit load differs between the axles. */
export const KUS = (1 / VAN_DYN.cFront - 1 / VAN_DYN.cRear) / G;

/** Front-wheel angle that holds a steady yaw rate r at speed v (inverse of the steady-state response). */
export function steadySteer(v, r, P = VAN_DYN) {
  const sp = Math.max(Math.abs(v), 2.5);
  return ((P.L + KUS * sp * sp) * r) / sp;
}

/** Steady-state yaw rate for a front-wheel angle. */
export function steadyYaw(v, delta, P = VAN_DYN) {
  const sp = Math.max(Math.abs(v), 2.5);
  return (sp * delta) / (P.L + KUS * sp * sp);
}

// ── The step ──────────────────────────────────────────────────────────────────
/**
 * Advance the van by h seconds.
 *  inp = { drive (N at the rear axle, negative reverses), brake 0..1, hand (handbrake), delta (front wheel angle) }
 *  env = { mu, crr, key (surface), grade (sin of the slope, + uphill), sideG (sin of the terrain roll, + right side low),
 *          tc, stab, rsc, abs (0..1 ABS strength, 0 = none), pull (steering pull) }
 * Updates S in place.
 */
export function stepVanDyn(S, inp, env, h, P = VAN_DYN) {
  const n = Math.abs(S.u) < 6 ? 2 : 1; // the tyres are stiff at crawl: take smaller steps
  S.lock = 0;
  S.spin = 0;
  for (let i = 0; i < n; i++) sub(S, inp, env, h / n, P);
  // brakes hold a van that has nearly stopped
  if (inp.brake > 0.05 && inp.drive === 0 && Math.abs(S.u) < 0.4) {
    S.u = 0;
    if (Math.abs(S.vy) < 0.4) S.vy = 0;
    S.r *= 0.6;
  }
  return S;
}

function sub(S, inp, env, h, P) {
  const { m, a, b, L, hCg, track } = P;
  const mu = Math.max(0.05, env.mu), ty = tireOf(env.key);
  const u = S.u, vy = S.vy, r = S.r;
  const grade = env.grade || 0, sideG = env.sideG || 0;
  // vertical loads: static split plus longitudinal transfer from the last acceleration
  const W = m * G;
  const axT = clamp(S.ax, -1.3 * G, 0.9 * G);
  const Fzf = clamp((W * b) / L - (m * axT * hCg) / L, 0.18 * W, 0.8 * W);
  const Fzr = W - Fzf;
  // the linear stiffness stays with the static axle loads (so braking in a bend does not turn the van tail-happy); the grip limit follows the real loads
  const Fzf0 = (W * b) / L, Fzr0 = W - Fzf0;
  // lateral load transfer: how close the inner wheels are to lifting (roll angle, roll rate and the lateral acceleration)
  const aOut = Math.abs(S.ay);
  const outward = S.ay >= 0 ? -1 : 1; // the roof leans away from the acceleration
  const phiOut = Math.max(0, S.phi * outward), phidOut = S.phid * outward;
  const lam = clamp((m * aOut * hCg + P.ms * G * P.hRoll * phiOut + P.Croll * Math.max(0, phidOut)) / ((W * track) / 2), 0, 1.6);
  S.lam = lam;
  const lift = smooth(0, 0.12, S.tip); // 0 grounded .. 1 two wheels off the ground
  const cap = clamp(1 - 0.12 * Math.min(lam, 1) ** 2 - 0.08 * lift, 0.6, 1);

  // longitudinal demands
  const brakeMax = 1.35 * W;
  const absK = env.abs ? 1 : 0; // 0 = no ABS (Pro): the wheels can lock
  // ABS holds the slip near the peak, and leaves some grip for cornering when the van is also turning
  const latUse = Math.min(1, Math.abs(S.ay) / (mu * G));
  const absLim = 0.93 - 0.4 * latUse * latUse;
  let FbF = inp.brake * brakeMax * P.brakeBias, FbR = inp.brake * brakeMax * (1 - P.brakeBias);
  let drive = inp.drive;
  // the roll-over guard brakes the van as the inner wheels approach lifting; stability control cuts the torque
  const rscBrake = env.rsc > 0 ? env.rsc * smooth(0.62, 0.92, S.lam) * 0.45 * W : 0;
  if (u > 3 && (rscBrake > 0 || S.esc > 0.3)) {
    FbF += rscBrake * 0.85;
    FbR += rscBrake * 0.15;
    drive = Math.min(drive, 0.25 * Math.max(0, drive));
  }
  // handbrake: ordinary braking for the aids, locked rear wheels in Pro
  const handLock = !!inp.hand && !absK;
  if (inp.hand && absK) {
    FbF = Math.max(FbF, 0.7 * brakeMax * P.brakeBias);
    FbR = Math.max(FbR, 0.7 * brakeMax * (1 - P.brakeBias));
  }
  if (handLock) FbR = Math.max(FbR, brakeMax);
  // per-axle longitudinal force along the wheel heading (+ forward) within the friction circle
  const signU = u > 0.3 ? 1 : u < -0.3 ? -1 : 0;
  const peakF = mu * P.muFront * Fzf, peakR = mu * Fzr;
  let FxF = 0, FxR = 0, fracF = absLim;
  // front: braking only; ABS holds the slip near the peak, without it the wheels lock and slide
  if (FbF > 0 && signU !== 0) {
    const used = absK ? Math.min(FbF, absLim * peakF) : FbF > peakF ? peakF * ty.slide * LOCKED : FbF;
    FxF = -signU * used;
    fracF = used / peakF;
    if (FbF > peakF * 1.02) S.lock = Math.max(S.lock, smooth(1, 1.5, FbF / peakF) * (absK ? 0.3 : 1));
  }
  // rear: drive and braking
  let spinning = 0;
  if (drive !== 0) {
    const capD = peakR * (0.97 - 0.12 * (env.tc || 0));
    if (Math.abs(drive) > capD) {
      spinning = clamp((Math.abs(drive) - capD) / capD, 0, 1);
      // traction control trims the torque; without it the wheels spin and the grip is shared out with the sideways force
      drive = Math.sign(drive) * (capD + (Math.abs(drive) - capD) * (1 - (env.tc || 0)) * 0.35);
    }
    FxR += drive;
  }
  if (FbR > 0 && signU !== 0) {
    // with ABS the rear brake force is limited (brake-force distribution) so the rear never works harder than the front (the front
    // gives up first) and leaves the grip the rear needs for cornering
    const used = absK ? Math.min(FbR, absLim * peakR, 0.88 * fracF * peakR, 0.8 * peakR * Math.sqrt(1 - Math.min(0.96, Math.abs(S.fyR) / peakR) ** 2)) : FbR > peakR || handLock ? peakR * ty.slide * LOCKED : FbR;
    FxR += -signU * used;
    if (FbR > peakR * 1.02) S.lock = Math.max(S.lock, handLock ? 1 : smooth(1, 1.5, FbR / peakR) * (absK ? 0.3 : 1));
  }
  S.spin = Math.max(S.spin, spinning);
  FxR = clamp(FxR, -peakR * 1.05, peakR * 1.05);

  // ── front axle ────────────────────────────────────────────────────────────
  const delta = inp.delta;
  const cd = Math.cos(delta), sd = Math.sin(delta);
  const vyF = vy - a * r, vyR = vy + b * r;
  const vpar = u * cd - vyF * sd, vperp = u * sd + vyF * cd;
  const sF = vperp / Math.max(Math.abs(vpar), 2);
  const fyMaxF = cap * Math.sqrt(Math.max(0.0004, peakF * peakF - FxF * FxF));
  const bf = brush(sF, fyMaxF, P.cFront * ty.stiff * Fzf0, ty.slide, ty.dig * smooth(1.5, 5.5, Math.abs(vperp)));
  const FperpF = -Math.sign(sF) * bf.f;
  // ── rear axle ─────────────────────────────────────────────────────────────
  const sR = vyR / Math.max(Math.abs(u), 2);
  const fyMaxR = cap * Math.sqrt(Math.max(0.0004, peakR * peakR - FxR * FxR));
  const br = brush(sR, fyMaxR, P.cRear * ty.stiff * Fzr0, ty.slide, ty.dig * smooth(1.5, 5.5, Math.abs(vyR)));
  const FperpR = -Math.sign(sR) * br.f;
  S.fyR = FperpR;
  S.zf = bf.z;
  S.zr = br.z;
  // body forces: front forces turn with the wheel
  let Fx = FxF * cd + FperpF * sd + FxR;
  let Fy = -FxF * sd + FperpF * cd + FperpR; // to the right
  let Mz = -a * (-FxF * sd + FperpF * cd) + b * FperpR; // yaw moment, counter-clockwise positive
  // stability control: a corrective yaw moment (differential braking) against the difference from the steered yaw
  if (env.stab > 0 && Math.abs(u) > 4) {
    const rDes = clamp(steadyYaw(u, delta, P), (-0.85 * mu * G) / Math.abs(u), (0.85 * mu * G) / Math.abs(u));
    const err = r - rDes;
    const dead = 0.04;
    const e = Math.sign(err) * Math.max(0, Math.abs(err) - dead);
    S.esc = clamp(Math.abs(e) / 0.35, 0, 1) * env.stab;
    const mzMax = 0.3 * m * G * track * 0.5 * env.stab + 1;
    Mz += clamp(-e * 30000 * env.stab, -mzMax, mzMax);
  } else S.esc = 0;
  // drag, rolling resistance, slope, the sideways pull of a cross-slope and a bent steering rack
  const resist = (env.crr || 0.012) * W + 0.5 * 1.2 * P.cda * u * u;
  Fx += -Math.sign(u || 1) * (Math.abs(u) < 0.05 ? 0 : resist) - W * grade;
  Fy += W * sideG;
  // ── dynamics (body frame): accelerations, then the coupling terms ───────────
  const axB = Fx / m - r * vy; // acceleration of the velocity vector in the body frame
  const ayB = Fy / m + r * u;
  let un = u + axB * h;
  // brakes stop the van, they do not push it backwards
  if (inp.brake > 0.02 && inp.drive === 0 && Math.sign(un) !== Math.sign(u) && u !== 0) un = 0;
  S.u = un;
  S.vy = vy + ayB * h;
  S.r = r + (Mz / P.Iz) * h;
  S.ax = Fx / m; // force-based accelerations drive the load transfer and the roll
  S.ay = Fy / m;

  // ── roll and tip ───────────────────────────────────────────────────────────
  const ayForce = S.ay;
  const Mext = -P.ms * ayForce * P.hRoll;
  const Kbs = Math.abs(S.phi) > P.bumpStop ? 4 * P.Kroll * (Math.abs(S.phi) - P.bumpStop) * Math.sign(S.phi) : 0;
  const phidd = (Mext + P.ms * G * P.hRoll * S.phi - P.Kroll * S.phi - P.Croll * S.phid - Kbs) / P.Iroll;
  S.phid += phidd * h;
  S.phi = clamp(S.phi + S.phid * h, -0.3, 0.3);
  // wheels off the ground: the van tips about its outer wheels
  const side = ayForce >= 0 ? -1 : 1; // direction the roof goes
  const aO = Math.abs(ayForce);
  const moment0 = m * aO * hCg - m * G * (track / 2);
  if (S.tip > 0 || S.tipd > 0 || moment0 > 0 || S.lam >= 1) {
    if (S.tip === 0 && S.tipd === 0) S.tipSide = side;
    const d = S.tip;
    const lat = S.tipSide === side ? aO : -aO * 0.4; // a reversing acceleration pushes it back down
    const M = m * lat * (hCg * Math.cos(d) + (track / 2) * Math.sin(d)) - m * G * ((track / 2) * Math.cos(d) - hCg * Math.sin(d));
    S.tipd += ((M - 9000 * S.tipd) / P.Itip) * h;
    S.tip = d + S.tipd * h;
    if (S.tip <= 0) {
      S.tip = 0;
      S.tipd = Math.max(0, S.tipd) * 0; // lands again
    }
    if (S.tip >= P.tipCrit) S.rolled = true;
  }
  return S;
}

/**
 * An impact high on the body shoves the van sideways: dvy (m/s, + to the right) is the change in its
 * sideways speed. The roof goes the way it was pushed, rolling the suspension and, if the shove is hard
 * enough to lift the wheels past the balance point, tipping the van over.
 */
export function kickRoll(S, dvy, P = VAN_DYN) {
  const dir = Math.sign(dvy);
  if (!dir || S.rolled) return S;
  const j = P.m * Math.abs(dvy) * 0.7;
  S.phid += (dir * j * P.hRoll) / P.Iroll;
  if (S.tip === 0 && S.tipd === 0) S.tipSide = dir;
  if (S.tipSide === dir) S.tipd += (j * P.hCg) / P.Itip;
  else S.tipd = Math.max(0, S.tipd - (j * P.hCg) / P.Itip);
  return S;
}

/** The van lying on its side: it ploughs to a stop and the spin dies. */
export function stepRolled(S, h, mu = 0.5) {
  const sp = Math.hypot(S.u, S.vy);
  const dec = Math.min(sp, (0.55 + 0.3 * mu) * G * h);
  if (sp > 1e-6) {
    S.u -= (S.u / sp) * dec;
    S.vy -= (S.vy / sp) * dec;
  }
  S.r *= Math.exp(-3 * h);
  S.ax = S.ay = 0;
  return S;
}
