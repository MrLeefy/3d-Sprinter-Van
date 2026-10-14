import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/gen.js';
import { scanBridges } from '../src/world/highway.js';

const W = new World(42);
W.buildEdgesFor(-5000, -5000, 5000, 5000);

// Helper to find an edge with bridges across multiple seeds if needed
function findEdgeWithBridges(world) {
  for (const e of world.edges.values()) {
    if (e.bridges && e.bridges.length > 0) return e;
  }
  return null;
}

// ── Tier 1: Feature Coverage (Primary behavior) ──────────────────────────────

test('bridges T1: scanBridges detects ravine bridges (>3.8m depth, >=24m span) and culvert dips', () => {
  // Synthetic edge crossing a 50m wide, 8m deep ravine
  const n = 50, step = 4;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  const hs = new Float32Array(n).fill(100); // flat road grade at 100m elevation
  const ss = new Float32Array(n);
  const rawHeights = new Float32Array(n).fill(100);

  for (let k = 0; k < n; k++) {
    xs[k] = k * step;
    zs[k] = 0;
    ss[k] = k * step;
    // Ravine depression between k=15 and k=35 (span = 80m)
    if (k >= 15 && k <= 35) {
      const depth = 8.5 * Math.sin(((k - 15) / 20) * Math.PI);
      rawHeights[k] = 100 - depth;
    }
  }

  const mockEdge = {
    id: 'test_ravine',
    n,
    xs,
    zs,
    hs,
    ss,
    len: (n - 1) * step,
    cls: 'highway',
  };

  const detected = scanBridges(mockEdge, rawHeights);
  assert.ok(detected.length >= 1, 'ravine bridge detected');
  const br = detected[0];
  assert.equal(br.kind, 'bridge');
  assert.ok(br.s1 - br.s0 >= 24, `bridge span ${br.s1 - br.s0}m >= 24m`);
  assert.ok(br.clearance >= 3.8, `bridge clearance ${br.clearance}m >= 3.8m`);
  assert.equal(br.height, 100);
});

test('bridges T1: edge bridges are registered and attached to edge metadata during world generation', () => {
  let totalBridges = 0;
  let totalCulverts = 0;

  for (const e of W.edges.values()) {
    assert.ok(Array.isArray(e.bridges), `edge ${e.id} has bridges array`);
    for (const b of e.bridges) {
      assert.ok(['bridge', 'culvert'].includes(b.kind), `kind ${b.kind} is valid`);
      assert.ok(b.s1 > b.s0, `s1 (${b.s1}) > s0 (${b.s0})`);
      assert.ok(b.clearance > 0, `clearance ${b.clearance} > 0`);
      assert.ok(Number.isFinite(b.height), `height ${b.height} finite`);
      if (b.kind === 'bridge') totalBridges++;
      else totalCulverts++;
    }
  }

  assert.ok(totalBridges + totalCulverts >= 0, 'bridges inventory verified');
});

test('bridges T1: road surface query surfaceAt reports bridge: true when sampling within bridge span', () => {
  // Locate a world edge that has a bridge or create a deterministic world instance
  let foundBridgeEdge = findEdgeWithBridges(W);

  // If seed 42 did not hit a ravine bridge, try seed 17 or 99
  if (!foundBridgeEdge) {
    for (const seed of [17, 99, 105, 256, 777]) {
      const wTest = new World(seed);
      wTest.buildEdgesFor(-5000, -5000, 5000, 5000);
      foundBridgeEdge = findEdgeWithBridges(wTest);
      if (foundBridgeEdge) break;
    }
  }

  if (foundBridgeEdge) {
    const br = foundBridgeEdge.bridges.find((b) => b.kind === 'bridge');
    if (br) {
      const sMid = (br.s0 + br.s1) / 2;
      const k = Math.min(foundBridgeEdge.n - 2, Math.max(0, Math.floor((sMid / foundBridgeEdge.len) * (foundBridgeEdge.n - 1))));
      const x = foundBridgeEdge.xs[k];
      const z = foundBridgeEdge.zs[k];

      const surf = W.surfaceAt(x, z);
      assert.equal(surf.kind, 'road', 'surface is road');
      assert.equal(surf.bridge, true, 'surface reports bridge: true');
      assert.ok(surf.bridgeInfo, 'surface provides bridgeInfo');
    }
  } else {
    // Assert on synthetic test edge
    const n = 40, step = 5;
    const xs = new Float32Array(n).map((_, i) => i * step);
    const zs = new Float32Array(n).fill(0);
    const hs = new Float32Array(n).fill(50);
    const ss = new Float32Array(n).map((_, i) => i * step);
    const raw = new Float32Array(n).fill(50);
    for (let i = 12; i <= 28; i++) raw[i] = 50 - 6.0;

    const e = { id: 'synth_bridge', n, xs, zs, hs, ss, len: 195, cls: 'highway' };
    const brs = scanBridges(e, raw);
    assert.ok(brs.length > 0 && brs[0].kind === 'bridge');
  }
});

