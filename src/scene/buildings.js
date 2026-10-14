// Procedural buildings: merged, vertex-coloured geometry with metric wall coordinates, drawn by a
// shader that adds windows, storefronts, corrugated siding, brick and signs, and lights the
// windows at night. One material, one draw call per streaming tile.
import * as THREE from 'three';
import { prng, hashStr } from '../world/noise.js';
import { GLSL_NOISE } from './season.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
export const WALL = [[0.92, 0.9, 0.86], [0.86, 0.8, 0.62], [0.55, 0.62, 0.52], [0.42, 0.5, 0.6], [0.55, 0.25, 0.2], [0.72, 0.6, 0.45], [0.4, 0.27, 0.16], [0.6, 0.6, 0.62],
  [0.35, 0.5, 0.6], [0.5, 0.55, 0.52], [0.22, 0.28, 0.34], [0.7, 0.7, 0.68]].map(lin);
export const ROOF = [[0.22, 0.22, 0.24], [0.3, 0.2, 0.14], [0.2, 0.32, 0.25], [0.5, 0.18, 0.14], [0.5, 0.42, 0.32], [0.33, 0.33, 0.35]].map(lin);
const STONE = lin([0.55, 0.52, 0.48]), WHITE = lin([0.92, 0.92, 0.9]), STEEL = lin([0.45, 0.47, 0.5]), DARK = lin([0.1, 0.1, 0.11]), RED = lin([0.62, 0.15, 0.12]);

// kinds drawn by the shader
export const K = { house: 0, shop: 1, office: 2, metal: 3, plain: 4, roof: 5, glass: 6, brick: 7, sign: 12, panel: 13 };

class GB {
  constructor(ox, oz) {
    this.ox = ox;
    this.oz = oz;
    this.P = [];
    this.N = [];
    this.C = [];
    this.U = [];
    this.K = [];
    this.I = [];
  }

  vert(p, n, c, uv, kind, seed) {
    const i = this.P.length / 3;
    this.P.push(p[0] - this.ox, p[1], p[2] - this.oz);
    this.N.push(n[0], n[1], n[2]);
    this.C.push(c[0], c[1], c[2]);
    this.U.push(uv[0], uv[1]);
    this.K.push(kind, seed);
    return i;
  }

