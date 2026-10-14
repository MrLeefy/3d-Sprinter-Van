// Crash physics (pure, no rendering): 2-D rigid-body impacts between chains of circles (vehicle
// footprints) and static obstacles, with restitution, tyre-scuff friction, yaw spin from off-centre
// hits, a body-damage model and free wrecks. What the van does afterwards (sliding, spinning, tipping
// over) is the vehicle model's job (vehicle.js).
//
// Conventions match the driving world: x east, z south, heading θ has direction (cos θ, −sin θ),
// right = (sin θ, cos θ). A positive yaw rate ω turns the heading toward north (counter-clockwise from
// above), the same sense as dθ/dt. A point at offset r from a body's centre moves at ω·(r.z, −r.x)
// from the spin, and an impulse J at r changes ω by (r.z·J.x − r.x·J.z) / I.

export const G = 9.81;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Yaw moment of inertia of a slab (kg·m²). */
export const inertia = (m, len, wid) => (m * (len * len + wid * wid)) / 12;

/** A dynamic or static body. Static bodies have invM = invI = 0 and never change velocity. */
export function makeBody({ x = 0, z = 0, vx = 0, vz = 0, w = 0, m = 0, I = 0 } = {}) {
  return { x, z, vx, vz, w, invM: m > 0 ? 1 / m : 0, invI: I > 0 ? 1 / I : 0 };
}
export const staticBody = (x = 0, z = 0) => makeBody({ x, z });

/** Velocity of the point p on body b (centre velocity plus spin). */
export function pointVelocity(b, px, pz, out = [0, 0]) {
  out[0] = b.vx + b.w * (pz - b.z);
  out[1] = b.vz - b.w * (px - b.x);
  return out;
}

/**
 * Resolve one contact between bodies A and B. The contact normal (nx, nz) points from B toward A and
 * (px, pz) is the contact point. e is the restitution, mu the tyre-scuff / metal friction. Both bodies
 * are changed in place. Returns null when they are already separating, otherwise
 * { j, jt, closing, energy } where energy (J) is the kinetic energy lost to deformation and scuffing.
 */
export function resolveImpact(A, B, nx, nz, px, pz, e = 0.15, mu = 0.35) {
  const rax = px - A.x, raz = pz - A.z, rbx = px - B.x, rbz = pz - B.z;
  const vax = A.vx + A.w * raz, vaz = A.vz - A.w * rax;
  const vbx = B.vx + B.w * rbz, vbz = B.vz - B.w * rbx;
  const rvx = vax - vbx, rvz = vaz - vbz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return null;
  const ran = raz * nx - rax * nz, rbn = rbz * nx - rbx * nz;
  const denom = A.invM + B.invM + ran * ran * A.invI + rbn * rbn * B.invI;
  if (denom <= 0) return null;
  const j = (-(1 + e) * vn) / denom;
  A.vx += j * nx * A.invM;
  A.vz += j * nz * A.invM;
  A.w += ran * j * A.invI;
  B.vx -= j * nx * B.invM;
  B.vz -= j * nz * B.invM;
  B.w -= rbn * j * B.invI;
  // friction along the contact surface (Coulomb, limited by the normal impulse)
  const tx = -nz, tz = nx;
  const wax = A.vx + A.w * raz, waz = A.vz - A.w * rax;
  const wbx = B.vx + B.w * rbz, wbz = B.vz - B.w * rbx;
  const vt = (wax - wbx) * tx + (waz - wbz) * tz;
  const rat = raz * tx - rax * tz, rbt = rbz * tx - rbx * tz;
  const dt = A.invM + B.invM + rat * rat * A.invI + rbt * rbt * B.invI;
  let jt = dt > 0 ? -vt / dt : 0;
  const lim = mu * j;
  jt = clamp(jt, -lim, lim);
  A.vx += jt * tx * A.invM;
  A.vz += jt * tz * A.invM;
  A.w += rat * jt * A.invI;
  B.vx -= jt * tx * B.invM;
  B.vz -= jt * tz * B.invM;
  B.w -= rbt * jt * B.invI;
  // energy absorbed: the normal loss plus the work of scuffing (small)
  const energy = (0.5 * (1 - e * e) * vn * vn) / denom + Math.abs(jt * vt) * 0.3;
  return { j, jt, closing: -vn, energy };
}

// ── Contact detection ─────────────────────────────────────────────────────────
/**
 * Deepest overlap between two chains of circles ({ x, z, r }). The normal points from chain B toward
 * chain A. Returns null, or fills and returns `out`: { pen, nx, nz, px, pz, ia, ib }.
 */
export function chainContact(A, B, out = { pen: 0, nx: 0, nz: 0, px: 0, pz: 0, ia: 0, ib: 0 }) {
  let best = 0, hit = false;
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    for (let k = 0; k < B.length; k++) {
      const b = B[k];
      const dx = a.x - b.x, dz = a.z - b.z, rr = a.r + b.r;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
      const d = Math.hypot(dx, dz), pen = rr - d;
      if (pen > best && d > 1e-5) {
        best = pen;
        hit = true;
        out.pen = pen;
        out.nx = dx / d;
        out.nz = dz / d;
        // the contact point lies between the two surfaces
        out.px = b.x + (dx / d) * (b.r - pen / 2);
        out.pz = b.z + (dz / d) * (b.r - pen / 2);
        out.ia = i;
        out.ib = k;
      }
    }
  }
  return hit ? out : null;
}

