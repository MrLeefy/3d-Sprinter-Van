import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/gen.js';
import { Roadside } from '../src/scene/roadside.js';
import { ridgeProfile, RINGS } from '../src/world/horizon.js';
import {
  LIMIT_KMH, limitMph, kmhToMph, mileAt, mileMarkers, planHighway, lotArrays, lotWidthAt, taperAt, runawaySite, advanceSigns, wildlifeSigns, guardSpans, SHOULDER, MARGIN, MILE,
} from '../src/world/highway.js';

const W = new World(7);
const edges = [];
for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) for (let d = 0; d < 2; d++) {
  const e = W.edge(i, j, d);
  if (e) edges.push(e);
}
const big = edges.filter((e) => e.cls === 'interstate' || e.cls === 'highway');

test('posted limits in mph match the Driver table in km/h', () => {
  assert.deepEqual(LIMIT_KMH, { interstate: 129, highway: 105, county: 89, gravel: 56, dirt: 32 });
  assert.deepEqual(['interstate', 'highway', 'county', 'gravel', 'dirt'].map(limitMph), [80, 65, 55, 35, 20]);
  assert.equal(limitMph('street'), null);
  assert.equal(kmhToMph(129), 80);
});

test('mile numbers follow the road axis and stay consistent across edges', () => {
  assert.equal(mileAt(0, 0, 0), mileAt(0, MILE * 0.5, 9999));
  assert.equal(mileAt(0, MILE * 3 + 1, 0), mileAt(0, 0, 0) + 3);
  assert.equal(mileAt(1, 0, -MILE * 2 - 1), mileAt(1, 0, 0) + 2);
  for (const e of edges.slice(0, 60)) {
    const m = mileMarkers(e);
    for (let q = 1; q < m.length; q++) assert.ok(m[q].s > m[q - 1].s);
    for (const mk of m) {
      assert.ok(mk.s >= 80 && mk.s <= e.len - 80);
      const k = Math.round((mk.s / e.len) * (e.n - 1));
      const axis = e.dir === 0 ? e.xs[k] : -e.zs[k];
      assert.ok(Math.abs(axis / MILE - Math.round(axis / MILE)) < 0.05 + 8 / MILE, 'post sits on a whole mile line');
    }
    assert.equal(new Set(m.map((x) => x.mile)).size, m.length, 'one post per mile number');
  }
});

test('lot plans are deterministic, inside the edge, tapered and non-overlapping', () => {
  assert.ok(big.length > 40);
  const kinds = {};
  for (const e of big) {
    const a = planHighway(e), b = planHighway(e);
    assert.deepEqual(a, b);
    assert.deepEqual(e.lots, a.lots);
    const bySide = { 1: [], '-1': [] };
    for (const l of a.lots) {
      kinds[l.kind] = (kinds[l.kind] || 0) + 1;
      assert.ok(l.s0 >= MARGIN && l.s1 <= e.len - MARGIN, `${l.kind} keeps clear of the settlement ends`);
      assert.ok(l.w > 0 && l.s1 - l.s0 > 2 * l.taper);
      if (l.kind === 'weigh') assert.equal(e.cls, 'interstate');
      bySide[l.side].push(l);
    }
    for (const side of [1, -1]) {
      const L = bySide[side].sort((p, q) => p.s0 - q.s0);
      for (let i = 1; i < L.length; i++) assert.ok(L[i].s0 >= L[i - 1].s1 - 1e-6 || L[i].kind === 'aux' || L[i - 1].kind === 'aux', 'lots do not overlap');
    }
    for (const ov of a.overpasses) assert.ok(ov.s > MARGIN && ov.s < e.len - MARGIN);
  }
  assert.ok(kinds.rest > 3 && kinds.aux > 10 && kinds.runaway > 3 && kinds.weigh > 0, JSON.stringify(kinds));
});

test('no lots on county, gravel or dirt roads; shoulders only on highways', () => {
  for (const e of edges) {
    if (e.cls === 'interstate' || e.cls === 'highway') assert.equal(e.sh, SHOULDER[e.cls]);
    else {
      assert.equal(e.lots.length, 0);
      assert.equal(e.sh, 0);
    }
  }
});

test('lot width tapers to zero at both ends and is full in the body', () => {
  const lot = { side: 1, s0: 100, s1: 500, w: 10, taper: 80 };
  assert.equal(lotWidthAt([lot], 1, 100), 0);
  assert.equal(lotWidthAt([lot], 1, 500), 0);
  assert.equal(lotWidthAt([lot], -1, 300), 0);
  assert.ok(Math.abs(lotWidthAt([lot], 1, 300) - 10) < 1e-9);
  assert.ok(lotWidthAt([lot], 1, 140) > 0 && lotWidthAt([lot], 1, 140) < 10);
  assert.equal(taperAt(50, 100, 500, 80), 0);
  const arr = lotArrays([lot], Float64Array.from([0, 100, 300, 500, 600]), 5);
  assert.deepEqual([...arr.R], [0, 0, 10, 0, 0]);
  assert.equal(lotArrays([], [0, 1], 2), null);
});

