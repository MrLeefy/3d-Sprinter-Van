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

// ── Animated flow streams ───────────────────────────────────────────────────
// Each route gets a thin additive tube whose shader scrolls bright "comets" along it; speed and
// direction follow the live simulation (litres, amps, airflow), so bloom makes them glow.
const STREAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const STREAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPhase, uLen, uSpacing, uOpacity, uDir, uSoft;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = fract(vUv.x * uLen / uSpacing - uPhase);
  if (uDir < 0.0) f = 1.0 - f;
  float comet = pow(f, mix(7.0, 2.2, uSoft)) * (1.0 - smoothstep(0.88, 1.0, f));
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float core = 0.25 + 0.75 * pow(facing, 0.7);
  float ends = smoothstep(0.0, 0.02, vUv.x) * (1.0 - smoothstep(0.98, 1.0, vUv.x));
  float a = (0.1 + 0.9 * comet) * core * ends * uOpacity;
  gl_FragColor = vec4(uColor * (0.5 + 2.8 * comet), a);
}`;

export class Flows {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'flows';
    scene.add(this.group);
    this.sets = [];
  }

  /** paths: [{id, kind, samples, len}], opts: { radius, spacing, soft } */
  addSet(name, paths, { radius = 0.012, spacing = 0.35, soft = 0 } = {}) {
    const g = new THREE.Group();
    g.name = `flow-${name}`;
    g.visible = false;
    const items = [];
    for (const p of paths) {
      if (!p.samples || p.samples.length < 2 || !(p.len > 0.02)) continue;
      const curve = new THREE.CatmullRomCurve3(p.samples, false, 'centripetal', 0.5);
      const geo = new THREE.TubeGeometry(curve, Math.max(8, Math.min(320, Math.round(p.len * 45))), radius, 7, false);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(FLOW_COLORS[p.kind] ?? 0xffffff) }, uPhase: { value: Math.random() },
          uLen: { value: p.len }, uSpacing: { value: spacing }, uOpacity: { value: 1 }, uDir: { value: 1 }, uSoft: { value: soft },
        },
        vertexShader: STREAM_VERT,
        fragmentShader: STREAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      g.add(mesh);
      items.push({ path: p, mesh, mat });
    }
    this.group.add(g);
    const set = { name, group: g, items, spacing, visible: false };
    this.sets.push(set);
    return set;
  }

  setVisible(name, v) {
    for (const s of this.sets) if (s.name === name) s.visible = s.group.visible = v;
  }

  /** speedFn(set, path) → m/s (0 hides that stream; negative reverses it) */
  update(dt, speedFn) {
    for (const s of this.sets) {
      if (!s.visible) continue;
      for (const it of s.items) {
        const sp = speedFn(s.name, it.path) || 0;
        it.mesh.visible = sp !== 0;
        if (!sp) continue;
        const u = it.mat.uniforms;
        u.uPhase.value = (u.uPhase.value + (Math.abs(sp) * dt) / s.spacing) % 1000;
        u.uDir.value = sp < 0 ? -1 : 1;
        u.uOpacity.value = Math.min(1, 0.35 + Math.abs(sp) * 0.75);
      }
    }
  }
}
