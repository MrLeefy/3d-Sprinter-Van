// Street furniture merged into the town tile geometry: signals, stop signs, crosswalks, parking-bay
// stripes, hydrants, mailboxes, benches, bus shelters, flags, fences, fuel-price pylons, rail
// crossing signs and the railway itself. All of it is non-solid (the layout never registers colliders
// for it), so a 25 m rig can swing wide over a corner without snagging a pole.
import { K } from './buildings.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const DARK = lin([0.1, 0.1, 0.11]), STEEL = lin([0.5, 0.52, 0.55]), WOOD = lin([0.42, 0.28, 0.16]), RED = lin([0.7, 0.08, 0.06]), WHITE = lin([0.92, 0.92, 0.9]);
const PAINT_WHITE = lin([0.85, 0.85, 0.82]);
const BLUE = lin([0.1, 0.2, 0.5]);

/** Axis unit vector of a prop's facing yaw (forward = (cos r, -sin r)). */
export const axisOf = (rot) => [Math.round(Math.cos(rot)), -Math.round(Math.sin(rot))];

/** Axis-aligned box from local (u along facing, v along the viewer's right) extents. */
function lb(gb, x, z, f, u0, u1, v0, v1, y0, y1, col, kind = K.plain, seed = 1, top = true) {
  const t = [f[1], -f[0]];
  const X = [x + f[0] * u0 + t[0] * v0, x + f[0] * u1 + t[0] * v1], Z = [z + f[1] * u0 + t[1] * v0, z + f[1] * u1 + t[1] * v1];
  gb.box(Math.min(...X), Math.max(...X), Math.min(...Z), Math.max(...Z), y0, y1, col, kind, seed, top ? col : null);
}

/** A sign-atlas panel facing `f`, centred on v = 0, readable by a viewer in front of it. */
function panel(gb, atlas, text, style, x, z, f, y0, y1, w, off = 0.05, seed = 1) {
  const t = [f[1], -f[0]];
  const [u0, v0, u1, v1] = atlas.slot(text, style);
  const P = (v, y) => [x + t[0] * v + f[0] * off, y, z + t[1] * v + f[1] * off];
  gb.signQuad(P(-w / 2, y0), P(w / 2, y0), P(w / 2, y1), P(-w / 2, y1), [f[0], 0, f[1]], u0, v0, u1, v1, seed);
}

