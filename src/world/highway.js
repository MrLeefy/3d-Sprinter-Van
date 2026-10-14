// Highway furnishing planner (pure JS, deterministic, no three.js): which stretches of an interstate or
// highway edge carry a rest area, weigh station, runaway-truck ramp or a (simplified) interchange with
// its auxiliary lanes and overpass, where the mile posts and warning signs stand, and where a guardrail
// is needed. The world generator stores the lots on each built edge so the heightfield, the road
// surface query and the renderer all agree; the roadside module reads the same plan to dress it.
import { hash2, hashStr, smoothstep, clamp } from './noise.js';

export const MILE = 1609.344;
export const MARGIN = 520; // keep clear of the settlement ends of an edge (m)

/** Posted limits (km/h) by road class: the same table the Driver applies. */
export const LIMIT_KMH = { interstate: 129, highway: 105, county: 89, gravel: 56, dirt: 32 };
export const kmhToMph = (k) => Math.round(k / 1.609344);
/** Speed limit sign value (mph) for a road class. */
export const limitMph = (cls) => (LIMIT_KMH[cls] ? kmhToMph(LIMIT_KMH[cls]) : null);

/** Extra paved shoulder outside the painted half-width (m). Lane lines and edge lines stay where they are. */
export const SHOULDER = { interstate: 1.8, highway: 1.0, county: 0, gravel: 0, dirt: 0 };
/** Full half-width of the carriageway including paved shoulders. */
export const halfWidth = (cls, width) => width / 2 + (SHOULDER[cls] || 0);

/** Lot specs: width beyond the shoulder, full-width body length, taper length. */
export const LOT = {
  rest: { w: 20, body: 120, taper: 70, cls: 'lot' },
  weigh: { w: 12, body: 150, taper: 80, cls: 'lot' },
  aux: { w: 3.6, body: 220, taper: 95, cls: 'lot' },
  runaway: { w: 6, body: 180, taper: 45, cls: 'gravel' },
};

const mod = (a, n) => ((a % n) + n) % n;

/** Mile number at a world position: E-W roads count eastward, N-S roads northward (z grows south). */
export function mileAt(dir, x, z) {
  return mod(Math.floor((dir === 0 ? x : -z) / MILE), 900) + 1;
}

/** Mile posts of an edge: [{ s, mile }] where the road crosses whole-mile lines of its axis, once per mile number. */
export function mileMarkers(e) {
  const out = [], seen = new Set();
  const ax = e.dir === 0 ? e.xs : e.zs, sign = e.dir === 0 ? 1 : -1;
  for (let k = 0; k < e.n - 1; k++) {
    const a = (sign * ax[k]) / MILE, b = (sign * ax[k + 1]) / MILE;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (let m = Math.ceil(lo); m <= Math.floor(hi) && m <= hi; m++) {
      if (a === b) continue;
      const t = (m - a) / (b - a);
      const s = e.ss[k] + (e.ss[k + 1] - e.ss[k]) * t;
      const mile = mod(m, 900) + 1;
      if (s < 80 || s > e.len - 80 || seen.has(mile)) continue;
      seen.add(mile);
      out.push({ s, mile });
    }
  }
  return out.sort((p, q) => p.s - q.s);
}

/** Width multiplier (0..1) of a lot occupying [s0, s1] with tapered ends. */
export function taperAt(s, s0, s1, taper) {
  if (s <= s0 || s >= s1) return 0;
  const t = Math.min(taper, (s1 - s0) / 2);
  return smoothstep(s0, s0 + t, s) * smoothstep(s1, s1 - t, s);
}

/** Width (m, beyond the shoulder) of the lots on one side (+1 right of +s, -1 left) at arc length s. */
export function lotWidthAt(lots, side, s) {
  let w = 0;
  for (const l of lots) if (l.side === side && s > l.s0 && s < l.s1) w = Math.max(w, l.w * taperAt(s, l.s0, l.s1, l.taper));
  return w;
}

/** The lot covering s on a side, or null. */
export function lotAt(lots, side, s) {
  for (const l of lots) if (l.side === side && s > l.s0 && s < l.s1) return l;
  return null;
}

