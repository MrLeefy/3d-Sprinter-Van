// Settlement layouts (pure JS). Every settlement is an axis-aligned street grid whose main street
// runs east–west through the node and whose main avenue runs north–south; the four highway "ports"
// sit where those two streets leave the built-up area, so inter-town roads simply continue as
// Main Street. All footprints are axis-aligned rectangles (cheap collision, cheap merging).
import { hash2, prng, clamp, lerp } from './noise.js';
import { STREETS, BUSINESSES } from './names.js';

export const TILE = 96;
export const tileKey = (tx, tz) => (tx + 32768) * 65536 + (tz + 32768);
const FH = 3.1; // storey height (m)

/** Parked-vehicle models, indexed by the `kind` of a car prop. 6–8 are tractor + trailer rigs (~22 m). */
export const CAR_MODELS = ['sedan', 'suv', 'hatch', 'van', 'pickup', 'tractor', 'dryvan', 'tanker', 'flatbed'];
export const CAR_LEN = [4.72, 4.78, 4.05, 5.9, 6.0, 8.6, 22.5, 22.5, 22.5];
/** Yaw whose forward vector (cos r, -sin r) points along (dx, dz) — the convention of every car and furniture prop. */
export const faceRot = (dx, dz) => Math.atan2(-dz, dx);
const SW = 3.4; // sidewalk width, matches the block inset

class Layout {
  constructor(world, n) {
    this.world = world;
    this.node = n;
    this.lots = [];
    this.streets = [];
    this.blocks = [];
    this.props = { lamps: [], trees: [], cars: [], misc: [] };
    this.rails = []; // [ax, az, bx] east–west track centrelines
    this.peds = []; // [x, z, dx, dz, len, speed, phase, seed] sidewalk walkers
    this.zones = [];
    this.signs = [];
    this.tiles = new Map();
    this.rng = prng(n.seed);
  }

  tile(tx, tz) {
    const k = tileKey(tx, tz);
    let t = this.tiles.get(k);
    if (!t) this.tiles.set(k, (t = { lots: [], streets: [], blocks: [], lamps: [], trees: [], cars: [], misc: [], signs: [], rails: [], peds: [] }));
    return t;
  }

  reg(kind, id, x0, x1, z0, z1) {
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) this.tile(tx, tz)[kind].push(id);
  }

  /** A building footprint. k = kind; o = { floors, roof, pal, solid, h, ridge } */
  lot(k, x, z, w, d, o = {}) {
    const floors = o.floors ?? 1;
    const spec = {
      id: this.lots.length, k, x, z, w, d, floors, h: o.h ?? floors * (o.fh ?? FH), roof: o.roof ?? 'flat', pal: o.pal ?? 0, solid: o.solid !== false,
      ridge: o.ridge ?? (w >= d ? 'x' : 'z'), seed: Math.floor(this.rng() * 4294967296), sign: o.sign || null, r: o.r || 0, ...(o.extra || {}),
    };
    this.lots.push(spec);
    this.reg('lots', spec.id, x - w / 2 - 1, x + w / 2 + 1, z - d / 2 - 1, z + d / 2 + 1);
    return spec;
  }

  /** True if a footprint would overlap an existing solid lot or reserved rectangle. */
  hit(x, z, w, d, m = 1.2) {
    for (const l of this.lots) {
      if (!l.solid) continue;
      if (Math.abs(l.x - x) < (l.w + w) / 2 + m && Math.abs(l.z - z) < (l.d + d) / 2 + m) return true;
    }
    for (const r of this.reserved || []) if (x + w / 2 > r.x0 && x - w / 2 < r.x1 && z + d / 2 > r.z0 && z - d / 2 < r.z1) return true;
    return false;
  }

  street(ax, az, bx, bz, w, kind, name = '') {
    const s = { id: this.streets.length, ax, az, bx, bz, w, kind, name, x0: Math.min(ax, bx) - w / 2, x1: Math.max(ax, bx) + w / 2, z0: Math.min(az, bz) - w / 2, z1: Math.max(az, bz) + w / 2 };
    this.streets.push(s);
    this.reg('streets', s.id, s.x0, s.x1, s.z0, s.z1);
    return s;
  }

  block(r, zone, pave = false, sidewalk = true) {
    const b = { id: this.blocks.length, ...r, zone, pave, sidewalk };
    this.blocks.push(b);
    this.reg('blocks', b.id, r.ox0 ?? r.x0, r.ox1 ?? r.x1, r.oz0 ?? r.z0, r.oz1 ?? r.z1);
    return b;
  }

  prop(kind, arr, rad = 1) {
    const list = this.props[kind];
    const id = list.length;
    list.push(arr);
    this.reg(kind, id, arr[0] - rad, arr[0] + rad, arr[1] - rad, arr[1] + rad);
    return id;
  }

  /** Street furniture / small scenery: [x, z, rot, type, a, b, c]. */
  furn(type, x, z, rot = 0, a = 0, b = 0, c = 0, rad = 1) {
    return this.prop('misc', [x, z, rot, type, a, b, c], rad);
  }

  /** East–west railway line from (ax, az) to (bx, az). */
  rail(ax, az, bx) {
    const id = this.rails.length;
    this.rails.push([ax, az, bx]);
    this.reg('rails', id, ax, bx, az - 3, az + 3);
    return id;
  }

  ped(x, z, dx, dz, len, speed, phase, seed) {
    const id = this.peds.length;
    this.peds.push([x, z, dx, dz, len, speed, phase, seed]);
    this.reg('peds', id, Math.min(x, x + dx * len) - 1, Math.max(x, x + dx * len) + 1, Math.min(z, z + dz * len) - 1, Math.max(z, z + dz * len) + 1);
    return id;
  }

  tree(x, z, s = 1, type = null) {
    if (type == null) type = this.rng() < 0.45 ? 0 : 1;
    this.prop('trees', [x, z, s, type]);
  }

  car(x, z, rot, kind = 0, rn = this.rng()) {
    return this.prop('cars', [x, z, rot, kind, rn]);
  }

  zone(type, x, z, r, extra = {}) {
    this.zones.push({ type, x, z, r, ...extra });
  }

  /** Solid footprints (axis-aligned) overlapping a rectangle, for collision. */
  collidersIn(x0, x1, z0, z1, out) {
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
      for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) {
        const t = this.tiles.get(tileKey(tx, tz));
        if (!t) continue;
        for (const id of t.lots) {
          const l = this.lots[id];
          if (!l.solid) continue;
          if (l.x + l.w / 2 < x0 || l.x - l.w / 2 > x1 || l.z + l.d / 2 < z0 || l.z - l.d / 2 > z1) continue;
          out.push(l);
        }
      }
    }
    return out;
  }
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** Everyday passenger-vehicle mix: sedan, SUV, hatch, van, pickup. */
const carKind = (rng) => {
  const r = rng();
  return r < 0.28 ? 0 : r < 0.5 ? 1 : r < 0.62 ? 2 : r < 0.86 ? 4 : 3;
};

