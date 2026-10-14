// The land: streams the generated world around the van (floating origin), draws near terrain with
// roads, a coarse far ring out to ~1.7 km, lakes, and instanced vegetation. The land is identical in
// every scenario and season; the SeasonState uniforms decide how it is dressed.
import * as THREE from 'three';
import { SeasonState, SEASONS, SCENARIO_SEASON, SCENARIO_WET } from './season.js';
import { makeTerrainMaterial, makeRoadMaterial, makeWaterMaterial, RC } from './landMaterials.js';
import * as VEG from './vegetation.js';
import { Towns } from './towns.js';
import { Roadside } from './roadside.js';
import { prng, hash2, smoothstep } from '../world/noise.js';
import { ROAD } from '../world/gen.js';
import { LOT } from '../world/highway.js';
import { Ridges } from './ridges.js';

export const CHUNK = 48;
const SEG = 24;
const NV = SEG + 1;
export const FAR = 384;
const FSEG = 24;
const FNV = FSEG + 1;
const SKIRT = 1.8;
const FAR_DROP = 0.45;

export const QUALITY_LAND = {
  high: { near: 3, far: 4, veg: 1, grass: 1 },
  medium: { near: 3, far: 3, veg: 0.7, grass: 0.8 },
  low: { near: 2, far: 2, veg: 0.45, grass: 0.5 },
  lite: { near: 2, far: 1, veg: 0.25, grass: 0.25 },
};

// Rolling resistance (crr) and grip (mu) of every surface the drive model can meet. mu is the peak
// friction coefficient of a road tyre: dry tarmac gives a loaded van a bit over 1 g, wet tarmac about
// 0.8 (see WET_GRIP), loose ground well under that, snow and ice very little.
export const SURFACES = {
  asphalt: { label: 'Highway', crr: 0.012, mu: 1.05 },
  county: { label: 'County road', crr: 0.014, mu: 1.0 },
  street: { label: 'Street', crr: 0.014, mu: 1.0 },
  gravel: { label: 'Gravel road', crr: 0.03, mu: 0.72 },
  dirt: { label: 'Two-track', crr: 0.04, mu: 0.68 },
  grass: { label: 'Grass', crr: 0.045, mu: 0.7 },
  forest: { label: 'Forest floor', crr: 0.06, mu: 0.62 },
  sand: { label: 'Dry clay', crr: 0.05, mu: 0.62 },
  rock: { label: 'Rock', crr: 0.05, mu: 0.9 },
  mud: { label: 'Mud', crr: 0.065, mu: 0.45 },
  snow: { label: 'Snow', crr: 0.04, mu: 0.3 },
  packed: { label: 'Packed snow', crr: 0.025, mu: 0.36 },
  plowed: { label: 'Snowy highway', crr: 0.016, mu: 0.5 },
  ice: { label: 'Lake ice', crr: 0.012, mu: 0.12 },
  arrester: { label: 'Runaway ramp bed', crr: 0.2, mu: 0.7 },
  shallow: { label: 'Shallow water', crr: 0.12, mu: 0.55 },
  water: { label: 'Deep water', crr: 0.3, mu: 0.1 },
};
/** Share of the dry grip a rain-soaked paved road keeps, and the grip of wet gravel. */
export const WET_GRIP = 0.78;
const WET_GRAVEL_MU = 0.55;

const mkIndex = (seg) => {
  const nv = seg + 1, idx = [];
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const p = j * nv + i;
      idx.push(p, p + nv, p + 1, p + 1, p + nv, p + nv + 1);
    }
  }
  return idx;
};
const NEAR_INDEX = mkIndex(SEG);
const FAR_INDEX = new THREE.Uint16BufferAttribute(mkIndex(FSEG), 1);

