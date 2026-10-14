// AI traffic on the road network: detailed instanced vehicles (cars, pickups, vans, motorhomes,
// coaches and articulated semis with every trailer type) that follow the road polyline in their
// lane, keep a safe following distance behind each other and the player, slow for curves, towns and
// road ends, pass slower traffic (signalling first, using the passing lane on interstates and the
// oncoming lane on two-lane roads when the sight line is clear), honk at a stopped or tailgating
// player and crash into the player's whole footprint with momentum transfer (and rig damage for
// the semi). Decision logic lives in src/sim/traffic.js (pure, unit tested); this file is the
// scene glue: spawning, perception, motion, collisions, instancing, LOD and culling.
//
// Vehicles are instanced per (model, level of detail): `hi` is the full library model near the
// camera, `lo` a box proxy beyond tier.hi metres. Brake lights and turn signals are per-instance
// (attribute aLampI = brake, left, right) on top of the vehicle material's night headlights.
import * as THREE from 'three';
import { vehicleMaterial } from './vehicles.js';
import { TrafficModels, TRAILER_VARIANTS, trailerKey } from './trafficModels.js';
import { prng } from '../world/noise.js';
import * as S from '../sim/traffic.js';
import * as J from '../sim/junction.js';
import { chainContact, damageAmount, inertia, makeBody, resolveImpact, shouldDetach, stepFree } from '../sim/crash.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const CAR_COLS = [[0.92, 0.92, 0.9], [0.7, 0.72, 0.74], [0.12, 0.12, 0.13], [0.62, 0.1, 0.09], [0.12, 0.22, 0.45], [0.16, 0.34, 0.22], [0.55, 0.45, 0.3], [0.35, 0.37, 0.4], [0.85, 0.7, 0.15], [0.8, 0.45, 0.1], [0.5, 0.52, 0.56], [0.05, 0.05, 0.06], [0.4, 0.08, 0.14]].map(lin);
const RV_COLS = [[0.92, 0.9, 0.84], [0.85, 0.86, 0.88], [0.78, 0.74, 0.62], [0.9, 0.9, 0.9]].map(lin);
const BUS_COLS = [[0.9, 0.9, 0.9], [0.75, 0.77, 0.8], [0.1, 0.2, 0.45], [0.95, 0.75, 0.1], [0.2, 0.22, 0.25]].map(lin);
const CAB_COLS = [[0.75, 0.08, 0.07], [0.1, 0.18, 0.4], [0.07, 0.07, 0.08], [0.9, 0.9, 0.88], [0.1, 0.3, 0.2], [0.5, 0.06, 0.16], [0.62, 0.64, 0.68], [0.85, 0.42, 0.08], [0.15, 0.35, 0.55]].map(lin);
const TRAILER_COLS = [[0.92, 0.92, 0.9], [0.92, 0.92, 0.9], [0.92, 0.92, 0.9], [0.72, 0.74, 0.77], [0.55, 0.57, 0.6], [0.14, 0.24, 0.45], [0.85, 0.85, 0.8]].map(lin);
const BOX_COLS = [[0.7, 0.1, 0.08], [0.1, 0.25, 0.5], [0.12, 0.38, 0.22], [0.8, 0.42, 0.08], [0.5, 0.52, 0.56], [0.35, 0.08, 0.1], [0.9, 0.9, 0.88]].map(lin);

/** Quality tiers: vehicle cap, spawn radius, level-of-detail distance and shadow casting. */
export const TIERS = {
  high: { max: 30, R: 580, hi: 100, shadow: true },
  medium: { max: 22, R: 500, hi: 70, shadow: true },
  low: { max: 12, R: 420, hi: 38, shadow: false },
  lite: { max: 6, R: 340, hi: 0, shadow: false },
};
const HI_CAP = 14, LO_CAP = 44;
const ZONE = 34; // m either side of a node centre that movements through a junction share
const BIG = 1e9;
const PLAYER = { player: true };

// ── Road sampling (no allocation) ─────────────────────────────────────────────
const _s = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
function sampleEdge(e, s, out = _s) {
  const n = e.n, step = e.len / (n - 1);
  const s0 = s < 0 ? 0 : s > e.len ? e.len : s; // beyond either end the road is extended straight on
  const kf = Math.max(0, Math.min(n - 1.001, s0 / step));
  const k = Math.floor(kf), t = kf - k;
  out.x = e.xs[k] + (e.xs[k + 1] - e.xs[k]) * t;
  out.z = e.zs[k] + (e.zs[k + 1] - e.zs[k]) * t;
  const dx = e.xs[Math.min(n - 1, k + 2)] - e.xs[Math.max(0, k - 1)], dz = e.zs[Math.min(n - 1, k + 2)] - e.zs[Math.max(0, k - 1)], l = Math.hypot(dx, dz) || 1;
  out.tx = dx / l;
  out.tz = dz / l;
  out.h = e.hs ? e.hs[k] + (e.hs[k + 1] - e.hs[k]) * t : 0;
  if (s0 !== s) {
    out.x += out.tx * (s - s0);
    out.z += out.tz * (s - s0);
  }
  return out;
}
const curvOf = (e) => e._tcurv || (e._tcurv = S.polylineCurvature(e.xs, e.zs, e.n, e.len / (e.n - 1)));
const stepOf = (e) => e.len / (e.n - 1);

const makeScan = () => ({
  lead: { gap: BIG, v: 0, ref: null, len: 0 }, // nearest thing ahead in the band (any direction) — drives car following
  same: { gap: BIG, v: 0, ref: null, len: 0 }, // nearest same-direction vehicle ahead
  onc: { gap: BIG, v: 0 }, // nearest oncoming thing (v = speed towards us)
  fol: { gap: BIG, v: 0, ref: null }, // nearest same-direction follower behind
  pb: { gap: BIG, v: 0 }, // the player behind us in our lane
  emergBehind: null, // nearest emergency vehicle approaching from behind
});
function resetScan(o) {
  o.lead.gap = o.same.gap = o.onc.gap = o.fol.gap = o.pb.gap = BIG;
  o.lead.ref = o.same.ref = o.fol.ref = null;
  o.lead.v = o.same.v = o.onc.v = o.fol.v = o.pb.v = 0;
  o.emergBehind = null;
  return o;
}

/** Instance matrix helpers. */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _sc = new THREE.Vector3(1, 1, 1), _eu = new THREE.Euler(), _col = new THREE.Color();

/** The shared vehicle material extended with per-instance brake light and turn-signal control. */
function trafficMaterial(season, atlas) {
  const mat = vehicleMaterial(season, atlas);
  const base = mat.onBeforeCompile;
  const LV = 'float lv = vGlow > 2.5 ? uLamp.w : (vGlow > 1.5 ? uLamp.y + uLamp.z : uLamp.x);';
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aLampI;\nvarying vec3 vLampI;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvLampI = aLampI;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampI;')
      .replace(LV, 'float lv = vGlow > 2.5 ? (vOP.z > 0.0 ? vLampI.z : vLampI.y) : (vGlow > 1.5 ? uLamp.y + vLampI.x : uLamp.x);');
  };
  mat.customProgramCacheKey = () => 'trafficMat1';
  return mat;
}

export class Traffic {
  constructor(land, world, stage) {
    this.land = land;
    this.world = world;
    this.stage = stage;
    this.vehicles = [];
    this.tier = TIERS.high;
    this.max = this.tier.max;
    this.t = 0;
    this.clock = 0;
    this.id = 0;
    this.rnd = prng(4242);
    this.visible = true;
    this.populated = false;
    this.atlas = land.towns?.atlas || null;
    this.models = new TrafficModels(this.atlas || { slot: () => [0, 0, 1, 1] });
    this.mat = trafficMaterial(land.season, this.atlas);
    this.meshes = new Map();
    this.frustum = new THREE.Frustum();
    this.refY = 0;
    this.fm = new THREE.Matrix4();
    this.sphere = new THREE.Sphere();
    this.pc = []; // the player's footprint circles this frame
    this.tgt = makeScan();
    this.tgt2 = makeScan();
    this.fp = [];
    this.fpA = [];
    this.fpB = [];
    this.stats = { vehicles: 0, drawn: 0, hi: 0, lo: 0, honks: 0, passes: 0, crashes: 0, wrecks: 0, pileups: 0, transits: 0, turns: 0, arrivals: 0, waits: 0, ghosts: 0 };
    this.enabled = true;
    this.conns = new Map(); // junction connectors by node and sides
    this.conflicts = new Map();
    this.resv = new Set(); // vehicles holding a place in a junction
    this.pruneT = 20;
  }

  setQuality(tier) {
    this.tier = TIERS[tier] || TIERS.medium;
    this.max = this.tier.max;
    for (const m of this.meshes.values()) m.mesh.castShadow = m.lod === 'hi' && this.tier.shadow;
  }

  clear() {
    this.vehicles.length = 0;
    this.resv.clear();
    this.populated = false;
    for (const m of this.meshes.values()) {
      m.mesh.count = 0;
      m.mesh.visible = false;
    }
  }

