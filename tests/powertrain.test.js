import test from 'node:test';
import assert from 'node:assert/strict';
import { VAN_ENGINE, vanGearIndex, vanRpm, vanDriveForce, accelerationTimes } from '../src/sim/powertrain.js';
import { weightReport } from '../src/sim/weight.js';

test('gearbox: nine gears on the shift schedule, rpm stays inside the engine range', () => {
  assert.equal(vanGearIndex(0), 0);
  assert.equal(vanGearIndex(200), VAN_ENGINE.bands.length - 2);
  let last = 0;
  for (let k = 0; k <= 150; k++) {
    const g = vanGearIndex(k);
    assert.ok(g >= last, 'never downshifts on the way up');
    last = g;
    const rpm = vanRpm(k, 1);
    assert.ok(rpm >= VAN_ENGINE.idleRpm && rpm < VAN_ENGINE.redline, `${k} km/h → ${rpm} rpm`);
  }
  assert.ok(vanRpm(0, 0) < vanRpm(0, 1), 'the revs rise with the throttle at a standstill');
});

test('drive force: constant force while torque-limited, constant power beyond, scaled by the pedal', () => {
  const E = VAN_ENGINE, knee = E.powerW / E.forceMax;
  assert.equal(vanDriveForce(2, 1), E.forceMax);
  assert.equal(vanDriveForce(knee - 1, 1), E.forceMax);
  const fast = vanDriveForce(30, 1);
  assert.ok(Math.abs(fast * 30 - E.powerW) < 1, 'power is flat at speed');
  assert.ok(Math.abs(vanDriveForce(10, 0.5) - 0.5 * E.forceMax) < 1e-6);
  assert.equal(vanDriveForce(10, 0), 0);
});

test('drive force: a gear change under power cuts the torque for a moment', () => {
  const full = vanDriveForce(20, 1, 0), mid = vanDriveForce(20, 1, VAN_ENGINE.shiftDipT), late = vanDriveForce(20, 1, 0.02);
  assert.ok(Math.abs(mid / full - VAN_ENGINE.shiftDip) < 1e-9);
  assert.ok(late > mid && late < full, 'the torque comes back in over the end of the shift');
});

test('performance: the tuned van is a quick one (0–100 km/h about ten seconds, was sixteen) and still governed at 137 km/h', () => {
  const m = weightReport().gvw;
  const t = accelerationTimes(m);
  assert.ok(t[100] > 8 && t[100] < 11.5, `0-100 in ${t[100]} s`);
  assert.ok(t[50] < 5 && t[80] < 8.5, `0-50 ${t[50]} s, 0-80 ${t[80]} s`);
  assert.ok(t.vTop > 136 && t.tTop < 22, `${t.vTop} km/h after ${t.tTop} s`);
  // the stock 2.0 L (125 kW at the wheels) for comparison
  const stock = accelerationTimes(m, { E: { ...VAN_ENGINE, powerW: 125e3, forceMax: 9800 } });
  assert.ok(stock[100] > t[100] * 1.4, `stock 0-100 ${stock[100]} s`);
  // a heavier van is slower, a hill-free run is repeatable
  assert.ok(accelerationTimes(m + 600)[100] > t[100]);
  assert.deepEqual(accelerationTimes(m), t);
});