/** Cars waiting in a house's driveway (0–2), nose toward the street half the time. */
function driveway(L, lot, rng, len, street = 1) {
  const f = lot.facing === 'z-' ? -1 : 1;
  const gx = lot.x - lot.w / 2 + lot.w * 0.76;
  lot.drive = len;
  const frontZ = f > 0 ? lot.z + lot.d / 2 : lot.z - lot.d / 2;
  const n = rng() < 0.22 ? 0 : rng() < 0.7 ? 1 : 2;
  let off = 0.4;
  for (let i = 0; i < n; i++) {
    const kind = carKind(rng), l = CAR_LEN[kind];
    if (off + l > len - 0.4) break;
    const out = rng() < 0.5 ? f : -f;
    L.car(gx + (rng() - 0.5) * 0.3, frontZ + f * (off + l / 2), faceRot(0, out), kind);
    off += l + 0.7;
  }
  void street;
  // mailbox at the kerb, a hydrant now and then
  const mz = frontZ + f * (len - 0.35);
  L.furn('mailbox', lot.x + lot.w * 0.18, mz, faceRot(0, f));
}

/** Sidewalk strollers along one block edge: segments of 14–40 m walked back and forth. */
function strollers(L, rng, x0, x1, zEdge, count) {
  for (let i = 0; i < count; i++) {
    const len = Math.min(x1 - x0 - 2, 14 + rng() * 26);
    if (len < 6) continue;
    const xs = x0 + 1 + rng() * Math.max(0, x1 - x0 - len - 2);
    L.ped(xs, zEdge, 1, 0, len, 0.9 + rng() * 0.7, rng(), Math.floor(rng() * 1000));
  }
}

// ── Urban fill (cities and towns) ───────────────────────────────────────────
function fillRows(L, r, rng, opt) {
  // two rows of lots against the long edges of the block
  const W = r.x1 - r.x0, D = r.z1 - r.z0;
  const { depth, minW, maxW, setback, k, floors, roof, gap = 3 } = opt;
  for (const side of [-1, 1]) {
    let x = r.x0;
    const zc = side < 0 ? r.z0 + setback + depth / 2 : r.z1 - setback - depth / 2;
    while (x < r.x1 - minW) {
      const w = Math.min(r.x1 - x, minW + rng() * (maxW - minW));
      if (w < minW * 0.9) break;
      if (L.hit(x + w / 2, zc, w - gap, depth)) {
        x += w;
        continue;
      }
      const fl = typeof floors === 'function' ? floors(rng) : floors;
      const lot = L.lot(opt.pick ? opt.pick(rng) : k, x + w / 2, zc, w - gap, depth, { floors: fl, roof: roof ?? 'gable', pal: Math.floor(rng() * 8), ridge: 'x' });
      lot.facing = side < 0 ? 'z-' : 'z+'; // fronts face the street on their side of the block
      if (lot.k === 'house') {
        driveway(L, lot, rng, setback + SW);
        if (rng() < 0.45) {
          // back-yard fence along the rear lot line
          const rz = side < 0 ? zc + depth / 2 + 0.6 : zc - depth / 2 - 0.6;
          L.furn('fence', lot.x, rz, 0, w - gap, 0, 0, w / 2 + 1);
        }
      }
      x += w;
    }
  }
  return D > W; // unused flag
}

