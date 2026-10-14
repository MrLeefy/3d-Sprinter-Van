// Roadside furnishing, streamed along the built road edges in 240 m blocks: power lines, ranch
// fences, mile markers, "next town" and speed-limit signs, billboards, and the discovery markers
// from poi.js with a prop for each kind. One merged mesh per block, drawn with the town building
// material (signs share the town sign atlas).
import * as THREE from 'three';
import { GB, K, geometryFromBuilder } from './buildings.js';
import { poisOf, POI_TYPES } from '../world/poi.js';
import { hash2, hashStr } from '../world/noise.js';
import { SLOGANS } from '../world/names.js';

const BLOCK = 240;
const POLE = 55;
const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const WOOD = lin([0.33, 0.24, 0.16]), DARK = lin([0.08, 0.08, 0.09]), STEEL = lin([0.5, 0.52, 0.55]), STONE = lin([0.5, 0.48, 0.44]), WIRE = lin([0.05, 0.05, 0.06]);
const LIMIT_MPH = { interstate: 80, highway: 65, county: 55, gravel: 35, dirt: 20 };
const mi = (m) => (m < 1609 * 9.5 ? `${Math.max(1, Math.round(m / 1609))}` : `${Math.round(m / 1609)}`);

/** Oriented box: local u runs along the facing's right vector t, d along its normal n. */
function obox(gb, cx, cz, y0, y1, hw, hd, yaw, col, kind = K.plain, seed = 1, topCol = null) {
  const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const P = (u, d, y) => [cx + tx * u + nx * d, y, cz + tz * u + nz * d];
  const c = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const normals = [[-nx, 0, -nz], [tx, 0, tz], [nx, 0, nz], [-tx, 0, -tz]];
  for (let i = 0; i < 4; i++) {
    const A = c[i], B = c[(i + 1) % 4];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    gb.quad(P(A[0], A[1], y0), P(B[0], B[1], y0), P(B[0], B[1], y1), P(A[0], A[1], y1), normals[i], col, kind, seed, [[0, 0], [len, 0], [len, y1 - y0], [0, y1 - y0]]);
  }
  if (topCol) gb.quad(P(c[0][0], c[0][1], y1), P(c[1][0], c[1][1], y1), P(c[2][0], c[2][1], y1), P(c[3][0], c[3][1], y1), [0, 1, 0], topCol, K.roof, seed);
}

/** A thin ribbon between two 3D points (a flat and an upright ribbon, both faces) for wires and strands. */
function wire(gb, a, b, w = 0.05, col = WIRE) {
  const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
  const su = [dz / l, 0, -dx / l]; // horizontal unit vector across the span
  const hx = su[0] * (w / 2), hz = su[2] * (w / 2);
  const flat = (n) => gb.quad([a[0] - hx, a[1], a[2] - hz], [a[0] + hx, a[1], a[2] + hz], [b[0] + hx, b[1], b[2] + hz], [b[0] - hx, b[1], b[2] - hz], n, col, K.plain, 3);
  flat([0, 1, 0]);
  flat([0, -1, 0]);
  const up = (n) => gb.quad([a[0], a[1] - w / 2, a[2]], [b[0], b[1] - w / 2, b[2]], [b[0], b[1] + w / 2, b[2]], [a[0], a[1] + w / 2, a[2]], n, col, K.plain, 3);
  up(su);
  up([-su[0], 0, -su[2]]);
}

/** Sign board on two posts; faces direction `yaw` (its normal). */
function board(gb, atlas, x, z, y, yaw, w, h, clear, text, style, seed = 1) {
  const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const P = (u, hh, d = 0) => [x + tx * u + nx * d, y + hh, z + tz * u + nz * d];
  for (const u of [-w / 2 + 0.35, w / 2 - 0.35]) obox(gb, x + tx * u, z + tz * u, y, y + clear + h, 0.07, 0.07, yaw, STEEL, K.plain, seed);
  obox(gb, x, z, y + clear, y + clear + h, w / 2, 0.04, yaw, lin([0.2, 0.2, 0.22]), K.plain, seed);
  const [u0, v0, u1, v1] = atlas.slot(text, style);
  const d = 0.06;
  gb.signQuad(P(-w / 2, clear, d), P(w / 2, clear, d), P(w / 2, clear + h, d), P(-w / 2, clear + h, d), [nx, 0, nz], u0, v0, u1, v1, seed);
}

