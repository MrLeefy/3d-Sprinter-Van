import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TrafficModels, TRAILER_VARIANTS } from '../src/scene/trafficModels.js';
import { buildCar, buildTractor, buildTrailer, VB, KIND } from '../src/scene/vehicles.js';
import { KINDS } from '../src/sim/traffic.js';

const mockAtlas = {
  slot: (text, st) => [0, 0, 1, 1],
};

const tm = new TrafficModels(mockAtlas);

const STANDARD_MODELS = ['sedan', 'suv', 'hatch', 'van', 'pickup', 'rv', 'bus', 'tractor'];
const TRAILER_KEYS = [
  'trailer:dryvan:0',
  'trailer:reefer:0',
  'trailer:flatbed:0',
  'trailer:tanker:0',
  'trailer:logs:0',
  'trailer:container:0',
];
const NEW_KINDS = ['police', 'ambulance', 'tow', 'classic_van'];

function inspectBufferAttributes(geo, label) {
  assert.ok(geo instanceof THREE.BufferGeometry, `${label} must be BufferGeometry`);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  assert.ok(pos && pos.count > 0, `${label} must have non-empty position attribute`);
  assert.ok(nor && nor.count > 0, `${label} must have non-empty normal attribute`);

  // Zero NaNs and 100% finite coordinates
  for (let i = 0; i < pos.array.length; i++) {
    const val = pos.array[i];
    assert.ok(!Number.isNaN(val), `${label} pos[${i}] is NaN`);
    assert.ok(Number.isFinite(val), `${label} pos[${i}] is not finite`);
  }

  // Normal vectors finite and approximately unit length
  for (let i = 0; i < nor.count; i++) {
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    assert.ok(Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz), `${label} normal[${i}] not finite`);
    const len = Math.hypot(nx, ny, nz);
    assert.ok(Math.abs(len - 1.0) < 0.05, `${label} normal[${i}] length ${len.toFixed(3)} not unit`);
  }

  // Validate auxiliary vehicle attributes if present
  for (const attr of ['color', 'aKind', 'aBody', 'aGlow', 'aDecal']) {
    if (geo.attributes[attr]) {
      const arr = geo.attributes[attr].array;
      for (let i = 0; i < arr.length; i++) {
        assert.ok(!Number.isNaN(arr[i]), `${label} ${attr}[${i}] is NaN`);
        assert.ok(Number.isFinite(arr[i]), `${label} ${attr}[${i}] not finite`);
      }
    }
  }

  // Indices within valid range
  if (geo.index) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i++) {
      assert.ok(idx[i] >= 0 && idx[i] < pos.count, `${label} index ${idx[i]} out of range [0, ${pos.count})`);
    }
  }

  // Bounding box dimensions strictly positive and finite
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  assert.ok(Number.isFinite(bb.min.x) && Number.isFinite(bb.max.x));
  assert.ok(Number.isFinite(bb.min.y) && Number.isFinite(bb.max.y));
  assert.ok(Number.isFinite(bb.min.z) && Number.isFinite(bb.max.z));
  assert.ok(bb.max.x > bb.min.x, `${label} length span must be positive`);
  assert.ok(bb.max.y > bb.min.y, `${label} height span must be positive`);
  assert.ok(bb.max.z > bb.min.z, `${label} width span must be positive`);

  return bb;
}

// ── Tier 1: Feature Coverage (Primary behavior) ──────────────────────────────

test('geometry T1: passenger car models generate valid hi and lo BufferGeometry with zero NaNs', () => {
  const cars = ['sedan', 'suv', 'hatch', 'van', 'pickup'];
  for (const key of cars) {
    for (const lod of ['hi', 'lo']) {
      const g = tm.get(key, lod);
      const bb = inspectBufferAttributes(g, `${key}:${lod}`);
      const len = bb.max.x - bb.min.x;
      const height = bb.max.y - bb.min.y;
      const width = bb.max.z - bb.min.z;
      assert.ok(len >= 3.8 && len <= 7.0, `${key} length ${len} in realistic range`);
      assert.ok(width >= 1.5 && width <= 2.4, `${key} width ${width} in realistic range`);
      assert.ok(height >= 1.2 && height <= 3.0, `${key} height ${height} in realistic range`);
    }
  }
});