/** Per-sample lot widths for an edge: { R, L } Float32Arrays (null when there are no lots). */
export function lotArrays(lots, ss, n) {
  if (!lots.length) return null;
  const R = new Float32Array(n), L = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    R[k] = lotWidthAt(lots, 1, ss[k]);
    L[k] = lotWidthAt(lots, -1, ss[k]);
  }
  return { R, L };
}

/**
 * A runaway-truck ramp site: a sustained descent of at least `minGrade` over `win` metres. Returns
 * { s, dir, grade, sTop } (s = where the ramp sits, near the bottom of the descent; dir = +1 when
 * traffic moving along +s is the one going downhill) or null.
 */
export function runawaySite(hs, ss, minGrade = 0.034, win = 650) {
  const n = hs.length, len = ss[n - 1];
  let best = null;
  const at = (s) => {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ss[m] <= s) lo = m;
      else hi = m;
    }
    const t = (s - ss[lo]) / Math.max(1e-9, ss[hi] - ss[lo]);
    return hs[lo] + (hs[hi] - hs[lo]) * clamp(t, 0, 1);
  };
  for (let s = MARGIN + 150; s + win < len - MARGIN - 100; s += 40) {
    const g = (at(s) - at(s + win)) / win; // positive: downhill toward +s
    if (Math.abs(g) >= minGrade && (!best || Math.abs(g) > Math.abs(best.grade))) best = { grade: g, sTop: g > 0 ? s : s + win, s: g > 0 ? s + win * 0.82 : s + win * 0.18, dir: g > 0 ? 1 : -1 };
  }
  return best;
}

/**
 * Plan the lots, interchange overpasses and signs of one interstate/highway edge. `e` needs
 * { id, cls, dir, len, n, hs, ss }. Everything is a pure function of the edge, so it is stable.
 * Returns { lots, overpasses, runaway } with lots = [{ kind, side, s0, s1, w, taper, face, ... }].
 */
export function planHighway(e) {
  const out = { lots: [], overpasses: [], runaway: null, bridges: e.bridges || [] };
  if (e.cls !== 'interstate' && e.cls !== 'highway') return out;
  const big = e.cls === 'interstate';
  const key = hashStr(e.id);
  const h = (k) => hash2(key, k, 5100);
  const taken = []; // [s0, s1]
  const free = (a, b) => taken.every(([c, d]) => b + 150 < c || a - 150 > d);
  const lo = MARGIN + 150, hi = e.len - MARGIN - 150;
  const reserve = (a, b) => taken.push([a, b]);
  const fits = (len) => hi - lo > len;
  const slot = (len, salt) => {
    // try five anchor fractions in a hash-rotated order
    const order = [0.5, 0.25, 0.75, 0.38, 0.62, 0.15, 0.85];
    const r = Math.floor(h(salt) * order.length);
    for (let i = 0; i < order.length; i++) {
      const f = order[(i + r) % order.length];
      const c = lo + (hi - lo) * f;
      const a = clamp(c - len / 2, lo, hi - len), b = a + len;
      if (b <= hi && a >= lo && free(a, b)) return [a, b];
    }
    return null;
  };
  const span = (k) => LOT[k].body + 2 * LOT[k].taper;

  const ra = runawaySite(e.hs, e.ss);
  if (ra && fits(span('runaway') + 200)) {
    const L = span('runaway');
    const a = clamp(ra.s - L / 2, lo, hi - L), b = a + L;
    const side = ra.dir > 0 ? 1 : -1; // right of the descending direction of travel
    out.lots.push({ kind: 'runaway', side, s0: a, s1: b, w: LOT.runaway.w, taper: LOT.runaway.taper, face: ra.dir, grade: Math.abs(ra.grade) });
    out.runaway = { ...ra, s0: a, s1: b, side };
    reserve(a, b);
  }
  if (fits(span('aux') + 350) && h(1) < (big ? 0.6 : 0.3)) {
    const L = span('aux');
    const sl = slot(L + 200, 2);
    if (sl) {
      const c = (sl[0] + sl[1]) / 2;
      for (const side of [1, -1]) out.lots.push({ kind: 'aux', side, s0: c - L / 2, s1: c + L / 2, w: LOT.aux.w, taper: LOT.aux.taper, face: side });
      out.overpasses.push({ s: c, exit: true, local: Math.floor(h(3) * 4) });
      reserve(c - L / 2 - 250, c + L / 2 + 250);
    }
  }
  if (fits(span('rest') + 250) && h(4) < (big ? 0.45 : 0.18)) {
    const L = span('rest');
    const sl = slot(L, 5);
    if (sl) {
      const side = h(6) < 0.5 ? 1 : -1;
      out.lots.push({ kind: 'rest', side, s0: sl[0], s1: sl[1], w: LOT.rest.w, taper: LOT.rest.taper, face: side });
      reserve(sl[0] - 200, sl[1] + 200);
    }
  }
  if (big && fits(span('weigh') + 250) && h(7) < 0.4) {
    const L = span('weigh');
    const sl = slot(L, 8);
    if (sl) {
      const side = h(9) < 0.5 ? 1 : -1;
      out.lots.push({ kind: 'weigh', side, s0: sl[0], s1: sl[1], w: LOT.weigh.w, taper: LOT.weigh.taper, face: side });
      reserve(sl[0] - 200, sl[1] + 200);
    }
  }
  out.lots.sort((a, b) => a.s0 - b.s0);
  return out;
}