/** Flat ground decal: a top-facing quad over [x0, x1] × [z0, z1] at height y. */
export function decal(gb, x0, x1, z0, z1, y, col, seed = 1) {
  gb.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], col, K.plain, seed, [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

/** Draw one furniture prop p = [x, z, rot, type, a, b, c] standing on ground height y. */
export function drawFurniture(gb, atlas, p, y) {
  const [x, z, rot, type, a, b, c] = p;
  const f = axisOf(rot), t = [f[1], -f[0]];
  switch (type) {
    case 'hydrant': {
      gb.cyl(x, z, 0.14, y, y + 0.58, 8, RED, K.plain, 3, 0.1, RED);
      lb(gb, x, z, [1, 0], -0.24, 0.24, -0.05, 0.05, y + 0.36, y + 0.46, RED);
      lb(gb, x, z, [0, 1], -0.24, 0.24, -0.05, 0.05, y + 0.36, y + 0.46, RED);
      break;
    }
    case 'mailbox': {
      lb(gb, x, z, f, -0.04, 0.04, -0.04, 0.04, y, y + 1.05, WOOD);
      lb(gb, x, z, f, -0.28, 0.28, -0.12, 0.12, y + 1.05, y + 1.28, BLUE, K.plain, 4);
      lb(gb, x, z, f, 0.1, 0.14, -0.13, -0.11, y + 1.2, y + 1.42, RED);
      break;
    }
    case 'bench': {
      lb(gb, x, z, f, -0.25, 0.22, -0.9, 0.9, y + 0.42, y + 0.47, WOOD);
      lb(gb, x, z, f, -0.3, -0.24, -0.9, 0.9, y + 0.5, y + 0.92, WOOD);
      for (const v of [-0.8, 0.8]) lb(gb, x, z, f, -0.2, 0.18, v - 0.04, v + 0.04, y, y + 0.42, DARK);
      break;
    }
    case 'bus': {
      // glass-backed shelter open toward the street (f), bench inside and a stop sign on a post
      lb(gb, x, z, f, -0.95, -0.85, -1.5, 1.5, y + 0.2, y + 2.35, lin([0.12, 0.2, 0.28]), K.plain, 5, false);
      lb(gb, x, z, f, -1.1, 1.0, -1.6, 1.6, y + 2.35, y + 2.5, STEEL);
      for (const v of [-1.5, 1.5]) lb(gb, x, z, f, -0.95, 0.9, v - 0.05, v + 0.05, y, y + 2.35, STEEL);
      lb(gb, x, z, f, -0.8, -0.3, -1.2, 1.2, y + 0.42, y + 0.47, WOOD);
      lb(gb, x, z, f, 1.35, 1.43, -0.04, -0.04 + 0.08, y, y + 2.7, STEEL);
      panel(gb, atlas, 'BUS STOP', 2, x + f[0] * 1.39, z + f[1] * 1.39, f, y + 2.2, y + 2.75, 0.8, 0.03, 5);
      break;
    }
    case 'signal': {
      // corner pole with a mast arm reaching over the lanes; head faces the approaching traffic
      const ax = b, az = c, reach = 2.2;
      gb.box(x - 0.08, x + 0.08, z - 0.08, z + 0.08, y, y + 5.6, DARK, K.plain, 6, DARK);
      const ex = x + ax * reach, ez = z + az * reach;
      gb.box(Math.min(x, ex) - 0.05, Math.max(x, ex) + 0.05, Math.min(z, ez) - 0.05, Math.max(z, ez) + 0.05, y + 5.0, y + 5.12, DARK, K.plain, 6, DARK);
      drawSignalHead(gb, ex, ez, f, t, y, a);
      break;
    }
    case 'stop': {
      gb.box(x - 0.035, x + 0.035, z - 0.035, z + 0.035, y, y + 2.45, STEEL, K.plain, 8, STEEL);
      panel(gb, atlas, 'STOP', 0, x, z, f, y + 1.7, y + 2.45, 0.75, 0.05, 8);
      lb(gb, x, z, f, -0.02, 0.01, -0.38, 0.38, y + 1.72, y + 2.43, STEEL, K.plain, 8, false);
      break;
    }
    case 'xbuck': {
      gb.box(x - 0.05, x + 0.05, z - 0.05, z + 0.05, y, y + 2.6, STEEL, K.plain, 9, STEEL);
      panel(gb, atlas, 'RAILROAD\nCROSSING', 5, x, z, f, y + 2.0, y + 2.65, 1.7, 0.06, 9);
      panel(gb, atlas, 'RAILROAD\nCROSSING', 5, x, z, [-f[0], -f[1]], y + 2.0, y + 2.65, 1.7, 0.06, 9);
      break;
    }
    case 'pylon': {
      lb(gb, x, z, f, -0.15, 0.15, -0.15, 0.15, y, y + 6.2, STEEL);
      lb(gb, x, z, f, -0.22, 0.22, -1.7, 1.7, y + 5.0, y + 7.3, RED, K.plain, 10);
      for (const s of [1, -1]) panel(gb, atlas, 'FUEL\nDIESEL · UNLEADED', 2, x + f[0] * 0.25 * s, z + f[1] * 0.25 * s, [f[0] * s, f[1] * s], y + 5.1, y + 7.2, 3.2, 0.0, 10);
      break;
    }
    case 'flag': {
      const h = a || 9, big = b === 1 ? 1.7 : 1;
      gb.box(x - 0.045, x + 0.045, z - 0.045, z + 0.045, y, y + h, STEEL, K.plain, 11, STEEL);
      gb.box(x - 0.1, x + 0.1, z - 0.1, z + 0.1, y + h, y + h + 0.16, lin([0.8, 0.65, 0.2]), K.plain, 11, lin([0.8, 0.65, 0.2]));
      const fw = 1.9 * big, fh = 1.15 * big, top = y + h - 0.1;
      const hang = (v0, v1, y0, y1, col, n) => {
        const P = (v, yy) => [x + t[0] * v + f[0] * 0.02 * n, yy, z + t[1] * v + f[1] * 0.02 * n];
        gb.quad(P(v0, y0), P(v1, y0), P(v1, y1), P(v0, y1), [f[0] * n, 0, f[1] * n], col, K.plain, 11);
      };
      const stripe = fh / 7;
      for (const n of [1, -1]) {
        for (let i = 0; i < 7; i++) hang(0.07, 0.07 + fw, top - (i + 1) * stripe, top - i * stripe, i % 2 ? WHITE : lin([0.7, 0.1, 0.12]), n);
        hang(0.07, 0.07 + fw * 0.4, top - 4 * stripe, top, lin([0.1, 0.15, 0.45]), n * 1);
      }
      break;
    }
    case 'fence': {
      const len = a, rails = b === 1, alongZ = c === 1;
      const ff = alongZ ? [0, 1] : [1, 0];
      const col = rails ? WOOD : PAINT_WHITE;
      if (rails) {
        for (const h of [0.45, 0.85, 1.25]) lb(gb, x, z, ff, -len / 2, len / 2, -0.03, 0.03, y + h, y + h + 0.1, col);
      } else lb(gb, x, z, ff, -len / 2, len / 2, -0.03, 0.03, y, y + 1.55, col, K.plain, 12);
      for (let u = -len / 2; u <= len / 2 + 0.01; u += 2.6) lb(gb, x, z, ff, u - 0.07, u + 0.07, -0.07, 0.07, y, y + (rails ? 1.4 : 1.7), WOOD);
      break;
    }
    case 'cross': {
      // zebra crossing: stripes run along the direction of travel across the street
      const span = a, alongZ = b === 1;
      const n = Math.floor(span / 1.0);
      for (let i = 0; i < n; i++) {
        const v = -span / 2 + (i + 0.5) * (span / n);
        if (!alongZ) decal(gb, x + v - 0.25, x + v + 0.25, z - 1.5, z + 1.5, y + 0.12, WHITE, 13);
        else decal(gb, x - 1.5, x + 1.5, z + v - 0.25, z + v + 0.25, y + 0.12, WHITE, 13);
      }
      break;
    }
    case 'bays': {
      const n = a, bw = b, bl = c;
      for (let i = 0; i <= n; i++) decal(gb, x + i * bw - 0.06, x + i * bw + 0.06, z - bl / 2, z + bl / 2, y + 0.12, WHITE, 14);
      break;
    }
    default:
  }
}

/** Track bed pieces for a railway centred on z = az between x0 and x1 (already clipped to a tile). */
export function drawRail(gb, x0, x1, az, y) {
  const iron = lin([0.32, 0.31, 0.3]), tie = lin([0.2, 0.15, 0.1]);
  for (let x = Math.ceil(x0 / 0.85) * 0.85; x < x1; x += 0.85) gb.box(x - 0.13, x + 0.13, az - 1.4, az + 1.4, y + 0.06, y + 0.16, tie, K.plain, 15, tie);
  for (const s of [-0.72, 0.72]) gb.box(x0, x1, az + s - 0.06, az + s + 0.06, y + 0.16, y + 0.34, iron, K.plain, 15, iron);
}

/**
 * Render dynamic 3-lens signal head activating green, yellow, and red lenses according to phase.
 */
export function drawSignalHead(gb, ex, ez, f, t, y, phase) {
  lb(gb, ex, ez, f, -0.17, 0.17, -0.19, 0.19, y + 3.9, y + 5.0, DARK);
  const lens = (h, col, on) => {
    const u = 0.175, v = 0.11;
    const P = (vv, yy) => [ex + f[0] * u + t[0] * vv, yy, ez + f[1] * u + t[1] * vv];
    gb.quad(P(-v, h), P(v, h), P(v, h + 0.22), P(-v, h + 0.22), [f[0], 0, f[1]], on ? col : col.map((q) => q * 0.08), on ? K.glow : K.plain, 7);
  };
  const code = (phase && typeof phase === 'object') ? phase.code : phase;
  const phaseStr = (phase && typeof phase === 'object') ? phase.phase : phase;
  const isRed = phase === 2 || code === 2 || phase === 'red' || phaseStr === 'red';
  const isYellow = phase === 1 || code === 1 || phase === 'yellow' || phaseStr === 'yellow';
  const isGreen = phase === 0 || code === 0 || phase === 'green' || phaseStr === 'green';
  lens(y + 4.72, lin([1, 0.05, 0.03]), isRed);
  lens(y + 4.44, lin([1, 0.65, 0.05]), isYellow);
  lens(y + 4.16, lin([0.1, 1, 0.25]), isGreen);
}

