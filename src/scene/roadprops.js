// Geometry helpers and prop builders for the roadside blocks: shared primitives (oriented boxes, wire
// ribbons, sign boards) plus interstate furniture (guardrails, delineators, overhead gantries, overpasses,
// rest areas, weigh stations, runaway-ramp berms) and countryside dressing (field fences, barns, silos,
// windmills, cattle). Everything writes into one GB builder per 240 m block, in world coordinates.
import { K } from './buildings.js';
import { lotWidthAt } from '../world/highway.js';

export const lin = (c) => c.map((v) => Math.pow(v, 2.2));
export const WOOD = lin([0.33, 0.24, 0.16]), DARK = lin([0.08, 0.08, 0.09]), STEEL = lin([0.5, 0.52, 0.55]), STONE = lin([0.5, 0.48, 0.44]), WIRE = lin([0.05, 0.05, 0.06]);
const CONCRETE = lin([0.62, 0.61, 0.58]), ASPHALT = lin([0.13, 0.13, 0.14]), RAIL = lin([0.7, 0.72, 0.74]), EARTH = lin([0.36, 0.3, 0.22]), FILL = lin([0.5, 0.43, 0.27]), GRAVEL = lin([0.55, 0.5, 0.42]);
const RED = lin([0.5, 0.14, 0.1]), WHITE = lin([0.9, 0.88, 0.84]), YELLOW = lin([0.85, 0.66, 0.1]);

/** Oriented box: local u runs along the facing's right vector t, d along its normal n. */
export function obox(gb, cx, cz, y0, y1, hw, hd, yaw, col, kind = K.plain, seed = 1, topCol = null, topKind = K.roof) {
  const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const P = (u, d, y) => [cx + tx * u + nx * d, y, cz + tz * u + nz * d];
  const c = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const normals = [[-nx, 0, -nz], [tx, 0, tz], [nx, 0, nz], [-tx, 0, -tz]];
  for (let i = 0; i < 4; i++) {
    const A = c[i], B = c[(i + 1) % 4];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    gb.quad(P(A[0], A[1], y0), P(B[0], B[1], y0), P(B[0], B[1], y1), P(A[0], A[1], y1), normals[i], col, kind, seed, [[0, 0], [len, 0], [len, y1 - y0], [0, y1 - y0]]);
  }
  if (topCol) gb.quad(P(c[0][0], c[0][1], y1), P(c[1][0], c[1][1], y1), P(c[2][0], c[2][1], y1), P(c[3][0], c[3][1], y1), [0, 1, 0], topCol, topKind, seed);
}

