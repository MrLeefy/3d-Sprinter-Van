import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/gen.js';
import { layoutOf, TILE, tileKey } from '../src/world/layout.js';
import { streetPlan } from '../src/scene/towns.js';
import { edgeAt } from '../src/scene/roadside.js';

const W = new World(7);
const nodes = [];
for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) nodes.push(W.node(i, j));
const real = nodes.filter((n) => n.kind !== 'junction');

test('towns: every lot, sign and block is registered in the tile that contains its centre', () => {
  assert.ok(real.length > 20);
  for (const n of real) {
    const L = layoutOf(W, n);
    const tile = (x, z) => L.tiles.get(tileKey(Math.floor(x / TILE), Math.floor(z / TILE)));
    for (const l of L.lots) assert.ok(tile(l.x, l.z)?.lots.includes(l.id), `${n.name} lot ${l.k} ${l.id}`);
    L.signs.forEach((s, i) => assert.ok(tile(s.x, s.z)?.signs.includes(i), `${n.name} welcome sign ${i}`));
    for (const b of L.blocks) assert.ok(tile((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)?.blocks.includes(b.id), `${n.name} block ${b.id}`);
    L.props.trees.forEach((t, i) => assert.ok(tile(t[0], t[1])?.trees.includes(i)));
    L.props.cars.forEach((c, i) => assert.ok(tile(c[0], c[1])?.cars.includes(i)));
  }
});

test('towns: streets are cut at crossings so no two street surfaces overlap', () => {
  for (const n of real.filter((q) => q.kind === 'city' || q.kind === 'town')) {
    const L = layoutOf(W, n);
    const plan = streetPlan(L);
    assert.ok(plan.pieces.length > 0 && plan.patches.length > 0, n.name);
    // total paved length of each straight street = its pieces + the crossings cut out of it
    for (const s of L.streets.filter((q) => q.kind !== 'gravel')) {
      const horiz = Math.abs(s.az - s.bz) < 1e-6;
      const len = horiz ? Math.abs(s.bx - s.ax) : Math.abs(s.bz - s.az);
      const pieces = plan.pieces.filter((p) => p.s === s).reduce((a, p) => a + (p.b - p.a), 0);
      const cuts = plan.patches.filter((p) => (horiz ? Math.abs(p.z - s.az) < 1e-6 : Math.abs(p.x - s.ax) < 1e-6)).reduce((a, p) => a + (horiz ? p.wx : p.wz), 0);
      assert.ok(Math.abs(pieces + cuts - len) < 0.5, `${n.name} ${s.name}: ${pieces.toFixed(1)} + ${cuts.toFixed(1)} vs ${len.toFixed(1)}`);
    }
  }
});

test('roadside: edgeAt walks a road end to end with unit tangents', () => {
  W.buildEdgesFor(-3000, -3000, 3000, 3000);
  for (const e of [...W.edges.values()].slice(0, 8)) {
    const a = edgeAt(e, 0), b = edgeAt(e, e.len);
    assert.ok(Math.hypot(a.x - e.xs[0], a.z - e.zs[0]) < 1e-6);
    assert.ok(Math.hypot(b.x - e.xs[e.n - 1], b.z - e.zs[e.n - 1]) < 1.5);
    for (let s = 0; s <= e.len; s += e.len / 20) {
      const p = edgeAt(e, s);
      assert.ok(Math.abs(Math.hypot(p.tx, p.tz) - 1) < 1e-6);
    }
  }
});
