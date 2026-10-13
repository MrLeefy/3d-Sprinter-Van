// Deterministic integer-hash noise, shared by the world generator (no three.js, runs in node tests).
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Hash of two integers and a salt → [0, 1). */
export function hash2(ix, iz, s = 0) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul((s | 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function vnoise(x, z, s = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Fractal value noise in [0, 1], mean ≈ 0.5. */
export function fbm(x, z, s = 0, oct = 4) {
  let a = 0.5, t = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    t += a * vnoise(x, z, s + i * 17);
    n += a;
    x = x * 2.03 + 11.7;
    z = z * 2.03 - 7.3;
    a *= 0.5;
  }
  return t / n;
}

/** Ridged noise in [0, 1]: sharp crests (mountain ranges). */
export function ridged(x, z, s = 0, oct = 4) {
  let a = 0.5, t = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(2 * vnoise(x, z, s + i * 23) - 1);
    t += a * v * v;
    n += a;
    x = x * 2.1 + 5.3;
    z = z * 2.1 + 17.9;
    a *= 0.5;
  }
  return t / n;
}

/** Mulberry32 PRNG. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const TAU = Math.PI * 2;
