// Drive mode. A kinematic bicycle model with longitudinal dynamics sized from the van itself:
// laden mass from the weight model, 2.0 L diesel power, frontal area of the high roof, rolling
// resistance and grip that change with the surface (road, track, grass, sand, mud, snow, lake ice).
// The van stays at the scene origin; the land is moved underneath (floating origin).
//
// Driver aids (Easy / Standard / Pro), cruise control, a limiter that follows the posted limit,
// smoothed pedals and steering, an explicit D/R selector, reset-to-road, gamepad and tilt input.
import * as THREE from 'three';
import { weightReport } from '../sim/weight.js';
import { SURFACES } from './land.js';
import { Rig, SPEC } from '../sim/truck.js';
import { TruckRig } from './truck.js';

const L = 4.325; // wheelbase
const TRACK = 1.73;
const R_WHEEL = 0.395;
const G = 9.81;
const POWER = 125e3; // W at the wheels (2.0 L OM654, ≈ 155 kW at the crank)
const F_MAX = 9800; // N, traction/torque limit in first gear
const CDA = 0.37 * 4.6; // Cd × frontal area (high roof)
const RHO = 1.2;
const DELTA_MAX = 0.5; // rad road-wheel angle (≈ 15.6 m turning circle)
const V_MAX = 38; // m/s governed (≈ 137 km/h)

export const CAMERA_MODES = ['chase', 'cockpit', 'orbit', 'cinematic'];
const SEMI_CAMERA_MODES = ['chase', 'cockpit', 'trailer', 'orbit', 'cinematic'];
const CAM_LABEL = { chase: 'Chase', cockpit: 'Cockpit', orbit: 'Orbit', cinematic: 'Cinematic', trailer: 'Trailer cam' };

/** Driver-aid presets. Easy keeps the van on the road and out of trouble; Pro is the raw model. */
export const ASSISTS = {
  easy: { label: 'Easy', lane: 1, tc: 1, stab: 1, steerFade: 32, minSteer: 0.2, pedal: 2.6, forgive: 0.5, curve: 1.35, hold: true },
  standard: { label: 'Standard', lane: 0, tc: 0.5, stab: 0.5, steerFade: 40, minSteer: 0.3, pedal: 4, forgive: 1, curve: 1.15, hold: true },
  pro: { label: 'Pro', lane: 0, tc: 0, stab: 0, steerFade: 52, minSteer: 0.38, pedal: 9, forgive: 1.4, curve: 1, hold: false },
};

/** Posted limits (km/h) by road class; null off the road network. */
const LIMIT_KMH = { interstate: 129, highway: 105, county: 89, gravel: 56, dirt: 32 };
const STREET_LIMIT_KMH = 40;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (v, t, up, down, dt) => (t > v ? Math.min(t, v + up * dt) : Math.max(t, v - down * dt));