// ── POI props ────────────────────────────────────────────────────────────────
function poiProp(gb, p, y, yaw) {
  const rot = (u, d) => [p.x + Math.cos(yaw) * u + Math.sin(yaw) * d, p.z - Math.sin(yaw) * u + Math.cos(yaw) * d];
  const at = (u, d, y0, y1, hw, hd, col, top = null) => {
    const [cx, cz] = rot(u, d);
    obox(gb, cx, cz, y + y0, y + y1, hw, hd, yaw, col, K.plain, 5, top);
  };
  const brown = lin([0.42, 0.26, 0.15]), red = lin([0.5, 0.14, 0.1]), grey = lin([0.55, 0.55, 0.57]), green = lin([0.12, 0.3, 0.14]);
  switch (p.type) {
    case 'overlook':
      for (let i = -3; i <= 3; i++) at(i * 1.6, -2.5, 0, 0.9, 0.55, 0.45, STONE, STONE);
      at(0, -4.5, 0, 0.5, 1.1, 0.25, WOOD, WOOD);
      break;
    case 'lakeview':
      at(0, -3, 0, 0.5, 1.2, 0.25, WOOD, WOOD);
      at(2.5, -3.5, 0, 0.7, 0.5, 0.5, STONE, STONE);
      at(-2.5, -3.6, 0, 0.5, 0.45, 0.45, STONE, STONE);
      break;
    case 'marker':
      at(0, -1.5, 0, 1.3, 0.9, 0.35, STONE, STONE);
      at(0, -1.5, 1.3, 1.45, 0.75, 0.25, lin([0.3, 0.3, 0.32]), lin([0.3, 0.3, 0.32]));
      break;
    case 'mine':
      for (const s of [-1, 1]) at(s * 1.1, -4, 0, 9, 0.18, 0.18, WOOD, WOOD);
      at(0, -4, 8.6, 9.2, 1.5, 0.22, WOOD, WOOD);
      at(0, -4, 4.5, 4.8, 1.1, 0.18, WOOD, WOOD);
      at(4, -3, 0, 3.2, 2.4, 1.8, lin([0.28, 0.2, 0.15]), lin([0.2, 0.2, 0.2]));
      at(-5, -3, 0, 0.9, 1.8, 1.0, lin([0.12, 0.1, 0.09]), lin([0.1, 0.09, 0.08]));
      break;
    case 'spring':
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        at(Math.cos(a) * 3.2, -5 + Math.sin(a) * 3.2, 0, 0.5, 0.9, 0.9, STONE, STONE);
      }
      at(0, -5, 0, 0.3, 2.9, 2.9, lin([0.2, 0.55, 0.62]), lin([0.25, 0.62, 0.7]));
      break;
    case 'oddity': {
      if (p.name.includes('Prairie Dog')) {
        at(0, -6, 0, 5, 1.8, 1.4, lin([0.6, 0.42, 0.25]));
        at(0, -6, 5, 7.2, 1.2, 1.2, lin([0.62, 0.45, 0.28]), lin([0.62, 0.45, 0.28]));
        at(0.5, -7, 5.8, 6.2, 0.35, 0.3, DARK);
        at(0, -6, 3.2, 3.8, 1.9, 0.8, lin([0.5, 0.35, 0.2]));
      } else if (p.name.includes('Bison')) {
        at(0, -6, 1.6, 4.2, 3.8, 1.6, lin([0.25, 0.16, 0.1]), lin([0.25, 0.16, 0.1]));
        at(-1, -6, 4.2, 5.4, 1.5, 1.4, lin([0.22, 0.14, 0.09]), lin([0.22, 0.14, 0.09]));
        at(4.4, -6, 1.8, 3.8, 1.1, 1.1, lin([0.2, 0.13, 0.09]), lin([0.2, 0.13, 0.09]));
        for (const [u, d] of [[-2.8, -1], [-2.8, 1], [2.4, -1], [2.4, 1]]) at(u, -6 + d, 0, 1.7, 0.3, 0.3, lin([0.18, 0.12, 0.08]));
      } else if (p.name.includes('Boot')) {
        at(0, -6, 0, 6.5, 1.3, 1.3, lin([0.55, 0.35, 0.18]), lin([0.55, 0.35, 0.18]));
        at(1.8, -6, 0, 2, 2.6, 1.3, lin([0.5, 0.31, 0.16]), lin([0.5, 0.31, 0.16]));
        at(0, -6, 0, 0.5, 1.5, 1.4, lin([0.2, 0.14, 0.1]));
      } else if (p.name.includes('Trout')) {
        at(0, -6, 2.5, 4.5, 4.4, 0.8, lin([0.62, 0.7, 0.72]), lin([0.62, 0.7, 0.72]));
        at(-4.8, -6, 3, 4.6, 0.5, 1.6, lin([0.55, 0.62, 0.64]));
        at(0, -6, 0, 2.5, 0.4, 0.4, STEEL);
      } else {
        at(0, -6, 0, 7.5, 1.3, 1.1, lin([0.2, 0.15, 0.1]), lin([0.2, 0.15, 0.1]));
        at(0, -6, 7.5, 9.2, 0.9, 0.9, lin([0.22, 0.17, 0.12]), lin([0.22, 0.17, 0.12]));
        for (const s of [-1, 1]) at(s * 1.9, -6, 3.2, 6.6, 0.4, 0.4, lin([0.2, 0.15, 0.1]));
      }
      break;
    }
    case 'barn': {
      at(0, -12, 0, 6, 6.5, 5, red);
      const [bx, bz] = rot(0, -12);
      gb.gable(bx - 6.5, bx + 6.5, bz - 5, bz + 5, y + 6, 3.2, 'x', lin([0.35, 0.33, 0.32]), red, K.metal, 5, 0.4);
      at(0, -7, 0, 3.6, 1.5, 0.12, lin([0.9, 0.88, 0.84]));
      break;
    }
    case 'tree': {
      const [cx, cz] = rot(0, -8);
      obox(gb, cx, cz, y, y + 7, 0.55, 0.55, yaw, lin([0.3, 0.2, 0.12]));
      for (let i = 0; i < 4; i++) gb.cyl(cx, cz, 4.8 - i * 0.95, y + 5 + i * 3.2, y + 5 + i * 3.2 + 0.1, 10, green, K.plain, 5, 3.4, green);
      break;
    }
    case 'rest':
      at(0, -5, 2.6, 3.0, 4.2, 2.6, lin([0.45, 0.3, 0.18]), lin([0.22, 0.28, 0.2]));
      for (const [u, d] of [[-3.8, -2.4], [3.8, -2.4], [-3.8, 2.4], [3.8, 2.4]]) at(u, -5 + d, 0, 2.6, 0.15, 0.15, WOOD);
      at(0, -5, 0.7, 0.8, 1.6, 0.5, WOOD, WOOD);
      at(0, -5, 0, 0.7, 0.15, 0.4, WOOD);
      break;
    default:
  }
  void grey;
}

