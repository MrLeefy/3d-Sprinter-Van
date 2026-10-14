import test from 'node:test';
import assert from 'node:assert/strict';
import { SIDES, opposite, portPoint, turnOf, transitAllowed, turnWeight, pickExit, connectorPath, resample, movementsConflict, classRank, mustYield } from '../src/sim/junction.js';

const town = { x: 1000, z: -500, Rp: 260, Rz: 190, kind: 'town' };
const conn = (a, b, node = town) => ({ inSide: a, outSide: b, path: connectorPath(node, a, b) });

test('turns: right-hand traffic, entering from E means heading west', () => {
  assert.equal(turnOf('E', 'W'), 'straight');
  assert.equal(turnOf('E', 'N'), 'right');
  assert.equal(turnOf('E', 'S'), 'left');
  assert.equal(turnOf('W', 'S'), 'right');
  assert.equal(turnOf('W', 'N'), 'left');
  assert.equal(turnOf('N', 'W'), 'right');
  assert.equal(turnOf('S', 'W'), 'left');
  assert.equal(turnOf('S', 'S'), 'uturn');
  for (const s of SIDES) assert.equal(turnOf(s, opposite(s)), 'straight');
});

test('ports: the four ports sit on the axes of the settlement', () => {
  assert.deepEqual(portPoint(town, 'E'), [1260, -500]);
  assert.deepEqual(portPoint(town, 'W'), [740, -500]);
  assert.deepEqual(portPoint(town, 'N'), [1000, -690]);
  assert.deepEqual(portPoint(town, 'S'), [1000, -310]);
});

test('transit: farms and lodges are dead ends, truck stops only have their main street, towns connect everywhere', () => {
  assert.equal(transitAllowed('farm', 'E', 'W'), false);
  assert.equal(transitAllowed('lodge', 'N', 'S'), false);
  assert.equal(transitAllowed('truckstop', 'E', 'W'), true);
  assert.equal(transitAllowed('truckstop', 'E', 'N'), false);
  assert.equal(transitAllowed('camp', 'W', 'E'), true);
  assert.equal(transitAllowed('town', 'E', 'N'), true);
  assert.equal(transitAllowed('junction', 'S', 'E'), true);
  assert.equal(transitAllowed('town', 'E', 'E'), false);
  assert.ok(turnWeight('town', 'straight') > turnWeight('town', 'left') && turnWeight('village', 'straight') > turnWeight('town', 'straight'));
});

test('exit choice follows the weights and never picks an impossible side', () => {
  const cands = [{ side: 'W', weight: 0.5 }, { side: 'N', weight: 0.25 }, { side: 'S', weight: 0.25 }];
  assert.equal(pickExit(cands, 0.1), 'W');
  assert.equal(pickExit(cands, 0.6), 'N');
  assert.equal(pickExit(cands, 0.99), 'S');
  assert.equal(pickExit([], 0.5), null);
  assert.equal(pickExit([{ side: 'W', weight: 0 }], 0.5), null);
  const n = { W: 0, N: 0, S: 0 };
  for (let i = 0; i < 1000; i++) n[pickExit(cands, i / 1000)]++;
  assert.ok(n.W > 480 && n.W < 520 && n.N > 230 && n.N < 270);
});

test('connector: a straight movement runs port to port; a turn rounds the corner inside the node', () => {
  const st = connectorPath(town, 'E', 'W');
  assert.ok(Math.abs(st.len - 520) < 1e-6);
  assert.ok(Math.abs(st.xs[0] - 1260) < 1e-9 && Math.abs(st.xs[st.n - 1] - 740) < 1e-9);
  for (let k = 0; k < st.n; k++) assert.ok(Math.abs(st.zs[k] + 500) < 1e-9);
  const rt = connectorPath(town, 'E', 'N');
  assert.ok(Math.abs(rt.xs[0] - 1260) < 1e-9 && Math.abs(rt.zs[rt.n - 1] + 690) < 1e-9);
  // the corner is cut inside the quadrant between the two ports, never beyond the street axes
  for (let k = 0; k < rt.n; k++) assert.ok(rt.xs[k] >= 1000 - 1e-6 && rt.zs[k] <= -500 + 1e-6);
  // length: two straights plus a quarter circle of radius 12 instead of the 12 + 12 corner
  const expect = 260 - 12 + 190 - 12 + (Math.PI / 2) * 12;
  assert.ok(Math.abs(rt.len - expect) < 0.5, `len=${rt.len}`);
  // smooth: no heading jump bigger than the arc step allows
  let worst = 0;
  for (let k = 2; k < rt.n; k++) {
    const a = Math.atan2(rt.zs[k - 1] - rt.zs[k - 2], rt.xs[k - 1] - rt.xs[k - 2]), b = Math.atan2(rt.zs[k] - rt.zs[k - 1], rt.xs[k] - rt.xs[k - 1]);
    worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
  }
  assert.ok(worst < 0.6, `heading change per sample ${worst}`);
  // a tiny junction forces a tighter corner but still connects the ports
  const tiny = { x: 0, z: 0, Rp: 14, Rz: 14, kind: 'junction' };
  const tp = connectorPath(tiny, 'W', 'S');
  assert.ok(Math.abs(tp.xs[0] + 14) < 1e-9 && Math.abs(tp.zs[tp.n - 1] - 14) < 1e-9);
});