export class Driver {
  constructor(world) {
    this.world = world;
    this.mass = weightReport().gvw;
    this.active = false;
    this.ready = false; // true once everything is stowed for travel
    const H = world.gen.home;
    this.x = H.x;
    this.z = H.z;
    this.yaw = H.yaw;
    this.v = 0;
    this.delta = 0;
    this.spin = 0;
    this.odo = 0;
    this.trip = 0;
    this.camMode = 'chase';
    this.camYaw = 0;
    this.camLook = 0;
    this.camT = 0;
    this.lights = 'auto';
    this.pitch = 0;
    this.roll = 0;
    this.dyn = { p: 0, pv: 0, r: 0, rv: 0, h: 0, hv: 0 };
    this.aLong = 0;
    this.yawRate = 0;
    this.surface = SURFACES.asphalt;
    this.surfaceKey = 'asphalt';
    this.slope = 0;
    this.braking = false;
    this.events = [];
    this.trail = [];
    this.keys = new Set();
    this.pad = { throttle: 0, brake: 0, steer: 0, hand: 0 };
    this.cfg = { assist: 'standard', steerSens: 1, tilt: false, tiltInvert: false, camShake: 1, units: 'mph' };
    this.gearSel = 'D';
    this.cruise = { on: false, v: 0, i: 0 };
    this.limiter = false;
    this.limitKmh = null;
    this.limitT = 0;
    this.steerIn = 0;
    this.thrIn = 0;
    this.brkIn = 0;
    this.tiltSteer = 0;
    this.hornT = 0;
    this.slip = 0; // 0..1 lateral slide
    this.spinning = 0; // 0..1 wheelspin
    this.lock = 0; // 0..1 braking hard on a loose surface
    this.washboard = 0;
    this.lastRoad = null; // { x, z, yaw } of the last time the van was on a road
    this.road = null; // nearest road info while on or near one
    this.colCache = { rects: [], circles: [], x: 1e9, z: 1e9 };
    this.gamepad = null;
    this.vehicle = 'camper'; // 'camper' | 'semi'
    this.rig = new Rig('dryvan', 14000);
    this.truck = null; // visual semi, built on first use
    this.semi = { trailer: 'dryvan', cargo: 14000, name: 'BIG SKY FREIGHT', style: 2, cargoLook: 'lumber', tint: [0.9, 0.9, 0.88], trailerTint: [0.92, 0.92, 0.9] };
    this.parkBrake = false;
    this.rollAmt = 0;
    const onKey = (e) => {
      if (!this.active || e.target.closest?.('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      const mapped = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '];
      if (mapped.includes(k)) {
        if (e.type === 'keydown') this.keys.add(k);
        else this.keys.delete(k);
        e.preventDefault();
      }
      if (e.type !== 'keydown' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'c') this.cycleCamera();
      else if (k === 'l') this.cycleLights();
      else if (k === 'v') this.toggleCruise();
      else if (k === 'b') this.toggleLimiter();
      else if (k === 'r') this.toggleGear();
      else if (k === 't') this.resetToRoad();
      else if (k === 'q') this.honk();
      else if (this.vehicle === 'semi' && this.semiKey(k)) {
        /* handled */
      }
      else if (k === '=' || k === '+') this.nudgeCruise(+5);
      else if (k === '-' || k === '_') this.nudgeCruise(-5);
      this.onKeyAction?.(k);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('deviceorientation', (e) => this.onTilt(e));
    // headlight beams (intensity 0 until needed; kept in the scene to avoid shader recompiles)
    this.beams = [];
    for (const s of [-1, 1]) {
      const l = new THREE.SpotLight(0xfff1dc, 0, 75, 0.42, 0.55, 1.15);
      l.position.set(5.2, 0.95, s * 0.72);
      l.target.position.set(24, -0.6, s * 1.6);
      world.vanRoot.add(l, l.target);
      this.beams.push(l);
    }
  }

  get assist() {
    return ASSISTS[this.cfg.assist] || ASSISTS.standard;
  }

  setConfig(c) {
    Object.assign(this.cfg, c);
  }

  enter() {
    this.active = true;
    this.v = 0;
    this.camYaw = this.yaw;
    this.trail = [[this.x, this.z]];
    this.cruise.on = false;
    this.gearSel = 'D';
    this.steerIn = this.thrIn = this.brkIn = 0;
    if (this.vehicle !== 'semi' && this.camMode === 'trailer') this.camMode = 'chase';
    this.applyVehicle();
    this.world.stage.controls.enabled = this.camMode === 'orbit';
  }

  exit() {
    this.active = false;
    this.v = 0;
    this.keys.clear();
    this.cruise.on = false;
    this.pad.throttle = this.pad.brake = this.pad.steer = this.pad.hand = 0;
    this.world.stage.controls.enabled = true;
    this.world.stage.controls.target.set(1.8, 1.3, 0);
    for (const b of this.beams) b.intensity = 0;
    this.world.vanRoot.visible = true;
    this.truck?.hide();
  }

  cycleCamera() {
    const modes = this.vehicle === 'semi' ? SEMI_CAMERA_MODES : CAMERA_MODES;
    this.camMode = modes[(modes.indexOf(this.camMode) + 1) % modes.length];
    this.world.stage.controls.enabled = this.camMode === 'orbit';
    if (this.camMode === 'orbit') {
      this.world.stage.controls.target.set(1.8, 1.3, 0);
      this.world.stage.camera.position.set(-6, 3.5, 7);
    }
    return CAM_LABEL[this.camMode];
  }

  cycleLights() {
    this.lights = { auto: 'on', on: 'off', off: 'auto' }[this.lights];
    return this.lights;
  }

  toggleCruise() {
    const c = this.cruise;
    if (c.on) c.on = false;
    else if (this.v > 2.5 && this.gearSel === 'D') {
      c.on = true;
      c.v = this.v;
      c.i = 0;
    } else this.onEvent?.('cruiseLow');
    this.onKeyAction?.('cruise');
    return c.on;
  }

  nudgeCruise(kmh) {
    if (this.cruise.on) this.cruise.v = Math.max(3, Math.min(V_MAX, this.cruise.v + kmh / 3.6));
    else if (this.limiter) this.limiterOffset = (this.limiterOffset || 0) + kmh;
  }

  toggleLimiter() {
    this.limiter = !this.limiter;
    this.limiterOffset = 0;
    this.onKeyAction?.('limiter');
    return this.limiter;
  }

  toggleGear() {
    if (Math.abs(this.v) > 1.5) return this.gearSel;
    this.gearSel = this.gearSel === 'D' ? 'R' : 'D';
    this.cruise.on = false;
    this.onKeyAction?.('gear');
    return this.gearSel;
  }

  honk() {
    this.hornT = 0.45;
    this.onHorn?.();
  }

  /** Engine speed from a 9-speed automatic with fixed shift bands (for the tachometer and sound). */
  rpm(throttle = 0) {
    if (this.vehicle === 'semi') return this.rig.rpm;
    const kmh = Math.abs(this.v) * 3.6;
    if (kmh < 2) return 760 + throttle * 600;
    const bands = [0, 18, 32, 46, 60, 75, 90, 105, 122, 145];
    let i = 0;
    while (i < bands.length - 2 && kmh > bands[i + 1]) i++;
    const f = Math.min(1, (kmh - bands[i]) / (bands[i + 1] - bands[i]));
    return 1050 + f * 1250 + throttle * 220;
  }

  gear() {
    if (!this.active) return 'P';
    if (this.vehicle === 'semi') return this.rig.gear < 0 ? 'R' : this.rig.gear === 0 ? 'N' : String(this.rig.gear);
    if (this.v > 0.15) return 'D';
    if (this.v < -0.15) return 'R';
    if (this.gearSel === 'R' || this.lastInput?.throttle < 0) return 'R';
    return this.lastInput?.throttle > 0 ? 'D' : 'N';
  }

  camLabel() {
    return CAM_LABEL[this.camMode];
  }

  /** Teleport back to the starting camp beside the highway. */
  home() {
    const H = this.world.gen.home;
    this.place(H.x, H.z, H.yaw);
    this.trail = [[H.x, H.z]];
  }

  place(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.camYaw = yaw;
    this.v = 0;
    this.delta = 0;
    this.cruise.on = false;
    this.gearSel = 'D';
    this.colCache.x = 1e9;
    this.rig.place(yaw);
    this.rollAmt = 0;
    this.world.fx?.clear();
  }

  /**
   * Put the van back on the nearest road, in the right-hand lane, pointing the way it was already
   * heading. Searches outward in rings; returns the road name (or null if none within ~1.4 km).
   */
  resetToRoad() {
    const W = this.world.gen;
    W.buildEdgesFor(this.x - 1500, this.z - 1500, this.x + 1500, this.z + 1500, Infinity);
    let best = null;
    for (let r = 0; r <= 1400 && !best; r += 24) {
      const n = r === 0 ? 1 : Math.max(6, Math.ceil((r * 2 * Math.PI) / 40));
      let bd = 1e9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const q = W.roadAt(this.x + Math.cos(a) * r, this.z + Math.sin(a) * r);
        if (!q) continue;
        const px = this.x + Math.cos(a) * r, pz = this.z + Math.sin(a) * r;
        const ex = px - q.d * 0, d = Math.hypot(r, 0) + q.d; // ring distance is a fair ordering key
        void ex;
        if (d < bd && q.d < 60 + r) {
          bd = d;
          best = { q: { ...q }, px, pz };
        }
      }
    }
    if (!best) {
      this.onEvent?.('noRoad');
      return null;
    }
    // snap to the road centre line, then step into the right-hand lane
    const { q } = best;
    const e = q.edge, k = q.k;
    const cx = e.xs[k] + (e.xs[k + 1] - e.xs[k]) * q.t, cz = e.zs[k] + (e.zs[k + 1] - e.zs[k]) * q.t;
    const head = [Math.cos(this.yaw), -Math.sin(this.yaw)];
    const s = head[0] * q.tx + head[1] * q.tz >= 0 ? 1 : -1;
    const tx = q.tx * s, tz = q.tz * s;
    const off = e.P.width * 0.22;
    const x = cx + -tz * off, z = cz + tx * off;
    this.place(x, z, Math.atan2(-tz, tx));
    this.trail.push([x, z]);
    this.onEvent?.('reset');
    return e.name;
  }

  // ── Semi truck ─────────────────────────────────────────────────────────────
  /** Show the right vehicle for the current `vehicle` (camper van or articulated semi). */
  applyVehicle() {
    const semi = this.vehicle === 'semi';
    this.world.vanRoot.visible = !semi;
    if (!semi) {
      this.truck?.hide();
      return;
    }
    this.truck ||= new TruckRig(this.world);
    const S = this.semi;
    this.rig.setLoad(S.trailer, S.cargo);
    this.truck.setTrailer(S.trailer, S);
    this.truck.setTint(S.tint, S.trailerTint);
    this.rig.place(this.yaw);
    this.rig.park = false;
    this.rollAmt = 0;
    for (const b of this.beams) b.intensity = 0;
  }

  setVehicle(kind, opts = {}) {
    Object.assign(this.semi, opts);
    this.vehicle = kind;
    if (kind !== 'semi' && this.camMode === 'trailer') this.camMode = 'chase';
    if (this.active) this.applyVehicle();
  }

  /** Steering-lock safety factor: Easy keeps the rig upright, Pro lets you roll it. */
  safety() {
    return this.cfg.assist === 'easy' ? 1 : this.cfg.assist === 'standard' ? 1.3 : 2.2;
  }

  /** Semi-only keys: E engine brake, P park brake, G auto/manual, X/Z shift up/down. */
  semiKey(k) {
    const rig = this.rig;
    if (k === 'e') {
      rig.engineBrake = !rig.engineBrake;
      this.onKeyAction?.('enginebrake');
    } else if (k === 'p') {
      this.parkBrake = !this.parkBrake;
      this.onKeyAction?.('park');
    } else if (k === 'g') {
      rig.auto = !rig.auto;
      this.onKeyAction?.('auto');
    } else if (k === 'x') this.pendingShift = 1;
    else if (k === 'z') this.pendingShift = -1;
    else return false;
    return true;
  }

  stepSemi(h, inp) {
    const T = this.world.terrain, rig = this.rig, A = this.assist;
    if (rig.rolled) {
      this.v = rig.v = 0;
      this.noteRoll();
      return;
    }
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const sf = T.surfaceAt(this.x + SPEC.wheelbase * c, this.z - SPEC.wheelbase * s);
    this.surface = sf;
    this.surfaceKey = sf.key;
    const thr = this.gearSel === 'R' ? Math.max(0, -inp.throttle) : Math.max(0, inp.throttle);
    if (this.parkBrake && thr > 0.3 && A.hold) this.parkBrake = false;
    const holding = this.parkBrake || (A.hold && thr === 0 && inp.brake < 0.05 && Math.abs(this.v) < 0.3);
    rig.v = this.v;
    rig.theta = this.yaw;
    const sh = this.pendingShift || 0;
    this.pendingShift = 0;
    const out = rig.step(h, { throttle: thr, brake: inp.brake, steer: inp.steer, gearReq: this.gearSel, up: sh > 0, down: sh < 0 }, { mu: sf.mu, crr: sf.crr, grade: Math.sin(this.pitch), safety: this.safety(), park: holding });
    this.v = rig.v;
    if (sf.key === 'water' && this.v > 0) {
      this.v = rig.v = 0;
      this.emit('deep');
    }
    this.delta = rig.delta;
    this.yawRate = out.yawRate;
    this.aLong = rig.a || 0;
    this.slip = Math.max(this.slip, rig.skid ? 1 : 0);
    this.spinning = Math.max(this.spinning, rig.spinning || 0);
    if (inp.brake > 0.7 && Math.abs(this.v) > 6 && sf.mu < 0.5) this.lock = Math.max(this.lock, 0.6);
    const ym = (this.yaw + rig.theta) / 2;
    this.yaw = rig.theta;
    this.x += Math.cos(ym) * this.v * h;
    this.z -= Math.sin(ym) * this.v * h;
    this.collide();
    this.spin += (this.v * h) / 0.52;
    const dist = Math.abs(this.v * h);
    this.odo += dist;
    this.trip += dist;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(this.x - last[0], this.z - last[1]) > 4) {
      this.trail.push([this.x, this.z]);
      if (this.trail.length > 900) this.trail.shift();
    }
    if (rig.jack > 0.82) this.emit('jackknife');
    if (rig.rollRisk > 0.75) this.emit('tipping');
    if (rig.rolled) this.noteRoll();
    this.noFuel = rig.fuel <= 0.05;
  }

