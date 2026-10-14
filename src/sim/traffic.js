// AI traffic logic (pure, no rendering): car following (Intelligent Driver Model), lane choice and
// overtaking with gap-acceptance checks, curve / town / road-end speed limits from the road
// polyline, off-tracking of articulated trailers, honking rules and a 1-D collision response.
//
// Conventions: positions along an edge are arc lengths s, `dir` = +1 / -1 is the travel direction
// along +s, and lateral offsets `lat` are metres to the RIGHT of the direction of travel measured
// from the road centre line (so a car in its own lane has lat > 0 and the oncoming lane is lat < 0).
// Angles use the driving world's heading convention: direction (cos θ, −sin θ).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const smooth01 = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// ── Vehicle kinds ─────────────────────────────────────────────────────────────
// front / rear: extents (m) from the reference point to the bumpers; circles: [x offset, radius]
// footprint along the heading from the reference point; a, b: comfortable acceleration / braking
// (m/s²); T: desired time headway (s); s0: standstill gap (m); aLat: comfortable lateral accel.
const ring = (xs, r) => xs.map((x) => [x, r]);
export const KINDS = {
  sedan: { cls: 'car', len: 4.72, w: 1.8, front: 2.4, rear: 2.4, mass: 1500, a: 1.8, b: 2.2, T: 1.4, s0: 2.4, vmul: 1.0, aLat: 2.8, circles: ring([-1.35, 0, 1.35], 1.05) },
  suv: { cls: 'car', len: 4.78, w: 1.86, front: 2.4, rear: 2.4, mass: 2100, a: 1.6, b: 2.1, T: 1.5, s0: 2.5, vmul: 0.99, aLat: 2.5, circles: ring([-1.35, 0, 1.35], 1.1) },
  hatch: { cls: 'car', len: 4.05, w: 1.7, front: 2.05, rear: 2.05, mass: 1200, a: 1.9, b: 2.3, T: 1.3, s0: 2.3, vmul: 1.0, aLat: 2.8, circles: ring([-1.1, 1.1], 1.0) },
  van: { cls: 'car', len: 5.9, w: 1.96, front: 3.0, rear: 3.0, mass: 2600, a: 1.3, b: 2.0, T: 1.6, s0: 2.8, vmul: 0.95, aLat: 2.2, circles: ring([-2.0, -0.6, 0.8, 2.1], 1.1) },
  pickup: { cls: 'car', len: 5.9, w: 1.94, front: 3.0, rear: 3.0, mass: 2800, a: 1.5, b: 2.1, T: 1.5, s0: 2.7, vmul: 1.02, aLat: 2.4, circles: ring([-2.0, -0.6, 0.8, 2.1], 1.1) },
  rv: { cls: 'heavy', len: 8.4, w: 2.4, front: 4.2, rear: 4.2, mass: 6500, a: 0.9, b: 1.8, T: 1.9, s0: 3.5, vmul: 0.82, aLat: 1.8, circles: ring([-3.0, -1.0, 1.0, 3.0], 1.3) },
  bus: { cls: 'heavy', len: 12.2, w: 2.55, front: 6.1, rear: 6.1, mass: 14000, a: 0.9, b: 1.8, T: 1.8, s0: 4, vmul: 0.92, aLat: 1.8, circles: ring([-4.6, -2.3, 0, 2.3, 4.6], 1.35) },
  // articulated: the reference point is the middle of the drive tandem; the trailer is separate
  semi: { cls: 'heavy', len: 22.6, w: 2.6, front: 7.35, rear: 15.3, mass: 26000, a: 0.7, b: 1.5, T: 2.1, s0: 4, vmul: 0.9, aLat: 1.5, circles: ring([-1.2, 1.2, 3.4, 5.4, 7.0], 1.3), trailerCircles: ring([1.5, 4.5, 7.5, 10.5, 13.5, 15.4], 1.35) },
};
export const SEMI_HITCH = 0.15; // kingpin ahead of the drive tandem centre
export const SEMI_KING_TO_AXLE = 12.2;
export const KIND_NAMES = Object.keys(KINDS);

