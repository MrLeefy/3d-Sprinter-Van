// Assembles the complete 3D world and drives per-frame visual updates.
import * as THREE from 'three';
import { createStage, applyWeather, animatePrecip, sunDirection } from './setup.js';
import { makeMaterials, applyMetricUVs } from './materials.js';
import { setDRL } from './bodyShell.js';
import { Infrared } from './infrared.js';
import { buildBody } from './vanBody.js';
import { buildComponents } from './interior.js';
import { buildSystems, Flows } from './systems.js';
import { Rig } from './builders/common.js';
import { Viz } from './viz.js';
import { Person } from './person.js';
import { Modes } from './modes.js';
import { envelopeUA } from '../sim/thermal.js';
import { WATER } from '../data/plumbing.js';
import { LOADS } from '../data/electrical.js';

export const CAMERAS = {
  exterior: { p: [9.6, 3.6, 8.6], t: [1.5, 1.3, 0] },
  rear: { p: [-8.4, 3.0, 5.6], t: [-0.6, 1.25, 0.3] },
  side: { p: [1.5, 2.2, 11.5], t: [1.5, 1.4, 0] },
  top: { p: [1.3, 11.5, 0.01], t: [1.3, 1.3, 0] },
  interior: { p: [2.5, 1.86, -0.02], t: [-1.0, 1.32, 0.02] },
  galley: { p: [2.05, 2.0, 0.28], t: [1.3, 1.45, -0.62] },
  garage: { p: [-3.3, 1.35, 0.9], t: [-1.0, 1.0, 0.0] },
  underbody: { p: [1.6, 0.18, 4.4], t: [0.6, 0.45, 0] },
  dollhouse: { p: [4.4, 7.6, 6.9], t: [0.6, 1.2, 0] },
};

export class World {
  constructor(container, opts = {}) {
    this.stage = createStage(container, opts);
    const { scene } = this.stage;
    this.M = makeMaterials();
    this.rig = new Rig();
    this.reg = { levels: {}, ledStrips: [], fans: [], cookZones: [] };
    this.body = buildBody(this.M);
    scene.add(this.body.root);
    this.comps = buildComponents({ M: this.M, rig: this.rig, reg: this.reg, body: this.body });
    scene.add(this.comps.root);
    this.systems = buildSystems();
    scene.add(this.systems.root);
    this.flows = new Flows(scene);
    this.flows.addSet('water', this.systems.routes.filter((r) => r.sys === 'water'), { radius: 0.016, spacing: 0.32 });
    this.flows.addSet('electrical', this.systems.routes.filter((r) => r.sys === 'electrical'), { radius: 0.013, spacing: 0.28 });
    this.flows.addSet('ducts', this.systems.routes.filter((r) => r.sys === 'air'), { radius: 0.024, spacing: 0.45, soft: 0.6 });
    this.flows.addSet('air', this.systems.air, { radius: 0.03, spacing: 0.5, soft: 1 });
    this.viz = new Viz(scene);
    this.person = new Person();
    scene.add(this.person.root);
    applyMetricUVs(scene);
    this.modes = new Modes(this.stage, this.M, this.body, this.comps, this.systems, this.viz, this.person);
    this.ir = new Infrared(this);
    this.modes.infrared = this.ir;
    this.rigBody();
    this.raycaster = new THREE.Raycaster();
    this.camTween = null;
    this.uaCache = envelopeUA({ covers: 0 });
    this.sunDir = new THREE.Vector3(0, 1, 0);
  }

  rigBody() {
    const P = this.body.parts;
    this.rig.on('slidingDoor', (v) => {
      const a = Math.min(1, v / 0.15);
      const b = Math.max(0, (v - 0.15) / 0.85);
      P.slidingDoor.position.set(-0.04 * a - 1.26 * b, 0, 0.065 * a);
    });
    this.rig.on('rearDoors', (v, vals) => {
      const th = v * 1.5 * Math.PI;
      const limit = (vals.slideOut ?? 0) > 0.01 ? Math.PI : 1.5 * Math.PI;
      P.rearDoorPass.rotation.y = th;
      P.rearDoorDrv.rotation.y = -Math.min(th, limit);
    });
  }

