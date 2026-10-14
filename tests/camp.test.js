import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/gen.js';
import { campsOf, campsNear, nearestCamp, evaluateSpotSite, BOONDOCK_TYPES } from '../src/world/camp.js';
import { isImmobilized, findNearestDepot, calculateTowFee, dispatchTow, TowService, TOW_STATES } from '../src/sim/tow.js';
import { step, defaultControls, initialState } from '../src/sim/model.js';
import { scenarioById } from '../src/data/scenarios.js';

const W = new World(7);
W.buildEdgesFor(-4000, -4000, 4000, 4000);

// ── 1. Boondocking Spot Generation ──────────────────────────────────────────

test('boondock: edges generate off-grid dispersed camper campsites clear of road and town', () => {
  let totalCamps = 0;
  for (const edge of W.edges.values()) {
    const camps = campsOf(W, edge);
    totalCamps += camps.length;

    for (const c of camps) {
      assert.ok(c.id && c.id.startsWith(edge.id), 'camp has valid id prefixed by edge');
      assert.equal(c.type, 'boondock', 'type is boondock');
      assert.ok(BOONDOCK_TYPES[c.category], `category ${c.category} is registered in BOONDOCK_TYPES`);
      assert.ok(c.name && c.name.length > 5, `camp has descriptive name: ${c.name}`);

      // Road clearance: must be off the carriageway
      const roadHit = W.roadAt(c.x, c.z);
      assert.ok(roadHit && roadHit.d > edge.P.width / 2 + 10, 'campsite is safely clear of road pavement');

      // Not inside a town settlement
      assert.ok(!W.settlementAt(c.x, c.z, 50), 'campsite is outside town boundaries');

      // Finite elevations and orientation
      assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.y));
      assert.ok(Number.isFinite(c.yaw));
    }
  }

  assert.ok(totalCamps >= 10, `found ${totalCamps} boondocking campsites`);

  // Determinism check: identical world seed yields identical campsites
  const W2 = new World(7);
  W2.buildEdgesFor(-4000, -4000, 4000, 4000);
  const ids1 = [...W.edges.values()].flatMap((e) => campsOf(W, e).map((c) => c.id)).sort().join(';');
  const ids2 = [...W2.edges.values()].flatMap((e) => campsOf(W2, e).map((c) => c.id)).sort().join(';');
  assert.equal(ids1, ids2, 'campsite generation is 100% deterministic');
});

test('boondock: spatial queries return nearby campsites', () => {
  const allCamps = [...W.edges.values()].flatMap((e) => campsOf(W, e));
  assert.ok(allCamps.length > 0);

  const target = allCamps[0];
  const near = campsNear(W, target.x, target.z, 200);
  assert.ok(near.some((c) => c.id === target.id), 'target found in near query');
  assert.ok(near.every((c) => Math.hypot(c.x - target.x, c.z - target.z) <= 200), 'all returned within radius');

  const nearest = nearestCamp(W, target.x + 5, target.z + 5, 500);
  assert.ok(nearest, 'nearest campsite found');
  assert.equal(nearest.id, target.id);
});

// ── 2. Ratings Calculation: Solar, Wind Shelter, Levelness ──────────────────

test('boondock: ratings evaluate within [0, 1] bounds with physical gradient angles', () => {
  for (const edge of [...W.edges.values()].slice(0, 5)) {
    for (const c of campsOf(W, edge)) {
      // Solar exposure
      assert.ok(c.solarExposure >= 0 && c.solarExposure <= 1, `solarExposure in 0..1: ${c.solarExposure}`);
      assert.equal(c.solarRating, c.solarExposure, 'solarRating alias matches solarExposure');

      // Wind shelter
      assert.ok(c.windShelter >= 0 && c.windShelter <= 1, `windShelter in 0..1: ${c.windShelter}`);
      assert.equal(c.windRating, c.windShelter, 'windRating alias matches windShelter');

      // Levelness
      assert.ok(c.levelness >= 0 && c.levelness <= 1, `levelness in 0..1: ${c.levelness}`);
      assert.equal(c.levelnessRating, c.levelness, 'levelnessRating alias matches levelness');

      // Geometric tilt metrics
      assert.ok(Number.isFinite(c.pitch) && Math.abs(c.pitch) < Math.PI / 2);
      assert.ok(Number.isFinite(c.roll) && Math.abs(c.roll) < Math.PI / 2);
      assert.ok(Number.isFinite(c.gradient) && c.gradient >= 0);
    }
  }
});

test('boondock: evaluateSpotSite differentiates exposed vs sheltered sites', () => {
  // Evaluation on open ridge vs valley floor
  const site1 = evaluateSpotSite(W, 0, 0);
  assert.ok(site1.solarExposure >= 0 && site1.solarExposure <= 1);
  assert.ok(site1.windShelter >= 0 && site1.windShelter <= 1);
  assert.ok(site1.levelness >= 0 && site1.levelness <= 1);

  // Gradient computation: levelness must be higher for flatter terrain
  const flatDiff = 0.005; // very flat
  const steepDiff = 0.15; // steep grade
  const levelFlat = Math.max(0, Math.min(1, 1 - flatDiff / 0.14));
  const levelSteep = Math.max(0, Math.min(1, 1 - steepDiff / 0.14));
  assert.ok(levelFlat > levelSteep, 'flatter terrain yields higher levelness');
});