/** Per-driver parameters: `temper` ~ 0.85 (timid) … 1.2 (pushy) scales speed, headway and gap. */
export function driverParams(kind, temper = 1) {
  const k = typeof kind === 'string' ? KINDS[kind] : kind;
  return { a: k.a * (0.9 + 0.2 * temper), b: k.b, bMax: k.cls === 'heavy' ? 6.5 : 8.5, T: k.T / (0.7 + 0.3 * temper), s0: k.s0, v0: 0 };
}

// ── Road classes ──────────────────────────────────────────────────────────────
/** Typical free-flow speed (m/s) of a road class. */
export const CLASS_SPEED = { interstate: 33, highway: 28, county: 23, gravel: 14, dirt: 8 };
/** Vehicles per km used to weight where traffic appears. */
export const CLASS_DENSITY = { interstate: 9, highway: 5, county: 1.8, gravel: 0.35, dirt: 0.08 };
export const classSpeed = (cls) => CLASS_SPEED[cls] ?? 15;

/** Share of each vehicle kind by road class. */
export const SPAWN_MIX = {
  interstate: { sedan: 0.24, suv: 0.17, hatch: 0.04, pickup: 0.13, van: 0.05, rv: 0.03, bus: 0.02, semi: 0.32 },
  highway: { sedan: 0.27, suv: 0.2, hatch: 0.06, pickup: 0.18, van: 0.06, rv: 0.05, bus: 0.02, semi: 0.16 },
  county: { sedan: 0.24, suv: 0.2, hatch: 0.1, pickup: 0.3, van: 0.06, rv: 0.04, bus: 0.01, semi: 0.05 },
  gravel: { sedan: 0.05, suv: 0.25, hatch: 0.08, pickup: 0.52, van: 0.1 },
  dirt: { suv: 0.3, pickup: 0.7 },
};
export const TRAILER_MIX = { dryvan: 0.4, reefer: 0.2, flatbed: 0.12, tanker: 0.08, logs: 0.08, container: 0.12 };

export function pickWeighted(table, r) {
  let tot = 0;
  for (const k in table) tot += table[k];
  let x = r * tot;
  let last = null;
  for (const k in table) {
    last = k;
    x -= table[k];
    if (x <= 0) return k;
  }
  return last;
}

// ── Lanes ─────────────────────────────────────────────────────────────────────
/** Lane centre lines (m right of the centre line, inner lane first) for a road class and width. */
export function laneLats(cls, width) {
  if (cls === 'interstate') return [0.16 * width, 0.345 * width];
  if (cls === 'highway') return [0.22 * width];
  if (cls === 'county') return [0.22 * width];
  if (cls === 'gravel') return [0.2 * width];
  return [0.14 * width];
}
export const isMultiLane = (cls) => cls === 'interstate';

// ── Car following ─────────────────────────────────────────────────────────────
/**
 * Intelligent Driver Model acceleration. gap = bumper-to-bumper distance to the leader (use 1e9 for
 * none), vLead its speed along our direction (negative when it is oncoming), v0 the desired speed.
 */
export function idmAccel(p, v, gap, vLead, v0) {
  const vv = Math.max(0, v);
  const free = 1 - Math.pow(vv / Math.max(0.5, v0), 4);
  if (!(gap < 1e8)) return clamp(p.a * free, -p.bMax, p.a);
  const dv = vv - vLead;
  const sStar = p.s0 + Math.max(0, vv * p.T + (vv * dv) / (2 * Math.sqrt(p.a * p.b)));
  const g = Math.max(0.15, gap);
  return clamp(p.a * (free - (sStar / g) * (sStar / g)), -p.bMax, p.a);
}

/** Speed that lets us stop within `dist` metres of a target speed at comfortable braking b. */
export function approachLimit(vTarget, dist, b) {
  return Math.sqrt(vTarget * vTarget + 2 * b * Math.max(0, dist));
}

