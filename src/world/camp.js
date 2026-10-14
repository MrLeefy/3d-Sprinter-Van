// Dispersed off-grid boondocking campsites along road networks (pure JS, headless).
// Generates scenic off-grid campsites with solar exposure, wind shelter, and terrain levelness ratings.
import { hash2, hashStr, clamp, lerp } from './noise.js';

export const BOONDOCK_TYPES = {
  overlook: {
    label: 'Ridge Overlook',
    icon: '🌄',
    description: 'High vantage point with wide horizon and panoramic solar exposure.',
    solarBias: 0.9,
    windBias: 0.3,
  },
  meadow: {
    label: 'Alpine Meadow',
    icon: '🌼',
    description: 'Open grassy clearing with level ground and gentle exposure.',
    solarBias: 0.8,
    windBias: 0.5,
  },
  forest: {
    label: 'Sheltered Grove',
    icon: '🌲',
    description: 'Secluded site among tall timber offering dense wind shielding.',
    solarBias: 0.5,
    windBias: 0.85,
  },
  creek: {
    label: 'Creek Basin',
    icon: '🏞',
    description: 'Tucked down near water with natural terrain windbreaks.',
    solarBias: 0.6,
    windBias: 0.75,
  },
  bluff: {
    label: 'Canyon Bluff',
    icon: '🏜',
    description: 'Turnout along rimrock with open sky and moderate breeze.',
    solarBias: 0.85,
    windBias: 0.4,
  },
};

const ADJECTIVES = [
  'Whispering', 'Silent', 'Lone Pine', 'Sunlit', 'Granite', 'Eagle Rim',
  'Aspen', 'Cedar Creek', 'Hidden', 'Misty', 'Starlight', 'Golden',
  'Windy Point', 'Wildflower', 'Timberline', 'Copper Basin', 'Prairie View',
  'Red Rock', 'Cloud Peak', 'Lost Meadow',
];

const SITE_NOUNS = [
  'Dispersed Camp', 'Boondock Overlook', 'Meadow Pullout', 'Canyon Bluff',
  'Pines Camp', 'Ridge Turnout', 'Basin Glade', 'Plateau Camp',
];

/**
 * Evaluate site physical characteristics at (x, z):
 * - solarExposure: fraction of unobstructed sky (0..1)
 * - windShelter: ridge/terrain shielding in prevailing wind direction (0..1)
 * - levelness: terrain gradient score (0..1)
 * - pitch / roll: terrain angles in radians
 */
