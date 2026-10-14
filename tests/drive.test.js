import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, tick } from './helpers/game.js';

const flat = (o = {}) => {
  const g = makeGame({ flat: true, ...o });
  g.D.place(0, 0, 0);
  return g;
};
const run = (g, secs, dt = 1 / 100) => {
  for (let i = 0; i < secs / dt; i++) tick(g, dt, false);
};
const wall = (g, x, zc, d = 30) => (g.D.colCache = { rects: [{ x: x + 10, z: zc, w: 20, d }], circles: [], x: 1e9, z: 1e9, t: 0 });

test('van: full throttle on a level road reaches 100 km/h in about ten seconds (the old engine took sixteen)', () => {
  const g = flat();
  g.D.keys.add('w');
  let t = 0, t100 = null, t50 = null;
  while (t < 30 && g.D.v < 37.9) {
    tick(g, 1 / 100, false);
    t += 1 / 100;
    if (t50 === null && g.D.v * 3.6 >= 50) t50 = t;
    if (t100 === null && g.D.v * 3.6 >= 100) t100 = t;
  }
  assert.ok(t50 > 3 && t50 < 5.5, `0-50 in ${t50}`);
  assert.ok(t100 > 8 && t100 < 12, `0-100 in ${t100}`);
  assert.ok(g.D.v > 37.5, 'governed at about 137 km/h');
});

test('van: a head-on crash into a wall at 90 km/h stops it dead, wrecks the front, kills the engine and rattles the camera', () => {
  const g = flat();
  g.D.v = 25;
  wall(g, 30, 0);
  run(g, 3);
  const D = g.D;
  assert.ok(D.v < 0.5 && D.v > -4, `v=${D.v}`);
  assert.ok(D.dmg.zone.front > 0.95 && D.dmg.engineDead && D.engineOut, 'the front is crushed and the engine is dead');
  assert.equal(D.rpm(1), 0, 'no revs from a dead engine');
  assert.ok(D.impacts.length >= 1 && D.impacts[0][1] > 20, JSON.stringify(D.impacts));
  assert.ok(g.world.fx.bursts.length >= 1 && g.world.fx.bursts[0][3] > 20, 'sparks and debris at the point of impact');
  assert.ok(D.log.includes('building') && D.log.includes('engineout'));
  // a dead engine ignores the pedal
  D.keys.add('w');
  const x0 = D.x;
  run(g, 3);
  assert.ok(Math.abs(D.x - x0) < 1, 'it does not move under its own power');
});

test('van: a gentle 3 m/s bump is a scuff, not a crash', () => {
  const g = flat();
  g.D.v = 3;
  wall(g, 10, 0);
  run(g, 4);
  assert.ok(g.D.dmg.total < 0.05, `damage ${g.D.dmg.total}`);
  assert.ok(g.D.dmg.powerFactor > 0.98 && !g.D.engineOut);
  assert.ok(!g.D.log.includes('engineout'));
});

test('van: an off-centre hit spins the nose toward the side that hit, and the steering pulls to the damaged side', () => {
  const right = flat();
  right.D.v = 14;
  wall(right, 30, 8.4, 16); // covers z ≥ 0.4: the right half of the nose
  run(right, 3);
  const left = flat();
  left.D.v = 14;
  wall(left, 30, -8.4, 16);
  run(left, 3);
  assert.ok(right.D.yaw < -0.02, `a right-hand hit swings the nose right (yaw ${right.D.yaw})`);
  assert.ok(left.D.yaw > 0.02, `a left-hand hit swings the nose left (yaw ${left.D.yaw})`);
  assert.ok(Math.abs(right.D.yaw + left.D.yaw) < 0.05, 'mirror images');
  assert.ok(right.D.dmg.zone.front > 0.2);
  assert.ok(right.D.dmg.pull > 0 && left.D.dmg.pull < 0, 'a front corner hit pulls toward that corner');
});

test('van: a glancing blow along a wall scrapes speed off and spins the van away', () => {
  const g = flat();
  g.D.place(24, 0, 1.35); // heading almost along a wall whose face is x = 30, drifting toward it at about 4 m/s
  g.D.v = 20;
  wall(g, 30, -40, 100);
  run(g, 3);
  assert.ok(g.D.impacts.length >= 1, 'touched the wall');
  assert.ok(g.D.v < 19 && g.D.v > 5, `still rolling, slower: ${g.D.v}`);
  assert.ok(g.D.dmg.total > 0.01 && g.D.dmg.total < 0.6, `damage ${g.D.dmg.total}`);
  assert.ok(g.D.dmg.zone.right > 0 || g.D.dmg.zone.front > 0);
});

test('van: Easy mode forgives, Pro does not (same crash, different damage)', () => {
  const dmg = (assist) => {
    const g = flat();
    g.D.cfg.assist = assist;
    g.D.v = 14;
    wall(g, 30, 0);
    run(g, 2);
    return g.D.dmg.total;
  };
  const easy = dmg('easy'), std = dmg('standard'), pro = dmg('pro');
  assert.ok(easy < std && std < pro, `easy ${easy} < standard ${std} < pro ${pro}`);
});