// ── Road geometry ─────────────────────────────────────────────────────────────
/** Curvature (1/m) at each sample of a uniformly resampled polyline. */
export function polylineCurvature(xs, zs, n, step) {
  const out = new Float32Array(n);
  if (n < 3) return out;
  const ang = new Float32Array(n - 1);
  for (let i = 0; i < n - 1; i++) ang[i] = Math.atan2(zs[i + 1] - zs[i], xs[i + 1] - xs[i]);
  for (let k = 0; k < n; k++) {
    const i0 = Math.max(0, k - 3), i1 = Math.min(n - 2, k + 2);
    out[k] = i1 > i0 ? Math.abs(wrapPi(ang[i1] - ang[i0])) / ((i1 - i0) * step) : 0;
  }
  return out;
}

/** Highest safe speed now, given curves in the next `look` metres (braking at b into each one). */
export function curveSpeedAhead(curv, step, s, dir, look, aLat, b, vFloor = 6) {
  const n = curv.length;
  let best = Infinity;
  for (let d = 0; d <= look; d += step) {
    const k = Math.round((s + dir * d) / step);
    if (k < 0 || k >= n) break;
    const kap = curv[k];
    if (kap < 1 / 1200) continue;
    const vc = Math.max(vFloor, Math.sqrt(aLat / kap));
    const lim = approachLimit(vc, d, b);
    if (lim < best) best = lim;
  }
  return best;
}

/** True when the road stays straighter than 1/kMax metres radius for `look` metres ahead. */
export function straightFor(curv, step, s, dir, look, kMax = 1 / 650) {
  const n = curv.length;
  for (let d = 0; d <= look; d += step) {
    const k = Math.round((s + dir * d) / step);
    if (k < 0 || k >= n) return false; // the road ends: not a place to pass
    if (curv[k] > kMax) return false;
  }
  return true;
}

// ── Lane changing and overtaking ──────────────────────────────────────────────
/** Gap acceptance for moving into a lane: neither we nor the new follower may need to brake hard. */
export function mergeSafe({ pSelf, pFollow = null, v, vAhead = 0, gapAhead = 1e9, vBehind = 0, gapBehind = 1e9, bSafe = 3.2 }) {
  if (gapAhead < pSelf.s0 + 0.35 * v || gapBehind < 4) return false;
  const aSelf = idmAccel(pSelf, v, gapAhead, vAhead, v + 4);
  if (aSelf < -bSafe) return false;
  const pf = pFollow || pSelf;
  const aFol = idmAccel(pf, vBehind, gapBehind, v, Math.max(vBehind, v) + 4);
  return aFol > -bSafe;
}

/** Does the driver want to pass? Held up by a slower leader for a while. */
export function wantsToPass({ v0, v, leadV, leadGap, followTime, minGain = 1.8, tMin = 1.5 }) {
  return leadGap < Math.max(42, v * 3.2) && leadV < v0 - minGain && v < v0 - 0.6 && followTime >= tMin;
}

/** How long a pass takes and how far we travel while doing it (out, alongside, back). */
export function passManeuver({ vLead, gap, lenLead, lenSelf, vPass, laneChangeT = 3, margin = 14 }) {
  const rel = Math.max(0.8, vPass - Math.max(0, vLead));
  const dRel = Math.max(0, gap) + lenLead + lenSelf + margin;
  const t = dRel / rel + laneChangeT * 1.4;
  return { t, dist: vPass * t, vPass };
}

/** Is the opposing lane free for a pass? oncoming: [{ gap, v }] (v = speed towards us). */
export function oncomingClear(man, oncoming, margin = 45) {
  for (const o of oncoming) if (o.gap < (man.vPass + Math.max(0, o.v)) * man.t + margin) return false;
  return true;
}

/**
 * Lane decision for one driver. Returns 'pass' | 'return' | 'none'.
 *  c.multi        road has two lanes per direction (keep right except to pass)
 *  c.inner        currently in the inner / opposing lane
 *  c.passing      we are in the middle of a pass (the slower vehicle is behind or beside)
 *  c.heavy        trucks, buses and RVs pass only with a big speed advantage
 *  c.lead         { gap, v, len } or null; c.followTime seconds spent held up
 *  c.target       { gapAhead, vAhead, gapBehind, vBehind } in the lane we would move to
 *  c.pSelf, c.v, c.v0
 *  c.oncoming     [{ gap, v }] (two-lane roads); c.straight  sight line is straight and clear of towns
 *  c.passedGap    gap (m) between our rear bumper and the passed vehicle's front, or Infinity
 *  c.idle         seconds since we were last held up
 */