test('resample: uniform spacing and the same total length', () => {
  const r = resample([[0, 0], [10, 0], [10, 10]], 2);
  assert.ok(Math.abs(r.len - 20) < 1e-9 && r.n === 11);
  for (let k = 1; k < r.n; k++) assert.ok(Math.abs(Math.hypot(r.xs[k] - r.xs[k - 1], r.zs[k] - r.zs[k - 1]) - 2) < 1e-6);
});

test('conflicts: opposing straights pass each other, a left turn crosses the oncoming lane, cross traffic collides', () => {
  const ew = conn('E', 'W'), we = conn('W', 'E'), ns = conn('N', 'S'), sn = conn('S', 'N');
  assert.equal(movementsConflict(ew, we, town), false, 'opposite directions on the main street');
  assert.equal(movementsConflict(ns, sn, town), false);
  assert.equal(movementsConflict(ew, ns, town), true, 'cross traffic');
  assert.equal(movementsConflict(ew, sn, town), true);
  const leftWN = conn('W', 'N'); // heading east, turning left (north) across the westbound lane
  assert.equal(turnOf('W', 'N'), 'left');
  assert.equal(movementsConflict(leftWN, ew, town), true, 'the left turn crosses the oncoming straight');
  const rightEN = conn('E', 'N');
  assert.equal(movementsConflict(rightEN, we, town), false, 'a right turn merges away from the oncoming lane');
  assert.equal(movementsConflict(ew, conn('E', 'N'), town), false, 'same entry: they split, car following handles it');
  assert.equal(movementsConflict(conn('W', 'N'), conn('S', 'N'), town), true, 'same exit: they merge into one lane, so one goes first');
  assert.equal(movementsConflict(conn('W', 'S'), conn('E', 'N'), town), false, 'a right turn and the right turn from the other side never meet');
});

test('give way: bigger road first, then whoever is first, one of two always yields', () => {
  const small = { rank: classRank('county'), eta: 3, id: 1 }, big = { rank: classRank('interstate'), eta: 6, id: 2 };
  assert.equal(mustYield(small, big), true, 'the county road waits for an interstate that is 6 s away');
  assert.equal(mustYield(big, small), false);
  assert.equal(mustYield(small, { ...big, eta: 20 }), false, 'but goes when the interstate is far');
  assert.equal(mustYield(small, { ...big, holds: true, eta: 99 }), true, 'anyone already inside has priority');
  assert.equal(mustYield({ ...big, holds: true }, small), false);
  const a = { rank: 3, eta: 4, id: 1 }, b = { rank: 3, eta: 4.1, id: 2 };
  assert.notEqual(mustYield(a, b), mustYield(b, a), 'exactly one of two equal vehicles yields');
  assert.equal(mustYield({ rank: 3, eta: 5, id: 1 }, { rank: 3, eta: 2, id: 2 }), true);
  assert.equal(mustYield({ rank: 3, eta: 2, id: 1 }, { rank: 3, eta: 5, id: 2 }), false);
});

test('connector: takes over from the real roads a little before the ports and stays on the street axis in between', () => {
  // roads that meet the east and west ports at an angle of about 25°
  const th = (25 * Math.PI) / 180;
  const tin = [-Math.cos(th), Math.sin(th)];
  const tout = [-Math.cos(th), -Math.sin(th)];
  const pre = { p: [1260 - 24 * tin[0], -500 - 24 * tin[1]], t: tin };
  const post = { p: [740 + 24 * tout[0], -500 + 24 * tout[1]], t: tout };
  const p = connectorPath(town, 'E', 'W', 3, 12, pre, post);
  const hd = (k) => [p.xs[k + 1] - p.xs[k], p.zs[k + 1] - p.zs[k]].map((v, _, a) => v / Math.hypot(a[0], a[1]));
  assert.ok(Math.hypot(p.xs[0] - pre.p[0], p.zs[0] - pre.p[1]) < 1e-9, 'starts on the arriving road');
  assert.ok(Math.hypot(p.xs[p.n - 1] - post.p[0], p.zs[p.n - 1] - post.p[1]) < 1e-9, 'ends on the leaving road');
  const h0 = hd(0), h1 = hd(p.n - 2);
  assert.ok(Math.abs(h0[0] - tin[0]) < 0.12 && Math.abs(h0[1] - tin[1]) < 0.12, `start heading ${h0}`);
  assert.ok(Math.abs(h1[0] - tout[0]) < 0.12 && Math.abs(h1[1] - tout[1]) < 0.12, `end heading ${h1}`);
  // the middle of the street is on the axis
  const mid = Math.floor(p.n / 2);
  assert.ok(Math.abs(p.zs[mid] + 500) < 0.05);
  // heading never swings wildly along the way
  let worst = 0;
  for (let k = 1; k < p.n - 1; k++) {
    const a = hd(k - 1), b = hd(k);
    worst = Math.max(worst, Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])));
  }
  assert.ok(worst < 0.25, `worst heading step ${worst}`);
  // a tiny junction: the blend still never folds back on itself
  const tiny = { x: 0, z: 0, Rp: 14, Rz: 14, kind: 'junction' };
  const t2 = connectorPath(tiny, 'E', 'W', 3, 12, { p: [38, -9], t: [-0.95, 0.31] }, { p: [-38, 9], t: [-0.95, 0.31] });
  for (let k = 1; k < t2.n; k++) assert.ok(t2.xs[k] < t2.xs[k - 1] + 1e-9, 'always heading west');
});
