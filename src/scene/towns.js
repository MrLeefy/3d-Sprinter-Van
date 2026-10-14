// Town renderer: streams the settlement layouts around the van in 96 m tiles. Each tile is two
// meshes (merged buildings/props with the window shader; street, sidewalk, pavement and lawn
// ribbons that reuse the road shader) plus shared instancing for trees and parked cars.
import * as THREE from 'three';
import { TILE, tileKey, layoutOf } from '../world/layout.js';
import { GB, K, SignAtlas, buildLot, geometryFromBuilder, makeBuildingMaterial } from './buildings.js';
import { RC } from './landMaterials.js';
import { conifer, broadleaf } from './vegetation.js';
import { prng, hashStr } from '../world/noise.js';

const RADIUS = { high: 620, medium: 480, low: 340, lite: 250 };
const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const DARK = lin([0.1, 0.1, 0.11]), STEEL = lin([0.45, 0.47, 0.5]), WOOD = lin([0.4, 0.28, 0.18]), STONE = lin([0.5, 0.48, 0.45]);
const SW = 3.4; // sidewalk width (matches the layout's block inset)
const wrap = (v) => v - 1000 * Math.floor(v / 1000);
const decode = (key) => [Math.floor(key / 65536) - 32768, (key % 65536) - 32768];

// ── Cars (instanced, body tinted per instance) ───────────────────────────────
const CAR_COLS = [[0.92, 0.92, 0.9], [0.7, 0.72, 0.74], [0.12, 0.12, 0.13], [0.62, 0.1, 0.09], [0.12, 0.22, 0.45], [0.16, 0.34, 0.22], [0.55, 0.45, 0.3], [0.35, 0.37, 0.4], [0.85, 0.7, 0.15]].map(lin);