/** A thin ribbon between two 3D points (a flat and an upright ribbon, both faces) for wires and strands. */
export function wire(gb, a, b, w = 0.05, col = WIRE) {
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
export function board(gb, atlas, x, z, y, yaw, w, h, clear, text, style, seed = 1) {
  const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const P = (u, hh, d = 0) => [x + tx * u + nx * d, y + hh, z + tz * u + nz * d];
  for (const u of [-w / 2 + 0.35, w / 2 - 0.35]) obox(gb, x + tx * u, z + tz * u, y, y + clear + h, 0.07, 0.07, yaw, STEEL, K.plain, seed);
  obox(gb, x, z, y + clear, y + clear + h, w / 2, 0.04, yaw, lin([0.2, 0.2, 0.22]), K.plain, seed);
  const [u0, v0, u1, v1] = atlas.slot(text, style);
  const d = 0.06;
  gb.signQuad(P(-w / 2, clear, d), P(w / 2, clear, d), P(w / 2, clear + h, d), P(-w / 2, clear + h, d), [nx, 0, nz], u0, v0, u1, v1, seed);
}

/**
 * Per-block drawing context. Lateral positions are metres from the centre line, positive to the right of
 * the +s direction of travel; `at(s, u)` is the world point there and `frame(s)` a local frame whose
 * u axis runs along the road and d axis (right-positive) across it.
 */
export function makeCtx({ gb, atlas, W, e, circles, at }) {
  const step = e.len / (e.n - 1);
  const roadY = (s) => {
    const kf = Math.max(0, Math.min(e.n - 1.001, s / step)), k = Math.floor(kf);
    return e.hs[k] + (e.hs[k + 1] - e.hs[k]) * (kf - k);
  };
  const ctx = {
    gb, atlas, W, e, circles, roadY,
    w2: e.P.width / 2,
    hw: e.P.width / 2 + e.sh,
    lonYaw: (p) => Math.atan2(-p.tz, p.tx),
    pos(s, u) {
      const p = at(e, s);
      return { x: p.x + -p.tz * u, z: p.z + p.tx * u, p, y: roadY(s) };
    },
    frame(s) {
      const p = at(e, s), yaw = Math.atan2(-p.tz, p.tx), y = roadY(s);
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      return { x: p.x, z: p.z, p, yaw, y, xz: (u, d) => [p.x + c * u + sn * d, p.z - sn * u + c * d] };
    },
    lotW: (side, s) => lotWidthAt(e.lots, side, s),
    hit(x, z, r, kind = 'sign') {
      circles.push({ x, z, r, kind });
    },
  };
  return ctx;
}

// ── Guardrail and delineators ───────────────────────────────────────────────────

/** W-beam guardrail on one side between arc lengths sA and sB: posts every 3.8 m, rail panels, collision circles every 1.9 m. */
export function guardrail(ctx, side, sA, sB) {
  const { gb, W, hw } = ctx;
  const u = side * (hw + 0.55);
  let prev = null;
  for (let s = sA; s <= sB + 0.01; s += 3.8) {
    const A = ctx.pos(s, u);
    const g = W.heightAt(A.x, A.z);
    const y = A.y;
    const yaw = ctx.lonYaw(A.p);
    obox(gb, A.x, A.z, Math.min(g, y) - 0.15, y + 0.78, 0.05, 0.05, yaw, STEEL, K.plain, 3);
    if (prev) {
      const mx = (prev.x + A.x) / 2, mz = (prev.z + A.z) / 2, l = Math.hypot(A.x - prev.x, A.z - prev.z);
      const my = (prev.y + A.y) / 2;
      const ang = Math.atan2(-(A.z - prev.z), A.x - prev.x);
      obox(gb, mx, mz, my + 0.48, my + 0.8, l / 2 + 0.02, 0.05, ang, RAIL, K.metal, 4);
      ctx.hit(mx, mz, 0.4, 'sign');
      ctx.hit((mx + A.x) / 2, (mz + A.z) / 2, 0.4, 'sign');
    }
    prev = A;
  }
}

/** White (right) and amber (left) reflective delineator posts every 48 m where there is no rail or lot. */
export function delineators(ctx, s0, s1, railSpans) {
  const { gb, hw } = ctx;
  const i0 = Math.ceil(s0 / 48), i1 = Math.ceil(s1 / 48) - 1;
  for (let i = i0; i <= i1; i++) {
    const s = i * 48;
    if (s < 40 || s > ctx.e.len - 40) continue;
    for (const side of [1, -1]) {
      if (ctx.lotW(side, s) > 0.3 || railSpans[side]?.some(([a, b]) => s >= a - 6 && s <= b + 6)) continue;
      const A = ctx.pos(s, side * (hw + 0.9));
      const g = ctx.W.heightAt(A.x, A.z);
      const yaw = ctx.lonYaw(A.p);
      obox(gb, A.x, A.z, g - 0.05, g + 1.15, 0.04, 0.04, yaw, WHITE, K.plain, 3);
      obox(gb, A.x, A.z, g + 0.85, g + 1.15, 0.045, 0.045, yaw, side > 0 ? lin([0.9, 0.9, 0.95]) : lin([0.95, 0.65, 0.1]), K.plain, 3);
    }
  }
}

// ── Overhead gantry sign ────────────────────────────────────────────────────────

/** Overhead sign gantry facing traffic moving along `face` (+1 / -1), with one wide panel. */
export function gantry(ctx, s, face, text, style = 1) {
  const { gb, atlas, hw } = ctx;
  const p = ctx.pos(s, 0);
  const nxv = face > 0 ? -p.p.tx : p.p.tx, nzv = face > 0 ? -p.p.tz : p.p.tz;
  const yaw = Math.atan2(nxv, nzv);
  const tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const y0 = p.y;
  const span = hw + 1.8;
  for (const sd of [-1, 1]) {
    const px = p.x + tx * sd * span, pz = p.z + tz * sd * span;
    const g = ctx.W.heightAt(px, pz);
    obox(gb, px, pz, Math.min(g, y0) - 0.2, y0 + 7.9, 0.16, 0.16, yaw, STEEL, K.plain, 6);
    ctx.hit(px, pz, 0.45, 'sign');
  }
  obox(gb, p.x, p.z, y0 + 4.9, y0 + 5.25, span, 0.14, yaw, STEEL, K.plain, 6);
  obox(gb, p.x, p.z, y0 + 5.25, y0 + 7.75, 4.9, 0.07, yaw, lin([0.18, 0.22, 0.2]), K.plain, 6);
  const [u0, v0, u1, v1] = atlas.slot(text, style);
  const nx = Math.sin(yaw), nz = Math.cos(yaw), d = 0.1;
  const P = (u, h) => [p.x + tx * u + nx * d, y0 + h, p.z + tz * u + nz * d];
  gb.signQuad(P(-4.8, 5.3), P(4.8, 5.3), P(4.8, 7.7), P(-4.8, 7.7), [nx, 0, nz], u0, v0, u1, v1, 6);
}

// ── Overpass and interchange ────────────────────────────────────────────────────

/** Local road bridge carried over the road at arc length ov.s, with approach embankments and pier protection. */
export function overpass(ctx, ov) {
  const { gb, W, hw } = ctx;
  const F = ctx.frame(ov.s);
  const reach = hw + 3.6;
  const A = reach + 4.4; // deck half-length across the road
  const deckY = F.y + 6.3;
  const half = 4.2; // half the deck width (along the road)
  const across = F.yaw + Math.PI / 2;
  // deck slab, asphalt, parapets
  const T = (u, d, y) => {
    const [x, z] = F.xz(u, d);
    return [x, y, z];
  };
  obox(gb, F.x, F.z, deckY - 0.95, deckY, A, half, across, CONCRETE, K.plain, 8);
  gb.quad(T(-half, -A, deckY + 0.02), T(half, -A, deckY + 0.02), T(half, A, deckY + 0.02), T(-half, A, deckY + 0.02), [0, 1, 0], ASPHALT, K.plain, 8);
  for (const sd of [-1, 1]) {
    const [bx, bz] = F.xz(sd * (half - 0.2), 0);
    obox(gb, bx, bz, deckY, deckY + 0.95, A, 0.2, across, CONCRETE, K.plain, 8, CONCRETE, K.plain);
  }
  // approach ramps down to the ground, with earth walls on both sides
  const tan = [Math.cos(F.yaw), -Math.sin(F.yaw)];
  for (const side of [-1, 1]) {
    const nSeg = 9, segL = 8;
    const [ex, ez] = F.xz(0, side * (A + nSeg * segL));
    const gEnd = W.heightAt(ex, ez);
    let prev = null;
    for (let j = 0; j <= nSeg; j++) {
      const d = side * (A + j * segL);
      const y = deckY + (gEnd + 0.1 - deckY) * (j / nSeg);
      const l = F.xz(-half + 0.2, d), r = F.xz(half - 0.2, d);
      const cur = { l, r, y, gl: W.heightAt(l[0], l[1]) - 0.4, gr: W.heightAt(r[0], r[1]) - 0.4 };
      if (prev) {
        gb.quad([prev.l[0], prev.y + 0.02, prev.l[1]], [prev.r[0], prev.y + 0.02, prev.r[1]], [cur.r[0], cur.y + 0.02, cur.r[1]], [cur.l[0], cur.y + 0.02, cur.l[1]], [0, 1, 0], ASPHALT, K.plain, 8);
        for (const sg of [-1, 1]) {
          const k = sg < 0 ? 'l' : 'r', gk = sg < 0 ? 'gl' : 'gr';
          if (prev.y < prev[gk] && cur.y < cur[gk]) continue; // buried in a cut
          // fill slope: 1:1.8 from the deck edge down to the ground, along the road direction
          const foot = (q) => {
            const run = Math.max(0, q.y - q[gk]) * 1.8 * sg;
            return [q[k][0] + tan[0] * run, q[k][1] + tan[1] * run];
          };
          const fa = foot(prev), fb = foot(cur);
          const ln = Math.hypot(1.8, 1);
          gb.quad([fa[0], prev[gk], fa[1]], [fb[0], cur[gk], fb[1]], [cur[k][0], cur.y, cur[k][1]], [prev[k][0], prev.y, prev[k][1]], [(tan[0] * sg * 1) / ln, 1 / ln * 1.8 * 0.55, (tan[1] * sg * 1) / ln], FILL, K.plain, 8);
          const mx = (prev[k][0] + cur[k][0]) / 2, mz = (prev[k][1] + cur[k][1]) / 2;
          const my = (prev.y + cur.y) / 2;
          obox(gb, mx, mz, my, my + 0.8, segL / 2 + 0.05, 0.15, across, CONCRETE, K.plain, 8);
        }
      }
      prev = cur;
    }
  }
  // piers beside the road with jersey barriers in front, both sides
  for (const side of [-1, 1]) {
    const [px, pz] = F.xz(0, side * (reach + 1.9));
    const g = W.heightAt(px, pz);
    obox(gb, px, pz, Math.min(g, F.y) - 0.3, deckY - 0.95, 0.7, half - 0.5, F.yaw, CONCRETE, K.plain, 8);
    for (const u of [-2.6, 0, 2.6]) {
      const [cx, cz] = F.xz(u, side * (reach + 1.9));
      ctx.hit(cx, cz, 1.3, 'boulder');
    }
    const [bx, bz] = F.xz(0, side * (reach + 0.55));
    obox(gb, bx, bz, F.y, F.y + 0.85, 5, 0.28, F.yaw, CONCRETE, K.plain, 8, CONCRETE);
    for (let u = -4.5; u <= 4.6; u += 1.5) {
      const [cx, cz] = F.xz(u, side * (reach + 0.55));
      ctx.hit(cx, cz, 0.5, 'boulder');
    }
  }
}

// ── Rest area, weigh station, runaway ramp ──────────────────────────────────────

function lightPole(ctx, x, z, yaw, y) {
  const g = ctx.W.heightAt(x, z);
  obox(ctx.gb, x, z, Math.min(g, y) - 0.1, y + 9, 0.1, 0.1, yaw, STEEL, K.plain, 5);
  obox(ctx.gb, x, z, y + 8.8, y + 9.0, 1.2, 0.07, yaw, STEEL, K.plain, 5);
  ctx.hit(x, z, 0.3, 'sign');
}

/** Rest area: restrooms, picnic shelter and tables, light poles and a "REST AREA" board facing the road. */
export function restArea(ctx, lot) {
  const { gb, atlas, hw } = ctx;
  const side = lot.side;
  const sc = (lot.s0 + lot.s1) / 2;
  const F = ctx.frame(sc);
  const W0 = lot.w;
  const far = side * (hw + W0 + 7);
  const roof = lin([0.25, 0.3, 0.28]);
  // restroom block
  const [bx, bz] = F.xz(0, far);
  const by = F.y;
  obox(gb, bx, bz, by, by + 3.2, 5, 2.6, F.yaw, lin([0.66, 0.58, 0.46]), K.plain, 5, roof);
  for (const u of [-3, 0, 3]) {
    const [cx, cz] = F.xz(u, far);
    ctx.hit(cx, cz, 2.8, 'boulder');
  }
  // sign board on the building face toward the road
  const [u0, v0, u1, v1] = atlas.slot('REST AREA\nRestrooms · Picnic', 2);
  const fd = far - side * 2.65;
  const nrm = [Math.sin(F.yaw) * -side, 0, Math.cos(F.yaw) * -side];
  const P = (u, h) => {
    const [x, z] = F.xz(u, fd);
    return [x, by + h, z];
  };
  gb.signQuad(P(-3.2, 1.9), P(3.2, 1.9), P(3.2, 2.9), P(-3.2, 2.9), nrm, u0, v0, u1, v1, 5);
  // picnic shelter
  const sh = side * (hw + W0 + 7);
  const [sx, sz] = F.xz(-16, sh);
  for (const [a, b] of [[-2.2, -1.4], [2.2, -1.4], [-2.2, 1.4], [2.2, 1.4]]) {
    const [px, pz] = F.xz(-16 + a, sh + b);
    obox(gb, px, pz, by, by + 2.7, 0.14, 0.14, F.yaw, WOOD, K.plain, 5);
    ctx.hit(px, pz, 0.3, 'sign');
  }
  obox(gb, sx, sz, by + 2.7, by + 3.0, 3.0, 2.1, F.yaw, lin([0.4, 0.3, 0.2]), K.plain, 5, roof);
  for (const u of [-16, -24, 20]) {
    const [tx, tz] = F.xz(u, side * (hw + W0 + 2.6));
    obox(gb, tx, tz, by + 0.7, by + 0.78, 1.0, 0.4, F.yaw, WOOD, K.plain, 5, WOOD);
    for (const sd of [-1, 1]) {
      const [lx, lz] = F.xz(u + sd * 0.7, side * (hw + W0 + 2.6));
      obox(gb, lx, lz, by, by + 0.7, 0.05, 0.4, F.yaw, WOOD, K.plain, 5);
    }
  }
  // lighting
  for (const u of [-52, -18, 18, 52]) {
    const [lx, lz] = F.xz(u, side * (hw + W0 * 0.5));
    lightPole(ctx, lx, lz, F.yaw, by);
  }
}

/** Weigh station: scale house, canopy over the scale lane and a platform marking. */
export function weighStation(ctx, lot) {
  const { gb, hw } = ctx;
  const side = lot.side;
  const sc = (lot.s0 + lot.s1) / 2;
  const F = ctx.frame(sc);
  const by = F.y;
  const lane = side * (hw + 6);
  // scale platform
  const [px, pz] = F.xz(0, lane);
  obox(gb, px, pz, by + 0.03, by + 0.1, 8, 1.6, F.yaw, lin([0.16, 0.17, 0.2]), K.plain, 5, lin([0.16, 0.17, 0.2]));
  // canopy
  const canopy = lin([0.78, 0.78, 0.76]);
  obox(gb, px, pz, by + 5.5, by + 5.85, 9, 3.4, F.yaw, canopy, K.metal, 5, canopy);
  for (const u of [-8.5, 0, 8.5]) {
    const [cx, cz] = F.xz(u, side * (hw + 10));
    obox(gb, cx, cz, by, by + 5.5, 0.18, 0.18, F.yaw, STEEL, K.plain, 5);
    ctx.hit(cx, cz, 0.4, 'sign');
  }
  // scale house
  const [hx, hz] = F.xz(0, side * (hw + 14));
  obox(gb, hx, hz, by, by + 3.0, 4, 2.2, F.yaw, lin([0.7, 0.68, 0.62]), K.plain, 5, lin([0.3, 0.3, 0.32]));
  for (const u of [-2.5, 0, 2.5]) {
    const [cx, cz] = F.xz(u, side * (hw + 14));
    ctx.hit(cx, cz, 2.4, 'boulder');
  }
  for (const u of [-14, 14]) {
    const [lx, lz] = F.xz(u, side * (hw + 8));
    lightPole(ctx, lx, lz, F.yaw, by);
  }
}

/** Runaway-truck ramp: end berm, barrels and yellow marker posts along the gravel bed. */
export function runawayRamp(ctx, lot) {
  const { gb, hw } = ctx;
  const side = lot.side;
  const F0 = ctx.frame(lot.face > 0 ? lot.s1 - 30 : lot.s0 + 30);
  const u = side * (hw + lot.w * 0.5);
  const [bx, bz] = F0.xz(0, u);
  const g = ctx.W.heightAt(bx, bz);
  obox(gb, bx, bz, Math.min(g, F0.y) - 0.4, F0.y + 2.0, 0.9, lot.w * 0.5 + 0.6, F0.yaw, EARTH, K.plain, 5, EARTH);
  for (const d of [-1.5, 0, 1.5]) {
    const [cx, cz] = F0.xz(-lot.face * 2.2, u + d);
    ctx.hit(cx, cz, 0.8, 'boulder');
  }
  for (const d of [-1.8, 0, 1.8]) {
    const [cx, cz] = F0.xz(-lot.face * 3.6, u + d);
    gb.cyl(cx, cz, 0.42, F0.y, F0.y + 0.95, 8, YELLOW, K.plain, 5, 0, YELLOW);
  }
  for (let s = lot.s0 + 50; s < lot.s1 - 40; s += 28) {
    const A = ctx.pos(s, side * (hw + lot.w + 0.7));
    obox(gb, A.x, A.z, A.y - 0.1, A.y + 2.0, 0.05, 0.05, ctx.lonYaw(A.p), YELLOW, K.plain, 5);
  }
}

// ── Countryside ─────────────────────────────────────────────────────────────────

/** Gable-roofed building in local frame (u along yaw's right vector, d across); eave and ridge heights above y0. */
export function gabled(gb, cx, cz, y0, eave, rise, hw, hd, yaw, wallCol, roofCol, wallKind = K.plain) {
  obox(gb, cx, cz, y0, y0 + eave, hw, hd, yaw, wallCol, wallKind, 5);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const W = (u, d, y) => [cx + c * u + s * d, y, cz - s * u + c * d];
  const top = y0 + eave, ov = 0.35;
  const dd = hd + ov, L = Math.hypot(dd, rise);
  for (const sd of [-1, 1]) {
    const n = [(s * sd * rise) / L, dd / L, (c * sd * rise) / L];
    gb.quad(W(-hw - ov, sd * dd, top - 0.2), W(hw + ov, sd * dd, top - 0.2), W(hw + ov, 0, top + rise), W(-hw - ov, 0, top + rise), n, roofCol, K.metal, 5);
  }
  for (const sd of [-1, 1]) gb.tri(W(sd * hw, -hd, top), W(sd * hw, hd, top), W(sd * hw, 0, top + rise), [c * sd, 0, -s * sd], wallCol, wallKind, 5);
}

/** Grain silo with a dome cap. */
export function silo(gb, x, z, y, r = 2.6, h = 12) {
  gb.cyl(x, z, r, y, y + h, 14, lin([0.72, 0.72, 0.7]), K.plain, 6, r * 0.5, lin([0.5, 0.52, 0.55]));
}

/** Farm windmill: four-legged tower, wheel of blades facing along `yaw` and a tail vane. */
export function windmill(gb, x, z, y, yaw, h = 9) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const W = (u, d, hh) => [x + c * u + s * d, y + hh, z - s * u + c * d];
  for (const [a, b] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    const [lx, , lz] = W(a, b, 0);
    obox(gb, lx, lz, y, y + h, 0.06, 0.06, yaw, STEEL, K.plain, 7);
  }
  obox(gb, x, z, y + h, y + h + 0.3, 0.7, 0.5, yaw, DARK, K.plain, 7, DARK);
  const cy = h + 0.9, hub = 1.1;
  const n = [s, 0, c];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const r0 = 0.3, r1 = 2.35;
    const px = -sa, py = ca; // perpendicular within the wheel plane
    const w0 = 0.08, w1 = 0.28;
    const P = (r, w) => W(ca * r + px * w, hub, cy + sa * r + py * w);
    for (const sg of [1, -1]) gb.quad(P(r0, -w0), P(r0, w0), P(r1, w1), P(r1, -w1), [n[0] * sg, 0, n[2] * sg], STEEL, K.plain, 7);
  }
  obox(gb, x + s * -1.6, z + c * -1.6, y + h + 0.5, y + h + 1.7, 0.03, 0.03, yaw, STEEL, K.plain, 7);
  const [vx, , vz] = W(0, -2.3, 0);
  obox(gb, vx, vz, y + h + 0.6, y + h + 1.6, 0.04, 1.3, yaw + 0, STEEL, K.plain, 7);
}

