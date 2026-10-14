import test from 'node:test';
import assert from 'node:assert/strict';
import { trafficSignalPhase, intersectionSignals, mustYield } from '../src/sim/junction.js';
import { World } from '../src/world/gen.js';
import { layoutOf } from '../src/world/layout.js';

const W = new World(42);
W.buildEdgesFor(-4000, -4000, 4000, 4000);

function findSignalTown() {
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      const n = W.node(i, j);
      if (n.kind === 'town' || n.kind === 'city') return n;
    }
  }
  return W.node(0, 0);
}

const townNode = findSignalTown();

// ── Tier 1: Feature Coverage (Primary behavior) ──────────────────────────────

test('signals T1: deterministic 3-phase cycle transitions periodically across 48-second cycle', () => {
  // Test axis X
  const pGreen = trafficSignalPhase(townNode, 100, 200, 10, 'X');
  assert.equal(pGreen.phase, 'green');
  assert.equal(pGreen.code, 0);
  assert.equal(pGreen.cycle, 48);
  assert.ok(pGreen.timeRemaining > 0 && pGreen.timeRemaining <= 20);

  const pYellow = trafficSignalPhase(townNode, 100, 200, 22, 'X');
  assert.equal(pYellow.phase, 'yellow');
  assert.equal(pYellow.code, 1);
  assert.ok(pYellow.timeRemaining > 0 && pYellow.timeRemaining <= 4);

  const pRed = trafficSignalPhase(townNode, 100, 200, 35, 'X');
  assert.equal(pRed.phase, 'red');
  assert.equal(pRed.code, 2);
  assert.ok(pRed.timeRemaining > 0 && pRed.timeRemaining <= 24);
});

test('signals T1: orthogonal approaches (X vs Z) maintain non-conflicting green phases', () => {
  // Check every second of the 48-second cycle: X and Z must never both be green or yellow simultaneously
  for (let t = 0; t < 48; t += 0.5) {
    const sigX = trafficSignalPhase(townNode, 0, 0, t, 'X');
    const sigZ = trafficSignalPhase(townNode, 0, 0, t, 'Z');

    // Both cannot be green
    assert.ok(!(sigX.phase === 'green' && sigZ.phase === 'green'), `Dual green conflict at t=${t}s`);

    // When X is green or yellow, Z must be red
    if (sigX.phase === 'green' || sigX.phase === 'yellow') {
      assert.equal(sigZ.phase, 'red', `At t=${t}s, X is ${sigX.phase} but Z is ${sigZ.phase} (expected red)`);
    }

    // When Z is green or yellow, X must be red
    if (sigZ.phase === 'green' || sigZ.phase === 'yellow') {
      assert.equal(sigX.phase, 'red', `At t=${t}s, Z is ${sigZ.phase} but X is ${sigX.phase} (expected red)`);
    }
  }
});

test('signals T1: yellow clearance interval strictly bridges green and red phases', () => {
  // On axis X: transition from green (t=19.9) to yellow (t=20.1) to red (t=24.1)
  const preYellow = trafficSignalPhase(townNode, 0, 0, 19.9, 'X');
  const inYellow = trafficSignalPhase(townNode, 0, 0, 21.0, 'X');
  const postYellow = trafficSignalPhase(townNode, 0, 0, 24.1, 'X');

  assert.equal(preYellow.phase, 'green');
  assert.equal(inYellow.phase, 'yellow');
  assert.equal(postYellow.phase, 'red');

  // On axis Z: transition from red (t=23.9) to green (t=24.1) to yellow (t=44.1) to red (t=0.1)
  const zPreGreen = trafficSignalPhase(townNode, 0, 0, 23.9, 'Z');
  const zInGreen = trafficSignalPhase(townNode, 0, 0, 25.0, 'Z');
  const zInYellow = trafficSignalPhase(townNode, 0, 0, 45.0, 'Z');
  const zInRed = trafficSignalPhase(townNode, 0, 0, 0.5, 'Z');

  assert.equal(zPreGreen.phase, 'red');
  assert.equal(zInGreen.phase, 'green');
  assert.equal(zInYellow.phase, 'yellow');
  assert.equal(zInRed.phase, 'red');
});

test('signals T1: town layout generates signal heads in sets of four at street crossings', () => {
  const L = layoutOf(W, townNode);
  const signals = L.props.misc.filter((m) => m[3] === 'signal');
  assert.ok(signals.length >= 4, `${townNode.name} has at least 4 signal heads`);
  assert.equal(signals.length % 4, 0, 'signals come in balanced sets of 4 per crossing');

  for (const s of signals) {
    const [x, z, rot, type, initialPhase] = s;
    assert.equal(type, 'signal');
    assert.ok(Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(rot));
    assert.ok(initialPhase === 0 || initialPhase === 2, 'initial phase code is 0 (green) or 2 (red)');
  }
});

// ── Tier 2: Boundary & Corner Cases ──────────────────────────────────────────