function boxGeo(parts) {
  const P = [], N = [], C = [], B = [], GL = [], I = [];
  const faces = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
    [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [[0, -1, 0], [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]]],
    [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]],
    [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  ];
  for (const [x0, x1, y0, y1, z0, z1, col, body, glow = 0] of parts) {
    for (const [n, q] of faces) {
      const b = P.length / 3;
      for (const c of q) {
        P.push(c[0] ? x1 : x0, c[1] ? y1 : y0, c[2] ? z1 : z0);
        N.push(...n);
        C.push(...col);
        B.push(body ? 1 : 0);
        GL.push(glow);
      }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aBody', new THREE.Float32BufferAttribute(B, 1));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(GL, 1));
  g.setIndex(I);
  return g;
}

const GLASS = lin([0.14, 0.2, 0.26]), TYRE = lin([0.04, 0.04, 0.045]), WHITE = [1, 1, 1], LAMP = [1, 0.95, 0.85], TAIL = [0.9, 0.05, 0.04];
const lamps = (xf, xb, y, hw) => [-1, 1].flatMap((sd) => [[xf, xf + 0.06, y, y + 0.16, sd * hw - 0.17, sd * hw + 0.17, LAMP, 0, 1], [xb - 0.06, xb, y, y + 0.16, sd * hw - 0.17, sd * hw + 0.17, TAIL, 0, 2]]);
const shift = (parts, dx) => parts.map((p) => [p[0] + dx, p[1] + dx, ...p.slice(2)]);
const wheelsAt = (xs, hw, r = 0.36) => xs.flatMap((x) => [-1, 1].map((s) => [x - r, x + r, 0, r * 2, s * hw - 0.13, s * hw + 0.13, TYRE, 0]));
function tractorParts() {
  return [
    [-3.6, 3.4, 0.7, 1.35, -1.25, 1.25, lin([0.75, 0.76, 0.78]), 0],
    [1.2, 3.4, 1.35, 3.2, -1.25, 1.25, WHITE, 1],
    [2.9, 3.42, 2.0, 2.9, -1.1, 1.1, GLASS, 0],
    [3.4, 3.7, 0.8, 1.6, -1.1, 1.1, STEEL, 0],
    [-3.0, -0.6, 1.35, 1.55, -1.2, 1.2, lin([0.25, 0.25, 0.27]), 0],
    ...lamps(3.7, -3.6, 0.9, 0.9),
    ...wheelsAt([-2.6, -1.1, 2.3], 1.05, 0.5),
  ];
}
/** Car bodies, forward = +x. 0 sedan, 1 pickup, 2 tractor, 3 tractor + trailer, 4 motorhome. */
export function carGeometry(kind) {
  if (kind === 1) {
    return boxGeo([
      [-2.7, 2.7, 0.42, 1.12, -0.95, 0.95, WHITE, 1],
      [-0.3, 1.5, 1.12, 1.66, -0.88, 0.88, GLASS, 0],
      [-0.2, 1.4, 1.66, 1.72, -0.88, 0.88, WHITE, 1],
      [-2.7, -0.4, 1.12, 1.45, -0.95, -0.82, WHITE, 1],
      [-2.7, -0.4, 1.12, 1.45, 0.82, 0.95, WHITE, 1],
      [-2.7, -2.58, 1.12, 1.45, -0.95, 0.95, WHITE, 1],
      ...lamps(2.7, -2.7, 0.78, 0.7),
      ...wheelsAt([-1.65, 1.65], 0.85, 0.4),
    ]);
  }
  if (kind === 2) return boxGeo(tractorParts());
  if (kind === 3) {
    return boxGeo([
      ...shift(tractorParts(), 6.4),
      [-10.2, 2.6, 1.0, 4.1, -1.3, 1.3, WHITE, 1],
      [-10.2, 2.6, 0.55, 1.0, -1.1, 1.1, lin([0.2, 0.2, 0.22]), 0],
      [-10.35, -10.2, 3.2, 3.7, -0.9, 0.9, TAIL, 0, 2],
      ...wheelsAt([-8.4, -7.0], 1.1, 0.5),
    ]);
  }
  if (kind === 4) {
    return boxGeo([
      [-3.6, 3.6, 0.7, 3.5, -1.25, 1.25, WHITE, 1],
      [3.4, 3.65, 1.7, 2.9, -1.1, 1.1, GLASS, 0],
      [-3.6, 3.6, 3.5, 3.58, -1.2, 1.2, lin([0.75, 0.75, 0.77]), 0],
      [-3.0, 0.8, 1.7, 2.7, 1.24, 1.27, GLASS, 0],
      ...lamps(3.65, -3.6, 0.9, 0.85),
      ...wheelsAt([-2.4, 2.4], 1.0, 0.45),
    ]);
  }
  return boxGeo([
    [-2.3, 2.3, 0.38, 0.98, -0.88, 0.88, WHITE, 1],
    [-1.1, 1.0, 0.98, 1.4, -0.8, 0.8, GLASS, 0],
    [-1.0, 0.9, 1.4, 1.46, -0.8, 0.8, WHITE, 1],
    ...lamps(2.3, -2.3, 0.62, 0.6),
    ...wheelsAt([-1.4, 1.4], 0.78, 0.33),
  ]);
}

export function carMaterial(season) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.3, envMapIntensity: 1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = season.u.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBody;\nattribute vec3 aCarCol;\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.xyz *= mix(vec3(1.0), aCarCol, aBody);\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += (vGlow > 1.5 ? vec3(1.0, 0.05, 0.03) : vec3(1.0, 0.92, 0.75)) * step(0.5, vGlow) * (0.25 + uNight * 2.6);');
  };
  m.customProgramCacheKey = () => 'townCars2';
  return m;
}

