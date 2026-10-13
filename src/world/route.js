// GPS routing over the generated road network (pure JS, no rendering). Settlements are graph nodes,
// roads between neighbouring settlements are edges (A*-routed geometry, built on demand). A route
// is a time-optimal node path turned into a dense polyline with turn-by-turn manoeuvres; inside a
// settlement the polyline follows Main Street / Center Ave between the ports and the centre.
import { S } from './gen.js';

// planning speeds (m/s) by road class
const SPEED = { interstate: 31, highway: 27, county: 22, gravel: 13, dirt: 8 };
const DIR4 = [[1, 0, 0, 'E'], [-1, 0, 0, 'W'], [0, 1, 1, 'S'], [0, -1, 1, 'N']]; // di, dj, edge dir, port letter

class Heap {
  constructor() {
    this.a = [];
  }

  push(k, v) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.a;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.a.length;
  }
}

const portOf = (n, letter) => ({ E: n.portE, W: n.portW, N: n.portN, S: n.portS })[letter];
const OPP = { E: 'W', W: 'E', N: 'S', S: 'N' };

/** Straight-ish edge length estimate (the real A* path is a bit longer). */
function edgeCost(W, i, j, dir) {
  const e = W.edges.get(`${i},${j},${dir}`);
  const cls = W.edgeClass(i, j, dir);
  if (e) return { len: e.len, time: e.len / (SPEED[cls] || 10), cls };
  const a = W.node(i, j), b = dir === 0 ? W.node(i + 1, j) : W.node(i, j + 1);
  const pa = dir === 0 ? a.portE : a.portS, pb = dir === 0 ? b.portW : b.portN;
  const len = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) * 1.16;
  return { len, time: len / (SPEED[cls] || 10), cls };
}

/**
 * Plan a route from a world position to a settlement node. Returns null when none exists within the
 * search budget. `start` = { x, z } (the van); the nearest built road edge decides where it joins.
 */
export function planRoute(W, start, dst, opts = {}) {
  const maxExp = opts.maxExpansions || 6000;
  // where does the van join the network?
  W.buildEdgesFor(start.x - 500, start.z - 500, start.x + 500, start.z + 500, Infinity);
  const q = W.roadAt(start.x, start.z);
  const seeds = []; // { node, cost, via }
  let join = null;
  if (q && q.d < q.edge.P.width / 2 + 60) {
    const e = q.edge, sv = e.ss[q.k] + q.t * (e.ss[q.k + 1] - e.ss[q.k]);
    const speed = SPEED[e.cls] || 10;
    seeds.push({ node: e.a, cost: sv / speed, edge: e, towardA: true, s: sv });
    seeds.push({ node: e.b, cost: (e.len - sv) / speed, edge: e, towardA: false, s: sv });
    join = { edge: e, s: sv, k: q.k, t: q.t };
  } else {
    for (const n of W.nodesNear(start.x, start.z, 3800)) seeds.push({ node: n, cost: (Math.hypot(n.x - start.x, n.z - start.z) * 1.35) / 9, edge: null });
  }
  if (!seeds.length) return null;
  const H = (n) => Math.hypot(n.x - dst.x, n.z - dst.z) / 31;
  const best = new Map(), prev = new Map();
  const heap = new Heap();
  for (const sd of seeds) {
    const k = sd.node.key;
    if (!best.has(k) || sd.cost < best.get(k)) {
      best.set(k, sd.cost);
      prev.set(k, { seed: sd });
      heap.push(sd.cost + H(sd.node), sd.node);
    }
  }
  let found = false, exp = 0;
  while (heap.size && exp++ < maxExp) {
    const [, n] = heap.pop();
    const c0 = best.get(n.key);
    if (n.key === dst.key) {
      found = true;
      break;
    }
    for (const [di, dj, dir, letter] of DIR4) {
      const ei = di < 0 || dj < 0 ? n.i + Math.min(0, di) : n.i, ej = di < 0 || dj < 0 ? n.j + Math.min(0, dj) : n.j;
      if (!W.edgeExists(ei, ej, dir)) continue;
      const m = W.node(n.i + di, n.j + dj);
      const { time } = edgeCost(W, ei, ej, dir);
      const c = c0 + time + 25; // settlements cost a little time to cross
      if (!best.has(m.key) || c < best.get(m.key) - 1e-6) {
        best.set(m.key, c);
        prev.set(m.key, { from: n, ei, ej, dir, letter });
        heap.push(c + H(m), m);
      }
    }
  }
  if (!found) return null;
  // walk back
  const hops = [];
  let cur = dst.key, seed = null;
  for (;;) {
    const p = prev.get(cur);
    if (p.seed) {
      seed = p.seed;
      break;
    }
    hops.push(p);
    cur = p.from.key;
  }
  hops.reverse();
  return new Route(W, start, dst, seed, hops, join, best.get(dst.key));
}