/** Position and unit tangent at arc length s along a built edge. */
export function edgeAt(e, s) {
  const step = e.len / (e.n - 1);
  const kf = Math.max(0, Math.min(e.n - 1.001, s / step));
  const k = Math.floor(kf), t = kf - k;
  const x = e.xs[k] + (e.xs[k + 1] - e.xs[k]) * t, z = e.zs[k] + (e.zs[k + 1] - e.zs[k]) * t;
  const dx = e.xs[Math.min(e.n - 1, k + 2)] - e.xs[Math.max(0, k - 1)], dz = e.zs[Math.min(e.n - 1, k + 2)] - e.zs[Math.max(0, k - 1)], l = Math.hypot(dx, dz) || 1;
  return { x, z, tx: dx / l, tz: dz / l };
}

export class Roadside {
  constructor(land, world, stage, towns) {
    this.land = land;
    this.world = world;
    this.stage = stage;
    this.towns = towns;
    this.group = new THREE.Group();
    this.group.name = 'roadside';
    land.envRoot.add(this.group);
    this.blocks = new Map();
    this.queue = [];
    this.center = null;
    this.R = 560;
    this.irMat = null;
  }

  setQuality(tier) {
    this.R = { high: 600, medium: 480, low: 340, lite: 240 }[tier] || 600;
    this.center = null;
  }