/**
 * Advance warning signs for a plan: [{ s, side, face, kind, text, ... }]. A sign serves the traffic
 * moving along +s (face +1, placed before the feature, on the right) or along -s (face -1, after it).
 */
export function advanceSigns(e, plan) {
  const out = [];
  const before = (lot, d) => (lot.face > 0 ? lot.s0 - d : lot.s1 + d);
  for (const l of plan.lots) {
    if (l.kind === 'aux') continue;
    const name = { rest: 'REST AREA', weigh: 'WEIGH STATION\nALL TRUCKS', runaway: 'RUNAWAY\nTRUCK RAMP' }[l.kind];
    for (const [d, dist] of [[1700, '1 MILE'], [600, 'NEXT RIGHT'], [20, null]]) {
      const s = before(l, d);
      if (s < 60 || s > e.len - 60) continue;
      out.push({ s, side: l.side, face: l.face, kind: l.kind, text: dist ? `${name.split('\n')[0]}\n${dist}` : name.replace('\n', ' '), dist: d });
    }
    if (l.kind === 'runaway') {
      const s = before(l, 3200);
      if (s > 60 && s < e.len - 60) out.push({ s, side: l.side, face: l.face, kind: 'grade', text: `STEEP GRADE\n${Math.max(4, Math.round(l.grade * 100 + 1))}% NEXT 2 MI`, dist: 3200 });
    }
  }
  return out;
}

/** Wildlife / livestock warning sign sites on any road (0-2 per edge): [{ s, side, kind }]. */
export function wildlifeSigns(e) {
  if (e.cls === 'dirt' || e.len < 1400) return [];
  const key = hashStr(e.id);
  const h = (k) => hash2(key, k, 5200);
  const count = h(1) < 0.55 ? (h(2) < 0.35 ? 2 : 1) : 0;
  const kinds = ['DEER', 'DEER', 'ELK', 'CATTLE', 'MOOSE'];
  const out = [];
  for (let q = 0; q < count; q++) {
    const s = e.len * (0.2 + 0.6 * ((q + h(3 + q)) / Math.max(1, count)));
    const face = h(6 + q) < 0.5 ? 1 : -1;
    out.push({ s, side: face, face, kind: kinds[Math.floor(h(9 + q) * kinds.length)] });
  }
  return out;
}

/**
 * Guardrail spans from per-sample "needs a rail" flags (an embankment drops away beside the road).
 * Short gaps are bridged and short runs dropped; blocked samples (a lot, an overpass) cut a span.
 * Returns [[i0, i1]] inclusive sample index ranges.
 */
export function guardSpans(need, blocked = null, minRun = 4, maxGap = 3) {
  const spans = [];
  let a = -1, last = -1;
  const flush = () => {
    if (a >= 0 && last - a + 1 >= minRun) spans.push([a, last]);
    a = -1;
  };
  for (let i = 0; i < need.length; i++) {
    if (blocked && blocked[i]) {
      flush();
      continue;
    }
    if (!need[i]) continue;
    if (a >= 0 && i - last - 1 > maxGap) flush();
    if (a < 0) a = i;
    last = i;
  }
  flush();
  return spans;
}