// ── Small prop builders (merged into the tile geometry) ──────────────────────
function lamp(gb, x, z, rot, y) {
  const dx = Math.round(Math.cos(rot)), dz = -Math.round(Math.sin(rot));
  gb.box(x - 0.07, x + 0.07, z - 0.07, z + 0.07, y, y + 6.4, DARK, K.plain, 1, DARK);
  const ex = x + dx * 1.7, ez = z + dz * 1.7;
  gb.box(Math.min(x, ex) - 0.05, Math.max(x, ex) + 0.05, Math.min(z, ez) - 0.05, Math.max(z, ez) + 0.05, y + 6.3, y + 6.4, DARK, K.plain, 1, DARK);
  const hx = x + dx * 1.45, hz = z + dz * 1.45;
  gb.box(hx - 0.28, hx + 0.28, hz - 0.28, hz + 0.28, y + 6.12, y + 6.3, [1, 1, 1], K.panel, 1, null);
}

function corral(gb, x, z, y) {
  const w = 16, d = 11;
  for (const [x0, x1, z0, z1] of [[x - w / 2, x + w / 2, z - d / 2, z - d / 2], [x - w / 2, x + w / 2, z + d / 2, z + d / 2], [x - w / 2, x - w / 2, z - d / 2, z + d / 2], [x + w / 2, x + w / 2, z - d / 2, z + d / 2]]) {
    for (const hy of [0.55, 1.05, 1.5]) gb.box(x0 - 0.04, x1 + 0.04, z0 - 0.04, z1 + 0.04, y + hy, y + hy + 0.09, WOOD, K.plain, 2, WOOD);
  }
  for (let i = 0; i <= 8; i++) for (const zz of [z - d / 2, z + d / 2]) gb.box(x - w / 2 + (i * w) / 8 - 0.09, x - w / 2 + (i * w) / 8 + 0.09, zz - 0.09, zz + 0.09, y, y + 1.65, WOOD, K.plain, 2, WOOD);
}

function campsite(gb, x, z, a, y, seed) {
  const c = Math.cos(a), s = Math.sin(a);
  const at = (u, v) => [x + u * c - v * s, z + u * s + v * c];
  const table = (u, v) => {
    const [px, pz] = at(u, v);
    gb.box(px - 0.9, px + 0.9, pz - 0.4, pz + 0.4, y + 0.72, y + 0.78, WOOD, K.plain, seed, WOOD);
    gb.box(px - 0.9, px + 0.9, pz - 0.85, pz - 0.5, y + 0.42, y + 0.47, WOOD, K.plain, seed, WOOD);
    gb.box(px - 0.9, px + 0.9, pz + 0.5, pz + 0.85, y + 0.42, y + 0.47, WOOD, K.plain, seed, WOOD);
    for (const sx of [-0.8, 0.8]) gb.box(px + sx - 0.05, px + sx + 0.05, pz - 0.7, pz + 0.7, y, y + 0.72, WOOD, K.plain, seed, null);
  };
  table(0, 0);
  const [fx, fz] = at(3.2, 1.4);
  gb.cyl(fx, fz, 0.7, y, y + 0.28, 8, STONE, K.plain, seed);
  const [tx, tz] = at(-4, 2.8);
  gb.gable(tx - 1.2, tx + 1.2, tz - 1.4, tz + 1.4, y + 0.05, 1.5, 'x', lin([0.75, 0.45, 0.15]), lin([0.75, 0.45, 0.15]), K.plain, seed, 0);
}

