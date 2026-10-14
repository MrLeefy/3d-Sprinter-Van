import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeBody, staticBody, resolveImpact, chainContact, circleRectContact, impactZone, BodyDamage, damageAmount, stepCrashMotion, stepFree,
  rolloverSpeed, shouldDetach, inertia, DAMAGE_J,
} from '../src/sim/crash.js';

const van = (o = {}) => makeBody({ m: 3800, I: inertia(3800, 5.9, 2), ...o });
const car = (o = {}) => makeBody({ m: 1500, I: inertia(1500, 4.7, 1.8), ...o });
const momentum = (...bs) => bs.reduce((a, b) => [a[0] + (b.vx / (b.invM || Infinity)) * (b.invM ? 1 : 0), a[1] + (b.vz / (b.invM || Infinity)) * (b.invM ? 1 : 0)], [0, 0]);
const ke = (b) => (b.invM ? 0.5 * (b.vx * b.vx + b.vz * b.vz) / b.invM + 0.5 * b.w * b.w / b.invI : 0);

test('impact: a central head-on hit conserves momentum, loses energy and never speeds the pair up', () => {
  const A = van({ vx: 20 }), B = car({ x: 5, vx: -15 });
  const p0 = momentum(A, B), e0 = ke(A) + ke(B);
  const r = resolveImpact(A, B, -1, 0, 2.5, 0, 0.2, 0.3);
  assert.ok(r && Math.abs(r.closing - 35) < 1e-9);
  const p1 = momentum(A, B);
  assert.ok(Math.abs(p0[0] - p1[0]) < 1e-6 && Math.abs(p1[1]) < 1e-9);
  assert.ok(ke(A) + ke(B) < e0, 'energy is lost');
  assert.ok(Math.abs(e0 - (ke(A) + ke(B)) - r.energy) / r.energy < 0.01, 'reported energy matches the loss');
  assert.ok(A.vx < 20 && A.vx > -5, 'the heavier van keeps going the other way less than the car');
  assert.ok(B.vx > 0, 'the car is thrown back the way the van was going');
  assert.equal(A.w, 0, 'a central hit does not spin the van');
});

test('impact: restitution 1 reverses a hit on a static wall; 0 stops it dead', () => {
  const W = staticBody(10, 0);
  const A = van({ vx: 12 });
  resolveImpact(A, W, -1, 0, 5, 0, 1, 0);
  assert.ok(Math.abs(A.vx + 12) < 1e-9);
  const B = van({ vx: 12 });
  resolveImpact(B, W, -1, 0, 5, 0, 0, 0);
  assert.ok(Math.abs(B.vx) < 1e-9);
  assert.equal(W.vx, 0);
  assert.equal(W.w, 0);
});

test('impact: no impulse when the bodies are already separating', () => {
  const A = van({ vx: -3 });
  assert.equal(resolveImpact(A, staticBody(), -1, 0, 0, 0), null);
});

test('impact: hitting a wall on the front-left corner swings the nose left (positive yaw), right corner swings it right', () => {
  const left = van({ vx: 10 });
  resolveImpact(left, staticBody(), -1, 0, 2.5, -1, 0.1, 0.3); // north (left) side is −z
  assert.ok(left.w > 0.1, `w=${left.w}`);
  const right = van({ vx: 10 });
  resolveImpact(right, staticBody(), -1, 0, 2.5, 1, 0.1, 0.3);
  assert.ok(right.w < -0.1, `w=${right.w}`);
  assert.ok(Math.abs(left.w + right.w) < 1e-9, 'mirror image');
});

test('impact: a side swipe by a faster car spins the van and drags it along', () => {
  // a car passing the van's rear quarter, going the same way faster, rubs it on the right side
  const A = van({ vx: 10 }), B = car({ x: -2, z: 1.9, vx: 25 });
  const r = resolveImpact(A, B, 0, -1, -1.5, 1, 0.1, 0.5);
  assert.equal(r, null, 'moving apart along the normal: only friction would act, handled by the caller');
  // closing along the normal: the car moves into the van (toward −z)
  const A2 = van({ vx: 10 }), B2 = car({ x: -2, z: 1.9, vx: 25, vz: -3 });
  const r2 = resolveImpact(A2, B2, 0, -1, -1.5, 1, 0.1, 0.5);
  assert.ok(r2 && r2.closing > 2.9);
  assert.ok(A2.vx > 10, 'friction drags the van forward');
  assert.ok(B2.vx < 25, 'and holds the car back');
});

test('contact: chains of circles report the deepest overlap with a normal from B toward A', () => {
  const A = [{ x: 0, z: 0, r: 1 }, { x: 2, z: 0, r: 1 }];
  const B = [{ x: 3.5, z: 0.2, r: 1.2 }];
  const c = chainContact(A, B);
  assert.ok(c && c.pen > 0.2 && c.ia === 1);
  assert.ok(c.nx < -0.9, 'points from B back toward A');
  assert.equal(chainContact(A, [{ x: 30, z: 0, r: 1 }]), null);
});

test('contact: circle against a rectangle, from outside and from inside', () => {
  const rect = { x: 0, z: 0, w: 10, d: 4 };
  const out = circleRectContact({ x: 5.5, z: 0.5, r: 1 }, rect);
  assert.ok(out && Math.abs(out.nx - 1) < 1e-9 && Math.abs(out.pen - 0.5) < 1e-9);
  assert.equal(circleRectContact({ x: 8, z: 0, r: 1 }, rect), null);
  const inside = circleRectContact({ x: 4.2, z: 0, r: 1 }, rect);
  assert.ok(inside && inside.nx === 1 && inside.pen > 1.5, 'leaves by the nearest face');
});