/** Exit label for an interchange: the nearer end settlement, or a local road. */
export function exitLabel(e, ov) {
  const near = ov.s < e.len / 2 ? e.a : e.b;
  const far = ov.s < e.len / 2 ? e.b : e.a;
  const pick = near.name && near.kind !== 'junction' ? near : far.name && far.kind !== 'junction' ? far : null;
  return pick ? pick.name : ['County Rd', 'Ranch Rd', 'Mill Rd', 'Frontage Rd'][ov.local % 4];
}

/**
 * Detect procedural bridges and culverts crossing terrain depressions.
 * Bridges: elevation diff (e.hs[k] - baseHeight > 3.8m) over span >= 24m.
 * Culverts: elevation diff (1.5m to 3.5m) over span 10m to 24m.
 * Returns [{ s0, s1, kind: 'bridge' | 'culvert', clearance, height }]
 */
export function scanBridges(e, baseHeights, world) {
  if (!baseHeights || !e || !e.hs || !e.ss || e.n < 2) return [];
  const n = e.n;
  const bridges = [];
  const minBridgeDiff = 3.8;
  const minCulvertDiff = 1.5;
  const maxCulvertDiff = 3.8;

  let inRun = false;
  let kStart = 0;

  for (let k = 0; k < n; k++) {
    const diff = e.hs[k] - baseHeights[k];
    if (diff >= minCulvertDiff) {
      if (!inRun) {
        inRun = true;
        kStart = k;
      }
    } else {
      if (inRun) {
        inRun = false;
        processRun(kStart, k - 1);
      }
    }
  }
  if (inRun) {
    processRun(kStart, n - 1);
  }

  function processRun(k0, k1) {
    const s0 = e.ss[k0];
    const s1 = e.ss[k1];
    if (s0 < 30 || s1 > e.len - 30) return;

    let maxDiff = 0;
    let maxH = -Infinity;
    for (let k = k0; k <= k1; k++) {
      const d = e.hs[k] - baseHeights[k];
      if (d > maxDiff) maxDiff = d;
      if (e.hs[k] > maxH) maxH = e.hs[k];
    }

    if (maxDiff > minBridgeDiff) {
      let b0 = k0, b1 = k1;
      while (b0 <= k1 && (e.hs[b0] - baseHeights[b0]) < minBridgeDiff) b0++;
      while (b1 >= k0 && (e.hs[b1] - baseHeights[b1]) < minBridgeDiff) b1--;
      if (b0 <= b1) {
        const span = e.ss[b1] - e.ss[b0];
        if (span >= 24) {
          // Verify terrain beside bridge drops (ravine check)
          if (world && world.baseHeight && b0 > 0 && b0 < n - 1) {
            const dx = e.xs[b0 + 1] - e.xs[b0 - 1];
            const dz = e.zs[b0 + 1] - e.zs[b0 - 1];
            const l = Math.hypot(dx, dz);
            if (l > 1e-4) {
              const nx = -dz / l, nz = dx / l;
              const sideH = world.baseHeight(e.xs[b0] + nx * 25, e.zs[b0] + nz * 25);
              if (sideH >= e.hs[b0]) return;
            }
          }
          bridges.push({
            s0: e.ss[b0],
            s1: e.ss[b1],
            kind: 'bridge',
            clearance: Math.round(maxDiff * 10) / 10,
            height: Math.round(maxH * 10) / 10,
          });
          return;
        }
      }
    }

    const span = s1 - s0;
    if (span >= 10 && span <= 24 && maxDiff >= minCulvertDiff && maxDiff <= maxCulvertDiff) {
      bridges.push({
        s0: e.ss[k0],
        s1: e.ss[k1],
        kind: 'culvert',
        clearance: Math.round(maxDiff * 10) / 10,
        height: Math.round(maxH * 10) / 10,
      });
    }
  }

  bridges.sort((a, b) => a.s0 - b.s0);
  return bridges;
}

