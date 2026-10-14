import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, endurance, defaultControls, initialState, step } from '../src/sim/model.js';
import { scenarioById } from '../src/data/scenarios.js';
import { BANK } from '../src/data/electrical.js';

test('camper: multi-day boondocking simulation with full solar and wind shelter ratings', () => {
  const scn = scenarioById.multiday;

  // Boondocking at a high solar, sheltered site
  const boondockSite = {
    id: 'test_boondock_site',
    type: 'boondock',
    name: 'Eagle Ridge Sanctuary',
    solarExposure: 0.95,
    windShelter: 0.85,
    levelness: 0.98,
    solarRating: 0.95,
    windRating: 0.85,
    levelnessRating: 0.98,
  };

  const ctrlOverrides = {
    boondock: boondockSite,
    climate: { mode: 'auto' },
  };

  const r = runScenario(scn, ctrlOverrides, { days: 2, dt: 60, sampleMin: 15 });
  assert.ok(r.samples.length > 20, 'scenario produces samples');

  // Verify all samples have valid physical bounds
  for (const s of r.samples) {
    assert.ok(s.soc >= 0 && s.soc <= 1, `valid soc ${s.soc}`);
    assert.ok(s.Tin > -20 && s.Tin < 50, `valid indoor temp ${s.Tin}`);
    assert.ok(s.solarW >= 0, `valid solar ${s.solarW}`);
  }

  // Energy generation occurred during sunny hours
  assert.ok(r.totals.solarWh > 500, `solar energy harvested: ${r.totals.solarWh} Wh`);
});

test('camper: baseline endurance runs properly with boondock hooks', () => {
  const e = endurance(scenarioById.multiday, {}, 5);
  assert.ok(e.first, 'endurance reaches first resource limit');
  assert.ok(e.first.days > 1.0 && e.first.days <= 5.0, `endurance days: ${e.first.days}`);
});
