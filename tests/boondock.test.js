import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/gen.js';
import { BOONDOCK_TYPES, evaluateSpotSite, campsOf, campsNear, nearestCamp } from '../src/world/camp.js';
import { TOW_RATES, TOW_STATES, isImmobilized, findNearestDepot, calculateTowFee, dispatchTow, TowService } from '../src/sim/tow.js';
import { initialState, defaultControls, step, runScenario } from '../src/sim/model.js';
import { scenarioById } from '../src/data/scenarios.js';

const W = new World(77);
W.buildEdgesFor(-4000, -4000, 4000, 4000);

// Find a representative long road edge
function findEdge() {
  for (const e of W.edges.values()) {
    if (e.len > 1200) return e;
  }
  return [...W.edges.values()][0];
}

const roadEdge = findEdge();

// ── Tier 1: Feature Coverage (Primary behavior) ──────────────────────────────

test('boondock T1: evaluateSpotSite calculates normalized ratings for solar exposure, wind shelter, and levelness', () => {
  const spot = evaluateSpotSite(W, 500, 500);

  assert.ok(spot.solarExposure >= 0.0 && spot.solarExposure <= 1.0, `solarExposure ${spot.solarExposure} in [0, 1]`);
  assert.ok(spot.windShelter >= 0.0 && spot.windShelter <= 1.0, `windShelter ${spot.windShelter} in [0, 1]`);
  assert.ok(spot.levelness >= 0.0 && spot.levelness <= 1.0, `levelness ${spot.levelness} in [0, 1]`);
  assert.ok(Number.isFinite(spot.pitch) && Number.isFinite(spot.roll) && Number.isFinite(spot.gradient));
  assert.ok(Number.isFinite(spot.y));
});

test('boondock T1: campsOf generates deterministic off-grid campsites along road edge with valid metadata', () => {
  const campsA = campsOf(W, roadEdge);
  assert.ok(Array.isArray(campsA), 'campsOf returns array');
  assert.ok(campsA.length >= 1, `road edge generates at least 1 campsite (got ${campsA.length})`);

  for (const c of campsA) {
    assert.equal(c.type, 'boondock');
    assert.ok(c.name && c.name.length > 5, `camp name '${c.name}' descriptive`);
    assert.ok(BOONDOCK_TYPES[c.category] || ['overlook', 'meadow', 'forest', 'creek', 'bluff'].includes(c.category), `category '${c.category}' recognized`);
    assert.ok(c.solarExposure >= 0 && c.solarExposure <= 1);
    assert.ok(c.windShelter >= 0 && c.windShelter <= 1);
    assert.ok(c.levelness >= 0 && c.levelness <= 1);
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.y) && Number.isFinite(c.yaw));
    assert.ok(c.padRadius >= 5.0, `pad radius ${c.padRadius} allows camper parking`);
  }

  // Determinism check on same world
  const campsB = campsOf(W, roadEdge);
  assert.equal(campsA.length, campsB.length);
  assert.equal(campsA[0].id, campsB[0].id);
  assert.equal(campsA[0].x, campsB[0].x);
});

test('boondock T1: camper solar charging scales with site solarExposure rating and charges battery', () => {
  const scn = scenarioById.summer;
  const stateHigh = initialState({ soc: 0.5, startHour: 10 });
  const stateLow = initialState({ soc: 0.5, startHour: 10 });
  const ctrlHigh = { ...defaultControls(), useSchedule: false, climate: { mode: 'vent' }, boondock: { solarExposure: 1.0, windShelter: 0.5, levelness: 1.0 } };
  const ctrlLow = { ...defaultControls(), useSchedule: false, climate: { mode: 'vent' }, boondock: { solarExposure: 0.2, windShelter: 0.5, levelness: 1.0 } };

  // Step high vs low solar exposure site
  const resHigh = step(stateHigh, scn, ctrlHigh, 60);
  const resLow = step(stateLow, scn, ctrlLow, 60);

  // High solar exposure produces significantly higher solar wattage
  assert.ok(resHigh.solarW > resLow.solarW * 3.5, `solarW at 1.0 (${resHigh.solarW}W) must exceed 0.2 (${resLow.solarW}W)`);
  assert.equal(resHigh.boondock.solarExposure, 1.0);
  assert.equal(resLow.boondock.solarExposure, 0.2);

  // Over 30 minutes in vent mode under full sun, battery charges
  const initialSoc = stateHigh.soc;
  for (let s = 0; s < 30; s++) {
    step(stateHigh, scn, ctrlHigh, 60);
  }
  assert.ok(stateHigh.soc > initialSoc, `battery charged from ${initialSoc} to ${stateHigh.soc}`);
});

test('boondock T1: roadside assistance detects immobilized vehicle and calculateTowFee produces itemized invoice', () => {
  const deadVan = {
    x: 1200,
    z: -800,
    dmg: { zone: { front: 0.99 }, engineDead: true },
    fuelL: 45,
  };

  const status = isImmobilized(deadVan);
  assert.equal(status.immobilized, true);
  assert.equal(status.reason, 'engineDead');

  const invoice = calculateTowFee(5000, status.reason, 200); // 5 km tow, $200 repairs
  assert.equal(invoice.base, TOW_RATES.baseFee);
  assert.equal(invoice.surcharge, TOW_RATES.engineSurcharge);
  assert.equal(invoice.repairCost, 200);
  assert.ok(invoice.total > invoice.base + invoice.surcharge);
});

// ── Tier 2: Boundary & Corner Cases ──────────────────────────────────────────

