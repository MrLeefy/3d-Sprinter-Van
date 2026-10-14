// Infinite, deterministic, season-independent world generator (pure JS, no three.js).
//
// Layers, from the ground up:
//   raw terrain     plains + mountain ranges + badlands (all from fixed-seed noise)
//   lakes           elliptical basins with banks; the water level is part of the land
//   settlement nodes one jittered node per 2.2 km cell: city, town, village, farm, lodge, truck stop,
//                   campground or plain junction; each flattens a plateau for its street grid
//   roads           A*-routed through valleys between neighbouring nodes (avoiding lakes and other
//                   towns), smoothed, graded (max grade per class) and blended into the land
// Seasons change only how the land is *drawn* (snow, ice, wet, tints), never what is here.
import { hash2, fbm, ridged, clamp, lerp, smoothstep, prng } from './noise.js';
import { CITY_NAMES, TOWN_NAMES, makeName } from './names.js';
import { SHOULDER, planHighway, lotArrays, lotAt } from './highway.js';

export const S = 2200; // node spacing (m)
const LS = 3600; // lake cell (m)
export const HC = 64; // road spatial-hash cell (m)
export const ELEV0 = 1100; // world y = 0 is 1,100 m above sea level (display only)

export const ROAD = {
  interstate: { id: 1, width: 17, grade: 0.055, smooth: 72, limit: 130, label: 'Interstate' },
  highway: { id: 2, width: 10.6, grade: 0.07, smooth: 52, limit: 110, label: 'Highway' },
  county: { id: 3, width: 8.2, grade: 0.085, smooth: 38, limit: 90, label: 'County road' },
  gravel: { id: 4, width: 6.6, grade: 0.11, smooth: 26, limit: 70, label: 'Gravel road' },
  dirt: { id: 5, width: 4.2, grade: 0.15, smooth: 16, limit: 40, label: 'Two-track' },
};
export const CLS_BY_ID = Object.fromEntries(Object.entries(ROAD).map(([k, v]) => [v.id, k]));

// Settlement kinds: grid half-extents (Rp east–west, Rz north–south), pavement
const KINDS = {
  city: { Rp: [640, 860], rz: 0.78, label: 'City' },
  town: { Rp: [230, 330], rz: 0.72, label: 'Town' },
  village: { Rp: [105, 150], rz: 0.6, label: 'Village' },
  farm: { Rp: [34, 38], rz: 1, label: 'Ranch' },
  lodge: { Rp: [46, 50], rz: 1, label: 'Lodge' },
  truckstop: { Rp: [52, 58], rz: 0.75, label: 'Travel plaza' },
  camp: { Rp: [62, 72], rz: 1, label: 'Campground' },
  junction: { Rp: [14, 14], rz: 1, label: 'Junction' },
};
export const KIND_LABEL = Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label]));

const mod = (a, n) => ((a % n) + n) % n;

class Heap {
  constructor() {
    this.id = [];
    this.k = [];
  }
  get size() {
    return this.id.length;
  }
  push(id, key) {
    const I = this.id, K = this.k;
    let i = I.length;
    I.push(id);
    K.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= K[i]) break;
      [I[p], I[i]] = [I[i], I[p]];
      [K[p], K[i]] = [K[i], K[p]];
      i = p;
    }
  }
  pop() {
    const I = this.id, K = this.k;
    const top = I[0];
    const li = I.pop(), lk = K.pop();
    if (I.length) {
      I[0] = li;
      K[0] = lk;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < I.length && K[l] < K[m]) m = l;
        if (r < I.length && K[r] < K[m]) m = r;
        if (m === i) break;
        [I[m], I[i]] = [I[i], I[m]];
        [K[m], K[i]] = [K[i], K[m]];
        i = m;
      }
    }
    return top;
  }
}

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]];

export class World {
  constructor(seed = 7) {
    this.seed = seed;
    this.sd = seed * 131;
    this.nodes = new Map();
    this.blocks = new Map();
    this.lakeCells = new Map();
    this.edges = new Map();
    this.hash = new Map();
    this.pads = [];
    this._f = { mtn: 0, bad: 0 };
    this._r = { d: 0, y: 0, edge: null, k: 0, t: 0, tx: 1, tz: 0, side: 1 };
    this._rq = { d: 0, y: 0, edge: null, k: 0, t: 0, tx: 1, tz: 0, side: 1 };
    this.home = null;
    this.makeHome();
  }

  // ── Regional fields ────────────────────────────────────────────────────────
  fields(x, z, o = this._f) {
    const sd = this.sd;
    o.mtn = smoothstep(0.52, 0.7, fbm(x / 15000 + 3.3, z / 15000 - 8.1, sd + 1, 3));
    o.bad = smoothstep(0.57, 0.75, fbm(x / 9000 - 5.2, z / 9000 + 2.4, sd + 2, 3)) * (1 - o.mtn);
    return o;
  }

