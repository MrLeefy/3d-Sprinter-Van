import test from 'node:test';
import assert from 'node:assert/strict';
import { World, S, ROAD } from '../src/world/gen.js';

const W = new World(7);

test('terrain is deterministic and finite', () => {
  const a = new World(7), b = new World(7);
  for (const [x, z] of [[0, 0], [1234.5, -987.6], [-50000, 33333], [1e5, 1e5]]) {
    assert.equal(a.rawHeight(x, z), b.rawHeight(x, z));
    assert.ok(Number.isFinite(a.heightAt(x, z)));
  }
});

test('nodes: stable, in their cells, with names for settlements', () => {
  const kinds = {};
  for (let i = -12; i <= 12; i++) {
    for (let j = -12; j <= 12; j++) {
      const n = W.node(i, j), m = new World(7).node(i, j);
      assert.equal(n.x, m.x);
      assert.equal(n.kind, m.kind);
      assert.ok(Math.abs(n.x - i * S) < S * 0.6 && Math.abs(n.z - j * S) < S * 0.6);
      kinds[n.kind] = (kinds[n.kind] || 0) + 1;
      if (n.kind !== 'junction') assert.ok(n.name && n.name.length > 2, `${n.kind} ${i},${j} has a name`);
    }
  }
  assert.ok(kinds.city >= 3 && kinds.town >= 20 && kinds.village >= 50, JSON.stringify(kinds));
});

test('names are unique inside each 6×6 block for towns and cities', () => {
  for (let bi = -3; bi <= 3; bi++) {
    for (let bj = -3; bj <= 3; bj++) {
      const seen = new Set();
      for (let j = bj * 6; j < bj * 6 + 6; j++) {
        for (let i = bi * 6; i < bi * 6 + 6; i++) {
          const n = W.node(i, j);
          if (n.kind === 'city' || n.kind === 'town') {
            assert.ok(!seen.has(n.name), `duplicate ${n.name}`);
            seen.add(n.name);
          }
        }
      }
    }
  }
});

test('lakes keep clear of settlements and have banks above the water', () => {
  let lakes = 0;
  for (let a = -6; a <= 6; a++) {
    for (let b = -6; b <= 6; b++) {
      const l = W.lakeCell(a, b);
      if (!l) continue;
      lakes++;
      for (const n of W.nodesNear(l.cx, l.cz, 3000)) assert.ok(Math.hypot(n.x - l.cx, n.z - l.cz) > l.R * 1.4, 'lake clear of nodes');
      // centre is below the level; just outside the shore is above it
      assert.ok(W.baseHeight(l.cx, l.cz) < l.level);
      const ang = l.ang;
      for (let t = 0; t < 8; t++) {
        const th = (t / 8) * Math.PI * 2;
        const x = l.cx + Math.cos(th) * l.R * l.asp * 1.5, z = l.cz + Math.sin(th) * l.R * 1.5;
        void ang;
        const rn = W.lakeRn(l, x, z);
        if (rn > 1.15 && rn < 1.6) assert.ok(W.baseHeight(x, z) > l.level, 'bank above water');
      }
    }
  }
  assert.ok(lakes >= 8, `lakes ${lakes}`);
});