test('boondock T2: out-of-fuel and rolled vehicle conditions trigger immobilization correctly', () => {
  // Empty fuel tank
  const emptyVan = { x: 0, z: 0, fuelL: 0, dmg: { zone: { front: 0 } } };
  const emptyStatus = isImmobilized(emptyVan);
  assert.equal(emptyStatus.immobilized, true);
  assert.equal(emptyStatus.reason, 'outOfFuel');

  // Rolled over van
  const rolledVan = { x: 0, z: 0, fuelL: 50, rolledVan: true };
  const rolledStatus = isImmobilized(rolledVan);
  assert.equal(rolledStatus.immobilized, true);
  assert.equal(rolledStatus.reason, 'rollover');

  // Operational van
  const okVan = { x: 0, z: 0, fuelL: 50, dmg: { zone: { front: 0.1 } } };
  const okStatus = isImmobilized(okVan);
  assert.equal(okStatus.immobilized, false);
});

test('boondock T2: zero solar irradiance at night produces zero solar charge and drains standby load', () => {
  const scn = scenarioById.summer;
  const state = initialState({ soc: 0.8, startHour: 23 }); // 23:00 night
  const ctrl = defaultControls();
  ctrl.solar = true;
  ctrl.driving = false;
  ctrl.shore.connected = false;

  const initialSoc = state.soc;
  step(state, scn, ctrl, 3600);

  assert.ok(state.soc <= initialSoc, `battery does not charge at night (${state.soc} <= ${initialSoc})`);
});

test('boondock T2: findNearestDepot always locates a valid destination with positive distance', () => {
  const dest = findNearestDepot(W, 3500, -2800);
  assert.ok(dest && dest.id, 'depot found');
  assert.ok(Number.isFinite(dest.x) && Number.isFinite(dest.z) && Number.isFinite(dest.y));
  assert.ok(dest.distanceM > 0, `depot distance ${dest.distanceM}m must be positive`);
});

test('boondock T2: campsNear radius query returns strictly within requested boundary', () => {
  const allCamps = campsOf(W, roadEdge);
  const target = allCamps[0];
  const radius = 250;

  const nearby = campsNear(W, target.x, target.z, radius);
  assert.ok(nearby.length >= 1, 'at least finds self');
  for (const c of nearby) {
    const dist = Math.hypot(c.x - target.x, c.z - target.z);
    assert.ok(dist <= radius + 1e-4, `distance ${dist}m must be <= ${radius}m`);
  }
});

// ── Tier 3: Cross-Feature Interactions ───────────────────────────────────────

test('boondock T3: campsite positions maintain safe lateral setback outside road carriageway', () => {
  for (const e of [...W.edges.values()].slice(0, 8)) {
    const camps = campsOf(W, e);
    for (const c of camps) {
      const q = W.roadAt(c.x, c.z);
      assert.ok(q, 'road query succeeds');
      assert.ok(q.d > e.P.width / 2 + 10, `campsite at ${c.x},${c.z} is clear of carriageway (dist: ${q.d.toFixed(1)}m > ${e.P.width / 2 + 10}m)`);
      assert.ok(!W.settlementAt(c.x, c.z, 40), 'campsite is outside urban settlement core');
    }
  }
});

test('boondock T3: dispatchTow restores immobilized van to depot with operational status and fuel', () => {
  const strandedVan = {
    x: 4200,
    z: 3800,
    y: 120,
    v: 15,
    fuelL: 0,
    rolledVan: true,
    dmg: { zone: { front: 0.98 }, repair() { this.zone.front = 0; } },
  };

  const towResult = dispatchTow(W, strandedVan);
  assert.equal(towResult.success, true);
  assert.ok(towResult.destination, 'has destination');
  assert.equal(strandedVan.v, 0, 'velocity halted');
  assert.equal(strandedVan.rolledVan, false, 'vehicle uprighted');
  assert.ok(strandedVan.fuelL >= TOW_RATES.emergencyFuelL, `emergency fuel supplied: ${strandedVan.fuelL}L`);
  assert.equal(isImmobilized(strandedVan).immobilized, false, 'vehicle is now operational');
});

// ── Tier 4: Real-World Application Scenarios ─────────────────────────────────

test('boondock T4: TowService state machine executes complete lifecycle: dispatch -> en-route -> hookup -> recovery', () => {
  const service = new TowService(W);
  const van = {
    x: 2000,
    z: -1500,
    fuelL: 0,
    dmg: { zone: { front: 0.99 } },
  };

  // 1. Initial request
  assert.equal(service.canRequestTow(van), true);
  const req = service.requestTow(van);
  assert.equal(req.success, true);
  assert.equal(service.state, TOW_STATES.DISPATCHED);

  // 2. Advance time: DISPATCHED -> EN_ROUTE
  service.step(2.5);
  assert.equal(service.state, TOW_STATES.EN_ROUTE);

  // 3. Advance to HOOKUP
  service.step(req.etaSeconds * 0.7);
  assert.equal(service.state, TOW_STATES.HOOKUP);

  // 4. Advance through TOWING to RECOVERED
  service.step(req.etaSeconds * 0.5);
  assert.equal(service.state, TOW_STATES.RECOVERED);
  assert.equal(service.stats.totalTows, 1);
  assert.ok(service.stats.totalBilled > 0);
});

test('boondock T4: 24-hour off-grid boondocking simulation survives without shore hookups or dead battery', () => {
  const scn = scenarioById.overnight;
  const r = runScenario(scn, { boondock: { solarExposure: 1.0, windShelter: 0.8, levelness: 1.0 } }, { days: 1 });

  assert.ok(r.minSoc > 0.40, `minimum battery SoC ${r.minSoc.toFixed(2)} stayed well above shutdown threshold`);
  assert.ok(r.final.soc > 0.70, `final SoC ${r.final.soc.toFixed(2)} demonstrates full next-day solar recovery`);
  assert.ok(r.perDay.solarWh > 2000, `solar generated ${r.perDay.solarWh} Wh`);
});