  /** Quad with an explicit outward normal; winding is fixed to match it. */
  quad(a, b, c, d, n, col, kind, seed, uv) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0;
    const pts = flip ? [a, d, c, b] : [a, b, c, d];
    const uvs = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const uvo = flip ? [uvs[0], uvs[3], uvs[2], uvs[1]] : uvs;
    const i0 = this.vert(pts[0], n, col, uvo[0], kind, seed);
    const i1 = this.vert(pts[1], n, col, uvo[1], kind, seed);
    const i2 = this.vert(pts[2], n, col, uvo[2], kind, seed);
    const i3 = this.vert(pts[3], n, col, uvo[3], kind, seed);
    this.I.push(i0, i1, i2, i0, i2, i3);
  }

  tri(a, b, c, n, col, kind, seed, uv) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0;
    const pts = flip ? [a, c, b] : [a, b, c];
    const uvs = uv || [[0, 0], [1, 0], [0.5, 1]];
    const uvo = flip ? [uvs[0], uvs[2], uvs[1]] : uvs;
    const i0 = this.vert(pts[0], n, col, uvo[0], kind, seed);
    const i1 = this.vert(pts[1], n, col, uvo[1], kind, seed);
    const i2 = this.vert(pts[2], n, col, uvo[2], kind, seed);
    this.I.push(i0, i1, i2);
  }

  /** Vertical wall between two ground points, metric UVs (u along the wall, v up). */
  wall(ax, az, bx, bz, y0, y1, col, kind, seed, v0 = 0, u0 = 0) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-6;
    const n = [-dz / len, 0, dx / len];
    const h = y1 - y0;
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], n, col, kind, seed, [[u0, v0], [u0 + len, v0], [u0 + len, v0 + h], [u0, v0 + h]]);
  }

  /** Four walls and a flat top. */
  box(x0, x1, z0, z1, y0, y1, col, kind, seed, roofCol = null, roofKind = K.roof) {
    this.wall(x0, z1, x1, z1, y0, y1, col, kind, seed);
    this.wall(x1, z1, x1, z0, y0, y1, col, kind, seed, 0, 17);
    this.wall(x1, z0, x0, z0, y0, y1, col, kind, seed, 0, 5);
    this.wall(x0, z0, x0, z1, y0, y1, col, kind, seed, 0, 31);
    if (roofCol) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], roofCol, roofKind, seed, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]]);
  }

  /** Roof prism along an axis; profile = [[across, y]…] from one eave over the ridge to the other. */
  prism(axis, a0, a1, profile, roofCol, wallCol, wallKind, seed, c0 = 0) {
    const P = (a, c, y) => (axis === 'x' ? [a, y, c] : [c, y, a]);
    for (let i = 0; i < profile.length - 1; i++) {
      const [c1, y1] = profile[i], [c2, y2] = profile[i + 1];
      const dc = c2 - c1, dy = y2 - y1, l = Math.hypot(dc, dy);
      const nn = axis === 'x' ? [0, dc / l, -dy / l] : [-dy / l, dc / l, 0];
      // outward normal: (dy, -dc) rotated to point up/out
      const n2 = axis === 'x' ? [0, Math.abs(dc) / l, -Math.sign(dc || 1) * dy / l] : [-Math.sign(dc || 1) * dy / l, Math.abs(dc) / l, 0];
      void nn;
      this.quad(P(a0, c1, y1), P(a1, c1, y1), P(a1, c2, y2), P(a0, c2, y2), n2, roofCol, K.roof, seed, [[0, 0], [a1 - a0, 0], [a1 - a0, l], [0, l]]);
    }
    // gable end caps (fan)
    for (const [a, sgn] of [[a0, -1], [a1, 1]]) {
      const n = axis === 'x' ? [sgn, 0, 0] : [0, 0, sgn];
      const base = profile[0][1];
      for (let i = 1; i < profile.length - 1; i++) {
        this.tri(P(a, profile[0][0], base), P(a, profile[i][0], profile[i][1]), P(a, profile[i + 1][0], profile[i + 1][1]), n, wallCol, wallKind, seed, [[profile[0][0], 0], [profile[i][0], profile[i][1] - base], [profile[i + 1][0], profile[i + 1][1] - base]]);
      }
    }
    void c0;
  }

  gable(x0, x1, z0, z1, y, rh, ridge, roofCol, wallCol, wallKind, seed, over = 0.4) {
    if (ridge === 'x') {
      const zc = (z0 + z1) / 2;
      this.prism('x', x0 - over, x1 + over, [[z0 - over, y], [zc, y + rh], [z1 + over, y]], roofCol, wallCol, wallKind, seed);
    } else {
      const xc = (x0 + x1) / 2;
      this.prism('z', z0 - over, z1 + over, [[x0 - over, y], [xc, y + rh], [x1 + over, y]], roofCol, wallCol, wallKind, seed);
    }
  }

  cyl(cx, cz, r, y0, y1, seg, col, kind, seed, capH = 0, capCol = null) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p0 = [cx + Math.cos(a0) * r, 0, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, 0, cz + Math.sin(a1) * r];
      this.quad([p0[0], y0, p0[2]], [p1[0], y0, p1[2]], [p1[0], y1, p1[2]], [p0[0], y1, p0[2]], [Math.cos(am), 0, Math.sin(am)], col, kind, seed, [[a0 * r, 0], [a1 * r, 0], [a1 * r, y1 - y0], [a0 * r, y1 - y0]]);
      if (capH > 0) {
        const cc = capCol || col;
        const nz = r / Math.hypot(r, capH);
        this.tri([p0[0], y1, p0[2]], [p1[0], y1, p1[2]], [cx, y1 + capH, cz], [Math.cos(am) * nz, capH / Math.hypot(r, capH), Math.sin(am) * nz], cc, K.roof, seed, [[0, 0], [1, 0], [0.5, 1]]);
      }
    }
    if (capH === 0) {
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        this.tri([cx + Math.cos(a0) * r, y1, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y1, cz + Math.sin(a1) * r], [cx, y1, cz], [0, 1, 0], capCol || col, K.roof, seed, [[0, 0], [1, 0], [0.5, 1]]);
      }
    }
  }

  /** A flat panel on a wall carrying a sign-atlas rectangle. */
  signQuad(a, b, c, d, n, u0, v0, u1, v1, seed) {
    this.quad(a, b, c, d, n, [1, 1, 1], K.sign, seed, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }
}