  /** Natural ground height (m, relative to the datum) before lakes, towns and roads. */
  rawHeight(x, z) {
    const sd = this.sd;
    const f = this.fields(x, z, this._f);
    let h = 44 * (fbm(x / 5200 + 1.7, z / 5200 - 3.1, sd + 3, 3) - 0.5) + 18 * (fbm(x / 1500 - 2.9, z / 1500 + 5.5, sd + 13, 3) - 0.5) + 10 * (fbm(x / 760, z / 760, sd + 4, 3) - 0.5) + 2.4 * (fbm(x / 120, z / 120, sd + 5, 2) - 0.5);
    const M = f.mtn, B = f.bad;
    if (M > 0.001) {
      const cr = ridged(x / 1700 + 9.1, z / 1700 - 2.6, sd + 6, 4);
      const bulk = fbm(x / 4200, z / 4200, sd + 7, 3);
      h += M * (30 + 260 * cr * (0.35 + 1.1 * bulk));
    }
    if (B > 0.001) {
      const q = fbm(x / 320, z / 320, sd + 8, 3) * 5;
      const fl = Math.floor(q);
      const stepped = (fl + smoothstep(0.62, 1, q - fl)) / 5;
      h += B * (38 * stepped + 7 * ridged(x / 110, z / 110, sd + 9, 3) - 10);
    }
    return h;
  }

  slopeAt(x, z, d = 40) {
    return (Math.abs(this.rawHeight(x + d, z) - this.rawHeight(x - d, z)) + Math.abs(this.rawHeight(x, z + d) - this.rawHeight(x, z - d))) / (2 * d);
  }

  /** Vegetation / surface character at a point (for scatter and ground shading). */
  biome(x, z, h, o = {}) {
    const sd = this.sd;
    const f = this.fields(x, z, this._f);
    const M = f.mtn, B = f.bad;
    const alpine = smoothstep(190, 260, h);
    const moist = fbm(x / 6500 + 7.7, z / 6500 - 1.3, sd + 10, 3);
    const fo = fbm(x / 1100 + 2.2, z / 1100 - 6.4, sd + 11, 3);
    // forest floor weight: mountains and wet valleys, none in badlands or the dry plains
    let forest = clamp(0.2 + 1.3 * (fo - 0.5) + 0.55 * M + 0.55 * (moist - 0.5) - 0.7 * B, 0, 1);
    forest *= 1 - alpine;
    const field = smoothstep(0.46, 0.6, fbm(x / 3100 - 4.1, z / 3100 + 9.5, sd + 12, 3)) * (1 - smoothstep(0.1, 0.3, M)) * (1 - B) * (1 - smoothstep(0.35, 0.7, forest));
    o.mtn = M;
    o.bad = B;
    o.alpine = alpine;
    o.moist = moist;
    o.forest = forest;
    o.field = field;
    o.rock = clamp(alpine * 0.9 + M * 0.12 + B * 0.25, 0, 1);
    return o;
  }

  // ── Lakes ──────────────────────────────────────────────────────────────────
  lakeCell(a, b) {
    const key = `${a},${b}`;
    if (this.lakeCells.has(key)) return this.lakeCells.get(key);
    let lake = null;
    if (hash2(a, b, 40 + this.sd) < 0.55) {
      const cx = (a + 0.2 + 0.6 * hash2(a, b, 41 + this.sd)) * LS;
      const cz = (b + 0.2 + 0.6 * hash2(a, b, 42 + this.sd)) * LS;
      let R = 80 + 480 * Math.pow(hash2(a, b, 43 + this.sd), 1.5);
      const asp = 1 + 1.2 * hash2(a, b, 44 + this.sd);
      const ang = hash2(a, b, 45 + this.sd) * Math.PI;
      let ok = true;
      const reach = () => R * asp * 1.9;
      // stay clear of settlement footprints
      const ni = Math.floor(cx / S), nj = Math.floor(cz / S);
      for (let i = ni - 2; i <= ni + 2 && ok; i++) {
        for (let j = nj - 2; j <= nj + 2 && ok; j++) {
          const n = this.node(i, j);
          if (Math.hypot(n.x - cx, n.z - cz) < reach() + Math.max(n.Rp, n.Rz) * 1.15 + 140) ok = false;
        }
      }
      if (ok && Math.hypot(cx, cz) < reach() + 260) ok = false; // keep the starting area dry
      if (ok) {
        // water level = mean of the rim; reject or shrink if the rim is too uneven
        const hs = [];
        for (let k = 0; k < 8; k++) {
          const t = (k / 8) * Math.PI * 2;
          const ex = Math.cos(t) * R * asp * 0.95, ez = Math.sin(t) * R * 0.95;
          hs.push(this.rawHeight(cx + ex * Math.cos(ang) - ez * Math.sin(ang), cz + ex * Math.sin(ang) + ez * Math.cos(ang)));
        }
        const range = Math.max(...hs) - Math.min(...hs);
        if (range > 34) ok = false;
        else lake = { cx, cz, R, asp, ang, level: hs.reduce((s, v) => s + v, 0) / 8 - 0.9, depth: 2.4 + 5 * (R / 430), seed: a * 7919 + b, key };
      }
    }
    this.lakeCells.set(key, lake);
    return lake;
  }