  flyTo(name, dur = 1.2) {
    const c = CAMERAS[name];
    if (!c) return;
    const cam = this.stage.camera, ctl = this.stage.controls;
    const t1 = new THREE.Vector3(...c.t);
    const p1 = new THREE.Vector3(...c.p);
    // Portrait screens: back the camera off so the whole van stays in frame
    if (cam.aspect < 1.2 && !['interior', 'galley'].includes(name)) p1.sub(t1).multiplyScalar(Math.min(2.3, 1.25 / Math.max(0.4, cam.aspect))).add(t1);
    this.camTween = { t: 0, dur, p0: cam.position.clone(), t0: ctl.target.clone(), p1, t1 };
  }

  weather(scn, wx, hour) {
    applyWeather(this.stage, scn, wx, hour);
    this.sunDir.copy(sunDirection(scn, wx, hour));
    if (this.ir.on) this.ir.setStage(true);
  }

  /** Per-frame visual update from actuator values and the simulation snapshot. */
  update(dt, values, snap) {
    const { reg, M } = this;
    this.rig.apply(values);
    // Camera tween
    if (this.camTween) {
      const T = this.camTween;
      T.t = Math.min(1, Math.max(0, T.t + dt / T.dur));
      const e = T.t < 0.5 ? 4 * T.t ** 3 : 1 - (-2 * T.t + 2) ** 3 / 2;
      this.stage.camera.position.lerpVectors(T.p0, T.p1, e);
      this.stage.controls.target.lerpVectors(T.t0, T.t1, e);
      if (T.t >= 1) this.camTween = null;
    }
    const lv = snap?.levels || {};
    const W = snap?.byLoad || {};
    // Lighting
    const lightLevel = values.lightsOn * (snap ? (lv.lights === 0 && !snap.act ? 0.6 : [0.15, 0.55, 1][lv.lights ?? 1]) : 0.8);
    const lightFactor = Math.max(values.lightsOn * 0.25, lightLevel);
    M.lightOn.emissiveIntensity = 2.4 * lightFactor;
    M.ledStrip.emissiveIntensity = 2.0 * lightFactor;
    this.stage.interior.forEach((l, i) => (l.intensity = (i === 4 ? 0.8 : 1.6) * lightFactor));
    if (this.stage.bathLight) this.stage.bathLight.intensity = 0.8 * lightFactor;
    // Daytime running lights while driving
    setDRL(snap?.driving ? 1 : 0);
    // Cooktop & cookware
    const ind = W.induction || 0;
    reg.cookZones.forEach((m, i) => (m.emissiveIntensity = ind > 0 ? (i === 0 ? ind / 900 : ind > 900 ? 1.2 : 0.2) : 0));
    if (reg.cookware) reg.cookware.visible = ind > 0;
    if (reg.microwaveGlow) reg.microwaveGlow.emissiveIntensity = (W.microwave || 0) > 0 ? 2.5 : 0;
    // Fans
    for (const f of reg.fans) {
      const lvl = lv[f.load] ?? 0;
      const sp = f.load === 'ac' ? ((W.ac || 0) > 0 ? 18 : 0) : [0, 6, 14, 26][lvl] || 0;
      f.obj.rotation.y += sp * dt;
    }
    // Tank levels
    if (snap) {
      const fl = reg.levels.fresh?.mesh;
      if (fl) fl.scale.y = Math.max(0.02, snap.freshL / WATER.freshUsableL);
      const gl = reg.levels.grey?.mesh;
      if (gl) gl.scale.y = Math.max(0.02, snap.greyL / WATER.greyL);
    }
    // Flows
    const act = (ids) => ids.some((id) => (W[id] || 0) > 0 || (lv[id] || 0) > 0 && id !== 'heater' && id !== 'ac');
    const showFlow = this.modes.sim;
    this.flows.setVisible('water', showFlow === 'water');
    this.flows.setVisible('electrical', showFlow === 'electrical');
    this.flows.setVisible('ducts', showFlow === 'thermal' || showFlow === 'ventilation');
    this.flows.setVisible('air', showFlow === 'ventilation' || showFlow === 'thermal');
    this.viz.setAirLabels(showFlow === 'ventilation', (req) => (snap ? airActive(req, snap) : true));
    this.flows.update(dt, (set, p) => flowSpeed(set, p, snap, showFlow));
    // Thermal
    if (snap && this.modes.sim === 'thermal') {
      this.uaCache = envelopeUA({ covers: snap.covers, podOut: snap.podOut });
      this.viz.updateThermal(dt, snap, this.uaCache, this.sunDir);
    }
    this.ir.update(snap, this.sunDir);
    animatePrecip(this.stage, dt);
    if (this.modes.sim === 'living') this.person.update(dt);
    else this.person.root.visible = false;
    this.modes.tick(dt);
    this.stage.controls.update();
    this.stage.render();
  }

