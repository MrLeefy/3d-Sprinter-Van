// Engineering acceptance tests — `npm test`
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAcceptance } from '../src/sim/acceptance.js';
import { weightReport } from '../src/sim/weight.js';
import { runScenario, endurance } from '../src/sim/model.js';
import { SCENARIOS, scenarioById } from '../src/data/scenarios.js';
import { resolveActuators, STAGES } from '../src/data/mechanisms.js';
import { designHeatLoss, steadyCO2 } from '../src/sim/thermal.js';
import { BANK } from '../src/data/electrical.js';

const result = runAcceptance();

test('acceptance suite has no failures', () => {
  const fails = result.checks.filter((c) => c.status === 'fail');
  assert.equal(fails.length, 0, fails.map((f) => `${f.id}: ${f.name} → ${f.value} (${f.detail})`).join('\n'));
});

for (const c of result.checks) {
  test(`[${c.cat}] ${c.name}`, () => {
    assert.notEqual(c.status, 'fail', `${c.value} vs ${c.limit} ${c.detail}`);
  });
}

test('weight stays within GVWR and both GAWRs', () => {
  const w = weightReport();
  assert.ok(w.gvw <= w.gvwr);
  assert.ok(w.front <= w.gawrFront);
  assert.ok(w.rear <= w.gawrRear);
});

test('every scenario simulates with finite, bounded state', () => {
  for (const s of SCENARIOS) {
    const r = runScenario(s, {}, { days: Math.min(s.days, 2) });
    assert.ok(r.samples.length > 10, s.id);
    for (const p of r.samples) {
      assert.ok(Number.isFinite(p.Tin) && p.Tin > -30 && p.Tin < 60, `${s.id} Tin ${p.Tin}`);
      assert.ok(p.soc >= 0 && p.soc <= 1, `${s.id} soc`);
      assert.ok(p.fresh >= 0 && p.grey >= 0, `${s.id} tanks`);
    }
  }
});

test('battery never invents energy: charge in ≤ load + stored', () => {
  const r = runScenario(scenarioById.multiday);
  const stored = (0.95 - r.final.soc) * BANK.capacityWh;
  const balance = r.totals.solarWh + r.totals.altWh + r.totals.shoreWh * 0 + stored - r.totals.loadWh;
  assert.ok(Math.abs(balance) / r.totals.loadWh < 0.08, `energy balance error ${balance.toFixed(0)} Wh`);
});

test('multi-day off-grid run reaches a resource limit (no infinite resources)', () => {
  const e = endurance(scenarioById.multiday, {}, 10);
  assert.ok(e.first, 'some resource must run out within 10 days');
  assert.ok(e.first.days > 1.5 && e.first.days < 10);
});

test('winter heat loss is within heater capacity with margin', () => {
  const hl = designHeatLoss({ Tout: -20 });
  assert.ok(hl.total > 1500 && hl.total < 4000, `plausible van heat loss ${hl.total}`);
});

test('night ventilation keeps CO₂ below 1000 ppm', () => {
  assert.ok(steadyCO2(2, 55) < 1000);
});

test('master slider stages resolve without interlock violations', () => {
  for (const st of STAGES) {
    const { values, blocked } = resolveActuators(st.at);
    assert.equal(blocked.length, 0, `stage ${st.name}: ${JSON.stringify(blocked)}`);
    for (const v of Object.values(values)) assert.ok(v >= 0 && v <= 1);
  }
  const closed = resolveActuators(0).values;
  assert.equal(closed.slidingDoor, 0);
  assert.equal(closed.slideOut, 0);
  const full = resolveActuators(1).values;
  assert.equal(full.awning, 1);
  assert.equal(full.outdoorKitchen, 1);
  assert.equal(full.slideOut, 1);
});

test('outdoor kitchen interlocked to rear doors', () => {
  const { values, blocked } = resolveActuators(0, { outdoorKitchen: 1 });
  assert.equal(values.outdoorKitchen, 0);
  assert.equal(blocked[0].id, 'outdoorKitchen');
});