  /** Normalised radius (1 = shore) of a point from a lake, with an irregular shoreline. */
  lakeRn(l, x, z) {
    const dx = x - l.cx, dz = z - l.cz;
    const c = Math.cos(l.ang), s = Math.sin(l.ang);
    const u = (dx * c + dz * s) / (l.R * l.asp), v = (-dx * s + dz * c) / l.R;
    const wob = 1 + 0.26 * (fbm(x / 210 + l.seed, z / 210 - l.seed, this.sd + 50, 3) - 0.5) * 2;
    return Math.hypot(u, v) / wob;
  }

  lakesNear(x, z) {
    const a = Math.floor(x / LS), b = Math.floor(z / LS);
    const out = [];
    for (let i = a - 1; i <= a + 1; i++) {
      for (let j = b - 1; j <= b + 1; j++) {
        const l = this.lakeCell(i, j);
        if (l) out.push(l);
      }
    }
    return out;
  }

  carveLakes(x, z, h) {
    const a = Math.floor(x / LS), b = Math.floor(z / LS);
    for (let i = a - 1; i <= a + 1; i++) {
      for (let j = b - 1; j <= b + 1; j++) {
        const l = this.lakeCell(i, j);
        if (!l) continue;
        const reach = l.R * l.asp * 2.2;
        if (Math.abs(x - l.cx) > reach || Math.abs(z - l.cz) > reach) continue;
        const rn = this.lakeRn(l, x, z);
        if (rn > 1.9) continue;
        const L = l.level;
        const bankTop = Math.max(h, L + 0.65);
        if (rn <= 1) h = L - 0.3 - l.depth * Math.pow(1 - rn * rn, 0.8);
        else if (rn < 1.12) h = lerp(L - 0.3, bankTop, smoothstep(1, 1.12, rn));
        else {
          const sm = smoothstep(1.12, 1.9, rn);
          h = Math.max(lerp(bankTop, h, sm), L + 0.25 * (1 - sm));
        }
      }
    }
    return h;
  }

  baseHeight(x, z) {
    return this.carveLakes(x, z, this.rawHeight(x, z));
  }

  // ── Settlement nodes ───────────────────────────────────────────────────────
  nominalKind(i, j) {
    const cx = i * S, cz = j * S;
    const M = this.fields(cx, cz, { mtn: 0, bad: 0 }).mtn;
    const r = hash2(i, j, 10 + this.sd);
    let k;
    if (r < 0.035) k = M > 0.55 ? 'town' : 'city';
    else if (r < 0.15) k = 'town';
    else if (r < 0.34) k = 'village';
    else if (r < 0.46) k = M > 0.35 ? 'lodge' : 'farm';
    else if (r < 0.52) k = 'truckstop';
    else if (r < 0.6) k = M > 0.15 ? 'camp' : 'farm';
    else k = 'junction';
    return k;
  }

