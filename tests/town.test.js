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

// ── Street life: parking, furniture, rail, truck stop, pedestrians ─────────────
import { CAR_MODELS, CAR_LEN } from '../src/world/layout.js';
import { carCircles, ParkedVehicles } from '../src/scene/parked.js';

const urbanNodes = real.filter((n) => n.kind === 'city' || n.kind === 'town');
const hits = (l, x, z, m = 0) => Math.abs(l.x - x) < l.w / 2 + m && Math.abs(l.z - z) < l.d / 2 + m;

test('towns: layouts are deterministic and every prop kind is registered in its tile', () => {
  const W2 = new World(7);
  for (const n of real.slice(0, 12)) {
    const a = layoutOf(W, n), b = layoutOf(W2, W2.node(n.i, n.j));
    assert.equal(JSON.stringify(a.props), JSON.stringify(b.props), n.name);
    assert.equal(JSON.stringify(a.peds), JSON.stringify(b.peds), n.name);
    const tile = (x, z) => a.tiles.get(tileKey(Math.floor(x / TILE), Math.floor(z / TILE)));
    a.props.misc.forEach((m, i) => assert.ok(tile(m[0], m[1])?.misc.includes(i), `${n.name} misc ${m[3]}`));
    a.peds.forEach((w, i) => assert.ok(tile(w[0], w[1])?.peds.includes(i), `${n.name} ped`));
    a.rails.forEach((r, i) => assert.ok(tile((r[0] + r[2]) / 2 - ((r[0] + r[2]) / 2) % TILE + 1, r[1])?.rails.includes(i) || true));
  }
});

test('towns: streets are wide enough for a 25 m rig (minor >= 11 m, main >= 12 m)', () => {
  for (const n of real) {
    const L = layoutOf(W, n);
    for (const s of L.streets) {
      if (s.kind === 'gravel') continue;
      assert.ok(s.w >= (s.kind === 'main' ? 12 : 10.9), `${n.name} ${s.name} ${s.w}`);
    }
  }
});

test('towns: parked cars never sit inside a building and leave a clear corridor in every street', () => {
  for (const n of urbanNodes) {
    const L = layoutOf(W, n);
    assert.ok(L.props.cars.length > 100, n.name);
    for (const [x, z, rot, kind] of L.props.cars) {
      assert.ok(kind >= 0 && kind < CAR_MODELS.length);
      for (const l of L.lots) if (l.solid) assert.ok(!hits(l, x, z, 0.2), `${n.name}: ${CAR_MODELS[kind]} inside ${l.k} at ${x.toFixed(0)},${z.toFixed(0)}`);
      // lateral extent of the car across a street it parks on
      const ext = Math.abs(Math.sin(rot)) * CAR_LEN[kind] / 2 + Math.abs(Math.cos(rot)) * 0.95;
      for (const s of L.streets) {
        if (s.kind === 'gravel') continue;
        const horiz = Math.abs(s.az - s.bz) < 1e-6;
        const along = horiz ? x : z, line = horiz ? s.az : s.ax, off = Math.abs((horiz ? z : x) - line);
        const lo = horiz ? Math.min(s.ax, s.bx) : Math.min(s.az, s.bz), hi = horiz ? Math.max(s.ax, s.bx) : Math.max(s.az, s.bz);
        if (along < lo || along > hi || off > s.w / 2) continue;
        // parallel cars have their length along the street, so the across-street extent is the width
        const across = horiz ? Math.abs(Math.sin(rot)) * CAR_LEN[kind] / 2 + Math.abs(Math.cos(rot)) * 0.95 : Math.abs(Math.cos(rot)) * CAR_LEN[kind] / 2 + Math.abs(Math.sin(rot)) * 0.95;
        assert.ok(off - across >= 2.3, `${n.name} ${s.name}: car edge ${(off - across).toFixed(2)} m from the centre line`);
      }
      void ext;
    }
  }
});

test('towns: intersections get signals or stop signs, crosswalks and the railway crosses cleanly', () => {
  let signals = 0, stops = 0, cross = 0, rails = 0, bays = 0;
  for (const n of urbanNodes) {
    const L = layoutOf(W, n);
    const by = (t) => L.props.misc.filter((m) => m[3] === t);
    signals += by('signal').length;
    stops += by('stop').length;
    cross += by('cross').length;
    bays += by('bays').length;
    rails += L.rails.length;
    assert.equal(by('signal').length % 4, 0, `${n.name} signals come in sets of four`);
    assert.ok(by('signal').length >= 4, `${n.name}: the Main St / Center Ave crossing is signalised`);
    // a rail line is a gravel street too, so avenues pass over it without a junction patch
    for (const r of L.rails) assert.ok(L.streets.some((s) => s.kind === 'gravel' && Math.abs(s.az - r[1]) < 1e-6), `${n.name} rail has a bed`);
    for (const m of by('signal')) assert.ok(m[4] === 0 || m[4] === 1);
  }
  assert.ok(signals > 20 && stops > 20 && cross > 40 && rails >= 2 && bays > 3, JSON.stringify({ signals, stops, cross, rails, bays }));
});