export class Route {
  constructor(W, start, dst, seed, hops, join, time) {
    this.W = W;
    this.dst = dst;
    this.time = time;
    this.xs = [start.x];
    this.zs = [start.z];
    this.ss = [0];
    this.maneuvers = [];
    // node list: walk the hops from the seed node
    const list = [seed.node];
    let cur = seed.node;
    for (const h of hops) {
      const a = W.node(h.ei, h.ej), b = h.dir === 0 ? W.node(h.ei + 1, h.ej) : W.node(h.ei, h.ej + 1);
      cur = cur.key === a.key ? b : a;
      list.push(cur);
    }
    this.nodes = list;
    this.seed = seed;
    this.hops = hops;
    this.join = join;
    this.stage = 0; // next hop to build
    this.started = false;
    this.done = false;
    this.start = start;
  }

  get length() {
    return this.ss[this.ss.length - 1];
  }

  push(x, z) {
    const n = this.xs.length - 1;
    const d = Math.hypot(x - this.xs[n], z - this.zs[n]);
    if (d < 0.5) return;
    this.xs.push(x);
    this.zs.push(z);
    this.ss.push(this.ss[n] + d);
  }

  /** Append the stretch of an edge between sample indexes (inclusive), in travel order. */
  pushEdge(e, k0, k1) {
    if (k0 <= k1) for (let k = k0; k <= k1; k++) this.push(e.xs[k], e.zs[k]);
    else for (let k = k0; k >= k1; k--) this.push(e.xs[k], e.zs[k]);
  }

  /** Build up to `count` more edges of the polyline; returns true when complete. */
  step(count = 2) {
    const W = this.W;
    if (this.done) return true;
    if (!this.started) {
      this.started = true;
      const sd = this.seed;
      if (sd.edge) {
        const e = sd.edge, k = this.join.k;
        if (sd.towardA) this.pushEdge(e, k, 0);
        else this.pushEdge(e, k + 1, e.n - 1);
      } else {
        const n = sd.node;
        this.push(n.x, n.z);
      }
      this.enterNode = sd.edge ? (sd.towardA ? this.exitLetter(sd.edge, true) : this.exitLetter(sd.edge, false)) : null;
    }
    for (let c = 0; c < count && this.stage <= this.hops.length; c++) {
      const idx = this.stage++;
      const node = this.nodes[idx];
      const next = this.hops[idx];
      const inLetter = this.enterNode;
      if (next) {
        const e = W.edge(next.ei, next.ej, next.dir);
        const aFirst = e.a.key === node.key;
        const outLetter = aFirst ? (next.dir === 0 ? 'E' : 'S') : next.dir === 0 ? 'W' : 'N';
        this.transit(node, inLetter, outLetter, e.name);
        if (aFirst) this.pushEdge(e, 0, e.n - 1);
        else this.pushEdge(e, e.n - 1, 0);
        this.enterNode = aFirst ? (next.dir === 0 ? 'W' : 'N') : next.dir === 0 ? 'E' : 'S';
        this.edgeName = e.name;
      } else {
        this.transit(node, inLetter, null, null);
        this.done = true;
      }
    }
    if (this.stage > this.hops.length) this.done = true;
    return this.done;
  }

