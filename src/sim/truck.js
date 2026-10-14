// Articulated semi-truck dynamics (pure, no rendering): a 10-speed gearbox with auto or manual
// shifting on a diesel torque curve, air brakes with fade, engine brake, fifth-wheel kinematics for
// the trailer (jack-knife, off-tracking, backing), rollover margin, fuel and brake temperature.
//
// Conventions: heading θ has direction (cos θ, −sin θ) in the world frame (x east, z south); the
// tractor reference point R is the centre of the drive tandem; the kingpin K = R + a·head(θ); the
// trailer's virtual axle T = K − Lt·head(θt).

export const G = 9.81;
export const SPEC = {
  wheelbase: 5.9, // steer axle → drive tandem centre
  fifthA: 0.15, // kingpin ahead of the tandem centre
  kingToAxle: 12.2, // kingpin → trailer tandem centre
  wheelR: 0.5,
  eff: 0.9,
  idleRpm: 650,
  maxRpm: 2100,
  govRpm: 2180,
  gears: [12.8, 9.3, 6.8, 4.9, 3.6, 2.6, 1.9, 1.4, 1.0, 0.74],
  reverse: 11.6,
  final: 3.7,
  torque: [[500, 900], [700, 1500], [900, 2100], [1100, 2400], [1500, 2400], [1800, 2050], [2100, 1450], [2250, 0]], // rpm → N·m
  cdA: 0.62 * 9.2,
  tractorMass: 8400,
  trailerMass: { none: 0, dryvan: 6400, reefer: 7600, flatbed: 5200, tanker: 6800, logs: 5000, container: 4600 },
  cargoCg: { none: 1.4, dryvan: 2.1, reefer: 2.1, flatbed: 2.5, tanker: 2.0, logs: 2.8, container: 2.3 },
  emptyCg: 1.7,
  track: 1.83,
  maxSteer: 0.46,
  jackLimit: 1.62, // rad (≈ 93°)
  fuelTank: 400,
  brakeG: 0.58,
};
export const TRAILER_CARGO = { dryvan: [8000, 20000], reefer: [10000, 20000], flatbed: [8000, 22000], tanker: [16000, 28000], logs: [14000, 24000], container: [10000, 22000] };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function torqueAt(rpm) {
  const t = SPEC.torque;
  if (rpm <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (rpm <= t[i][0]) {
      const f = (rpm - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
      return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * f;
    }
  }
  return 0;
}

export class Rig {
  constructor(trailer = 'dryvan', cargoKg = 0) {
    this.theta = 0; // tractor heading
    this.thetaT = 0; // trailer heading
    this.v = 0; // m/s along the heading (negative = reversing)
    this.delta = 0; // road-wheel angle
    this.gear = 1; // 1..10, 0 = neutral, -1 = reverse
    this.auto = true;
    this.rpm = SPEC.idleRpm;
    this.shiftT = 0;
    this.brakeP = 0; // 0..1 service brake application
    this.air = 125; // psi
    this.engineBrake = false;
    this.park = true;
    this.fuel = SPEC.fuelTank * 0.8; // litres
    this.fuelScale = 6; // distance in the drive world is compressed
    this.damage = 0; // 0..100
    this.brakeTemp = 60; // °C
    this.fade = 0;
    this.jack = 0; // 0..1 how close to jack-knife
    this.aLat = 0;
    this.rollRisk = 0; // 0..1
    this.rollTime = 0;
    this.rolled = false;
    this.setLoad(trailer, cargoKg);
  }

  /** Choose the trailer ('none' = bobtail) and the cargo it carries (kg). */
  setLoad(trailer, cargoKg = 0) {
    this.trailer = SPEC.trailerMass[trailer] === undefined ? 'dryvan' : trailer;
    this.cargo = this.trailer === 'none' ? 0 : cargoKg;
  }

  get mass() {
    return SPEC.tractorMass + SPEC.trailerMass[this.trailer] + this.cargo;
  }

  /** Centre-of-gravity height of the loaded rig (m), for rollover. */
  get cg() {
    const f = SPEC.trailerMass[this.trailer] ? this.cargo / (this.cargo + 12000) : 0;
    return SPEC.emptyCg + (SPEC.cargoCg[this.trailer] - SPEC.emptyCg) * f + 0.25 * f;
  }

  /** Lateral acceleration (m/s²) at which the rig starts to lift a wheel. */
  get rollThreshold() {
    return (G * (SPEC.track / 2)) / this.cg * 0.86;
  }

  gearRatio(g = this.gear) {
    if (g === 0) return 0;
    return (g < 0 ? SPEC.reverse : SPEC.gears[g - 1]) * SPEC.final;
  }

  /** Reset the pose (heading) with the trailer straight behind. */
  place(theta) {
    this.theta = this.thetaT = theta;
    this.v = 0;
    this.delta = 0;
    this.rolled = false;
    this.rollTime = 0;
    this.jack = 0;
  }

  /** Kingpin and trailer-axle offsets from R in world metres. */
  geometry(x, z) {
    const a = SPEC.fifthA, Lt = SPEC.kingToAxle;
    const kx = x + a * Math.cos(this.theta), kz = z - a * Math.sin(this.theta);
    const tx = kx - Lt * Math.cos(this.thetaT), tz = kz + Lt * Math.sin(this.thetaT);
    return { kx, kz, tx, tz };
  }

  /** Steering lock available at speed v: tight at a crawl, limited so the rig does not roll in normal driving. */
  steerLimit(v, safety = 1) {
    const L = SPEC.wheelbase;
    const aMax = this.rollThreshold * 0.9 * safety;
    const lim = v > 2 ? Math.atan((L * aMax) / (v * v)) : SPEC.maxSteer;
    return Math.min(SPEC.maxSteer, Math.max(0.03, lim));
  }

  shiftTo(g) {
    if (g === this.gear) return;
    this.gear = g;
    this.shiftT = 0.45;
  }

  /**
   * Advance by h seconds. input: { throttle 0..1, brake 0..1, steer -1..1 (+ = left), gearReq 'D'|'R'|'N', up, down }.
   * env: { mu, crr, grade (sin of slope, + uphill), safety (1 = assisted, >1 = free), park }.
   */
  step(h, input, env) {
    const S = SPEC;
    const m = this.mass;
    let { throttle = 0, brake = 0 } = input;
    const mu = env.mu ?? 0.8;
    // fuel cut when empty
    if (this.fuel <= 0.05) throttle = 0;
    // direction selector (changed only when nearly stopped)
    if (input.gearReq === 'R' && this.gear > 0 && Math.abs(this.v) < 0.6) this.gear = -1;
    else if (input.gearReq === 'D' && this.gear <= 0 && Math.abs(this.v) < 0.6) this.gear = 1;
    else if (input.gearReq === 'N' && Math.abs(this.v) < 0.6) this.gear = 0;
    if (!this.auto && this.gear > 0) {
      if (input.up && this.gear < 10) this.shiftTo(this.gear + 1);
      if (input.down && this.gear > 1) this.shiftTo(this.gear - 1);
    }
    this.shiftT = Math.max(0, this.shiftT - h);
    // engine speed follows the wheels through the clutch; below idle the clutch slips
    const g = this.gearRatio();
    const wheelRpm = (Math.abs(this.v) / S.wheelR) * (60 / (2 * Math.PI));
    const rpmRaw = wheelRpm * Math.abs(g);
    let rpm = Math.max(S.idleRpm + 120 * throttle, rpmRaw);
    rpm = Math.min(rpm, S.govRpm);
    this.rpm += (rpm - this.rpm) * Math.min(1, h * 12);
    // automatic gearbox
    if (this.auto && this.gear > 0 && this.shiftT <= 0) {
      const up = 1380 + 480 * throttle, down = 820 + 220 * throttle;
      if (this.rpm > up && this.gear < 10 && throttle > 0.02) this.shiftTo(this.gear + 1);
      else if (this.rpm > up + 250 && this.gear < 10) this.shiftTo(this.gear + 1);
      else if (rpmRaw < down && this.gear > 1) this.shiftTo(this.gear - 1);
      else if (throttle > 0.85 && rpmRaw < 1250 && this.gear > 1 && this.v > 1) this.shiftTo(this.gear - 1);
    }
    // engine torque and drive force
    let T = torqueAt(this.rpm) * throttle;
    if (rpmRaw < S.idleRpm * 0.85 && Math.abs(g) > 0 && this.gear !== 1 && this.gear !== -1) T *= clamp((rpmRaw - 300) / 400, 0.15, 1); // lugging
    if (this.shiftT > 0 || this.gear === 0) T = 0;
    if (this.rpm >= S.govRpm - 20) T = 0;
    const dir = this.gear < 0 ? -1 : 1;
    let Fdrive = (T * Math.abs(g) * S.eff) / S.wheelR * dir;
    const Ftrac = mu * m * G * 0.44;
    this.spinning = Math.abs(Fdrive) > Ftrac ? Math.min(1, (Math.abs(Fdrive) - Ftrac) / Ftrac) : 0;
    Fdrive = clamp(Fdrive, -Ftrac, Ftrac);
    // brakes: air builds pressure, fades when hot, weakens when the tanks run low
    const target = clamp(brake, 0, 1);
    this.brakeP += (target - this.brakeP) * Math.min(1, h * (target > this.brakeP ? 5 : 8));
    const airK = clamp(this.air / 65, 0.25, 1);
    this.fade = clamp((this.brakeTemp - 260) / 260, 0, 0.75);
    const Fb = this.brakeP * Math.min(mu * 0.95, S.brakeG) * m * G * (1 - this.fade) * airK;
    // engine brake (compression release), strongest at high rpm, off when on the throttle
    const Feb = this.engineBrake && throttle < 0.05 && this.gear > 0 && this.shiftT <= 0 ? Math.min(0.12 * m * G, (260e3 * (this.rpm / 2100) ** 2) / Math.max(Math.abs(this.v), 4)) : 0;
    // resistances
    const crr = (env.crr ?? 0.012) * 0.55;
    const sgn = this.v > 0.01 ? 1 : this.v < -0.01 ? -1 : 0;
    const Fres = sgn * (crr * m * G + 0.5 * 1.2 * S.cdA * this.v * this.v) + m * G * (env.grade ?? 0);
    let a = (Fdrive - Fres - sgn * (Fb + Feb)) / m;
    const park = env.park ?? this.park;
    if (park) {
      const hold = 0.5 * m * G * mu;
      if (Math.abs(this.v) < 0.4 && Math.abs(Fdrive) < hold) {
        this.v = 0;
        a = 0;
      } else a -= sgn * 0.45 * mu * G;
    }
    // stopping with the service brake
    const vNew = this.v + a * h;
    if ((this.v > 0 && vNew < 0 && (brake > 0.05 || Fdrive <= 0)) || (this.v < 0 && vNew > 0 && (brake > 0.05 || Fdrive >= 0))) {
      this.v = 0;
      if (Math.abs(Fdrive) < Math.abs(Fres) + 800 && this.gear !== 0) a = 0;
    } else this.v = vNew;
    this.v = clamp(this.v, -6, 29);
    // grade that the brakes cannot hold: the park brake and the slope fight; free roll otherwise
    this.a = a;
    // brake heat and air consumption
    const Pb = (Fb + Feb * 0.0) * Math.abs(this.v);
    this.brakeTemp += ((Pb * h) / 1.2e5) - (this.brakeTemp - 40) * (0.004 + 0.0007 * Math.abs(this.v)) * h;
    this.air = clamp(this.air + (3.4 + 1.2 * (this.rpm / 2100)) * h - this.brakeP * 4.2 * h, 0, 128);
    // steering and yaw
    const lim = this.steerLimit(Math.abs(this.v), env.safety ?? 1);
    const dTarget = clamp(input.steer ?? 0, -1, 1) * lim;
    const rate = 0.95 / (1 + Math.abs(this.v) * 0.04);
    this.delta += clamp(dTarget - this.delta, -rate * h, rate * h);
    const Ku = 0.0012;
    let yr = (this.v * Math.tan(this.delta)) / (S.wheelbase * (1 + Ku * this.v * this.v));
    const latMax = mu * G * 0.85;
    this.skid = 0;
    if (Math.abs(this.v * yr) > latMax) {
      yr = (Math.sign(yr) * latMax) / Math.max(Math.abs(this.v), 0.1);
      this.skid = 1;
    }
    this.yawRate = yr;
    this.theta += yr * h;
    // trailer: kingpin kinematics (backing is naturally unstable)
    if (this.trailer !== 'none') {
      const phi = this.theta - this.thetaT;
      const dT = (this.v * Math.sin(phi) + S.fifthA * yr * Math.cos(phi)) / S.kingToAxle;
      this.thetaT += dT * h;
      const jackAng = wrapPi(this.theta - this.thetaT);
      this.jack = clamp(Math.abs(jackAng) / S.jackLimit, 0, 1.2);
      if (Math.abs(jackAng) > S.jackLimit) {
        this.thetaT = this.theta - Math.sign(jackAng) * S.jackLimit;
        this.v *= 0.9;
        this.jacked = true;
      } else this.jacked = false;
    } else {
      this.thetaT = this.theta;
      this.jack = 0;
    }
    // rollover margin
    const aTrailer = this.trailer !== 'none' ? (this.v * this.v * Math.abs(Math.sin(this.theta - this.thetaT))) / S.kingToAxle : 0;
    this.aLat = Math.max(Math.abs(this.v * yr), aTrailer);
    this.rollRisk = clamp(this.aLat / this.rollThreshold, 0, 1.5);
    if (this.rollRisk > 1) this.rollTime += h;
    else this.rollTime = Math.max(0, this.rollTime - h * 2);
    if (this.rollTime > 0.45 && !this.rolled) this.rolled = true;
    // fuel (L): specific consumption ≈ 0.24 L/kWh plus idle
    const P = (T * ((this.rpm * 2 * Math.PI) / 60)) / 1000;
    const flow = (P * 0.24) / 3600 + 0.0011;
    this.fuel = Math.max(0, this.fuel - flow * this.fuelScale * h);
    this.fuelFlowLph = flow * 3600 * this.fuelScale;
    this.torque = T;
    this.driveForce = Fdrive;
    this.brakeForce = Fb;
    return { yawRate: yr, aLat: this.aLat };
  }
}
