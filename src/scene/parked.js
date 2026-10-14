// Parked vehicles for the towns: the detailed models from vehicles.js drawn through instancing with a
// distance LOD. Every model part has a high-detail mesh (10–30k triangles per vehicle, only the nearest
// few under a triangle budget) and a ~100-triangle box stand-in for everything else, so the whole
// fleet is a fixed, small number of draw calls and a bounded amount of memory. Body paint comes from a
// per-instance tint attribute.
import * as THREE from 'three';
import { VB, KIND, COL, buildCar, buildTractor, buildTrailer, vehicleMaterial } from './vehicles.js';
import { CAR_MODELS } from '../world/layout.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
export const CAR_PAINT = [[0.92, 0.92, 0.9], [0.7, 0.72, 0.74], [0.12, 0.12, 0.13], [0.62, 0.1, 0.09], [0.12, 0.22, 0.45], [0.16, 0.34, 0.22], [0.55, 0.45, 0.3], [0.35, 0.37, 0.4], [0.85, 0.7, 0.15], [0.5, 0.52, 0.55], [0.75, 0.3, 0.1], [0.25, 0.4, 0.6]].map(lin);
const TRACTOR_PAINT = [[0.75, 0.08, 0.06], [0.1, 0.16, 0.4], [0.9, 0.9, 0.88], [0.1, 0.1, 0.11], [0.12, 0.3, 0.2], [0.85, 0.5, 0.1], [0.5, 0.5, 0.54], [0.45, 0.1, 0.35]].map(lin);
const TRAILER_PAINT = [[0.95, 0.95, 0.93], [0.9, 0.9, 0.88], [0.8, 0.82, 0.85], [0.7, 0.1, 0.08], [0.12, 0.2, 0.45], [0.85, 0.85, 0.7], [0.3, 0.45, 0.35]].map(lin);

/** Model → the mesh parts that make it up (dx = offset along the vehicle's forward axis). */
const PARTS = ['sedan', 'suv', 'hatch', 'van', 'pickup', 'tractor', 'dryvan', 'tanker', 'flatbed'];
const PART_OF = (kind) => (kind <= 4 ? [[kind, 0]] : kind === 5 ? [[5, 0]] : [[5, 0], [kind + 0, 0.15]]); // 6..8 trailers use the part index = kind
const HI_RADIUS = (kind) => (kind <= 4 ? 55 : 80);
const HI_CAP = [40, 40, 40, 40, 40, 10, 8, 8, 8];
const HI_TRI_BUDGET = 420000;
const LO_CAP = 700;

/** Collision circles [forward offset, radius] for a parked vehicle (the van drives into them like any obstacle). */
export function carCircles(kind) {
  if (kind === 3) return [[1.9, 1.0], [0, 1.0], [-1.9, 1.0]];
  if (kind === 4) return [[2.1, 0.97], [0.4, 0.97], [-1.5, 0.97]];
  if (kind <= 4) return [[1.4, 0.92], [-1.1, 0.92]];
  const tractor = [[6.3, 1.3], [4.4, 1.3], [2.5, 1.3], [0.7, 1.3]];
  if (kind === 5) return tractor;
  return [...tractor, [-2.2, 1.35], [-4.6, 1.35], [-7, 1.35], [-9.4, 1.35], [-11.8, 1.35], [-14.2, 1.35]];
}

