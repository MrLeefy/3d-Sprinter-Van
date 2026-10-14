import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, ROAD } from '../src/world/gen.js';
import { SHOULDER } from '../src/world/highway.js';
import { layoutOf, junctionStreets, JUNCTION_PORT, faceRot } from '../src/world/layout.js';

// Plain junction nodes: the pavement must be the roads that actually meet there, as wide as they are drawn.
const W = new World(7);
const junctions = [];
for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
  const n = W.node(i, j);
  if (n.kind === 'junction') junctions.push(n);
}
const SIDES = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };
const armList = (n) => Object.entries(W.armsOf(n)).filter(([, a]) => a);
const shape = (n) => armList(n).map(([s]) => s).sort().join('');

test('junction pavement: arms are the real roads, at their drawn width (lanes plus shoulders)', () => {
  assert.ok(junctions.length > 40, `junction nodes ${junctions.length}`);
  for (const n of junctions) {
    for (const [side, a] of armList(n)) {
      assert.equal(a.w, ROAD[a.cls].width + 2 * (SHOULDER[a.cls] || 0), `${n.key} ${side} arm width`);
      const [ox, oz] = SIDES[side];
      const e = side === 'E' ? W.edge(n.i, n.j, 0) : side === 'W' ? W.edge(n.i - 1, n.j, 0) : side === 'N' ? W.edge(n.i, n.j - 1, 1) : W.edge(n.i, n.j, 1);
      assert.ok(e && e.cls === a.cls, `${n.key} ${side} arm matches the built edge`);
      assert.equal(e.P.width + 2 * e.sh, a.w);
      // the street reaches the port (where the road ribbon ends) and is at least as wide as the road
      const px = n.x + ox * JUNCTION_PORT, pz = n.z + oz * JUNCTION_PORT;
      const s = junctionStreets(n, W.armsOf(n)).find((q) => px >= q.x0 - 1e-6 && px <= q.x1 + 1e-6 && pz >= q.z0 - 1e-6 && pz <= q.z1 + 1e-6);
      assert.ok(s, `${n.key} ${side} port is paved`);
      assert.ok(s.w >= a.w - 1e-9, `${n.key} ${side} street ${s.w} at least as wide as road ${a.w}`);
    }
  }
});

test('junction pavement: a side with no road is not a dead-end stub', () => {
  for (const n of junctions) {
    const arms = W.armsOf(n);
    const streets = junctionStreets(n, arms);
    for (const [side, [ox, oz]] of Object.entries(SIDES)) {
      if (arms[side]) continue;
      // reach of any street beyond the node centre toward the missing side
      const crossing = ox ? Math.max(arms.N?.w ?? 0, arms.S?.w ?? 0) : Math.max(arms.E?.w ?? 0, arms.W?.w ?? 0);
      for (const s of streets) {
        const far = ox ? Math.max(ox * (s.ax - n.x), ox * (s.bx - n.x)) : Math.max(oz * (s.az - n.z), oz * (s.bz - n.z));
        const alongThatAxis = ox ? s.az === s.bz : s.ax === s.bx;
        if (alongThatAxis) assert.ok(far <= crossing / 2 + 1e-9, `${n.key} no stub on missing ${side} side (${far.toFixed(1)} > ${crossing / 2})`);
      }
    }
    if (!armList(n).length) assert.equal(streets.length, 0, `${n.key} roadless junction paves nothing`);
  }
});

test('junction pavement: every arm keeps its own road class, so markings and grip match the road', () => {
  let checked = 0, mixed = 0;
  for (const n of junctions) {
    const arms = W.armsOf(n);
    for (const [side, [ox, oz]] of Object.entries(SIDES)) {
      const a = arms[side];
      if (!a) continue;
      // just clear of the widest pavement in the node and inside the port: this arm's own street
      const clear = Math.max(...armList(n).map(([, q]) => q.w)) / 2 + 1;
      assert.ok(clear < JUNCTION_PORT);
      const sf = W.surfaceAt(n.x + ox * clear, n.z + oz * clear);
      assert.equal(sf.kind, 'road', `${n.key} ${side} junction pavement is a road surface`);
      assert.equal(sf.cls, a.cls, `${n.key} ${side} surface class`);
      const opp = arms[{ E: 'W', W: 'E', N: 'S', S: 'N' }[side]];
      if (opp && opp.cls !== a.cls) mixed++;
      checked++;
    }
  }
  assert.ok(checked > 80, `arms checked ${checked}`);
  assert.ok(mixed > 0, 'covers an axis whose two roads are different classes');
});