  setVisible(v) {
    this.visible = v;
    for (const m of this.meshes.values()) m.mesh.visible = v && m.mesh.count > 0;
  }

  // ── Meshes ─────────────────────────────────────────────────────────────────
  meshFor(key, lod) {
    const id = `${key}|${lod}`;
    let m = this.meshes.get(id);
    if (m) return m;
    const cap = lod === 'hi' ? HI_CAP : LO_CAP;
    const geo = this.models.get(key, lod);
    const mesh = new THREE.InstancedMesh(geo, this.mat, cap);
    const lamp = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    lamp.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aLampI', lamp);
    mesh.setColorAt(0, _col.setRGB(1, 1, 1));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = lod === 'hi' && this.tier.shadow;
    mesh.receiveShadow = true;
    mesh.name = `traffic ${id}`;
    this.land.envRoot.add(mesh);
    m = { mesh, lamp, lod, cap, n: 0 };
    this.meshes.set(id, m);
    return m;
  }

  // ── Spawning ───────────────────────────────────────────────────────────────
  /** Candidate road stretches around the player: [{ e, s, w }]. */
  stretches(x, z, R, rmin) {
    const out = [];
    for (const e of this.world.gen.edges.values()) {
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
      if (x < e.minx - R || x > e.maxx + R || z < e.minz - R || z > e.maxz + R) continue;
      const w = S.CLASS_DENSITY[e.cls] ?? 0.2;
      for (let s = 80; s < e.len - 80; s += 50) {
        sampleEdge(e, s);
        const d = Math.hypot(_s.x - x, _s.z - z);
        if (d > rmin && d < R) out.push({ e, s, w });
      }
    }
    return out;
  }

  /** Is a sphere around a ground point inside the camera frustum (land-group frame)? */
  inView(x, z, r, y = this.refY) {
    this.sphere.center.set(x, y, z);
    this.sphere.radius = r;
    return this.frustum.intersectsSphere(this.sphere);
  }

  trySpawn(D, initial = false) {
    const tier = this.tier;
    const cand = this.stretches(D.x, D.z, tier.R, initial ? 130 : 230);
    if (!cand.length) return false;
    const tot = cand.reduce((a, c) => a + c.w, 0);
    let r = this.rnd() * tot, pick = cand[0];
    for (const c of cand) {
      r -= c.w;
      if (r <= 0) {
        pick = c;
        break;
      }
    }
    const e = pick.e, cls = e.cls, night = this.land.season.u.uNight.value;
    if (this.rnd() < night * 0.35) return false;
    const dir = this.rnd() < 0.5 ? 1 : -1;
    const kind = S.pickWeighted(S.SPAWN_MIX[cls] || S.SPAWN_MIX.county, this.rnd());
    const K = S.KINDS[kind];
    if (kind === 'semi' && this.vehicles.filter((v) => v.kind === 'semi').length >= Math.ceil(this.max * 0.4)) return false;
    sampleEdge(e, pick.s);
    const px = _s.x, pz = _s.z;
    if (this.world.gen.settlementAt(px, pz, 120)) return false;
    if (!initial && this.inView(px, pz, 30, _s.h)) return false;
    const lanes = S.laneLats(cls, e.P.width), multi = S.isMultiLane(cls);
    const lane = multi ? (K.cls === 'heavy' || this.rnd() < 0.62 ? 1 : 0) : 0;
    const lat = lanes[lane];
    for (const o of this.vehicles) if (o.e === e && Math.abs(o.s - pick.s) < 100 && Math.abs(o.lat * o.dir - lat * dir) < 3) return false;
    const temper = 0.88 + this.rnd() * 0.3;
    const base = S.classSpeed(cls) * K.vmul * (0.92 + 0.2 * (temper - 0.88) / 0.3) * (multi && lane === 0 ? 1.04 : 1);
    this.vehicles.push(this.makeVehicle(e, pick.s, dir, kind, lane, lat, base, temper));
    return true;
  }

  makeVehicle(e, s, dir, kind, lane, lat, vmax, temper) {
    const K = S.KINDS[kind], rnd = this.rnd;
    const pickc = (a) => a[Math.floor(rnd() * a.length)];
    const v = {
      id: this.id++, e, s, dir, kind, K, lane, lat, vmax, temper, v: vmax * 0.96, a: 0,
      p: S.driverParams(kind, temper), react: rnd() < 0.05 ? 1.0 : 0.15 + rnd() * 0.3,
      latFrom: lat, latTo: lat, chT: 0, chDur: 3, mode: 'cruise', signal: 0, sigT: 0, passing: false, opp: false, passLead: null, abort: false, push: false,
      followTime: 0, idle: 3 + rnd() * 3, decT: rnd() * 0.4, limT: 0, curveLim: Infinity, townLim: Infinity, townD: Infinity, latRate: 0, brakeOn: false,
      honk: S.makeHonk(), wreck: 0, ph: rnd() * 6.28, pendingLat: lat, pendingSide: 0, ownScan: null, latHome: lat,
      waitT: 0, free: null, obs: null, wreckT: 0, dmg: 0, dead: false, smokeT: 0, next: undefined, arrive: false, res: null,
      x: 0, z: 0, y: 0, yaw: 0, pitch: 0, pitchT: 0, hi: false, thetaT: 0, tx: 0, tz: 0, fx: 1, fz: 0, rx: 0, rz: 1,
      col: pickc(kind === 'rv' ? RV_COLS : kind === 'bus' ? BUS_COLS : kind === 'semi' ? CAB_COLS : CAR_COLS), tcol: null, tkey: null, model: kind === 'semi' ? 'tractor' : kind,
    };
    if (kind === 'semi') {
      const type = S.pickWeighted(S.TRAILER_MIX, rnd());
      const variants = TRAILER_VARIANTS[type] || [{}];
      v.tkey = trailerKey(type, Math.floor(rnd() * variants.length));
      v.ttype = type;
      v.tcol = pickc(type === 'container' ? BOX_COLS : type === 'tanker' ? [TRAILER_COLS[3], TRAILER_COLS[4], TRAILER_COLS[0]] : TRAILER_COLS);
    }
    this.place(v, 0.016);
    v.thetaT = v.yaw;
    v.kx = v.x + Math.cos(v.yaw) * S.SEMI_HITCH;
    v.kz = v.z - Math.sin(v.yaw) * S.SEMI_HITCH;
    return v;
  }

  // ── Pose from (s, lat) ─────────────────────────────────────────────────────
  place(v, dt) {
    const e = v.e, q = sampleEdge(e, v.s);
    const dir = v.dir;
    const fx = q.tx * dir, fz = q.tz * dir;
    v.fx = fx;
    v.fz = fz;
    v.rx = -fz;
    v.rz = fx;
    const wob = Math.sin(this.clock * 0.35 + v.ph) * 0.1 * Math.min(1, v.v / 10);
    const lat = v.lat + wob;
    v.x = q.x + v.rx * lat;
    v.z = q.z + v.rz * lat;
    const sl = v.v > 0.5 ? v.latRate / Math.max(3, v.v) : 0;
    const hx = fx + v.rx * sl, hz = fz + v.rz * sl;
    v.yaw = Math.atan2(-hz, hx);
    const h0 = q.h;
    const hF = sampleEdge(e, v.s + dir * 2.2, _s).h;
    const hB = sampleEdge(e, v.s - dir * 2.2, _s).h;
    v.y = h0 + 0.03;
    v.pitch = Math.atan2(hF - hB, 4.4);
    void dt;
  }