  /** Port letter of the node the edge leaves from / arrives at when travelling toward a (true) or b. */
  exitLetter(e, towardA) {
    // we arrive at the end node by its own port: edge a→b runs a.E/S → b.W/N
    if (towardA) return e.dir === 0 ? 'E' : 'S';
    return e.dir === 0 ? 'W' : 'N';
  }

  /** Cross a settlement: port in → centre → port out (or stop at the centre when arriving). */
  transit(node, inLetter, outLetter, nextRoad) {
    const c = [node.x, node.z];
    const pIn = inLetter ? portOf(node, inLetter) : null;
    const pOut = outLetter ? portOf(node, outLetter) : null;
    const through = node.kind !== 'junction';
    if (pIn) this.push(pIn[0], pIn[1]);
    const enterS = this.length;
    if (through) this.push(c[0], c[1]);
    else if (pOut && pIn) this.push(c[0], c[1]);
    const centreS = this.length;
    if (pOut) this.push(pOut[0], pOut[1]);
    const name = node.name || 'the junction';
    if (!outLetter) {
      this.maneuvers.push({ s: centreS, kind: 'arrive', text: `Arrive in ${name}`, node });
      return;
    }
    const turn = inLetter && OPP[inLetter] !== outLetter ? this.turnDir(inLetter, outLetter) : null;
    const road = nextRoad || '';
    if (node.kind !== 'junction') this.maneuvers.push({ s: enterS, kind: 'enter', text: `Entering ${name}`, node });
    if (!inLetter) this.maneuvers.push({ s: 0, kind: 'depart', text: `Head ${this.compass(outLetter)} on ${road}`, node });
    else if (turn) this.maneuvers.push({ s: centreS, kind: turn, text: `Turn ${turn} onto ${road}`, node, road });
    else this.maneuvers.push({ s: centreS, kind: 'straight', text: `Continue on ${road}`, node, road });
  }

  compass(letter) {
    return { E: 'east', W: 'west', N: 'north', S: 'south' }[letter];
  }

  /** Left/right when entering through inLetter and leaving by outLetter (x east, z south). */
  turnDir(inLetter, outLetter) {
    const v = { E: [-1, 0], W: [1, 0], N: [0, 1], S: [0, -1] }; // travel direction after entering through that port
    const a = v[inLetter], b = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] }[outLetter];
    const right = [-a[1], a[0]];
    const d = b[0] * right[0] + b[1] * right[1];
    return d > 0 ? 'right' : 'left';
  }

  /** Build the whole polyline now. */
  build() {
    while (!this.step(8));
    return this;
  }

  /**
   * Progress of a point along the route: { s, d (distance off the route), i }. `from` is the last
   * vertex index (search window), so it stays cheap and never jumps across loops.
   */
  locate(x, z, from = 0) {
    const n = this.xs.length;
    let best = 1e18, bi = from;
    const lo = Math.max(0, from - 40), hi = Math.min(n - 2, from + 260);
    for (let i = lo; i <= hi; i++) {
      const ax = this.xs[i], az = this.zs[i], dx = this.xs[i + 1] - ax, dz = this.zs[i + 1] - az;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t - x, pz = az + dz * t - z, d2 = px * px + pz * pz;
      if (d2 < best) {
        best = d2;
        bi = i;
        this._t = t;
      }
    }
    const s = this.ss[bi] + (this.ss[bi + 1] - this.ss[bi]) * this._t;
    return { s, d: Math.sqrt(best), i: bi };
  }

  /** Next manoeuvre ahead of progress s. */
  nextManeuver(s) {
    for (const m of this.maneuvers) if (m.s > s - 4) return m;
    return null;
  }
}

/** Great-circle-free "as the crow flies" bearing helper for waypoints (x east, z south). */
export function bearing(x0, z0, x1, z1) {
  return Math.atan2(-(z1 - z0), x1 - x0);
}

export { S as GRID };