test('the heightfield and surface agree with the paved width, shoulders and lots', () => {
  let checked = 0;
  for (const e of big.filter((x) => x.lots.length).slice(0, 12)) {
    for (const lot of e.lots) {
      const s = (lot.s0 + lot.s1) / 2, k = Math.min(e.n - 2, Math.round((s / e.len) * (e.n - 1)));
      const tx = e.xs[k + 1] - e.xs[k - 1], tz = e.zs[k + 1] - e.zs[k - 1], l = Math.hypot(tx, tz);
      const rx = -tz / l, rz = tx / l;
      const u = lot.side * (e.P.width / 2 + e.sh + lot.w * 0.5);
      const x = e.xs[k] + rx * u, z = e.zs[k] + rz * u;
      const sf = W.surfaceAt(x, z);
      assert.equal(sf.kind, 'road', `${lot.kind} interior counts as road`);
      assert.ok(Math.abs(W.heightAt(x, z) - e.hs[k]) < 1.2, 'lot is level with the road');
      if (lot.kind === 'runaway') assert.equal(sf.lot, 'runaway');
      const xo = e.xs[k] + rx * lot.side * (e.P.width / 2 + e.sh + lot.w + 3), zo = e.zs[k] + rz * lot.side * (e.P.width / 2 + e.sh + lot.w + 3);
      assert.notEqual(W.surfaceAt(xo, zo).kind === 'road' && W.surfaceAt(xo, zo).lot, lot.kind);
      checked++;
    }
  }
  assert.ok(checked > 5);
  // the shoulder is drivable asphalt
  const e = big.find((x) => x.cls === 'interstate'), k = 20;
  const tx = e.xs[k + 1] - e.xs[k - 1], tz = e.zs[k + 1] - e.zs[k - 1], l = Math.hypot(tx, tz);
  const u = e.P.width / 2 + e.sh - 0.4;
  assert.equal(W.surfaceAt(e.xs[k] - (tz / l) * u, e.zs[k] + (tx / l) * u).kind, 'road');
});

test('runaway ramps sit on a sustained descent on the correct side', () => {
  let n = 0;
  for (const e of big) {
    if (!e.runaway) continue;
    n++;
    const lot = e.lots.find((l) => l.kind === 'runaway');
    assert.ok(lot);
    assert.equal(lot.side, e.runaway.dir > 0 ? 1 : -1);
    assert.ok(Math.abs(e.runaway.grade) >= 0.034);
  }
  assert.ok(n > 3);
  const hs = [100, 99, 98, 97, 96, 95], ss = [0, 1000, 2000, 3000, 4000, 5000];
  assert.equal(runawaySite(hs, ss, 0.034), null);
  const steep = Float64Array.from({ length: 80 }, (_, i) => 200 - i * 4);
  const r = runawaySite(steep, Float64Array.from({ length: 80 }, (_, i) => i * 40));
  assert.ok(r && r.dir === 1 && r.grade > 0.09);
});

test('advance signs precede lots in the direction of travel; wildlife signs are stable', () => {
  const e = big.find((x) => x.lots.some((l) => l.kind === 'rest'));
  const sg = advanceSigns(e, { lots: e.lots }).filter((s) => s.kind === 'rest');
  assert.ok(sg.length >= 2);
  const lot = e.lots.find((l) => l.kind === 'rest');
  for (const s of sg) assert.ok(lot.face > 0 ? s.s < lot.s0 + 1 : s.s > lot.s1 - 1);
  assert.deepEqual(wildlifeSigns(e), wildlifeSigns(e));
  assert.equal(wildlifeSigns({ ...e, cls: 'dirt' }).length, 0);
});

test('guard spans bridge small gaps, drop short runs and stop at blocked samples', () => {
  const need = [0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1];
  assert.deepEqual(guardSpans(need, null, 4, 2), [[1, 7], [13, 21]]);
  const blocked = need.map((_, i) => i === 19);
  assert.deepEqual(guardSpans(need, blocked, 2, 2), [[1, 7], [13, 18], [20, 21]]);
  assert.deepEqual(guardSpans([1, 1], null, 4, 2), []);
});

test('ridgelines come from the real raw terrain and are deterministic', () => {
  const a = ridgeProfile(W, 1000, -500, RINGS[1], 64), b = ridgeProfile(new World(7), 1000, -500, RINGS[1], 64);
  assert.deepEqual([...a.top], [...b.top]);
  for (let i = 0; i < 64; i++) {
    assert.ok(Number.isFinite(a.top[i]) && a.top[i] > -300);
    const ang = (i / 64) * Math.PI * 2;
    assert.ok(Math.abs(a.elev[i] - W.rawHeight(1000 + Math.cos(ang) * RINGS[1].r, -500 + Math.sin(ang) * RINGS[1].r)) < 1e-3);
  }
});

test('roadside blocks build: finite geometry, bounded size, deterministic, colliders in reach', () => {
  const atlas = { slot: () => [0, 0, 1, 1] };
  const R = new Roadside({ envRoot: new THREE.Group() }, W, null, { atlas, bmat: null });
  let maxVerts = 0, total = 0, blocks = 0;
  const feature = new Set();
  const sample = edges.filter((e) => e.lots.length || e.overpasses.length).slice(0, 10).concat(edges.slice(0, 20));
  for (const e of sample) {
    const nb = Math.ceil(e.len / 240);
    for (let b = 0; b < nb; b++) {
      const v = R.build({ key: `${e.id}|${b}`, e, b });
      const v2 = R.build({ key: `${e.id}|${b}`, e, b });
      blocks++;
      if (v.mesh) {
        const pos = v.mesh.geometry.attributes.position;
        maxVerts = Math.max(maxVerts, pos.count);
        total += pos.count;
        assert.equal(pos.count, v2.mesh.geometry.attributes.position.count, 'deterministic');
        for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]));
      }
      assert.equal(v.circles.length, v2.circles.length);
      for (const c of v.circles) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z) && c.r > 0);
      for (const l of e.lots) feature.add(l.kind);
      v.mesh && R.group.remove(v.mesh);
    }
  }
  assert.ok(blocks > 50);
  assert.ok(maxVerts < 90000, `largest block ${maxVerts} vertices`);
  assert.ok(total / blocks < 20000, `mean block ${Math.round(total / blocks)} vertices`);
  assert.ok(feature.has('rest') || feature.has('aux'));
});