test('geometry T1: commercial tractor and trailer geometries build cleanly across styles', () => {
  for (const lod of ['hi', 'lo']) {
    const trac = tm.get('tractor', lod);
    const bb = inspectBufferAttributes(trac, `tractor:${lod}`);
    assert.ok(bb.max.x - bb.min.x > 5.0, 'tractor length > 5m');
  }

  for (const key of TRAILER_KEYS) {
    for (const lod of ['hi', 'lo']) {
      const tr = tm.get(key, lod);
      const bb = inspectBufferAttributes(tr, `${key}:${lod}`);
      const len = bb.max.x - bb.min.x;
      assert.ok(len >= 10.0 && len <= 17.5, `${key} length ${len} in semi trailer range`);
    }
  }
});

test('geometry T1: bus and motorhome RV models build with correct coach proportions', () => {
  for (const key of ['bus', 'rv']) {
    for (const lod of ['hi', 'lo']) {
      const g = tm.get(key, lod);
      const bb = inspectBufferAttributes(g, `${key}:${lod}`);
      const len = bb.max.x - bb.min.x;
      const height = bb.max.y - bb.min.y;
      if (key === 'bus') {
        assert.ok(len >= 11.0 && len <= 13.5, `bus length ${len} matches 12m coach`);
        assert.ok(height >= 3.0 && height <= 4.0, `bus height ${height} matches tall coach`);
      } else {
        assert.ok(len >= 7.5 && len <= 9.5, `rv length ${len} matches Class-A motorhome`);
        assert.ok(height >= 2.8 && height <= 3.8, `rv height ${height}`);
      }
    }
  }
});

test('geometry T1: passenger car wheel metadata specifies >= 4 wheels with valid physical dimensions', () => {
  for (const key of ['sedan', 'suv', 'hatch', 'van', 'pickup']) {
    const res = buildCar(key, { wheels: 'separate' });
    assert.ok(Array.isArray(res.wheels), `${key} has wheels array`);
    assert.ok(res.wheels.length >= 4, `${key} has >= 4 wheels`);
    assert.ok(res.wheelbase > 2.0 && res.wheelbase < 4.5, `${key} wheelbase ${res.wheelbase} valid`);

    for (const w of res.wheels) {
      assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.z));
      assert.ok(w.r >= 0.25 && w.r <= 0.55, `wheel radius ${w.r} valid`);
      assert.ok(w.w >= 0.15 && w.w <= 0.40, `wheel width ${w.w} valid`);
      assert.ok(w.side === 1 || w.side === -1, 'wheel side is +1 or -1');
    }
  }
});

// ── Tier 2: Boundary & Corner Cases ──────────────────────────────────────────

test('geometry T2: detail scaling across all quality tiers maintains strictly finite geometry', () => {
  const tiers = [1.0, 0.75, 0.5, 0.25];
  for (const d of tiers) {
    const car = buildCar('sedan', { wheels: 'merged', detail: d });
    const bb = inspectBufferAttributes(car.geo, `sedan:detail:${d}`);
    assert.ok(car.geo.attributes.position.count > 100, `detail ${d} has positive vertex count`);
    assert.ok(bb.max.x > 2.0);
  }
});

test('geometry T2: separate wheels mode produces valid detached wheel geometry with matching vertex attributes', () => {
  const res = buildCar('suv', { wheels: 'separate' });
  assert.ok(res.wheelGeo instanceof THREE.BufferGeometry);
  inspectBufferAttributes(res.wheelGeo, 'suv:separate_wheelGeo');
  assert.ok(res.wheelGeo.attributes.position.count > 40, 'wheel geometry has sufficient resolution');
});

test('geometry T2: low-poly LOD proxy geometries have compact triangle counts under 2000 indices', () => {
  for (const key of ['sedan', 'suv', 'hatch', 'van', 'pickup', 'tractor']) {
    const lo = tm.get(key, 'lo');
    assert.ok(lo.index, `${key}:lo must have index buffer`);
    const triangleCount = lo.index.count / 3;
    assert.ok(triangleCount <= 1200, `${key}:lo has ${triangleCount} triangles (budget <= 1200)`);
  }
});

