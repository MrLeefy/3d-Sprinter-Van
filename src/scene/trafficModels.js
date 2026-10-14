// Geometry for AI traffic. Every model comes in two levels of detail with the same vertex
// attributes (aKind / aBody / aGlow / aDecal) as the vehicle library so one material draws both:
//   hi  the detailed library model (passenger cars, tractor, trailers) with wheels merged in
//   lo  a box-and-prism proxy of the same silhouette (a few hundred triangles) for distance
// Motorhomes and coaches are built here (hi = rounded boxes with real wheels, lo = plain boxes).
// Forward is +x, up is +y, right is +z; semis are a tractor model (origin: drive tandem) plus a
// trailer model (origin: kingpin).
import * as THREE from 'three';
import { VB, KIND, COL, addWheel, buildCar, buildTractor, buildTrailer, TRAILER, TRACTOR } from './vehicles.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const PAINT = { col: [1, 1, 1], kind: KIND.PAINT, body: true };
const GLS = { col: COL.glass, kind: KIND.GLASS };
const BLK = { col: COL.black, kind: KIND.PLASTIC };
const CH = { col: COL.alu, kind: KIND.CHROME };
const FRAME = { col: COL.frame, kind: KIND.METAL };
const TYRE = { col: COL.rubber, kind: KIND.RUBBER };
const HEAD = { col: COL.lens, kind: KIND.LENS, glow: 1 };
const TAIL = { col: COL.red, kind: KIND.LENS, glow: 2 };
const AMBER = { col: COL.amber, kind: KIND.LENS, glow: 3 };
const WHITE = { col: COL.white, kind: KIND.METAL };

/** Append one builder's vertices into another under a matrix. */
function appendVB(dst, src, m) {
  const base = dst.count;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    v.set(src.P[i * 3], src.P[i * 3 + 1], src.P[i * 3 + 2]).applyMatrix4(m);
    n.set(src.N[i * 3], src.N[i * 3 + 1], src.N[i * 3 + 2]).applyMatrix3(nm).normalize();
    dst.P.push(v.x, v.y, v.z);
    dst.N.push(n.x, n.y, n.z);
    dst.C.push(src.C[i * 3], src.C[i * 3 + 1], src.C[i * 3 + 2]);
    dst.K.push(src.K[i]);
    dst.B.push(src.B[i]);
    dst.G.push(src.G[i]);
    dst.D.push(src.D[i * 2], src.D[i * 2 + 1]);
  }
  for (const i of src.I) dst.I.push(base + i);
}

/** Convex (x, y) profile extruded across z0..z1; pts counter-clockwise seen from +z. */
function prism(vb, pts, z0, z1, o) {
  vb.poly(pts.map(([x, y]) => [x, y, z1]), [0, 0, 1], o);
  vb.poly(pts.map(([x, y]) => [x, y, z0]), [0, 0, -1], o);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    vb.face([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [b[1] - a[1], a[0] - b[0], 0], o);
  }
}

