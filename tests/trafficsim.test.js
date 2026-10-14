import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, tick, placeOnEdge, spawnAI, findEdge, findTown } from './helpers/game.js';
import * as S from '../src/sim/traffic.js';

const quiet = (g) => {
  g.T.trySpawn = () => false; // only the vehicles a test adds
  g.T.populated = true;
};

test('traffic: the van runs into the back of a stopped car — the car is thrown off its path as a wreck and the van is hurt', () => {
  const g = makeGame();
  const e = findEdge(g, 'interstate', 1500);
  const lane = 0.345 * e.P.width;
  placeOnEdge(g, e, 200, 1, lane);
  quiet(g);
  const car = spawnAI(g, e, 280, 1, 'sedan', 0, { lane: 1, dead: true });
  g.D.yaw = Math.atan2(-(car.z - g.D.z), car.x - g.D.x); // straight at it
  g.D.v = 25;
  g.T.update(0.001, g.D);
  for (let i = 0; i < 60 * 12; i++) tick(g, 1 / 60);
  assert.ok(car.free, 'the car left its lane');
  assert.equal(g.T.stats.wrecks, 1);
  assert.ok(g.D.impacts.length >= 1 && g.D.impacts[0][1] > 15, JSON.stringify(g.D.impacts));
  assert.ok(g.D.log.includes('crash'));
  assert.ok(g.D.dmg.zone.front > 0.1, 'the van has a damaged front');
  assert.ok(g.D.v < 20, 'and has lost speed');
  assert.ok(car.dmg > 0.1 && car.dead);
  assert.ok(car.wreckT > 5, 'the wreck has been lying there');
});

test('traffic: a hard hit on a heavy truck barely moves it, a light car is knocked away much faster', () => {
  const after = (kind) => {
    const g = makeGame();
    const e = findEdge(g, 'interstate', 1500);
    placeOnEdge(g, e, 200, 1, 0.345 * e.P.width);
    quiet(g);
    const ai = spawnAI(g, e, 280, 1, kind, 0, { lane: 1, dead: true });
    g.D.yaw = Math.atan2(-(ai.z - g.D.z), ai.x - g.D.x);
    g.D.v = 25;
    g.T.update(0.001, g.D);
    let vmax = 0;
    for (let i = 0; i < 60 * 6; i++) {
      tick(g, 1 / 60);
      if (ai.free) vmax = Math.max(vmax, Math.hypot(ai.free.vx, ai.free.vz));
    }
    return vmax;
  };
  const car = after('sedan'), semi = after('semi');
  assert.ok(car > 15, `sedan thrown at ${car}`);
  assert.ok(semi < 6, `semi shoved at ${semi}`);
});

test('traffic: a gentle bump (closing speed under a few m/s) leaves the other car on its path', () => {
  const g = makeGame();
  const e = findEdge(g, 'interstate', 1500);
  placeOnEdge(g, e, 200, 1, 0.345 * e.P.width);
  quiet(g);
  const ai = spawnAI(g, e, 215, 1, 'sedan', 5, { lane: 1 });
  g.D.yaw = Math.atan2(-(ai.z - g.D.z), ai.x - g.D.x);
  g.D.v = 8;
  g.T.update(0.001, g.D);
  for (let i = 0; i < 60 * 6; i++) tick(g, 1 / 60);
  assert.ok(!ai.free, 'still driving');
  assert.ok(g.D.dmg.total < 0.1);
});

test('traffic: drivers see a wreck in their lane and either stop behind it or move round it — nobody drives into it', () => {
  const g = makeGame();
  const e = findEdge(g, 'interstate', 1500);
  const lanes = S.laneLats(e.cls, e.P.width);
  const info = placeOnEdge(g, e, 500, 1, lanes[0]);
  quiet(g);
  const wreck = spawnAI(g, e, 800, 1, 'sedan', 0, { lane: 1, dead: true });
  g.T.detach(wreck, { vx: 0, vz: 0, w: 0 });
  g.T.update(0.001, g.D);
  const cars = [];
  for (let i = 0; i < 6; i++) cars.push(spawnAI(g, e, 560 - i * 70, 1, i % 3 === 0 ? 'pickup' : 'sedan', 27, { lane: 1 }));
  g.D.place(g.D.x - 200 * info.tx, g.D.z - 200 * info.tz, g.D.yaw); // parked behind them, so the traffic is simulated
  g.D.v = 0;
  for (let i = 0; i < 30 * 70; i++) tick(g, 1 / 30);
  assert.equal(g.T.stats.crashes + g.T.stats.pileups, 0, JSON.stringify(g.T.stats));
  assert.equal(g.T.stats.wrecks, 1, 'only the original wreck');
  assert.ok(wreck.obs && wreck.obs.stat && Math.abs(wreck.obs.s - 800) < 15, 'its place on the road is published for the others');
  for (const c of cars) assert.ok(!c.free && (c.s > 810 || c.s < 790 || c.lat !== wreck.obs.lat), 'not inside the wreck');
  assert.ok(cars.filter((c) => c.s > 800).length >= 4, 'most of them have got past it by changing lane');
});