function fillBlockUrban(L, r, zone, rng, n, rho, big) {
  const W = r.x1 - r.x0, D = r.z1 - r.z0;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  const walkN = { core: 5, mid: 3, dense: 1, shops: 0, park: 0, courthouse: 2, school: 1, church: 1, hospital: 2, houses: rng() < 0.3 ? 1 : 0 }[zone] || 0;
  for (let i = 0; i < walkN; i++) {
    const north = rng() < 0.5;
    strollers(L, rng, r.x0, r.x1, north ? r.z0 - SW * 0.5 : r.z1 + SW * 0.5, 1);
  }
  if ((zone === 'core' || zone === 'mid' || zone === 'dense') && rng() < 0.6) L.furn('bench', cx + (rng() - 0.5) * W * 0.5, r.z1 + SW * 0.5, faceRot(0, 1), 0, 0, 0, 2);
  if (zone === 'core' || zone === 'mid') for (let i = 0; i < 3; i++) L.tree(r.x0 + 4 + rng() * (W - 8), rng() < 0.5 ? r.z0 - 1.2 : r.z1 + 1.2, 0.7 + rng() * 0.4, 1);
  if (zone === 'core') {
    const towers = rng() < 0.55;
    if (towers) {
      const w = Math.min(W - 6, 30 + rng() * 24), d = Math.min(D - 6, 24 + rng() * 16);
      const fl = Math.round(8 + (1 - clamp(rho / 0.22, 0, 1)) * 16 * (0.4 + 0.8 * rng()));
      L.lot('tower', cx + (rng() - 0.5) * (W - w - 4), cz + (rng() - 0.5) * (D - d - 4), w, d, { floors: fl, fh: 3.8, pal: 8 + Math.floor(rng() * 3), roof: 'flat' });
    } else {
      for (const sx of [-1, 1]) {
        const w = W / 2 - 5, d = Math.min(D - 6, 22 + rng() * 14);
        L.lot('office', cx + sx * (W / 4), cz, w, d, { floors: 4 + Math.floor(rng() * 8), fh: 3.7, pal: Math.floor(rng() * 6), roof: 'flat' });
      }
    }
  } else if (zone === 'mid') {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        if (rng() < 0.12) continue;
        const w = W / 2 - 5 - rng() * 4, d = D / 2 - 5 - rng() * 3;
        const brick = rng() < 0.4; // tall red-brick blocks
        L.lot(brick || rng() < 0.7 ? 'office' : 'apt', cx + sx * (W / 4), cz + sz * (D / 4), w, d, { floors: 3 + Math.floor(rng() * (brick ? 6 : 5)), fh: 3.4, pal: brick ? 4 : Math.floor(rng() * 8), roof: 'flat' });
      }
    }
  } else if (zone === 'dense') {
    fillRows(L, r, rng, { depth: 15, minW: 15, maxW: 24, setback: 4, k: 'apt', floors: (q) => 2 + Math.floor(q() * 3), roof: 'flat' });
    if (rng() < 0.5) for (let i = 0; i < 5; i++) L.tree(r.x0 + 5 + rng() * (W - 10), cz + (rng() - 0.5) * 8, 0.8 + rng() * 0.6);
  } else if (zone === 'houses') {
    fillRows(L, r, rng, { depth: 10 + rng() * 2, minW: 17, maxW: 24, setback: 7, k: 'house', floors: (q) => (q() < 0.25 ? 2 : 1), roof: 'gable' });
    for (let i = 0; i < Math.floor(W / 14); i++) L.tree(r.x0 + 4 + rng() * (W - 8), cz + (rng() - 0.5) * (D * 0.25), 0.8 + rng() * 0.7);
  } else if (zone === 'shops') {
    // frontage on the main street: the block edge nearest z = node.z
    const edge = Math.abs(r.z1 - n.z) < Math.abs(r.z0 - n.z) ? 'z1' : 'z0';
    let x = r.x0;
    const depth = 16 + rng() * 4;
    while (x < r.x1 - 9) {
      const w = Math.min(r.x1 - x, 9 + rng() * 12);
      if (w < 8) break;
      const zc = edge === 'z1' ? r.z1 - depth / 2 : r.z0 + depth / 2;
      if (L.hit(x + w / 2, zc, w - 0.6, depth, 0.4)) {
        x += w + 0.5;
        continue;
      }
      const lot = L.lot('shop', x + w / 2, zc, w - 0.6, depth, { floors: 1 + Math.floor(rng() * (big ? 4 : 2)), fh: 3.6, pal: Math.floor(rng() * 8), roof: 'flat', sign: pick(rng, BUSINESSES) });
      lot.facing = edge === 'z1' ? 'z+' : 'z-';
      x += w + 0.5;
    }
    const by = edge === 'z1' ? r.z0 + (D - depth) / 2 - 3 : r.z1 - (D - depth) / 2 + 3;
    for (let i = 0; i < 4; i++) L.tree(r.x0 + 6 + rng() * (W - 12), by + (rng() - 0.5) * 6, 0.8 + rng() * 0.5);
    // sidewalk benches and strollers on the frontage side
    const sz = edge === 'z1' ? r.z1 + SW * 0.5 : r.z0 - SW * 0.5, fz = edge === 'z1' ? 1 : -1;
    for (let i = 0; i < 2; i++) if (rng() < 0.7) L.furn('bench', r.x0 + 8 + rng() * (W - 16), sz + fz * 0.6, faceRot(0, fz), 0, 0, 0, 2);
    strollers(L, rng, r.x0, r.x1, sz, big ? 3 : 2);
  } else if (zone === 'industrial') {
    const silo = rng() < 0.6;
    const n1 = 1 + Math.floor(rng() * 2);
    const maxW = W - (silo ? 20 : 8);
    for (let i = 0; i < n1; i++) {
      const w = Math.min(maxW, 38 + rng() * 22), d = Math.min(D / n1 - 8, 24 + rng() * 10);
      L.lot('warehouse', r.x0 + 4 + w / 2, r.z0 + 5 + d / 2 + i * (D / n1), w, d, { floors: 1, h: 7 + rng() * 3, pal: 9, roof: 'lowgable' });
    }
    if (silo) L.lot('silo', r.x1 - 7, r.z1 - 7, 8, 8, { h: 18, r: 4, pal: 7 });
  } else if (zone === 'park') {
    for (let i = 0; i < 16; i++) L.tree(r.x0 + 3 + rng() * (W - 6), r.z0 + 3 + rng() * (D - 6), 0.9 + rng() * 0.9);
    L.lot('pavilion', cx, cz, 9, 7, { floors: 1, h: 3.2, roof: 'hip', solid: false, pal: 6 });
    for (let i = 0; i < 4; i++) L.furn('bench', cx + (i < 2 ? -7 : 7), cz + (i % 2 ? 6 : -6), faceRot(0, i % 2 ? -1 : 1), 0, 0, 0, 2);
    for (let i = 0; i < 3; i++) L.ped(r.x0 + 6 + rng() * 10, cz + (rng() - 0.5) * (D - 14), 1, 0, 14 + rng() * (W - 36), 0.8 + rng() * 0.5, rng(), Math.floor(rng() * 1000));
  } else if (zone === 'courthouse') {
    L.lot('courthouse', cx, cz + 3, Math.min(W - 6, 38), Math.min(D - 12, 24), { floors: 3, fh: 4, pal: 5, roof: 'flat', extra: { clock: true } });
    L.furn('flag', cx + 11, r.z1 - 1.5, faceRot(0, 1), 11, 0, 0, 3);
    L.furn('flag', cx - 11, r.z1 - 1.5, faceRot(0, 1), 11, 0, 0, 3);
    for (let i = 0; i < 8; i++) L.tree(r.x0 + 4 + rng() * (W - 8), r.z1 - 4 - rng() * 4, 0.8 + rng() * 0.4);
  } else if (zone === 'church') {
    L.lot('church', cx, cz, 14, 28, { floors: 2, fh: 4.4, pal: 0, roof: 'gable', ridge: 'z' });
    for (let i = 0; i < 6; i++) L.tree(r.x0 + 4 + rng() * (W - 8), r.z0 + 4 + rng() * (D - 8), 0.8 + rng() * 0.6);
  } else if (zone === 'school') {
    L.lot('school', cx, cz - 6, Math.min(W - 8, 52), 16, { floors: 2, fh: 3.8, pal: 4, roof: 'flat' });
    L.furn('flag', cx - 14, cz + 4, faceRot(0, 1), 9, 0, 0, 3);
    L.furn('bus', cx + 20, r.z0 - SW * 0.5 - 0.2, faceRot(0, -1), 0, 0, 0, 3);
    // sports field
    L.lot('field', cx, cz + 17, Math.min(W - 10, 44), 14, { floors: 0, h: 0.05, solid: false });
  } else if (zone === 'hospital') {
    L.lot('hospital', cx, cz, Math.min(W - 8, 46), Math.min(D - 8, 30), { floors: 5, fh: 3.8, pal: 0, roof: 'flat' });
  } else if (zone === 'lot') {
    // car park: a double row of 90-degree bays either side of a 7 m aisle (stripes drawn by the renderer)
    const bw = 2.9, bl = 5.4, aisle = 7.4, n = Math.floor((W - 6) / bw);
    const x0 = cx - (n * bw) / 2;
    for (const sd of [-1, 1]) {
      const zc = cz + sd * (aisle / 2 + bl / 2);
      if (Math.abs(zc - cz) + bl / 2 > D / 2 - 1) continue;
      L.furn('bays', x0, zc, faceRot(0, -sd), n, bw, bl, n * bw / 2 + 2);
      for (let i = 0; i < n; i++) if (rng() < 0.55) L.car(x0 + (i + 0.5) * bw + (rng() - 0.5) * 0.3, zc + (rng() - 0.5) * 0.4, faceRot(0, rng() < 0.5 ? -sd : sd), carKind(rng));
    }
    for (let i = 0; i < 3; i++) L.prop('lamps', [x0 + (i + 0.5) * (n * bw) / 3, cz, i % 2 ? Math.PI / 2 : -Math.PI / 2]);
  } else if (zone === 'ranch') {
    // edge-of-town spread: a big house set back on a fenced lot, outbuildings, shelter belt, pickup in the yard
    const hw = 14 + rng() * 4, hd = 10 + rng() * 2;
    const hx = r.x0 + hw / 2 + 6 + rng() * Math.max(1, W - hw - 40), hz = rng() < 0.5 ? r.z0 + hd / 2 + 8 : r.z1 - hd / 2 - 8;
    const north = hz < cz;
    const house = L.lot('house', hx, hz, hw, hd, { floors: 1 + (rng() < 0.3 ? 1 : 0), fh: 3.2, pal: Math.floor(rng() * 8), roof: 'gable', ridge: 'x' });
    house.facing = north ? 'z-' : 'z+';
    driveway(L, house, rng, 8 + SW);
    if (rng() < 0.7) L.lot('barn', hx + hw / 2 + 18 + rng() * Math.max(0, W - hw - 60), hz + (north ? 6 : -6), 15, 10.5, { h: 8, pal: 4, roof: 'gambrel', ridge: 'x' });
    if (rng() < 0.6) L.lot('shed', r.x1 - 14, north ? r.z1 - 12 : r.z0 + 12, 9, 6, { floors: 1, fh: 3, pal: 7, roof: 'flat' });
    for (let i = 0; i < 10; i++) L.tree(r.x0 + 4 + i * ((W - 8) / 9), north ? r.z1 - 3 : r.z0 + 3, 1.1 + rng() * 0.5, 0);
    // paddock fence along the block's inner edge, with a gap for the drive
    L.furn('fence', cx - W / 4, north ? r.z1 - 8 : r.z0 + 8, 0, W / 2 - 4, 1, 0, W / 4 + 2);
    L.furn('fence', cx + W / 4 + 3, north ? r.z1 - 8 : r.z0 + 8, 0, W / 2 - 6, 1, 0, W / 4 + 2);
  }
}

