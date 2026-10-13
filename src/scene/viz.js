// Analytical overlays: thermal flux arrows, solar rays, cabin-air temperature volume,
// mechanical hardware markers and labelled airflow streams.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ENVELOPE, POD_ENVELOPE } from '../data/climate.js';
import { FEATURES } from '../data/mechanisms.js';
import { AIRFLOWS } from '../data/climate.js';
import { INTERIOR } from '../data/vehicle.js';

const SAMPLES = {
  'wall-drv': [[-1.1, 1.0], [-1.1, 2.3], [-0.3, 1.0], [0.5, 1.0], [0.5, 1.7], [0.5, 2.3], [1.3, 1.0], [1.3, 1.7], [1.3, 2.3], [2.1, 1.0], [2.1, 1.7], [2.1, 2.3]].map(([x, y]) => [[x, y, -1.03], [0, 0, -1]]),
  'wall-pass': [[-1.1, 1.0], [-1.1, 1.7], [-1.1, 2.3], [-0.3, 1.7], [-0.3, 2.3], [0.5, 1.0], [0.5, 1.7], [0.5, 2.3], [1.0, 1.0], [1.0, 1.7]].map(([x, y]) => [[x, y, 1.03], [0, 0, 1]]),
  'slide-door': [[1.8, 1.0], [2.4, 1.0], [2.4, 2.35]].map(([x, y]) => [[x, y, 1.03], [0, 0, 1]]),
  'door-window': [[[1.95, 1.88, 1.03], [0, 0, 1]]],
  roof: [-1.2, -0.4, 0.4, 1.2, 2.0, 2.8].flatMap((x) => [-0.45, 0.45].map((z) => [[x, 2.76, z], [0, 1, 0]])),
  floor: [-1.0, 0.0, 1.0, 2.0].flatMap((x) => [-0.45, 0.45].map((z) => [[x, 0.5, z], [0, -1, 0]])),
  'rear-doors': [[-0.5, 1.0], [0.5, 1.0], [-0.5, 1.5], [0.5, 1.5]].map(([z, y]) => [[-1.68, y, z], [-1, 0, 0]]),
  'rear-windows': [[[-1.68, 2.06, -0.45], [-1, 0, 0]], [[-1.68, 2.06, 0.45], [-1, 0, 0]]],
  windshield: [[[4.22, 1.78, -0.45], [0.87, 0.5, 0]], [[4.22, 1.78, 0.45], [0.87, 0.5, 0]]],
  'cab-windows': [[[3.45, 1.8, -1.03], [0, 0, -1]], [[3.45, 1.8, 1.03], [0, 0, 1]]],
  'cab-metal': [[[3.5, 1.0, -1.03], [0, 0, -1]], [[3.5, 1.0, 1.03], [0, 0, 1]]],
  'cab-floor': [[[3.4, 0.5, 0], [0, -1, 0]], [[4.4, 1.15, 0], [1, 0.3, 0]]],
  pod: [[[-0.85, 1.82, -1.3], [0, 0, -1]]],
};

function makeArrow(mat) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), mat);
  shaft.position.y = 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 12), mat);
  head.position.y = 1.0;
  g.add(shaft, head);
  g.userData = { shaft, head };
  return g;
}

export class Viz {
  constructor(scene, labelsEnabled = true) {
    this.scene = scene;
    this.thermal = new THREE.Group();
    this.thermal.name = 'thermal-viz';
    this.arrows = [];
    for (const [id, list] of Object.entries(SAMPLES)) {
      for (const [p, n] of list) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xff5533, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
        const a = makeArrow(mat);
        a.position.set(...p);
        a.userData.normal = new THREE.Vector3(...n).normalize();
        a.userData.base = new THREE.Vector3(...p);
        a.userData.id = id;
        a.userData.mat = mat;
        a.userData.phase = Math.random();
        this.thermal.add(a);
        this.arrows.push(a);
      }
    }
    // solar rays
    this.rays = [];
    const rayMat = new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
    for (const [x, z] of [[-0.8, -0.5], [0.2, 0.4], [1.2, -0.3], [2.2, 0.5], [0.7, 0.9]]) {
      const a = makeArrow(rayMat);
      a.userData.target = new THREE.Vector3(x, 2.75, z);
      this.thermal.add(a);
      this.rays.push(a);
    }
    // cabin air temperature volume
    this.airMat = new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.air = new THREE.Mesh(new THREE.BoxGeometry(INTERIOR.x1 - INTERIOR.x0 + 1.2, INTERIOR.ceilY - INTERIOR.floorY, 1.7), this.airMat);
    this.air.position.set((INTERIOR.x0 + INTERIOR.x1 + 1.2) / 2, (INTERIOR.floorY + INTERIOR.ceilY) / 2, 0);
    this.air.renderOrder = 2;
    this.thermal.add(this.air);
    this.thermal.visible = false;
    scene.add(this.thermal);

