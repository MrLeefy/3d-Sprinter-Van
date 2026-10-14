// Junction logic for AI traffic (pure, no rendering). Every settlement node has up to four road ports
// (east, north, west, south). A vehicle that reaches the end of a road drives on through the node
// along a *connector*: a short polyline from the port it entered to the port it leaves by, straight
// along the main street or rounded through a corner. This module builds those paths, decides which
// exits are allowed and likely, tells which movements cross each other, and who gives way.
//
// Conventions: x east, z south. Port positions come from the world generator: portE (x+Rp, z),
// portW (x−Rp, z), portN (x, z−Rz), portS (x, z+Rz). A vehicle "entering from side E" arrives at the
// east port heading west. Right-hand traffic.

export const SIDES = ['E', 'N', 'W', 'S'];
const OUT = { E: [1, 0], N: [0, -1], W: [-1, 0], S: [0, 1] }; // outward from the centre through the port

export const opposite = (s) => SIDES[(SIDES.indexOf(s) + 2) % 4];
export const outward = (s) => OUT[s];

export function portPoint(node, side) {
  switch (side) {
    case 'E': return [node.x + node.Rp, node.z];
    case 'W': return [node.x - node.Rp, node.z];
    case 'N': return [node.x, node.z - node.Rz];
    default: return [node.x, node.z + node.Rz];
  }
}

/** How a vehicle that enters by `inSide` and leaves by `outSide` moves: straight, left, right or uturn. */
export function turnOf(inSide, outSide) {
  if (inSide === outSide) return 'uturn';
  const d = (SIDES.indexOf(outSide) - SIDES.indexOf(inSide) + 4) % 4; // CCW steps from the entry side
  // entering from E (heading west): N is to the right, S to the left, W straight
  return d === 2 ? 'straight' : d === 1 ? 'right' : 'left';
}

/** Which connectors a settlement has at all: towns and junctions are fully connected, a truck stop or campground only has its main street. */
export function transitAllowed(kind, inSide, outSide) {
  if (inSide === outSide) return false;
  if (kind === 'farm' || kind === 'lodge') return false;
  if (kind === 'truckstop' || kind === 'camp') return (inSide === 'E' || inSide === 'W') && (outSide === 'E' || outSide === 'W');
  return true;
}

/** Relative likelihood of each movement. */
export function turnWeight(kind, turn) {
  if (kind === 'junction') return { straight: 0.62, left: 0.19, right: 0.19 }[turn] ?? 0;
  if (kind === 'city' || kind === 'town') return { straight: 0.5, left: 0.25, right: 0.25 }[turn] ?? 0;
  return { straight: 0.72, left: 0.14, right: 0.14 }[turn] ?? 0;
}

/**
 * Pick an exit among the candidates [{ side, weight }] with r in [0, 1). Returns the side or null.
 */
export function pickExit(cands, r) {
  let tot = 0;
  for (const c of cands) tot += c.weight;
  if (tot <= 0) return null;
  let x = r * tot;
  for (const c of cands) {
    x -= c.weight;
    if (x <= 0) return c.side;
  }
  return cands[cands.length - 1].side;
}

/**
 * Centre line of a connector as a uniformly resampled polyline { xs, zs, len, n }. Straight movements
 * run port to port through the centre; turns follow the two street axes and round the corner with a
 * circular fillet of radius `rf` (limited so it fits inside the node). `div` is how far a turn runs
 * along the street it shares with the other movements from the same port before it leaves it.
 */
export function connectorPath(node, inSide, outSide, step = 3, rf = 12, pre = null, post = null) {
  const pin = portPoint(node, inSide), pout = portPoint(node, outSide);
  const C = [node.x, node.z];
  const pts = [pin];
  const turn = turnOf(inSide, outSide);
  let div = Infinity; // path length at which a turn leaves the shared straight street
  if (turn !== 'straight') {
    const lin = Math.hypot(pin[0] - C[0], pin[1] - C[1]), lout = Math.hypot(pout[0] - C[0], pout[1] - C[1]);
    const r = Math.max(2, Math.min(rf, 0.8 * Math.min(lin, lout)));
    const A = [C[0] + ((pin[0] - C[0]) / lin) * r, C[1] + ((pin[1] - C[1]) / lin) * r];
    const B = [C[0] + ((pout[0] - C[0]) / lout) * r, C[1] + ((pout[1] - C[1]) / lout) * r];
    const O = [A[0] + B[0] - C[0], A[1] + B[1] - C[1]]; // fillet centre
    div = Math.hypot(A[0] - pin[0], A[1] - pin[1]);
    pts.push(A);
    const a0 = Math.atan2(A[1] - O[1], A[0] - O[0]);
    let da = Math.atan2(B[1] - O[1], B[0] - O[0]) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const k = Math.max(6, Math.ceil((Math.abs(da) * r) / 1.2));
    for (let i = 1; i < k; i++) {
      const a = a0 + (da * i) / k;
      pts.push([O[0] + Math.cos(a) * r, O[1] + Math.sin(a) * r]);
    }
    pts.push(B);
  }
  pts.push(pout);
  let path = resample(pts, 1.5);
  // the real roads meet a port at some angle: start on the road a little before the port, tangent to it,
  // and blend into the street axis (likewise at the far end)
  if (pre || post) path = blendEnds(path, pre, post);
  const out = resample(zip(path), step);
  // a path that starts before the port is longer than the nominal one: report the turn point along it
  return { ...out, div: div + (pre ? Math.hypot(pre.p[0] - pin[0], pre.p[1] - pin[1]) : 0) };
}

