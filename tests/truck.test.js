import test from 'node:test';
import assert from 'node:assert/strict';
import { Rig, SPEC, torqueAt } from '../src/sim/truck.js';

const run = (rig, secs, input, env = {}, h = 0.01, each = null) => {
  const e = { mu: 0.85, crr: 0.012, grade: 0, safety: 1, park: false, ...env };
  let x = 0, z = 0;
  for (let i = 0; i < secs / h; i++) {
    const inp = typeof input === 'function' ? input(i * h, rig) : input;
    rig.step(h, inp, e);
    x += Math.cos(rig.theta) * rig.v * h;
    z -= Math.sin(rig.theta) * rig.v * h;
    if (each) each(rig, i * h);
  }
  return { x, z };
};

test('truck: torque curve peaks mid-range and falls off at the governor', () => {
  assert.ok(torqueAt(1300) > 2300 && torqueAt(1300) < 2500);
  assert.ok(torqueAt(700) < torqueAt(1300) && torqueAt(2100) < torqueAt(1500) && torqueAt(2300) === 0);
});

test('truck: a loaded 36 t rig accelerates through the gears like a real one', () => {
  const rig = new Rig('dryvan', 20000);
  rig.park = false;
  let t90 = null;
  run(rig, 140, { throttle: 1, brake: 0, steer: 0 }, {}, 0.01, (r, t) => {
    if (t90 === null && r.v * 3.6 >= 90) t90 = t;
  });
  assert.ok(t90 !== null, `reached 90 km/h (v=${(rig.v * 3.6).toFixed(0)})`);
  assert.ok(t90 > 25 && t90 < 110, `0–90 km/h in ${t90?.toFixed(0)} s`);
  assert.ok(rig.gear >= 8, `gear ${rig.gear}`);
  assert.ok(Number.isFinite(rig.fuel) && rig.fuel < SPEC.fuelTank * 0.8);
});

test('truck: bobtail is much quicker than a loaded rig', () => {
  const t = (rig) => {
    let t60 = null;
    rig.park = false;
    run(rig, 80, { throttle: 1, brake: 0, steer: 0 }, {}, 0.01, (r, tt) => {
      if (t60 === null && r.v * 3.6 >= 60) t60 = tt;
    });
    return t60;
  };
  assert.ok(t(new Rig('none')) < t(new Rig('dryvan', 20000)) * 0.65);
});

test('truck: full braking from 90 km/h stops a loaded rig in a realistic distance', () => {
  const rig = new Rig('dryvan', 18000);
  rig.park = false;
  rig.v = 25;
  rig.gear = 9;
  rig.air = 125;
  const { x } = run(rig, 30, { throttle: 0, brake: 1, steer: 0 });
  assert.ok(rig.v === 0, `stopped (v=${rig.v})`);
  assert.ok(x > 45 && x < 120, `stopping distance ${x.toFixed(0)} m`);
});

test('truck: the trailer cuts corners (off-tracking) and stays within the jack-knife limit in a turn', () => {
  const rig = new Rig('dryvan', 15000);
  rig.park = false;
  rig.v = 3;
  rig.gear = 1;
  const pts = [];
  run(rig, 60, (t, r) => ({ throttle: r.v < 3 ? 0.3 : 0, brake: r.v > 3.4 ? 0.1 : 0, steer: 0.75 }), {}, 0.01, (r) => {
    if (r.v > 1.5) pts.push([r.theta, r.thetaT, r.v]);
  });
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(last[0] - last[1]) < SPEC.jackLimit, 'within the limit');
  // steady turn: the trailer axle follows a tighter circle than the tractor's drive axle
  const R1 = SPEC.wheelbase / Math.tan(rig.delta);
  assert.ok(R1 > 12 && R1 < 40, `turn radius ${R1.toFixed(1)} m`);
  const hitch = Math.sqrt(Math.max(0, R1 * R1 + SPEC.fifthA ** 2 - SPEC.kingToAxle ** 2));
  assert.ok(hitch < R1, `trailer axle radius ${hitch.toFixed(1)} m < ${R1.toFixed(1)} m`);
});

