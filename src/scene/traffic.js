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
const BIG = 1e9;
const PLAYER = { player: true };

// ── Road sampling (no allocation) ─────────────────────────────────────────────
const _s = { x: 0, z: 0, tx: 0, tz: 0, h: 0 };
function sampleEdge(e, s, out = _s) {
  const n = e.n, step = e.len / (n - 1);
  const kf = Math.max(0, Math.min(n - 1.001, s / step));
  const k = Math.floor(kf), t = kf - k;
  out.x = e.xs[k] + (e.xs[k + 1] - e.xs[k]) * t;
  out.z = e.zs[k] + (e.zs[k + 1] - e.zs[k]) * t;
  const dx = e.xs[Math.min(n - 1, k + 2)] - e.xs[Math.max(0, k - 1)], dz = e.zs[Math.min(n - 1, k + 2)] - e.zs[Math.max(0, k - 1)], l = Math.hypot(dx, dz) || 1;
  out.tx = dx / l;
  out.tz = dz / l;
  out.h = e.hs ? e.hs[k] + (e.hs[k + 1] - e.hs[k]) * t : 0;
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
});
function resetScan(o) {
  o.lead.gap = o.same.gap = o.onc.gap = o.fol.gap = o.pb.gap = BIG;
  o.lead.ref = o.same.ref = o.fol.ref = null;
  o.lead.v = o.same.v = o.onc.v = o.fol.v = o.pb.v = 0;
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
    this.fp = [];
    this.stats = { vehicles: 0, drawn: 0, hi: 0, lo: 0, honks: 0, passes: 0, crashes: 0 };
    this.enabled = true;
  }

  setQuality(tier) {
    this.tier = TIERS[tier] || TIERS.medium;
    this.max = this.tier.max;
    for (const m of this.meshes.values()) m.mesh.castShadow = m.lod === 'hi' && this.tier.shadow;
  }

  clear() {
    this.vehicles.length = 0;
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
      honk: S.makeHonk(), wreck: 0, ph: rnd() * 6.28, pendingLat: lat, pendingSide: 0, ownScan: null,
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
  scan(v, lo, hi, out, far = 400) {
    resetScan(out);
    const dir = v.dir, K = v.K;
    const lead = out.lead, same = out.same, onc = out.onc, fol = out.fol;
    for (const o of this.vehicles) {
      if (o === v || o.e !== v.e) continue;
      const f = (o.s - v.s) * dir;
      if (f > far || f < -far * 0.5) continue;
      const sameDir = o.dir === dir;
      const latO = o.lat * o.dir * dir, hw = o.K.w / 2 + 0.1;
      if (latO + hw < lo || latO - hw > hi) continue;
      const vo = sameDir ? o.v : -o.v;
      if (f >= 0) {
        const gap = f - (sameDir ? o.K.rear : o.K.front) - K.front;
        if (gap < lead.gap) {
          lead.gap = gap;
          lead.v = vo;
          lead.ref = o;
          lead.len = o.K.len;
        }
        if (sameDir && gap < same.gap) {
          same.gap = gap;
          same.v = vo;
          same.ref = o;
          same.len = o.K.len;
        }
        if (!sameDir && gap < onc.gap) {
          onc.gap = gap;
          onc.v = o.v;
        }
      } else if (sameDir) {
        const gap = -f - o.K.front - K.rear;
        if (gap < fol.gap) {
          fol.gap = gap;
          fol.v = o.v;
          fol.ref = o;
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
    v.curveLim = S.curveSpeedAhead(curvOf(e), stepOf(e), v.s, v.dir, 260, v.K.aLat * (0.9 + 0.2 * v.temper), 1.5);
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
    if (v.mode !== 'cruise' || v.wreck > 0) return;
    const e = v.e, cls = e.cls, K = v.K;
    const lanes = S.laneLats(cls, e.P.width), multi = S.isMultiLane(cls);
    if (!multi && (cls === 'gravel' || cls === 'dirt')) return;
    const own = v.ownScan, t = this.tgt;
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
    const lookStraight = (dist) => S.straightFor(curvOf(e), stepOf(e), v.s, v.dir, dist, 1 / 450) && v.townD > dist;
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

  stepVehicle(v, dt, D) {
    const e = v.e, K = v.K, cls = e.cls, multi = S.isMultiLane(cls);
    // limits (curves, towns, road end) refreshed a few times a second
    v.limT -= dt;
    if (v.limT <= 0) {
      v.limT = 0.3 + (v.id % 5) * 0.04;
      this.updateLimits(v, D);
    }
    const toEnd = v.dir > 0 ? e.len - v.s : v.s;
    const endLim = S.approachLimit(7, toEnd - 50, 1.4);
    let v0 = Math.min(v.vmax * (v.push && v.opp ? 1.15 : 1), v.curveLim, v.townLim, endLim);
    // perceive
    const hw = K.w / 2 + 0.1;
    const own = this.scan(v, v.lat - hw, v.lat + hw, v.ownScan || (v.ownScan = makeScan()), 420);
    const lead = own.lead;
    if (v.abort && v.passLead && v.passLead !== PLAYER && v.passLead.v !== undefined) v0 = Math.min(v0, Math.max(0, v.passLead.v - 3));
    else if (v.abort && v.passLead === PLAYER) v0 = Math.min(v0, Math.max(0, own.same.v - 3));
    let acc = S.idmAccel(v.p, v.v, lead.gap, lead.v, v0);
    if (v.wreck > 0) {
      v.wreck -= dt;
      acc = -6;
    }
    // lag between wanting to brake and braking (reaction); emergency stops are not delayed
    v.a += (acc - v.a) * Math.min(1, dt / (acc < -4 ? 0.06 : v.react));
    if (lead.gap < 0.4 && lead.ref && lead.ref !== PLAYER) {
      v.v = Math.min(v.v, Math.max(0, lead.v));
      v.a = Math.min(v.a, 0);
    }
    v.v = Math.max(0, v.v + v.a * dt);
    v.s += v.dir * v.v * dt;
    v.s = Math.max(2, Math.min(e.len - 2, v.s));
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
    if (v.mode === 'change') {
      v.chT += dt;
      const p = Math.min(1, v.chT / v.chDur), dl = v.latTo - v.latFrom;
      v.lat = v.latFrom + dl * p * p * (3 - 2 * p);
      v.latRate = (dl * 6 * p * (1 - p)) / v.chDur;
      if (p >= 1) {
        v.mode = 'cruise';
        v.signal = 0;
        v.lat = v.latTo;
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
  footprint(v) {
    const out = this.fp;
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

  collidePlayer(v, D, dt) {
    const dx = v.x - D.x, dz = v.z - D.z;
    if (dx * dx + dz * dz > 58 * 58) return;
    const fp = this.footprint(v);
    let best = 0, nx = 0, nz = 0;
    for (const c of fp) {
      for (const q of this.pc) {
        const ex = q.x - c.x, ez = q.z - c.z, d = Math.hypot(ex, ez), pen = c.r + q.r - d;
        if (pen > best && d > 1e-4) {
          best = pen;
          nx = ex / d;
          nz = ez / d;
        }
      }
    }
    if (best <= 0) return;
    const semi = D.vehicle === 'semi';
    const mP = semi ? D.rig.mass : 3800, mA = v.K.mass;
    const hx = Math.cos(v.yaw), hz = -Math.sin(v.yaw); // AI heading
    const ph = this.pcx * hx + this.pcz * hz; // cosine of the angle between the two headings
    const uA = v.v, uP = D.v * ph; // speeds along the AI's heading
    const along = nx * hx + nz * hz; // > 0: the player is in front of the AI
    const rel = D.v * (this.pcx * nx + this.pcz * nz) - (v.v * v.fx + v.latRate * v.rx) * nx - (v.v * v.fz + v.latRate * v.rz) * nz; // normal speed of the player relative to the AI
    const closing = Math.max(0, -rel);
    // positional separation: the AI is bound to its path, so the player gives most of the way
    const push = best + 0.02;
    D.x += nx * push * 0.7;
    D.z += nz * push * 0.7;
    const sx = -nx * push * 0.3, sz = -nz * push * 0.3;
    v.s += v.dir * (sx * v.fx + sz * v.fz);
    v.lat += Math.max(-0.8, Math.min(0.8, sx * v.rx + sz * v.rz));
    if (closing < 0.3) return;
    if (Math.abs(along) > 0.45) {
      const r = S.collide1D(mA, uA, mP, uP, 0.15);
      const rear = along > 0 && uA > uP + 0.5; // the AI drove into the back of the player
      v.v = Math.max(0, r.vA);
      v.a = Math.min(v.a, -2);
      D.v += (r.vB - uP) * ph;
      this.hit(v, D, closing, mA, mP, rear);
    } else {
      // sideswipe: scrub speed and shove the AI sideways a little
      D.v *= 1 - Math.min(0.12, closing * 0.01);
      v.lat += Math.max(-0.4, Math.min(0.4, (-nx * v.rx - nz * v.rz) * 0.2));
      v.v *= 0.97;
      this.hit(v, D, closing * 0.6, mA, mP, false);
    }
    void dt;
  }

  hit(v, D, closing, mA, mP, byAI) {
    if (closing < 1.2) return;
    this.stats.crashes++;
    this.stats.last = { kind: v.kind, closing: +closing.toFixed(1), byAI, mode: v.mode, lat: +v.lat.toFixed(2), opp: v.opp, vAI: +v.v.toFixed(1), clock: +this.clock.toFixed(1) };
    if (D.vehicle === 'semi') {
      D.rig.damage = Math.min(100, D.rig.damage + S.impactDamage(closing, mA, mP));
      D.hitSpeed = closing;
    }
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
      const atEnd = v.s < 14 || v.s > v.e.len - 14;
      let gone = dist > Rdes;
      if (atEnd) {
        if (dist > 130 && !this.inView(v.x, v.z, 25, v.y)) gone = true;
        else v.vmax = Math.min(v.vmax, 2);
      }
      if (gone || (this.vehicles.length > this.max + 2 && dist > 250 && !this.inView(v.x, v.z, 30, v.y))) this.vehicles.splice(i, 1);
    }
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
