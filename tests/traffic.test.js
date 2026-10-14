import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS, driverParams, idmAccel, approachLimit, polylineCurvature, curveSpeedAhead, straightFor, mergeSafe, wantsToPass, passManeuver,
  oncomingClear, laneDecision, stepTrailer, makeHonk, honkStep, collide1D, impactDamage, laneLats, pickWeighted, SPAWN_MIX, SEMI_KING_TO_AXLE,
} from '../src/sim/traffic.js';

const car = driverParams('sedan');
const semi = driverParams('semi');

test('idm: free road accelerates toward the desired speed and never beyond', () => {
  let v = 0;
  for (let i = 0; i < 6000; i++) v += idmAccel(car, v, 1e9, 0, 30) * 0.02;
  assert.ok(v > 29 && v < 30.2, `v=${v}`);
  assert.ok(idmAccel(car, 35, 1e9, 0, 30) < 0, 'brakes when above desired speed');
});

test('idm: closes up on a slower leader and settles near the desired headway', () => {
  let v = 30, gap = 120;
  const vl = 20;
  for (let i = 0; i < 12000; i++) {
    const a = idmAccel(car, v, gap, vl, 31);
    v = Math.max(0, v + a * 0.01);
    gap += (vl - v) * 0.01;
    assert.ok(gap > 0, 'never hits the leader');
  }
  assert.ok(Math.abs(v - vl) < 0.3, `v=${v}`);
  const want = car.s0 + vl * car.T;
  assert.ok(gap > want * 0.8 && gap < want * 1.6, `gap=${gap} want≈${want}`);
});

test('idm: a stopped obstacle is met with a stop and braking stays within the limit', () => {
  let v = 31, x = 0;
  const obs = 200;
  let worst = 0;
  for (let i = 0; i < 6000; i++) {
    const a = idmAccel(car, v, obs - x - 2.4, 0, 31);
    worst = Math.min(worst, a);
    v = Math.max(0, v + a * 0.01);
    x += v * 0.01;
  }
  assert.ok(v < 0.05 && x < obs - 2.4, `stopped v=${v} x=${x}`);
  assert.ok(worst >= -car.bMax - 1e-9);
});

test('idm: loaded semis are given more headway and gentler acceleration than cars', () => {
  assert.ok(semi.T > car.T && semi.a < car.a && semi.bMax < car.bMax);
  assert.ok(KINDS.semi.rear > 14 && KINDS.semi.trailerCircles.length >= 5);
});

test('curves: curvature of an arc matches 1/R and a limit builds before the bend', () => {
  const R = 120, step = 8, n = 80;
  const xs = [], zs = [];
  for (let k = 0; k < n; k++) {
    const a = (k * step) / R;
    xs.push(R * Math.sin(a));
    zs.push(R * (1 - Math.cos(a)));
  }
  const c = polylineCurvature(xs, zs, n, step);
  assert.ok(Math.abs(c[40] - 1 / R) < 0.1 / R, `kappa=${c[40]}`);
  // a straight lead-in followed by that arc
  const sx = [], sz = [];
  for (let k = 0; k < 30; k++) { sx.push(k * step); sz.push(0); }
  for (let k = 1; k < n; k++) { sx.push(29 * step + xs[k]); sz.push(zs[k]); }
  const cv = polylineCurvature(sx, sz, sx.length, step);
  const far = curveSpeedAhead(cv, step, 0, 1, 250, 2.6, 1.6);
  const near = curveSpeedAhead(cv, step, 25 * step, 1, 250, 2.6, 1.6);
  const vc = Math.sqrt(2.6 * R);
  assert.ok(near < far && near >= vc * 0.95 && near < vc * 1.6, `near=${near} vc=${vc}`);
  assert.equal(curveSpeedAhead(cv, step, 0, 1, 100, 2.6, 1.6), Infinity, 'straight section is unrestricted');
  assert.equal(straightFor(cv, step, 0, 1, 150), true);
  assert.equal(straightFor(cv, step, 0, 1, 400), false);
  assert.equal(straightFor(cv, step, 0, -1, 100), false, 'road end blocks passing');
});

test('approach limit is the speed from which comfortable braking reaches the target', () => {
  const v = approachLimit(10, 100, 1.5);
  assert.ok(Math.abs((v * v - 100) / (2 * 100) - 1.5) < 1e-9);
  assert.equal(approachLimit(10, -5, 1.5), 10);
});