const zip = (p) => Array.from(p.xs, (x, k) => [x, p.zs[k]]);

/**
 * Join the street-axis path to the real roads. `pre` = { p, t }: a point on the arriving road and its
 * heading; `post` likewise on the leaving road. A cubic Hermite curve runs from each such point into the
 * axis path (about `L` m in), leaving the middle of the path on the axis.
 */
function blendEnds(path, pre, post) {
  const pts = zip(path), n = pts.length;
  const L = Math.min(26, path.len * 0.45);
  const kL = Math.max(1, Math.round(L / (path.len / (n - 1))));
  const out = [];
  const hermite = (p0, m0, p1, m1, t) => {
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    return [h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0], h00 * p0[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1]];
  };
  const dirAt = (k) => {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  if (pre) {
    const p0 = pre.p, p1 = pts[kL], d1 = dirAt(kL), chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const m = 12;
    for (let i = 0; i < m; i++) out.push(hermite(p0, [pre.t[0] * chord, pre.t[1] * chord], p1, [d1[0] * chord, d1[1] * chord], i / m));
  } else for (let i = 0; i < kL; i++) out.push(pts[i]);
  for (let i = kL; i <= n - 1 - kL; i++) out.push(pts[i]);
  if (post) {
    const p0 = pts[n - 1 - kL], p1 = post.p, d0 = dirAt(n - 1 - kL), chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const m = 12;
    for (let i = 1; i <= m; i++) out.push(hermite(p0, [d0[0] * chord, d0[1] * chord], p1, [post.t[0] * chord, post.t[1] * chord], i / m));
  } else for (let i = n - kL; i < n; i++) out.push(pts[i]);
  return resample(out, 1.5);
}

/** Uniform arc-length resampling of a polyline (at least two points). */
export function resample(pts, step) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const len = cum[cum.length - 1];
  const n = Math.max(2, Math.round(len / step) + 1);
  const xs = new Float64Array(n), zs = new Float64Array(n);
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = (len * k) / (n - 1);
    while (seg < pts.length - 2 && cum[seg + 1] < s) seg++;
    const t = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    xs[k] = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t;
    zs[k] = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t;
  }
  return { xs, zs, len, n };
}

/**
 * Do two movements through the same node cross? Only the stretch near the centre counts (within
 * `zone` metres) and the lane offsets are included, so opposing straights in their own lanes pass
 * each other while a left turn cuts across the oncoming lane. Movements that leave by the same
 * port merge into one lane and count as crossing too.
 */
export function movementsConflict(a, b, node, lane = 3.2, zone = 34, gap = 3.4) {
  if (a.inSide === b.inSide) return false; // they diverge from the same entry
  const pa = lanePoints(a, node, lane, zone), pb = lanePoints(b, node, lane, zone);
  for (const p of pa) for (const q of pb) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < gap) return true;
  return false;
}

/** Points of a connector's right-hand lane within `zone` metres of the node centre. */
function lanePoints(c, node, lane, zone) {
  const { xs, zs, n } = c.path;
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    const tx = xs[b] - xs[a], tz = zs[b] - zs[a], l = Math.hypot(tx, tz) || 1;
    const x = xs[k] + (-tz / l) * lane, z = zs[k] + (tx / l) * lane; // right of travel
    if (Math.hypot(x - node.x, z - node.z) < zone) out.push([x, z]);
  }
  return out;
}

/** Road-class priority at a junction: the bigger road goes first. */
export const CLASS_RANK = { interstate: 5, highway: 4, county: 3, gravel: 2, dirt: 1, street: 2 };
export const classRank = (cls) => CLASS_RANK[cls] ?? 2;