  blockNames(bi, bj) {
    const key = `${bi},${bj}`;
    if (this.blocks.has(key)) return this.blocks.get(key);
    const names = new Map();
    const shuf = (pool, salt) => {
      const r = prng(Math.floor(hash2(bi, bj, salt + this.sd) * 4294967296));
      const a = pool.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const cityPool = shuf(CITY_NAMES, 1), townPool = shuf(TOWN_NAMES, 2);
    let ci = 0, ti = 0, vi = 0;
    for (let j = bj * 6; j < bj * 6 + 6; j++) {
      for (let i = bi * 6; i < bi * 6 + 6; i++) {
        const k = this.nominalKind(i, j);
        if (k === 'junction') continue;
        let name;
        if (k === 'city') name = cityPool[ci++ % cityPool.length];
        else if (k === 'town') name = townPool[ti++ % townPool.length];
        else if (k === 'village' && hash2(i, j, 60 + this.sd) < 0.4) name = townPool[(townPool.length - 1 - vi++) % townPool.length];
        else name = makeName(Math.floor(hash2(i, j, 61 + this.sd) * 4294967296));
        names.set(`${i},${j}`, name);
      }
    }
    this.blocks.set(key, names);
    return names;
  }

  node(i, j) {
    const key = `${i},${j}`;
    let n = this.nodes.get(key);
    if (n) return n;
    const sd = this.sd;
    let best = null;
    for (let t = 0; t < 4; t++) {
      const x = i * S + (hash2(i, j, 1 + sd) - 0.5) * 0.5 * S + (t ? (hash2(i, j, 3 + t + sd) - 0.5) * 520 : 0);
      const z = j * S + (hash2(i, j, 2 + sd) - 0.5) * 0.5 * S + (t ? (hash2(i, j, 8 + t + sd) - 0.5) * 520 : 0);
      const sl = this.slopeAt(x, z, 90);
      if (!best || sl < best.sl) best = { x, z, sl };
      if (sl < 0.035) break;
    }
    let kind = this.nominalKind(i, j);
    if (best.sl > 0.12 && (kind === 'city' || kind === 'town')) kind = best.sl > 0.18 ? 'junction' : 'village';
    if (best.sl > 0.18 && kind === 'village') kind = 'junction';
    const spec = KINDS[kind];
    const u = hash2(i, j, 70 + sd);
    const Rp = lerp(spec.Rp[0], spec.Rp[1], u);
    const Rz = Rp * spec.rz;
    const x = best.x, z = best.z;
    const h = (this.rawHeight(x, z) * 2 + this.rawHeight(x + 60, z) + this.rawHeight(x - 60, z) + this.rawHeight(x, z + 60) + this.rawHeight(x, z - 60)) / 6;
    let pop = 0;
    if (kind === 'city') pop = Math.round((20000 + 90000 * hash2(i, j, 71 + sd)) / 100) * 100;
    else if (kind === 'town') pop = Math.round((1200 + 8000 * hash2(i, j, 71 + sd)) / 10) * 10;
    else if (kind === 'village') pop = Math.round(60 + 800 * hash2(i, j, 71 + sd));
    const base = kind === 'junction' ? null : this.blockNames(Math.floor(i / 6), Math.floor(j / 6)).get(key) || makeName(i * 131 + j);
    let name = base;
    if (kind === 'farm') name = `${base} Ranch`;
    else if (kind === 'camp') name = `${base} Campground`;
    else if (kind === 'lodge') name = `${base} Lodge`;
    else if (kind === 'truckstop') name = `${base} Travel Plaza`;
    n = {
      key, i, j, x, z, h, kind, name, pop, Rp, Rz, slope: best.sl,
      elevM: Math.round(ELEV0 + h),
      portE: [x + Rp, z], portW: [x - Rp, z], portN: [x, z - Rz], portS: [x, z + Rz],
      seed: Math.floor(hash2(i, j, 72 + sd) * 4294967296),
    };
    this.nodes.set(key, n);
    return n;
  }

  /** Nodes whose footprint (plus margin) contains the point. */
  settlementAt(x, z, margin = 0) {
    const a = Math.floor(x / S), b = Math.floor(z / S);
    for (let i = a - 1; i <= a + 1; i++) {
      for (let j = b - 1; j <= b + 1; j++) {
        const n = this.node(i, j);
        if (Math.hypot((x - n.x) / (n.Rp + margin), (z - n.z) / (n.Rz + margin)) < 1.1) return n;
      }
    }
    return null;
  }

  nodesNear(x, z, r) {
    const out = [];
    const i0 = Math.floor((x - r) / S) - 1, i1 = Math.floor((x + r) / S) + 1, j0 = Math.floor((z - r) / S) - 1, j1 = Math.floor((z + r) / S) + 1;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const n = this.node(i, j);
        if (Math.hypot(n.x - x, n.z - z) <= r) out.push(n);
      }
    }
    return out;
  }

  // ── Roads ──────────────────────────────────────────────────────────────────
  edgeClass(i, j, dir) {
    if (dir === 0 && mod(j, 3) === 0) return mod(j, 6) === 0 ? 'interstate' : 'highway';
    if (dir === 1 && mod(i, 4) === 0) return 'highway';
    const a = this.node(i, j), b = dir === 0 ? this.node(i + 1, j) : this.node(i, j + 1);
    const paved = (k) => k === 'city' || k === 'town' || k === 'village' || k === 'truckstop';
    const rough = (k) => k === 'farm' || k === 'lodge' || k === 'camp';
    if (paved(a.kind) && (paved(b.kind) || b.kind === 'junction')) return 'county';
    if (paved(b.kind) && a.kind === 'junction') return 'county';
    if (rough(a.kind) || rough(b.kind)) return 'gravel';
    if (a.kind === 'junction' && b.kind === 'junction') return 'dirt';
    return hash2(i, j, 21 + dir + this.sd) < 0.5 ? 'county' : 'gravel';
  }

  edgeExists(i, j, dir) {
    const cls = this.edgeClass(i, j, dir);
    if (cls === 'interstate') return true;
    if (dir === 0 && mod(j, 3) === 0) return true;
    if (dir === 1 && mod(i, 4) === 0) return true;
    const p = cls === 'county' ? 0.92 : cls === 'gravel' ? 0.78 : 0.45;
    return hash2(i, j, 20 + dir + this.sd) < p;
  }

  roadName(i, j, dir, cls = this.edgeClass(i, j, dir)) {
    if (cls === 'interstate') return ['I-90', 'I-94', 'I-15'][mod(Math.floor(j / 6), 3)];
    if (dir === 0 && mod(j, 3) === 0) return ['US 2', 'US 12', 'US 87', 'MT 200'][mod(Math.floor(j / 3), 4)];
    if (dir === 1 && mod(i, 4) === 0) return ['US 93', 'US 191', 'US 89', 'MT 83', 'US 287'][mod(Math.floor(i / 4), 5)];
    const r = Math.floor(hash2(i, j, 22 + dir + this.sd) * 800);
    if (cls === 'county') return `MT ${200 + r}`;
    if (cls === 'gravel') return `Forest Rd ${1000 + r}`;
    return 'Two-track';
  }

  /** The edge between node (i, j) and its east (dir 0) or south (dir 1) neighbour; built on demand. */
  edge(i, j, dir) {
    const key = `${i},${j},${dir}`;
    let e = this.edges.get(key);
    if (e) return e;
    if (!this.edgeExists(i, j, dir)) return null;
    e = this.buildEdge(i, j, dir);
    this.edges.set(key, e);
    this.indexEdge(e);
    return e;
  }

  /** Corridor A* between two points over the base height (lakes and other towns are blocked). */
  route(sa, sb, cls, ends) {
    const P = ROAD[cls];
    const g = 26;
    const len = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
    const m = clamp(0.3 * len, 260, 700);
    const x0 = Math.min(sa[0], sb[0]) - m, z0 = Math.min(sa[1], sb[1]) - m;
    const nx = Math.ceil((Math.max(sa[0], sb[0]) + m - x0) / g) + 1, nz = Math.ceil((Math.max(sa[1], sb[1]) + m - z0) / g) + 1;
    const N = nx * nz;
    const H = new Float32Array(N), blocked = new Uint8Array(N);
    const cx = (i) => x0 + i * g, cz = (j) => z0 + j * g;
    const midx = (x0 + (x0 + nx * g)) / 2, midz = (z0 + (z0 + nz * g)) / 2;
    const others = this.nodesNear(midx, midz, Math.hypot(nx, nz) * g * 0.5 + 1400).filter((n) => n !== ends[0] && n !== ends[1]);
    const lakes = this.lakesNear(midx, midz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, x = cx(i), z = cz(j);
        H[k] = this.baseHeight(x, z);
        let bl = 0;
        for (const l of lakes) if (this.lakeRn(l, x, z) < 1.22) bl = 1;
        if (!bl) for (const n of others) if (Math.hypot((x - n.x) / (n.Rp * 1.12 + 30), (z - n.z) / (n.Rz * 1.12 + 30)) < 1) bl = 1;
        blocked[k] = bl;
      }
    }
    const ci = (x) => clamp(Math.round((x - x0) / g), 0, nx - 1), cj = (z) => clamp(Math.round((z - z0) / g), 0, nz - 1);
    const si = ci(sa[0]), sj = cj(sa[1]), ti = ci(sb[0]), tj = cj(sb[1]);
    const start = sj * nx + si, goal = tj * nx + ti;
    blocked[start] = blocked[goal] = 0;
    const gc = new Float32Array(N).fill(1e30), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap = new Heap();
    const sref = P.grade * 0.7;
    gc[start] = 0;
    heap.push(start, Math.hypot(ti - si, tj - sj) * g);
    let found = false;
    while (heap.size) {
      const c = heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === goal) {
        found = true;
        break;
      }
      const ci0 = c % nx, cj0 = (c / nx) | 0;
      for (const [dx, dz] of NB) {
        const ni = ci0 + dx, nj = cj0 + dz;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const n = nj * nx + ni;
        if (closed[n] || blocked[n]) continue;
        const d = g * Math.hypot(dx, dz);
        const sl = Math.abs(H[n] - H[c]) / d;
        const cost = d * (1 + (sl / sref) * (sl / sref) * 0.35 + (sl > 0.3 ? 40 : 0));
        const ng = gc[c] + cost;
        if (ng < gc[n]) {
          gc[n] = ng;
          par[n] = c;
          heap.push(n, ng + Math.hypot(ti - ni, tj - nj) * g);
        }
      }
    }
    const pts = [];
    if (found) {
      for (let c = goal; c !== -1; c = par[c]) pts.push([cx(c % nx), cz((c / nx) | 0)]);
      pts.reverse();
      pts[0] = sa.slice();
      pts[pts.length - 1] = sb.slice();
    } else {
      pts.push(sa.slice(), sb.slice());
    }
    return pts;
  }

  /**
   * Relax the routed polyline toward gentle curves (highways and interstates get the widest
   * curves), in place and with fixed end points. A pass is rejected, and a lighter one tried, when
   * it would push the road into a lake or another settlement.
   */
  straighten(xs, zs, ss, cls, ends, step) {
    const n = xs.length;
    const SIG = { interstate: 95, highway: 62, county: 34, gravel: 18, dirt: 8 }[cls] || 20;
    const mx = (xs[0] + xs[n - 1]) / 2, mz = (zs[0] + zs[n - 1]) / 2;
    const reach = Math.hypot(xs[n - 1] - xs[0], zs[n - 1] - zs[0]) / 2 + 1400;
    const lakes = this.lakesNear(mx, mz);
    const others = this.nodesNear(mx, mz, reach + 600).filter((q) => q !== ends[0] && q !== ends[1]);
    const clear = (X, Z) => {
      for (let k = 0; k < n; k += 2) {
        for (const l of lakes) if (this.lakeRn(l, X[k], Z[k]) < 1.1) return false;
        for (const q of others) if (Math.hypot((X[k] - q.x) / (q.Rp * 1.05 + 14), (Z[k] - q.z) / (q.Rz * 1.05 + 14)) < 1) return false;
      }
      return true;
    };
    for (const f of [1, 0.6, 0.35, 0.18]) {
      const passes = Math.round(((SIG * f) * (SIG * f)) / (0.5 * step * step));
      let A = Float64Array.from(xs), B = Float64Array.from(zs), A2 = new Float64Array(n), B2 = new Float64Array(n);
      for (let it = 0; it < passes; it++) {
        A2[0] = A[0];
        B2[0] = B[0];
        A2[n - 1] = A[n - 1];
        B2[n - 1] = B[n - 1];
        for (let k = 1; k < n - 1; k++) {
          A2[k] = 0.25 * A[k - 1] + 0.5 * A[k] + 0.25 * A[k + 1];
          B2[k] = 0.25 * B[k - 1] + 0.5 * B[k] + 0.25 * B[k + 1];
        }
        [A, A2] = [A2, A];
        [B, B2] = [B2, B];
      }
      if (!clear(A, B)) continue;
      xs.set(A);
      zs.set(B);
      let c = 0;
      ss[0] = 0;
      for (let k = 1; k < n; k++) {
        c += Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]);
        ss[k] = c;
      }
      return;
    }
  }

  buildEdge(i, j, dir) {
    const cls = this.edgeClass(i, j, dir);
    const P = ROAD[cls];
    const a = this.node(i, j), b = dir === 0 ? this.node(i + 1, j) : this.node(i, j + 1);
    const pa = dir === 0 ? a.portE : a.portS, pb = dir === 0 ? b.portW : b.portN;
    const stub = cls === 'interstate' ? 56 : 38;
    const sa = [pa[0] + (dir === 0 ? stub : 0), pa[1] + (dir === 1 ? stub : 0)];
    const sb = [pb[0] - (dir === 0 ? stub : 0), pb[1] - (dir === 1 ? stub : 0)];
    let pts = [pa.slice(), ...this.route(sa, sb, cls, [a, b]), pb.slice()];
    // Chaikin smoothing (endpoints fixed), then uniform resampling
    for (let it = 0; it < 3; it++) {
      const q = [pts[0]];
      for (let k = 0; k < pts.length - 1; k++) {
        const p0 = pts[k], p1 = pts[k + 1];
        q.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]], [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
      }
      q.push(pts[pts.length - 1]);
      pts = q;
    }
    const step = 8;
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    let total = cum[cum.length - 1];
    const n = Math.max(2, Math.round(total / step) + 1);
    const xs = new Float64Array(n), zs = new Float64Array(n), ss = new Float64Array(n);
    let seg = 0;
    for (let k = 0; k < n; k++) {
      const s = (total * k) / (n - 1);
      while (seg < pts.length - 2 && cum[seg + 1] < s) seg++;
      const t = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
      xs[k] = lerp(pts[seg][0], pts[seg + 1][0], t);
      zs[k] = lerp(pts[seg][1], pts[seg + 1][1], t);
      ss[k] = s;
    }
    this.straighten(xs, zs, ss, cls, [a, b], step);
    total = ss[n - 1];
    // elevation profile: smoothed natural height, blended to the node plateaus, grade-limited
    const raw = new Float64Array(n);
    for (let k = 0; k < n; k++) raw[k] = this.baseHeight(xs[k], zs[k]);
    const hs = new Float64Array(n);
    const wnd = Math.max(1, Math.round(P.smooth / step));
    for (let k = 0; k < n; k++) {
      let sum = 0, cnt = 0;
      for (let u = -wnd; u <= wnd; u++) {
        const kk = k + u;
        if (kk < 0 || kk >= n) continue;
        sum += raw[kk];
        cnt++;
      }
      hs[k] = sum / cnt;
    }
    // blend the ends into the plateau heights over a distance that keeps the grade under the limit
    const dA = a.h - hs[0], dB = b.h - hs[n - 1];
    const LA = clamp(Math.abs(dA) / (P.grade * 0.45), 200, 1200), LBd = clamp(Math.abs(dB) / (P.grade * 0.45), 200, 1200);
    for (let k = 0; k < n; k++) {
      hs[k] += dA * (1 - smoothstep(0, 1, ss[k] / LA)) + dB * (1 - smoothstep(0, 1, (total - ss[k]) / LBd));
    }
    const gmax = P.grade * step;
    for (let pass = 0; pass < 4; pass++) {
      for (let k = 1; k < n - 1; k++) hs[k] = clamp(hs[k], hs[k - 1] - gmax, hs[k - 1] + gmax);
      for (let k = n - 2; k >= 1; k--) hs[k] = clamp(hs[k], hs[k + 1] - gmax, hs[k + 1] + gmax);
    }
    const e = { id: `${i},${j},${dir}`, i, j, dir, cls, P, a, b, n, xs, zs, hs, ss, len: total, name: this.roadName(i, j, dir, cls) };
    // highway furnishing: paved shoulders plus rest areas, weigh stations, runaway ramps and interchange lanes
    const plan = planHighway(e);
    const la = lotArrays(plan.lots, ss, n);
    e.sh = SHOULDER[cls] || 0;
    e.lots = plan.lots;
    e.overpasses = plan.overpasses;
    e.runaway = plan.runaway;
    e.lotR = la ? la.R : null;
    e.lotL = la ? la.L : null;
    return e;
  }

  indexEdge(e) {
    const mg = 44;
    for (let k = 0; k < e.n - 1; k++) {
      const seg = { e, k };
      const x0 = Math.min(e.xs[k], e.xs[k + 1]) - mg, x1 = Math.max(e.xs[k], e.xs[k + 1]) + mg;
      const z0 = Math.min(e.zs[k], e.zs[k + 1]) - mg, z1 = Math.max(e.zs[k], e.zs[k + 1]) + mg;
      for (let cx = Math.floor(x0 / HC); cx <= Math.floor(x1 / HC); cx++) {
        for (let cz = Math.floor(z0 / HC); cz <= Math.floor(z1 / HC); cz++) {
          const key = cx * 262144 + cz;
          let l = this.hash.get(key);
          if (!l) this.hash.set(key, (l = []));
          l.push(seg);
        }
      }
    }
  }

  /** Make sure every edge that can touch the rectangle exists; returns how many are still pending. */
  buildEdgesFor(x0, z0, x1, z1, budget = Infinity) {
    const i0 = Math.floor((x0 - 120) / S) - 1, i1 = Math.floor((x1 + 120) / S) + 1, j0 = Math.floor((z0 - 120) / S) - 1, j1 = Math.floor((z1 + 120) / S) + 1;
    let built = 0, pending = 0;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (let dir = 0; dir < 2; dir++) {
          if (!this.edgeExists(i, j, dir)) continue;
          if (this.edges.has(`${i},${j},${dir}`)) continue;
          if (built >= budget) {
            pending++;
            continue;
          }
          this.edge(i, j, dir);
          built++;
        }
      }
    }
    return pending;
  }

  /** Unique road segments whose boxes touch a rectangle. */
  segsIn(x0, z0, x1, z1) {
    const out = new Set();
    for (let cx = Math.floor(x0 / HC); cx <= Math.floor(x1 / HC); cx++) {
      for (let cz = Math.floor(z0 / HC); cz <= Math.floor(z1 / HC); cz++) {
        const l = this.hash.get(cx * 262144 + cz);
        if (!l) continue;
        for (const sg of l) {
          const { e, k } = sg;
          const ax = e.xs[k], az = e.zs[k], bx = e.xs[k + 1], bz = e.zs[k + 1];
          if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(az, bz) < z0 || Math.min(az, bz) > z1) continue;
          out.add(sg);
        }
      }
    }
    return out;
  }

  /** Nearest road centre line within the hash cell; null if none is close. */
  roadAt(x, z, out = this._r) {
    const list = this.hash.get(Math.floor(x / HC) * 262144 + Math.floor(z / HC));
    if (!list) return null;
    let best = 1e18, bs = null, bt = 0;
    for (let q = 0; q < list.length; q++) {
      const { e, k } = list[q];
      const ax = e.xs[k], az = e.zs[k], dx = e.xs[k + 1] - ax, dz = e.zs[k + 1] - az;
      const l2 = dx * dx + dz * dz;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x, pz = az + dz * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) {
        best = d2;
        bs = list[q];
        bt = t;
      }
    }
    if (!bs) return null;
    const { e, k } = bs;
    const dx = e.xs[k + 1] - e.xs[k], dz = e.zs[k + 1] - e.zs[k], l = Math.hypot(dx, dz);
    out.d = Math.sqrt(best);
    out.edge = e;
    out.k = k;
    out.t = bt;
    out.y = e.hs[k] + (e.hs[k + 1] - e.hs[k]) * bt;
    out.tx = dx / l;
    out.tz = dz / l;
    out.side = -(x - (e.xs[k] + dx * bt)) * out.tz + (z - (e.zs[k] + dz * bt)) * out.tx; // + = right of the direction of travel
    return out;
  }

  /** Half-width of the paved surface at a roadAt() hit: lanes, shoulder and any lot on that side. */
  reachOf(r) {
    const e = r.edge;
    let w = e.P.width / 2 + e.sh;
    const arr = r.side > 0 ? e.lotR : e.lotL;
    if (arr) w += arr[r.k] + (arr[r.k + 1] - arr[r.k]) * r.t;
    return w;
  }

  // ── Composite height ───────────────────────────────────────────────────────
  plateau(x, z, h) {
    const a = Math.floor(x / S), b = Math.floor(z / S);
    for (let i = a - 1; i <= a + 1; i++) {
      for (let j = b - 1; j <= b + 1; j++) {
        const n = this.node(i, j);
        const ex = n.Rp * 1.06 + 16, ez = n.Rz * 1.06 + 16;
        const d = Math.hypot(x - n.x, (z - n.z) * (ex / ez));
        const bw = 60 + 0.12 * n.Rp;
        if (d < ex + bw) h = lerp(h, n.h, 1 - smoothstep(ex, ex + bw, d));
      }
    }
    for (const p of this.pads) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + p.bw) h = lerp(h, p.h, 1 - smoothstep(p.r, p.r + p.bw, d));
    }
    return h;
  }

  /** Final ground height: natural land + lakes + town plateaus + camp pads + graded roads. */
  heightAt(x, z) {
    let h = this.plateau(x, z, this.baseHeight(x, z));
    const r = this.roadAt(x, z, this._rq);
    if (r) {
      const hw = this.reachOf(r) + 1.2;
      if (r.d < hw + 36) {
        const bw = clamp(Math.abs(h - r.y) * 2, 7, 36);
        h = lerp(h, r.y, 1 - smoothstep(hw, hw + bw, r.d));
      }
    }
    return h;
  }

  /** Surface under a point: road class / water depth / settlement street. */
  surfaceAt(x, z) {
    const base = this.baseHeight(x, z);
    const h = this.heightAt(x, z);
    const lakes = this.lakesNear(x, z);
    for (const l of lakes) {
      if (this.lakeRn(l, x, z) < 1) {
        const depth = l.level - h;
        if (depth > 0.05) return { kind: 'water', depth, h, base };
      }
    }
    const r = this.roadAt(x, z, this._rq);
    if (r && r.d < this.reachOf(r) + 0.3) {
      const e = r.edge;
      const lot = r.d > e.P.width / 2 + e.sh + 0.3 ? lotAt(e.lots, r.side > 0 ? 1 : -1, e.ss[r.k] + r.t * (e.ss[r.k + 1] - e.ss[r.k])) : null;
      return { kind: 'road', cls: lot && lot.kind === 'runaway' ? 'gravel' : e.cls, lot: lot ? lot.kind : null, depth: 0, h, base, road: r };
    }
    const n = this.settlementAt(x, z, 0);
    if (n) {
      const st = this.streetAt(n, x, z);
      if (st) return { kind: 'street', cls: st, depth: 0, h, base };
    }
    return { kind: 'ground', depth: 0, h, base };
  }

  /** Analytic town street grid: pitch and widths shared with the layout builder. */
  grid(n) {
    const big = n.kind === 'city';
    return { bx: big ? 88 : n.kind === 'town' ? 80 : 70, bz: big ? 72 : n.kind === 'town' ? 64 : 58, wMain: big ? 16 : 14, wMinor: big ? 10 : 9 };
  }

  streetAt(n, x, z) {
    if (n.kind === 'junction' || n.kind === 'farm' || n.kind === 'lodge') return null;
    const dx = x - n.x, dz = z - n.z;
    const rho = Math.hypot(dx / n.Rp, dz / n.Rz);
    if (rho > 1.02) return null;
    const G = this.grid(n);
    if (n.kind === 'truckstop' || n.kind === 'camp') return Math.abs(dz) < Math.max(8, 6) ? 'main' : null;
    const wz = Math.abs(dz) < G.wMain / 2 ? 'main' : null;
    const wx = Math.abs(dx) < G.wMain / 2 - 1 ? 'main' : null;
    if (wz || wx) return 'main';
    if (n.kind === 'village') return null;
    const mz = ((dz % G.bz) + G.bz) % G.bz, mx = ((dx % G.bx) + G.bx) % G.bx;
    const nearZ = Math.min(mz, G.bz - mz) < G.wMinor / 2, nearX = Math.min(mx, G.bx - mx) < G.wMinor / 2;
    if ((nearZ || nearX) && rho < 0.95) return 'minor';
    return null;
  }

  // ── Starting camp ──────────────────────────────────────────────────────────
  /** A roadside pullout beside the highway leaving the origin node to the south. */
  makeHome() {
    const n = this.node(0, 0);
    const e = this.edge(0, 0, 1);
    const k = Math.max(2, Math.min(e.n - 3, Math.round((n.Rz + 260) / 8)));
    const tx = e.xs[k + 1] - e.xs[k - 1], tz = e.zs[k + 1] - e.zs[k - 1], l = Math.hypot(tx, tz);
    const ux = tx / l, uz = tz / l;
    const off = e.P.width / 2 + 12; // right of the direction of travel
    const x = e.xs[k] - uz * off, z = e.zs[k] + ux * off;
    const h = e.hs[k] - 0.1;
    this.pads.push({ x, z, h, r: 15, bw: 22 });
    this.home = { x, z, h, yaw: Math.atan2(-uz, ux), road: { edge: e, k } };
  }
}