function wheelHi(vb, x, y, z, r, w, truck = false) {
  const sub = new VB();
  addWheel(sub, r, w, { spokes: truck ? 6 : 5, lugs: 0, truck });
  const m = new THREE.Matrix4().makeTranslation(x, y, z);
  if (z < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  appendVB(vb, sub, m);
}
const wheelLo = (vb, x, y, z, r, w) => vb.cyl(x, y, z, r, w, 'z', TYRE, 8);

// ── Passenger vehicles: low-poly proxies ──────────────────────────────────────
const LO_CARS = {
  sedan: { L: 4.72, W: 1.8, sill: 0.28, belt: 1.0, cab: [[-1.55, 1.0], [-1.0, 1.4], [0.5, 1.44], [1.1, 1.0]], wheels: [1.5, -1.4], wr: 0.335, ww: 0.22, hy: 0.78, ty: 0.82 },
  suv: { L: 4.78, W: 1.86, sill: 0.34, belt: 1.12, cab: [[-2.3, 1.12], [-2.25, 1.74], [0.35, 1.74], [1.0, 1.14]], wheels: [1.5, -1.4], wr: 0.385, ww: 0.24, hy: 0.92, ty: 1.0 },
  hatch: { L: 4.05, W: 1.7, sill: 0.27, belt: 0.98, cab: [[-1.95, 1.0], [-1.7, 1.42], [0.2, 1.44], [0.85, 1.0]], wheels: [1.28, -1.2], wr: 0.31, ww: 0.2, hy: 0.76, ty: 0.88 },
  van: { L: 5.9, W: 1.96, sill: 0.36, belt: 1.25, cab: [[-2.95, 1.25], [-2.9, 2.46], [1.6, 2.54], [2.1, 2.5], [2.55, 1.58], [2.55, 1.25]], wheels: [1.85, -1.75], wr: 0.375, ww: 0.235, hy: 0.95, ty: 1.1 },
  pickup: { L: 5.9, W: 1.94, sill: 0.4, belt: 1.32, cab: [[-0.35, 1.32], [-0.15, 1.9], [1.0, 1.9], [1.46, 1.45], [1.75, 1.3]], wheels: [1.75, -1.45], wr: 0.4, ww: 0.26, hy: 1.0, ty: 1.0, bed: true },
};

function loCar(d) {
  const vb = new VB();
  const hw = d.W / 2, L2 = d.L / 2;
  // lower body with a chamfered nose and tail
  const low = [[-L2 + 0.05, d.sill], [L2 - 0.05, d.sill], [L2, d.sill + 0.2], [L2, d.belt - 0.2], [L2 - 0.5, d.belt], [-L2 + 0.4, d.belt], [-L2, d.belt - 0.12], [-L2, d.sill + 0.2]];
  prism(vb, low, -hw, hw, PAINT);
  if (d.bed) {
    // open bed: a lowered floor and side walls behind the cab
    vb.box(-L2 + 0.05, -0.45, d.belt - 0.04, d.belt + 0.04, -hw * 0.88, hw * 0.88, BLK);
    for (const s of [-1, 1]) vb.box(-L2 + 0.05, -0.45, d.belt, d.belt + 0.02, s * hw * 0.92 - 0.04, s * hw * 0.92 + 0.04, PAINT);
  }
  // greenhouse: dark glass shape with a painted roof cap
  prism(vb, d.cab, -hw * 0.84, hw * 0.84, GLS);
  const top = d.cab.reduce((a, p) => (p[1] > a[1] ? p : a));
  const xs = d.cab.filter((p) => p[1] > top[1] - 0.06).map((p) => p[0]);
  const xa = Math.min(...xs), xb = Math.max(...xs);
  vb.box(xa - 0.1, xb + 0.1, top[1] - 0.05, top[1] + 0.02, -hw * 0.8, hw * 0.8, PAINT);
  for (const s of [-1, 1]) {
    vb.box(L2 - 0.03, L2 + 0.02, d.hy - 0.07, d.hy + 0.07, s * hw * 0.62 - 0.17, s * hw * 0.62 + 0.17, HEAD);
    vb.box(-L2 - 0.02, -L2 + 0.03, d.ty - 0.07, d.ty + 0.07, s * hw * 0.62 - 0.17, s * hw * 0.62 + 0.17, TAIL);
    for (const x of d.wheels) wheelLo(vb, x, d.wr, s * (hw - d.ww / 2 + 0.01), d.wr, d.ww);
  }
  vb.box(L2 - 0.1, L2 + 0.04, d.sill + 0.04, d.sill + 0.26, -hw * 0.92, hw * 0.92, BLK);
  vb.box(-L2 - 0.04, -L2 + 0.1, d.sill + 0.04, d.sill + 0.26, -hw * 0.92, hw * 0.92, BLK);
  return vb.build();
}

// ── Motorhome and coach ───────────────────────────────────────────────────────
function buildRV(hi) {
  const vb = new VB();
  const L = 8.4, hw = 1.2, y0 = 0.62, y1 = 3.3;
  const box = (cx, cy, cz, sx, sy, sz, r, o) => (hi ? vb.rbox(cx, cy, cz, sx, sy, sz, r, o) : vb.box(cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, o));
  box(-0.4, (y0 + y1) / 2, 0, L - 0.8, y1 - y0, hw * 2, 0.18, PAINT); // box body
  box(3.35, 1.5, 0, 1.7, 1.7, hw * 2 - 0.1, 0.22, PAINT); // cab
  vb.face([4.18, 1.45, -1.05], [4.18, 1.45, 1.05], [3.95, 2.45, 1.05], [3.95, 2.45, -1.05], [1, 0.3, 0], GLS); // windshield
  for (const s of [-1, 1]) {
    vb.face([2.9, 1.5, s * (hw + 0.015)], [3.6, 1.5, s * (hw - 0.05)], [3.6, 2.3, s * (hw - 0.05)], [2.9, 2.3, s * (hw + 0.015)], [0, 0, s], GLS); // cab window
    vb.box(-2.2, 0.4, 1.7, 2.6, s * (hw + 0.012), s * (hw + 0.026), GLS); // living area window
    vb.box(-3.9, -3.0, 1.9, 2.5, s * (hw + 0.012), s * (hw + 0.026), GLS);
    vb.box(-3.9, 3.7, 1.0, 1.12, s * (hw + 0.008), s * (hw + 0.02), { col: lin([0.12, 0.2, 0.32]), kind: KIND.PLASTIC }); // body stripe
    vb.box(4.14, 4.22, 0.85, 1.15, s * 0.8 - 0.2, s * 0.8 + 0.2, HEAD);
    vb.box(-4.62, -4.58, 0.95, 1.6, s * 1.0 - 0.07, s * 1.0 + 0.07, TAIL);
    vb.box(-4.62, -4.58, 1.7, 1.78, s * 1.0 - 0.07, s * 1.0 + 0.07, AMBER);
  }
  vb.box(-4.4, -4.3, 2.05, 3.0, -0.4, 0.4, GLS);
  vb.box(4.12, 4.35, 0.5, 0.95, -1.15, 1.15, BLK); // bumper
  vb.box(-4.7, -4.4, 0.45, 0.8, -1.15, 1.15, BLK);
  vb.box(-3.4, -1.9, 3.3, 3.62, -0.5, 0.5, WHITE); // roof A/C
  vb.box(-1.2, 1.2, 0.5, 0.62, -1.0, 1.0, FRAME);
  for (const x of [-2.6, 2.5]) for (const s of [-1, 1]) {
    const z = s * (hw - 0.22);
    if (hi) wheelHi(vb, x, 0.45, z, 0.45, 0.3, true);
    else wheelLo(vb, x, 0.45, z, 0.45, 0.3);
  }
  return vb.build();
}

function buildCoach(hi) {
  const vb = new VB();
  const L = 12.2, hw = 1.27, y0 = 0.55, y1 = 3.45;
  const box = (cx, cy, cz, sx, sy, sz, r, o) => (hi ? vb.rbox(cx, cy, cz, sx, sy, sz, r, o) : vb.box(cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, o));
  box(0, (y0 + y1) / 2, 0, L, y1 - y0, hw * 2, 0.25, PAINT);
  box(0, 2.0, 0, L - 0.2, 0.9, hw * 2 + 0.02, 0.05, { col: lin([0.55, 0.57, 0.6]), kind: KIND.METAL }); // silver mid band behind the glass
  for (const s of [-1, 1]) {
    vb.box(-5.4, 5.0, 1.9, 2.75, s * (hw + 0.012), s * (hw + 0.03), GLS); // window band
    vb.box(-L / 2, L / 2, 1.2, 1.32, s * (hw + 0.008), s * (hw + 0.022), { col: lin([0.12, 0.22, 0.4]), kind: KIND.PLASTIC });
    vb.box(L / 2 - 0.02, L / 2 + 0.04, 0.85, 1.1, s * 0.8 - 0.2, s * 0.8 + 0.2, HEAD);
    vb.box(-L / 2 - 0.04, -L / 2 + 0.02, 0.95, 1.2, s * 1.0 - 0.18, s * 1.0 + 0.18, TAIL);
    vb.box(-L / 2 - 0.04, -L / 2 + 0.02, 1.45, 1.55, s * 1.0 - 0.1, s * 1.0 + 0.1, AMBER);
  }
  vb.face([L / 2 + 0.02, 1.2, -1.15], [L / 2 + 0.02, 1.2, 1.15], [L / 2 - 0.1, 3.3, 1.15], [L / 2 - 0.1, 3.3, -1.15], [1, 0.1, 0], GLS);
  vb.box(-L / 2 + 0.1, -L / 2 + 0.16, 2.3, 3.0, -0.5, 0.5, GLS);
  vb.box(L / 2 - 0.1, L / 2 + 0.1, 0.45, 0.8, -1.2, 1.2, BLK);
  vb.box(-L / 2 - 0.1, -L / 2 + 0.1, 0.45, 0.8, -1.2, 1.2, BLK);
  for (const x of [4.2, -2.6, -4.0]) for (const s of [-1, 1]) {
    const z = s * (hw - 0.22);
    if (hi) wheelHi(vb, x, 0.5, z, 0.5, 0.3, true);
    else wheelLo(vb, x, 0.5, z, 0.5, 0.3);
  }
  return vb.build();
}

// ── Semi tractor and trailers: low-poly proxies ───────────────────────────────
function loTractor() {
  const T = TRACTOR;
  const vb = new VB();
  vb.box(T.rearX, 7.2, 0.82, 1.14, -0.72, 0.72, FRAME);
  vb.box(3.9, 7.1, 1.1, 2.15, -0.74, 0.74, PAINT); // hood
  vb.box(7.1, 7.22, 1.05, 1.95, -0.6, 0.6, CH); // grille
  vb.box(7.1, 7.4, 0.6, 1.0, -1.22, 1.22, CH); // bumper
  vb.box(1.7, 3.75, 1.22, 3.28, -1.25, 1.25, PAINT); // cab
  vb.box(-1.0, 1.7, 1.22, 3.5, -1.27, 1.27, PAINT); // sleeper
  vb.poly([[3.75, 3.28, -1.15], [3.75, 3.28, 1.15], [1.3, 3.92, 1.15], [1.3, 3.92, -1.15]], [0, 1, 0], PAINT); // deflector roof
  vb.box(3.73, 3.79, 1.98, 3.12, -1.1, 1.1, GLS);
  for (const s of [-1, 1]) {
    vb.box(2.7, 3.7, 1.9, 3.0, s * 1.255, s * 1.275, GLS);
    vb.cyl(2.55, 0.78, s * 1.08, 0.36, 1.7, 'x', CH, 8);
    vb.cyl(1.56, 2.6, s * 1.12, 0.09, 2.4, 'y', CH, 5);
    vb.box(7.0, 7.14, 1.25, 1.55, s * 0.78 - 0.15, s * 0.78 + 0.15, HEAD);
    vb.box(7.05, 7.16, 1.08, 1.18, s * 0.93 - 0.07, s * 0.93 + 0.07, AMBER);
    vb.box(-2.0, -1.94, 0.88, 1.04, s * 0.8 - 0.12, s * 0.8 + 0.12, TAIL);
    wheelLo(vb, T.steerX, T.tyreR, s * T.steerTrack, T.tyreR, T.tyreW + 0.05);
    for (const x of T.driveX) wheelLo(vb, x, T.tyreR, s * T.driveTrack, T.tyreR, 0.62);
  }
  for (const z of [-0.8, -0.4, 0, 0.4, 0.8]) vb.box(3.6, 3.7, 3.28, 3.35, z - 0.06, z + 0.06, AMBER);
  return vb.build();
}

function loTrailer(type, cargo = 'lumber') {
  const T = TRAILER;
  const vb = new VB();
  const ax = [-T.kingToAxle + T.bogieGap / 2, -T.kingToAxle - T.bogieGap / 2];
  for (const s of [-1, 1]) {
    vb.box(T.rearX + 0.3, T.frontX - 0.2, 1.0, 1.22, s * 0.62 - 0.12, s * 0.62 + 0.12, FRAME);
    for (const x of ax) wheelLo(vb, x, T.tyreR, s * T.track, T.tyreR, 0.62);
    vb.box(T.rearX - 0.05, T.rearX + 0.02, 1.45, 1.65, s * 1.0 - 0.2, s * 1.0 + 0.2, TAIL);
    vb.box(T.rearX - 0.05, T.rearX + 0.02, 1.25, 1.33, s * 1.15 - 0.08, s * 1.15 + 0.08, AMBER);
  }
  vb.box(T.rearX - 0.15, T.rearX, 0.62, 0.86, -1.2, 1.2, FRAME);
  const x0 = T.rearX + 0.04, x1 = T.frontX;
  if (type === 'dryvan' || type === 'reefer') {
    vb.box(x0, x1, 1.24, 4.06, -1.3, 1.3, PAINT);
    vb.box(x0, x1, 4.06, 4.14, -1.3, 1.3, WHITE);
    if (type === 'reefer') vb.box(x1, x1 + 0.55, 2.4, 4.0, -1.0, 1.0, WHITE);
  } else if (type === 'flatbed') {
    vb.box(x0 + 0.2, x1 - 0.3, 1.24, 1.42, -1.28, 1.28, { col: COL.wood, kind: KIND.WOOD });
    vb.box(x1 - 0.4, x1 - 0.3, 1.42, 3.1, -1.25, 1.25, FRAME);
    const cs = { lumber: [lin([0.66, 0.48, 0.27]), 2.1], pipes: [lin([0.28, 0.3, 0.33]), 1.5], hay: [lin([0.78, 0.66, 0.3]), 2.3], machinery: [lin([0.9, 0.7, 0.08]), 1.9] }[cargo] || [lin([0.66, 0.48, 0.27]), 2.1];
    vb.box(-12.8, x1 - 0.6, 1.45, 1.45 + cs[1], -1.2, 1.2, { col: cs[0], kind: KIND.WOOD });
  } else if (type === 'tanker') {
    vb.cyl((x0 + x1) / 2 + 0.1, 2.5, 0, 1.18, x1 - x0 - 1.2, 'x', PAINT, 12);
    vb.box(-9.0, -5.0, 3.6, 3.74, -0.3, 0.3, CH);
  } else if (type === 'logs') {
    for (const x of [-1.8, -13.4]) vb.box(x - 0.1, x + 0.1, 1.3, 3.6, -1.3, 1.3, FRAME);
    const logs = { col: lin([0.38, 0.25, 0.14]), kind: KIND.WOOD };
    for (const [y, z] of [[1.9, -0.9], [1.9, 0], [1.9, 0.9], [2.6, -0.45], [2.6, 0.45], [3.3, 0]]) vb.cyl(-7.6, y, z, 0.45, 12.2, 'x', logs, 6);
  } else {
    vb.box(-14.25, -2.06, 1.42, 4.01, -1.22, 1.22, PAINT); // container
  }
  return vb.build();
}

// ── Registry ──────────────────────────────────────────────────────────────────
/** Which trailer variants exist: logo text + sign-atlas style, or the flatbed cargo. */
export const TRAILER_VARIANTS = {
  dryvan: [{ name: 'BIG SKY FREIGHT', style: 2 }, { name: 'TREASURE STATE LOGISTICS', style: 1 }, { name: 'PRAIRIE EXPRESS', style: 3 }],
  reefer: [{ name: 'COLD CHAIN EXPRESS', style: 3 }, { name: 'GLACIER FRESH', style: 0 }],
  flatbed: [{ cargo: 'lumber' }, { cargo: 'pipes' }, { cargo: 'hay' }, { cargo: 'machinery' }],
  tanker: [{ name: 'BIG SKY FUEL', style: 2 }],
  logs: [{}],
  container: [{ name: 'PACIFIC LINE', style: 4 }, { name: 'HANJIN BLUE', style: 1 }],
};
export const trailerKey = (type, variant) => `trailer:${type}:${variant}`;

export class TrafficModels {
  constructor(atlas) {
    this.atlas = atlas;
    this.cache = new Map();
    this.sizes = {};
  }

  /** Geometry for a model key and level of detail ('hi' | 'lo'); built on first use. */
  get(key, lod) {
    const id = `${key}|${lod}`;
    let g = this.cache.get(id);
    if (!g) {
      g = this.build(key, lod);
      this.cache.set(id, g);
    }
    return g;
  }

  build(key, lod) {
    const hi = lod === 'hi';
    if (key === 'rv') return buildRV(hi);
    if (key === 'bus') return buildCoach(hi);
    if (key === 'tractor') return hi ? buildTractor({ sleeper: true, wheels: 'merged', detail: 0.5 }).geo : loTractor();
    if (key.startsWith('trailer:')) {
      const [, type, vi] = key.split(':');
      const v = (TRAILER_VARIANTS[type] || [{}])[+vi || 0] || {};
      if (!hi) return loTrailer(type, v.cargo);
      const decal = (text, st) => this.atlas.slot(text, st);
      return buildTrailer(type, { wheels: 'merged', detail: 0.5, decal, name: v.name || 'BIG SKY FREIGHT', style: v.style ?? 2, cargo: v.cargo || 'lumber' }).geo;
    }
    if (!hi) return loCar(LO_CARS[key] || LO_CARS.sedan);
    return buildCar(key, { wheels: 'merged', detail: 0.5 }).geo;
  }

  dispose() {
    for (const g of this.cache.values()) g.dispose();
    this.cache.clear();
  }
}