  noteRoll() {
    if (!this.rollSide) this.rollSide = Math.sign(this.yawRate) || 1;
    this.emit('rollover');
  }

  poseSemi(dt) {
    const W = this.world, rig = this.rig;
    if (!rig.rolled) this.rollSide = 0;
    const goal = rig.rolled ? this.rollSide * 1.5 : 0;
    this.rollAmt += (goal - this.rollAmt) * (1 - Math.exp(-dt * (rig.rolled ? 2.2 : 8)));
    const night = W.stage.night || W.stage.sunScene.y < 0.08;
    const head = this.lights === 'on' || (this.lights === 'auto' && night);
    this.truck.update(dt, this, rig, W.terrain, this.groundH, { cockpit: this.camMode === 'cockpit', lights: { head, brake: this.braking }, units: this.cfg.units, rolled: this.rollAmt });
  }

  cameraSemi(dt, lag, gh, cam, ctl) {
    const tr = this.truck;
    const mode = this.camMode;
    const tall = cam.aspect < 0.8;
    if (mode === 'chase') {
      const dist = 25 + Math.min(6, Math.abs(this.v) * 0.2) + (tall ? 6 : 0);
      const px = 3 - dist * Math.cos(lag), pz = -dist * Math.sin(lag);
      const y = Math.max(7.2 + Math.min(1.5, Math.abs(this.v) * 0.04) + (tall ? 1.8 : 0), gh(px, pz) + 1.6);
      cam.position.set(px, y, pz);
      ctl.target.set(8 + (tall ? 22 : 10), 1.6, this.camLook * 2);
      cam.lookAt(ctl.target);
    } else if (mode === 'cockpit') {
      tr.tractor.updateMatrixWorld(true);
      cam.position.copy(tr.tractor.localToWorld(new THREE.Vector3(2.72, 2.62, -0.55)));
      const t = tr.tractor.localToWorld(new THREE.Vector3(30, 2.2, -0.55 + this.delta * 6));
      ctl.target.copy(t);
      cam.lookAt(t);
    } else if (mode === 'trailer') {
      tr.trailerTilt.updateMatrixWorld(true);
      const back = tr.hasTrailer ? tr.trailerTilt : tr.tractor;
      const bx = tr.hasTrailer ? -17.4 : -3.5;
      cam.position.copy(back.localToWorld(new THREE.Vector3(bx, 4.6, 0)));
      const t = back.localToWorld(new THREE.Vector3(bx - 40, 1.0, 0));
      ctl.target.copy(t);
      cam.lookAt(t);
    } else if (mode === 'cinematic') {
      this.camT += dt * 0.1;
      const a = this.camT + lag;
      const px = -5 + Math.cos(a) * 22, pz = Math.sin(a) * 22;
      cam.position.set(px, Math.max(3 + Math.sin(this.camT * 0.7) * 1.2, gh(px, pz) + 1.4), pz);
      ctl.target.set(-4, 1.8, 0);
      cam.lookAt(ctl.target);
    }
  }

