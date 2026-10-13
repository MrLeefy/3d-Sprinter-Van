import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/gen.js';
import { poisOf, poisNear, POI_TYPES } from '../src/world/poi.js';

const W = new World(7);
W.buildEdgesFor(-4000, -4000, 4000, 4000);

test('poi: every road carries a few discoveries, deterministic and off the carriageway', () => {
  let total = 0;
  for (const e of W.edges.values()) {
    const a = poisOf(W, e);
    total += a.length;
    for (const p of a) {
      assert.ok(POI_TYPES[p.type], p.type);
      assert.ok(p.name && p.name.length > 3);
      const q = W.roadAt(p.x, p.z);
      assert.ok(q && q.d > e.P.width / 2 + 10, 'clear of the road surface');
      assert.ok(!W.settlementAt(p.x, p.z, 50), 'not inside a town');
      assert.ok(Number.isFinite(p.y) && Number.isFinite(p.yaw));
    }
  }
  assert.ok(total >= 12, `found ${total} points of interest`);
  const W2 = new World(7);
  W2.buildEdgesFor(-4000, -4000, 4000, 4000);
  const ids = (w) => [...w.edges.values()].flatMap((e) => poisOf(w, e).map((p) => p.id)).sort().join();
  assert.equal(ids(W), ids(W2));
});

test('poi: lookups by position return only nearby points', () => {
  const all = [...W.edges.values()].flatMap((e) => poisOf(W, e));
  const p = all[0];
  const near = poisNear(W, p.x, p.z, 50);
  assert.ok(near.some((q) => q.id === p.id));
  assert.ok(near.every((q) => Math.hypot(q.x - p.x, q.z - p.z) <= 50));
});