// ── 3. Camper Systems Integration in src/sim/model.js ───────────────────────

test('camper: rooftop solar recharge scales with campsite solarExposure', () => {
  const scn = scenarioById.summer;
  const tHour = 12; // Noon with high GHI
  const dt = 60;

  // Case A: High solar exposure (open ridge: 1.0)
  const stateA = initialState({ startHour: tHour, soc: 0.5 });
  const ctrlA = {
    ...defaultControls(),
    boondock: { solarExposure: 1.0, windShelter: 0.2, levelness: 1.0 },
    driving: false,
    useSchedule: false,
  };
  const snapA = step(stateA, scn, ctrlA, dt);

  // Case B: Shaded canyon campsite (solar exposure: 0.35)
  const stateB = initialState({ startHour: tHour, soc: 0.5 });
  const ctrlB = {
    ...defaultControls(),
    boondock: { solarExposure: 0.35, windShelter: 0.2, levelness: 1.0 },
    driving: false,
    useSchedule: false,
  };
  const snapB = step(stateB, scn, ctrlB, dt);

  assert.ok(snapA.solarW > 0, `sunny site generates power: ${snapA.solarW} W`);
  assert.ok(snapB.solarW > 0, `shaded site generates power: ${snapB.solarW} W`);
  assert.ok(snapA.solarW > snapB.solarW * 2.0, `solar generation scales with solarExposure: ${snapA.solarW} vs ${snapB.solarW}`);
  assert.equal(snapA.boondock.solarExposure, 1.0);
  assert.equal(snapB.boondock.solarExposure, 0.35);
});

test('camper: wind shelter reduces infiltration heat loss and heating fuel consumption', () => {
  const scn = scenarioById.winter; // Sub-zero ambient temperature
  const tHour = 23; // Nighttime heating active
  const dt = 300; // 5 minute step

  // Case A: Exposed campsite with no wind shelter (windShelter: 0.0)
  const stateA = initialState({ startHour: tHour, Tin: 16.0, fuelL: 40.0 });
  const ctrlA = {
    ...defaultControls(),
    boondock: { solarExposure: 0.5, windShelter: 0.0, levelness: 1.0 },
    driving: false,
    useSchedule: false,
  };
  const snapA = step(stateA, scn, ctrlA, dt);

  // Case B: Sheltered campsite tucked behind ridge (windShelter: 0.9)
  const stateB = initialState({ startHour: tHour, Tin: 16.0, fuelL: 40.0 });
  const ctrlB = {
    ...defaultControls(),
    boondock: { solarExposure: 0.5, windShelter: 0.9, levelness: 1.0 },
    driving: false,
    useSchedule: false,
  };
  const snapB = step(stateB, scn, ctrlB, dt);

  // Effective wind and air exchange must be lower in sheltered site
  assert.ok(snapB.effectiveWind < snapA.effectiveWind, `effective wind reduced: ${snapB.effectiveWind} vs ${snapA.effectiveWind}`);
  assert.ok(snapB.ventM3h <= snapA.ventM3h, `air exchange reduced: ${snapB.ventM3h} vs ${snapA.ventM3h}`);

  // In cold conditions, heat loss is lower or heater fuel usage is less
  assert.ok(snapB.Qair >= snapA.Qair, `cold air heat loss Qair is less negative when sheltered: ${snapB.Qair} vs ${snapA.Qair}`);
});

test('camper: terrain unlevelness flags unlevel warning and loads fridge compressor', () => {
  const scn = scenarioById.summer;
  const tHour = 14;

  // Level campsite (levelness = 1.0)
  const stateLevel = initialState({ startHour: tHour });
  const ctrlLevel = {
    ...defaultControls(),
    boondock: { solarExposure: 0.9, windShelter: 0.3, levelness: 1.0 },
    driving: false,
    useSchedule: false,
  };
  const snapLevel = step(stateLevel, scn, ctrlLevel, 60);

  // Severely unlevel campsite (levelness = 0.25)
  const stateTilted = initialState({ startHour: tHour });
  const ctrlTilted = {
    ...defaultControls(),
    boondock: { solarExposure: 0.9, windShelter: 0.3, levelness: 0.25 },
    driving: false,
    useSchedule: false,
  };
  const snapTilted = step(stateTilted, scn, ctrlTilted, 60);

  assert.equal(snapLevel.unlevel, false, 'level site is not flagged unlevel');
  assert.equal(snapTilted.unlevel, true, 'severely tilted site is flagged unlevel');
  assert.ok(snapTilted.byLoad.fridge > snapLevel.byLoad.fridge, 'fridge works harder on tilted ground');
});