  // ── Input ──────────────────────────────────────────────────────────────────
  onTilt(e) {
    if (!this.cfg.tilt || !this.active || e.gamma == null) return;
    const ang = (screen.orientation?.angle ?? window.orientation ?? 0) | 0;
    let tilt;
    if (ang === 90) tilt = -(e.beta ?? 0);
    else if (ang === 270 || ang === -90) tilt = e.beta ?? 0;
    else tilt = e.gamma ?? 0;
    if (this.cfg.tiltInvert) tilt = -tilt;
    const dead = 3, full = 32;
    const m = Math.max(0, Math.abs(tilt) - dead) / (full - dead);
    this.tiltSteer = -Math.sign(tilt) * Math.min(1, m) ** 1.4;
  }

  pollGamepad() {
    const gps = navigator.getGamepads?.() || [];
    const gp = [...gps].find((g) => g && g.connected);
    if (!gp) return (this.gamepad = null);
    const b = (i) => gp.buttons[i]?.value || 0;
    const ax = gp.axes[0] || 0;
    const dz = 0.12;
    const st = Math.abs(ax) < dz ? 0 : Math.sign(ax) * ((Math.abs(ax) - dz) / (1 - dz)) ** 1.5;
    const pressed = (i) => !!gp.buttons[i]?.pressed;
    const prev = this.gamepad?.prev || [];
    const edge = (i) => pressed(i) && !prev[i];
    if (edge(3)) this.cycleCamera();
    if (edge(2)) this.cycleLights();
    if (edge(1)) this.toggleGear();
    if (edge(4)) this.toggleCruise();
    if (edge(5)) this.toggleLimiter();
    if (edge(9)) this.resetToRoad();
    if (edge(10)) this.honk();
    this.gamepad = { steer: -st, throttle: b(7), brake: b(6), hand: pressed(0) ? 1 : 0, prev: gp.buttons.map((x) => x.pressed) };
    return this.gamepad;
  }

  /** Raw pedals/steering from every device, before smoothing and assists. */
  rawInput() {
    const k = this.keys;
    const gp = this.pollGamepad();
    let fwd = Math.max(this.pad.throttle, gp?.throttle || 0), back = Math.max(this.pad.brake, gp?.brake || 0);
    let steer = this.pad.steer || gp?.steer || 0;
    let keySteer = 0;
    if (k.has('w') || k.has('arrowup')) fwd = 1;
    if (k.has('s') || k.has('arrowdown')) back = 1;
    if (k.has('a') || k.has('arrowleft')) keySteer += 1;
    if (k.has('d') || k.has('arrowright')) keySteer -= 1;
    if (this.cfg.tilt && Math.abs(this.tiltSteer) > 0.01) steer = this.tiltSteer;
    return { fwd, back, steer, keySteer, hand: k.has(' ') || this.pad.hand > 0.5 || (gp?.hand || 0) > 0.5 };
  }