/** Sign atlas: business and town names drawn on demand into one canvas (shared by every building). */
export class SignAtlas {
  constructor() {
    this.cols = 4;
    this.rows = 64;
    this.cw = 256;
    this.ch = 64;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols * this.cw;
    this.canvas.height = this.rows * this.ch;
    this.g = this.canvas.getContext('2d');
    this.g.fillStyle = '#222';
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.slots = new Map();
    this.next = 0;
  }

  slot(text, style = 0) {
    const key = `${style}|${text}`;
    let s = this.slots.get(key);
    if (s === undefined) {
      s = this.next++ % (this.cols * this.rows);
      this.slots.set(key, s);
      this.draw(s, text, style);
    }
    const cx = s % this.cols, cy = Math.floor(s / this.cols);
    const e = 0.004;
    return [cx / this.cols + e, 1 - (cy + 1) / this.rows + e, (cx + 1) / this.cols - e, 1 - cy / this.rows - e];
  }

  draw(s, text, style) {
    const g = this.g, x = (s % this.cols) * this.cw, y = Math.floor(s / this.cols) * this.ch;
    const pal = [['#7a1f1a', '#f4ecd8'], ['#1f4a3a', '#f2f0e0'], ['#23395b', '#f7f3e3'], ['#e8dfc6', '#3a2a1a'], ['#3b2a1a', '#e9d9b0'], ['#f4f4f0', '#1f2a44']][style % 6];
    g.fillStyle = pal[0];
    g.fillRect(x, y, this.cw, this.ch);
    g.strokeStyle = pal[1];
    g.lineWidth = 3;
    g.strokeRect(x + 4, y + 4, this.cw - 8, this.ch - 8);
    g.fillStyle = pal[1];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = String(text).split('\n');
    const maxSize = lines.length > 1 ? 27 : 34;
    let size = maxSize;
    const font = (z) => `700 ${z}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.font = font(size);
    while (lines.some((l) => g.measureText(l).width > this.cw - 24) && size > 12) {
      size -= 2;
      g.font = font(size);
    }
    const lh = size * 1.02;
    lines.forEach((l, i) => g.fillText(l, x + this.cw / 2, y + this.ch / 2 + 2 + (i - (lines.length - 1) / 2) * lh));
    this.texture.needsUpdate = true;
  }
}

/** Build one lot into the geometry builder. `y0` is the plateau height. */
export function buildLot(gb, lot, node, atlas) {
  const rnd = prng(lot.seed);
  const { x, z, w, d } = lot;
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  const y0 = node.h - 0.1, seed = rnd() * 100;
  const wall = WALL[lot.pal % WALL.length], roof = ROOF[Math.floor(rnd() * ROOF.length)];
  const top = y0 + lot.h;
  const face = lot.facing === 'z-' ? -1 : 1;
  // Sign on a z-facing wall; corners are ordered so the text reads left→right for a viewer in front
  const signOn = (text, zFace, xc, yb, sw, sh, style = null) => {
    if (!text) return;
    const [u0, v0, u1, v1] = atlas.slot(text, style ?? hashStr(text) % 6);
    const zf = zFace + face * 0.06;
    const xl = xc - face * (sw / 2), xr = xc + face * (sw / 2);
    gb.signQuad([xl, yb, zf], [xr, yb, zf], [xr, yb + sh, zf], [xl, yb + sh, zf], [0, 0, face], u0, v0, u1, v1, seed);
  };
  switch (lot.k) {
    case 'house': {
      gb.box(x0, x1, z0, z1, y0, top, wall, K.house, seed);
      const rh = Math.min(w, d) * 0.3;
      gb.gable(x0, x1, z0, z1, top, rh, lot.ridge, roof, wall, K.house, seed);
      // chimney
      gb.box(x0 + w * 0.3, x0 + w * 0.3 + 0.9, z0 + d * 0.3, z0 + d * 0.3 + 0.9, top, top + rh + 1.1, lin([0.45, 0.22, 0.18]), K.plain, seed, lin([0.2, 0.2, 0.2]));
      // porch
      const pz = face > 0 ? z1 : z0;
      gb.box(x + w * 0.1 - 1.6, x + w * 0.1 + 1.6, face > 0 ? pz : pz - 1.6, face > 0 ? pz + 1.6 : pz, y0, y0 + 0.5, lin([0.5, 0.45, 0.4]), K.plain, seed, lin([0.5, 0.45, 0.4]));
      // garage door
      gb.quad([x0 + w * 0.62, y0, pz + face * 0.05], [x0 + w * 0.9, y0, pz + face * 0.05], [x0 + w * 0.9, y0 + 2.2, pz + face * 0.05], [x0 + w * 0.62, y0 + 2.2, pz + face * 0.05], [0, 0, face], lin([0.8, 0.8, 0.78]), K.metal, seed, [[0, 0], [4, 0], [4, 2.2], [0, 2.2]]);
      break;
    }
    case 'cabin':
    case 'lodge': {
      gb.box(x0, x1, z0, z1, y0, top, lin([0.42, 0.28, 0.16]), K.metal, seed);
      const rh = Math.min(w, d) * (lot.k === 'lodge' ? 0.34 : 0.4);
      gb.gable(x0, x1, z0, z1, top, rh, lot.ridge, ROOF[2], lin([0.42, 0.28, 0.16]), K.house, seed);
      gb.box(x1 - 2.2, x1 - 0.8, z0 + 1, z0 + 2.4, y0, top + rh + 1.2, STONE, K.plain, seed, lin([0.2, 0.2, 0.2]));
      if (lot.sign) signOn(lot.sign, z1, x, y0 + 2.6, Math.min(w * 0.6, 8), 1.6, 1);
      break;
    }
    case 'shop': {
      const col = WALL[lot.pal % 8];
      gb.box(x0, x1, z0, z1, y0, top, col, K.shop, seed, lin([0.35, 0.35, 0.37]));
      // parapet / false front
      const fz = face > 0 ? z1 : z0;
      gb.box(x0, x1, face > 0 ? fz - 0.3 : fz, face > 0 ? fz : fz + 0.3, top, top + 1.4, col, K.plain, seed, col);
      // awning
      const aw = lin([[0.6, 0.15, 0.12], [0.15, 0.35, 0.25], [0.15, 0.25, 0.5], [0.7, 0.55, 0.2]][Math.floor(rnd() * 4)]);
      gb.quad([x0 + 0.3, y0 + 3.0, fz], [x1 - 0.3, y0 + 3.0, fz], [x1 - 0.3, y0 + 2.5, fz + face * 1.5], [x0 + 0.3, y0 + 2.5, fz + face * 1.5], [0, 0.6, face * 0.8], aw, K.roof, seed);
      signOn(lot.sign, fz, x, y0 + 3.3, Math.min(w - 1.2, 7.5), 1.3);
      break;
    }
    case 'store': {
      gb.box(x0, x1, z0, z1, y0, top, WALL[lot.pal % 8], K.shop, seed, lin([0.35, 0.35, 0.37]));
      signOn(lot.sign, face > 0 ? z1 : z0, x, y0 + 3.2, Math.min(w - 1, 7), 1.2);
      break;
    }
    case 'shed': {
      gb.box(x0, x1, z0, z1, y0, top, WALL[lot.pal % 12], K.metal, seed, ROOF[5]);
      if (lot.sign) signOn(lot.sign, face > 0 ? z1 : z0, x, y0 + 2.2, Math.min(w - 1, 5.6), 0.9);
      break;
    }
    case 'office':
    case 'apt': {
      const brick = lot.k === 'apt' || lot.pal === 4;
      const col = brick ? WALL[4] : WALL[lot.pal % 8];
      gb.box(x0, x1, z0, z1, y0, top, col, brick ? K.brick : K.office, seed, lin([0.3, 0.3, 0.32]));
      // parapet and rooftop units
      gb.box(x0 + 0.2, x1 - 0.2, z0 + 0.2, z1 - 0.2, top, top + 0.7, col, K.plain, seed, null);
      for (let i = 0; i < 2; i++) gb.box(x0 + 2 + rnd() * (w - 7), x0 + 4.5 + rnd() * (w - 7), z0 + 2, z0 + 4, top, top + 1.8, STEEL, K.metal, seed, STEEL);
      break;
    }
    case 'tower': {
      const glass = lot.pal >= 8;
      const col = glass ? WALL[lot.pal % 12] : WALL[lot.pal % 8];
      const kind = glass ? K.glass : K.office;
      const hb = lot.h * 0.55, hm = lot.h * 0.35;
      gb.box(x0, x1, z0, z1, y0, y0 + hb, col, kind, seed, lin([0.3, 0.3, 0.32]));
      const ix = w * 0.1, iz = d * 0.1;
      gb.box(x0 + ix, x1 - ix, z0 + iz, z1 - iz, y0 + hb, y0 + hb + hm, col, kind, seed + 7, lin([0.3, 0.3, 0.32]));
      const jx = w * 0.22, jz = d * 0.22;
      gb.box(x0 + jx, x1 - jx, z0 + jz, z1 - jz, y0 + hb + hm, top, col, kind, seed + 3, lin([0.3, 0.3, 0.32]));
      if (rnd() < 0.7) gb.box(x - 0.2, x + 0.2, z - 0.2, z + 0.2, top, top + 8 + rnd() * 10, STEEL, K.plain, seed, STEEL);
      break;
    }
    case 'warehouse': {
      gb.box(x0, x1, z0, z1, y0, top, WALL[9], K.metal, seed);
      gb.gable(x0, x1, z0, z1, top, 0.9, lot.ridge, ROOF[5], WALL[9], K.metal, seed, 0.2);
      for (let i = 0; i < Math.floor(w / 14); i++) gb.quad([x0 + 4 + i * 12, y0, z1 + 0.05], [x0 + 8 + i * 12, y0, z1 + 0.05], [x0 + 8 + i * 12, y0 + 3.4, z1 + 0.05], [x0 + 4 + i * 12, y0 + 3.4, z1 + 0.05], [0, 0, 1], lin([0.78, 0.78, 0.76]), K.plain, seed);
      break;
    }
    case 'silo':
    case 'bin': {
      const r = lot.r || 4;
      gb.cyl(x, z, r, y0, top, 14, lot.k === 'bin' ? WALL[9] : lin([0.72, 0.72, 0.7]), lot.k === 'bin' ? K.metal : K.plain, seed, r * 0.55, lin([0.5, 0.52, 0.55]));
      break;
    }
    case 'elevator': {
      gb.box(x0, x1, z0, z1, y0, top, lin([0.78, 0.76, 0.7]), K.plain, seed, lin([0.5, 0.5, 0.5]));
      gb.box(x0 + w * 0.2, x1 - w * 0.2, z0 + d * 0.2, z1 - d * 0.2, top, top + 7, lin([0.6, 0.6, 0.58]), K.plain, seed, lin([0.4, 0.4, 0.4]));
      gb.box(x1, x1 + 1.2, z0 + 2, z1 - 2, y0, y0 + 4, lin([0.7, 0.68, 0.62]), K.plain, seed, lin([0.45, 0.45, 0.45]));
      signOn(node.name?.toUpperCase().slice(0, 18), z1, x, top * 0 + y0 + lot.h * 0.55, w * 0.9, 2.6, 3);
      break;
    }
    case 'watertower': {
      const r = lot.r || 4;
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) gb.box(x + dx * r * 0.7 - 0.25, x + dx * r * 0.7 + 0.25, z + dz * r * 0.7 - 0.25, z + dz * r * 0.7 + 0.25, y0, y0 + lot.h * 0.62, STEEL, K.plain, seed, STEEL);
      gb.cyl(x, z, r, y0 + lot.h * 0.62, top, 18, lin([0.82, 0.82, 0.8]), K.plain, seed, r * 0.5, lin([0.6, 0.62, 0.64]));
      break;
    }
    case 'church': {
      gb.box(x0, x1, z0, z1, y0, top, lin([0.94, 0.93, 0.9]), K.house, seed);
      gb.gable(x0, x1, z0, z1, top, Math.min(w, d) * 0.55, lot.ridge, ROOF[0], lin([0.94, 0.93, 0.9]), K.house, seed, 0.5);
      const sz = z1 - 3;
      gb.box(x - 2.4, x + 2.4, sz - 2.4, sz + 2.4, y0, top + 9, lin([0.94, 0.93, 0.9]), K.house, seed, null);
      gb.cyl(x, sz, 3.4, top + 9, top + 9.01, 4, WHITE, K.plain, seed, 11, lin([0.3, 0.3, 0.34]));
      break;
    }
    case 'school': {
      gb.box(x0, x1, z0, z1, y0, top, WALL[4], K.brick, seed, lin([0.3, 0.3, 0.32]));
      gb.box(x - 4, x + 4, z1, z1 + 2, y0, y0 + 4.2, lin([0.7, 0.66, 0.6]), K.plain, seed, lin([0.35, 0.35, 0.37]));
      break;
    }
    case 'courthouse': {
      gb.box(x0, x1, z0, z1, y0, top, lin([0.78, 0.72, 0.62]), K.brick, seed, lin([0.35, 0.35, 0.37]));
      gb.box(x - 3, x + 3, z - 3, z + 3, top, top + 9, lin([0.78, 0.72, 0.62]), K.office, seed, null);
      gb.cyl(x, z, 4.2, top + 9, top + 9.01, 4, lin([0.5, 0.5, 0.5]), K.plain, seed, 6, lin([0.3, 0.36, 0.32]));
      for (let i = -3; i <= 3; i++) gb.box(x + i * 4.6 - 0.35, x + i * 4.6 + 0.35, z1, z1 + 1.8, y0, top, WHITE, K.plain, seed, WHITE);
      break;
    }
    case 'hospital': {
      gb.box(x0, x1, z0, z1, y0, top, lin([0.9, 0.9, 0.88]), K.office, seed, lin([0.4, 0.4, 0.42]));
      gb.box(x - 6, x + 6, z1, z1 + 3, y0, y0 + 4, lin([0.85, 0.85, 0.82]), K.plain, seed, lin([0.4, 0.4, 0.42]));
      break;
    }
    case 'canopy': {
      const hh = lot.h;
      gb.box(x0, x1, z0, z1, hh, hh + 0.9, lot.pal === 7 ? lin([0.78, 0.18, 0.14]) : WHITE, K.plain, seed, lin([0.8, 0.8, 0.82]));
      for (const [px, pz] of [[x0 + 1, z0 + 1], [x1 - 1, z0 + 1], [x0 + 1, z1 - 1], [x1 - 1, z1 - 1]]) gb.box(px - 0.3, px + 0.3, pz - 0.3, pz + 0.3, y0, hh, WHITE, K.plain, seed, null);
      gb.quad([x0 + 0.2, hh - 0.01, z1 - 0.2], [x1 - 0.2, hh - 0.01, z1 - 0.2], [x1 - 0.2, hh - 0.01, z0 + 0.2], [x0 + 0.2, hh - 0.01, z0 + 0.2], [0, -1, 0], [1, 1, 1], K.panel, seed);
      const pumps = lot.pumps || 4;
      for (let i = 0; i < pumps; i++) {
        const px = x0 + (w * (i + 0.5)) / pumps;
        gb.box(px - 0.4, px + 0.4, z - 0.35, z + 0.35, y0, y0 + 1.5, lin([0.8, 0.1, 0.1]), K.plain, seed, lin([0.2, 0.2, 0.2]));
      }
      break;
    }
    case 'barn': {
      gb.box(x0, x1, z0, z1, y0, top - 2.5, WALL[4], K.metal, seed);
      const c = (z0 + z1) / 2, hw = d / 2;
      gb.prism('x', x0 - 0.4, x1 + 0.4, [[z0 - 0.3, top - 2.5], [c - hw * 0.62, top - 0.4], [c, top + 1.7], [c + hw * 0.62, top - 0.4], [z1 + 0.3, top - 2.5]], ROOF[5], WALL[4], K.metal, seed);
      gb.quad([x - 2.2, y0, z1 + 0.05], [x + 2.2, y0, z1 + 0.05], [x + 2.2, y0 + 4, z1 + 0.05], [x - 2.2, y0 + 4, z1 + 0.05], [0, 0, 1], WHITE, K.plain, seed);
      break;
    }
    case 'windmill': {
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) gb.box(x + dx * 1.2 - 0.1, x + dx * 1.2 + 0.1, z + dz * 1.2 - 0.1, z + dz * 1.2 + 0.1, y0, y0 + lot.h * 0.8, STEEL, K.plain, seed, STEEL);
      for (let b = 0; b < 12; b++) {
        const a = (b / 12) * Math.PI * 2, cy = y0 + lot.h;
        gb.quad([x, cy, z], [x, cy + Math.sin(a) * 2.2, z + Math.cos(a) * 2.2], [x + 0.05, cy + Math.sin(a + 0.15) * 2.2, z + Math.cos(a + 0.15) * 2.2], [x + 0.05, cy, z], [1, 0, 0], WHITE, K.plain, seed);
      }
      break;
    }
    case 'rv': {
      gb.box(x0, x1, z0, z1, y0, top, lin([0.9, 0.9, 0.88]), K.office, seed, lin([0.8, 0.8, 0.82]));
      break;
    }
    case 'pavilion': {
      for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) gb.box(px - 0.2, px + 0.2, pz - 0.2, pz + 0.2, y0, top, lin([0.4, 0.28, 0.18]), K.plain, seed, null);
      gb.gable(x0, x1, z0, z1, top, 1.6, 'x', ROOF[2], lin([0.4, 0.28, 0.18]), K.plain, seed, 0.5);
      break;
    }
    case 'field': {
      gb.quad([x0, y0 + 0.14, z1], [x1, y0 + 0.14, z1], [x1, y0 + 0.14, z0], [x0, y0 + 0.14, z0], [0, 1, 0], lin([0.18, 0.4, 0.16]), K.plain, seed);
      break;
    }
    default:
      gb.box(x0, x1, z0, z1, y0, top, wall, K.house, seed, roof);
  }
}

export function geometryFromBuilder(gb) {
  if (!gb.I.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(gb.P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(gb.N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(gb.C, 3));
  g.setAttribute('aUVM', new THREE.Float32BufferAttribute(gb.U, 2));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(gb.K, 2));
  g.setIndex(gb.I);
  g.computeBoundingSphere();
  return g;
}

export { GB };

export function makeBuildingMaterial(season, atlas) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.6 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = season.u.uNight;
    sh.uniforms.uWet = season.u.uWet;
    sh.uniforms.tSigns = { value: atlas.texture };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aUVM;\nattribute vec2 aInfo;\nvarying vec2 vUVM;\nvarying vec2 vInfo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUVM = aUVM; vInfo = aInfo;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        uniform float uWet;
        uniform sampler2D tSigns;
        varying vec2 vUVM;
        varying vec2 vInfo;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float bk = floor(vInfo.x + 0.5);
        float bseed = vInfo.y;
        vec2 bp = vUVM;
        float bwin = 0.0;
        float blit = 0.0;
        float brough = 0.85;
        vec3 bwall = diffuseColor.rgb;
        vec3 bglass = vec3(0.012, 0.02, 0.03);
        if (bk == 12.0) {
          vec4 sg = texture2D(tSigns, vUVM);
          diffuseColor.rgb = sg.rgb;
          blit = 1.0;
        } else if (bk == 13.0) {
          diffuseColor.rgb = vec3(1.0);
          bwin = 1.0;
          blit = 1.0;
        } else if (bk == 5.0) {
          float sh = 0.9 + 0.1 * sin(bp.y * 5.5) * 0.5 + 0.06 * (vn(bp * 1.7) - 0.5);
          diffuseColor.rgb *= sh;
        } else if (bk != 4.0) {
          vec2 cell = vec2(3.0, 3.1);
          vec2 f = vec2(0.0);
          vec2 id = vec2(0.0);
          float ww = 0.0;
          if (bk == 0.0) {
            cell = vec2(3.4, 3.0);
            f = fract(bp / cell); id = floor(bp / cell);
            ww = step(0.34, f.x) * step(f.x, 0.66) * step(0.38, f.y) * step(f.y, 0.78) * step(2.4, bp.y + 3.0);
            ww *= step(0.5, bp.y);
            bwall *= 0.94 + 0.06 * sin(bp.y * 14.0);
          } else if (bk == 1.0) {
            cell = vec2(3.2, 3.6);
            f = fract(bp / cell); id = floor(bp / cell);
            float ground = step(bp.y, 3.0) * step(0.45, bp.y);
            float mull = step(0.06, fract(bp.x / 2.4)) * step(fract(bp.x / 2.4), 0.94);
            float upper = step(0.3, f.x) * step(f.x, 0.7) * step(0.35, f.y) * step(f.y, 0.8) * step(3.0, bp.y);
            ww = max(ground * mull, upper);
          } else if (bk == 2.0 || bk == 7.0) {
            cell = vec2(2.8, bk == 7.0 ? 3.2 : 3.7);
            f = fract(bp / cell); id = floor(bp / cell);
            ww = step(0.14, f.x) * step(f.x, 0.86) * step(0.25, f.y) * step(f.y, 0.8) * step(0.9, bp.y);
            if (bk == 7.0) { ww *= step(0.22, f.x) * step(f.x, 0.78); bwall *= 0.92 + 0.08 * step(0.5, fract(bp.y * 5.0)); }
          } else if (bk == 3.0) {
            bwall *= 0.88 + 0.12 * step(0.5, fract(bp.x * 2.6));
            f = fract(bp / vec2(8.0, 8.0)); id = floor(bp / vec2(8.0, 8.0));
            ww = step(0.3, f.x) * step(f.x, 0.5) * step(0.5, f.y) * step(f.y, 0.62) * step(2.5, bp.y) * step(0.7, h21(id + bseed));
          } else if (bk == 6.0) {
            cell = vec2(1.7, 3.9);
            f = fract(bp / cell); id = floor(bp / cell);
            ww = step(0.05, f.x) * step(f.x, 0.95) * step(0.2, f.y) * step(f.y, 0.96) * step(0.9, bp.y);
          }
          float rnd = h21(id + vec2(bseed, bseed * 1.7));
          blit = step(0.5 - 0.3 * uNight, rnd) * step(0.28, uNight) * (0.4 + 0.6 * step(0.3, h21(id * 3.1 + bseed)));
          bwin = ww;
          vec3 curt = mix(vec3(1.0, 0.72, 0.38), vec3(0.8, 0.9, 1.0), step(0.78, rnd));
          diffuseColor.rgb = mix(bwall, bglass + 0.05 * curt * blit * 0.0, bwin);
          brough = mix(0.82, 0.12, bwin);
          vBLitCol = curt;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = brough;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vBLitCol * bwin * blit * uNight * 1.7;
        if (bk == 12.0) totalEmissiveRadiance += diffuseColor.rgb * uNight * 0.7;`);
    // declare the lit colour next to the other locals
    sh.fragmentShader = sh.fragmentShader.replace('float bk = floor(vInfo.x + 0.5);', 'float bk = floor(vInfo.x + 0.5);\n        vec3 vBLitCol = vec3(1.0, 0.8, 0.5);');
  };
  mat.customProgramCacheKey = () => 'townBuildings';
  return mat;
}