  // ── Perception ─────────────────────────────────────────────────────────────
  /** Look at everything in the lateral band [lo, hi] (m right of the centre line, in v's frame). */
  scan(v, lo, hi, out, far = 400, across = false) {
    resetScan(out);
    const dir = v.dir, K = v.K;
    const lead = out.lead, same = out.same, onc = out.onc, fol = out.fol;
    const vc = v.e.conn ? v.e : null;
    for (const o of this.vehicles) {
      if (o === v) continue;
      // a wreck that has left its path is seen through where it lies on the road (o.obs), at rest from any direction
      const R = o.free ? o.obs : o;
      if (!R) continue;
      // movements through a junction that leave by the same port share their first stretch of street
      const sib = !o.free && vc && R.e !== vc && R.e.conn && R.e.node === vc.node && R.e.inSide === vc.inSide && v.s < Math.min(vc.divS, R.e.divS) + 6 && R.s < Math.min(vc.divS, R.e.divS) + 12;
      if (R.e !== v.e && !sib) continue;
      const f = (R.s - v.s) * dir;
      if (f > far || f < -far * 0.5) continue;
      const sameDir = R.stat || R.dir === dir;
      const latO = R.lat * R.dir * dir, hw = R.K.w / 2 + 0.1;
      if (latO + hw < lo || latO - hw > hi) continue;
      const vo = R.stat ? 0 : sameDir ? R.v : -R.v;
      if (f >= 0) {
        const gap = f - (sameDir ? R.K.rear : R.K.front) - K.front;
        if (gap < lead.gap) {
          lead.gap = gap;
          lead.v = vo;
          lead.ref = o;
          lead.len = R.K.len;
        }
        if (sameDir && gap < same.gap) {
          same.gap = gap;
          same.v = vo;
          same.ref = o;
          same.len = R.K.len;
        }
        if (!sameDir && gap < onc.gap) {
          onc.gap = gap;
          onc.v = R.v;
        }
      } else if (sameDir) {
        const gap = -f - R.K.front - K.rear;
        if (gap < fol.gap) {
          fol.gap = gap;
          fol.v = R.stat ? 0 : R.v;
          fol.ref = o;
        }
        if (R.K?.isEmergency && !K?.isEmergency && gap < 120) {
          if (!out.emergBehind || gap < out.emergBehind.gap) {
            out.emergBehind = { gap, v: R.stat ? 0 : R.v, ref: o };
          }
        }
      }
    }
    // what is just beyond the junction we are about to drive through
    const nx = across && v.next && !v.next.arrive ? v.next : null;
    if (nx) {
      const toEnd = Math.max(0, this.remain(v));
      if (toEnd < far) {
        const nc = nx.e.conn ? nx.e : null;
        for (const o of this.vehicles) {
          if (o === v) continue;
          const R = o.free ? o.obs : o;
          if (!R) continue;
          // on the road we are heading for, or on a sibling connector that leaves the same port (the first stretch is shared)
          const sibling = !o.free && nc && o.e !== nc && o.e.conn && o.e.node === nc.node && o.e.inSide === nc.inSide && o.s < Math.min(nc.divS, o.e.divS) + 12;
          if (R.e !== nx.e && !sibling) continue;
          const along = sibling || nx.dir > 0 ? R.s : nx.e.len - R.s;
          const f = toEnd + along;
          if (f > far || f < 0) continue;
          const sameDir = sibling || R.stat || R.dir === nx.dir;
          const latO = sibling ? R.lat : R.lat * R.dir * nx.dir, hw = R.K.w / 2 + 0.1;
          if (latO + hw < lo || latO - hw > hi) continue;
          const vo = R.stat ? 0 : sameDir ? R.v : -R.v;
          const gap = f - (sameDir ? R.K.rear : R.K.front) - K.front;
          if (gap < lead.gap) {
            lead.gap = gap;
            lead.v = vo;
            lead.ref = o;
            lead.len = R.K.len;
          }
          if (sameDir && gap < same.gap) {
            same.gap = gap;
            same.v = vo;
            same.ref = o;
            same.len = R.K.len;
          }
          if (!sameDir && gap < onc.gap) {
            onc.gap = gap;
            onc.v = R.v;
          }
        }
      }
    }
    // the player: every footprint circle
    const D = this.D;
    if (D && Math.abs(D.x - v.x) < far && Math.abs(D.z - v.z) < far) {
      const vp = D.v * (this.pcx * v.fx + this.pcz * v.fz); // player speed along our direction of travel
      for (const c of this.pc) {
        const dx = c.x - v.x, dz = c.z - v.z;
        const f = dx * v.fx + dz * v.fz, lat = v.lat + dx * v.rx + dz * v.rz;
        if (lat + c.r < lo || lat - c.r > hi) continue;
        if (f >= 0) {
          const gap = f - c.r - K.front;
          if (gap < lead.gap) {
            lead.gap = gap;
            lead.v = vp;
            lead.ref = PLAYER;
            lead.len = 5;
          }
          if (vp > -1 && gap < same.gap) {
            same.gap = gap;
            same.v = vp;
            same.ref = PLAYER;
            same.len = 6;
          }
          if (vp <= -1 && gap < onc.gap) {
            onc.gap = gap;
            onc.v = -vp;
          }
        } else {
          const gap = -f - c.r - K.rear;
          if (gap < fol.gap) {
            fol.gap = gap;
            fol.v = vp;
            fol.ref = PLAYER;
          }
          if (gap < out.pb.gap) {
            out.pb.gap = gap;
            out.pb.v = vp;
          }
        }
      }
    }
    return out;
  }

  // ── Per-vehicle update ─────────────────────────────────────────────────────
  updateLimits(v, D) {
    const e = v.e, W = this.world.gen;
    const surf = this.land?.surfaceAt ? this.land.surfaceAt(v.x, v.z) : null;
    const mu = surf?.mu ?? 1.05;
    v.surfaceMu = mu;
    v.surfaceKey = surf?.key;
    v.curveLim = S.curveSpeedAhead(curvOf(e), stepOf(e), v.s, v.dir, 260, v.K.aLat * (0.9 + 0.2 * v.temper), 1.5, 6, mu);
    let td = Infinity;
    for (const d of [90, 170, 270, 390]) {
      sampleEdge(e, v.s + v.dir * d);
      if (W.settlementAt(_s.x, _s.z, 60)) {
        td = d;
        break;
      }
    }
    v.townD = td;
    v.townLim = td < Infinity ? S.approachLimit(14, td - 45, 1.3) : Infinity;
    void D;
  }

  startChange(v, latTo, dur, signalSide) {
    v.latFrom = v.lat;
    v.latTo = latTo;
    v.chT = 0;
    v.chDur = dur;
    v.mode = 'change';
    v.signal = signalSide;
  }

  /** Lane decisions, every ~0.4 s per vehicle. */
  decide(v, D) {
    if (v.mode !== 'cruise' || v.wreck > 0 || v.e.conn || this.remain(v) < 220) return;
    const e = v.e, cls = e.cls, K = v.K;
    const lanes = S.laneLats(cls, e.P.width), multi = S.isMultiLane(cls);
    const own = v.ownScan, t = this.tgt;
    // Move over if an emergency vehicle approaches from behind
    if (own?.emergBehind && own.emergBehind.gap < 100 && !K.isEmergency) {
      if (multi && v.lane === 0) {
        v.pendingLat = lanes[1];
        v.pendingSide = 1;
        v.mode = 'signal';
        v.signal = 1;
        v.sigT = 0.4;
        return;
      }
    }
    if (!multi && (cls === 'gravel' || cls === 'dirt')) return;
    const hw = K.w / 2 + 0.15;
    const inner = multi ? v.lane === 0 : v.opp;
    let latT, side = 0;
    if (multi) {
      latT = inner ? lanes[1] : lanes[0];
      side = inner ? 1 : -1;
    } else {
      latT = inner ? lanes[0] : -lanes[0];
      side = inner ? 1 : -1;
    }
    this.scan(v, latT - hw, latT + hw, t, multi ? 220 : 900);
    const v0 = Math.min(v.vmax, v.curveLim);
    // someone who has sat behind a stopped vehicle for a while accepts a bend as long as the way round is short and clear
    const stuck = own.same.ref && own.same.v < 1 && v.followTime > 5;
    const lookStraight = (dist) => S.straightFor(curvOf(e), stepOf(e), v.s, v.dir, dist, stuck ? 1 / 170 : 1 / 450) && v.townD > dist;
    const c = {
      multi, inner, passing: v.passing, heavy: K.cls === 'heavy', v: v.v, v0, pSelf: v.p, len: K.len, abort: v.abort,
      lead: own.same.ref && own.same.gap < BIG ? { gap: own.same.gap, v: own.same.v, len: own.same.len } : null,
      followTime: v.followTime, idle: v.idle,
      target: { gapAhead: t.same.gap, vAhead: t.same.v, gapBehind: t.fol.gap, vBehind: t.fol.v },
      straight: lookStraight, oncoming: t.onc.gap < BIG ? [{ gap: t.onc.gap, v: t.onc.v }] : [], passedGap: t.fol.gap,
    };
    const act = S.laneDecision(c);
    if (act === 'pass') {
      v.passing = true;
      v.passLead = own.same.ref;
      v.abort = false;
      v.pendingLat = latT;
      v.pendingSide = side;
      v.mode = 'signal';
      v.signal = side;
      v.sigT = 1.6;
      this.stats.passes++;
    } else if (act === 'return') {
      v.pendingLat = latT;
      v.pendingSide = side;
      v.mode = 'signal';
      v.signal = side;
      v.sigT = v.abort ? 0.2 : 1.1;
    } else if (!multi && v.opp) {
      // abort a pass when something comes at us and we are not yet clear of the vehicle we are passing
      // (only while we are still clearly behind it; alongside, commit and accelerate past instead)
      const danger = own.onc.gap < (v.v + own.onc.v) * 4.6 + 25;
      if (danger && t.same.gap > 8) v.abort = true;
      else v.push = danger;
    }
    void D;
  }

  // ── Junctions ──────────────────────────────────────────────────────────────
  /** The road that leaves a settlement node by one of its four ports (if it has been built), and whether it starts there. */
  portEdge(node, side) {
    const E = this.world.gen.edges;
    switch (side) {
      case 'E': return { e: E.get(`${node.i},${node.j},0`), start: true };
      case 'W': return { e: E.get(`${node.i - 1},${node.j},0`), start: false };
      case 'S': return { e: E.get(`${node.i},${node.j},1`), start: true };
      default: return { e: E.get(`${node.i},${node.j - 1},1`), start: false };
    }
  }