function welcomeSign(gb, sg, node, atlas, y) {
  const nx = Math.sin(sg.yaw), nz = Math.cos(sg.yaw), tx = Math.cos(sg.yaw), tz = -Math.sin(sg.yaw);
  const hw = 3.6;
  const P = (u, h, d = 0) => [sg.x + tx * u + nx * d, y + h, sg.z + tz * u + nz * d];
  for (const u of [-hw + 0.3, hw - 0.3]) gb.box(sg.x + tx * u - 0.18, sg.x + tx * u + 0.18, sg.z + tz * u - 0.18, sg.z + tz * u + 0.18, y, y + 3.4, WOOD, K.plain, 3, WOOD);
  const seed = hashStr(node.name) % 97;
  const slotTop = atlas.slot(`Welcome to ${node.name}`, 1), slotBot = atlas.slot(`Pop. ${node.pop.toLocaleString('en-US')} · Elev. ${Math.round(node.elevM * 3.281).toLocaleString('en-US')} ft`, 2);
  for (const side of [1, -1]) {
    const n = [nx * side, 0, nz * side], d = 0.2 * side;
    const l = side > 0 ? -hw : hw, r = -l; // viewer's left / right along t
    gb.signQuad(P(l, 1.6, d), P(r, 1.6, d), P(r, 3.4, d), P(l, 3.4, d), n, slotTop[0], slotTop[1], slotTop[2], slotTop[3], seed);
    gb.signQuad(P(l, 0.9, d), P(r, 0.9, d), P(r, 1.6, d), P(l, 1.6, d), n, slotBot[0], slotBot[1], slotBot[2], slotBot[3], seed);
  }
  gb.box(sg.x - Math.abs(tx) * hw - Math.abs(nx) * 0.18, sg.x + Math.abs(tx) * hw + Math.abs(nx) * 0.18, sg.z - Math.abs(tz) * hw - Math.abs(nz) * 0.18, sg.z + Math.abs(tz) * hw + Math.abs(nz) * 0.18, y + 0.9, y + 3.4, WOOD, K.plain, 3, WOOD);
}

// ── Ground ribbons ───────────────────────────────────────────────────────────
class Ground {
  constructor(ox, oz, world) {
    this.ox = ox;
    this.oz = oz;
    this.W = world;
    this.P = [];
    this.N = [];
    this.R = [];
    this.I = [];
  }

  vtx(x, y, z, u, s, cls, w) {
    this.P.push(x - this.ox, y, z - this.oz);
    this.N.push(0, 1, 0);
    this.R.push(u, s, cls, w);
    return this.P.length / 3 - 1;
  }