test('roads: endpoints at ports, grade limits, no water, continuous', () => {
  W.buildEdgesFor(-3000, -3000, 3000, 3000);
  assert.ok(W.edges.size > 20, `edges ${W.edges.size}`);
  for (const e of W.edges.values()) {
    const pa = e.dir === 0 ? e.a.portE : e.a.portS, pb = e.dir === 0 ? e.b.portW : e.b.portN;
    assert.ok(Math.hypot(e.xs[0] - pa[0], e.zs[0] - pa[1]) < 1e-6);
    assert.ok(Math.hypot(e.xs[e.n - 1] - pb[0], e.zs[e.n - 1] - pb[1]) < 1e-6);
    assert.ok(Math.abs(e.hs[0] - e.a.h) < 0.5 && Math.abs(e.hs[e.n - 1] - e.b.h) < 0.5, 'ends meet the plateau heights');
    let worst = 0;
    for (let k = 1; k < e.n; k++) {
      const ds = Math.hypot(e.xs[k] - e.xs[k - 1], e.zs[k] - e.zs[k - 1]);
      assert.ok(ds > 1 && ds < 14, `sample spacing ${ds}`);
      worst = Math.max(worst, Math.abs(e.hs[k] - e.hs[k - 1]) / ds);
    }
    assert.ok(worst <= ROAD[e.cls].grade * 1.35 + 0.01, `${e.id} ${e.cls} grade ${worst}`);
    for (let k = 0; k < e.n; k += 5) {
      for (const l of W.lakesNear(e.xs[k], e.zs[k])) assert.ok(W.lakeRn(l, e.xs[k], e.zs[k]) > 1.0, `${e.id} dry`);
    }
    assert.ok(e.len < Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z) * 1.7, `${e.id} not absurdly long`);
  }
});

test('ground height follows the road and is smooth beside it', () => {
  W.buildEdgesFor(-3000, -3000, 3000, 3000);
  for (const e of [...W.edges.values()].slice(0, 12)) {
    for (let k = 4; k < e.n - 4; k += 9) {
      const y = W.heightAt(e.xs[k], e.zs[k]);
      assert.ok(Math.abs(y - e.hs[k]) < 0.6, `${e.id} k${k}: ground ${y.toFixed(2)} vs road ${e.hs[k].toFixed(2)}`);
      // 1 m steps across the carriageway never jump
      const nx = -(e.zs[k + 1] - e.zs[k - 1]), nz = e.xs[k + 1] - e.xs[k - 1], l = Math.hypot(nx, nz);
      let prev = W.heightAt(e.xs[k], e.zs[k]);
      for (let d = 1; d <= 20; d++) {
        const h = W.heightAt(e.xs[k] + (nx / l) * d, e.zs[k] + (nz / l) * d);
        assert.ok(Math.abs(h - prev) < 2.2, `cross-slope jump ${Math.abs(h - prev)}`);
        prev = h;
      }
    }
  }
});

test('settlement plateaus are flat', () => {
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const n = W.node(i, j);
      if (n.kind === 'junction') continue;
      for (const f of [0.2, 0.5, 0.9]) {
        const y = W.heightAt(n.x + n.Rp * f * 0.8, n.z + n.Rz * f * 0.5);
        assert.ok(Math.abs(y - n.h) < 1.2, `${n.name} plateau ${y.toFixed(2)} vs ${n.h.toFixed(2)}`);
      }
    }
  }
});

test('home camp is level and beside a road', () => {
  const h = W.home;
  assert.ok(h && Number.isFinite(h.yaw));
  const hs = [];
  for (const [dx, dz] of [[0, 0], [4, 0], [-4, 0], [0, 3], [0, -3], [5, 3]]) hs.push(W.heightAt(h.x + dx, h.z + dz));
  assert.ok(Math.max(...hs) - Math.min(...hs) < 0.4);
  const r = W.roadAt(h.x, h.z);
  assert.ok(r && r.d > 6 && r.d < 22, 'beside the road');
});

test('road query: side is positive on the right of the direction of travel', () => {
  W.buildEdgesFor(-3000, -3000, 3000, 3000);
  const e = W.edges.values().next().value;
  const k = 10;
  const tx = e.xs[k + 1] - e.xs[k], tz = e.zs[k + 1] - e.zs[k], l = Math.hypot(tx, tz);
  const rx = -tz / l, rz = tx / l;
  const r = W.roadAt(e.xs[k] + rx * 3, e.zs[k] + rz * 3);
  assert.ok(r.side > 0 && Math.abs(r.d - 3) < 0.8);
});

import { layoutOf, TILE, tileKey } from '../src/world/layout.js';