  setMaterial(mat) {
    this.irMat = mat;
    for (const b of this.blocks.values()) if (b.mesh) b.mesh.material = mat || this.towns.bmat;
  }

  // ── Geometry along an edge ─────────────────────────────────────────────────
  at(e, s) {
    return edgeAt(e, s);
  }

  /** Signs for an edge, cached: [{ s, side, text, style, w, h, face }]. face = +1 toward traffic moving +s. */
  signsOf(e) {
    if (e._signs) return e._signs;
    const out = [];
    const cls = e.cls;
    const big = cls === 'interstate' || cls === 'highway';
    const h = (k) => hash2(hashStr(e.id), k, 77);
    const dest = (node, s, side, face) => {
      if (!node.name || node.kind === 'junction') return;
      const dist = face > 0 ? e.len - s : s;
      out.push({ s, side, text: `${node.name}\n${mi(dist)} mi`, style: 1, w: big ? 5.4 : 3.8, h: big ? 2.2 : 1.6, clear: big ? 2.4 : 1.6, face });
    };
    if (e.len > 2600) {
      dest(e.b, e.len - 3200, 1, 1);
      dest(e.a, 3200, -1, -1);
    }
    if (e.len > 1500) {
      dest(e.b, e.len - 1000, 1, 1);
      dest(e.a, 1000, -1, -1);
    }
    const lim = LIMIT_MPH[cls];
    if (lim) {
      out.push({ s: 110, side: 1, text: `SPEED LIMIT\n${lim}`, style: 5, w: 1.5, h: 1.9, clear: 1.5, face: 1, narrow: true });
      out.push({ s: e.len - 110, side: -1, text: `SPEED LIMIT\n${lim}`, style: 5, w: 1.5, h: 1.9, clear: 1.5, face: -1, narrow: true });
    }
    for (let m = 1; m * 1609.34 < e.len - 100; m++) out.push({ s: m * 1609.34, side: 1, text: `${m + Math.floor(h(9) * 40)}`, style: 1, w: 0.7, h: 0.9, clear: 0.7, face: 1, narrow: true });
    if (big) {
      const nb = Math.floor((e.len / 3400) * (0.5 + h(11)));
      for (let q = 0; q < nb; q++) {
        const s = e.len * (0.15 + 0.7 * ((q + 0.2 + 0.6 * h(12 + q)) / Math.max(1, nb)));
        const face = h(20 + q) < 0.5 ? 1 : -1;
        out.push({ s, side: face > 0 ? 1 : -1, text: SLOGANS[Math.floor(h(30 + q) * SLOGANS.length)], style: [0, 2, 3, 0, 2][Math.floor(h(40 + q) * 5)], w: 11, h: 3.4, clear: 4.2, face, off: 16 + h(50 + q) * 8, billboard: true });
      }
    }
    e._signs = out;
    return out;
  }

  flagsOf(e) {
    if (e._rf) return e._rf;
    const h = (k) => hash2(hashStr(e.id), k, 78);
    const p = { interstate: 0.3, highway: 0.75, county: 0.6, gravel: 0.25, dirt: 0 }[e.cls] ?? 0;
    const f = { power: h(1) < p ? (h(2) < 0.5 ? 1 : -1) : 0, fence: h(3) < ({ county: 0.5, gravel: 0.4 }[e.cls] || 0) ? (h(4) < 0.5 ? 1 : -1) : 0 };
    if (f.power && f.power === f.fence) f.fence = -f.fence;
    e._rf = f;
    return f;
  }