  /** Strip along an axis-aligned or arbitrary segment, subdivided to follow the terrain. */
  strip(ax, az, bx, bz, w, cls, dy, s0 = 0) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const n = Math.max(1, Math.ceil(len / 9));
    const ux = (bx - ax) / len, uz = (bz - az) / len, rx = -uz, rz = ux;
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const y = this.W.heightAt(x, z) + dy, s = s0 + len * t;
      const l = this.vtx(x - rx * w / 2, y, z - rz * w / 2, -1, s, cls, w), r = this.vtx(x + rx * w / 2, y, z + rz * w / 2, 1, s, cls, w);
      if (prev) this.I.push(prev[0], prev[1], l, prev[1], r, l);
      prev = [l, r];
    }
  }

  /** Flat rectangle at node height. world-coordinate varyings for lawn/pavement/sidewalk patterns. */
  rect(x0, x1, z0, z1, cls, y) {
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
    const c = (x, z) => this.vtx(x, y, z, wrap(z) / 1, wrap(x), cls, 2);
    const a = c(x0, z0), b = c(x1, z0), d = c(x1, z1), e = c(x0, z1);
    this.I.push(a, d, b, a, e, d); // facing up
  }

  /** Intersection patch: constant u so no centre marking appears. */
  patch(x0, x1, z0, z1, cls, y, w) {
    const v = (x, z) => this.vtx(x, y, z, 1, wrap(x + z), cls, w);
    const a = v(x0, z0), b = v(x1, z0), d = v(x1, z1), e = v(x0, z1);
    this.I.push(a, d, b, a, e, d);
  }

  geometry() {
    if (!this.I.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(this.R, 4));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

/** Street pieces between crossings + intersection patches, computed once per layout. */
export function streetPlan(L) {
  if (L._plan) return L._plan;
  const axis = (s) => (Math.abs(s.az - s.bz) < 1e-6 ? 'h' : Math.abs(s.ax - s.bx) < 1e-6 ? 'v' : null);
  const plan = { pieces: [], patches: [] };
  const hs = L.streets.filter((s) => axis(s) === 'h' && s.kind !== 'gravel'), vs = L.streets.filter((s) => axis(s) === 'v' && s.kind !== 'gravel');
  const cut = (s, others, horiz) => {
    const lo = horiz ? Math.min(s.ax, s.bx) : Math.min(s.az, s.bz), hi = horiz ? Math.max(s.ax, s.bx) : Math.max(s.az, s.bz);
    const c = horiz ? s.az : s.ax;
    const iv = [];
    for (const o of others) {
      const oc = horiz ? o.ax : o.az; // the other street's fixed coordinate along this street's axis
      const oLo = horiz ? Math.min(o.az, o.bz) : Math.min(o.ax, o.bx), oHi = horiz ? Math.max(o.az, o.bz) : Math.max(o.ax, o.bx);
      if (oc > lo && oc < hi && c >= oLo && c <= oHi) iv.push([oc - o.w / 2, oc + o.w / 2]);
    }
    iv.sort((p, q) => p[0] - q[0]);
    let a = lo;
    for (const [i0, i1] of iv) {
      if (i0 > a + 0.1) plan.pieces.push({ s, a, b: i0, horiz, c });
      a = Math.max(a, i1);
    }
    if (hi > a + 0.1) plan.pieces.push({ s, a, b: hi, horiz, c });
  };
  for (const s of hs) cut(s, vs, true);
  for (const s of vs) cut(s, hs, false);
  for (const h of hs) {
    for (const v of vs) {
      if (v.ax > Math.min(h.ax, h.bx) && v.ax < Math.max(h.ax, h.bx) && h.az >= Math.min(v.az, v.bz) && h.az <= Math.max(v.az, v.bz)) {
        plan.patches.push({ x: v.ax, z: h.az, wx: v.w, wz: h.w, w: Math.min(v.w, h.w) });
      }
    }
  }
  for (const s of L.streets) if (!axis(s) || s.kind === 'gravel') plan.pieces.push({ s, a: 0, b: Math.hypot(s.bx - s.ax, s.bz - s.az), horiz: null });
  L._plan = plan;
  return plan;
}

export class Towns {
  constructor(land, world, stage) {
    this.land = land;
    this.world = world;
    this.stage = stage;
    this.season = land.season;
    this.group = new THREE.Group();
    this.group.name = 'towns';
    land.envRoot.add(this.group);
    this.atlas = new SignAtlas();
    this.bmat = makeBuildingMaterial(this.season, this.atlas);
    this.irMat = null;
    this.q = 'high';
    this.R = RADIUS.high;
    this.tiles = new Map(); // `${nodeKey}|${tileKey}` → tile
    this.queue = [];
    this.center = null;
    this.layouts = new Set();
    this.dirty = false;
    this.dirtyAge = 0;
    // shared instancing
    const vm = land.vm;
    const mk = (geo, mat, cap, extra) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (extra) extra(m);
      this.group.add(m);
      return m;
    };
    this.conifers = mk(conifer(), vm.pine, 1400);
    this.broads = mk(broadleaf(), vm.broad, 2400);
    this.conifers.receiveShadow = this.broads.receiveShadow = true;
    const cmat = carMaterial(this.season);
    this.cars = [0, 1, 2].map((k) =>
      mk(carGeometry(k), cmat, 700, (m) => {
        m.geometry.setAttribute('aCarCol', new THREE.InstancedBufferAttribute(new Float32Array(700 * 3), 3));
        m.castShadow = true;
        m.receiveShadow = true;
      }),
    );
    this.season.listeners.push(() => this.onSeason());
  }

  onSeason() {
    const g = this.conifers.geometry;
    g.attributes.color.array.set(g.userData.sets[this.season.conifer === 'snow' ? 'snow' : 'green']);
    g.attributes.color.needsUpdate = true;
  }

  setQuality(tier) {
    this.q = tier;
    this.R = RADIUS[tier] || RADIUS.high;
    this.center = null;
  }

  setMaterial(mat) {
    this.irMat = mat;
    for (const t of this.tiles.values()) {
      if (t.bld) t.bld.material = mat || this.bmat;
      if (t.gnd) t.gnd.material = mat || this.land.roadMat;
    }
    this.conifers.visible = this.broads.visible = !mat;
    for (const c of this.cars) c.visible = !mat;
  }

  tick() {
    const hi = this.stage.quality === 'high';
    for (const t of this.tiles.values()) if (t.bld) t.bld.castShadow = hi && t.near;
  }

  // ── Streaming ──────────────────────────────────────────────────────────────
  plan(x, z) {
    const R = this.R, W = this.world;
    const want = new Map();
    for (const node of W.nodesNear(x, z, R + 800)) {
      const L = layoutOf(W, node);
      for (const key of L.tiles.keys()) {
        const [tx, tz] = decode(key);
        const cx = (tx + 0.5) * TILE, cz = (tz + 0.5) * TILE;
        const d = Math.hypot(cx - x, cz - z);
        if (d > R + TILE * 0.8) continue;
        want.set(`${node.key}|${key}`, { node, L, key, tx, tz, d });
      }
    }
    for (const [k, t] of this.tiles) {
      if (want.has(k)) continue;
      if (Math.hypot((t.tx + 0.5) * TILE - x, (t.tz + 0.5) * TILE - z) > R + TILE * 1.6) {
        this.drop(t);
        this.tiles.delete(k);
      }
    }
    this.queue = [...want.entries()].filter(([k]) => !this.tiles.has(k)).map(([k, v]) => ({ k, ...v })).sort((a, b) => a.d - b.d);
    for (const t of this.tiles.values()) t.near = Math.hypot((t.tx + 0.5) * TILE - x, (t.tz + 0.5) * TILE - z) < 220;
  }

  update(x, z, sync = false) {
    const cx = Math.floor(x / 48), cz = Math.floor(z / 48);
    if (!this.center || this.center[0] !== cx || this.center[1] !== cz) {
      this.center = [cx, cz];
      this.plan(x, z);
    }
    const t0 = performance.now();
    const budget = this.budgetOverride ?? 4;
    while (this.queue.length) {
      const item = this.queue[0];
      if (!(sync && item.d < 260) && performance.now() - t0 > budget) break;
      this.queue.shift();
      if (this.tiles.has(item.k)) continue;
      this.tiles.set(item.k, this.build(item));
      this.dirty = true;
    }
    if (this.dirty && (!this.queue.length || this.dirtyAge++ > 20)) this.rebuildInstances();
  }

  // ── One tile ───────────────────────────────────────────────────────────────
  build({ node, L, key, tx, tz, d }) {
    const W = this.world, ox = tx * TILE, oz = tz * TILE;
    const inTile = (x, z) => x >= ox && x < ox + TILE && z >= oz && z < oz + TILE;
    const t = L.tiles.get(key);
    const gb = new GB(ox, oz), gr = new Ground(ox, oz, W);
    const y0 = node.h;
    const tile = { node, tx, tz, key, trees: [], cars: [], bld: null, gnd: null, near: d < 220 };
    // lots (assigned by their centre)
    for (const id of t.lots) {
      const lot = L.lots[id];
      if (!inTile(lot.x, lot.z)) continue;
      buildLot(gb, lot, node, this.atlas);
    }
    for (const id of t.lamps) {
      const p = L.props.lamps[id];
      if (inTile(p[0], p[1])) lamp(gb, p[0], p[1], p[2], W.heightAt(p[0], p[1]));
    }
    for (const id of t.misc) {
      const p = L.props.misc[id];
      if (!inTile(p[0], p[1])) continue;
      const h = W.heightAt(p[0], p[1]);
      if (p[3] === 'corral') corral(gb, p[0], p[1], h);
      else if (p[3] === 'campsite') campsite(gb, p[0], p[1], p[2], h, id);
    }
    for (const id of t.signs) {
      const sg = L.signs[id];
      if (inTile(sg.x, sg.z)) welcomeSign(gb, sg, node, this.atlas, W.heightAt(sg.x, sg.z));
    }
    for (const id of t.trees) {
      const p = L.props.trees[id];
      if (inTile(p[0], p[1])) tile.trees.push([p[0], W.heightAt(p[0], p[1]), p[1], p[2], p[3], id]);
    }
    for (const id of t.cars) {
      const p = L.props.cars[id];
      if (inTile(p[0], p[1])) tile.cars.push([p[0], W.heightAt(p[0], p[1]), p[1], p[2], p[3], p[4]]);
    }
    // ground: streets between crossings, intersections, sidewalks, block pavement / lawn
    const plan = streetPlan(L);
    const inter = (v, lo, hi) => v >= lo && v < hi;
    for (const pc of plan.pieces) {
      const s = pc.s;
      const cls = s.kind === 'gravel' ? RC.gravel : RC.street;
      const dy = s.kind === 'main' ? 0.075 : s.kind === 'minor' ? 0.06 : 0.05;
      if (pc.horiz === true) {
        const a = Math.max(pc.a, ox), b = Math.min(pc.b, ox + TILE);
        if (b > a && inter(pc.c, oz, oz + TILE)) gr.strip(a, pc.c, b, pc.c, s.w, cls, dy, a - Math.min(s.ax, s.bx));
      } else if (pc.horiz === false) {
        const a = Math.max(pc.a, oz), b = Math.min(pc.b, oz + TILE);
        if (b > a && inter(pc.c, ox, ox + TILE)) gr.strip(pc.c, a, pc.c, b, s.w, cls, dy, a - Math.min(s.az, s.bz));
      } else {
        const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
        if (inTile(mx, mz)) gr.strip(s.ax, s.az, s.bx, s.bz, s.w, cls, dy);
      }
    }
    for (const p of plan.patches) {
      if (!inTile(p.x, p.z)) continue;
      gr.patch(p.x - p.wx / 2, p.x + p.wx / 2, p.z - p.wz / 2, p.z + p.wz / 2, RC.street, y0 + 0.078, p.w);
    }
    for (const id of t.blocks) {
      const b = L.blocks[id];
      const bx = (b.x0 + b.x1) / 2, bz = (b.z0 + b.z1) / 2;
      if (!inTile(bx, bz)) continue;
      if (b.sidewalk !== false) {
        gr.rect(b.x0 - SW, b.x1 + SW, b.z0 - SW, b.z0, RC.sidewalk, y0 + 0.09);
        gr.rect(b.x0 - SW, b.x1 + SW, b.z1, b.z1 + SW, RC.sidewalk, y0 + 0.09);
        gr.rect(b.x0 - SW, b.x0, b.z0, b.z1, RC.sidewalk, y0 + 0.09);
        gr.rect(b.x1, b.x1 + SW, b.z0, b.z1, RC.sidewalk, y0 + 0.09);
      }
      gr.rect(b.x0, b.x1, b.z0, b.z1, b.pave ? RC.pavement : RC.lawn, y0 + (b.pave ? 0.1 : 0.05));
    }
    const geo = geometryFromBuilder(gb);
    if (geo) {
      tile.bld = new THREE.Mesh(geo, this.irMat || this.bmat);
      tile.bld.position.set(ox, 0, oz);
      tile.bld.receiveShadow = true;
      tile.bld.castShadow = this.stage.quality === 'high' && tile.near;
      this.group.add(tile.bld);
    }
    const gg = gr.geometry();
    if (gg) {
      tile.gnd = new THREE.Mesh(gg, this.irMat || this.land.roadMat);
      tile.gnd.position.set(ox, 0, oz);
      tile.gnd.receiveShadow = true;
      tile.gnd.renderOrder = 1;
      this.group.add(tile.gnd);
    }
    return tile;
  }

  drop(t) {
    for (const m of [t.bld, t.gnd]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.dirty = true;
    this.dirtyAge = 0;
  }

  rebuildInstances() {
    this.dirty = false;
    this.dirtyAge = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), eu = new THREE.Euler();
    let nc = 0, nb = 0;
    const cn = [0, 0, 0];
    const col = new THREE.Color();
    for (const t of this.tiles.values()) {
      for (const [x, y, z, sc, type, id] of t.trees) {
        const rn = prng(Math.floor(x * 31 + z * 17 + id) >>> 0);
        const r = rn() * Math.PI * 2;
        if (type === 0) {
          if (nc >= this.conifers.instanceMatrix.count) continue;
          const k = sc * 0.72;
          p.set(x, y, z);
          q.setFromEuler(eu.set(0, r, 0));
          s.set(k, k * (0.9 + rn() * 0.3), k);
          this.conifers.setMatrixAt(nc++, m4.compose(p, q, s));
        } else {
          if (nb >= this.broads.instanceMatrix.count) continue;
          const k = sc * 1.25;
          p.set(x, y, z);
          q.setFromEuler(eu.set(0, r, 0));
          s.set(k, k * (0.9 + rn() * 0.3), k);
          this.broads.setMatrixAt(nb++, m4.compose(p, q, s));
        }
      }
      for (const [x, y, z, rot, kind, rn] of t.cars) {
        const mesh = this.cars[kind] || this.cars[0], i = cn[kind] || 0;
        if (i >= 700) continue;
        p.set(x, y, z);
        q.setFromEuler(eu.set(0, rot, 0));
        s.set(1, 1, 1);
        mesh.setMatrixAt(i, m4.compose(p, q, s));
        const c = CAR_COLS[Math.floor(rn * CAR_COLS.length) % CAR_COLS.length];
        const a = mesh.geometry.attributes.aCarCol;
        a.setXYZ(i, c[0], c[1], c[2]);
        cn[kind] = i + 1;
      }
    }
    this.conifers.count = nc;
    this.broads.count = nb;
    this.conifers.instanceMatrix.needsUpdate = this.broads.instanceMatrix.needsUpdate = true;
    this.cars.forEach((m, k) => {
      m.count = cn[k];
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aCarCol.needsUpdate = true;
    });
    void col;
  }

  // ── Queries (collision, services) ──────────────────────────────────────────
  /** Solid building footprints and tree circles within r of (x, z). */
  collidersNear(x, z, r = 40) {
    const rects = [], circles = [];
    for (const node of this.world.nodesNear(x, z, r + 700)) {
      const L = layoutOf(this.world, node);
      L.collidersIn(x - r, x + r, z - r, z + r, rects);
    }
    for (const t of this.tiles.values()) {
      if (Math.abs((t.tx + 0.5) * TILE - x) > r + TILE || Math.abs((t.tz + 0.5) * TILE - z) > r + TILE) continue;
      for (const [tx, , tz, sc, type] of t.trees) if (Math.abs(tx - x) < r && Math.abs(tz - z) < r) circles.push({ x: tx, z: tz, r: type === 0 ? 0.35 * sc : 0.28 * sc });
    }
    return { rects, circles };
  }

  /** Service zones (fuel, water, dump, camp, shop) within r, nearest first. */
  zonesNear(x, z, r = 80, type = null) {
    const out = [];
    for (const node of this.world.nodesNear(x, z, r + 700)) {
      const L = layoutOf(this.world, node);
      for (const zn of L.zones) {
        if (type && zn.type !== type) continue;
        const d = Math.hypot(zn.x - x, zn.z - z);
        if (d <= r + zn.r) out.push({ ...zn, node, d });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  get stats() {
    let tris = 0;
    for (const t of this.tiles.values()) tris += (t.bld?.geometry.index.count || 0) / 3;
    return { tiles: this.tiles.size, tris: Math.round(tris), queue: this.queue.length };
  }
}