test('layouts: every settlement lays out, footprints stay on the plateau and do not overlap', () => {
  let lots = 0, cities = 0, overlaps = [];
  for (let i = -8; i <= 8; i++) {
    for (let j = -8; j <= 8; j++) {
      const n = W.node(i, j);
      const L = layoutOf(W, n);
      assert.ok(L && L.lots && L.streets.length > 0, `${n.kind} has streets`);
      if (n.kind === 'city') cities++;
      const solid = L.lots.filter((l) => l.solid && !['field', 'rv', 'tree'].includes(l.k));
      for (const l of L.lots) {
        assert.ok(Number.isFinite(l.x + l.z + l.w + l.d + l.h), 'finite lot');
        assert.ok(Math.abs(l.x - n.x) <= n.Rp * 1.1 + 40 && Math.abs(l.z - n.z) <= n.Rz * 1.1 + 40, `${n.kind} lot inside the footprint`);
        lots++;
      }
      for (let a = 0; a < solid.length; a++) {
        for (let b = a + 1; b < solid.length; b++) {
          const p = solid[a], q = solid[b];
          const ox = (p.w + q.w) / 2 - Math.abs(p.x - q.x), oz = (p.d + q.d) / 2 - Math.abs(p.z - q.z);
          if (ox > 0.6 && oz > 0.6) overlaps.push(`${n.name}(${n.kind}) ${p.k}/${q.k} ${ox.toFixed(1)}x${oz.toFixed(1)}`);
        }
      }
      // every tile index entry points at a valid lot
      for (const t of L.tiles.values()) for (const id of t.lots) assert.ok(L.lots[id]);
    }
  }
  assert.ok(lots > 2000, `lots ${lots}`);
  assert.ok(cities >= 3, `cities ${cities}`);
  assert.equal(overlaps.length, 0, overlaps.slice(0, 10).join('; '));
});

test('layouts: main street spans the ports and services exist in towns', () => {
  let fuel = 0, camps = 0;
  for (let i = -8; i <= 8; i++) {
    for (let j = -8; j <= 8; j++) {
      const n = W.node(i, j);
      const L = layoutOf(W, n);
      if (n.kind === 'town' || n.kind === 'city') {
        const main = L.streets.find((s) => s.kind === 'main' && s.az === s.bz);
        assert.ok(Math.abs(main.ax - n.portW[0]) < 1 && Math.abs(main.bx - n.portE[0]) < 1, 'main street from port to port');
        assert.ok(L.zones.some((z) => z.type === 'fuel'), `${n.name} has fuel`);
      }
      for (const z of L.zones) {
        if (z.type === 'fuel') fuel++;
        if (z.type === 'camp') camps++;
      }
    }
  }
  assert.ok(fuel > 15 && camps > 6, `fuel ${fuel} camps ${camps}`);
});

test('highways and interstates have gentle, drivable curves', () => {
  W.buildEdgesFor(-3000, -3000, 3000, 3000);
  const radii = { highway: [], interstate: [] };
  for (const e of W.edges.values()) {
    if (!radii[e.cls]) continue;
    for (let k = 8; k < e.n - 8; k += 2) {
      const ax = e.xs[k - 6], az = e.zs[k - 6], bx = e.xs[k], bz = e.zs[k], cx = e.xs[k + 6], cz = e.zs[k + 6];
      const a = Math.hypot(bx - cx, bz - cz), b = Math.hypot(ax - cx, az - cz), c = Math.hypot(ax - bx, az - bz);
      const area = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
      radii[e.cls].push(area < 1e-6 ? 1e9 : (a * b * c) / (4 * area));
    }
  }
  for (const [cls, r] of Object.entries(radii)) {
    if (r.length < 50) continue;
    r.sort((p, q) => p - q);
    assert.ok(r[Math.floor(r.length * 0.05)] > 200, `${cls} 5th-percentile radius ${r[Math.floor(r.length * 0.05)].toFixed(0)} m`);
  }
});