    // Mechanical markers
    this.mech = new THREE.Group();
    this.mech.name = 'mech-viz';
    const colors = { hinge: 0xb197fc, rail: 0x22b8cf, actuator: 0xff922b, latch: 0xfa5252, seal: 0x222222, support: 0x51cf66 };
    for (const f of FEATURES) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), new THREE.MeshBasicMaterial({ color: colors[f.type], toneMapped: false }));
      m.position.set(...f.p);
      m.userData = { cid: null, kind: 'feature', feature: f };
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 24), new THREE.MeshBasicMaterial({ color: colors[f.type], toneMapped: false }));
      m.add(ring);
      if (labelsEnabled) {
        const el = document.createElement('div');
        el.className = 'feat-lbl';
        el.innerHTML = `<i style="background:#${colors[f.type].toString(16).padStart(6, '0')}"></i>${f.label}`;
        const lbl = new CSS2DObject(el);
        lbl.position.set(0, 0.06, 0);
        m.add(lbl);
      }
      this.mech.add(m);
    }
    this.mech.visible = false;
    scene.add(this.mech);

    // Airflow labels
    this.airLabels = new THREE.Group();
    for (const a of AIRFLOWS) {
      const el = document.createElement('div');
      el.className = 'air-lbl';
      el.textContent = a.label;
      const o = new CSS2DObject(el);
      const mid = a.pts[Math.floor(a.pts.length / 2)];
      o.position.set(...mid);
      o.userData.requires = a.requires;
      o.userData.kind = a.kind;
      this.airLabels.add(o);
    }
    this.airLabels.visible = false;
    scene.add(this.airLabels);
  }

  setMechVisible(v, activeAct = null) {
    this.mech.visible = v;
    for (const m of this.mech.children) {
      const on = v && activeAct && m.userData.feature.act === activeAct;
      m.scale.setScalar(on ? 1.4 : 1);
      for (const c of m.children) if (c.isCSS2DObject) c.visible = !!on;
    }
  }

  setAirLabels(v, active = () => true) {
    this.airLabels.visible = v;
    for (const o of this.airLabels.children) o.visible = v && active(o.userData.requires);
  }

  updateThermal(dt, snap, ua, sunDir) {
    if (!this.thermal.visible || !snap) return;
    const dT = snap.wx.T - snap.Tin;
    const byId = Object.fromEntries(ua.items.map((i) => [i.id, i]));
    for (const a of this.arrows) {
      const it = byId[a.userData.id] || (a.userData.id === 'pod' ? { U: POD_ENVELOPE.U } : null);
      const show = !!it && (a.userData.id !== 'pod' || snap.podOut);
      a.visible = show;
      if (!show) continue;
      const q = it.U * dT; // W/m², + into cabin
      const mag = Math.min(1, Math.abs(q) / 120);
      const len = 0.12 + 0.55 * mag;
      const inward = q > 0;
      const n = a.userData.normal;
      const dir = inward ? n.clone().negate() : n.clone();
      a.userData.phase = (a.userData.phase + dt * (0.4 + mag)) % 1;
      const start = inward ? a.userData.base.clone().addScaledVector(n, len * 1.1) : a.userData.base.clone().addScaledVector(n, -0.02);
      a.position.copy(start).addScaledVector(dir, 0.08 * a.userData.phase);
      a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      a.scale.set(1 + mag, len, 1 + mag);
      const c = new THREE.Color().setHSL(inward ? 0.08 - 0.08 * mag : 0.6 - 0.6 * mag, 0.95, 0.55);
      if (!inward) c.setHSL(0.02, 0.9, 0.5 + 0.2 * (1 - mag));
      a.userData.mat.color.copy(c);
      a.userData.mat.opacity = 0.35 + 0.6 * mag;
    }
    const ghi = snap.wx.ghi;
    for (const r of this.rays) {
      r.visible = ghi > 30;
      if (!r.visible) continue;
      const dir = sunDir.clone().negate();
      const len = 0.6 + 1.2 * (ghi / 1000);
      r.position.copy(r.userData.target).addScaledVector(dir, -len - 0.1);
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      r.scale.set(1.3, len, 1.3);
    }
    const t = Math.max(0, Math.min(1, (snap.Tin - 8) / 26));
    this.airMat.color.setHSL(0.62 - 0.62 * t, 0.85, 0.55);
    this.airMat.opacity = 0.1;
  }
}