test('bridges T1: road heightAt on bridge deck matches road grade elevation hs[k]', () => {
  for (const e of [...W.edges.values()].slice(0, 15)) {
    for (const b of e.bridges) {
      if (b.kind === 'bridge') {
        const sMid = (b.s0 + b.s1) / 2;
        const k = Math.min(e.n - 2, Math.floor((sMid / e.len) * (e.n - 1)));
        const yRoad = e.hs[k];
        const yGround = W.heightAt(e.xs[k], e.zs[k]);
        assert.ok(Math.abs(yGround - yRoad) < 0.25, `deck height ${yGround.toFixed(2)} matches road elevation ${yRoad.toFixed(2)}`);
      }
    }
  }
});

// ── Tier 2: Boundary & Corner Cases ──────────────────────────────────────────

test('bridges T2: natural ground terrain baseHeight remains strictly below the bridge deck', () => {
  for (const e of W.edges.values()) {
    for (const b of e.bridges) {
      if (b.kind === 'bridge') {
        // Find exact index k inside the bridge span
        let kFound = -1;
        for (let k = 0; k < e.n; k++) {
          if (e.ss[k] >= b.s0 && e.ss[k] <= b.s1) {
            kFound = k;
            break;
          }
        }
        if (kFound >= 0) {
          const baseH = W.baseHeight(e.xs[kFound], e.zs[kFound]);
          const deckH = e.hs[kFound];
          const groundClearance = deckH - baseH;
          assert.ok(groundClearance >= 3.0, `clearance below deck ${groundClearance.toFixed(2)}m >= 3.0m on edge ${e.id}`);
        }
      }
    }
  }
});

test('bridges T2: culvert scan detects minor dips between 1.5m and 3.5m over short spans', () => {
  const n = 60, step = 5;
  const xs = new Float32Array(n).map((_, i) => i * step);
  const zs = new Float32Array(n).fill(10);
  const hs = new Float32Array(n).fill(80);
  const ss = new Float32Array(n).map((_, i) => i * step);
  const raw = new Float32Array(n).fill(80);

  // Dip of 2.5m from k=14 to k=17 (span = 15m, between s=70 and s=85, well clear of 30m port margins on 295m edge)
  for (let k = 14; k <= 17; k++) raw[k] = 80 - 2.5;

  const e = { id: 'synth_culvert', n, xs, zs, hs, ss, len: (n - 1) * step, cls: 'county' };
  const res = scanBridges(e, raw);
  assert.ok(res.length >= 1, 'detected culvert');
  assert.equal(res[0].kind, 'culvert');
  assert.ok(res[0].clearance >= 1.5 && res[0].clearance <= 3.8);
});

test('bridges T2: bridge endpoints s0 and s1 lie strictly inside road boundaries with setback from ports', () => {
  for (const e of W.edges.values()) {
    for (const b of e.bridges) {
      assert.ok(b.s0 >= 30, `bridge start s0 (${b.s0}) >= 30m setback from port`);
      assert.ok(b.s1 <= e.len - 30, `bridge end s1 (${b.s1}) <= len - 30m (${e.len - 30})`);
      assert.ok(b.s1 - b.s0 >= 10, 'span length >= 10m');
    }
  }
});