export function laneDecision(c) {
  if (c.inner) {
    // finished the pass? move back when the passed vehicle is far enough behind and the lane is free
    if (c.passing) {
      if (c.passedGap < Math.max(9, 0.8 * c.v)) return 'none';
    } else if (c.idle < 6) return 'none';
    return mergeSafe({ pSelf: c.pSelf, v: c.v, ...c.target }) ? 'return' : 'none';
  }
  if (!c.lead) return 'none';
  const gain = c.heavy ? 4 : 1.8;
  if (!wantsToPass({ v0: c.v0, v: c.v, leadV: c.lead.v, leadGap: c.lead.gap, followTime: c.followTime, minGain: gain })) return 'none';
  if (c.multi) return mergeSafe({ pSelf: c.pSelf, v: c.v, ...c.target }) ? 'pass' : 'none';
  if (!c.straight) return 'none';
  const vPass = Math.min(c.v0 * 1.12, Math.max(c.lead.v + 7, c.v));
  const man = passManeuver({ vLead: c.lead.v, gap: c.lead.gap, lenLead: c.lead.len ?? 5, lenSelf: c.len ?? 5, vPass });
  return oncomingClear(man, c.oncoming || []) ? 'pass' : 'none';
}

// ── Articulation ──────────────────────────────────────────────────────────────
/** Advance the trailer heading: the trailer axle trails the kingpin (kinematic off-tracking). */
export function stepTrailer(thetaT, theta, v, dt, L = SEMI_KING_TO_AXLE) {
  const n = Math.max(1, Math.ceil((Math.abs(v) * dt) / L / 0.08));
  const h = dt / n;
  for (let i = 0; i < n; i++) thetaT += (v / L) * Math.sin(theta - thetaT) * h;
  return thetaT;
}

// ── Horn ──────────────────────────────────────────────────────────────────────
export const makeHonk = () => ({ wait: 0, tail: 0, cd: 0, count: 0 });

/**
 * Update a driver's horn state. Returns 0 (silent), 1 (tap) or 2 (long blast).
 * blocked: the player is stopped / crawling right in front of us; tailgated: the player is right
 * behind us at speed ({ gap, v }); both optional.
 */
export function honkStep(h, dt, { v, v0, blocked = null, tailgated = null }) {
  h.cd = Math.max(0, h.cd - dt);
  if (blocked && blocked.gap < 15 && blocked.v < 0.35 * v0 && v < 0.6 * v0) h.wait += dt;
  else {
    h.wait = 0;
    if (!blocked) h.count = 0;
  }
  const headway = tailgated ? tailgated.gap / Math.max(1, tailgated.v) : 9;
  if (tailgated && tailgated.v > 7 && headway < 0.55 && v > 7) h.tail += dt;
  else h.tail = Math.max(0, h.tail - dt * 2);
  if (h.cd > 0) return 0;
  if (h.wait > (blocked && blocked.v < 0.8 ? 3.2 : 6) && h.count < 3) {
    h.count++;
    h.cd = 4.5;
    return h.count >= 2 ? 2 : 1;
  }
  if (h.tail > 4) {
    h.tail = 0;
    h.cd = 20;
    return 1;
  }
  return 0;
}

// ── Collision ─────────────────────────────────────────────────────────────────
/** 1-D impact along the line of travel; restitution e. Speeds are signed along the same axis. */
export function collide1D(mA, uA, mB, uB, e = 0.2) {
  const M = mA + mB;
  return {
    vA: (mA * uA + mB * uB + mB * e * (uB - uA)) / M,
    vB: (mA * uA + mB * uB + mA * e * (uA - uB)) / M,
    closing: Math.abs(uA - uB),
  };
}

/** Damage points (0-100 scale of the truck's rig) from an impact against a vehicle of massOther. */
export function impactDamage(closing, massOther, massSelf, scale = 0.02) {
  const weight = clamp(Math.sqrt(massOther / Math.max(1, massSelf)) * 1.5, 0.3, 2.2);
  return closing * closing * scale * weight;
}