test('van: sliding sideways at speed trips it over on tarmac and soft ground, not on ice; it then needs a tow', () => {
  const slide = (surface, v, vy, secs = 4) => {
    const g = flat({ surface });
    g.D.v = v;
    g.D.vy = vy;
    run(g, secs);
    return g;
  };
  const tar = slide('asphalt', 18, 8);
  assert.ok(tar.D.rolledVan, 'rolled on tarmac');
  assert.ok(tar.D.log.includes('rollover') && tar.D.engineOut);
  assert.ok(Math.abs(tar.D.v) < 0.5, 'comes to rest on its side');
  tar.D.keys.add('w');
  const x0 = tar.D.x;
  run(tar, 2);
  assert.ok(Math.abs(tar.D.x - x0) < 0.5, 'no driving while on its side');
  assert.ok(slide('grass', 18, 11).D.rolledVan, 'rolled on grass');
  const mild = slide('asphalt', 18, 4.5);
  assert.ok(!mild.D.rolledVan, 'a 4.5 m/s slide on tarmac is survivable');
  assert.ok(Math.abs(mild.D.vy) < 0.05, 'the tyres pull the slide out');
  assert.ok(!slide('ice', 18, 11).D.rolledVan, 'ice lets it slide');
});

test('van: the tow truck stands a rolled van up, repairs it and charges for it', () => {
  const g = makeGame();
  const H = g.gen.home;
  g.D.place(H.x, H.z, H.yaw);
  g.D.v = 10;
  g.D.dmg.add('front', 0.5);
  g.D.rollOver(1);
  assert.ok(g.D.rolledVan && g.D.dmg.repairCost() > 400);
  const cost = g.D.dmg.repairCost();
  const road = g.D.resetToRoad();
  assert.ok(road, 'put back on a road');
  assert.ok(!g.D.rolledVan && g.D.vanRollAmt === 0 && !g.D.dmg.any && !g.D.engineOut);
  assert.ok(g.D.log.includes('towed') && g.D.towCost === cost);
});

test('van: a deer is a soft hit, a bison a hard one', () => {
  const hit = (mass) => {
    const g = flat();
    g.D.v = 22;
    g.D.hitAnimal({ x: 4.5, z: 0 }, { mass });
    return { v: g.D.v, dmg: g.D.dmg.total };
  };
  const deer = hit(90), bison = hit(850);
  assert.ok(deer.v > 21 && deer.dmg < 0.06, JSON.stringify(deer));
  assert.ok(bison.v < deer.v - 1 && bison.dmg > deer.dmg * 3, JSON.stringify(bison));
});

test('van: damage costs power, and a crushed radiator slows the climb', () => {
  const accel = (front) => {
    const g = flat();
    g.D.dmg.add('front', front);
    g.D.keys.add('w');
    run(g, 6);
    return g.D.v;
  };
  const clean = accel(0), hurt = accel(0.7), dead = accel(1);
  assert.ok(hurt < clean * 0.9, `${hurt} vs ${clean}`);
  assert.ok(dead < 0.5);
});

test('van: after a spin the body is turned under its momentum, so the van slides before the tyres bite', () => {
  const g = flat({ surface: 'grass' });
  g.D.v = 20;
  g.D.yawRate = 1.8; // an impact has just kicked its yaw
  let maxSlip = 0;
  for (let i = 0; i < 400; i++) {
    tick(g, 1 / 100, false);
    maxSlip = Math.max(maxSlip, Math.abs(g.D.vy));
  }
  assert.ok(maxSlip > 3, `slid sideways at ${maxSlip} m/s`);
  assert.ok(Math.abs(g.D.yaw) > 0.3, 'ended up pointing somewhere else');
  assert.ok(Math.hypot(g.D.x, g.D.z) > 20, 'and carried on in roughly the old direction');
});

test('van: handling through the real driver — a lane change at 110 km/h is clean, a held full-lock stab at that speed rolls Standard but not Easy', () => {
  const steer = (assist, v, keys, secs) => {
    const g = flat();
    g.D.cfg.assist = assist;
    g.D.v = v;
    g.D.cruise.on = true;
    g.D.cruise.v = v;
    const key = { left: 'a', right: 'd' };
    let t = 0, maxPhi = 0, maxLat = 0;
    while (t < secs) {
      const k = keys(t);
      g.D.keys.clear();
      if (k) g.D.keys.add(k > 0 ? key.left : key.right);
      tick(g, 1 / 100, false);
      t += 1 / 100;
      maxPhi = Math.max(maxPhi, Math.abs(g.D.vd.phi));
      maxLat = Math.max(maxLat, Math.abs(g.D.z));
    }
    return { g, maxPhi, maxLat };
  };
  const lane = (t) => (t < 0.4 ? 1 : t < 0.6 ? 0 : t < 1.0 ? -1 : 0);
  for (const assist of ['easy', 'standard', 'pro']) {
    const r = steer(assist, 30, lane, 5);
    assert.ok(!r.g.D.rolledVan, `${assist} lane change`);
    assert.ok(r.maxLat > 0.5, `${assist} actually moved over (${r.maxLat.toFixed(1)} m)`);
    assert.ok(Math.abs(r.g.D.vy) < 1.5 && Math.abs(r.g.D.yawRate) < 0.1, 'and settled');
  }
  const stab = (t) => (t < 2 ? 1 : 0);
  assert.ok(steer('standard', 32, stab, 6).g.D.rolledVan, 'Standard rolls');
  assert.ok(steer('pro', 32, stab, 6).g.D.rolledVan, 'Pro rolls');
  assert.ok(!steer('easy', 32, stab, 6).g.D.rolledVan, 'Easy stays up');
  const slow = steer('pro', 9, stab, 5);
  assert.ok(!slow.g.D.rolledVan, 'at 30 km/h even Pro just drives in circles');
});