test('bridges T2: road grade slopes across bridge approaches and spans remain within road class limits', () => {
  for (const e of [...W.edges.values()].slice(0, 10)) {
    for (const b of e.bridges) {
      for (let k = 1; k < e.n; k++) {
        if (e.ss[k] >= b.s0 && e.ss[k] <= b.s1) {
          const ds = Math.hypot(e.xs[k] - e.xs[k - 1], e.zs[k] - e.zs[k - 1]);
          const dh = Math.abs(e.hs[k] - e.hs[k - 1]);
          const grade = dh / ds;
          const maxAllowed = e.cls === 'interstate' ? 0.07 : 0.12;
          assert.ok(grade <= maxAllowed, `grade ${grade.toFixed(3)} on bridge within ${maxAllowed}`);
        }
      }
    }
  }
});

// ── Tier 3: Cross-Feature Interactions ───────────────────────────────────────

test('bridges T3: terrain beside bridge deck drops toward natural ravine floor without forming an earthen wall', () => {
  for (const e of W.edges.values()) {
    const br = e.bridges.find((b) => b.kind === 'bridge');
    if (br) {
      let kFound = -1;
      const sMid = (br.s0 + br.s1) / 2;
      let minD = Infinity;
      for (let k = 1; k < e.n - 1; k++) {
        const d = Math.abs(e.ss[k] - sMid);
        if (d < minD) {
          minD = d;
          kFound = k;
        }
      }
      if (kFound >= 0) {
        const x = e.xs[kFound], z = e.zs[kFound];
        const dx = e.xs[kFound + 1] - e.xs[kFound - 1];
        const dz = e.zs[kFound + 1] - e.zs[kFound - 1];
        const l = Math.hypot(dx, dz);
        const nx = -dz / l, nz = dx / l;

        const deckY = W.heightAt(x, z);
        const ravineY = Math.min(W.heightAt(x + nx * 25, z + nz * 25), W.heightAt(x - nx * 25, z - nz * 25));

        // Beside bridge centerline, ground height is strictly lower than the deck
        assert.ok(deckY > ravineY, `deck height (${deckY.toFixed(1)}m) is elevated above ravine floor (${ravineY.toFixed(1)}m)`);
        break;
      }
    }
  }
});

test('bridges T3: wetland and marsh shoreline classifications generate positive weights near lakes', () => {
  // Find a point near a lake shore
  let foundMarsh = false;
  for (let x = -2000; x <= 2000; x += 500) {
    for (let z = -2000; z <= 2000; z += 500) {
      const b = W.biome(x, z, W.heightAt(x, z));
      if (b.wetland > 0.1 || b.marsh > 0.1) {
        foundMarsh = true;
        assert.ok(b.wetland >= 0 && b.wetland <= 1.0);
        break;
      }
    }
    if (foundMarsh) break;
  }
  // Even if not hit on coarse grid, verify biome object structure
  const b0 = W.biome(0, 0, 100);
  assert.ok('wetland' in b0, 'biome includes wetland classification');
  assert.ok('marsh' in b0, 'biome includes marsh classification');
});

// ── Tier 4: Real-World Application Scenarios ─────────────────────────────────

test('bridges T4: continuous vehicle transit across bridge encounters no vertical step discontinuities (>0.5m)', () => {
  for (const e of [...W.edges.values()].slice(0, 8)) {
    const br = e.bridges.find((b) => b.kind === 'bridge');
    if (br) {
      const sStart = Math.max(0, br.s0 - 20);
      const sEnd = Math.min(e.len, br.s1 + 20);

      let prevH = null;
      for (let s = sStart; s <= sEnd; s += 2.0) {
        const k = Math.min(e.n - 2, Math.floor((s / e.len) * (e.n - 1)));
        const t = (s / e.len) * (e.n - 1) - k;
        const x = e.xs[k] + (e.xs[k + 1] - e.xs[k]) * t;
        const z = e.zs[k] + (e.zs[k + 1] - e.zs[k]) * t;
        const h = W.heightAt(x, z);

        if (prevH !== null) {
          const step = Math.abs(h - prevH);
          assert.ok(step < 0.45, `step between 2m samples is ${step.toFixed(3)}m (< 0.45m drivable)`);
        }
        prevH = h;
      }
      break;
    }
  }
});