  // ── Streaming ──────────────────────────────────────────────────────────────
  update(x, z, sync = false) {
    const cx = Math.floor(x / 48), cz = Math.floor(z / 48);
    if (!this.center || this.center[0] !== cx || this.center[1] !== cz) {
      this.center = [cx, cz];
      this.plan(x, z);
    }
    const t0 = performance.now();
    const budget = this.budgetOverride ?? (sync ? 40 : 3);
    while (this.queue.length) {
      if (performance.now() - t0 > budget) break;
      const it = this.queue.shift();
      if (this.blocks.has(it.key)) continue;
      this.blocks.set(it.key, this.build(it));
    }
  }

  plan(x, z) {
    const R = this.R, W = this.world.gen || this.world;
    const want = new Map();
    for (const e of W.edges.values()) {
      if (e.minx === undefined) {
        let a = 1e18, b = -1e18, c = 1e18, d = -1e18;
        for (let k = 0; k < e.n; k++) {
          a = Math.min(a, e.xs[k]);
          b = Math.max(b, e.xs[k]);
          c = Math.min(c, e.zs[k]);
          d = Math.max(d, e.zs[k]);
        }
        Object.assign(e, { minx: a, maxx: b, minz: c, maxz: d });
      }
      if (x < e.minx - R - 80 || x > e.maxx + R + 80 || z < e.minz - R - 80 || z > e.maxz + R + 80) continue;
      const nb = Math.ceil(e.len / BLOCK);
      for (let b = 0; b < nb; b++) {
        const m = this.at(e, Math.min(e.len, (b + 0.5) * BLOCK));
        const d = Math.hypot(m.x - x, m.z - z);
        if (d < R + BLOCK * 0.6) want.set(`${e.id}|${b}`, { key: `${e.id}|${b}`, e, b, d });
      }
    }
    for (const [k, v] of this.blocks) {
      if (want.has(k)) continue;
      const m = this.at(v.e, Math.min(v.e.len, (v.b + 0.5) * BLOCK));
      if (Math.hypot(m.x - x, m.z - z) > R + BLOCK) {
        this.drop(v);
        this.blocks.delete(k);
      }
    }
    this.queue = [...want.values()].filter((v) => !this.blocks.has(v.key)).sort((a, b) => a.d - b.d);
  }

  drop(v) {
    if (!v.mesh) return;
    this.group.remove(v.mesh);
    v.mesh.geometry.dispose();
  }