  input(dt = 1 / 60) {
    const raw = this.rawInput();
    const A = this.assist;
    // keyboard steering ramps up and snaps back faster than it builds, so taps are gentle
    const target = raw.keySteer !== 0 ? raw.keySteer : raw.steer;
    const analog = raw.keySteer === 0;
    const up = analog ? 20 : 2.4 + (this.cfg.steerSens - 1) * 1.2, down = analog ? 20 : 5.5;
    if (target * this.steerIn < 0 || Math.abs(target) < Math.abs(this.steerIn)) this.steerIn = approach(this.steerIn, target, down, down, dt);
    else this.steerIn = approach(this.steerIn, target, up, up, dt);
    let steer = Math.max(-1, Math.min(1, this.steerIn * this.cfg.steerSens));
    // pedals: soft ramps (Easy is the gentlest), reverse via the D/R selector or by holding brake at rest
    this.thrIn = approach(this.thrIn, raw.fwd, A.pedal, A.pedal * 3, dt);
    this.brkIn = approach(this.brkIn, raw.back, A.pedal * 1.6, A.pedal * 4, dt);
    const fwd = this.thrIn, back = this.brkIn;
    let throttle = 0, brake = 0;
    if (this.gearSel === 'R') {
      if (fwd > 0) {
        if (this.v > 0.4) brake = fwd;
        else throttle = -fwd * 0.6;
      }
      if (back > 0) brake = Math.max(brake, back);
    } else {
      if (fwd > 0) {
        if (this.v < -0.4) brake = fwd;
        else throttle = fwd;
      }
      if (back > 0) {
        if (this.v > 0.4) brake = Math.max(brake, back);
        else if (this.v > -0.4 && raw.back > 0.5 && this.holdRev > 0.5) throttle = -back * 0.6;
      }
    }
    // one-pedal reverse: brake to a stop, hold half a second, then back up (unless an aid says otherwise)
    if (raw.back > 0.5 && this.v < 0.4 && this.gearSel === 'D') this.holdRev = (this.holdRev || 0) + dt;
    else if (raw.back < 0.1) this.holdRev = 0;
    if (raw.hand) brake = 1;
    if (this.noFuel) {
      throttle = Math.min(throttle, 0);
      this.cruise.on = false;
    }
    // cruise control / limiter
    const c = this.cruise;
    if (c.on) {
      if (brake > 0.05 || raw.back > 0.1 || this.gearSel !== 'D') c.on = false;
      else {
        const err = c.v - this.v;
        c.i = Math.max(0, Math.min(0.6, c.i + err * 0.05 * dt));
        const cmd = Math.max(0, Math.min(1, 0.35 * err + c.i));
        throttle = Math.max(throttle, cmd);
        if (err < -2.2) brake = Math.max(brake, Math.min(0.35, -err * 0.07)); // long downhill: light braking
      }
    }
    const lim = this.speedCap();
    if (lim !== null && this.v > lim) {
      throttle = Math.min(throttle, 0);
      if (this.v > lim + 1.2) brake = Math.max(brake, Math.min(0.3, (this.v - lim) * 0.1));
    }
    // lane keeping: only on a road, only when the driver is not steering, fades out as they steer
    steer = this.laneAssist(steer, dt);
    // Easy: ease off before a curve that is too tight for the speed
    if (A.lane && this.curveVmax && this.v > this.curveVmax) {
      throttle = Math.min(throttle, 0);
      if (this.v > this.curveVmax + 1) brake = Math.max(brake, Math.min(0.4, (this.v - this.curveVmax) * 0.12));
      this.emit('curve');
    }
    return { throttle, brake, steer };
  }

  /** Active speed cap (m/s) from the limiter or null. */
  speedCap() {
    if (!this.limiter || this.limitKmh == null) return null;
    return Math.max(2, (this.limitKmh + (this.limiterOffset || 0)) / 3.6);
  }

  /**
   * Steering correction toward the right-hand lane centre (Easy only). It looks ahead along the road
   * for the curvature it needs (feed-forward) and trims heading and lane-position error; it backs
   * off completely as soon as the driver steers, and never engages away from the road.
   */
  laneAssist(steer, dt) {
    const A = this.assist;
    const r = this.road;
    this.curveVmax = null;
    if (!A.lane || !r || this.v < 4 || this.surface.kind !== 'road') return steer;
    const e = r.edge, w = e.P.width;
    if (r.d > w * 0.5 + 4) return steer;
    const head = [Math.cos(this.yaw), -Math.sin(this.yaw)];
    const s = head[0] * r.tx + head[1] * r.tz >= 0 ? 1 : -1;
    const psi = (k) => {
      const k0 = Math.max(0, Math.min(e.n - 2, k));
      return Math.atan2(-(e.zs[k0 + 1] - e.zs[k0]) * s, (e.xs[k0 + 1] - e.xs[k0]) * s);
    };
    const err = wrapPi(Math.atan2(-r.tz * s, r.tx * s) - this.yaw);
    if (Math.abs(err) > 0.9) return steer;
    // preview: heading change over the next ~1.3 s of road
    const stepLen = e.len / (e.n - 1);
    const ahead = Math.max(2, Math.round((this.v * 1.3) / stepLen));
    const kA = r.k + s * ahead;
    const dPsi = wrapPi(psi(kA) - Math.atan2(-r.tz * s, r.tx * s));
    const yrFF = dPsi / ((ahead * stepLen) / Math.max(this.v, 4));
    const kappa = Math.abs(dPsi) / Math.max(10, ahead * stepLen);
    if (kappa > 1e-4) this.curveVmax = Math.max(11, Math.sqrt((0.42 * this.surface.mu * G) / kappa));
    const lat = r.side * s - w * 0.22; // + = right of the target lane centre
    const yrCmd = yrFF + 0.9 * err + 0.05 * lat;
    // road-wheel angle that produces that yaw rate (inverse of the bicycle model), then to steer 0..1
    const semi = this.vehicle === 'semi';
    const delta = Math.atan((yrCmd * (semi ? SPEC.wheelbase : L) * (1 + (semi ? 0.0012 : 0.0022) * this.v * this.v)) / Math.max(this.v, 3));
    const speedK = semi ? 1 : Math.max(A.minSteer, 1 - Math.abs(this.v) / A.steerFade);
    const want = Math.max(-0.8, Math.min(0.8, delta / ((semi ? this.rig.steerLimit(this.v, this.safety()) : DELTA_MAX) * speedK)));
    const gain = Math.min(1, (this.v - 4) / 6) * (1 - Math.min(1, Math.abs(steer) / 0.3));
    return steer + want * gain * A.lane;
  }