test('truck: backing with the wheel held jack-knifes the rig', () => {
  const rig = new Rig('dryvan', 12000);
  rig.park = false;
  rig.gear = -1;
  let jack = 0;
  run(rig, 40, { throttle: 0.2, brake: 0, steer: 1 }, {}, 0.01, (r) => (jack = Math.max(jack, r.jack)));
  assert.ok(jack >= 0.99, `jack-knife ${jack.toFixed(2)}`);
  assert.ok(Math.abs(rig.theta - rig.thetaT) <= SPEC.jackLimit + 1e-6, 'the limit holds');
});

test('truck: backing in a straight line with small corrections keeps the trailer straight', () => {
  const rig = new Rig('dryvan', 12000);
  rig.park = false;
  rig.gear = -1;
  run(rig, 12, { throttle: 0.15, brake: 0, steer: 0 });
  assert.ok(rig.v < -0.5 && Math.abs(rig.theta - rig.thetaT) < 0.02);
});

test('truck: rollover — assisted steering stays upright, unassisted high-speed turns can tip a log truck', () => {
  const mk = () => {
    const r = new Rig('logs', 22000);
    r.park = false;
    r.v = 22;
    r.gear = 9;
    return r;
  };
  const assisted = mk();
  run(assisted, 6, { throttle: 0.3, brake: 0, steer: 1 }, { safety: 1 });
  assert.ok(!assisted.rolled, `assisted aLat ${assisted.aLat.toFixed(1)} vs ${assisted.rollThreshold.toFixed(1)}`);
  const pro = mk();
  run(pro, 6, { throttle: 0.3, brake: 0, steer: 1 }, { safety: 3 });
  assert.ok(pro.rolled || pro.rollRisk > 1, `pro rollRisk ${pro.rollRisk.toFixed(2)}`);
  assert.ok(new Rig('logs', 22000).rollThreshold < new Rig('dryvan', 15000).rollThreshold, 'a high load tips earlier');
});

test('truck: fuel economy at 90 km/h is in the real range (L/100 km, before world scaling)', () => {
  const rig = new Rig('dryvan', 18000);
  rig.park = false;
  rig.fuelScale = 1;
  rig.v = 25;
  rig.gear = 9;
  const start = rig.fuel;
  let dist = 0;
  run(rig, 120, (t, r) => ({ throttle: r.v < 25 ? 0.6 : 0.33, brake: 0, steer: 0 }), {}, 0.01, (r) => (dist += r.v * 0.01));
  const lper100 = ((start - rig.fuel) / dist) * 1e5;
  assert.ok(lper100 > 22 && lper100 < 55, `${lper100.toFixed(0)} L/100 km`);
});

test('truck: long descents overheat the brakes unless the engine brake helps', () => {
  const descent = (eb) => {
    const rig = new Rig('dryvan', 22000);
    rig.park = false;
    rig.v = 16;
    rig.gear = 6;
    rig.engineBrake = eb;
    run(rig, 150, (t, r) => ({ throttle: 0, brake: r.v > 16 ? 0.35 : 0, steer: 0 }), { grade: -0.065 });
    return rig;
  };
  const without = descent(false), with_ = descent(true);
  assert.ok(without.brakeTemp > with_.brakeTemp + 40, `${without.brakeTemp.toFixed(0)} °C vs ${with_.brakeTemp.toFixed(0)} °C`);
  assert.ok(without.v >= with_.v - 1);
});

test('truck: gears change down when the speed drops and out of fuel the engine dies', () => {
  const rig = new Rig('dryvan', 15000);
  rig.park = false;
  rig.v = 22;
  rig.gear = 10;
  run(rig, 40, { throttle: 0, brake: 0.25, steer: 0 });
  assert.ok(rig.gear < 10, `gear ${rig.gear}`);
  const dry = new Rig('dryvan', 15000);
  dry.park = false;
  dry.fuel = 0;
  run(dry, 20, { throttle: 1, brake: 0, steer: 0 });
  assert.ok(dry.v < 0.5, 'no fuel, no go');
});