/** One cow (static) at (x, z) with heading `yaw`. */
export function cow(gb, x, z, y, yaw, pal) {
  const col = [lin([0.22, 0.14, 0.1]), lin([0.1, 0.1, 0.1]), lin([0.55, 0.38, 0.22]), lin([0.85, 0.83, 0.8])][pal % 4];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (u, d) => [x + c * u + s * d, z - s * u + c * d];
  obox(gb, x, z, y + 0.62, y + 1.32, 0.95, 0.36, yaw, col, K.plain, 4, col);
  const [hx, hz] = at(1.22, 0);
  obox(gb, hx, hz, y + 0.95, y + 1.38, 0.28, 0.2, yaw, col, K.plain, 4, col);
  for (const [u, d] of [[-0.65, -0.2], [-0.65, 0.2], [0.65, -0.2], [0.65, 0.2]]) {
    const [lx, lz] = at(u, d);
    obox(gb, lx, lz, y, y + 0.64, 0.07, 0.07, yaw, DARK, K.plain, 4);
  }
}

/**
 * A farmstead beside the road: red barn, silos, farmhouse, sometimes a windmill and a small herd in
 * the paddock between it and the road. `dist` is the lateral distance of the barn from the centre line.
 */
export function farmstead(ctx, s, side, dist, h) {
  const { gb, W, hw } = ctx;
  const F = ctx.frame(s);
  const put = (u, d, fn) => {
    const [x, z] = F.xz(u, side * d);
    fn(x, z, W.heightAt(x, z) - 0.05);
    return [x, z];
  };
  put(0, dist, (x, z, y) => gabled(gb, x, z, y - 0.2, 5.6, 3.0, 7, 5, F.yaw, RED, lin([0.4, 0.4, 0.42])));
  for (const u of [-4.5, 0, 4.5]) {
    const [x, z] = F.xz(u, side * dist);
    ctx.hit(x, z, 5.4, 'boulder');
  }
  const nSilo = 1 + Math.floor(h(1) * 2);
  for (let i = 0; i < nSilo; i++) {
    const [x, z] = put(-12 - i * 5.8, dist + 1, (x2, z2, y) => silo(gb, x2, z2, y - 0.2, 2.6, 11 + i * 1.5));
    ctx.hit(x, z, 2.9, 'boulder');
  }
  const [hx, hz] = put(20, dist - 2, (x, z, y) => gabled(gb, x, z, y - 0.2, 3.2, 2.2, 5, 3.6, F.yaw, lin([0.88, 0.86, 0.8]), lin([0.3, 0.2, 0.18]), K.house));
  ctx.hit(hx, hz, 4.8, 'boulder');
  if (h(2) < 0.5) {
    const [x, z] = put(-34, dist - 3, (x2, z2, y) => windmill(gb, x2, z2, y - 0.2, F.yaw + (side > 0 ? 0 : Math.PI)));
    ctx.hit(x, z, 1.3, 'boulder');
  }
  // paddock herd between the road fence and the yard
  const dNear = hw + 16, dFar = dist - 10;
  if (dFar - dNear > 6) {
    const n = 3 + Math.floor(h(3) * 5);
    for (let i = 0; i < n; i++) {
      const u = -24 + h(10 + i) * 48, d = dNear + h(20 + i) * (dFar - dNear);
      const [x, z] = F.xz(u, side * d);
      cow(gb, x, z, W.heightAt(x, z), h(30 + i) * Math.PI * 2, Math.floor(h(40 + i) * 4));
    }
  }
}