// ── Low-detail stand-ins (box models in the same vertex format as vehicles.js) ──────────────
const P = (extra = {}) => ({ col: [1, 1, 1], kind: KIND.PAINT, body: true, ...extra });
const GL = { col: COL.glass, kind: KIND.GLASS };
const TY = { col: COL.rubber, kind: KIND.RUBBER };
function lowWheels(vb, xs, r, hw, w = 0.26) {
  for (const x of xs) for (const s of [-1, 1]) vb.box(x - r, x + r, 0, r * 2, s * hw - w / 2, s * hw + w / 2, TY);
}
function lowCar(d) {
  const vb = new VB();
  const hw = d.W / 2;
  vb.box(-d.L / 2, d.L / 2, 0.3, d.belt, -hw, hw, P());
  vb.box(d.cab[0], d.cab[1], d.belt, d.roof - 0.05, -hw + 0.1, hw - 0.1, GL);
  vb.box(d.cab[0] + 0.1, d.cab[1] - 0.1, d.roof - 0.05, d.roof, -hw + 0.12, hw - 0.12, P());
  lowWheels(vb, d.wheels, d.wr, hw - 0.12);
  for (const s of [-1, 1]) {
    vb.box(d.L / 2, d.L / 2 + 0.03, d.belt - 0.28, d.belt - 0.12, s * hw * 0.62 - 0.17, s * hw * 0.62 + 0.17, { col: COL.lens, kind: KIND.LENS, glow: 1 });
    vb.box(-d.L / 2 - 0.03, -d.L / 2, d.belt - 0.28, d.belt - 0.12, s * hw * 0.62 - 0.17, s * hw * 0.62 + 0.17, { col: COL.red, kind: KIND.LENS, glow: 2 });
  }
  return vb.build();
}
const LOW_CARS = [
  { L: 4.72, W: 1.8, belt: 1.0, roof: 1.46, cab: [-1.5, 1.1], wheels: [1.5, -1.4], wr: 0.335 },
  { L: 4.78, W: 1.86, belt: 1.12, roof: 1.74, cab: [-2.3, 0.95], wheels: [1.5, -1.4], wr: 0.385 },
  { L: 4.05, W: 1.7, belt: 0.98, roof: 1.45, cab: [-1.95, 0.9], wheels: [1.28, -1.2], wr: 0.31 },
  { L: 5.9, W: 1.96, belt: 1.25, roof: 2.5, cab: [-2.9, 2.2], wheels: [1.85, -1.75], wr: 0.375 },
];
function lowPickup() {
  const vb = new VB();
  vb.box(-2.98, 2.98, 0.4, 1.1, -0.97, 0.97, P());
  vb.box(-0.35, 1.7, 1.1, 1.35, -0.9, 0.9, P());
  vb.box(-0.3, 1.5, 1.35, 1.88, -0.84, 0.84, GL);
  vb.box(-0.25, 1.4, 1.88, 1.93, -0.86, 0.86, P());
  lowWheels(vb, [1.75, -1.45], 0.4, 0.84, 0.28);
  return vb.build();
}
function lowTractor() {
  const vb = new VB();
  vb.box(-1.95, 7.3, 0.55, 1.2, -0.55, 0.55, { col: COL.frame, kind: KIND.METAL });
  vb.box(4.6, 7.3, 1.2, 2.35, -1.0, 1.0, P());
  vb.box(2.6, 4.6, 1.2, 3.45, -1.25, 1.25, P());
  vb.box(2.7, 4.62, 2.0, 3.2, -1.27, 1.27, GL);
  vb.box(0.9, 2.6, 1.2, 3.95, -1.25, 1.25, P());
  vb.box(-1.0, 0.9, 1.2, 1.35, -1.0, 1.0, { col: COL.dark, kind: KIND.METAL });
  for (const s of [-1, 1]) vb.box(2.3, 2.5, 1.2, 3.9, s * 1.35, s * 1.43, { col: COL.alu, kind: KIND.CHROME });
  lowWheels(vb, [5.9], 0.52, 1.0, 0.3);
  for (const x of [0.685, -0.685]) lowWheels(vb, [x], 0.52, 0.915, 0.7);
  for (const s of [-1, 1]) vb.box(7.3, 7.36, 0.9, 1.1, s * 0.7 - 0.2, s * 0.7 + 0.2, { col: COL.lens, kind: KIND.LENS, glow: 1 });
  return vb.build();
}
function lowTrailer(type) {
  const vb = new VB();
  vb.box(-15.2, 0.9, 0.55, 1.24, -1.0, 1.0, { col: COL.dark, kind: KIND.METAL });
  lowWheels(vb, [-12.2 + 0.64, -12.2 - 0.64], 0.52, 0.915, 0.7);
  if (type === 'tanker') vb.box(-14.8, 0.6, 1.3, 3.5, -1.2, 1.2, { col: COL.alu, kind: KIND.METAL });
  else if (type === 'flatbed') {
    vb.box(-15.2, 0.9, 1.2, 1.45, -1.3, 1.3, { col: COL.frame, kind: KIND.WOOD });
    vb.box(-13.5, -1.5, 1.45, 2.9, -1.1, 1.1, { col: COL.wood, kind: KIND.WOOD });
  } else vb.box(-15.2, 0.9, 1.24, 4.06, -1.29, 1.29, P());
  vb.box(-15.25, -15.2, 1.4, 1.9, -0.8, 0.8, { col: COL.red, kind: KIND.LENS, glow: 2 });
  return vb.build();
}

/** Tint-aware wrapper of the shared vehicle material: per-instance colour instead of the uTint uniform. */
function parkedMaterial(season, atlas) {
  const mat = vehicleMaterial(season, atlas);
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aCarCol;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = mix(vec3(1.0), aCarCol, aBody);');
  };
  mat.customProgramCacheKey = () => 'parkedVehicles1';
  const l = mat.userData?.uLamp?.value;
  if (l) l.set(0, 0, 0, 0);
  return mat;
}

export class ParkedVehicles {
  constructor(group, season, atlas) {
    this.group = group;
    this.atlas = atlas;
    this.mat = parkedMaterial(season, atlas);
    this.list = [];
    this.dirty = false;
    this.last = [1e9, 1e9];
    this.shadows = false;
    this.hi = new Array(PARTS.length).fill(null); // lazily built (a detailed car costs ~20 ms to generate)
    this.lo = PARTS.map((name, i) => this.mesh(this.lowGeo(name), LO_CAP * (i <= 4 ? 1 : 0.2) | 0, false));
    this.hiTris = PARTS.map(() => 0);
  }

  lowGeo(name) {
    const i = PARTS.indexOf(name);
    if (i <= 3) return lowCar(LOW_CARS[i]);
    if (name === 'pickup') return lowPickup();
    if (name === 'tractor') return lowTractor();
    return lowTrailer(name === 'dryvan' ? 'dryvan' : name);
  }