function urban(L, world, n) {
  const rng = L.rng;
  const G = world.grid(n);
  const big = n.kind === 'city';
  const { x: cx, z: cz, Rp, Rz } = n;
  const Mmax = Math.floor(Rz / G.bz), Kmax = Math.floor(Rp / G.bx);
  const chordX = (dz) => Rp * Math.sqrt(Math.max(0, 1 - (dz / Rz) ** 2)) * 0.97;
  const chordZ = (dx) => Rz * Math.sqrt(Math.max(0, 1 - (dx / Rp) ** 2)) * 0.97;
  // a 25 m rig needs ~10 m to swing a corner: minor streets are never narrower than 11 m
  const wMainH = G.wMain, wMainV = G.wMain - 2, wMin = Math.max(G.wMinor, 11), wRail = 8;
  const hasH = new Map(), hasV = new Map();
  const names = new Set();
  // railway: one block south of Main St in towns, near the southern/northern edge in cities
  const wantRail = hash2(n.i, n.j, 97) < (big ? 0.85 : 0.8);
  const railM = !wantRail ? null : big ? (hash2(n.i, n.j, 98) < 0.5 ? 1 : -1) * Math.max(2, Mmax - 1) : 1;
  const streetName = (seed) => {
    let s, t = 0;
    do s = STREETS[Math.floor(hash2(seed, t++, n.seed) * STREETS.length)];
    while (names.has(s) && t < 30);
    names.add(s);
    return s;
  };
  for (let m = -Mmax; m <= Mmax; m++) {
    const dz = m * G.bz, half = m === 0 ? Rp : chordX(dz);
    if (m !== 0 && half < G.bx * 0.8) continue;
    hasH.set(m, half);
    if (m === railM) {
      L.street(cx - half - 60, cz + dz, cx + half + 60, cz + dz, wRail, 'gravel', 'Railroad Ave');
      L.rail(cx - half - 60, cz + dz, cx + half + 60);
    } else L.street(cx - half, cz + dz, cx + half, cz + dz, m === 0 ? wMainH : wMin, m === 0 ? 'main' : 'minor', m === 0 ? 'Main St' : `${streetName(m * 31 + 1)} St`);
  }
  for (let k = -Kmax; k <= Kmax; k++) {
    const dx = k * G.bx, half = k === 0 ? Rz : chordZ(dx);
    if (k !== 0 && half < G.bz * 0.8) continue;
    hasV.set(k, half);
    L.street(cx + dx, cz - half, cx + dx, cz + half, k === 0 ? wMainV : wMin, k === 0 ? 'main' : 'minor', k === 0 ? 'Center Ave' : `${streetName(k * 37 + 2)} Ave`);
  }
  const wH = (m) => (m === 0 ? wMainH : m === railM ? wRail : wMin), wV = (k) => (k === 0 ? wMainV : wMin);
  const wHalfH = (m) => wH(m) / 2, wHalfV = (k) => wV(k) / 2;
  // specials at the edges are placed first; blocks that would overlap them are dropped
  const side = hash2(n.i, n.j, 91) < 0.5 ? 1 : -1;
  const reserved = (L.reserved = []);
  const rv = (x, z, w, d) => reserved.push({ x0: x - w / 2 - 4, x1: x + w / 2 + 4, z0: z - d / 2 - 4, z1: z + d / 2 + 4 });
  const wtx = cx + side * Rp * 0.3, wtz = cz - Rz * 0.42;
  L.lot('watertower', wtx, wtz, 9, 9, { h: 30, r: 4.5, pal: 7 });
  rv(wtx, wtz, 9, 9);
  if (!big) {
    const ex = cx - side * (Rp * 0.9 - 28);
    L.lot('elevator', ex, cz + G.wMain / 2 + 26, 14, 16, { h: 36, pal: 0 });
    L.lot('silo', ex + 12, cz + G.wMain / 2 + 22, 8, 8, { h: 22, r: 4, pal: 0 });
    L.lot('silo', ex + 12, cz + G.wMain / 2 + 31, 8, 8, { h: 22, r: 4, pal: 0 });
    L.lot('warehouse', ex - 22, cz + G.wMain / 2 + 24, 22, 12, { h: 8, pal: 9, roof: 'lowgable' });
    rv(ex - 4, cz + G.wMain / 2 + 26, 60, 26);
  }
  const gx = cx + side * (Rp * 0.8);
  L.lot('canopy', gx, cz - G.wMain / 2 - 14, 22, 12, { h: 5.2, solid: false, pal: 7, extra: { pumps: 4 } });
  L.lot('store', gx + side * 4, cz - G.wMain / 2 - 28, 15, 9, { floors: 1, fh: 3.6, pal: Math.floor(rng() * 8), roof: 'flat', sign: pick(rng, BUSINESSES) });
  rv(gx + side * 4, cz - G.wMain / 2 - 20, 40, 36);
  L.zone('fuel', gx, cz - G.wMain / 2 - 14, 12, { name: `${n.name} Fuel & Go`, diesel: true });
  L.zone('water', gx + side * 14, cz - G.wMain / 2 - 14, 8, { name: 'Potable water fill' });
  L.zone('shop', gx + side * 4, cz - G.wMain / 2 - 22, 12, { name: pick(rng, ['Prairie Grocery', 'Trailhead Market', 'Elk Creek Mercantile', 'Big Sky Foods']) });
  const hasRV = hash2(n.i, n.j, 92) < 0.75;
  const rvx = cx - side * (Rp * 0.82), rvz = cz + G.wMain / 2 + 36;
  if (hasRV) rv(rvx, rvz, 66, 40);
  // blocks
  const blocks = [];
  for (let k = -Kmax - 1; k <= Kmax; k++) {
    for (let m = -Mmax - 1; m <= Mmax; m++) {
      if (!hasV.has(k) || !hasV.has(k + 1) || !hasH.has(m) || !hasH.has(m + 1)) continue;
      const ox0 = cx + k * G.bx, ox1 = ox0 + G.bx, oz0 = cz + m * G.bz, oz1 = oz0 + G.bz;
      const bxc = (ox0 + ox1) / 2, bzc = (oz0 + oz1) / 2;
      const rho = Math.hypot((bxc - cx) / Rp, (bzc - cz) / Rz);
      const edge = 0.94 + 0.06 * (hash2(k, m, n.seed) - 0.5);
      if (rho > edge) continue;
      if (reserved.some((q) => ox1 > q.x0 && ox0 < q.x1 && oz1 > q.z0 && oz0 < q.z1)) continue;
      const sw = 3.4;
      const r = { ox0, ox1, oz0, oz1, x0: ox0 + wHalfV(k) + sw, x1: ox1 - wHalfV(k + 1) - sw, z0: oz0 + wHalfH(m) + sw, z1: oz1 - wHalfH(m + 1) - sw };
      blocks.push({ r, k, m, rho, key: `${k},${m}` });
    }
  }
  // assign zones
  const zones = new Map();
  const free = [];
  for (const b of blocks) {
    let z;
    if (big) z = b.rho < 0.2 ? 'core' : b.rho < 0.44 ? 'mid' : b.rho < 0.7 ? 'dense' : 'houses';
    else z = (b.m === 0 || b.m === -1) && b.rho < 0.62 ? 'shops' : 'houses';
    zones.set(b.key, z);
    free.push(b);
  }
  const claim = (pred, zone, count = 1) => {
    const c = free.filter((b) => pred(b) && !['courthouse', 'church', 'school', 'hospital', 'park', 'industrial'].includes(zones.get(b.key))).sort((a, b) => hash2(a.k, a.m, n.seed + 5) - hash2(b.k, b.m, n.seed + 5));
    for (let i = 0; i < Math.min(count, c.length); i++) zones.set(c[i].key, zone);
  };
  claim((b) => b.rho < (big ? 0.3 : 0.5), 'courthouse');
  claim((b) => b.rho > 0.15 && b.rho < 0.75, 'park', big ? 4 : 2);
  claim((b) => b.rho > 0.4 && b.rho < 0.85 && zones.get(b.key) === 'houses', 'church', big ? 3 : 1);
  claim((b) => b.rho > 0.4 && b.rho < 0.88 && zones.get(b.key) === 'houses', 'school', big ? 3 : 1);
  if (big) {
    claim((b) => b.rho > 0.18 && b.rho < 0.5 && zones.get(b.key) === 'mid', 'hospital', 1);
    const q = hash2(n.i, n.j, 90) < 0.5 ? 1 : -1;
    claim((b) => b.rho > 0.55 && Math.sign(b.k + 0.5) === q && zones.get(b.key) === 'houses', 'industrial', 5);
    claim((b) => b.rho > 0.3 && zones.get(b.key) === 'dense', 'lot', 3);
  } else {
    claim((b) => b.rho > 0.4 && zones.get(b.key) === 'houses', 'lot', 1);
  }
  for (const b of blocks) {
    const zone = zones.get(b.key);
    const rb = prng(Math.floor(hash2(b.k, b.m, n.seed) * 4294967296));
    L.block({ ...b.r }, zone, ['core', 'mid', 'industrial', 'lot', 'shops', 'courthouse', 'hospital'].includes(zone));
    fillBlockUrban(L, b.r, zone, rb, n, b.rho, big);
  }
  // RV park on the opposite end
  if (hasRV) {
    const rx = rvx, rz = rvz;
    L.street(rx - 26, rz, rx + 26, rz, 6, 'gravel', 'RV Park Loop');
    for (let i = -4; i <= 4; i++) {
      for (const sz of [-1, 1]) L.lot('rv', rx + i * 6, rz + sz * 8, 3, 7.5, { floors: 1, h: 3.2, pal: Math.floor(rng() * 8), roof: 'flat', extra: { rot: Math.PI / 2 } });
    }
    L.zone('camp', rx, rz, 32, { name: `${n.name} RV Park`, hookups: true, fee: 38 });
    L.zone('dump', rx + 28, rz - 2, 9, { name: 'RV dump station' });
    L.lot('shed', rx + 30, rz + 12, 8, 5, { floors: 1, fh: 3, pal: 7, roof: 'flat', sign: 'Office · Showers' });
  }
  // lamps and street trees and parked cars along the main street and avenue
  const lampSpan = (ax, az, bx, bz, w, vertical) => {
    const len = Math.hypot(bx - ax, bz - az), cnt = Math.floor(len / 34);
    for (let i = 0; i <= cnt; i++) {
      const t = i / Math.max(1, cnt);
      for (const sd of [-1, 1]) {
        const x = lerp(ax, bx, t) + (vertical ? sd * (w / 2 + 1.2) : 0), z = lerp(az, bz, t) + (vertical ? 0 : sd * (w / 2 + 1.2));
        L.prop('lamps', [x, z, vertical ? (sd > 0 ? Math.PI : 0) : sd > 0 ? Math.PI / 2 : -Math.PI / 2]);
      }
    }
  };
  for (const s of L.streets) if (s.kind === 'main') lampSpan(s.ax, s.az, s.bx, s.bz, s.w, s.ax === s.bx);
  for (const bl of blocks) {
    // corner lamps for the minor streets
    if (bl.m % 2 === 0 && bl.k % 2 === 0) L.prop('lamps', [bl.r.ox0 + 3, bl.r.oz0 + 3, 0]);
  }
  for (const s of L.streets.filter((q) => q.kind === 'main')) {
    const horiz = s.az === s.bz;
    const len = horiz ? s.bx - s.ax : s.bz - s.az;
    for (let t = 6; t < len - 6; t += 7.2) {
      for (const sd of [-1, 1]) {
        if (rng() < 0.55) continue;
        const along = (horiz ? s.ax : s.az) + t;
        const off = sd * (s.w / 2 - 2.1);
        if (horiz) L.car(along, s.az + off, sd > 0 ? Math.PI : 0, rng() < 0.4 ? 1 : 0);
        else L.car(s.ax + off, along, sd > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      }
    }
  }
}

// ── Villages ────────────────────────────────────────────────────────────────
function village(L, world, n) {
  const rng = L.rng;
  const { x: cx, z: cz, Rp } = n;
  const wMain = 10;
  L.street(cx - Rp, cz, cx + Rp, cz, wMain, 'main', 'Main St');
  const half = n.Rz;
  L.street(cx, cz - half, cx, cz + half, 8, 'minor', 'Depot Rd');
  L.lot('church', cx + 16, cz - wMain / 2 - 18, 10, 20, { floors: 2, fh: 4.2, pal: 0, roof: 'gable', ridge: 'z' });
  const ex = cx + (hash2(n.i, n.j, 93) < 0.5 ? 1 : -1) * (Rp - 26);
  L.lot('elevator', ex, cz + wMain / 2 + 22, 12, 14, { h: 30, pal: 0 });
  L.lot('silo', ex + 11, cz + wMain / 2 + 20, 7, 7, { h: 20, r: 3.5, pal: 0 });
  L.lot('watertower', cx - 40, cz - 32, 8, 8, { h: 24, r: 4, pal: 7 });
  const store = hash2(n.i, n.j, 94) < 0.8;
  if (store) L.reserved = [{ x0: cx - 34, x1: cx + 2, z0: cz - wMain / 2 - 22, z1: cz - wMain / 2 }];
  for (const sd of [-1, 1]) {
    let x = cx - Rp + 14;
    while (x < cx + Rp - 22) {
      if (Math.abs(x - cx) < 9) {
        x += 12;
        continue;
      }
      const w = 14 + rng() * 8;
      const zc = cz + sd * (wMain / 2 + 11 + rng() * 3);
      const k = rng() < 0.12 ? 'shop' : 'house';
      const dd = k === 'shop' ? 12 : 9 + rng() * 2;
      if (!L.hit(x + w / 2, zc, w - 3, dd)) {
        const lot = L.lot(k, x + w / 2, zc, w - 3, dd, { floors: 1, fh: 3.4, pal: Math.floor(rng() * 8), roof: k === 'shop' ? 'flat' : 'gable', sign: k === 'shop' ? pick(rng, BUSINESSES) : null });
        lot.facing = sd < 0 ? 'z+' : 'z-';
        if (rng() < 0.7) L.tree(x + w / 2 + (rng() - 0.5) * 8, zc + sd * 10, 0.8 + rng() * 0.7);
      }
      x += w + 2 + rng() * 6;
    }
  }
  if (store) {
    L.lot('canopy', cx - 12, cz - wMain / 2 - 11, 14, 8, { h: 4.6, solid: false, pal: 7, extra: { pumps: 2 } });
    L.zone('fuel', cx - 12, cz - wMain / 2 - 11, 10, { name: `${n.name} Pump & Pantry`, diesel: true });
    L.zone('water', cx - 22, cz - wMain / 2 - 11, 7, { name: 'Potable water fill' });
    L.zone('shop', cx - 4, cz - wMain / 2 - 14, 10, { name: pick(rng, ['General Store', 'Village Market', 'Dry Goods & Groceries']) });
  }
  for (let i = 0; i < 10; i++) {
    const t = (i / 9) * 2 - 1;
    L.prop('lamps', [cx + t * Rp * 0.8, cz + wMain / 2 + 1.2, -Math.PI / 2]);
  }
}

// ── Farms / ranches ─────────────────────────────────────────────────────────
function farm(L, world, n) {
  const rng = L.rng;
  const { x: cx, z: cz } = n;
  L.street(cx - 36, cz, cx + 36, cz, 5.6, 'gravel', 'Ranch Rd');
  L.street(cx, cz - 36, cx, cz + 36, 5.6, 'gravel', 'Ranch Rd');
  L.lot('house', cx - 15, cz + 13, 13, 9.5, { floors: 1 + (rng() < 0.4 ? 1 : 0), fh: 3.2, pal: Math.floor(rng() * 8), roof: 'gable', ridge: 'x' });
  L.lot('barn', cx + 15, cz - 12, 17, 12, { h: 8.5, pal: 4, roof: 'gambrel', ridge: 'x' });
  L.lot('warehouse', cx + 20, cz + 14, 18, 10, { h: 6, pal: 9, roof: 'lowgable' });
  for (let i = 0; i < 3 + Math.floor(rng() * 2); i++) L.lot('bin', cx - 22 + i * 9, cz - 22, 7, 7, { h: 6.8, r: 3.5, pal: 7 });
  L.lot('windmill', cx - 4, cz - 14, 4, 4, { h: 14, pal: 7 });
  for (let i = 0; i < 14; i++) L.tree(cx - 34 + i * 3.1, cz - 31 + (rng() - 0.5) * 2, 1 + rng() * 0.5, 0);
  for (let i = 0; i < 9; i++) L.tree(cx - 33 + (rng() - 0.5) * 2, cz - 28 + i * 6, 1 + rng() * 0.5, 0);
  L.prop('misc', [cx + 29, cz + 2, 0, 'corral']);
  if (rng() < 0.5) L.zone('water', cx - 4, cz + 20, 7, { name: `${n.name} well` });
}

// ── Lodge ───────────────────────────────────────────────────────────────────
function lodge(L, world, n) {
  const rng = L.rng;
  const { x: cx, z: cz } = n;
  L.street(cx - 48, cz, cx + 48, cz, 6, 'gravel', 'Lodge Rd');
  L.street(cx, cz - 48, cx, cz + 48, 6, 'gravel', 'Lodge Rd');
  L.lot('lodge', cx + 16, cz - 16, 26, 14, { floors: 2, fh: 3.8, pal: 6, roof: 'gable', ridge: 'x', sign: n.name });
  for (let i = 0; i < 5; i++) L.lot('cabin', cx - 30 + (i % 3) * 14, cz + 18 + Math.floor(i / 3) * 14, 7, 6, { floors: 1, fh: 3, pal: 6, roof: 'gable', ridge: 'x' });
  for (let i = 0; i < 18; i++) L.tree(cx + (rng() - 0.5) * 100, cz + (rng() - 0.5) * 100, 1.1 + rng() * 0.8, 0);
  L.zone('shop', cx + 12, cz - 4, 12, { name: `${n.name} Restaurant` });
}

// ── Truck stop / travel plaza ───────────────────────────────────────────────
function truckstop(L, world, n) {
  const rng = L.rng;
  const { x: cx, z: cz } = n;
  L.street(cx - 56, cz, cx + 56, cz, 10, 'main', 'Highway Frontage');
  L.block({ x0: cx - 54, x1: cx + 54, z0: cz - 44, z1: cz - 6, ox0: cx - 54, ox1: cx + 54, oz0: cz - 44, oz1: cz - 6 }, 'lot', true, false);
  L.block({ x0: cx - 54, x1: cx + 54, z0: cz + 6, z1: cz + 44, ox0: cx - 54, ox1: cx + 54, oz0: cz + 6, oz1: cz + 44 }, 'lot', true, false);
  L.lot('canopy', cx - 10, cz - 16, 36, 14, { h: 5.8, solid: false, pal: 7, extra: { pumps: 6 } });
  L.lot('store', cx - 32, cz - 34, 22, 11, { floors: 1, fh: 3.8, pal: 5, roof: 'flat', sign: n.name });
  L.lot('shed', cx + 18, cz - 34, 22, 10, { floors: 1, fh: 3.6, pal: 7, roof: 'flat', sign: pick(rng, BUSINESSES) });
  for (let i = 0; i < 7; i++) L.car(cx - 44 + i * 7.2, cz + 24, Math.PI / 2, 2);
  for (let i = 0; i < 5; i++) L.car(cx + 6 + i * 7.5, cz + 33, Math.PI / 2, 0);
  L.zone('fuel', cx - 10, cz - 16, 14, { name: n.name, diesel: true, trucks: true });
  L.zone('water', cx + 22, cz - 20, 8, { name: 'Potable water fill' });
  L.zone('dump', cx + 34, cz - 26, 8, { name: 'RV dump station' });
  L.zone('shop', cx - 32, cz - 26, 12, { name: 'Travel Store' });
  for (let i = 0; i < 6; i++) L.prop('lamps', [cx - 50 + i * 20, cz + 6, 0]);
}

// ── Campground ──────────────────────────────────────────────────────────────
function camp(L, world, n) {
  const rng = L.rng;
  const { x: cx, z: cz } = n;
  const R = 36, N = 14;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    L.street(cx + Math.cos(a0) * R, cz + Math.sin(a0) * R, cx + Math.cos(a1) * R, cz + Math.sin(a1) * R, 5, 'gravel', 'Camp Loop');
  }
  L.street(cx - 66, cz, cx - R, cz, 6, 'gravel', 'Camp Entry');
  L.street(cx + R, cz, cx + 66, cz, 6, 'gravel', 'Camp Entry');
  L.street(cx, cz - 66, cx, cz - R, 6, 'gravel', 'Camp Entry');
  L.street(cx, cz + R, cx, cz + 66, 6, 'gravel', 'Camp Entry');
  for (let i = 0; i < 10; i++) {
    const a = ((i + 0.5) / 10) * Math.PI * 2;
    const px = cx + Math.cos(a) * (R + 9), pz = cz + Math.sin(a) * (R + 9);
    L.prop('misc', [px, pz, a, 'campsite']);
  }
  L.lot('shed', cx, cz, 9, 6, { floors: 1, fh: 3, pal: 6, roof: 'gable', sign: 'Restrooms · Showers' });
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2, r = 12 + rng() * 55;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (Math.abs(r - R) < 9) continue;
    L.tree(x, z, 1.1 + rng() * 0.9, rng() < 0.7 ? 0 : 1);
  }
  L.zone('camp', cx, cz, R + 14, { name: n.name, hookups: hash2(n.i, n.j, 95) < 0.6, fee: 24 });
  L.zone('water', cx + 6, cz + 6, 8, { name: 'Potable water fill' });
  L.zone('dump', cx - 8, cz + 6, 8, { name: 'Dump station' });
}