  /** Terrain heights under the four tyres → pitch, roll and the ride height of the rear axle. */
  contact() {
    const T = this.world.terrain;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const at = (lx, lz) => T.heightAt(this.x + lx * c + lz * s, this.z - lx * s + lz * c);
    const semi = this.vehicle === 'semi';
    const WB = semi ? SPEC.wheelbase : L, TR = semi ? 1.9 : TRACK;
    const rl = at(0, -TR / 2), rr = at(0, TR / 2), fl = at(WB, -TR / 2), fr = at(WB, TR / 2);
    const hr = (rl + rr) / 2, hf = (fl + fr) / 2;
    return { h0: hr, pitch: Math.atan2(hf - hr, WB), roll: -Math.atan2((rr + fr) / 2 - (rl + fl) / 2, TR) };
  }

  /** Posted limit for the surface under the van (km/h), refreshed a few times a second. */
  updateLimit(dt) {
    this.limitT -= dt;
    if (this.limitT > 0) return;
    this.limitT = 0.25;
    const s = this.surface;
    if (s.kind === 'road') this.limitKmh = LIMIT_KMH[s.cls] ?? 56;
    else if (s.kind === 'street') this.limitKmh = STREET_LIMIT_KMH;
    else this.limitKmh = null;
  }

  update(dt) {
    const W = this.world, T = W.terrain;
    if (this.active) {
      const steps = Math.max(1, Math.ceil(dt / 0.01));
      const h = dt / steps;
      const inp = this.ready ? this.input(dt) : { throttle: 0, brake: 1, steer: 0 };
      this.lastInput = inp;
      this.braking = inp.brake > 0.05 || (this.v > 0.2 && inp.throttle < 0);
      this.road = T.roadAt(this.x, this.z) ? { ...T.roadAt(this.x, this.z) } : null;
      this.refreshColliders();
      this.slip = this.spinning = this.lock = 0;
      if (this.vehicle === 'semi') for (let i = 0; i < steps; i++) this.stepSemi(h, inp);
      else for (let i = 0; i < steps; i++) this.step(h, inp);
      this.updateLimit(dt);
      this.hornT = Math.max(0, this.hornT - dt);
      if (this.surface.kind === 'road' || this.surface.kind === 'street') this.lastRoad = { x: this.x, z: this.z, yaw: this.yaw };
    }
    // ground contact & body motion (also while parked, so the van sits on its terrain)
    const ct = this.contact();
    this.pitch = ct.pitch;
    this.roll = ct.roll;
    this.slope = Math.atan(Math.hypot(Math.tan(ct.pitch), Math.tan(ct.roll)));
    const d = this.dyn;
    const spring = (x, v, target, k, c) => {
      const a = k * (target - x) - c * v;
      return [x + (v + a * dt) * dt, v + a * dt];
    };
    // surface shake: washboard on gravel, ruts on tracks, tussocks on grass, smooth on pavement and snow
    const sk = this.surface.key;
    const sp = Math.min(1, Math.abs(this.v) / 12);
    const AMP = { gravel: 0.011, dirt: 0.016, grass: 0.012, forest: 0.016, sand: 0.012, rock: 0.02, mud: 0.018, snow: 0.006, packed: 0.005, shallow: 0.014, plowed: 0.002, county: 0.001 };
    const amp = this.active ? (AMP[sk] || 0) * sp * this.cfg.camShake : 0;
    this.washboard = amp;
    const t = performance.now();
    let target = amp * Math.sin(t / 70) * Math.sin(t / 113);
    if (sk === 'gravel' && this.active) target = amp * Math.sin(this.odo * 8.4 + Math.sin(this.odo * 0.37) * 2) * 1.2; // 0.75 m corrugations
    [d.p, d.pv] = spring(d.p, d.pv, this.aLong * 0.006, 60, 11);
    [d.r, d.rv] = spring(d.r, d.rv, Math.max(-0.05, Math.min(0.05, this.v * this.yawRate * 0.011)), 50, 9);
    [d.h, d.hv] = spring(d.h, d.hv, target, 220, 18);
    W.vanRoot.rotation.set(this.roll + d.r, 0, this.pitch + d.p, 'XZY');
    W.vanRoot.position.y = d.h;
    T.setView(this.x, this.z, ct.h0, this.yaw);
    T.update(this.x, this.z);
    W.stage.setYaw(this.yaw);
    this.groundH = ct.h0;
    if (this.vehicle === 'semi' && this.active) {
      this.poseSemi(dt);
      this.camera(dt);
      return;
    }
    // wheels: rolling and steering
    for (const w of W.body.parts.wheels) {
      w.wheel.rotation.z = (w.side > 0 ? -1 : 1) * this.spin;
      if (w.front) w.hub.rotation.y = this.delta;
    }
    // lights
    const night = W.stage.night || W.stage.sunScene.y < 0.08;
    const beamsOn = this.active && (this.lights === 'on' || (this.lights === 'auto' && night));
    for (const b of this.beams) b.intensity = beamsOn ? 38 : 0;
    W.M.tail.emissive.setHex(0xff1a1a);
    W.M.tail.emissiveIntensity = this.active ? (this.braking ? 2.6 : beamsOn ? 0.7 : 0.08) : 0.05;
    if (this.active) this.camera(dt);
  }