/** A circle against an axis-aligned rectangle { x, z, w, d } (centre, size along x, size along z). */
export function circleRectContact(c, r, out = { pen: 0, nx: 0, nz: 0, px: 0, pz: 0 }) {
  const hx = r.w / 2, hz = r.d / 2;
  const cx = clamp(c.x, r.x - hx, r.x + hx), cz = clamp(c.z, r.z - hz, r.z + hz);
  const dx = c.x - cx, dz = c.z - cz, d = Math.hypot(dx, dz);
  if (d >= c.r) return null;
  if (d > 1e-5) {
    out.nx = dx / d;
    out.nz = dz / d;
    out.pen = c.r - d;
    out.px = cx;
    out.pz = cz;
    return out;
  }
  // centre inside the footprint: leave by the nearest face
  const ox = hx - Math.abs(c.x - r.x), oz = hz - Math.abs(c.z - r.z);
  if (ox < oz) {
    out.nx = Math.sign(c.x - r.x) || 1;
    out.nz = 0;
    out.pen = ox + c.r;
    out.px = r.x + out.nx * hx;
    out.pz = c.z;
  } else {
    out.nx = 0;
    out.nz = Math.sign(c.z - r.z) || 1;
    out.pen = oz + c.r;
    out.px = c.x;
    out.pz = r.z + out.nz * hz;
  }
  return out;
}

// ── Damage ────────────────────────────────────────────────────────────────────
/** Absorbed energy (J) that fully wrecks one zone of a van. A 50 km/h wall hit absorbs ≈ 360 kJ. */
export const DAMAGE_J = 520e3;

/** Damage zone from a contact point in body coordinates (lx forward of the rear axle, ly to the right). */
export function impactZone(lx, ly, front = 3.3, rear = -0.2) {
  if (lx > front) return 'front';
  if (lx < rear) return 'rear';
  return ly >= 0 ? 'right' : 'left';
}

/** Body damage by zone (0 = new, 1 = wrecked), with the way it hurts the van. */
export class BodyDamage {
  constructor() {
    this.zone = { front: 0, rear: 0, left: 0, right: 0 };
    this.pull = 0; // steering pull (rad of road-wheel angle) from front-corner damage; + = to the right
    this.flat = 0; // tyre damage 0..1 (a scrape along a side wall)
  }

  get total() {
    const z = this.zone;
    return clamp(Math.max(z.front, z.rear, z.left, z.right) * 0.6 + (z.front + z.rear + z.left + z.right) * 0.1, 0, 1);
  }

  add(zone, amount, ly = 0) {
    const z = this.zone;
    z[zone] = clamp(z[zone] + amount, 0, 1);
    if (zone === 'front' && Math.abs(ly) > 0.4) this.pull = clamp(this.pull + Math.sign(ly) * amount * 0.12, -0.07, 0.07);
    if ((zone === 'left' || zone === 'right') && amount > 0.05) this.flat = clamp(this.flat + amount * 0.5, 0, 1);
  }

  /** Fraction of engine power left: a crushed radiator and engine bay cost power, then stop the engine. */
  get powerFactor() {
    const f = this.zone.front;
    if (f >= 0.97) return 0;
    return 1 - 0.65 * smooth(0.25, 0.95, f);
  }

  get engineDead() {
    return this.zone.front >= 0.97;
  }

  /** 0..1 steam/smoke from the hood. */
  get smoke() {
    return smooth(0.45, 0.9, this.zone.front);
  }

  /** Extra rolling resistance from bent wheel arches and flat spots. */
  get crrExtra() {
    return 0.012 * (this.zone.left + this.zone.right) + 0.01 * this.flat;
  }

  /** Cost of a repair (USD). */
  repairCost() {
    const z = this.zone;
    return Math.round((z.front * 1100 + z.rear * 650 + z.left * 800 + z.right * 800 + this.flat * 250) / 10) * 10;
  }

  get any() {
    return this.total > 0.005;
  }

  repair() {
    for (const k in this.zone) this.zone[k] = 0;
    this.pull = 0;
    this.flat = 0;
  }
}

/** Damage amount (0..1 of a zone) from absorbed energy. `share` is the part of it this body keeps. */
export const damageAmount = (energy, share = 1) => clamp((energy * share) / DAMAGE_J, 0, 1);

// ── Free bodies (wrecks) ──────────────────────────────────────────────────────
/**
 * Advance a free vehicle body that has left its path (an AI wreck). Velocity is kept in the world
 * frame; the tyres grip across the vehicle (strongly) and roll along it (weakly, wrecks drag). b =
 * { x, z, yaw, vx, vz, w }. Returns true once it has come to rest.
 */
export function stepFree(b, dt, { mu = 0.7, drag = 4, spinDecay = 1.1 } = {}) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const fx = c, fz = -s, rx = s, rz = c;
  let u = b.vx * fx + b.vz * fz, w = b.vx * rx + b.vz * rz;
  const lat = Math.min(Math.abs(w), mu * G * dt);
  w -= Math.sign(w) * lat;
  const lon = Math.min(Math.abs(u), (drag + 0.25 * mu * G * Math.min(1, Math.abs(b.w) / 1.5)) * dt);
  u -= Math.sign(u) * lon;
  b.vx = u * fx + w * rx;
  b.vz = u * fz + w * rz;
  b.w *= Math.exp(-(spinDecay + 0.12 * Math.hypot(b.vx, b.vz)) * dt);
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.yaw += b.w * dt;
  const rest = Math.hypot(b.vx, b.vz) < 0.12 && Math.abs(b.w) < 0.04;
  if (rest) b.vx = b.vz = b.w = 0;
  return rest;
}

/** Does an impact hand a rail-bound AI vehicle enough to knock it off its path? */
export function shouldDetach(closing, dvLat, spin) {
  return closing > 4.5 || Math.abs(dvLat) > 2.4 || Math.abs(spin) > 0.45;
}