test('signals T2: signal phase wraps cyclically and handles negative and very large times', () => {
  const t0 = 15.5;
  const p0 = trafficSignalPhase(townNode, 0, 0, t0, 'X');

  // Multi-cycle future time (100 cycles = 4800s later)
  const pFuture = trafficSignalPhase(townNode, 0, 0, t0 + 4800, 'X');
  assert.equal(pFuture.phase, p0.phase);
  assert.equal(pFuture.code, p0.code);
  assert.ok(Math.abs(pFuture.timeRemaining - p0.timeRemaining) < 1e-4);

  // Negative time (prior cycle: -48s + 15.5s)
  const pPast = trafficSignalPhase(townNode, 0, 0, t0 - 48, 'X');
  assert.equal(pPast.phase, p0.phase);
  assert.equal(pPast.code, p0.code);
  assert.ok(Math.abs(pPast.timeRemaining - p0.timeRemaining) < 1e-4);

  // Deep negative time (-480s)
  const pDeepPast = trafficSignalPhase(townNode, 0, 0, t0 - 480, 'X');
  assert.equal(pDeepPast.phase, p0.phase);
});

test('signals T2: timeRemaining monotonically decreases within a phase and stays strictly positive', () => {
  let prevRemaining = 30;
  // Sweep within axis X green window [1.0s .. 19.0s]
  for (let t = 1.0; t <= 19.0; t += 1.0) {
    const sig = trafficSignalPhase(townNode, 0, 0, t, 'X');
    assert.equal(sig.phase, 'green');
    assert.ok(sig.timeRemaining > 0, `timeRemaining at t=${t} must be > 0`);
    assert.ok(sig.timeRemaining < prevRemaining, `timeRemaining must decrease (was ${prevRemaining}, now ${sig.timeRemaining})`);
    prevRemaining = sig.timeRemaining;
  }
});

test('signals T2: intersectionSignals returns safe non-empty list for town nodes with valid signal metadata', () => {
  const sigs = intersectionSignals(townNode, 12.0);
  assert.ok(Array.isArray(sigs), 'must return array');
  assert.ok(sigs.length > 0, 'town must report signal states');

  for (const s of sigs) {
    assert.ok(['X', 'Z'].includes(s.axis), `axis ${s.axis} must be X or Z`);
    assert.ok(['green', 'yellow', 'red'].includes(s.phase), `phase ${s.phase} valid`);
    assert.ok([0, 1, 2].includes(s.code), `code ${s.code} valid enum`);
    assert.ok(s.timeRemaining >= 0 && s.timeRemaining <= 48);
  }
});

test('signals T2: null or undefined node argument returns safe defaults without throwing', () => {
  const pNull = trafficSignalPhase(null, 0, 0, 10, 'X');
  assert.ok(pNull && pNull.phase === 'green');

  const emptySigs = intersectionSignals(null, 10);
  assert.deepEqual(emptySigs, []);
});

// ── Tier 3: Cross-Feature Interactions ───────────────────────────────────────

test('signals T3: emergency vehicles take unconditional precedence at intersections in mustYield', () => {
  const normalCar = { id: 1, rank: 2, eta: 3.0, holds: false, isEmergency: false };
  const emergencyAmbulance = { id: 2, rank: 2, eta: 5.0, holds: false, isEmergency: true };

  // Normal car must yield to emergency vehicle even though normal car has lower ETA (arriving first)
  assert.equal(mustYield(normalCar, emergencyAmbulance), true, 'normal vehicle yields to approaching emergency vehicle');

  // Emergency vehicle does NOT yield to normal vehicle
  assert.equal(mustYield(emergencyAmbulance, normalCar), false, 'emergency vehicle does not yield to normal car');

  // Between two emergency vehicles, lower ETA prevails
  const policeAhead = { id: 3, rank: 2, eta: 2.0, holds: false, isEmergency: true };
  const ambulanceBehind = { id: 4, rank: 2, eta: 4.0, holds: false, isEmergency: true };
  assert.equal(mustYield(policeAhead, ambulanceBehind), false);
  assert.equal(mustYield(ambulanceBehind, policeAhead), true);
});

test('signals T3: anti-deadlock priority breaker resolves vehicles waiting over 6 seconds at junctions', () => {
  const carA = { id: 10, rank: 2, eta: 1.0, holds: false, waitT: 7.5 };
  const carB = { id: 11, rank: 2, eta: 1.0, holds: false, waitT: 6.2 };

  // carA has waited longer (7.5s > 6.2s, both > 6.0s), so carB must yield to carA
  assert.equal(mustYield(carB, carA), true, 'car with shorter wait yields to car waiting > 6s');
  assert.equal(mustYield(carA, carB), false, 'longest waiting car is granted right of way');
});

// ── Tier 4: Real-World Application Scenarios ─────────────────────────────────

test('signals T4: 24-hour continuous time sweep maintains 100% phase integrity and conservation of cycle time', () => {
  const totalSecondsInDay = 86400;
  // Sample every 300 seconds throughout the day
  for (let t = 0; t < totalSecondsInDay; t += 300) {
    const sigX = trafficSignalPhase(townNode, 50, 50, t, 'X');
    const sigZ = trafficSignalPhase(townNode, 50, 50, t, 'Z');

    assert.ok(Number.isFinite(sigX.timeRemaining) && sigX.timeRemaining > 0);
    assert.ok(Number.isFinite(sigZ.timeRemaining) && sigZ.timeRemaining > 0);
    assert.ok(!(sigX.phase === 'green' && sigZ.phase === 'green'));
    assert.equal(sigX.cycle, 48);
    assert.equal(sigZ.cycle, 48);
  }
});
