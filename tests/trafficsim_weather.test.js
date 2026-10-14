import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherSpeedFactor, idmAccel, curveSpeedAhead, polylineCurvature, approachLimit, KINDS } from '../src/sim/traffic.js';
import { SURFACES, WET_GRIP } from '../src/scene/land.js';

const sedanParams = {
  a: KINDS.sedan.a,
  b: KINDS.sedan.b,
  bMax: 6.0,
  T: KINDS.sedan.T,
  s0: KINDS.sedan.s0,
};

const semiParams = {
  a: KINDS.semi.a,
  b: KINDS.semi.b,
  bMax: 4.5,
  T: KINDS.semi.T,
  s0: KINDS.semi.s0,
};

// ── Tier 1: Feature Coverage (Primary behavior) ──────────────────────────────

test('weather T1: weatherSpeedFactor scales target speed vmax down on rain (-15%), snow (-35%), and ice (-60%)', () => {
  // Dry surface
  assert.equal(weatherSpeedFactor(null, 'highway', 'asphalt'), 1.0, 'dry asphalt is 1.0');

  // Wet / Rain
  const fRainKey = weatherSpeedFactor(null, 'highway', 'wet');
  const fRainState = weatherSpeedFactor('rain', 'highway', 'asphalt');
  assert.equal(fRainKey, 0.85, 'wet surface reduces speed by 15%');
  assert.equal(fRainState, 0.85, 'rain season state reduces speed by 15%');

  // Snow
  const fSnowKey = weatherSpeedFactor(null, 'highway', 'snow');
  const fSnowWinter = weatherSpeedFactor('winter', 'highway', 'asphalt');
  assert.equal(fSnowKey, 0.65, 'snow surface reduces speed by 35%');
  assert.equal(fSnowWinter, 0.65, 'winter season reduces speed by 35%');

  // Ice
  const fIce = weatherSpeedFactor(null, 'highway', 'ice');
  assert.equal(fIce, 0.40, 'ice surface reduces speed by 60%');

  // Relative speed ordering
  assert.ok(fIce < fSnowKey && fSnowKey < fRainKey && fRainKey < 1.0);
});

test('weather T1: curveSpeedAhead reduces maximum safe entry speed on slippery surfaces', () => {
  // Synthetic bend: 200m radius curve -> kap = 1/200 = 0.005 m⁻¹
  const curv = new Float32Array(50).fill(0.005);
  const step = 10;
  const aLat = 3.0;
  const b = 2.0;

  const vDry = curveSpeedAhead(curv, step, 0, 1, 100, aLat, b, 6, SURFACES.asphalt.mu);
  const vWet = curveSpeedAhead(curv, step, 0, 1, 100, aLat, b, 6, SURFACES.asphalt.mu * WET_GRIP);
  const vSnow = curveSpeedAhead(curv, step, 0, 1, 100, aLat, b, 6, SURFACES.snow.mu);
  const vIce = curveSpeedAhead(curv, step, 0, 1, 100, aLat, b, 6, SURFACES.ice.mu);

  assert.ok(vDry > vWet, `dry speed (${vDry.toFixed(1)}) must exceed wet speed (${vWet.toFixed(1)})`);
  assert.ok(vWet > vSnow, `wet speed (${vWet.toFixed(1)}) must exceed snow speed (${vSnow.toFixed(1)})`);
  assert.ok(vSnow >= vIce, `snow speed (${vSnow.toFixed(1)}) must be >= ice speed (${vIce.toFixed(1)})`);
});

test('weather T1: IDM car-following headway T extends on wet and icy road surfaces', () => {
  const v = 20; // 20 m/s (~72 km/h)
  const gap = 30; // 30m gap
  const vLead = 18; // 18 m/s
  const v0 = 25; // 25 m/s target

  // On dry pavement (mu = 1.05) vs icy pavement (mu = 0.12)
  const accDry = idmAccel(sedanParams, v, gap, vLead, v0, 1.05);
  const accIce = idmAccel(sedanParams, v, gap, vLead, v0, 0.12);

  // Under ice conditions with 30m gap, vehicle must brake harder to re-establish larger safety margin
  assert.ok(accIce < accDry, `accIce (${accIce.toFixed(2)}) must be more conservative than accDry (${accDry.toFixed(2)})`);
});

test('weather T1: approachLimit calculates required stopping speed given target and deceleration distance', () => {
  const vTarget = 10; // 10 m/s at stop/hazard
  const dist = 50; // 50m away
  const b = 2.0; // comfortable braking

  const lim = approachLimit(vTarget, dist, b);
  // v² = v0² + 2*b*d => sqrt(100 + 2*2*50) = sqrt(300) ≈ 17.32 m/s
  assert.ok(Math.abs(lim - Math.sqrt(300)) < 1e-4);
});

// ── Tier 2: Boundary & Corner Cases ──────────────────────────────────────────

test('weather T2: zero or near-zero grip clamps to positive floor speed in curveSpeedAhead', () => {
  const curv = new Float32Array(30).fill(0.01); // sharp bend
  const floorSpeed = 6.0;

  // Even with extremely low grip (mu = 0.01), curveSpeedAhead respects vFloor
  const lim = curveSpeedAhead(curv, 10, 0, 1, 80, 2.5, 1.5, floorSpeed, 0.01);
  assert.ok(lim >= floorSpeed, `speed limit ${lim} must respect floor ${floorSpeed}`);
  assert.ok(Number.isFinite(lim));
});

