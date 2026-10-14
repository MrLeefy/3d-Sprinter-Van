// Roadside furnishing, streamed along the built road edges in 240 m blocks: power lines, ranch
// fences, mile markers, "next town" and speed-limit signs, billboards, and the discovery markers
// from poi.js with a prop for each kind. One merged mesh per block, drawn with the town building
// material (signs share the town sign atlas).
import * as THREE from 'three';
import { GB, K, geometryFromBuilder } from './buildings.js';
import { poisOf, POI_TYPES } from '../world/poi.js';
import { hash2, hashStr } from '../world/noise.js';
import { SLOGANS } from '../world/names.js';
import { limitMph, mileMarkers, mileAt, advanceSigns, wildlifeSigns, guardSpans, exitLabel } from '../world/highway.js';
import { lin, WOOD, DARK, STEEL, STONE, obox, wire, board, makeCtx, guardrail, delineators, gantry, overpass, restArea, weighStation, runawayRamp, farmstead } from './roadprops.js';

const BLOCK = 240;
const POLE = 55;
const mi = (m) => (m < 1609 * 9.5 ? `${Math.max(1, Math.round(m / 1609))}` : `${Math.round(m / 1609)}`);

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

  /**
   * Signs for an edge, cached: [{ s, side, text, style, w, h, clear, face, ... }]. face = +1 toward traffic
   * moving +s. `gantry` signs span the interstate overhead; `kind` marks advance signs for lots.
   */
  signsOf(e) {
    if (e._signs) return e._signs;
    const out = [];
    const cls = e.cls;
    const big = cls === 'interstate' || cls === 'highway';
    const h = (k) => hash2(hashStr(e.id), k, 77);
    const dest = (node, s, side, face) => {
      if (!node.name || node.kind === 'junction') return;
      const dist = face > 0 ? e.len - s : s;
      out.push({ s, side, text: `${node.name}\n${mi(dist)} mi`, style: 1, w: big ? 5.4 : 3.8, h: big ? 2.2 : 1.6, clear: big ? 2.4 : 1.6, face, gantry: cls === 'interstate' });
    };
    if (e.len > 2600) {
      dest(e.b, e.len - 3200, 1, 1);
      dest(e.a, 3200, -1, -1);
    }
    if (e.len > 1500) {
      dest(e.b, e.len - 1000, 1, 1);
      dest(e.a, 1000, -1, -1);
    }
    // speed limits in mph, from the posted km/h table, repeated every ~4 km after each junction
    const lim = limitMph(cls);
    if (lim) {
      const text = `SPEED LIMIT\n${lim}`;
      for (let q = 0, s = 110; s < e.len - 300; q++, s = 110 + q * 4000) out.push({ s, side: 1, text, style: 5, w: 1.5, h: 1.9, clear: 1.5, face: 1, narrow: true });
      for (let q = 0, s = e.len - 110; s > 300; q++, s = e.len - 110 - q * 4000) out.push({ s, side: -1, text, style: 5, w: 1.5, h: 1.9, clear: 1.5, face: -1, narrow: true });
    }
    // mile posts count whole miles of the road's axis, so they agree across neighbouring edges
    if (cls !== 'dirt') for (const m of mileMarkers(e)) out.push({ s: m.s, side: 1, text: `MILE\n${m.mile}`, style: 1, w: 1.1, h: 0.6, clear: 0.8, face: 1, narrow: true });
    for (const w of wildlifeSigns(e)) out.push({ s: w.s, side: w.side, face: w.face, text: `${w.kind}\nCROSSING`, style: 3, w: 1.8, h: 0.9, clear: 1.4, narrow: true });
    if (big) {
      for (const sg of advanceSigns(e, { lots: e.lots })) {
        const style = sg.kind === 'rest' || sg.kind === 'weigh' ? 2 : 3;
        out.push({ s: sg.s, side: sg.side, face: sg.face, text: sg.text, style, w: 4.4, h: 1.6, clear: 1.8 });
      }
      for (const ov of e.overpasses) {
        const p = edgeAt(e, ov.s);
        const n = mileAt(e.dir, p.x, p.z), label = exitLabel(e, ov);
        for (const face of [1, -1]) {
          const sFar = ov.s - face * 820, sNear = ov.s - face * 300;
          out.push({ s: sFar, side: face, face, text: `EXIT ${n}  1/2 MILE\n${label}`, style: 1, w: 9.6, h: 2.4, gantry: cls === 'interstate', ...(cls === 'interstate' ? {} : { w: 5, h: 1.8, clear: 2.2 }) });
          out.push({ s: sNear, side: face, face, text: `EXIT ${n}\n${label}`, style: 1, w: 4.6, h: 1.7, clear: 2 });
        }
      }
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
    const ctx = makeCtx({ gb, atlas, W, e, circles, at: edgeAt });
    const hw = ctx.hw;
    const big = e.cls === 'interstate' || e.cls === 'highway';
    const f = this.flagsOf(e);
    const hid = hashStr(e.id);
    const place = (s, side, off) => {
      const p = this.at(e, s);
      return { x: p.x + -p.tz * side * (hw + off), z: p.z + p.tx * side * (hw + off), p };
    };
    const lon = (p) => Math.atan2(-p.tz, p.tx); // yaw whose right vector is the road tangent
    const nearOverpass = (s, m) => e.overpasses.some((ov) => Math.abs(ov.s - s) < m);
    // power line: poles every 55 m on one side, three sagging wires
    if (f.power) {
      const i0 = Math.ceil(s0 / POLE), i1 = Math.ceil(s1 / POLE) - 1;
      for (let i = i0; i <= i1; i++) {
        const s = i * POLE;
        if (s < 40 || s > e.len - 40 || nearOverpass(s, 12) || ctx.lotW(f.power, s) > 3) continue;
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
    // fences: posts every 6 m with three strands, wherever `on(s)` says so
    const fence = (side, off, on, salt) => {
      let prevTop = null;
      for (let s = Math.ceil(s0 / 6) * 6; s < s1; s += 6) {
        if (s < 30 || s > e.len - 30 || !on(s) || nearOverpass(s, 7) || ctx.lotW(side, s) > off - 1.5 || hash2(Math.floor(s / 6), hid + side, salt) < 0.012) {
          prevTop = null;
          continue;
        }
        const A = place(s, side, off);
        if (W.settlementAt(A.x, A.z, 30)) {
          prevTop = null;
          continue;
        }
        const ya = W.heightAt(A.x, A.z);
        obox(gb, A.x, A.z, ya, ya + 1.25, 0.06, 0.06, 0, WOOD, K.plain, 3, WOOD);
        if (prevTop) for (const hh of [0.45, 0.85, 1.2]) wire(gb, [prevTop.x, prevTop.y + hh, prevTop.z], [A.x, ya + hh, A.z], 0.03);
        prevTop = { x: A.x, y: ya, z: A.z };
      }
    };
    if (f.fence) fence(f.fence, 7, () => true, 61);
    // field fences: wherever the land beside the road is crop or pasture
    const bio = {};
    if (e.cls !== 'dirt') {
      for (const side of [1, -1]) {
        if (side === f.fence) continue;
        const off = e.cls === 'interstate' ? 11 : 6, memo = new Map();
        fence(side, off, (s) => {
          const q = Math.floor(s / 24);
          let v = memo.get(q);
          if (v === undefined) {
            const A = place(q * 24 + 12, side, off + 22);
            v = !W.settlementAt(A.x, A.z, 40) && W.biome(A.x, A.z, e.hs[Math.min(e.n - 1, Math.round(((q * 24 + 12) / e.len) * (e.n - 1)))], bio).field > 0.45;
            memo.set(q, v);
          }
          return v;
        }, 62);
      }
    }
    // guardrails along embankments, delineator posts, interchange overpasses, lots (interstate / highway / county)
    const railSpans = { 1: [], '-1': [] };
    if (e.cls !== 'gravel' && e.cls !== 'dirt') {
      const thr = big ? 1.3 : 2.2, STEP = 8;
      const sa = Math.max(40, s0 - STEP), sb = Math.min(e.len - 40, s1 + STEP);
      const n = Math.max(0, Math.floor((sb - sa) / STEP) + 1);
      for (const side of [1, -1]) {
        const need = new Array(n), blocked = new Array(n);
        for (let i = 0; i < n; i++) {
          const s = sa + i * STEP, A = place(s, side, 4);
          need[i] = ctx.roadY(s) - W.heightAt(A.x, A.z) > thr;
          blocked[i] = ctx.lotW(side, s) > 0.2 || nearOverpass(s, 26) || !!W.settlementAt(A.x, A.z, 30);
        }
        for (const [i0, i1] of guardSpans(need, blocked, 3, 2)) {
          const a = Math.max(s0, sa + i0 * STEP - 4), z1 = Math.min(s1, sa + i1 * STEP + 4);
          if (z1 - a < 8) continue;
          guardrail(ctx, side, a, z1);
          railSpans[side].push([a, z1]);
        }
      }
    }
    if (big) delineators(ctx, s0, s1, railSpans);
    for (const ov of e.overpasses) if (ov.s >= s0 && ov.s < s1) overpass(ctx, ov);
    for (const lot of e.lots) {
      const sc = (lot.s0 + lot.s1) / 2;
      if (sc < s0 || sc >= s1) continue;
      if (lot.kind === 'rest') restArea(ctx, lot);
      else if (lot.kind === 'weigh') weighStation(ctx, lot);
      else if (lot.kind === 'runaway') runawayRamp(ctx, lot);
    }
    // farmsteads: barn, silos, farmhouse, windmill and a paddock herd on cropland beside quieter roads
    if (e.cls !== 'interstate' && e.cls !== 'dirt') {
      const hh = (k) => hash2(hid, b * 31 + k, 303);
      if (hh(0) < (e.cls === 'highway' ? 0.14 : 0.24) && s1 - s0 > 150) {
        const side = hh(1) < 0.5 ? 1 : -1, s = s0 + 40 + hh(2) * (s1 - s0 - 80), dist = hw + 48 + hh(3) * 30;
        const A = place(s, side, 48 + hh(3) * 30 - 0);
        const okLot = ctx.lotW(side, s) < 1;
        if (okLot && s > 120 && s < e.len - 120 && !W.settlementAt(A.x, A.z, 60) && !nearOverpass(s, 120) && !W.lakesNear(A.x, A.z).some((l) => W.lakeRn(l, A.x, A.z) < 1.4)) {
          const roadY = ctx.roadY(s), g = W.heightAt(A.x, A.z);
          if (Math.abs(g - roadY) < 9 && W.biome(A.x, A.z, g, bio).field > 0.4) farmstead(ctx, s, side, dist, (k) => hash2(hid, b * 31 + k + 400, 304));
        }
      }
    }
    // signs and billboards
    for (const sg of this.signsOf(e)) {
      if (sg.s < s0 || sg.s >= s1) continue;
      if (sg.gantry) {
        if (!W.settlementAt(this.at(e, sg.s).x, this.at(e, sg.s).z, 20) && !nearOverpass(sg.s, 40)) gantry(ctx, sg.s, sg.face, sg.text, sg.style);
        continue;
      }
      const off = sg.off ?? (sg.narrow ? 3.2 : 5);
      const A = place(sg.s, sg.side, off);
      if (W.settlementAt(A.x, A.z, 20) || nearOverpass(sg.s, 16) || ctx.lotW(sg.side, sg.s) > off - 2) continue;
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