  build({ key, e, b }) {
    const W = this.world.gen || this.world;
    const s0 = b * BLOCK, s1 = Math.min(e.len, s0 + BLOCK);
    const mid = this.at(e, (s0 + s1) / 2);
    const ox = Math.round(mid.x), oz = Math.round(mid.z);
    const gb = new GB(ox, oz);
    const atlas = this.towns.atlas;
    const circles = [];
    const w2 = e.P.width / 2;
    const f = this.flagsOf(e);
    const place = (s, side, off) => {
      const p = this.at(e, s);
      return { x: p.x + -p.tz * side * (w2 + off), z: p.z + p.tx * side * (w2 + off), p };
    };
    const lon = (p) => Math.atan2(-p.tz, p.tx); // yaw whose right vector is the road tangent
    // power line: poles every 55 m on one side, three sagging wires
    if (f.power) {
      const i0 = Math.ceil(s0 / POLE), i1 = Math.ceil(s1 / POLE) - 1;
      for (let i = i0; i <= i1; i++) {
        const s = i * POLE;
        if (s < 40 || s > e.len - 40) continue;
        const A = place(s, f.power, 9), B = place(Math.min(e.len - 20, s + POLE), f.power, 9);
        if (W.settlementAt(A.x, A.z, 30)) continue;
        const ya = W.heightAt(A.x, A.z), yb = W.heightAt(B.x, B.z);
        obox(gb, A.x, A.z, ya, ya + 9.6, 0.13, 0.13, 0, WOOD, K.plain, 3, WOOD);
        // crossarm perpendicular to the road
        const yaw = lon(A.p) + Math.PI / 2;
        obox(gb, A.x, A.z, ya + 9.0, ya + 9.2, 1.3, 0.07, yaw, WOOD, K.plain, 3, WOOD);
        circles.push({ x: A.x, z: A.z, r: 0.25, kind: 'pole' });
        if (yb && B.x !== A.x) {
          for (const u of [-1.1, 0, 1.1]) {
            const ax = A.x + Math.cos(yaw) * u, az = A.z - Math.sin(yaw) * u, bx = B.x + Math.cos(yaw) * u, bz = B.z - Math.sin(yaw) * u;
            let prev = [ax, ya + 9.15, az];
            for (let q = 1; q <= 4; q++) {
              const t = q / 4, sag = 1.1 * 4 * t * (1 - t);
              const cur = [ax + (bx - ax) * t, ya + 9.15 + (yb - ya) * t - sag, az + (bz - az) * t];
              wire(gb, prev, cur, 0.05);
              prev = cur;
            }
          }
        }
      }
    }
    // ranch fence: posts every 6 m with three strands
    if (f.fence) {
      let prevTop = null;
      for (let s = Math.ceil(s0 / 6) * 6; s < s1; s += 6) {
        if (s < 30 || s > e.len - 30) {
          prevTop = null;
          continue;
        }
        const A = place(s, f.fence, 7);
        if (W.settlementAt(A.x, A.z, 30)) {
          prevTop = null;
          continue;
        }
        const ya = W.heightAt(A.x, A.z);
        obox(gb, A.x, A.z, ya, ya + 1.25, 0.06, 0.06, 0, WOOD, K.plain, 3, WOOD);
        if (prevTop) for (const hh of [0.45, 0.85, 1.2]) wire(gb, [prevTop.x, prevTop.y + hh, prevTop.z], [A.x, ya + hh, A.z], 0.03);
        prevTop = { x: A.x, y: ya, z: A.z };
      }
    }
    // signs and billboards
    for (const sg of this.signsOf(e)) {
      if (sg.s < s0 || sg.s >= s1) continue;
      const off = sg.off ?? (sg.narrow ? 3.2 : 5);
      const A = place(sg.s, sg.side, off);
      if (W.settlementAt(A.x, A.z, 20)) continue;
      const nx = sg.face > 0 ? -A.p.tx : A.p.tx, nz = sg.face > 0 ? -A.p.tz : A.p.tz;
      const yaw = Math.atan2(nx, nz);
      const y = W.heightAt(A.x, A.z);
      board(gb, atlas, A.x, A.z, y, yaw, sg.w, sg.h, sg.clear, sg.text, sg.style, 7);
      circles.push({ x: A.x, z: A.z, r: sg.w > 3 ? 0.9 : 0.25, kind: 'sign' });
    }
    // discoveries
    for (const p of poisOf(W, e)) {
      const m = p.k * (e.len / (e.n - 1));
      if (m < s0 || m >= s1) continue;
      const y = W.heightAt(p.x, p.z);
      const T = POI_TYPES[p.type];
      // sign at the road side of the prop, then the prop itself
      const sx = p.x + Math.sin(p.yaw) * 8, sz = p.z + Math.cos(p.yaw) * 8;
      board(gb, atlas, sx, sz, W.heightAt(sx, sz), p.yaw, 3.6, 1.5, 1.2, `${p.name}\n${T.label}`, 4, 9);
      poiProp(gb, p, y, p.yaw);
      circles.push({ x: p.x + Math.sin(p.yaw) * -5, z: p.z + Math.cos(p.yaw) * -5, r: p.type === 'oddity' || p.type === 'barn' || p.type === 'mine' ? 2.6 : 1.1, kind: 'boulder' });
    }
    const geo = geometryFromBuilder(gb);
    let mesh = null;
    if (geo) {
      mesh = new THREE.Mesh(geo, this.irMat || this.towns.bmat);
      mesh.position.set(ox, 0, oz);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    return { key, e, b, mesh, circles };
  }

  /** Solid roadside objects near a point (poles, sign posts, big props). */
  collidersNear(x, z, r = 40) {
    const out = [];
    for (const v of this.blocks.values()) for (const c of v.circles) if (Math.abs(c.x - x) < r && Math.abs(c.z - z) < r) out.push(c);
    return out;
  }

  tick() {}
}
