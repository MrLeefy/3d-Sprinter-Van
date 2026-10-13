import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/gen.js';
import { planRoute } from '../src/world/route.js';

const W = new World(7);

test('route: connects two towns over the road network', () => {
  const start = W.home;
  const dst = W.node(2, 1);
  const r = planRoute(W, { x: start.x, z: start.z }, dst);
  assert.ok(r, 'a route exists');
  r.build();
  assert.ok(r.done);
  assert.ok(r.nodes.length >= 2);
  assert.equal(r.nodes[r.nodes.length - 1].key, dst.key);
  const straight = Math.hypot(dst.x - start.x, dst.z - start.z);
  assert.ok(r.length >= straight * 0.98, 'never shorter than the crow flies');
  assert.ok(r.length < straight * 3.2 + 4000, `route not absurdly long (${Math.round(r.length)} vs ${Math.round(straight)})`);
});

test('route: polyline is continuous and ends in the destination town', () => {
  const r = planRoute(W, { x: W.home.x, z: W.home.z }, W.node(-2, 2)).build();
  let gap = 0;
  for (let i = 1; i < r.xs.length; i++) gap = Math.max(gap, Math.hypot(r.xs[i] - r.xs[i - 1], r.zs[i] - r.zs[i - 1]));
  assert.ok(gap < 120, `max gap ${gap.toFixed(1)} m`);
  const n = r.xs.length - 1;
  assert.ok(Math.hypot(r.xs[n] - r.dst.x, r.zs[n] - r.dst.z) < 8, 'ends at the destination centre');
  assert.ok(r.maneuvers.some((m) => m.kind === 'arrive'));
  assert.ok(r.maneuvers.every((m, i, a) => i === 0 || m.s >= a[i - 1].s - 1e-6), 'manoeuvres in order');
});

test('route: locate tracks progress along the polyline', () => {
  const r = planRoute(W, { x: W.home.x, z: W.home.z }, W.node(1, -2)).build();
  const k = Math.floor(r.xs.length / 2);
  const p = r.locate(r.xs[k] + 3, r.zs[k] + 2, Math.max(0, k - 20));
  assert.ok(p.d < 6);
  assert.ok(Math.abs(p.s - r.ss[k]) < 12);
});

test('route: deterministic', () => {
  const a = planRoute(new World(7), { x: 0, z: 0 }, new World(7).node(2, 2));
  const b = planRoute(new World(7), { x: 0, z: 0 }, new World(7).node(2, 2));
  assert.ok(a && b);
  assert.equal(a.nodes.map((n) => n.key).join('|'), b.nodes.map((n) => n.key).join('|'));
});