test('weather T2: polyline curvature on straight vs circular arc matches 1/R exactly', () => {
  const n = 100, step = 5;
  const R = 250; // 250m radius arc

  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = (i * step) / R;
    xs[i] = R * Math.sin(th);
    zs[i] = R * (1 - Math.cos(th));
  }

  const curv = polylineCurvature(xs, zs, n, step);
  // Interior points should closely match 1 / R = 1 / 250 = 0.004 m⁻¹
  for (let k = 10; k < n - 10; k++) {
    assert.ok(Math.abs(curv[k] - 0.004) < 0.0008, `k=${k}: curv ${curv[k]} matches 1/250`);
  }
});

test('weather T2: weatherSpeedFactor handles diverse input objects and undefined flags gracefully', () => {
  assert.equal(weatherSpeedFactor(undefined, 'highway', undefined), 1.0);
  assert.equal(weatherSpeedFactor({}, 'county', 'gravel'), 1.0);
  assert.equal(weatherSpeedFactor({ ice: 0.8 }, 'highway', 'asphalt'), 0.40);
  assert.equal(weatherSpeedFactor({ wet: 0.8 }, 'highway', 'asphalt'), 0.85);
  assert.equal(weatherSpeedFactor({ snow: true }, 'highway', 'asphalt'), 0.65);
});

test('weather T2: IDM acceleration never exceeds positive maximum acceleration or negative bMax', () => {
  // Free road with v << v0
  const accFree = idmAccel(sedanParams, 0, 1e9, 0, 30, 1.05);
  assert.ok(accFree <= sedanParams.a + 1e-4, `accFree ${accFree} within a=${sedanParams.a}`);

  // Extreme panic close-in with leader stopped
  const accPanic = idmAccel(sedanParams, 25, 1.0, 0, 30, 1.05);
  assert.ok(accPanic >= -sedanParams.bMax, `accPanic ${accPanic} clamped to -bMax=${-sedanParams.bMax}`);
});

// ── Tier 3: Cross-Feature Interactions ───────────────────────────────────────

test('weather T3: heavy semi trucks adapt following distance with greater headway than passenger cars', () => {
  const v = 22; // ~80 km/h
  const gap = 45;
  const vLead = 20;
  const v0 = 25;

  const carAcc = idmAccel(sedanParams, v, gap, vLead, v0, 0.85);
  const semiAcc = idmAccel(semiParams, v, gap, vLead, v0, 0.85);

  // Loaded semi with T=2.1s and mass=26t reacts more conservatively to close gap than sedan
  assert.ok(semiAcc < carAcc, `semi acceleration (${semiAcc.toFixed(2)}) more conservative than car (${carAcc.toFixed(2)})`);
});

test('weather T3: wet surface friction reduction compounds with sharp curvature to trigger early deceleration', () => {
  const n = 60, step = 10;
  const curv = new Float32Array(n).fill(0);
  // Curve begins at sample 5 (50m ahead) with sharp curvature 1/150
  for (let i = 5; i < 25; i++) curv[i] = 1 / 150;

  const dryAhead = curveSpeedAhead(curv, step, 0, 1, 150, 3.0, 2.0, 6, 1.05);
  const wetAhead = curveSpeedAhead(curv, step, 0, 1, 150, 3.0, 2.0, 6, 0.819);
  const iceAhead = curveSpeedAhead(curv, step, 0, 1, 150, 3.0, 2.0, 6, 0.12);

  assert.ok(wetAhead < dryAhead, `wet (${wetAhead.toFixed(1)}) must be < dry (${dryAhead.toFixed(1)})`);
  assert.ok(iceAhead < wetAhead, `ice (${iceAhead.toFixed(1)}) must be < wet (${wetAhead.toFixed(1)})`);
  assert.ok(iceAhead <= 16.0, `ice approach limit (${iceAhead.toFixed(1)}) enforces safe crawl speed approaching bend`);
});

// ── Tier 4: Real-World Application Scenarios ─────────────────────────────────

test('weather T4: full car-following simulation under icy conditions settles into expanded safe following distance', () => {
  // Simulate 20 seconds of car-following at 20 Hz
  const dt = 0.05;
  let followerV = 22;
  let leaderV = 16;
  let gap = 50;
  const v0 = 25;
  const muIce = 0.12;

  for (let step = 0; step < 20 / dt; step++) {
    const acc = idmAccel(sedanParams, followerV, gap, leaderV, v0, muIce);
    followerV = Math.max(0, followerV + acc * dt);
    gap += (leaderV - followerV) * dt;
    assert.ok(gap > 10.0, `gap at step ${step} was ${gap.toFixed(1)}m (never rear-ends leader)`);
  }

  // After 20 seconds, follower settles near leader speed (16 m/s) with safe following margin
  assert.ok(Math.abs(followerV - leaderV) < 0.5, `follower speed ${followerV.toFixed(2)} matches leader ${leaderV}`);
  assert.ok(gap >= 30, `settled following distance on ice is at least 30m (actual: ${gap.toFixed(1)}m)`);
});