/** Write a road quad between samples k0 and k1 of edge e into the arrays (local to origin ox, oz). */
function ribbon(e, k0, k1, w, dy, ox, oz, P, N, R, I) {
  const tan = (k) => {
    const a = Math.max(0, k - 1), b = Math.min(e.n - 1, k + 1);
    const dx = e.xs[b] - e.xs[a], dz = e.zs[b] - e.zs[a], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  const base = P.length / 3;
  const cls = RC[e.cls];
  for (const k of [k0, k1]) {
    const [tx, tz] = tan(k);
    const rx = -tz, rz = tx; // right of travel
    const x = e.xs[k] - ox, z = e.zs[k] - oz, y = e.hs[k] + dy;
    for (const sd of [-1, 1]) {
      P.push(x + rx * sd * (w / 2), y, z + rz * sd * (w / 2));
      N.push(0, 1, 0);
      R.push(sd, e.ss[k], cls, w);
    }
  }
  // quad (L0, R0, L1, R1) → two triangles facing up
  I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
}

/** Lot ribbon (rest area, weigh station, auxiliary lane, runaway bed) beside segment k0 of edge e on one side. */
function lotRibbon(e, k, side, ox, oz, dy, P, N, R, I) {
  const arr = side > 0 ? e.lotR : e.lotL;
  if (!arr || (arr[k] < 0.02 && arr[k + 1] < 0.02)) return;
  const cls = RC[lotCls(e, k, side)];
  const base = P.length / 3;
  const half = e.P.width / 2 + e.sh;
  for (const kk of [k, k + 1]) {
    const a = Math.max(0, kk - 1), b = Math.min(e.n - 1, kk + 1);
    const dx = e.xs[b] - e.xs[a], dz = e.zs[b] - e.zs[a], l = Math.hypot(dx, dz) || 1;
    const rx = (-dz / l) * side, rz = (dx / l) * side;
    const w = arr[kk];
    const x = e.xs[kk] - ox, z = e.zs[kk] - oz, y = e.hs[kk] + dy;
    for (const o of [0, 1]) {
      const off = half + o * w;
      P.push(x + rx * off, y, z + rz * off);
      N.push(0, 1, 0);
      R.push(o, e.ss[kk], cls, Math.max(0.01, w * 2));
    }
  }
  // wind upward on both sides (the material is double sided, so a downward face would be lit from below)
  if (side > 0) I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  else I.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
}
const lotCls = (e, k, side) => {
  const s = (e.ss[k] + e.ss[k + 1]) / 2;
  for (const l of e.lots) if (l.side === side && s > l.s0 && s < l.s1) return LOT[l.kind].cls;
  return 'lot';
};

function ribbonGeometry(P, N, R, I) {
  if (!P.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(R, 4));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

export class Land {
  constructor(stage, world) {
    this.stage = stage;
    this.world = world;
    this.season = new SeasonState();
    this.override = null; // user-selected season (null = follow the scenario)
    this.scnId = 'summer';
    this.wx = null;
    this.terrainMat = makeTerrainMaterial(this.season);
    this.terrainMat.side = THREE.DoubleSide;
    this.roadMat = makeRoadMaterial(this.season);
    this.roadMatFar = makeRoadMaterial(this.season, { far: true });
    this.waterMat = makeWaterMaterial(this.season);
    this.irMat = null;
    this.envRoot = new THREE.Group();
    this.envRoot.name = 'land';
    stage.scene.add(this.envRoot);
    this.q = QUALITY_LAND.high;
    this.near = new Map();
    this.far = new Map();
    this.lakes = new Map();
    this.nearQ = [];
    this.farQ = [];
    this.center = null;
    this.fcenter = null;
    this.colliders = [];
    this.rects = [];
    this.view = { x: 0, z: 0, h: 0, yaw: 0 };
    // vegetation
    this.vm = VEG.makeVegMaterials(this.season);
    this.scatter = new THREE.Group();
    this.envRoot.add(this.scatter);
    const inst = (geo, mat, cap, cast = false) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = cast;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scatter.add(m);
      return m;
    };
    this.conifers = inst(VEG.conifer(), this.vm.pine, 4200, true);
    this.broads = inst(VEG.broadleaf(), this.vm.broad, 1800, true);
    this.grass = inst(VEG.tuft(5), this.vm.grass, 7000);
    this.shrubs = inst(VEG.tuft(9, 16), this.vm.shrub, 3600);
    this.rocks = inst(VEG.rock(4), this.vm.rock, 2600, true);
    this.boulders = inst(VEG.rock(8), this.vm.rock, 260, true);
    this.bales = inst(VEG.bale(), this.vm.bale, 700);
    this.season.listeners.push(() => this.onSeason());
    this.towns = new Towns(this, world, stage);
    this.roadside = new Roadside(this, world, stage, this.towns);
    this.ridges = new Ridges(this, stage);
    this.applySeason();
    this.scatterDirty = false;
    this.pendingEdges = 0;
  }

  // ── Season skin ────────────────────────────────────────────────────────────
  applySeason() {
    const key = this.override || SCENARIO_SEASON[this.scnId] || 'summer';
    const wet = SCENARIO_WET[this.scnId] ?? SEASONS[key].wet;
    this.season.set(key, wet);
    this.season.u.uWind.value = Math.min(1.2, 0.15 + (this.wx?.wind ?? 3) / 9);
  }

  /** A scenario change only re-dresses the land. */
  setScenario(id, wx) {
    const changed = id !== this.scnId;
    this.scnId = id;
    this.wx = wx;
    if (changed || !this.season.key) this.applySeason();
    else this.season.u.uWind.value = Math.min(1.2, 0.15 + (wx?.wind ?? 3) / 9);
  }

  setSeasonOverride(key) {
    this.override = key && SEASONS[key] ? key : null;
    this.applySeason();
  }

  onSeason() {
    const S = this.season;
    const k = S.key;
    const g = this.conifers.geometry;
    g.attributes.color.array.set(g.userData.sets[S.conifer === 'snow' ? 'snow' : 'green']);
    g.attributes.color.needsUpdate = true;
    const col = (o, m) => m.color.setRGB(o[k][0], o[k][1], o[k][2], THREE.SRGBColorSpace);
    col({ summer: [0.85, 0.78, 0.42], spring: [0.55, 0.75, 0.3], autumn: [0.8, 0.6, 0.28], winter: [0.6, 0.55, 0.45] }, this.vm.grass);
    col({ summer: [0.6, 0.62, 0.47], spring: [0.5, 0.65, 0.4], autumn: [0.65, 0.55, 0.38], winter: [0.52, 0.48, 0.42] }, this.vm.shrub);
    col({ summer: [0.55, 0.52, 0.47], spring: [0.5, 0.48, 0.44], autumn: [0.55, 0.5, 0.45], winter: [0.86, 0.88, 0.92] }, this.vm.rock);
    col({ summer: [0.85, 0.7, 0.32], spring: [0.92, 0.92, 0.94], autumn: [0.78, 0.6, 0.3], winter: [0.92, 0.94, 0.97] }, this.vm.bale);
    // lakes freeze
    for (const m of this.lakes.values()) m.userData.frozen = S.u.uIce.value > 0.5;
  }

  setQuality(tier) {
    this.q = QUALITY_LAND[tier] || QUALITY_LAND.high;
    this.center = null;
    this.fcenter = null;
    this.scatterDirty = true;
    this.towns?.setQuality?.(tier);
    this.roadside?.setQuality(tier);
  }

  // ── Queries ────────────────────────────────────────────────────────────────
  heightAt(x, z) {
    return this.world.heightAt(x, z);
  }

  roadAt(x, z) {
    return this.world.roadAt(x, z);
  }

  /** Surface under a point with its rolling resistance and grip for the current season. */
  surfaceAt(x, z) {
    const w = this.world.surfaceAt(x, z);
    const S = this.season, u = S.u;
    const snowy = smoothstep(u.uSnowLine.value - 12, u.uSnowLine.value + 24, w.h + 3) > 0.5;
    const wet = u.uWet.value > 0.55;
    const out = (key, extra = {}) => ({ key, ...SURFACES[key], depth: w.depth, h: w.h, kind: w.kind, cls: w.cls, ...extra });
    if (w.kind === 'water') {
      if (u.uIce.value > 0.5) return out('ice');
      return out(w.depth < 0.55 ? 'shallow' : 'water', { depth: w.depth });
    }
    if (w.kind === 'road') {
      if (w.lot === 'runaway') return out('arrester');
      if (w.cls === 'interstate' || w.cls === 'highway') return out(snowy ? 'plowed' : 'asphalt', wet && !snowy ? { mu: SURFACES.asphalt.mu * WET_GRIP } : {});
      if (w.cls === 'county') return out(snowy ? 'packed' : 'county', wet && !snowy ? { mu: SURFACES.county.mu * WET_GRIP } : {});
      if (w.cls === 'gravel') return out(snowy ? 'packed' : wet ? 'mud' : 'gravel', wet && !snowy ? { mu: WET_GRAVEL_MU } : {});
      return out(snowy ? 'snow' : wet ? 'mud' : 'dirt');
    }
    if (w.kind === 'street') return out(snowy ? 'packed' : 'street', wet && !snowy ? { mu: SURFACES.street.mu * WET_GRIP } : {});
    const b = this.world.biome(x, z, w.h, this._bio || (this._bio = {}));
    if (snowy) return out('snow');
    if (wet) return out('mud');
    if (b.alpine > 0.55) return out('rock');
    if (b.bad > 0.5) return out('sand');
    if (b.forest > 0.6) return out('forest');
    return out('grass');
  }

  // ── Streaming ──────────────────────────────────────────────────────────────
  /** Stream chunks around world (x, z). `sync` builds the ring around the van immediately. */
  update(x, z, sync = false) {
    this._px = x;
    this._pz = z;
    const ncx = Math.floor(x / CHUNK), ncz = Math.floor(z / CHUNK), fcx = Math.floor(x / FAR), fcz = Math.floor(z / FAR);
    const R = this.q.near, FR = this.q.far;
    if (!this.center || this.center[0] !== ncx || this.center[1] !== ncz) {
      this.center = [ncx, ncz];
      const need = new Set();
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) need.add(`${ncx + i},${ncz + j}`);
      for (const [k, c] of this.near) {
        const [a, b] = k.split(',').map(Number);
        if (Math.max(Math.abs(a - ncx), Math.abs(b - ncz)) > R + 1) {
          this.disposeNear(c);
          this.near.delete(k);
        }
      }
      this.nearQ = [...need].filter((k) => !this.near.has(k)).map((k) => k.split(',').map(Number)).sort((a, b) => Math.hypot(a[0] - ncx, a[1] - ncz) - Math.hypot(b[0] - ncx, b[1] - ncz));
      this.scatterDirty = true;
    }
    if (!this.fcenter || this.fcenter[0] !== fcx || this.fcenter[1] !== fcz) {
      this.fcenter = [fcx, fcz];
      const need = new Set();
      for (let j = -FR; j <= FR; j++) for (let i = -FR; i <= FR; i++) need.add(`${fcx + i},${fcz + j}`);
      for (const [k, c] of this.far) {
        const [a, b] = k.split(',').map(Number);
        if (Math.max(Math.abs(a - fcx), Math.abs(b - fcz)) > FR + 1) {
          this.disposeFar(c);
          this.far.delete(k);
        }
      }
      this.farQ = [...need].filter((k) => !this.far.has(k)).map((k) => k.split(',').map(Number)).sort((a, b) => Math.hypot(a[0] - fcx, a[1] - fcz) - Math.hypot(b[0] - fcx, b[1] - fcz));
      this.updateLakes(x, z);
    }
    const t0 = performance.now();
    const budget = this.budgetOverride ?? (sync ? 60 : 7);
    const mustBuild = () => sync && this.nearQ.some(([a, b]) => Math.max(Math.abs(a - ncx), Math.abs(b - ncz)) <= 1);
    for (let guard = 0; guard < 600; guard++) {
      if (performance.now() - t0 > budget && !mustBuild()) break;
      const nearTurn = this.nearQ.length > 0;
      const q = nearTurn ? this.nearQ : this.farQ;
      if (!q.length) break;
      const [a, b] = q[0];
      const size = nearTurn ? CHUNK : FAR;
      const pending = this.world.buildEdgesFor(a * size, b * size, (a + 1) * size, (b + 1) * size, 1);
      if (pending > 0) continue;
      q.shift();
      if (nearTurn) {
        this.buildNear(a, b);
        this.scatterDirty = true;
      } else this.buildFar(a, b);
    }
    if (this.scatterDirty && this.nearQ.length < 3) {
      this.scatterDirty = false;
      this.rebuildScatter(ncx, ncz);
    }
    this.towns?.update(x, z, sync);
    this.roadside?.update(x, z, sync);
    this.ridges?.update(x, z);
  }

  /** Build everything now (used for screenshots and tests; the app streams progressively). */
  preload(x, z) {
    this.update(x, z, true);
    this.budgetOverride = Infinity;
    if (this.towns) this.towns.budgetOverride = Infinity;
    if (this.roadside) this.roadside.budgetOverride = Infinity;
    this.update(x, z);
    this.budgetOverride = null;
    if (this.towns) this.towns.budgetOverride = null;
    if (this.roadside) this.roadside.budgetOverride = null;
  }

  // ── Terrain chunks ─────────────────────────────────────────────────────────
  gridHeights(x0, z0, step, nv) {
    const W = this.world, M = nv + 2;
    const H = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) H[j * M + i] = W.heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
    return { H, M };
  }

  terrainArrays(x0, z0, step, nv, drop, skirt) {
    const W = this.world;
    const { H, M } = this.gridHeights(x0, z0, step, nv);
    const total = nv * nv + (skirt ? 4 * nv : 0);
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2), aw = new Float32Array(total * 4);
    const bio = {};
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nv; i++) {
        const k = j * nv + i;
        const c = (j + 1) * M + (i + 1);
        const h = H[c];
        const nx = (H[c - 1] - H[c + 1]) / (2 * step), nz = (H[c - M] - H[c + M]) / (2 * step);
        const l = Math.hypot(nx, 1, nz);
        pos[k * 3] = i * step;
        pos[k * 3 + 1] = h - drop;
        pos[k * 3 + 2] = j * step;
        nor[k * 3] = nx / l;
        nor[k * 3 + 1] = 1 / l;
        nor[k * 3 + 2] = nz / l;
        const wx = x0 + i * step, wz = z0 + j * step;
        uv[k * 2] = wx;
        uv[k * 2 + 1] = wz;
        W.biome(wx, wz, h, bio);
        aw[k * 4] = bio.forest;
        aw[k * 4 + 1] = bio.bad;
        aw[k * 4 + 2] = bio.rock;
        aw[k * 4 + 3] = bio.field;
      }
    }
    return { pos, nor, uv, aw, nv, total };
  }

  buildNear(cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK, step = CHUNK / SEG;
    const A = this.terrainArrays(x0, z0, step, NV, 0, true);
    const idx = NEAR_INDEX.slice();
    // skirts hide the seam to the far ring and any crack between chunks
    let s = NV * NV;
    const edgeIdx = [(i) => i, (i) => SEG * NV + i, (i) => i * NV, (i) => i * NV + SEG];
    for (const f of edgeIdx) {
      const base = s;
      for (let i = 0; i < NV; i++) {
        const t = f(i);
        A.pos[s * 3] = A.pos[t * 3];
        A.pos[s * 3 + 1] = A.pos[t * 3 + 1] - SKIRT;
        A.pos[s * 3 + 2] = A.pos[t * 3 + 2];
        A.nor[s * 3 + 1] = 1;
        A.uv[s * 2] = A.uv[t * 2];
        A.uv[s * 2 + 1] = A.uv[t * 2 + 1];
        for (let q = 0; q < 4; q++) A.aw[s * 4 + q] = A.aw[t * 4 + q];
        s++;
      }
      for (let i = 0; i < SEG; i++) {
        const t0 = f(i), t1 = f(i + 1);
        idx.push(t0, t1, base + i, t1, base + i + 1, base + i);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(A.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(A.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(A.uv, 2));
    g.setAttribute('aW', new THREE.BufferAttribute(A.aw, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.irMat || this.terrainMat);
    mesh.position.set(x0, 0, z0);
    mesh.receiveShadow = true;
    this.envRoot.add(mesh);
    // roads
    const P = [], N = [], R = [], I = [];
    for (const { e, k } of this.world.segsIn(x0 - 4, z0 - 4, x0 + CHUNK + 4, z0 + CHUNK + 4)) {
      ribbon(e, k, k + 1, e.P.width + 2 * e.sh, 0.07, x0, z0, P, N, R, I);
      if (e.lotR || e.lotL) {
        lotRibbon(e, k, 1, x0, z0, 0.07, P, N, R, I);
        lotRibbon(e, k, -1, x0, z0, 0.07, P, N, R, I);
      }
    }
    const rg = ribbonGeometry(P, N, R, I);
    let road = null;
    if (rg) {
      road = new THREE.Mesh(rg, this.irMat || this.roadMat);
      road.position.set(x0, 0, z0);
      road.receiveShadow = true;
      road.renderOrder = 1;
      this.envRoot.add(road);
    }
    this.near.set(`${cx},${cz}`, { cx, cz, mesh, road, items: this.scatterFor(cx, cz) });
  }

  buildFar(cx, cz) {
    const x0 = cx * FAR, z0 = cz * FAR, step = FAR / FSEG;
    const A = this.terrainArrays(x0, z0, step, FNV, FAR_DROP, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(A.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(A.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(A.uv, 2));
    g.setAttribute('aW', new THREE.BufferAttribute(A.aw, 4));
    g.setIndex(FAR_INDEX);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.irMat || this.terrainMat);
    mesh.position.set(x0, 0, z0);
    this.envRoot.add(mesh);
    const P = [], N = [], R = [], I = [];
    for (const { e, k } of this.world.segsIn(x0 - 4, z0 - 4, x0 + FAR + 4, z0 + FAR + 4)) {
      if (k % 3 !== 0) continue;
      ribbon(e, k, Math.min(e.n - 1, k + 3), Math.max(e.P.width + 2 * e.sh, 9), -FAR_DROP + 0.06, x0, z0, P, N, R, I);
    }
    const rg = ribbonGeometry(P, N, R, I);
    let road = null;
    if (rg) {
      road = new THREE.Mesh(rg, this.irMat || this.roadMatFar);
      road.position.set(x0, 0, z0);
      road.renderOrder = 1;
      this.envRoot.add(road);
    }
    this.far.set(`${cx},${cz}`, { cx, cz, mesh, road });
  }

  disposeNear(c) {
    this.envRoot.remove(c.mesh);
    c.mesh.geometry.dispose();
    if (c.road) {
      this.envRoot.remove(c.road);
      c.road.geometry.dispose();
    }
  }

  disposeFar(c) {
    this.disposeNear(c);
  }

  // ── Lakes ──────────────────────────────────────────────────────────────────
  updateLakes(x, z) {
    const W = this.world;
    const seen = new Set();
    const a = Math.floor(x / 3600), b = Math.floor(z / 3600);
    for (let i = a - 1; i <= a + 1; i++) {
      for (let j = b - 1; j <= b + 1; j++) {
        const l = W.lakeCell(i, j);
        if (!l) continue;
        seen.add(l.key);
        if (this.lakes.has(l.key)) continue;
        const r = l.R * Math.max(l.asp, 1) * 1.28 + 30;
        const g = new THREE.CircleGeometry(r, 56).rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, this.irMat || this.waterMat);
        m.position.set(l.cx, l.level, l.cz);
        m.renderOrder = 2;
        m.userData.lake = l;
        this.envRoot.add(m);
        this.lakes.set(l.key, m);
      }
    }
    for (const [k, m] of this.lakes) {
      if (!seen.has(k)) {
        this.envRoot.remove(m);
        m.geometry.dispose();
        this.lakes.delete(k);
      }
    }
  }

  // ── Vegetation and rocks ───────────────────────────────────────────────────
  /** Deterministic scatter for one near chunk (world coordinates). */
  scatterFor(cx, cz) {
    const W = this.world;
    const rnd = prng(Math.floor(hash2(cx, cz, 777) * 4294967296));
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const out = { conifers: [], broads: [], grass: [], shrubs: [], rocks: [], boulders: [], bales: [] };
    const bio = {};
    const free = (x, z, roadGap) => {
      const r = W.roadAt(x, z);
      if (r && r.d < W.reachOf(r) + roadGap) return null;
      if (W.settlementAt(x, z, 24)) return null;
      for (const p of W.pads) if (Math.hypot(x - p.x, z - p.z) < p.r + 16) return null; // keep the camp clear
      const h = W.heightAt(x, z);
      const lk = W.lakesNear(x, z);
      for (const l of lk) if (W.lakeRn(l, x, z) < 1.1) return null;
      return h;
    };
    const place = (list, tries, roadGap, accept) => {
      for (let i = 0; i < tries; i++) {
        const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
        const h = free(x, z, roadGap);
        if (h === null) continue;
        W.biome(x, z, h, bio);
        const r = accept(bio, rnd);
        if (!r) continue;
        list.push([x, h, z, 0.7 + rnd() * 1.1, rnd() * Math.PI * 2, rnd(), r]);
      }
    };
    place(out.conifers, 150, 6, (b, r) => b.forest > 0.38 && b.alpine < 0.7 && r() < Math.pow(b.forest, 1.6) * (b.mtn > 0.15 || b.forest > 0.62 ? 1 : 0.25));
    place(out.broads, 90, 6, (b, r) => b.alpine < 0.2 && ((b.moist > 0.56 && b.mtn < 0.5 && r() < 0.1 + (b.forest > 0.4 ? 0.25 : 0)) || (b.forest > 0.3 && b.forest <= 0.62 && b.mtn < 0.15 && r() < 0.35)));
    place(out.shrubs, 60, 3, (b, r) => (1 - b.forest) * (1 - b.field) * (1 - b.alpine) * (0.25 + b.bad * 0.5) > r() * 0.6);
    out.grass = null; // generated lazily for the chunks right around the van
    place(out.rocks, 40, 3, (b, r) => b.rock + 0.08 > r());
    place(out.boulders, 4, 5, (b, r) => 0.1 + b.rock * 0.7 > r());
    place(out.bales, 8, 6, (b, r) => b.field > 0.5 && r() < 0.35);
    return out;
  }

  /** Grass tufts for one chunk (only needed within ~1 chunk of the van). */
  grassFor(cx, cz) {
    const W = this.world;
    const rnd = prng(Math.floor(hash2(cx, cz, 778) * 4294967296));
    const x0 = cx * CHUNK, z0 = cz * CHUNK, bio = {}, out = [];
    for (let i = 0; i < 560; i++) {
      const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
      const r = W.roadAt(x, z);
      if (r && r.d < W.reachOf(r) + 1.4) continue;
      if (W.settlementAt(x, z, 24)) continue;
      if (W.pads.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 3)) continue;
      const h = W.heightAt(x, z);
      if (W.lakesNear(x, z).some((l) => W.lakeRn(l, x, z) < 1.1)) continue;
      W.biome(x, z, h, bio);
      if ((1 - bio.forest * 0.7) * (1 - bio.field * 0.85) * (1 - bio.alpine) * (1 - bio.bad * 0.7) > rnd() * 1.1) out.push([x, h, z, 0.9 + rnd() * 1.8, rnd() * Math.PI * 2, rnd()]);
    }
    return out;
  }

  rebuildScatter(cx, cz) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), eu = new THREE.Euler();
    const tint = new THREE.Color();
    const Q = this.q;
    const fill = (mesh, kind, radius, { sink = 0, flat = 1, vary = 0, mul = 1, scale = 1, lie = false } = {}) => {
      let n = 0;
      const cap = mesh.instanceMatrix.count;
      for (const c of this.near.values()) {
        if (Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz)) > radius) continue;
        if (kind === 'grass' && !c.items.grass) c.items.grass = this.grassFor(c.cx, c.cz);
        const list = c.items[kind];
        const keep = Math.floor(list.length * mul);
        for (let i = 0; i < keep; i++) {
          const [x, h, z, sc0, rot, tilt] = list[i];
          if (n >= cap) break;
          const sc = sc0 * scale;
          p.set(x, h - sink * sc, z);
          eu.set(lie ? 0 : (tilt - 0.5) * 0.12, rot, lie ? 0 : (tilt - 0.5) * 0.1);
          q.setFromEuler(eu);
          s.set(sc, sc * flat * (0.85 + tilt * 0.4), sc);
          m4.compose(p, q, s);
          mesh.setMatrixAt(n, m4);
          if (vary) mesh.setColorAt(n, tint.setScalar(1 - vary + tilt * vary * 1.6));
          n++;
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    const nr = this.q.near;
    fill(this.conifers, 'conifers', nr, { mul: Q.veg, scale: 0.78 });
    fill(this.broads, 'broads', nr, { mul: Q.veg, scale: 0.62 });
    fill(this.grass, 'grass', 1, { vary: 0.3, mul: Q.grass });
    fill(this.shrubs, 'shrubs', 2, { vary: 0.35, mul: Q.veg });
    fill(this.rocks, 'rocks', 2, { sink: 0.25, vary: 0.3, mul: Q.veg });
    fill(this.boulders, 'boulders', nr, { sink: 0.3, vary: 0.25, mul: 1 });
    fill(this.bales, 'bales', 2, { mul: 1, lie: true, scale: 0.55 });
    this.colliders = [];
    for (const c of this.near.values()) {
      if (Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz)) > 1) continue;
      for (const [x, , z, sc] of c.items.conifers) this.colliders.push({ x, z, r: 0.22 * sc, kind: 'tree' });
      for (const [x, , z, sc] of c.items.broads) this.colliders.push({ x, z, r: 0.2 * sc, kind: 'tree' });
      for (const [x, , z, sc] of c.items.boulders) this.colliders.push({ x, z, r: 0.85 * sc, kind: 'boulder' });
    }
  }

  // ── Floating origin ────────────────────────────────────────────────────────
  /** Put world point (x, z) at height h at the scene origin, turning the world by −yaw. */
  setView(x, z, h, yaw) {
    this.view = { x, z, h, yaw };
    const r = this.envRoot;
    r.rotation.set(0, -yaw, 0);
    const c = Math.cos(-yaw), s = Math.sin(-yaw);
    r.position.set(-x * c - z * s, -h, x * s - z * c);
    r.updateMatrixWorld(true);
  }

  /** Swap every ground/road/water surface to one material (infrared) or back (null). */
  setMaterial(mat) {
    this.irMat = mat;
    for (const c of this.near.values()) {
      c.mesh.material = mat || this.terrainMat;
      if (c.road) c.road.material = mat || this.roadMat;
    }
    for (const c of this.far.values()) {
      c.mesh.material = mat || this.terrainMat;
      if (c.road) c.road.material = mat || this.roadMatFar;
    }
    for (const m of this.lakes.values()) m.material = mat || this.waterMat;
    this.scatter.visible = !mat;
    if (this.towns) this.towns.setMaterial?.(mat);
    this.roadside?.setMaterial(mat);
    this.ridges?.setVisible(!mat);
  }

  tick(dt) {
    this.season.u.uTime.value += dt;
    // instanced shadows only on the High tier
    const hi = this.stage.quality === 'high';
    this.conifers.castShadow = this.broads.castShadow = this.rocks.castShadow = this.boulders.castShadow = hi;
    this.towns?.tick?.(dt);
    this.ridges?.tick();
  }
}