test('merge: rejects short gaps and a fast follower, accepts a clear lane', () => {
  assert.equal(mergeSafe({ pSelf: car, v: 28, gapAhead: 12, vAhead: 28, gapBehind: 60, vBehind: 28 }), false);
  assert.equal(mergeSafe({ pSelf: car, v: 28, gapAhead: 80, vAhead: 28, gapBehind: 10, vBehind: 34 }), false);
  assert.equal(mergeSafe({ pSelf: car, v: 28, gapAhead: 90, vAhead: 30, gapBehind: 70, vBehind: 29 }), true);
  assert.equal(mergeSafe({ pSelf: car, v: 28, gapAhead: 1e9, gapBehind: 1e9 }), true);
});

test('passing: wants to pass only when held up by a clearly slower leader', () => {
  const base = { v0: 31, v: 24, leadV: 24, leadGap: 25, followTime: 3 };
  assert.equal(wantsToPass(base), true);
  assert.equal(wantsToPass({ ...base, leadV: 30.5 }), false, 'not slow enough');
  assert.equal(wantsToPass({ ...base, followTime: 0.2 }), false, 'give it a moment first');
  assert.equal(wantsToPass({ ...base, leadGap: 300 }), false, 'leader far away');
});

test('passing: oncoming traffic closes the opposing lane in proportion to the maneuver length', () => {
  const man = passManeuver({ vLead: 20, gap: 20, lenLead: 5, lenSelf: 5, vPass: 28 });
  assert.ok(man.t > 8 && man.t < 20, `t=${man.t}`);
  assert.equal(oncomingClear(man, []), true);
  assert.equal(oncomingClear(man, [{ gap: 250, v: 25 }]), false);
  assert.equal(oncomingClear(man, [{ gap: 1500, v: 25 }]), true);
  const slowLead = passManeuver({ vLead: 5, gap: 20, lenLead: 5, lenSelf: 5, vPass: 28 });
  assert.ok(slowLead.t < man.t, 'a slow leader is passed faster');
});

const tgtFree = { gapAhead: 1e9, vAhead: 0, gapBehind: 1e9, vBehind: 0 };
test('lane decision: two-lane road needs a clear, straight opposing lane', () => {
  const c = { multi: false, inner: false, heavy: false, v: 22, v0: 28, lead: { gap: 25, v: 17, len: 5 }, followTime: 4, target: tgtFree, pSelf: car, len: 4.7, straight: true, oncoming: [], idle: 0 };
  assert.equal(laneDecision(c), 'pass');
  assert.equal(laneDecision({ ...c, straight: false }), 'none');
  assert.equal(laneDecision({ ...c, oncoming: [{ gap: 280, v: 26 }] }), 'none');
  assert.equal(laneDecision({ ...c, oncoming: [{ gap: 1400, v: 26 }] }), 'pass');
});

test('lane decision: heavy vehicles pass only with a big advantage; multi-lane uses gap acceptance', () => {
  const c = { multi: true, inner: false, heavy: true, v: 25, v0: 29, lead: { gap: 30, v: 26, len: 20 }, followTime: 4, target: tgtFree, pSelf: semi, idle: 0 };
  assert.equal(laneDecision(c), 'none', '3 m/s gain is not enough for a truck');
  assert.equal(laneDecision({ ...c, lead: { gap: 30, v: 20, len: 5 }, v: 20.5 }), 'pass');
  const cc = { ...c, heavy: false, lead: { gap: 30, v: 20, len: 5 }, v: 21, v0: 31 };
  assert.equal(laneDecision(cc), 'pass');
  assert.equal(laneDecision({ ...cc, target: { gapAhead: 1e9, vAhead: 0, gapBehind: 8, vBehind: 33 } }), 'none', 'a car is on our tail in the next lane');
});

test('lane decision: return to the right lane once the passed vehicle is clear behind', () => {
  const c = { inner: true, passing: true, v: 30, v0: 31, pSelf: car, target: tgtFree, passedGap: 5, idle: 0 };
  assert.equal(laneDecision(c), 'none');
  assert.equal(laneDecision({ ...c, passedGap: 40 }), 'return');
  assert.equal(laneDecision({ ...c, passedGap: 40, target: { gapAhead: 1e9, vAhead: 0, gapBehind: 6, vBehind: 34 } }), 'none');
  // keep right when not passing and nothing holds us up
  assert.equal(laneDecision({ ...c, passing: false, idle: 2 }), 'none');
  assert.equal(laneDecision({ ...c, passing: false, idle: 9 }), 'return');
});