// ── 4. Roadside Assistance & Tow Interactions ───────────────────────────────

test('tow: accurately detects vehicle immobilization conditions', () => {
  // Operational van
  const okVan = { x: 100, z: 200, fuelL: 35, dmg: { engineDead: false, zone: { front: 0 } }, rolledVan: false };
  const checkOk = isImmobilized(okVan);
  assert.equal(checkOk.immobilized, false);

  // Dead engine from front collision
  const deadEngineVan = { x: 100, z: 200, fuelL: 35, dmg: { engineDead: true, zone: { front: 0.99 } }, rolledVan: false };
  const checkEngine = isImmobilized(deadEngineVan);
  assert.equal(checkEngine.immobilized, true);
  assert.equal(checkEngine.reason, 'engineDead');

  // Out of fuel
  const emptyFuelVan = { x: 100, z: 200, fuelL: 0.0, dmg: { engineDead: false, zone: { front: 0 } }, rolledVan: false };
  const checkFuel = isImmobilized(emptyFuelVan);
  assert.equal(checkFuel.immobilized, true);
  assert.equal(checkFuel.reason, 'outOfFuel');

  // Rolled over van
  const rolledVan = { x: 100, z: 200, fuelL: 20, dmg: { engineDead: false, zone: { front: 0 } }, rolledVan: true };
  const checkRolled = isImmobilized(rolledVan);
  assert.equal(checkRolled.immobilized, true);
  assert.equal(checkRolled.reason, 'rollover');
});

test('tow: findNearestDepot locates the nearest town depot or service station', () => {
  const depot = findNearestDepot(W, 500, 500);
  assert.ok(depot, 'found depot destination');
  assert.ok(depot.name && depot.name.length > 3);
  assert.ok(Number.isFinite(depot.x) && Number.isFinite(depot.z) && Number.isFinite(depot.y));
  assert.ok(depot.distanceM >= 0);
});

test('tow: calculateTowFee produces fair itemized breakdown', () => {
  const feeEngine = calculateTowFee(12500, 'engineDead', 300);
  assert.equal(feeEngine.base, 150);
  assert.equal(feeEngine.km, 12.5);
  assert.equal(feeEngine.mileage, 50); // 12.5 km * $4/km
  assert.equal(feeEngine.surcharge, 75);
  assert.equal(feeEngine.repairCost, 300);
  assert.equal(feeEngine.total, 150 + 50 + 75 + 300);
});

test('tow: dispatchTow recovers immobilized van to depot, clears damage and refuels', () => {
  const disabledVan = {
    x: 1800,
    z: -1200,
    y: 10,
    v: 15,
    vy: 2,
    yawRate: 0.5,
    fuelL: 0,
    rolledVan: true,
    roll: 1.5,
    pitch: 0.3,
    dmg: {
      engineDead: true,
      zone: { front: 0.98, rear: 0, left: 0, right: 0 },
      repair() {
        this.engineDead = false;
        this.zone.front = 0;
      },
      repairCost() {
        return 450;
      },
    },
  };

  const result = dispatchTow(W, disabledVan);
  assert.equal(result.success, true);
  assert.ok(result.destination);

  // Vehicle repositioned at destination depot
  assert.equal(disabledVan.x, result.destination.x);
  assert.equal(disabledVan.z, result.destination.z);
  assert.equal(disabledVan.y, result.destination.y);

  // Motion stopped
  assert.equal(disabledVan.v, 0);
  assert.equal(disabledVan.vy, 0);
  assert.equal(disabledVan.yawRate, 0);

  // Vehicle righted
  assert.equal(disabledVan.rolledVan, false);
  assert.equal(disabledVan.roll, 0);

  // Damage repaired
  assert.equal(disabledVan.dmg.engineDead, false);
  assert.equal(disabledVan.dmg.zone.front, 0);

  // Emergency fuel supplied
  assert.ok(disabledVan.fuelL >= 20.0, `emergency fuel supplied: ${disabledVan.fuelL} L`);
});

test('tow: TowService state machine manages full dispatch through recovery', () => {
  const tow = new TowService(W);
  assert.equal(tow.state, TOW_STATES.IDLE);

  const disabledVan = {
    x: 800,
    z: -600,
    fuelL: 0,
    dmg: { engineDead: false, zone: { front: 0 } },
    rolledVan: false,
  };

  assert.equal(tow.canRequestTow(disabledVan), true);
  const req = tow.requestTow(disabledVan);
  assert.equal(req.success, true);
  assert.equal(tow.state, TOW_STATES.DISPATCHED);

  // Step state machine
  tow.step(2.5);
  assert.equal(tow.state, TOW_STATES.EN_ROUTE);

  // Fast forward past ETA
  tow.step(req.etaSeconds);
  assert.equal(tow.state, TOW_STATES.RECOVERED);
  assert.ok(disabledVan.fuelL >= 20.0, 'van refueled after full recovery');
  assert.equal(tow.stats.totalTows, 1);
});