export function evaluateSpotSite(W, x, z, options = {}) {
  const prevailingWindDeg = options.prevailingWindDeg ?? 250; // WSW prevailing wind
  const y0 = W.heightAt(x, z);

  // ── 1. Levelness (pitch, roll, gradient) ─────────────────────────
  const delta = 3.0; // sample radius (half van length)
  const hXp = W.heightAt(x + delta, z);
  const hXm = W.heightAt(x - delta, z);
  const hZp = W.heightAt(x, z + delta);
  const hZm = W.heightAt(x, z - delta);

  const dhdx = (hXp - hXm) / (2 * delta);
  const dhdz = (hZp - hZm) / (2 * delta);
  const gradient = Math.hypot(dhdx, dhdz);
  const pitch = Math.atan(dhdz);
  const roll = Math.atan(dhdx);

  // Levelness: 0 grad = 1.0, 14% slope (~8 deg) = 0.0
  const levelness = clamp(1.0 - gradient / 0.14, 0, 1);

  // ── 2. Solar Exposure (unobstructed sky fraction) ────────────────
  // Sample 8 radial directions around the horizon.
  // In northern hemisphere (+z South, +x East), southern azimuths carry most solar insolation.
  let skyScoreSum = 0;
  let weightSum = 0;
  const azimuths = 8;
  const radDistances = [35, 90, 220, 550, 1200];

  for (let a = 0; a < azimuths; a++) {
    const phi = (a / azimuths) * Math.PI * 2;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    let maxElevationAngle = 0;
    for (const d of radDistances) {
      const yd = W.heightAt(x + cosPhi * d, z + sinPhi * d);
      const angle = Math.atan2(yd - y0, d);
      if (angle > maxElevationAngle) maxElevationAngle = angle;
    }

    // Sky fraction in this direction (0 rad = full horizon, 90 deg = fully blocked)
    const skyFraction = clamp(Math.cos(maxElevationAngle), 0, 1);

    // Directional weight: southern quadrant (sinPhi > 0) carries higher solar weight
    const sunWeight = 1.0 + 0.6 * Math.max(0, sinPhi);
    skyScoreSum += skyFraction * sunWeight;
    weightSum += sunWeight;
  }

  const solarExposure = clamp(skyScoreSum / weightSum, 0, 1);

  // ── 3. Wind Shelter (ridge shielding against prevailing winds) ───
  // Prevailing wind direction in radians
  const windRad = (prevailingWindDeg * Math.PI) / 180;
  // Upwind vector (direction wind blows FROM)
  const upwindX = -Math.cos(windRad);
  const upwindZ = -Math.sin(windRad);

  // Sample terrain upwind at varying distances
  const upwindDistances = [25, 60, 140, 320, 700];
  let maxShielding = 0;

  for (const d of upwindDistances) {
    const yu = W.heightAt(x + upwindX * d, z + upwindZ * d);
    const rise = yu - y0;
    if (rise > 0) {
      // Upwind terrain higher than site creates a wind shadow in its lee
      const slope = rise / d;
      // Hills 15%+ grade within 300m give powerful shelter
      const shield = clamp(slope / 0.18, 0, 1) * Math.exp(-d / 650);
      if (shield > maxShielding) maxShielding = shield;
    }
  }

  // Also check cross-wind flanking ridges (+/- 30 degrees)
  for (const offset of [-0.5, 0.5]) {
    const flankX = -Math.cos(windRad + offset);
    const flankZ = -Math.sin(windRad + offset);
    for (const d of [40, 120, 300]) {
      const yf = W.heightAt(x + flankX * d, z + flankZ * d);
      const rise = yf - y0;
      if (rise > 0) {
        const shield = clamp((rise / d) / 0.22, 0, 0.8) * Math.exp(-d / 600);
        if (shield * 0.7 > maxShielding) maxShielding = shield * 0.7;
      }
    }
  }

  // Baseline boundary layer shelter
  const windShelter = clamp(0.12 + 0.88 * maxShielding, 0, 1);

  return {
    solarExposure: Number(solarExposure.toFixed(3)),
    windShelter: Number(windShelter.toFixed(3)),
    levelness: Number(levelness.toFixed(3)),
    pitch: Number(pitch.toFixed(4)),
    roll: Number(roll.toFixed(4)),
    gradient: Number(gradient.toFixed(4)),
    y: y0,
  };
}

/**
 * Generate deterministic off-grid boondocking spots along a road edge.
 */