test('traffic: a wreck smoulders for a while and is towed away once nobody is looking', () => {
  const g = makeGame();
  const e = findEdge(g, 'interstate', 1500);
  const info = placeOnEdge(g, e, 600, 1, 0.16 * e.P.width);
  quiet(g);
  const wreck = spawnAI(g, e, 520, 1, 'sedan', 0, { lane: 0, dead: true }); // behind the camera
  wreck.dmg = 0.8;
  g.T.detach(wreck, { vx: 0, vz: 0, w: 0 });
  g.D.v = 0;
  for (let i = 0; i < 30 * 30; i++) tick(g, 1 / 30);
  assert.ok(g.T.vehicles.includes(wreck), 'still there after half a minute');
  assert.ok(g.world.fx.smoke > 5, 'smoking');
  for (let i = 0; i < 30 * 60; i++) tick(g, 1 / 30);
  assert.ok(!g.T.vehicles.includes(wreck), 'towed away');
  void info;
});

test('traffic: vehicles drive on through a town and its junctions instead of piling up at the end of the road', () => {
  const g = makeGame({ seed: 5 });
  const town = findTown(g);
  assert.ok(town);
  g.D.place(town.x + 60, town.z + 45, Math.PI); // parked beside the main street
  g.D.v = 0;
  const seen = new Set();
  for (let i = 0; i < 30 * 60 * 3; i++) {
    tick(g, 1 / 30);
    for (const v of g.T.vehicles) if (v.e.conn) seen.add(v.id);
  }
  const st = g.T.stats;
  assert.ok(st.transits >= 5, `transits ${st.transits}`);
  assert.ok(seen.size >= 5, `vehicles on junction connectors ${seen.size}`);
  assert.equal(st.wrecks, 0, 'no accidents among the AI');
  assert.equal(st.crashes, 0);
  assert.ok(g.T.conns.size >= 2, 'connectors were built through the settlement');
  // every connector joins its two ports exactly or starts on the roads around them
  for (const c of g.T.conns.values()) {
    assert.ok(c.len > 20 && c.n >= 8 && c.mid > 0 && c.mid < c.len, c.id);
    assert.ok(Math.hypot(c.xs[0] - c.from.xs[c.from.n - 1], c.zs[0] - c.from.zs[c.from.n - 1]) < 60 || Math.hypot(c.xs[0] - c.from.xs[0], c.zs[0] - c.from.zs[0]) < 60, 'starts on the arriving road');
  }
});

test('traffic: a long soak near the start camp has no AI accidents, no vehicle stuck at a road end and a sensible mix of manoeuvres', () => {
  const g = makeGame({ seed: 77 });
  const H = g.gen.home;
  g.D.place(H.x, H.z, H.yaw);
  g.D.v = 0;
  let stuckEnd = 0;
  for (let i = 0; i < 30 * 60 * 4; i++) {
    tick(g, 1 / 30);
    for (const v of g.T.vehicles) if (!v.free && !v.arrive && !v.e.conn && (v.dir > 0 ? v.e.len - v.s : v.s) < 2 && v.v < 0.2 && !v.waiting && !v.next) stuckEnd++;
  }
  const st = g.T.stats;
  assert.equal(st.wrecks, 0, JSON.stringify(st));
  assert.equal(st.pileups, 0);
  assert.ok(st.passes > 0 && st.transits > 5, JSON.stringify(st));
  assert.equal(stuckEnd, 0, 'nobody sits at the end of a road with nowhere to go');
  assert.ok(st.ghosts < 400, `AI vehicles overlapped ${st.ghosts} times`);
});