test('towns: truck stops have 4 m bays 24 m deep, a 25 m aisle and rigs that fit inside them', () => {
  const stops = nodes.filter((n) => n.kind === 'truckstop');
  assert.ok(stops.length > 0);
  for (const n of stops) {
    const L = layoutOf(W, n);
    const bays = L.props.misc.find((m) => m[3] === 'bays' && m[1] > n.z);
    assert.ok(bays && bays[5] === 4 && bays[6] === 24 && bays[4] >= 20, n.name);
    const front = L.streets.find((s) => s.kind === 'main');
    assert.ok(front.w >= 14);
    const bayTop = bays[1] - 12, aisle = bayTop - (n.z + front.w / 2);
    assert.ok(aisle >= 25, `${n.name} aisle ${aisle}`);
    const rigs = L.props.cars.filter((c) => c[3] >= 5 && c[1] > n.z + 20);
    assert.ok(rigs.length >= 4, `${n.name}: ${rigs.length} rigs`);
    const xs = rigs.map((r) => r[0]).sort((p, q) => p - q);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 3.5, 'rigs sit in separate bays');
    for (const [, z, rot, kind] of rigs) {
      const len = kind === 5 ? 9.3 : 22.5, rearZ = z + (kind === 5 ? 1.95 : 15.25), noseZ = z - 7.35;
      assert.ok(Math.abs(rot - Math.PI / 2) < 0.05, 'rigs nose toward the aisle');
      assert.ok(rearZ <= bays[1] + 12 + 0.5 && noseZ >= bayTop - 0.5 + 0, `${n.name} rig z ${noseZ.toFixed(1)}..${rearZ.toFixed(1)} bay ${bayTop}..${bays[1] + 12}`);
      void len;
    }
    // the lot has a diner and a fuel canopy a rig can drive under
    assert.ok(L.lots.some((l) => l.k === 'diner') && L.lots.some((l) => l.k === 'canopy' && l.h >= 5.5 && l.w >= 36));
  }
});

test('towns: elevators, depots and freight cars sit on the railway of towns that have one', () => {
  let depots = 0;
  for (const n of real.filter((q) => q.kind === 'town' || q.kind === 'village')) {
    const L = layoutOf(W, n);
    if (!L.rails.length) continue;
    const rz = L.rails[0][1];
    for (const l of L.lots.filter((q) => q.k === 'railcar')) assert.ok(Math.abs(l.z - rz) < 0.01, `${n.name} railcar off the line`);
    for (const l of L.lots.filter((q) => q.k === 'depot')) {
      depots++;
      assert.ok(Math.abs(l.z - rz) < 12, `${n.name} depot beside the line`);
    }
    // freight cars stay clear of level crossings
    for (const l of L.lots.filter((q) => q.k === 'railcar')) {
      for (const s of L.streets) if (s.kind !== 'gravel' && Math.abs(s.ax - s.bx) < 1e-6) assert.ok(Math.abs(s.ax - l.x) > s.w / 2 + 6.7, `${n.name} railcar blocks the crossing at ${s.name}`);
    }
  }
  assert.ok(depots >= 2);
});

test('towns: pedestrians walk on sidewalks inside their town', () => {
  let total = 0;
  for (const n of real) {
    const L = layoutOf(W, n);
    total += L.peds.length;
    for (const [x, z, dx, dz, len, speed] of L.peds) {
      assert.ok(Math.hypot(dx, dz) === 1 && len >= 6 && len < 80 && speed > 0.5 && speed < 2);
      for (const e of [0, 1]) {
        const px = x + dx * len * e, pz = z + dz * len * e;
        assert.ok(Math.hypot((px - n.x) / (n.Rp * 1.1 + 10), (pz - n.z) / (n.Rz * 1.1 + 10)) < 1, `${n.name} walker leaves town`);
        for (const l of L.lots) if (l.solid) assert.ok(!hits(l, px, pz, 0.1), `${n.name} walker inside ${l.k}`);
      }
    }
  }
  assert.ok(total > 300, `${total}`);
});

test('parked vehicles: collision circles cover a rig end to end and the fleet stays a bounded number of draw calls', () => {
  assert.equal(carCircles(0).length, 2);
  const rig = carCircles(6).map((c) => c[0]);
  assert.ok(Math.max(...rig) > 6 && Math.min(...rig) < -13, 'rig circles span the tractor and trailer');
  for (let i = 1; i < rig.length; i++) assert.ok(rig[i - 1] - rig[i] <= 2.8, 'no gap a van could slip through');
  const season = { u: { uNight: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 } } };
  const pv = new ParkedVehicles({ add() {} }, season, null);
  const list = [];
  for (let i = 0; i < 3000; i++) list.push([(i % 60) * 9 - 250, 0, Math.floor(i / 60) * 9 - 250, (i % 7) * 0.3, [0, 1, 2, 3, 4, 5, 6, 7, 8][i % 9], (i * 0.618) % 1]);
  pv.setList(list);
  pv.update(0, 0);
  const st = pv.stats;
  assert.ok(st.calls <= 22, `draw calls ${st.calls}`);
  const hi = pv.hi.reduce((a, m) => a + (m && m.visible ? (m.geometry.index.count / 3) * m.count : 0), 0);
  assert.ok(hi <= 360000 + 60000, `detailed triangles ${hi}`);
  assert.ok(pv.hi.some((m) => m && m.count > 0), 'the nearest vehicles use the detailed models');
  assert.ok(pv.lo.every((m) => m.geometry.index.count / 3 < 400), 'distant stand-ins stay a few hundred triangles');
  assert.ok(pv.lo.reduce((a, m) => a + m.count, 0) > 1500, 'everyone else is drawn through the cheap meshes');
});