export function campsOf(W, edge) {
  if (edge._camps) return edge._camps;

  const out = [];
  // Number of spots along this road edge based on edge length
  const count = Math.min(
    3,
    Math.max(1, Math.floor((edge.len / 1400) * (0.6 + 0.8 * hash2(hashStr(edge.id), 8, 44))))
  );

  for (let q = 0; q < count; q++) {
    const h = (k) => hash2(hashStr(edge.id), q * 11 + k, 55);

    // Position along edge
    const frac = (q + 0.2 + 0.6 * h(1)) / count;
    const s = edge.len * clamp(frac, 0.08, 0.92);
    const k = Math.min(edge.n - 2, Math.max(1, Math.round((s / edge.len) * (edge.n - 1))));

    // Road tangent and normal vectors
    const tx = edge.xs[k + 1] - edge.xs[k - 1];
    const tz = edge.zs[k + 1] - edge.zs[k - 1];
    const l = Math.hypot(tx, tz) || 1;

    // Side of the road (+1 right, -1 left)
    const side = h(2) < 0.6 ? 1 : -1;
    // Offset clear of carriageway (20 - 42 m)
    const off = side * (edge.P.width / 2 + 16 + h(3) * 22);

    const x = edge.xs[k] + (-tz / l) * off;
    const z = edge.zs[k] + (tx / l) * off;

    // Validation: skip if inside a town settlement or deep in a lake
    if (W.settlementAt(x, z, 55)) continue;
    const lakes = W.lakesNear(x, z);
    if (lakes.some((lk) => W.lakeRn(lk, x, z) < 1.15)) continue;

    // Evaluate physical ratings
    const ratings = evaluateSpotSite(W, x, z);

    // Determine category based on terrain height and ratings
    const yDiff = ratings.y - edge.hs[k];
    let category;
    if (yDiff > 8 && ratings.solarExposure > 0.75) category = 'overlook';
    else if (lakes.some((lk) => W.lakeRn(lk, x, z) < 2.0)) category = 'creek';
    else if (ratings.windShelter > 0.65) category = 'forest';
    else if (ratings.levelness > 0.8) category = 'meadow';
    else category = ['overlook', 'meadow', 'forest', 'creek', 'bluff'][Math.floor(h(4) * 5)];

    const adj = ADJECTIVES[Math.floor(h(5) * ADJECTIVES.length)];
    const noun = SITE_NOUNS[Math.floor(h(6) * SITE_NOUNS.length)];
    const name = `${adj} ${noun}`;

    // Camper parking orientation (facing scenic vista / pullout heading)
    const yaw = Math.atan2(side * (tz / l), -side * (tx / l));

    const spot = {
      id: `${edge.id}#camp#${q}`,
      type: 'boondock',
      name,
      category,
      x: Number(x.toFixed(2)),
      z: Number(z.toFixed(2)),
      y: Number(ratings.y.toFixed(2)),
      yaw: Number(yaw.toFixed(3)),
      edge: edge.id,
      k,
      side,
      solarExposure: ratings.solarExposure,
      windShelter: ratings.windShelter,
      levelness: ratings.levelness,
      // Compatibility aliases
      solarRating: ratings.solarExposure,
      windRating: ratings.windShelter,
      levelnessRating: ratings.levelness,
      pitch: ratings.pitch,
      roll: ratings.roll,
      gradient: ratings.gradient,
      padRadius: 8.0,
    };

    out.push(spot);
  }

  edge._camps = out;
  return out;
}

function bboxOf(e) {
  if (e.minx === undefined) {
    let a = 1e18, b = -1e18, c = 1e18, d = -1e18;
    for (let k = 0; k < e.n; k++) {
      a = Math.min(a, e.xs[k]);
      b = Math.max(b, e.xs[k]);
      c = Math.min(c, e.zs[k]);
      d = Math.max(d, e.zs[k]);
    }
    e.minx = a;
    e.maxx = b;
    e.minz = c;
    e.maxz = d;
  }
  return e;
}

/**
 * Return all boondocking spots within radius r of (x, z).
 */
export function campsNear(W, x, z, r) {
  const out = [];
  for (const e0 of W.edges.values()) {
    const e = bboxOf(e0);
    if (x < e.minx - r - 80 || x > e.maxx + r + 80 || z < e.minz - r - 80 || z > e.maxz + r + 80) continue;
    for (const c of campsOf(W, e)) {
      if (Math.hypot(c.x - x, c.z - z) <= r) out.push(c);
    }
  }
  return out;
}

/**
 * Find nearest boondocking campsite to (x, z).
 */
export function nearestCamp(W, x, z, maxDist = 3000) {
  const candidates = campsNear(W, x, z, maxDist);
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  return candidates[0];
}