  /** Drivers slow down for a crash scene beside or on the road ahead (and rubberneck while passing it). */
  wreckLimit(v) {
    let lim = Infinity;
    for (const w of this.vehicles) {
      const o = w.free && w.obs;
      if (!o || o.e !== v.e) continue;
      const f = (o.s - v.s) * v.dir;
      if (f < -25 || f > 170) continue;
      if (Math.abs(o.lat * o.dir * v.dir - v.lat) > 9) continue;
      lim = Math.min(lim, f > 0 ? S.approachLimit(9, f - 20, 1.7) : 9);
    }
    return lim;
  }

  /** Metres until the hand-over to the next road (a connector takes over a little before the port). */
  remain(v) {
    const e = v.e, d = v.dir > 0 ? e.len - v.s : v.s;
    return !e.conn && v.next && !v.next.arrive && v.next.e.conn ? d - v.next.e.tailIn : d;
  }

  /** The node a vehicle is heading for and the port it arrives by. */
  arrivalOf(v) {
    const e = v.e;
    if (v.dir > 0) return { node: e.b, side: e.dir === 0 ? 'W' : 'N' };
    return { node: e.a, side: e.dir === 0 ? 'E' : 'S' };
  }

  /** Connector through a node between two ports, built once and shared. It behaves like a road for everything else. */
  connector(node, inSide, outSide, ein, eout, outStart) {
    const key = `${node.key}|${inSide}${outSide}`;
    let c = this.conns.get(key);
    if (c) return c;
    // the roads meet the ports at their own angles, so the connector takes over from the road a few samples
    // before the port (tangent to it) and hands back the same way on the far side
    const inStart = this.portEdge(node, inSide).start;
    const roadPoint = (e, atStart, arriving) => {
      const j = Math.min(e.n - 2, 3), k = atStart ? j : e.n - 1 - j;
      const a = Math.max(0, k - 1), b = Math.min(e.n - 1, k + 1);
      let dx = e.xs[b] - e.xs[a], dz = e.zs[b] - e.zs[a];
      if (arriving === atStart) {
        dx = -dx; // heading with the road when leaving by its start / arriving at its end, against it otherwise
        dz = -dz;
      }
      const l = Math.hypot(dx, dz) || 1;
      return { k, p: [e.xs[k], e.zs[k]], t: [dx / l, dz / l], tail: atStart ? e.ss[k] : e.len - e.ss[k] };
    };
    const pre = roadPoint(ein, inStart, true), post = roadPoint(eout, outStart, false);
    const path = J.connectorPath(node, inSide, outSide, 3, 12, pre, post);
    const n = path.n;
    const hIn = ein.hs[pre.k], hOut = eout.hs[post.k];
    const hs = new Float64Array(n), ss = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      hs[k] = hIn + (hOut - hIn) * (k / (n - 1));
      ss[k] = (path.len * k) / (n - 1);
    }
    let mid = 0, best = 1e18;
    for (let k = 0; k < n; k++) {
      const d = Math.hypot(path.xs[k] - node.x, path.zs[k] - node.z);
      if (d < best) {
        best = d;
        mid = ss[k];
      }
    }
    const g = this.world.gen.grid(node);
    const street = node.kind === 'junction' ? 0 : node.kind === 'truckstop' || node.kind === 'camp' ? 9 : g.wMain;
    const width = Math.max(street, ein.P.width, eout.P.width);
    c = {
      id: `c:${key}`, conn: true, node, inSide, outSide, turn: J.turnOf(inSide, outSide), cls: 'street', P: { width }, n, xs: path.xs, zs: path.zs, hs, ss, len: path.len,
      name: node.name, sh: 0, to: eout, toStart: outStart, from: ein, path, speed: node.kind === 'junction' && J.turnOf(inSide, outSide) === 'straight' ? Math.min(S.classSpeed(ein.cls), S.classSpeed(eout.cls)) : S.classSpeed('street'), rankIn: J.classRank(ein.cls), divS: path.div, mid,
      tailIn: pre.tail, tailOut: post.tail, keepLanes: S.isMultiLane(ein.cls) && S.isMultiLane(eout.cls), merge: S.isMultiLane(ein.cls) && !S.isMultiLane(eout.cls),
    };
    this.conns.set(key, c);
    return c;
  }

  /** Do two movements through a node cross? Big rigs swing wide, so for them the paths must stay further apart. */
  conflict(a, b, heavy = false) {
    if (a === b) return false;
    const key = (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`) + (heavy ? '|H' : '');
    let r = this.conflicts.get(key);
    if (r === undefined) {
      r = J.movementsConflict(a, b, a.node, 3.2, 34, heavy ? 8 : 3.4);
      this.conflicts.set(key, r);
    }
    return r;
  }

  /** Decide where a vehicle goes when its road ends: onto a connector through the node, or nowhere (it arrives). */
  planNext(v) {
    const e = v.e;
    if (e.conn) {
      v.next = { e: e.to, dir: e.toStart ? 1 : -1 };
      return;
    }
    const { node, side } = this.arrivalOf(v);
    const cands = [];
    for (const out of J.SIDES) {
      if (!J.transitAllowed(node.kind, side, out)) continue;
      const pe = this.portEdge(node, out);
      if (!pe.e || pe.e === e) continue;
      if (v.K.cls === 'heavy' && (pe.e.cls === 'gravel' || pe.e.cls === 'dirt')) continue;
      const turn = J.turnOf(side, out);
      // on a multi-lane road the outer lane turns right and the inner lane left
      if (S.isMultiLane(e.cls) && ((turn === 'left' && v.lane === 1) || (turn === 'right' && v.lane === 0))) continue;
      let w = J.turnWeight(node.kind, turn);
      if (pe.e.cls === e.cls) w *= 1.4;
      else if (J.classRank(pe.e.cls) < J.classRank(e.cls) - 1) w *= 0.6;
      cands.push({ side: out, weight: w, edge: pe.e, start: pe.start });
    }
    const pick = J.pickExit(cands, this.rnd());
    if (!pick) {
      v.next = { arrive: true };
      this.stats.arrivals++;
      return;
    }
    const ch = cands.find((c) => c.side === pick);
    v.next = { e: this.connector(node, side, pick, e, ch.edge, ch.start), dir: 1 };
  }

  /**
   * Control for the crossing area of a connector (the stretch within ZONE m of the node centre). A vehicle
   * asks for its place shortly before the area, holds a wall-like stop line in front of it until the
   * movements that cross its own are clear, and gives the place back once it is through.
   * Returns { cap, hold }: a speed cap and the distance to the stop line (or null).
   */
  junction(v, c, toEnd, D, dt) {
    const K = v.K, out = this._jr || (this._jr = { cap: Infinity, hold: null });
    const onC = v.e === c;
    const zoneStart = c.merge ? 0 : Math.max(0, c.mid - ZONE); // a lane merge is settled at the port, a crossing in the middle
    const dZ = onC ? zoneStart - v.s : toEnd;
    out.hold = null;
    out.cap = Infinity;
    if (!onC && c.turn !== 'straight') out.cap = S.approachLimit(K.cls === 'heavy' ? 4.5 : 6.5, toEnd + c.divS - 4, 1.9);
    if (v.res || dZ < -K.front) return out;

    // Traffic signal check for signalized town intersections
    const node = c.node;
    const isSignalized = Boolean(node && (node.kind === 'town' || node.kind === 'city' || node.signalized));
    let signalRed = false;
    if (isSignalized) {
      const axis = (c.inSide === 'E' || c.inSide === 'W') ? 'X' : 'Z';
      const sig = J.trafficSignalPhase(node, node.x, node.z, this.clock, axis);
      v.signalPhase = sig.phase;
      // Facing red or late yellow
      const lateYellow = sig.phase === 'yellow' && (sig.timeRemaining <= 2.2 || dZ > (v.v * v.v) / (2 * (v.p?.b || 2.0)));
      if (sig.phase === 'red' || lateYellow) {
        signalRed = true;
      }
    }

    if (signalRed) {
      const dStop = onC ? Math.max(0, zoneStart - v.s) : toEnd;
      const stopLook = Math.max(140, (v.v * v.v) / 2.5 + 40);
      if (dStop < stopLook) {
        out.hold = Math.max(0, dStop - K.front - 6);
        if (v.v < 0.5) v.waitT += dt;
        if (!v.waiting) {
          v.waiting = true;
          this.stats.waits++;
        }
        if (!onC && v.res) {
          this.resv.delete(v);
          v.res = null;
        }
        return out;
      }
      return out;
    }

    const reqDist = (v.v * v.v) / 9 + 15 + K.front;
    if (dZ >= Math.max(40, reqDist)) return out;
    const eta = Math.max(0, dZ) / Math.max(v.v, 2);
    // a driver who has waited a while accepts a shorter gap
    const horizon = Math.max(2.8, 6 - 0.25 * Math.max(0, v.waitT - 4));
    if (this.mayEnter(v, c, eta, D, horizon)) {
      v.res = c;
      v.waiting = false;
      v.waitT = 0;
      this.resv.add(v);
    } else {
      out.hold = Math.max(0, dZ - K.front - 8); // wait well back: roads meet a port at an angle and long vehicles swing wide through it
      if (v.v < 0.5) v.waitT += dt;
      if (!v.waiting) {
        v.waiting = true;
        this.stats.waits++;
      }
    }
    return out;
  }

  /** Seconds until a vehicle reaches the crossing area of the connector it is heading for (0 once inside), or null if it is not heading for this node. */
  zoneEta(o, node) {
    let c = null, dZ = 0;
    if (o.e.conn && o.e.node === node) {
      c = o.e;
      if (o.s > c.mid + ZONE + o.K.rear) return null; // already through
      dZ = Math.max(0, (c.merge ? 0 : Math.max(0, c.mid - ZONE)) - o.s);
    } else if (o.next && o.next.e && o.next.e.conn && o.next.e.node === node) {
      c = o.next.e;
      dZ = Math.max(0, this.remain(o)) + (c.merge ? 0 : Math.max(0, c.mid - ZONE));
    } else return null;
    return { c, eta: dZ / Math.max(o.v, 2) };
  }

  /** May this vehicle drive into the crossing area now? Not while a crossing movement is in use or a bigger road's traffic is close. */
  mayEnter(v, c, eta, D, horizon = 6) {
    const me = { rank: c.rankIn, eta, id: v.id, holds: false, isEmergency: Boolean(v.K?.isEmergency), waitT: v.waitT };
    const node = c.node;
    const isSignalized = Boolean(node && (node.kind === 'town' || node.kind === 'city' || node.signalized));

    // Anti-deadlock priority breaker: if waitT > 6.0s at junction, grant reservation to longest-waiting vehicle
    if (v.waitT > 6.0) {
      let longestWaiting = true;
      for (const o of this.vehicles) {
        if (o === v || o.free) continue;
        const z = this.zoneEta(o, c.node);
        if (!z) continue;
        if (o.res && o.res.node === c.node) {
          const conflicts = this.conflict(o.res, c, v.K.cls === 'heavy' || o.K.cls === 'heavy');
          if (conflicts) {
            const isStalled = o.v < 0.3 && (o.waitT ?? 0) > 4.0;
            if (!isStalled) {
              longestWaiting = false;
              break;
            }
          }
        }
        if (o.waitT > v.waitT || (o.waitT === v.waitT && o.id < v.id)) {
          longestWaiting = false;
          break;
        }
      }
      if (longestWaiting) {
        v.blockedBy = null;
        return true;
      }
    }

    for (const o of this.vehicles) {
      if (o === v || o.free) continue;
      const z = this.zoneEta(o, c.node);
      if (!z) continue;
      const oc = z.c, holds = !!o.res && o.res.node === c.node;
      // the same movement only matters when it comes from the other lane of a multi-lane road: both lanes squeeze into one
      if (oc === c ? !(c.merge && o.lane !== v.lane && (o.e === v.e || (o.e === c && o.s < 80))) : !this.conflict(oc, c, v.K.cls === 'heavy' || o.K.cls === 'heavy')) continue;

      // In signalized intersections, do NOT yield to a conflicting vehicle stopped at a RED light (unless they already hold reservation)
      if (isSignalized && !holds) {
        const oAxis = (oc.inSide === 'E' || oc.inSide === 'W') ? 'X' : 'Z';
        const oSig = J.trafficSignalPhase(node, node.x, node.z, this.clock, oAxis);
        if (oSig.phase === 'red') continue;
      }

      if (J.mustYield(me, { rank: oc.rankIn, eta: holds ? 0 : z.eta, id: o.id, holds, isEmergency: Boolean(o.K?.isEmergency), waitT: o.waitT }, horizon)) {
        v.blockedBy = o;
        return false;
      }
    }
    v.blockedBy = null;
    // the player has right of way in the junction and when about to reach it
    if (D && D.active) {
      const d = Math.hypot(D.x - c.node.x, D.z - c.node.z);
      if (d < 30 || (d < 100 && Math.abs(D.v) > 3 && d / Math.abs(D.v) < 5)) {
        v.blockedBy = PLAYER;
        return false;
      }
    }
    return true;
  }

  /** Move a vehicle from the end of its road onto the planned next one (a connector, or the road beyond it). */
  transfer(v, over) {
    const nx = v.next;
    if (!nx || nx.arrive) {
      v.next = undefined;
      v.arrive = true;
      return;
    }
    const ne = nx.e, K = v.K, prev = v.e;
    if (ne.conn && !v.res) return;
    v.next = undefined;
    v.e = ne;
    v.dir = nx.dir;
    v.s = ne.conn ? over : nx.dir > 0 ? prev.tailOut + over : ne.len - prev.tailOut - over;
    if (!ne.conn) {
      this.resv.delete(v);
      v.res = null;
      this.stats.transits++;
    } else if (ne.turn !== 'straight') this.stats.turns++;
    // the new road's lane, speed and a clean slate for the lane-change machine
    const keep = ne.conn ? ne.keepLanes : S.isMultiLane(ne.cls) && S.isMultiLane(prev.conn ? prev.from.cls : prev.cls);
    const lanes = ne.conn ? (ne.keepLanes ? S.laneLats(ne.from.cls, ne.from.P.width) : S.laneLats('street', ne.P.width)) : S.laneLats(ne.cls, ne.P.width);
    const multi = S.isMultiLane(ne.cls);
    if (!keep) v.lane = multi ? (K.cls === 'heavy' || this.rnd() < 0.62 ? 1 : 0) : 0;
    v.latHome = lanes[Math.min(v.lane, lanes.length - 1)];
    v.latTo = v.latHome;
    v.latFrom = v.lat;
    v.mode = 'cruise';
    v.signal = 0;
    v.passing = v.opp = v.abort = v.push = false;
    v.passLead = null;
    v.pendingLat = v.latHome;
    v.idle = 0;
    v.followTime = 0;
    v.limT = 0;
    v.curveLim = Infinity;
    v.townLim = Infinity;
    v.vmax = (ne.speed ?? S.classSpeed(ne.cls)) * K.vmul * (0.92 + (0.2 * (v.temper - 0.88)) / 0.3) * (multi && v.lane === 0 ? 1.04 : 1);
    v.ownScan = null;
  }

  stepVehicle(v, dt, D) {
    if (v.free) return this.stepWreck(v, dt, D);
    // reached the end of the road last frame: carry on through the junction onto the next road
    const rem = this.remain(v);
    if (rem <= 0 && !v.arrive) {
      if (v.next && v.next.e && v.next.e.conn && !v.res) {
        v.v = 0;
        v.a = Math.min(v.a, 0);
        v.s = v.dir > 0 ? v.e.len : 0;
        v.waitT += dt;
        if (!v.waiting) {
          v.waiting = true;
          this.stats.waits++;
        }
      } else {
        this.transfer(v, -rem);
      }
    }
    const e = v.e, K = v.K, cls = e.cls, multi = S.isMultiLane(cls);
    // limits (curves, towns, road end) refreshed a few times a second
    v.limT -= dt;
    if (v.limT <= 0) {
      v.limT = 0.3 + (v.id % 5) * 0.04;
      this.updateLimits(v, D);
    }
    const toEnd = this.remain(v);
    if (v.res && e === v.res && v.s > e.mid + ZONE + K.rear) {
      // clear of the crossing area: the others may go
      this.resv.delete(v);
      v.res = null;
    }
    if (v.next === undefined && !v.arrive && toEnd < 300) this.planNext(v);
    // beyond a road that goes nowhere the vehicle crawls on and is removed; into a junction it slows for the movement and waits its turn
    let endLim = Infinity, hold = null;
    if (!v.next || v.next.arrive) endLim = S.approachLimit(6, toEnd - 25, 1.4);
    const jc = e.conn ? e : v.next && !v.next.arrive && v.next.e.conn ? v.next.e : null;
    if (jc) {
      const j = this.junction(v, jc, toEnd, D, dt);
      endLim = Math.min(endLim, j.cap);
      hold = j.hold;
    }
    // Turn signals before turning connector
    if (jc && jc.turn && jc.turn !== 'straight' && toEnd <= 50 && toEnd > 0) {
      if (v.mode === 'cruise') v.signal = jc.turn === 'left' ? -1 : 1;
    } else if (e.conn && (e.turn === 'left' || e.turn === 'right')) {
      if (v.mode === 'cruise') v.signal = e.turn === 'left' ? -1 : 1;
    }
    const wFactor = S.weatherSpeedFactor(this.land?.season, cls, v.surfaceKey);
    let v0 = Math.min(v.vmax * wFactor * (v.push && v.opp ? 1.15 : 1), v.curveLim, v.townLim, endLim, this.wreckLimit(v));
    // perceive
    const hw = K.w / 2 + 0.1;
    const own = this.scan(v, v.lat - hw, v.lat + hw, v.ownScan || (v.ownScan = makeScan()), 420, true);
    let lead = own.lead;
    if (hold !== null && hold < lead.gap) lead = { gap: hold, v: 0, ref: null, len: 0 }; // the stop line is a wall until the junction is free
    // Emergency vehicle approaching from behind: slow down or pull over
    if (own.emergBehind && own.emergBehind.gap < 80 && !K.isEmergency) {
      v0 = Math.min(v0, Math.max(6, own.emergBehind.v * 0.55));
      if (!multi && v.mode === 'cruise') v.lat = Math.min(v.latHome + 0.6, e.P.width * 0.44);
    }
    if (v.mode === 'signal' || v.mode === 'change') {
      // while moving over, watch the leader in the lane we are heading for as well
      const lt = v.mode === 'signal' ? v.pendingLat : v.latTo;
      const t2 = this.scan(v, lt - hw, lt + hw, this.tgt2, 420, true);
      if (t2.lead.gap < lead.gap) lead = t2.lead;
    } else if (Math.abs(v.latHome - v.lat) > 0.4) {
      // drifting into another lane after a junction: the leader there matters too
      const t2 = this.scan(v, v.latHome - hw, v.latHome + hw, this.tgt2, 420, true);
      if (t2.lead.gap < lead.gap) lead = t2.lead;
    }
    if (v.abort && v.passLead && v.passLead !== PLAYER && v.passLead.v !== undefined) v0 = Math.min(v0, Math.max(0, v.passLead.v - 3));
    else if (v.abort && v.passLead === PLAYER) v0 = Math.min(v0, Math.max(0, own.same.v - 3));
    let acc = S.idmAccel(v.p, v.v, lead.gap, lead.v, v0, v.surfaceMu ?? 1.05);
    if (v.wreck > 0) {
      v.wreck -= dt;
      acc = -6;
    }
    if (v.dead) {
      acc = Math.min(acc, -4); // a crushed engine bay: coast to a stop with the hazards on
      if (v.v < 0.1) {
        this.detach(v, { vx: 0, vz: 0, w: 0 }); // and sit there as a wreck until it is towed
        return;
      }
    }
    // lag between wanting to brake and braking (reaction); emergency stops are not delayed
    v.a += (acc - v.a) * Math.min(1, dt / (acc < -4 ? 0.06 : v.react));
    if (lead.gap < 0.4 && lead.ref && lead.ref !== PLAYER && !lead.ref.free) {
      v.v = Math.min(v.v, Math.max(0, lead.v));
      v.a = Math.min(v.a, 0);
    }
    v.v = Math.max(0, v.v + v.a * dt);
    v.s += v.dir * v.v * dt;
    v.s = Math.max(-150, Math.min(e.len + 150, v.s));
    // held up behind something slower?
    const held = own.same.gap < Math.max(40, v.v * 3) && own.same.v < Math.min(v.vmax, v.curveLim) - 1.2 && own.same.ref;
    if (held) {
      v.followTime += dt;
      v.idle = 0;
    } else {
      v.followTime = Math.max(0, v.followTime - dt * 2);
      v.idle += dt;
    }
    // brake lights with hysteresis
    if (v.a < -0.9 || (v.v < 0.5 && lead.gap < 40)) v.brakeOn = true;
    else if (v.a > -0.3 && !(v.v < 0.5 && lead.gap < 40)) v.brakeOn = false;
    // lane change machine
    v.decT -= dt;
    if (v.decT <= 0) {
      v.decT = 0.35 + this.rnd() * 0.15;
      this.decide(v, D);
    }
    if (v.mode === 'signal') {
      v.sigT -= dt;
      if (v.sigT <= 0) {
        // last look before moving over
        const lanes = S.laneLats(cls, e.P.width);
        const hw2 = K.w / 2 + 0.15;
        const t = this.scan(v, v.pendingLat - hw2, v.pendingLat + hw2, this.tgt, multi ? 220 : 900);
        const returning = v.pendingSide > 0 && (multi ? v.lane === 0 : v.opp);
        const ok = (returning && v.abort) || (S.mergeSafe({ pSelf: v.p, v: v.v, vAhead: t.same.v, gapAhead: t.same.gap, vBehind: t.fol.v, gapBehind: t.fol.gap }) && (returning || multi || t.onc.gap > (v.v + t.onc.v) * 6 + 60));
        if (ok) {
          const dur = K.cls === 'heavy' ? 4.2 : 3.0;
          this.startChange(v, v.pendingLat, dur, v.pendingSide);
          if (multi) v.lane = v.pendingSide > 0 ? 1 : 0;
          else v.opp = !returning;
          void lanes;
        } else {
          v.mode = 'cruise';
          v.signal = 0;
          if (!returning) v.passing = false;
        }
      }
    }
    v.latRate = 0;
    if (v.mode === 'cruise' && Math.abs(v.latHome - v.lat) > 0.01) {
      const d = Math.max(-0.7 * dt, Math.min(0.7 * dt, v.latHome - v.lat)); // drift back to the lane after a bump
      v.lat += d;
      v.latRate = d / dt;
    }
    if (v.mode === 'change') {
      v.chT += dt;
      const p = Math.min(1, v.chT / v.chDur), dl = v.latTo - v.latFrom;
      v.lat = v.latFrom + dl * p * p * (3 - 2 * p);
      v.latRate = (dl * 6 * p * (1 - p)) / v.chDur;
      if (p >= 1) {
        v.mode = 'cruise';
        v.signal = 0;
        v.lat = v.latTo;
        v.latHome = v.latTo;
        v.latRate = 0;
        const inner = multi ? v.lane === 0 : v.opp;
        if (!inner) {
          v.passing = false;
          v.passLead = null;
          v.abort = false;
          v.push = false;
          v.idle = 0;
        }
      }
    }
    this.place(v, dt);
    if (K === S.KINDS.semi) {
      v.thetaT = S.stepTrailer(v.thetaT, v.yaw, v.v, dt);
      const hx = Math.cos(v.yaw), hz = -Math.sin(v.yaw);
      v.kx = v.x + hx * S.SEMI_HITCH;
      v.kz = v.z + hz * S.SEMI_HITCH;
      const hB = sampleEdge(e, v.s - v.dir * 11, _s).h;
      v.pitchT = Math.atan2(sampleEdge(e, v.s, _s).h - hB, 11);
    }
    // horn
    const blocked = lead.ref === PLAYER ? { gap: lead.gap, v: lead.v } : null;
    const tail = own.pb.gap < BIG && own.pb.gap < 30 ? { gap: own.pb.gap, v: own.pb.v } : null;
    const h = S.honkStep(v.honk, dt, { v: v.v, v0: Math.min(v.vmax, v.curveLim), blocked, tailgated: tail });
    if (h) this.honkAt(v, h, D);
  }

  honkAt(v, kind, D) {
    this.stats.honks++;
    D.onTrafficHorn?.(v, kind);
    try {
      const snd = window.__app?.sound;
      if (!snd?.ctx || !snd.on) return;
      const dist = Math.hypot(v.x - D.x, v.z - D.z);
      if (dist > 260) return;
      const ctx = snd.ctx, t0 = ctx.currentTime, dur = kind === 2 ? 0.9 : 0.32;
      const g = ctx.createGain(), vol = 0.2 * (snd.volume ?? 1) * Math.pow(Math.max(0, 1 - dist / 260), 2);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.03);
      g.gain.setValueAtTime(vol, t0 + dur - 0.08);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      let out = g;
      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.max(-1, Math.min(1, ((v.x - D.x) * Math.sin(D.yaw) + (v.z - D.z) * Math.cos(D.yaw)) / 60));
        g.connect(pan);
        out = pan;
      }
      out.connect(ctx.destination);
      const heavy = v.K.cls === 'heavy';
      for (const f of heavy ? [185, 233, 277] : v.id % 2 ? [440, 349] : [392, 311]) {
        const o = ctx.createOscillator();
        o.type = heavy ? 'sawtooth' : 'square';
        o.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = heavy ? 1000 : 1500;
        o.connect(lp).connect(g);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      }
    } catch {
      /* audio is optional */
    }
  }

  // ── Footprints and collisions with the player ──────────────────────────────
  footprint(v, out = this.fp) {
    let n = 0;
    const put = (x, z, r) => {
      const c = out[n] || (out[n] = { x: 0, z: 0, r: 0 });
      c.x = x;
      c.z = z;
      c.r = r;
      n++;
    };
    const hx = Math.cos(v.yaw), hz = -Math.sin(v.yaw);
    for (const [off, r] of v.K.circles) put(v.x + hx * off, v.z + hz * off, r);
    if (v.K.trailerCircles) {
      const tx = Math.cos(v.thetaT), tz = -Math.sin(v.thetaT);
      for (const [d, r] of v.K.trailerCircles) put(v.kx - tx * d, v.kz - tz * d, r);
    }
    out.length = n;
    return out;
  }

  /** Rigid-body view of a vehicle for the impact solver (a path follower moves along its lane; a wreck is free). */
  bodyOf(v) {
    const K = v.K, I = inertia(K.mass, K.len, K.w);
    if (v.free) return makeBody({ x: v.free.x, z: v.free.z, vx: v.free.vx, vz: v.free.vz, w: v.free.w, m: K.mass, I });
    return makeBody({ x: v.x, z: v.z, vx: v.v * v.fx + v.latRate * v.rx, vz: v.v * v.fz + v.latRate * v.rz, w: 0, m: K.mass, I });
  }

  /** Slide a vehicle by (dx, dz) metres: wrecks move freely, path followers along their lane. */
  nudge(v, dx, dz) {
    if (v.free) {
      v.free.x += dx;
      v.free.z += dz;
      return;
    }
    v.s += v.dir * (dx * v.fx + dz * v.fz);
    v.lat += Math.max(-0.6, Math.min(0.6, dx * v.rx + dz * v.rz));
  }

  /** Take an impact result back into an AI vehicle: damage, then either keep driving or leave the road. */
  applyImpact(v, B, res, share) {
    v.dmg = Math.min(1, v.dmg + damageAmount(res.energy, share));
    if (v.dmg > 0.5) v.dead = true;
    if (v.free) {
      v.free.vx = B.vx;
      v.free.vz = B.vz;
      v.free.w = B.w;
      return;
    }
    const along = B.vx * v.fx + B.vz * v.fz, lat = B.vx * v.rx + B.vz * v.rz;
    if (shouldDetach(res.closing, lat - v.latRate, B.w) || v.dmg > 0.8) this.detach(v, B);
    else {
      v.v = Math.max(0, along);
      v.a = Math.min(v.a, -2);
    }
  }

  /** The vehicle leaves its path and becomes a free body (a wreck) with the velocity the crash gave it. */
  detach(v, B) {
    if (v.free) return;
    v.free = { x: v.x, z: v.z, yaw: v.yaw, vx: B.vx, vz: B.vz, w: B.w };
    v.wreckT = 0;
    v.wreck = 0;
    v.mode = 'cruise';
    v.signal = 0;
    v.brakeOn = false;
    v.passing = false;
    v.dead = true;
    v.honk.cd = 0;
    this.stats.wrecks++;
  }

  /**
   * A wreck slides to a stop, then sits with its hazards on, smoking if badly hurt, until it is towed
   * (removed once nobody is looking). Where it lies on the road is published as `obs` for the others.
   */
  stepWreck(v, dt) {
    const fb = v.free, W = this.world.gen;
    const q = W.roadAt(fb.x, fb.z);
    const onRoad = !!q && q.d < q.edge.P.width / 2 + (q.edge.sh || 0) + 0.5;
    const rest = stepFree(fb, dt, { mu: onRoad ? 0.7 : 0.45, drag: onRoad ? 4 : 5.5, spinDecay: onRoad ? 1.1 : 2 });
    v.wreckT += dt;
    v.x = fb.x;
    v.z = fb.z;
    v.yaw = fb.yaw;
    v.v = Math.hypot(fb.vx, fb.vz);
    const hx = Math.cos(fb.yaw), hz = -Math.sin(fb.yaw);
    v.fx = hx;
    v.fz = hz;
    v.rx = -hz;
    v.rz = hx;
    const h0 = this.land.heightAt(v.x, v.z);
    v.y = h0 + 0.03;
    v.pitch = Math.atan2(this.land.heightAt(v.x + hx * 2.2, v.z + hz * 2.2) - this.land.heightAt(v.x - hx * 2.2, v.z - hz * 2.2), 4.4);
    if (v.kind === 'semi') {
      const u = fb.vx * hx + fb.vz * hz;
      v.thetaT = S.stepTrailer(v.thetaT, fb.yaw, u, dt);
      v.kx = v.x + hx * S.SEMI_HITCH;
      v.kz = v.z + hz * S.SEMI_HITCH;
      v.pitchT = v.pitch;
    }
    v.wreck = v.wreckT < 150 ? 1 : 0; // hazard lights
    // hurt vehicles smoke
    if (v.dmg > 0.3) {
      v.smokeT -= dt;
      if (v.smokeT <= 0) {
        v.smokeT = 0.14;
        this.world.fx?.smokeAt?.(v.x + hx * v.K.front * 0.55, v.y + 1.0, v.z + hz * v.K.front * 0.55, v.dmg);
      }
    }
    // where it lies on the road (or on a junction connector in a town), for the drivers who must get past it
    let e = null, sPos = 0, side = 0, tx = 1, tz = 0;
    if (q && onRoad) {
      e = q.edge;
      sPos = (q.k + q.t) * (e.len / (e.n - 1));
      side = q.side;
      tx = q.tx;
      tz = q.tz;
    } else if (this.conns.size) {
      let best = 14;
      for (const c of this.conns.values()) {
        if (Math.abs(c.node.x - v.x) > c.node.Rp + 20 || Math.abs(c.node.z - v.z) > c.node.Rz + 20) continue;
        for (let k = 0; k < c.n; k++) {
          const d = Math.hypot(c.xs[k] - v.x, c.zs[k] - v.z);
          if (d < best) {
            best = d;
            e = c;
            sPos = c.ss[k];
            const a = Math.max(0, k - 1), b = Math.min(c.n - 1, k + 1), l = Math.hypot(c.xs[b] - c.xs[a], c.zs[b] - c.zs[a]) || 1;
            tx = (c.xs[b] - c.xs[a]) / l;
            tz = (c.zs[b] - c.zs[a]) / l;
            side = (v.x - c.xs[k]) * -tz + (v.z - c.zs[k]) * tx;
          }
        }
      }
    }
    if (e) {
      let along = 0, across = 0;
      const rx = -tz, rz = tx;
      for (const c of this.footprint(v)) {
        const dx = c.x - v.x, dz = c.z - v.z;
        along = Math.max(along, Math.abs(dx * tx + dz * tz) + c.r);
        across = Math.max(across, Math.abs(dx * rx + dz * rz) + c.r);
      }
      const o = v.obs || (v.obs = { e, s: 0, dir: 1, lat: 0, v: 0, stat: true, K: { w: 2, front: 2, rear: 2, len: 4 } });
      o.e = e;
      o.s = sPos;
      o.lat = side;
      o.stat = rest || v.v < 1.5;
      o.v = o.stat ? 0 : v.v * (fb.vx * tx + fb.vz * tz >= 0 ? 1 : -1);
      o.K.w = across * 2;
      o.K.front = o.K.rear = along;
      o.K.len = along * 2;
    } else v.obs = null;
  }

  // ── Collisions ─────────────────────────────────────────────────────────────
  /** Two AI vehicles (or a wreck and a vehicle) touch: full impulse, both may be knocked off the road. */
  collidePair(a, b) {
    const k = chainContact(this.footprint(a, this.fpA), this.footprint(b, this.fpB), this._kp || (this._kp = {}));
    if (!k || k.pen < 0.4) return; // the circles are generous: a few centimetres of overlap is two vehicles passing close, not a crash
    const A = this.bodyOf(a), B = this.bodyOf(b);
    const mA = a.K.mass, mB = b.K.mass, push = k.pen + 0.02;
    const shA = a.free || b.free ? mB / (mA + mB) : 0.5;
    if (a.free || b.free) {
      this.nudge(a, k.nx * push * shA, k.nz * push * shA);
      this.nudge(b, -k.nx * push * (1 - shA), -k.nz * push * (1 - shA));
    }
    // two path followers never crash into each other: the driving logic keeps them apart, and where it falls short (a
    // hand-over between roads, a swinging trailer) they simply pass through. Only a wreck, or the player, makes a crash.
    if (!a.free && !b.free) {
      if (Math.hypot(A.vx - B.vx, A.vz - B.vz) > 2.5) this.stats.ghosts++;
      return;
    }
    const res = resolveImpact(A, B, k.nx, k.nz, k.px, k.pz, 0.15, 0.4);
    if (!res) return;
    this.applyImpact(a, A, res, 0.5);
    this.applyImpact(b, B, res, 0.5);
    if (res.closing > 2) {
      this.stats.pileups++;
      this.world.fx?.crash?.(k.px, a.y, k.pz, res.closing, k.nx, k.nz);
      this.sound(a, 'crash', res.closing);
    }
  }

  collidePairs() {
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const ra = a.kind === 'semi' ? 27 : 7;
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        const lim = ra + (b.kind === 'semi' ? 27 : 7);
        if (Math.abs(a.x - b.x) > lim || Math.abs(a.z - b.z) > lim) continue;
        if (a.free && b.free && a.v < 0.2 && b.v < 0.2) continue; // two wrecks at rest
        this.collidePair(a, b);
      }
    }
  }

  /** Crash sound for an AI-only impact, panned and attenuated by distance from the player. */
  sound(v, kind, closing) {
    const D = this.D;
    if (!D) return;
    const dist = Math.hypot(v.x - D.x, v.z - D.z);
    if (dist > 220) return;
    window.__app?.sound?.fx?.('impact', kind, Math.max(3, closing) * Math.max(0.15, 1 - dist / 220), v.K.cls === 'heavy');
  }

  collidePlayer(v, D, dt) {
    const dx = v.x - D.x, dz = v.z - D.z;
    if (dx * dx + dz * dz > 58 * 58) return;
    const k = chainContact(this.pc, this.footprint(v), this._kc || (this._kc = {}));
    if (!k) return;
    const semi = D.vehicle === 'semi';
    const B = this.bodyOf(v);
    const mA = v.K.mass, mP = semi ? D.rig.mass : D.mass;
    const push = k.pen + 0.02;
    // positional separation: a path follower can only be nudged along its path, so the player gives most of the way
    const shP = v.free ? mA / (mA + mP) : 0.7;
    D.x += k.nx * push * shP;
    D.z += k.nz * push * shP;
    this.nudge(v, -k.nx * push * (1 - shP), -k.nz * push * (1 - shP));
    // who ran into whom: compare how fast each was closing along the contact normal
    const hx = Math.cos(D.yaw), hz = -Math.sin(D.yaw);
    const dvx = D.v * hx + (D.vy || 0) * hz * -1, dvz = D.v * hz + (D.vy || 0) * hx;
    const vAI = B.vx * k.nx + B.vz * k.nz, vP = dvx * k.nx + dvz * k.nz;
    const byAI = vAI > 0 && vAI > -vP;
    let res;
    if (semi) {
      // the rig is far too heavy to spin: only its speed changes
      const A = makeBody({ x: D.x, z: D.z, vx: D.v * hx, vz: D.v * hz, m: mP, I: 5e6 });
      res = resolveImpact(A, B, k.nx, k.nz, k.px, k.pz, 0.15, 0.4);
      if (res) {
        D.v = A.vx * hx + A.vz * hz;
        D.rig.v = D.v;
        if (res.closing >= 1.2) {
          D.rig.damage = Math.min(100, D.rig.damage + S.impactDamage(res.closing, mA, mP));
          D.hitSpeed = res.closing;
          D.onImpact?.('crash', res.closing, k.px, k.pz, k.nx, k.nz, res.energy);
          this.world.fx?.crash?.(k.px, D.groundH ?? 0, k.pz, res.closing, k.nx, k.nz);
        }
      }
    } else res = D.impactVan(k.nx, k.nz, k.px, k.pz, B, 0.18, 0.4, 0.5 * D.assist.forgive, 'crash');
    if (!res) return;
    this.applyImpact(v, B, res, 0.5);
    if (res.closing >= 1.2) this.hit(v, D, res.closing, byAI);
    void dt;
  }

  hit(v, D, closing, byAI) {
    this.stats.crashes++;
    this.stats.last = { kind: v.kind, closing: +closing.toFixed(1), byAI, mode: v.mode, lat: +v.lat.toFixed(2), opp: v.opp, vAI: +v.v.toFixed(1), free: !!v.free, clock: +this.clock.toFixed(1) };
    D.lastHit = 'vehicle';
    D.emit(byAI ? 'rearended' : 'crash');
    v.wreck = Math.max(v.wreck, 2.5 + Math.min(3, closing * 0.3));
    v.honk.cd = 0;
    this.honkAt(v, 2, D);
  }

  // ── Frame ──────────────────────────────────────────────────────────────────
  update(dt, D) {
    if (!D.active) {
      if (this.vehicles.length) this.clear();
      return;
    }
    dt = Math.min(dt, 0.05);
    this.clock += dt;
    this.D = D;
    const cam = this.stage.camera;
    // camera frustum in the land group's frame (for spawn-in-view and culling tests)
    this.fm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(this.land.envRoot.matrixWorld);
    this.frustum.setFromProjectionMatrix(this.fm);
    this.refY = (D.groundH ?? 0) + 2;
    // the player's footprint and heading
    this.pc = D.bodyPoints();
    this.pcx = Math.cos(D.yaw);
    this.pcz = -Math.sin(D.yaw);
    // lamps follow the time of day
    const night = this.land.season.u.uNight.value;
    this.mat.userData.uLamp.value.set(Math.min(1, night * 2.2), 0.08 + 0.5 * night, 0, 0);
    // spawn
    if (!this.populated) {
      this.populated = true;
      for (let i = 0; i < 80 && this.vehicles.length < Math.ceil(this.max * 0.6); i++) this.trySpawn(D, true);
    }
    this.t -= dt;
    if (this.t <= 0) {
      this.t = this.vehicles.length < this.max * 0.6 ? 0.3 : 0.7;
      if (this.vehicles.length < this.max) this.trySpawn(D);
    }
    const Rdes = this.tier.R + 90;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      this.stepVehicle(v, dt, D);
      const dist = Math.hypot(v.x - D.x, v.z - D.z);
      let gone = dist > Rdes;
      if (v.free) {
        // wrecks stay until they have been there a while and nobody is watching (or they are far away)
        if (v.wreckT > 75 && (dist > 140 || !this.inView(v.x, v.z, 25, v.y))) gone = true;
        else if (v.wreckT > 300 && dist > 50) gone = true;
      } else if (v.arrive) {
        // drove on past a road that goes nowhere (into the settlement or yard): gone once out of sight
        const past = v.dir > 0 ? v.s - v.e.len : -v.s;
        if (past > 28 && (dist > 90 || !this.inView(v.x, v.z, 25, v.y))) gone = true;
        else if (past > 110) gone = true;
      }
      if (gone || (this.vehicles.length > this.max + 2 && dist > 250 && !this.inView(v.x, v.z, 30, v.y))) this.vehicles.splice(i, 1);
    }
    for (const v of this.resv) if (!v.res || v.free || !this.vehicles.includes(v)) this.resv.delete(v);
    this.pruneT -= dt;
    if (this.pruneT <= 0) {
      this.pruneT = 20;
      // connectors of settlements the player has left far behind (rebuilt on demand)
      let dropped = false;
      for (const [k, c] of this.conns) {
        if (Math.hypot(c.node.x - D.x, c.node.z - D.z) < 4500) continue;
        if (this.vehicles.some((v) => v.e === c || v.res === c || (v.next && v.next.e === c))) continue;
        this.conns.delete(k);
        dropped = true;
      }
      if (dropped) this.conflicts.clear();
    }
    this.collidePairs();
    for (const v of this.vehicles) this.collidePlayer(v, D, dt);
    this.paint(D);
  }

  paint(D) {
    for (const m of this.meshes.values()) m.n = 0;
    const tier = this.tier, clock = this.clock;
    let hi = 0, lo = 0;
    const put = (key, v, x, y, z, yaw, pitch, col, lampB, lampL, lampR, forceLo) => {
      const dist = Math.hypot(x - D.x, z - D.z);
      const hiD = tier.hi * (v.K.cls === 'heavy' ? 1.45 : 1);
      if (v.hi) v.hi = dist < hiD * 1.08;
      else v.hi = dist < hiD * 0.92;
      let lod = v.hi && !forceLo ? 'hi' : 'lo';
      let m = this.meshFor(key, lod);
      if (m.n >= m.cap) {
        if (lod === 'hi') {
          lod = 'lo';
          m = this.meshFor(key, lod);
        }
        if (m.n >= m.cap) return;
      }
      const i = m.n++;
      _p.set(x, y, z);
      _q.setFromEuler(_eu.set(0, yaw, pitch, 'YXZ'));
      m.mesh.setMatrixAt(i, _m4.compose(_p, _q, _sc));
      m.mesh.setColorAt(i, _col.setRGB(col[0], col[1], col[2]));
      m.lamp.setXYZ(i, lampB, lampL, lampR);
      if (lod === 'hi') hi++;
      else lo++;
    };
    for (const v of this.vehicles) {
      const dist = Math.hypot(v.x - D.x, v.z - D.z);
      const semi = v.kind === 'semi';
      // cull what the camera cannot see (but keep things near the van for shadows)
      if (dist > 45) {
        const cx = semi ? v.x - Math.cos(v.yaw) * 4 : v.x, cz = semi ? v.z + Math.sin(v.yaw) * 4 : v.z;
        this.sphere.center.set(cx, v.y + 2, cz);
        this.sphere.radius = semi ? 17 : v.K.len * 0.5 + 3;
        if (!this.frustum.intersectsSphere(this.sphere)) continue;
      }
      const blink = (clock * 1.6 + v.ph) % 1 < 0.5 ? 1 : 0;
      const hazard = v.wreck > 0 ? blink : 0;
      const L = v.signal < 0 ? blink : hazard, R = v.signal > 0 ? blink : hazard;
      const B = v.brakeOn ? 1 : 0;
      put(v.model, v, v.x, v.y, v.z, v.yaw, v.pitch, v.col, B, L, R, false);
      if (semi) put(v.tkey, v, v.kx, v.y, v.kz, v.thetaT, v.pitchT, v.tcol, B, L, R, !v.hi);
    }
    for (const m of this.meshes.values()) {
      m.mesh.count = m.n;
      m.mesh.visible = this.visible && m.n > 0;
      if (m.n > 0) {
        m.mesh.instanceMatrix.needsUpdate = true;
        m.mesh.instanceColor.needsUpdate = true;
        m.lamp.needsUpdate = true;
      }
    }
    this.stats.vehicles = this.vehicles.length;
    this.stats.hi = hi;
    this.stats.lo = lo;
    this.stats.drawn = hi + lo;
  }
}