test('traffic: a stopped line of cars is held at the junction until the crossing movement is clear', () => {
  const g = makeGame({ seed: 5 });
  const town = findTown(g);
  g.D.place(town.x + 60, town.z + 45, Math.PI);
  g.D.v = 0;
  let waited = 0, maxInZone = 0;
  for (let i = 0; i < 30 * 60 * 3; i++) {
    tick(g, 1 / 30);
    waited += g.T.stats.waits > 0 ? 1 : 0;
    // two vehicles on crossing movements must never be inside the shared crossing area together
    const inside = [...g.T.resv].filter((v) => v.e.conn && v.e.node === town && Math.abs(v.s - v.e.mid) < 30);
    for (let a = 0; a < inside.length; a++) for (let b = a + 1; b < inside.length; b++) {
      if (inside[a].e !== inside[b].e && g.T.conflict(inside[a].e, inside[b].e, inside[a].K.cls === 'heavy' || inside[b].K.cls === 'heavy')) maxInZone = Math.max(maxInZone, 1);
    }
  }
  assert.ok(waited > 0, 'somebody had to wait');
  assert.equal(maxInZone, 0, 'no two crossing movements share the junction at once');
});

test('traffic: vehicles obey traffic signals and stop lines at signalized town intersections', () => {
  const g = makeGame({ seed: 5 });
  const town = findTown(g);
  assert.ok(town);
  quiet(g);
  const pe = g.T.portEdge(town, 'E');
  assert.ok(pe && pe.e);
  const e = pe.e;
  const startS = pe.start ? 60 : e.len - 60;
  const dir = pe.start ? -1 : 1;
  const car = spawnAI(g, e, startS, dir, 'sedan', 12, { lane: 0 });
  // Set clock to red phase for axis X (t = 25s, red duration until 48s)
  g.T.clock = 25;
  g.D.place(town.x + 50, town.z, Math.PI);
  g.D.v = 0;
  for (let i = 0; i < 30 * 8; i++) {
    tick(g, 1 / 30);
    g.T.clock = 25;
  }
  assert.ok(car.v < 1.0, `car stopped on red light: v=${car.v}`);
  assert.equal(car.e.conn, undefined, 'car did not enter junction while red');
  assert.ok(car.signalPhase === 'red' || car.waitT > 0);

  // Switch to green phase for axis X (t = 5s)
  g.T.clock = 5;
  for (let i = 0; i < 30 * 10; i++) {
    tick(g, 1 / 30);
    g.T.clock = 5;
  }
  assert.ok(car.v > 1.5 || car.e.conn || g.T.stats.transits > 0, 'car proceeded on green light');
});

test('traffic: directional turn signals activate 50m before junction turns', () => {
  const g = makeGame({ seed: 5 });
  const town = findTown(g);
  quiet(g);
  const pe = g.T.portEdge(town, 'W');
  assert.ok(pe && pe.e);
  const e = pe.e;
  const startS = pe.start ? 120 : e.len - 120;
  const dir = pe.start ? -1 : 1;
  const car = spawnAI(g, e, startS, dir, 'sedan', 8, { lane: 0 });
  g.T.planNext(car);
  if (car.next && car.next.e && car.next.e.conn) {
    car.next.e.turn = 'left';
  }
  g.D.place(town.x + 200, town.z, Math.PI);
  g.D.v = 0;
  let signaled = false;
  for (let i = 0; i < 30 * 12; i++) {
    tick(g, 1 / 30);
    const toEnd = g.T.remain(car);
    if (toEnd <= 50 && toEnd > 0 && car.signal === -1) {
      signaled = true;
      break;
    }
  }
  assert.ok(signaled, 'turn signal was activated within 50m of turning connector');
});

test('traffic: non-emergency vehicles yield and move over when emergency vehicle approaches from behind', () => {
  const g = makeGame();
  const e = findEdge(g, 'interstate', 1500);
  quiet(g);
  // Civilian sedan in inner lane 0
  const civilian = spawnAI(g, e, 300, 1, 'sedan', 18, { lane: 0 });
  // Police interceptor in inner lane 0 approaching fast from behind
  const police = spawnAI(g, e, 240, 1, 'police', 32, { lane: 0 });
  g.D.place(e.xs[0], e.zs[0], 0);
  g.D.v = 0;
  let movedOverOrSlowed = false;
  for (let i = 0; i < 30 * 6; i++) {
    tick(g, 1 / 30);
    if (civilian.signal === 1 || civilian.lane === 1 || civilian.mode === 'signal' || civilian.v < 15) {
      movedOverOrSlowed = true;
      break;
    }
  }
  assert.ok(movedOverOrSlowed, 'civilian vehicle reacted to emergency vehicle approaching from behind');
});

