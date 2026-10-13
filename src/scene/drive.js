// Drive mode. A kinematic bicycle model with longitudinal dynamics sized from the van itself:
// laden mass from the weight model, 2.0 L diesel power, frontal area of the high roof, rolling
// resistance and grip that change with the surface (track, grass, sand, mud, snow, lake ice).
// The van stays at the scene origin; the terrain is moved underneath (floating origin).
import * as THREE from 'three';
import { weightReport } from '../sim/weight.js';
import { SURFACES } from './terrain.js';

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
const CAM_LABEL = { chase: 'Chase', cockpit: 'Cockpit', orbit: 'Orbit', cinematic: 'Cinematic' };

export class Driver {
  constructor(world) {
    this.world = world;
    this.mass = weightReport().gvw;
    this.active = false;
    this.ready = false; // true once everything is stowed for travel
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.v = 0;
    this.delta = 0;
    this.spin = 0;
    this.odo = 0;
    this.trip = 0;
    this.camMode = 'chase';
    this.camYaw = 0;
    this.camT = 0;
    this.lights = 'auto';
    this.pitch = 0;
    this.roll = 0;
    this.dyn = { p: 0, pv: 0, r: 0, rv: 0, h: 0, hv: 0 };
    this.aLong = 0;
    this.yawRate = 0;
    this.surface = SURFACES.road;
    this.surfaceKey = 'road';
    this.slope = 0;
    this.braking = false;
    this.events = [];
    this.trail = [];
    this.keys = new Set();
    this.pad = { throttle: 0, brake: 0, steer: 0 };
    const onKey = (e) => {
      if (!this.active || e.target.closest?.('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      const mapped = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '];
      if (mapped.includes(k)) {
        if (e.type === 'keydown') this.keys.add(k);
        else this.keys.delete(k);
        e.preventDefault();
      }
      if (e.type === 'keydown' && k === 'c') this.cycleCamera();
      if (e.type === 'keydown' && k === 'l') this.cycleLights();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', () => this.keys.clear());
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

  enter() {
    this.active = true;
    this.v = 0;
    this.camYaw = this.yaw;
    this.trail = [[this.x, this.z]];
    this.world.stage.controls.enabled = this.camMode === 'orbit';
  }

  exit() {
    this.active = false;
    this.v = 0;
    this.keys.clear();
    this.pad.throttle = this.pad.brake = this.pad.steer = 0;
    this.world.stage.controls.enabled = true;
    this.world.stage.controls.target.set(1.8, 1.3, 0);
    for (const b of this.beams) b.intensity = 0;
  }

  cycleCamera() {
    this.camMode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.camMode) + 1) % CAMERA_MODES.length];
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

  /** Engine speed from a 9-speed automatic with fixed shift bands (for the tachometer and sound). */
  rpm(throttle = 0) {
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
    if (this.v > 0.15) return 'D';
    if (this.v < -0.15) return 'R';
    return this.lastInput?.throttle < 0 ? 'R' : 'N';
  }

  camLabel() {
    return CAM_LABEL[this.camMode];
  }

  /** Teleport back to the camp clearing. */
  home() {
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.v = 0;
    this.trail = [[0, 0]];
  }

  input() {
    const k = this.keys;
    let fwd = this.pad.throttle, back = this.pad.brake, steer = this.pad.steer;
    if (k.has('w') || k.has('arrowup')) fwd = 1;
    if (k.has('s') || k.has('arrowdown')) back = 1;
    if (k.has('a') || k.has('arrowleft')) steer = 1;
    if (k.has('d') || k.has('arrowright')) steer = -1;
    const hand = k.has(' ');
    // one-pedal reverse: brake to a stop, hold to reverse; throttle while rolling back brakes first
    let throttle = 0, brake = 0;
    if (fwd > 0) {
      if (this.v < -0.4) brake = fwd;
      else throttle = fwd;
    }
    if (back > 0) {
      if (this.v > 0.4) brake = Math.max(brake, back);
      else throttle = -back * 0.6;
    }
    if (hand) brake = 1;
    return { throttle, brake, steer };
  }

  /** Terrain heights under the four tyres → pitch, roll and the ride height of the rear axle. */
  contact() {
    const T = this.world.terrain;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const at = (lx, lz) => T.heightAt(this.x + lx * c + lz * s, this.z - lx * s + lz * c);
    const rl = at(0, -TRACK / 2), rr = at(0, TRACK / 2), fl = at(L, -TRACK / 2), fr = at(L, TRACK / 2);
    const hr = (rl + rr) / 2, hf = (fl + fr) / 2;
    return { h0: hr, pitch: Math.atan2(hf - hr, L), roll: -Math.atan2((rr + fr) / 2 - (rl + fl) / 2, TRACK) };
  }

  update(dt) {
    const W = this.world, T = W.terrain;
    if (this.active) {
      const steps = Math.max(1, Math.ceil(dt / 0.01));
      const h = dt / steps;
      const inp = this.ready ? this.input() : { throttle: 0, brake: 1, steer: 0 };
      this.lastInput = inp;
      this.braking = inp.brake > 0.05 || (this.v > 0.2 && inp.throttle < 0);
      for (let i = 0; i < steps; i++) this.step(h, inp);
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
    const rough = this.active && !this.surfaceKey.endsWith('road') ? Math.min(1, Math.abs(this.v) / 12) : 0;
    [d.p, d.pv] = spring(d.p, d.pv, this.aLong * 0.006, 60, 11);
    [d.r, d.rv] = spring(d.r, d.rv, Math.max(-0.05, Math.min(0.05, this.v * this.yawRate * 0.011)), 50, 9);
    [d.h, d.hv] = spring(d.h, d.hv, rough * 0.012 * Math.sin(performance.now() / 70) * Math.sin(performance.now() / 113), 220, 18);
    W.vanRoot.rotation.set(this.roll + d.r, 0, this.pitch + d.p, 'XZY');
    W.vanRoot.position.y = d.h;
    T.setView(this.x, this.z, ct.h0, this.yaw);
    T.update(this.x, this.z);
    W.stage.setYaw(this.yaw);
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
    // surface under the front axle decides grip and rolling resistance
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const fx = this.x + 2.2 * c, fz = this.z - 2.2 * s;
    const sf = T.surfaceAt(fx, fz);
    this.surfaceKey = sf.key === 'water' ? 'mud' : sf.key;
    this.surface = SURFACES[this.surfaceKey] || SURFACES.grass;
    const { crr, mu } = this.surface;
    // steering: rate-limited, softened with speed
    const target = inp.steer * DELTA_MAX * Math.max(0.3, 1 - Math.abs(this.v) / 40);
    this.delta += Math.max(-1.6 * h, Math.min(1.6 * h, target - this.delta));
    // longitudinal forces
    const m = this.mass;
    const grade = Math.sin(this.pitch); // + uphill
    const v = this.v;
    const traction = mu * m * G * 0.62; // rear-wheel drive, ~62 % on the rear axle when laden
    const drive = Math.sign(inp.throttle) * Math.min(F_MAX, traction, POWER / Math.max(Math.abs(v), 2.5)) * Math.abs(inp.throttle);
    const resist = Math.sign(v) * (crr * m * G + 0.5 * RHO * CDA * v * v);
    let a = (drive - resist) / m - G * grade;
    if (inp.brake > 0) {
      const dec = Math.min(0.9, mu + 0.1) * G * inp.brake;
      if (Math.abs(v) < dec * h) {
        a = 0;
        this.v = 0;
      } else a -= Math.sign(v) * dec;
    }
    // parked on a slope: the parking brake holds unless the slope beats static friction
    if (inp.throttle === 0 && Math.abs(this.v) < 0.05 && Math.abs(grade) < mu * 0.6) {
      this.v = 0;
      a = 0;
    }
    this.v = Math.max(-8, Math.min(V_MAX, this.v + a * h));
    // wheelspin on a grade steeper than the grip allows (rear-wheel drive, laden)
    if (Math.abs(inp.throttle) > 0.5 && Math.abs(this.v) < 0.6 && Math.sign(inp.throttle) * grade > traction / (m * G) - crr) this.emit('stuck');
    // deep water ahead: refuse to ford beyond ~0.6 m
    if (sf.key === 'water' && sf.depth > 0.6 && this.v > 0) {
      this.v = 0;
      this.emit('deep');
    }
    // yaw: kinematic bicycle with an understeer gradient, capped by available lateral grip
    let yr = (this.v * Math.tan(this.delta)) / (L * (1 + 0.0022 * this.v * this.v));
    const latMax = mu * G * 0.95;
    if (Math.abs(this.v * yr) > latMax) {
      yr = (Math.sign(yr) * latMax) / Math.max(Math.abs(this.v), 0.1);
      if (Math.abs(this.v) > 10) this.emit('slide');
    }
    this.yawRate = yr;
    this.aLong = a;
    this.yaw += yr * h;
    this.x += c * this.v * h;
    this.z -= s * this.v * h;
    this.collide();
    this.spin += (this.v * h) / R_WHEEL;
    const dist = Math.abs(this.v * h);
    this.odo += dist;
    this.trip += dist;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(this.x - last[0], this.z - last[1]) > 4) {
      this.trail.push([this.x, this.z]);
      if (this.trail.length > 600) this.trail.shift();
    }
  }

  /** Van footprint as four circles along its centre line against nearby trunks and boulders. */
  collide() {
    const cols = this.world.terrain.colliders;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (const lx of [-1.2, 0.6, 2.4, 4.3]) {
      const px = this.x + lx * c, pz = this.z - lx * s;
      for (const o of cols) {
        const dx = px - o.x, dz = pz - o.z;
        const d = Math.hypot(dx, dz), min = 1.02 + o.r;
        if (d < min && d > 1e-4) {
          const push = min - d;
          this.x += (dx / d) * push;
          this.z += (dz / d) * push;
          if (Math.abs(this.v) > 1.2) this.emit(o.kind);
          this.v *= -0.15;
        }
      }
    }
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
    if (this.camMode === 'chase') {
      const dist = 10.5 + Math.min(4, Math.abs(this.v) * 0.08);
      cam.position.set(2 - dist * Math.cos(lag), 3.7 + Math.min(1.2, Math.abs(this.v) * 0.03), -dist * Math.sin(lag));
      ctl.target.set(4.2, 1.5, 0);
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
      cam.position.set(2 + Math.cos(a) * 10.5, 1.9 + Math.sin(this.camT * 0.7) * 0.6, Math.sin(a) * 10.5);
      ctl.target.set(2, 1.2, 0);
      cam.lookAt(ctl.target);
    }
  }
}
