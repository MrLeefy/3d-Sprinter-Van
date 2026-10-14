import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/gen.js';
import { TRAILER_CARGO, SPEC } from '../src/sim/truck.js';
import {
  CARGO, TRAILERS, DEPOT_TYPES, depotOf, depotsNear, inDepot, generateJobs, jobPay, allowedSeconds, settleJob, speedingFine, isSpeeding, routeDistance, weightFactor, BONUS, MIN_PAY,
} from '../src/world/jobs.js';

const W = new World(7);
const fast = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) * 1.25; // injected distance: no routing needed
const here = { x: W.home.x, z: W.home.z };

test('jobs: catalogue is consistent with the trailer table', () => {
  for (const [id, c] of Object.entries(CARGO)) {
    assert.ok(TRAILERS.includes(c.trailer), `${id} trailer`);
    assert.ok(TRAILER_CARGO[c.trailer] && SPEC.trailerMass[c.trailer] !== undefined, `${id} in truck tables`);
    for (const t of [...c.from, ...c.to]) assert.ok(DEPOT_TYPES[t], `${id}: depot type ${t}`);
  }
  for (const t of TRAILERS) assert.ok(Object.values(CARGO).some((c) => c.trailer === t), `cargo for ${t}`);
});

test('jobs: depots are deterministic, named and sit at the settlement centre', () => {
  const near = depotsNear(W, here.x, here.z, 12000);
  assert.ok(near.length >= 4, 'several depots around home');
  const again = depotsNear(new World(7), here.x, here.z, 12000);
  assert.deepEqual(near.map((d) => [d.id, d.type, d.company]), again.map((d) => [d.id, d.type, d.company]));
  for (const d of near) {
    assert.match(d.company, /\S+ \S+/);
    assert.ok(inDepot(d, d.x + 10, d.z) && !inDepot(d, d.x + d.r + 5, d.z));
    assert.equal(depotOf(W, d.node), d);
  }
  assert.equal(depotOf(W, { kind: 'junction', key: 'x' }), null);
});

test('jobs: generated offers are valid, deterministic and match trailer ranges', () => {
  const a = generateJobs(W, here, { seed: 1, count: 10, dist: fast });
  const b = generateJobs(new World(7), here, { seed: 1, count: 10, dist: fast });
  assert.deepEqual(a, b);
  assert.ok(a.length >= 5, `got ${a.length} jobs`);
  assert.notDeepEqual(a.map((j) => j.id), generateJobs(W, here, { seed: 2, count: 10, dist: fast }).map((j) => j.id));
  const ids = new Set();
  for (const j of a) {
    const C = CARGO[j.cargo];
    assert.equal(j.trailer, C.trailer);
    const [lo, hi] = TRAILER_CARGO[j.trailer];
    assert.ok(j.kg >= lo && j.kg <= hi && j.kg % 100 === 0, `${j.kg} kg in ${lo}..${hi}`);
    assert.ok(C.from.includes(j.from.type) && C.to.includes(j.to.type));
    assert.notEqual(j.from.id, j.to.id);
    assert.ok(j.km >= 2.5 && j.km <= 22);
    assert.ok(j.pay >= MIN_PAY && j.allowedSec > 60);
    assert.equal(j.hazmat, !!C.hazmat);
    assert.equal(j.fragile, !!C.fragile);
    assert.ok(!ids.has(j.id));
    ids.add(j.id);
  }
});

test('jobs: trailer filter only offers matching cargo', () => {
  for (const t of ['tanker', 'logs', 'reefer', 'flatbed']) {
    const js = generateJobs(W, here, { seed: 3, count: 6, trailer: t, dist: fast, radius: 16000 });
    assert.ok(js.every((j) => j.trailer === t), t);
  }
});

test('jobs: pay scales with distance and cargo, bonuses stack', () => {
  const base = { cargo: 'mixed', kg: 14000, trailer: 'dryvan', km: 10 };
  const p = jobPay(base);
  assert.ok(jobPay({ ...base, km: 20 }).pay > p.pay * 1.9);
  assert.ok(jobPay({ ...base, cargo: 'medicine', trailer: 'reefer' }).pay > p.pay);
  const all = jobPay({ ...base, fragile: true, urgent: true, hazmat: true });
  assert.equal(all.bonuses.length, 3);
  assert.equal(all.pay, Math.round(p.base * (1 + BONUS.fragile + BONUS.urgent + BONUS.hazmat)));
  assert.ok(weightFactor('dryvan', 20000) > weightFactor('dryvan', 8000));
  assert.ok(jobPay({ ...base, km: 0.01 }).pay >= MIN_PAY);
  assert.ok(allowedSeconds(10000, true) < allowedSeconds(10000, false));
});

test('jobs: settlement pays in full, rewards clean runs, penalises lateness, damage and fines', () => {
  const job = { pay: 1000, allowedSec: 600, fragile: false };
  const clean = settleJob(job, { elapsed: 500 });
  assert.ok(clean.clean && clean.onTime && clean.total === 1100);
  const late = settleJob(job, { elapsed: 720 });
  assert.ok(!late.onTime && late.lateFee > 0 && late.total < 1000 && late.lateSec === 120);
  assert.ok(settleJob(job, { elapsed: 6000 }).lateFee <= 500, 'lateness capped');
  const hurt = settleJob(job, { elapsed: 100, damageDelta: 20 });
  assert.ok(hurt.damageFee > 0 && hurt.total < 1000);
  assert.ok(settleJob({ ...job, fragile: true }, { elapsed: 100, damageDelta: 20 }).damageFee > hurt.damageFee);
  const fined = settleJob(job, { elapsed: 100, fines: 150 });
  assert.equal(fined.total, 850);
  assert.equal(settleJob(job, { elapsed: 9999, damageDelta: 100, fines: 5000 }).total, 0, 'never negative');
  assert.ok(speedingFine(30) > speedingFine(5));
  assert.ok(isSpeeding(80, 65) && !isSpeeding(70, 65) && !isSpeeding(200, null));
});

test('jobs: route distance uses the real road network', () => {
  const [a, b] = depotsNear(W, here.x, here.z, 9000);
  const len = routeDistance(W, a.node, b.node);
  assert.ok(len >= Math.hypot(a.x - b.x, a.z - b.z) * 0.98);
  assert.ok(len < 40000);
  const real = generateJobs(W, here, { seed: 5, count: 2 });
  assert.ok(real.length >= 1 && real.every((j) => j.lenM > 1500));
});