  mesh(geo, cap, shadow) {
    const m = new THREE.InstancedMesh(geo, this.mat, cap);
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCarCol', a);
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  hiMesh(i) {
    if (this.hi[i]) return this.hi[i];
    const name = PARTS[i];
    const atlas = this.atlas;
    const decal = atlas ? (t, st) => atlas.slot(t, st) : undefined;
    let geo;
    if (i <= 4) geo = buildCar(name, { wheels: 'merged', detail: 1 }).geo;
    else if (name === 'tractor') geo = buildTractor({ wheels: 'merged', detail: 0.5 }).geo;
    else geo = buildTrailer(name, { wheels: 'merged', detail: 0.5, decal, name: name === 'tanker' ? 'MONTANA FUELS' : 'BIG SKY FREIGHT', style: name === 'tanker' ? 2 : 1 }).geo;
    this.hiTris[i] = geo.index.count / 3;
    return (this.hi[i] = this.mesh(geo, HI_CAP[i], this.shadows));
  }

  setCastShadow(on) {
    this.shadows = on;
    for (const m of this.hi) if (m) m.castShadow = on;
  }

  setVisible(v) {
    this.group.visible = v;
  }

  /** Replace the vehicle list: [x, y, z, rot, kind, rn] per vehicle. */
  setList(list) {
    this.list = list;
    this.dirty = true;
  }

  tint(kind, part, rn) {
    const h = Math.floor(rn * 4096);
    if (kind <= 4) return CAR_PAINT[h % CAR_PAINT.length];
    if (part === 5) return TRACTOR_PAINT[h % TRACTOR_PAINT.length];
    return TRAILER_PAINT[(h >> 3) % TRAILER_PAINT.length];
  }

  /** Re-pick which vehicles are drawn in detail around (px, pz). Cheap when the viewer has not moved. */
  update(px, pz) {
    if (!this.dirty && Math.hypot(px - this.last[0], pz - this.last[1]) < 5) return;
    this.dirty = false;
    this.last = [px, pz];
    const list = this.list, n = list.length;
    // nearest candidates for the detailed meshes, under a triangle budget
    const cand = [];
    for (let i = 0; i < n; i++) {
      const v = list[i], r = HI_RADIUS(v[4]);
      const dx = v[0] - px, dz = v[2] - pz;
      if (dx * dx + dz * dz < r * r) cand.push([dx * dx + dz * dz, i]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const useHi = new Uint8Array(n);
    const hiN = PARTS.map(() => 0);
    let budget = HI_TRI_BUDGET;
    for (const [, i] of cand) {
      const kind = list[i][4], parts = PART_OF(kind);
      if (parts.some(([p]) => hiN[p] >= HI_CAP[p])) continue;
      let cost = 0;
      for (const [p] of parts) cost += this.hiTris[p] || (p <= 4 ? 10500 : p === 5 ? 15000 : 12000);
      if (cost > budget) continue;
      budget -= cost;
      useHi[i] = 1;
      for (const [p] of parts) hiN[p]++;
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), ax = new THREE.Vector3(0, 1, 0);
    const loN = PARTS.map(() => 0), hiI = PARTS.map(() => 0);
    for (let i = 0; i < n; i++) {
      const [x, y, z, rot, kind, rn] = list[i];
      const hi = useHi[i] === 1;
      q.setFromAxisAngle(ax, rot);
      const c = Math.cos(rot), s = -Math.sin(rot);
      for (const [p, dx] of PART_OF(kind)) {
        const mesh = hi ? this.hiMesh(p) : this.lo[p];
        const k = hi ? hiI[p]++ : loN[p]++;
        if (k >= mesh.instanceMatrix.count) {
          if (hi) hiI[p]--;
          else loN[p]--;
          continue;
        }
        pos.set(x + c * dx, y, z + s * dx);
        mesh.setMatrixAt(k, m4.compose(pos, q, sc));
        const col = this.tint(kind, p, rn);
        mesh.geometry.attributes.aCarCol.setXYZ(k, col[0], col[1], col[2]);
      }
    }
    PARTS.forEach((_, p) => {
      const lo = this.lo[p];
      lo.count = loN[p];
      lo.visible = loN[p] > 0;
      lo.instanceMatrix.needsUpdate = true;
      lo.geometry.attributes.aCarCol.needsUpdate = true;
      const hm = this.hi[p];
      if (hm) {
        hm.count = hiI[p];
        hm.visible = hiI[p] > 0;
        hm.instanceMatrix.needsUpdate = true;
        hm.geometry.attributes.aCarCol.needsUpdate = true;
      }
    });
  }

  /** Draw-call and triangle accounting for tests / diagnostics. */
  get stats() {
    let tris = 0, calls = 0;
    for (const m of [...this.lo, ...this.hi]) {
      if (!m || !m.visible) continue;
      calls++;
      tris += (m.geometry.index.count / 3) * m.count;
    }
    return { calls, tris: Math.round(tris), vehicles: this.list.length };
  }
}

void CAR_MODELS;