test('trailer: tracks inside the tractor in a turn and straightens out afterwards', () => {
  const R = 40, v = 8, dt = 0.02;
  let theta = 0, thetaT = 0;
  // drive a circle: tractor reference point follows the arc, heading turns at v/R (heading convention θ)
  const L = SEMI_KING_TO_AXLE;
  for (let i = 0; i < 700; i++) {
    theta += (v / R) * dt;
    thetaT = stepTrailer(thetaT, theta, v, dt, L);
  }
  const settled = theta - thetaT;
  assert.ok(settled > 0.05 && settled < 0.5, `steady articulation ${settled}`);
  // steady state on a circle of radius R at the kingpin: sin(Δ) = L / R_kingpin-to-centre ≈ L / hypot(R, L)
  assert.ok(Math.abs(Math.sin(settled) - L / Math.hypot(R, L)) < 0.12, `consistent with the geometry (${settled})`);
  // now straight: the angle decays
  for (let i = 0; i < 4000; i++) thetaT = stepTrailer(thetaT, theta, v, dt, L);
  assert.ok(Math.abs(wrap(theta - thetaT)) < 0.01);
  // stationary: no change
  const before = thetaT + 0.3;
  assert.equal(stepTrailer(before, theta, 0, 0.1, L), before);
});
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('horn: waits a few seconds behind a stopped player, then beeps with a limit; tailgating gets one tap', () => {
  const h = makeHonk();
  let beeps = 0, t = 0;
  for (; t < 40; t += 0.1) beeps += honkStep(h, 0.1, { v: 0, v0: 30, blocked: { gap: 5, v: 0 } }) > 0 ? 1 : 0;
  assert.equal(beeps, 3, 'three honks then patience');
  const h2 = makeHonk();
  let first = null;
  for (t = 0; t < 10; t += 0.1) if (honkStep(h2, 0.1, { v: 0, v0: 30, blocked: { gap: 5, v: 0 } }) && first === null) first = t;
  assert.ok(first > 3 && first < 3.6, `first honk at ${first}`);
  const h3 = makeHonk();
  let taps = 0;
  for (t = 0; t < 30; t += 0.1) taps += honkStep(h3, 0.1, { v: 25, v0: 30, tailgated: { gap: 6, v: 25 } }) > 0 ? 1 : 0;
  assert.equal(taps, 2, 'tap after 4 s of tailgating, again after the cooldown');
  const h4 = makeHonk();
  for (t = 0; t < 30; t += 0.1) assert.equal(honkStep(h4, 0.1, { v: 25, v0: 30, tailgated: { gap: 40, v: 25 } }), 0);
});

test('collision: momentum is conserved and a heavy truck barely slows when it hits a car', () => {
  const r = collide1D(1500, 20, 26000, 25, 0.2);
  assert.ok(Math.abs(1500 * 20 + 26000 * 25 - (1500 * r.vA + 26000 * r.vB)) < 1e-6);
  assert.ok(r.vB > 24 && r.vA > r.vB - 0.01, 'the car is shoved ahead');
  assert.equal(r.closing, 5);
  const stopped = collide1D(1500, 25, 3800, 0, 0.2);
  assert.ok(stopped.vB > 0 && stopped.vA < 25, 'the struck van is pushed forward');
  assert.ok(impactDamage(10, 1500, 34000) < impactDamage(10, 26000, 3800) && impactDamage(0, 1500, 3800) === 0);
});

test('lanes and mixes: interstate has two lanes per direction, semis dominate the heavy mix', () => {
  assert.equal(laneLats('interstate', 17).length, 2);
  assert.equal(laneLats('highway', 10.6).length, 1);
  const [a, b] = laneLats('interstate', 17);
  assert.ok(a > 1.5 && b - a > 2.6 && b + 1.3 < 8.5);
  for (const [cls, mix] of Object.entries(SPAWN_MIX)) for (const k of Object.keys(mix)) assert.ok(KINDS[k], `${cls}: ${k}`);
  assert.equal(pickWeighted({ a: 1, b: 3 }, 0.1), 'a');
  assert.equal(pickWeighted({ a: 1, b: 3 }, 0.9), 'b');
  assert.ok(SPAWN_MIX.interstate.semi > SPAWN_MIX.county.semi && !SPAWN_MIX.gravel.semi);
});