test('junction pavement: where roads cross, the biggest road owns the middle', () => {
  let crossings = 0;
  for (const n of junctions) {
    const arms = W.armsOf(n);
    const list = armList(n).map(([, a]) => a);
    const hasEW = arms.E || arms.W, hasNS = arms.N || arms.S;
    if (!hasEW || !hasNS) continue;
    const best = list.sort((p, q) => p.rank - q.rank)[0];
    const sf = W.surfaceAt(n.x, n.z);
    assert.equal(sf.kind, 'road');
    assert.equal(sf.cls, best.cls, `${n.key} centre takes the major road's class`);
    crossings++;
  }
  assert.ok(crossings > 15, `crossings ${crossings}`);
});

test('junction pavement: ground beside the pavement stays ground (no tarmac out in the grass)', () => {
  let checked = 0;
  for (const n of junctions) {
    if (!armList(n).length) continue;
    const arms = W.armsOf(n);
    const reach = Math.max(...armList(n).map(([, a]) => a.w)) / 2 + 2;
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const sf = W.surfaceAt(n.x + dx * (reach + 2), n.z + dz * (reach + 2));
      if (sf.kind === 'water') continue;
      assert.notEqual(sf.kind, 'street', `${n.key} corner is not a street`);
      assert.ok(sf.kind === 'ground' || sf.kind === 'road', `${n.key} corner ${sf.kind}`); // a road only if another edge runs right past
      checked++;
    }
    void arms;
  }
  assert.ok(checked > 100, `corners checked ${checked}`);
});

test('junction pavement: stop signs stand only where a road gives way to a crossing road', () => {
  let signs = 0, yields = 0;
  for (const n of junctions) {
    const arms = W.armsOf(n);
    const L = layoutOf(W, n);
    const stops = L.props.misc.filter((m) => m[3] === 'stop');
    let expect = 0;
    for (const [side] of armList(n)) {
      const ox = SIDES[side][0];
      const crossing = (ox ? [arms.N, arms.S] : [arms.E, arms.W]).filter(Boolean);
      if (!crossing.length) continue;
      if (arms[side].rank >= Math.min(...crossing.map((q) => q.rank))) expect++;
    }
    assert.equal(stops.length, expect, `${n.key} (${shape(n)}) stop signs`);
    for (const s of stops) {
      // every sign faces along one of the four arms, sits beside the arm and clear of the pavement
      assert.ok(Math.abs(s[2] - faceRot(1, 0)) < 1e-9 || Math.abs(s[2] - faceRot(-1, 0)) < 1e-9 || Math.abs(s[2] - faceRot(0, 1)) < 1e-9 || Math.abs(s[2] - faceRot(0, -1)) < 1e-9);
      const sf = W.surfaceAt(s[0], s[1]);
      assert.equal(sf.kind === 'road' && sf.cls !== 'gravel' && sf.cls !== 'dirt' && Math.hypot(s[0] - n.x, s[1] - n.z) < 4, false, `${n.key} stop sign is not in the carriageway`);
    }
    signs += stops.length;
    if (expect) yields++;
  }
  assert.ok(signs > 20 && yields > 10, `signs ${signs} on ${yields} junctions`);
});

test('junction pavement: every arrangement of roads occurs (straight, tee, cross, bend, spur)', () => {
  const seen = new Set(junctions.map(shape));
  // shapes are the sorted arm letters: straight (EW, NS), tee (ENW, ESW, ENS, NSW), cross (ENSW), bend (EN, SW), spur (S)
  for (const want of ['EW', 'NS', 'ENW', 'ESW', 'ENS', 'NSW', 'ENSW', 'EN', 'SW', 'S']) assert.ok(seen.has(want), `junction shape ${want} present; saw ${[...seen].join(',')}`);
});