test('damage: zones, accumulation, power loss, steering pull and the engine giving out', () => {
  assert.equal(impactZone(4.5, 0.2), 'front');
  assert.equal(impactZone(-1, 0), 'rear');
  assert.equal(impactZone(1.5, 1), 'right');
  assert.equal(impactZone(1.5, -1), 'left');
  // 50 km/h into a wall: a heavy front hit, well past the point where the engine bay is crushed
  const v = 13.9, E = 0.5 * 3800 * v * v * (1 - 0.15 * 0.15);
  assert.ok(damageAmount(E) > 0.6 && damageAmount(E) < 1, `damage=${damageAmount(E)}`);
  assert.ok(damageAmount(0.5 * 3800 * 3 * 3) < 0.05, 'a 10 km/h bump is a scuff');
  const d = new BodyDamage();
  assert.equal(d.powerFactor, 1);
  assert.equal(d.any, false);
  d.add('front', 0.2, 0.8);
  assert.ok(d.powerFactor > 0.95 && d.pull > 0, 'right-hand front hit pulls to the right');
  d.add('front', 0.5, 0.8);
  assert.ok(d.powerFactor < 0.8 && d.powerFactor > 0.3 && !d.engineDead && d.smoke > 0);
  d.add('front', 0.5);
  assert.equal(d.powerFactor, 0);
  assert.ok(d.engineDead && d.total > 0.55);
  assert.ok(d.repairCost() > 800);
  d.repair();
  assert.ok(!d.any && d.powerFactor === 1 && d.pull === 0 && d.repairCost() === 0);
  assert.ok(DAMAGE_J > 1e5);
});

test('spin-out: a yaw kick turns the body under its momentum, the tyres pull the slide out and the spin dies', () => {
  const st = { v: 20, vy: 0, wc: 2.5, yaw: 0 };
  const speed0 = Math.hypot(st.v, st.vy);
  stepCrashMotion(st, 0.01, 0.85);
  assert.ok(st.vy > 0, 'nose swung left, so the velocity now points to the right of the body');
  assert.ok(st.yaw > 0);
  let maxSlip = 0, steps = 0;
  while ((Math.abs(st.vy) > 0 || Math.abs(st.wc) > 0) && steps++ < 4000) {
    stepCrashMotion(st, 0.01, 0.85);
    maxSlip = Math.max(maxSlip, Math.abs(st.vy));
  }
  assert.ok(steps < 4000, 'comes to a stop eventually');
  assert.ok(maxSlip > 2, `slid sideways at up to ${maxSlip.toFixed(1)} m/s`);
  assert.ok(Math.abs(st.yaw) > 0.5, 'ended up rotated');
  void speed0;
});

test('spin-out: grip decides how long the slide lasts (ice is far longer than tarmac)', () => {
  const time = (mu) => {
    const st = { v: 15, vy: 8, wc: 0, yaw: 0 };
    let t = 0;
    while (Math.abs(st.vy) > 0 && t < 60) {
      stepCrashMotion(st, 0.01, mu);
      t += 0.01;
    }
    return t;
  };
  assert.ok(time(0.12) > time(0.85) * 4);
});

test('free bodies: a spinning wreck slides, scrubs speed sideways first and comes to rest', () => {
  const b = { x: 0, z: 0, yaw: 0, vx: 18, vz: 6, w: 3 };
  const e0 = Math.hypot(b.vx, b.vz);
  let rest = false, t = 0;
  while (!rest && t < 60) {
    rest = stepFree(b, 0.02, {});
    t += 0.02;
  }
  assert.ok(rest && t < 25, `rest after ${t.toFixed(1)} s`);
  assert.ok(Math.hypot(b.x, b.z) > 5 && Math.hypot(b.x, b.z) < e0 * 12);
  assert.ok(Math.abs(b.yaw) > 0.5);
  // sideways motion dies faster than forward motion
  const s = { x: 0, z: 0, yaw: 0, vx: 0, vz: 8, w: 0 }; // moving 8 m/s to the right of a car pointing east
  const f = { x: 0, z: 0, yaw: 0, vx: 8, vz: 0, w: 0 };
  for (let i = 0; i < 50; i++) {
    stepFree(s, 0.02, {});
    stepFree(f, 0.02, {});
  }
  assert.ok(Math.abs(s.vz) < Math.abs(f.vx));
});

test('rollover: the sideways speed that trips a van depends on what the tyres can dig into', () => {
  const ice = rolloverSpeed('ice'), tar = rolloverSpeed('asphalt'), grass = rolloverSpeed('grass'), mud = rolloverSpeed('mud');
  assert.ok(ice > tar && tar > grass && grass > mud);
  assert.ok(grass > 3 && tar < 9, `tarmac ${tar.toFixed(1)} m/s, grass ${grass.toFixed(1)} m/s`);
});

test('detaching an AI vehicle from its path takes a real hit, a big sideways shove or a spin', () => {
  assert.equal(shouldDetach(2, 0.5, 0.1), false);
  assert.equal(shouldDetach(8, 0, 0), true);
  assert.equal(shouldDetach(3, 3, 0), true);
  assert.equal(shouldDetach(3, 0, 0.8), true);
});