  setInfrared(on) {
    this.ir.setStage(on);
    this.modes.ir = on;
    this.modes.apply();
  }

  pickAt(ndcX, ndcY) {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.stage.camera);
    return this.modes.pick(this.raycaster);
  }
}

function airActive(req, snap) {
  const W = snap.byLoad, lv = snap.levels;
  return req.some((id) => {
    if (id === 'heater') return snap.Qheat > 0;
    if (id === 'ac') return snap.Qcool > 0;
    if (id === 'monitor') return true;
    return (lv[id] || 0) > 0 || (W[id] || 0) > 0;
  });
}

function flowSpeed(set, p, snap, mode) {
  const trace = 0.25; // slow "trace" animation for idle paths in their own mode
  if (!snap) return trace;
  const W = snap.byLoad, lv = snap.levels;
  if (set === 'water') {
    const flowing = snap.drawL > 0;
    if (p.kind === 'fuel') return snap.dieselLh > 0 ? 0.25 : trace * 0.4;
    if (p.kind === 'hot' && flowing) return 0.9;
    if ((p.kind === 'cold' || p.kind === 'drink') && flowing) return 0.9;
    if (p.kind === 'grey' && flowing) return 0.6;
    return trace;
  }
  if (set === 'electrical') {
    const V = snap.V || 13;
    let amps = 0;
    if (p.source === 'solar') amps = snap.solarW / 34;
    else if (p.source === 'alternator') amps = snap.altW / V;
    else if (p.source === 'shore') amps = (snap.shoreCharge + snap.shoreToLoads) / 120;
    else if (p.load) amps = (W[p.load] || 0) / (LOADS.find((l) => l.id === p.load)?.bus === 'ac' ? 120 : V);
    else if (p.kind === 'dcmain') return snap.batA >= 0 ? -Math.min(2.5, 0.2 + Math.abs(snap.batA) / 60) : Math.min(2.5, 0.2 + Math.abs(snap.batA) / 60);
    else if (p.id === 'w-dcpanel') amps = snap.dcW / V;
    else if (p.id === 'w-inv-ac') amps = snap.invOut / 120;
    else return trace * 0.5;
    return amps > 0.01 ? Math.min(2.5, 0.25 + amps / 25) : 0;
  }
  if (set === 'ducts') {
    if (p.kind === 'heat') return snap.Qheat > 0 ? 0.9 : 0;
    if (p.kind === 'ac') return snap.Qcool > 0 ? 0.9 : 0;
    if (p.kind === 'exhaust') return (lv.hood || 0) > 0 ? 1.0 : 0;
    if (p.kind === 'fresh') return (lv.freshFan || 0) > 0 ? 0.6 : 0;
    return 0;
  }
  if (set === 'air') {
    const on = airActive(p.requires || [], snap);
    if (!on) return 0;
    if (mode === 'thermal' && !['heatWarm', 'acCold', 'hotOut', 'recirc'].includes(p.kind)) return 0;
    return p.kind === 'exhaust' ? 0.5 : 0.7;
  }
  return trace;
}