  step(h, inp) {
    const T = this.world.terrain;
    const A = this.assist;
    // surface under the front axle decides grip and rolling resistance
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const fx = this.x + 2.2 * c, fz = this.z - 2.2 * s;
    const sf = T.surfaceAt(fx, fz);
    this.surfaceKey = sf.key;
    this.surface = sf;
    const { crr, mu } = this.surface;
    // steering: rate-limited, softened with speed
    const speedK = Math.max(A.minSteer, 1 - Math.abs(this.v) / A.steerFade);
    const target = inp.steer * DELTA_MAX * speedK;
    this.delta += Math.max(-1.7 * h, Math.min(1.7 * h, target - this.delta));
    // longitudinal forces
    const m = this.mass;
    const grade = Math.sin(this.pitch); // + uphill
    const v = this.v;
    const gripLimit = mu * m * G * 0.62; // rear-wheel drive, ~62 % on the rear axle when laden
    let drive = Math.sign(inp.throttle) * Math.min(F_MAX, POWER / Math.max(Math.abs(v), 2.5)) * Math.abs(inp.throttle);
    // traction control trims torque to the grip available; without it the wheels spin (and so does the sound)
    if (Math.abs(drive) > gripLimit) {
      this.spinning = Math.max(this.spinning, Math.min(1, (Math.abs(drive) - gripLimit) / gripLimit));
      drive = Math.sign(drive) * (gripLimit + (Math.abs(drive) - gripLimit) * (1 - A.tc) * 0.5);
    }
    const resist = Math.sign(v) * (crr * m * G + 0.5 * RHO * CDA * v * v);
    let a = (drive - resist) / m - G * grade;
    if (inp.brake > 0) {
      const dec = Math.min(0.9, mu + 0.1) * G * inp.brake;
      if (inp.brake > 0.7 && Math.abs(v) > 6 && mu < 0.6) this.lock = Math.max(this.lock, Math.min(1, (0.62 - mu) * 2.5));
      if (Math.abs(v) < dec * h) {
        a = 0;
        this.v = 0;
      } else a -= Math.sign(v) * dec;
    }
    // parked on a slope: the parking brake holds unless the slope beats static friction
    if (inp.throttle === 0 && Math.abs(this.v) < 0.05 && Math.abs(grade) < mu * 0.6 && A.hold) {
      this.v = 0;
      a = 0;
    } else if (inp.throttle === 0 && Math.abs(this.v) < 0.05 && Math.abs(grade) < mu * 0.45) {
      this.v = 0;
      a = 0;
    }
    this.v = Math.max(-8, Math.min(V_MAX, this.v + a * h));
    // wheelspin on a grade steeper than the grip allows (rear-wheel drive, laden)
    if (Math.abs(inp.throttle) > 0.5 && Math.abs(this.v) < 0.6 && Math.sign(inp.throttle) * grade > gripLimit / (m * G) - crr) this.emit('stuck');
    // deep water ahead: refuse to ford beyond ~0.6 m
    if (sf.key === 'water' && this.v > 0) {
      this.v = 0;
      this.emit('deep');
    }
    // yaw: kinematic bicycle with an understeer gradient, capped by available lateral grip
    let yr = (this.v * Math.tan(this.delta)) / (L * (1 + 0.0022 * this.v * this.v));
    const latMax = mu * G * (0.95 - 0.12 * A.stab);
    if (Math.abs(this.v * yr) > latMax) {
      yr = (Math.sign(yr) * latMax) / Math.max(Math.abs(this.v), 0.1);
      this.slip = 1;
      if (Math.abs(this.v) > 10) this.emit('slide');
    } else this.slip = Math.max(this.slip, Math.min(1, Math.abs(this.v * yr) / latMax - 0.55) * 2.2);
    // side slope pushes a van sideways on low-grip ground (and the stability aid leans against it)
    const sideG = Math.sin(this.roll) * (1 - 0.7 * A.stab) * (mu < 0.5 ? 1 : 0.25);
    this.yawRate = yr;
    this.aLong = a;
    this.yaw += yr * h;
    this.x += c * this.v * h + s * sideG * 0.2 * G * h * h * 2;
    this.z -= s * this.v * h - c * sideG * 0.2 * G * h * h * 2;
    this.collide();
    this.spin += (this.v * h) / R_WHEEL * (1 + this.spinning * 2.2 * Math.sign(inp.throttle || 1) * (inp.throttle ? 1 : 0));
    const dist = Math.abs(this.v * h);
    this.odo += dist;
    this.trip += dist;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(this.x - last[0], this.z - last[1]) > 4) {
      this.trail.push([this.x, this.z]);
      if (this.trail.length > 900) this.trail.shift();
    }
  }

  /** Solid things within reach, refreshed once per frame (buildings, town trees, wild trees, boulders). */
  refreshColliders() {
    const cc = this.colCache;
    if (Math.hypot(this.x - cc.x, this.z - cc.z) < 6 && cc.t > performance.now() - 400) return;
    const tw = this.world.terrain.towns;
    const near = tw ? tw.collidersNear(this.x, this.z, 46) : { rects: [], circles: [] };
    const rs = this.world.terrain.roadside ? this.world.terrain.roadside.collidersNear(this.x, this.z, 46) : [];
    cc.rects = near.rects;
    cc.circles = near.circles.concat(rs).concat(this.world.terrain.colliders.filter((o) => Math.abs(o.x - this.x) < 46 && Math.abs(o.z - this.z) < 46).map((o) => ({ x: o.x, z: o.z, r: o.r, kind: o.kind })));
    cc.x = this.x;
    cc.z = this.z;
    cc.t = performance.now();
  }

  /** Footprint circles { x, z, r } in world coordinates: four along the van, or tractor plus trailer. */
  bodyPoints() {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    if (this.vehicle !== 'semi') return [-1.2, 0.6, 2.4, 4.3].map((lx) => ({ x: this.x + lx * c, z: this.z - lx * s, r: 1.02 }));
    const pts = [-1.2, 1.2, 3.4, 5.4, 7.0].map((lx) => ({ x: this.x + lx * c, z: this.z - lx * s, r: 1.3 }));
    if (this.rig.trailer !== 'none') {
      const g = this.rig.geometry(this.x, this.z);
      const hx = Math.cos(this.rig.thetaT), hz = -Math.sin(this.rig.thetaT);
      for (const d of [1.5, 4.5, 7.5, 10.5, 13.5, 15.4]) pts.push({ x: g.kx - hx * d, z: g.kz - hz * d, r: 1.35 });
    }
    return pts;
  }

  /** Solid things against the footprint circles. */
  collide() {
    const cc = this.colCache;
    const F = this.assist.forgive;
    const semi = this.vehicle === 'semi';
    const hit = (kind, weight) => {
      const sp = Math.abs(this.v);
      if (semi && sp > 1.5) {
        this.rig.damage = Math.min(100, this.rig.damage + sp * sp * 0.02 * weight);
        this.hitSpeed = sp;
      }
      this.emit(kind);
    };
    for (const q of this.bodyPoints()) {
      const px = q.x, pz = q.z, R = q.r;
      for (const o of cc.circles) {
        const dx = px - o.x, dz = pz - o.z;
        if (Math.abs(dx) > 5 || Math.abs(dz) > 5) continue;
        const d = Math.hypot(dx, dz), min = R + o.r;
        if (d < min && d > 1e-4) {
          const push = min - d;
          this.x += (dx / d) * push;
          this.z += (dz / d) * push;
          if (Math.abs(this.v) > 1.2) hit(o.kind || 'tree', 1);
          this.v *= -0.15 * F;
        }
      }
      for (const r of cc.rects) {
        const hx = r.w / 2, hz = r.d / 2;
        const cx = Math.max(r.x - hx, Math.min(r.x + hx, px)), cz = Math.max(r.z - hz, Math.min(r.z + hz, pz));
        const dx = px - cx, dz = pz - cz;
        const d = Math.hypot(dx, dz);
        if (d >= R) continue;
        let nx, nz, push;
        if (d > 1e-4) {
          nx = dx / d;
          nz = dz / d;
          push = R - d;
        } else {
          // centre inside the footprint: leave by the nearest face
          const ox = hx - Math.abs(px - r.x), oz = hz - Math.abs(pz - r.z);
          if (ox < oz) {
            nx = Math.sign(px - r.x) || 1;
            nz = 0;
            push = ox + R;
          } else {
            nx = 0;
            nz = Math.sign(pz - r.z) || 1;
            push = oz + R;
          }
        }
        this.x += nx * push;
        this.z += nz * push;
        if (Math.abs(this.v) > 1.5) hit('building', 2);
        this.v *= -0.1 * F;
      }
    }
    if (semi) this.rig.v = this.v;
  }

  emit(kind) {
    const now = performance.now();
    if (this.events.some((e) => e.kind === kind && now - e.t < 2500)) return;
    this.events.push({ kind, t: now });
    if (this.events.length > 8) this.events.shift();
    this.onEvent?.(kind);
  }

  camera(dt) {
    const cam = this.world.stage.camera, ctl = this.world.stage.controls;
    if (this.camMode === 'orbit') return;
    const k = 1 - Math.exp(-dt * 2.2);
    this.camYaw += (this.yaw - this.camYaw) * k;
    const lag = this.yaw - this.camYaw;
    // look into the turn a little
    this.camLook += (this.delta * Math.min(1, Math.abs(this.v) / 10) * 3.5 - this.camLook) * (1 - Math.exp(-dt * 3));
    const gh = (lx, lz) => this.world.terrain.heightAt(this.x + lx * Math.cos(this.yaw) + lz * Math.sin(this.yaw), this.z - lx * Math.sin(this.yaw) + lz * Math.cos(this.yaw)) - (this.groundH ?? 0);
    if (this.vehicle === 'semi') return this.cameraSemi(dt, lag, gh, cam, ctl);
    if (this.camMode === 'chase') {
      // tall (phone) screens: pull back and look further down the road so the van sits low in the frame
      const tall = cam.aspect < 0.8;
      const dist = 10.5 + Math.min(4, Math.abs(this.v) * 0.08) + (tall ? 2.5 : 0);
      const px = 2 - dist * Math.cos(lag), pz = -dist * Math.sin(lag);
      const y = Math.max(3.7 + Math.min(1.2, Math.abs(this.v) * 0.03) + (tall ? 0.9 : 0), gh(px, pz) + 1.4); // never inside a hill
      cam.position.set(px, y, pz);
      ctl.target.set(4.2 + (tall ? 14 : 5), tall ? 1.2 : 1.5, this.camLook * 1.6);
      cam.lookAt(ctl.target);
    } else if (this.camMode === 'cockpit') {
      const vr = this.world.vanRoot;
      vr.updateMatrixWorld();
      cam.position.copy(vr.localToWorld(new THREE.Vector3(3.42, 1.93, -0.43)));
      const t = vr.localToWorld(new THREE.Vector3(14, 1.2, -0.43 + this.delta * 3));
      ctl.target.copy(t);
      cam.lookAt(t);
    } else if (this.camMode === 'cinematic') {
      this.camT += dt * 0.12;
      const a = this.camT + lag;
      const px = 2 + Math.cos(a) * 10.5, pz = Math.sin(a) * 10.5;
      cam.position.set(px, Math.max(1.9 + Math.sin(this.camT * 0.7) * 0.6, gh(px, pz) + 1.2), pz);
      ctl.target.set(2, 1.2, 0);
      cam.lookAt(ctl.target);
    }
  }
}