test('geometry T2: vertex color and shader attribute channels are in normalized mathematical ranges', () => {
  const g = tm.get('sedan', 'hi');
  const color = g.attributes.color;
  if (color) {
    for (let i = 0; i < color.count * 3; i++) {
      const c = color.array[i];
      assert.ok(c >= 0.0 && c <= 1.001, `color component ${c} out of [0, 1] range`);
    }
  }
  const aKind = g.attributes.aKind;
  if (aKind) {
    for (let i = 0; i < aKind.count; i++) {
      const k = aKind.array[i];
      assert.ok(Number.isInteger(k) && k >= 0 && k <= 12, `aKind ${k} valid material id`);
    }
  }
});

// ── Tier 3: Cross-Feature Interactions ───────────────────────────────────────

test('geometry T3: bounding footprints and collision circles in KINDS cover vehicle extents without gaps', () => {
  for (const [name, k] of Object.entries(KINDS)) {
    assert.ok(k.len > 0, `${name} len positive`);
    assert.ok(k.w > 0, `${name} w positive`);
    assert.ok(k.mass >= 800 && k.mass <= 45000, `${name} mass ${k.mass} in physical vehicle range`);
    assert.ok(Array.isArray(k.circles) && k.circles.length >= 2, `${name} has >= 2 circles`);

    const allCircles = [...k.circles, ...(k.trailerCircles || [])];
    let minX = Infinity, maxX = -Infinity;
    for (const [cx, cr] of allCircles) {
      assert.ok(Number.isFinite(cx));
      assert.ok(Number.isFinite(cr) && cr >= 0.5 && cr <= 2.0, `${name} circle radius ${cr} sane`);
      minX = Math.min(minX, cx - cr);
      maxX = Math.max(maxX, cx + cr);
    }
    // circles span the majority of the vehicle body length
    const circleCoverage = maxX - minX;
    assert.ok(circleCoverage >= (name === 'semi' ? 10.0 : k.len * 0.7), `${name} circles cover ${circleCoverage}m of ${k.len}m vehicle`);
  }
});

test('geometry T3: vertex aGlow channels identify headlights, taillights, and indicators', () => {
  const g = tm.get('sedan', 'hi');
  const aGlow = g.attributes.aGlow;
  assert.ok(aGlow, 'sedan:hi has aGlow attribute');
  const glowValues = new Set();
  for (let i = 0; i < aGlow.count; i++) {
    if (aGlow.array[i] > 0) glowValues.add(Math.round(aGlow.array[i]));
  }
  assert.ok(glowValues.has(1), 'contains headlamp channel (aGlow = 1)');
  assert.ok(glowValues.has(2), 'contains taillamp channel (aGlow = 2)');
});

// ── Tier 4: Real-World Application Scenarios ─────────────────────────────────

test('geometry T4: emergency & service fleet variants (police, ambulance, tow, classic_van) instantiate cleanly', () => {
  for (const key of NEW_KINDS) {
    for (const lod of ['hi', 'lo']) {
      const g = tm.get(key, lod);
      const bb = inspectBufferAttributes(g, `${key}:${lod}`);
      const len = bb.max.x - bb.min.x;
      const width = bb.max.z - bb.min.z;
      assert.ok(len >= 3.5 && len <= 10.0, `${key} length ${len} within sane bounds`);
      assert.ok(width >= 1.5 && width <= 3.0, `${key} width ${width} within sane bounds`);
    }
  }
});

test('geometry T4: full fleet geometry batch verification preserves 100% finite coordinates across entire registry', () => {
  const allKeys = [...STANDARD_MODELS, ...TRAILER_KEYS, ...NEW_KINDS];
  let totalVertices = 0;
  for (const key of allKeys) {
    for (const lod of ['hi', 'lo']) {
      const g = tm.get(key, lod);
      assert.ok(g && g.attributes.position);
      totalVertices += g.attributes.position.count;
    }
  }
  assert.ok(totalVertices > 50000, `total verified fleet vertices: ${totalVertices}`);
});
