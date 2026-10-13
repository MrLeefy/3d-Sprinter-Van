// Routed services: pipes, cables, ducts — as tube meshes with sampled paths for flows.
import * as THREE from 'three';
import { PIPES } from '../data/plumbing.js';
import { WIRES } from '../data/electrical.js';
import { DUCTS, AIRFLOWS } from '../data/climate.js';
import { tube, roundedPath, boxMesh, B } from './geom.js';
import { FLOW_COLORS } from './materials.js';

const matCache = new Map();
function routeMat(hex, rough = 0.5, metal = 0.1) {
  const k = `${hex}-${rough}-${metal}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }));
  return matCache.get(k);
}

const PIPE_MAT = {
  cold: [0x2f6fd6, 0.45], hot: [0xd6402f, 0.45], drink: [0x54c6e8, 0.4], grey: [0x5c5f63, 0.6], fill: [0xe9ecef, 0.5],
  vent: [0x9aa0a6, 0.7], fuel: [0x111111, 0.5], drain: [0x6d8fb0, 0.5],
};
const WIRE_STYLE = {
  dcmain: [0.011, 0xb3191c], dc: [0.0045, 0xd02a2a], ac: [0.005, 0xf2c418], pv: [0.004, 0x1d1d1d], alt: [0.008, 0xb3191c], shore: [0.007, 0xef7d16], data: [0.0025, 0x2f6fd6],
};

function sample(path, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(path.getPointAt(i / n));
  return pts;
}

export function buildSystems() {
  const root = new THREE.Group();
  root.name = 'systems';
  const groups = { water: new THREE.Group(), electrical: new THREE.Group(), air: new THREE.Group() };
  for (const g of Object.values(groups)) root.add(g);
  const routes = [];

  for (const p of PIPES) {
    const [hex, rough] = PIPE_MAT[p.kind] || [0x888888, 0.5];
    const m = tube(p.pts, Math.max(0.005, p.d / 2), routeMat(hex, rough), { corner: 0.05, radial: 8 });
    m.userData = { ...m.userData, cid: p.to, kind: 'route', sys: 'water', route: p.id, flowKind: p.kind };
    groups.water.add(m);
    routes.push({ id: p.id, sys: 'water', kind: p.kind, from: p.from, to: p.to, mesh: m, len: m.userData.length, samples: sample(m.userData.path, Math.max(8, Math.round(m.userData.length * 30))) });
  }
  for (const w of WIRES) {
    const [r, hex] = WIRE_STYLE[w.kind] || [0.004, 0x999999];
    const m = tube(w.pts, r, routeMat(hex, 0.6), { corner: 0.04, radial: 6 });
    m.userData = { ...m.userData, cid: w.to, kind: 'route', sys: 'electrical', route: w.id, flowKind: w.kind };
    groups.electrical.add(m);
    routes.push({ id: w.id, sys: 'electrical', kind: w.kind, from: w.from, to: w.to, load: w.load, source: w.source, circuit: w.circuit, mesh: m, len: m.userData.length, samples: sample(m.userData.path, Math.max(8, Math.round(m.userData.length * 30))) });
  }
  for (const d of DUCTS) {
    let m;
    if (d.rect) {
      const [w, h] = d.rect;
      const a = d.pts[0], b = d.pts[d.pts.length - 1];
      m = boxMesh(B(a[0], b[0], a[1] - h / 2, a[1] + h / 2, a[2] - w / 2, a[2] + w / 2), routeMat(0x8fb9e0, 0.6, 0.3), 0.01);
      m.userData.path = roundedPath(d.pts, 0.05);
      m.userData.length = m.userData.path.getLength();
    } else {
      const flex = d.kind === 'heat' ? routeMat(0xc9ced4, 0.35, 0.8) : routeMat(0xb8bec4, 0.4, 0.7);
      m = tube(d.pts, d.r, flex, { corner: 0.08, radial: 12 });
    }
    m.userData = { ...m.userData, cid: d.from, kind: 'route', sys: 'air', route: d.id, flowKind: d.kind === 'ac' ? 'acduct' : d.kind };
    groups.air.add(m);
    routes.push({ id: d.id, sys: 'air', kind: d.kind, from: d.from, to: d.to, mesh: m, len: m.userData.length, samples: sample(m.userData.path, Math.max(8, Math.round(m.userData.length * 30))) });
  }
  // Airflow streamlines (no meshes; flows only)
  const air = [];
  for (const a of AIRFLOWS) {
    const path = new THREE.CatmullRomCurve3(a.pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal', 0.5);
    const len = path.getLength();
    air.push({ id: a.id, sys: 'airflow', kind: a.kind, requires: a.requires, label: a.label, len, samples: sample(path, Math.max(10, Math.round(len * 25))) });
  }
  return { root, groups, routes, air };
}

/** Instanced particle flows along sampled paths. */
export class Flows {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'flows';
    scene.add(this.group);
    this.sets = [];
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
  }

  /** paths: [{id, kind, samples, len}], opts: { radius, density, shape } */
  addSet(name, paths, { radius = 0.012, density = 10, shape = 'sphere', max = 3000 } = {}) {
    const items = [];
    for (const p of paths) {
      const n = Math.max(2, Math.min(60, Math.round(p.len * density)));
      for (let i = 0; i < n; i++) items.push({ path: p, u: i / n + Math.random() * 0.02 });
    }
    const count = Math.min(items.length, max);
    const geo = shape === 'arrow' ? new THREE.ConeGeometry(radius, radius * 3.2, 8).rotateX(Math.PI / 2) : new THREE.SphereGeometry(radius, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    for (let i = 0; i < count; i++) {
      this.color.setHex(FLOW_COLORS[items[i].path.kind] ?? 0xffffff);
      mesh.setColorAt(i, this.color);
    }
    this.group.add(mesh);
    const set = { name, items: items.slice(0, count), mesh, shape, visible: false };
    mesh.visible = false;
    this.sets.push(set);
    return set;
  }

  setVisible(name, v) {
    for (const s of this.sets) if (s.name === name) s.visible = s.mesh.visible = v;
  }

  /** speedFn(path) → m/s (0 hides particles of that path; negative reverses) */
  update(dt, speedFn) {
    const d = this.dummy;
    const tmp = new THREE.Vector3();
    for (const s of this.sets) {
      if (!s.visible) continue;
      const speeds = new Map();
      let i = 0;
      for (const it of s.items) {
        const p = it.path;
        let sp = speeds.get(p);
        if (sp === undefined) {
          sp = speedFn(s.name, p);
          speeds.set(p, sp);
        }
        if (!sp) {
          d.position.set(0, -50, 0);
          d.scale.setScalar(0.0001);
          d.updateMatrix();
          s.mesh.setMatrixAt(i++, d.matrix);
          continue;
        }
        it.u = (it.u + (sp * dt) / Math.max(p.len, 0.05) + 1) % 1;
        const f = it.u * (p.samples.length - 1);
        const k = Math.floor(f);
        const a = p.samples[k], b = p.samples[Math.min(k + 1, p.samples.length - 1)];
        d.position.lerpVectors(a, b, f - k);
        if (s.shape === 'arrow') {
          tmp.subVectors(b, a);
          if (sp < 0) tmp.negate();
          if (tmp.lengthSq() > 1e-8) d.lookAt(tmp.add(d.position));
        }
        const fade = Math.min(1, it.u * 8, (1 - it.u) * 8);
        d.scale.setScalar(0.35 + 0.65 * fade);
        d.updateMatrix();
        s.mesh.setMatrixAt(i++, d.matrix);
      }
      s.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