function junction(L, world, n) {
  const { x: cx, z: cz } = n;
  L.street(cx - 14, cz, cx + 14, cz, 9, 'minor', '');
  L.street(cx, cz - 14, cx, cz + 14, 9, 'minor', '');
  if (hash2(n.i, n.j, 96) < 0.3) {
    L.lot('shed', cx + 24, cz - 18, 9, 6, { floors: 1, fh: 3, pal: 7, roof: 'gable', sign: pick(L.rng, BUSINESSES) });
    L.tree(cx - 24, cz + 20, 1, 0);
  }
}

/** Layout for a node, cached on the node. */
export function layoutOf(world, n) {
  if (n._layout) return n._layout;
  const L = new Layout(world, n);
  if (n.kind === 'city' || n.kind === 'town') urban(L, world, n);
  else if (n.kind === 'village') village(L, world, n);
  else if (n.kind === 'farm') farm(L, world, n);
  else if (n.kind === 'lodge') lodge(L, world, n);
  else if (n.kind === 'truckstop') truckstop(L, world, n);
  else if (n.kind === 'camp') camp(L, world, n);
  else junction(L, world, n);
  // welcome signs at each existing port
  const ports = [
    ['E', n.portE, 1, 0, 0, 'edgeE'], ['W', n.portW, -1, 0, 0, 'edgeW'], ['N', n.portN, 0, -1, 1, 'edgeN'], ['S', n.portS, 0, 1, 1, 'edgeS'],
  ];
  const ex = [world.edgeExists(n.i, n.j, 0), world.edgeExists(n.i - 1, n.j, 0), world.edgeExists(n.i, n.j - 1, 1), world.edgeExists(n.i, n.j, 1)];
  ports.forEach(([nm, p, ox, oz], idx) => {
    if (!ex[idx] || n.kind === 'junction' || n.kind === 'farm' || n.kind === 'lodge' || n.kind === 'camp') return;
    const out = [ox, oz], right = [oz, -ox];
    const off = 46;
    const sx = p[0] + out[0] * off + right[0] * 9.5, sz = p[1] + out[1] * off + right[1] * 9.5;
    L.reg('signs', L.signs.length, sx - 2, sx + 2, sz - 2, sz + 2);
    L.signs.push({ kind: 'welcome', port: nm, x: sx, z: sz, yaw: Math.atan2(ox, oz), text: n.name });
  });
  n._layout = L;
  return L;
}