/**
 * Must `me` give way to `other`, a vehicle on a crossing movement? Each is { rank, eta (s to the node),
 * id, holds (already inside the junction) }. A vehicle already inside always has the right of way;
 * otherwise the bigger road, then whoever arrives first (with the id as the tie-break so that exactly
 * one of two vehicles gives way).
 */
export function mustYield(me, other, horizon = 6) {
  // Emergency vehicle priority: non-emergency vehicles yield unconditionally to emergency vehicles
  const meEmerg = Boolean(me.isEmergency);
  const otherEmerg = Boolean(other.isEmergency);
  if (otherEmerg && !meEmerg) return true;
  if (meEmerg && !otherEmerg) return false;

  // A vehicle actively moving inside the junction has right-of-way,
  // unless it is stalled/deadlocked (other.waitT > 6.0)
  if (other.holds && (other.waitT ?? 0) <= 6.0) return true;
  if (me.holds && (me.waitT ?? 0) <= 6.0) return false;

  // Anti-deadlock priority breaker: if waitT > 6.0s, grant priority to longest-waiting vehicle
  const meWait = me.waitT ?? 0, otherWait = other.waitT ?? 0;
  if (meWait > 6.0 || otherWait > 6.0) {
    if (meWait > 6.0 && meWait >= otherWait) return false;
    if (otherWait > 6.0 && otherWait > meWait) return true;
  }

  if (other.holds) return true;
  if (me.holds) return false;
  if (other.eta > horizon) return false;
  if (other.rank !== me.rank) return other.rank > me.rank;
  if (Math.abs(other.eta - me.eta) < 0.4) return other.id < me.id;
  return other.eta < me.eta;
}

// ── Traffic signals ───────────────────────────────────────────────────────────
/**
 * Deterministic 3-phase traffic signal controller for town intersections.
 * Cycle: Green 20s, Yellow 4s, Red 24s. Total cycle length = 48s.
 * Axis 'X' runs Green [0..20), Yellow [20..24), Red [24..48).
 * Axis 'Z' runs Red [0..24), Green [24..44), Yellow [44..48).
 *
 * @param {object|null} node - settlement node object
 * @param {number} ix - intersection x coordinate (meters)
 * @param {number} iz - intersection z coordinate (meters)
 * @param {number} time - simulation time in seconds
 * @param {string} axis - 'X' (East-West) or 'Z' (North-South)
 * @returns {{ phase: 'green' | 'yellow' | 'red', code: 0 | 1 | 2, timeRemaining: number, cycle: number }}
 */
export function trafficSignalPhase(node, ix, iz, time, axis = 'X') {
  const ax = String(axis || 'X').toUpperCase();
  const t = ((time % 48) + 48) % 48;
  if (ax === 'Z') {
    if (t < 24) {
      return { phase: 'red', code: 2, timeRemaining: 24 - t, cycle: 48 };
    } else if (t < 44) {
      return { phase: 'green', code: 0, timeRemaining: 44 - t, cycle: 48 };
    } else {
      return { phase: 'yellow', code: 1, timeRemaining: 48 - t, cycle: 48 };
    }
  } else {
    if (t < 20) {
      return { phase: 'green', code: 0, timeRemaining: 20 - t, cycle: 48 };
    } else if (t < 24) {
      return { phase: 'yellow', code: 1, timeRemaining: 24 - t, cycle: 48 };
    } else {
      return { phase: 'red', code: 2, timeRemaining: 48 - t, cycle: 48 };
    }
  }
}

/**
 * Helper query: returns an array of all traffic signal states in a town settlement node.
 */
export function intersectionSignals(node, time) {
  if (!node) return [];
  const signals = [];
  if (node.layout?.props?.misc) {
    for (const p of node.layout.props.misc) {
      if (p[3] === 'signal') {
        const x = p[0], z = p[1], rot = p[2];
        const alongX = Math.abs(Math.sin(rot)) < 0.5;
        const axis = alongX ? 'X' : 'Z';
        signals.push({ x, z, rot, axis, ...trafficSignalPhase(node, x, z, time, axis) });
      }
    }
  }
  if (signals.length === 0 && (node.kind === 'town' || node.kind === 'city' || node.signalized)) {
    signals.push(
      { x: node.x ?? 0, z: node.z ?? 0, axis: 'X', ...trafficSignalPhase(node, node.x ?? 0, node.z ?? 0, time, 'X') },
      { x: node.x ?? 0, z: node.z ?? 0, axis: 'Z', ...trafficSignalPhase(node, node.x ?? 0, node.z ?? 0, time, 'Z') }
    );
  }
  return signals;
}

