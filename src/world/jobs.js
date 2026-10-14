// Freight jobs (pure, deterministic): shippers and depots in the settlements, and a job generator that
// turns them into offers in the style of Euro/American Truck Simulator. A job moves one cargo from a
// depot to another over the road network; the cargo decides the trailer, the weight stays inside the
// trailer's TRAILER_CARGO range, and pay grows with distance, load and the fragile / urgent /
// hazmat bonuses. Nothing here touches the DOM, so it is unit tested.
import { TRAILER_CARGO } from '../sim/truck.js';
import { hashStr, prng } from './noise.js';
import { planRoute } from './route.js';

export const TRAILER_LABEL = { dryvan: 'Dry van', reefer: 'Reefer', flatbed: 'Flatbed', tanker: 'Tanker', logs: 'Log trailer', container: 'Container' };
export const TRAILERS = Object.keys(TRAILER_LABEL);

/** Depot (shipper) types: what they are called and what the yard looks like on the map. */
export const DEPOT_TYPES = {
  sawmill: { label: 'Sawmill', icon: '🪵', names: ['Timber', 'Lumber', 'Mill', 'Cedar Creek', 'Ponderosa'], suffix: ['Sawmill', 'Lumber Co.', 'Forest Products'] },
  grain: { label: 'Grain elevator', icon: '🌾', names: ['Golden Plains', 'Big Sky', 'Prairie', 'Harvest', 'Treasure State'], suffix: ['Grain Co-op', 'Elevator', 'Farmers Union'] },
  refinery: { label: 'Refinery', icon: '🛢', names: ['Yellowstone', 'Badlands', 'Big Horn', 'Treeline', 'Continental'], suffix: ['Refining', 'Fuel Terminal', 'Energy'] },
  warehouse: { label: 'Warehouse', icon: '🏭', names: ['Northern', 'Rimrock', 'Frontier', 'Summit', 'Last Chance', 'Big Sky'], suffix: ['Distribution', 'Logistics', 'Supply Co.', 'Cold Storage'] },
  truckstop: { label: 'Truck stop', icon: '⛽', names: ['Mile High', 'Eagle', 'High Plains', 'Cottonwood', 'Wagon Wheel'], suffix: ['Travel Plaza', 'Truck Stop', 'Fuel & Diner'] },
  logging: { label: 'Logging landing', icon: '🌲', names: ['Bitterroot', 'Lolo', 'Kootenai', 'Flathead', 'Lone Pine'], suffix: ['Logging', 'Timber Harvest', 'Forestry'] },
  intermodal: { label: 'Intermodal yard', icon: '🚢', names: ['Great Northern', 'Burlington', 'Union', 'Hi-Line', 'Pacific Rail'], suffix: ['Intermodal', 'Rail Yard', 'Freight Terminal'] },
};

/** Which depot types each kind of settlement can host (the first is the most common). */
const HOST = {
  city: ['warehouse', 'refinery', 'intermodal', 'warehouse'],
  town: ['sawmill', 'grain', 'warehouse'],
  village: ['grain', 'logging', 'sawmill'],
  farm: ['grain'],
  lodge: ['logging'],
  truckstop: ['truckstop'],
};

/**
 * Cargo catalogue. `rate` multiplies the base pay per km; `from` / `to` list the depot types that ship
 * and receive it; weights come from the trailer's range, biased by `heavy` (0..1).
 */
export const CARGO = {
  mixed: { name: 'Mixed freight', trailer: 'dryvan', rate: 1.0, from: ['warehouse', 'intermodal'], to: ['warehouse', 'truckstop', 'grain'] },
  paper: { name: 'Paper rolls', trailer: 'dryvan', rate: 1.0, from: ['sawmill'], to: ['warehouse', 'intermodal'] },
  flour: { name: 'Bagged flour', trailer: 'dryvan', rate: 1.05, from: ['grain'], to: ['warehouse', 'truckstop'] },
  electronics: { name: 'Electronics', trailer: 'dryvan', rate: 1.25, fragile: true, light: true, from: ['warehouse', 'intermodal'], to: ['warehouse'] },
  groceries: { name: 'Frozen foods', trailer: 'reefer', rate: 1.2, from: ['warehouse'], to: ['truckstop', 'warehouse', 'grain'] },
  produce: { name: 'Fresh produce', trailer: 'reefer', rate: 1.2, urgentBias: 0.5, from: ['grain'], to: ['warehouse', 'truckstop'] },
  medicine: { name: 'Pharmaceuticals', trailer: 'reefer', rate: 1.6, fragile: true, light: true, urgentBias: 0.8, from: ['warehouse'], to: ['warehouse', 'truckstop'] },
  lumber: { name: 'Dimensional lumber', trailer: 'flatbed', rate: 1.0, from: ['sawmill'], to: ['warehouse', 'truckstop', 'intermodal'] },
  steel: { name: 'Steel beams', trailer: 'flatbed', rate: 1.15, heavy: 0.9, from: ['warehouse', 'intermodal'], to: ['warehouse', 'sawmill', 'refinery'] },
  machinery: { name: 'Farm machinery', trailer: 'flatbed', rate: 1.35, fragile: true, from: ['warehouse', 'intermodal'], to: ['grain', 'warehouse'] },
  diesel: { name: 'Diesel fuel', trailer: 'tanker', rate: 1.25, hazmat: true, from: ['refinery'], to: ['truckstop', 'warehouse'] },
  gasoline: { name: 'Gasoline', trailer: 'tanker', rate: 1.3, hazmat: true, from: ['refinery'], to: ['truckstop', 'warehouse', 'grain'] },
  propane: { name: 'Propane', trailer: 'tanker', rate: 1.45, hazmat: true, from: ['refinery'], to: ['grain', 'warehouse', 'sawmill'] },
  milk: { name: 'Liquid milk', trailer: 'tanker', rate: 1.1, urgentBias: 0.4, from: ['grain'], to: ['warehouse', 'truckstop'] },
  pine: { name: 'Pine logs', trailer: 'logs', rate: 1.05, from: ['logging'], to: ['sawmill'] },
  aspen: { name: 'Aspen logs', trailer: 'logs', rate: 1.0, from: ['logging'], to: ['sawmill'] },
  freight: { name: 'Containerised goods', trailer: 'container', rate: 1.1, from: ['intermodal'], to: ['warehouse', 'truckstop'] },
  parts: { name: 'Auto parts', trailer: 'container', rate: 1.15, from: ['intermodal', 'warehouse'], to: ['warehouse', 'truckstop'] },
  appliances: { name: 'Appliances', trailer: 'container', rate: 1.3, fragile: true, from: ['intermodal'], to: ['warehouse'] },
};

export const BASE_RATE = 85; // dollars per km of route for a rate-1.0 cargo at mid load
export const BONUS = { fragile: 0.15, urgent: 0.25, hazmat: 0.3 };
export const DEPOT_R = 60; // radius of the pickup / drop-off yard (m)
export const MIN_PAY = 150;
const AVG_SPEED = 15.5; // m/s used to size the deadline (slower than the posted limits)

const roundTo = (v, step) => Math.round(v / step) * step;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ── Depots ───────────────────────────────────────────────────────────────────

/** The depot a settlement hosts, or null. One per settlement, at the settlement centre. */
export function depotOf(W, node) {
  const host = HOST[node.kind];
  if (!host) return null;
  if (node._depot !== undefined) return node._depot;
  const h = prng(hashStr(`depot|${node.key}|${W.sd}`));
  const type = host[Math.floor(h() * host.length)];
  const T = DEPOT_TYPES[type];
  const name = T.names[Math.floor(h() * T.names.length)];
  const suffix = T.suffix[Math.floor(h() * T.suffix.length)];
  node._depot = { id: node.key, type, label: T.label, icon: T.icon, company: `${name} ${suffix}`, town: node.name, key: node.key, node, x: node.x, z: node.z, r: DEPOT_R };
  return node._depot;
}

/** Depots in settlements within r of a point, nearest first. */
export function depotsNear(W, x, z, r) {
  const out = [];
  for (const n of W.nodesNear(x, z, r)) {
    const d = depotOf(W, n);
    if (d) out.push({ depot: d, d: Math.hypot(n.x - x, n.z - z) });
  }
  return out.sort((a, b) => a.d - b.d || (a.depot.id < b.depot.id ? -1 : 1)).map((q) => q.depot);
}

/** True when a point is inside a depot's yard. */
export function inDepot(depot, x, z) {
  return Math.hypot(x - depot.x, z - depot.z) <= depot.r;
}

// ── Money ────────────────────────────────────────────────────────────────────

/** Weight factor 0.85..1.15 across the trailer's cargo range. */
export function weightFactor(trailer, kg) {
  const r = TRAILER_CARGO[trailer];
  if (!r) return 1;
  return 0.85 + 0.3 * clamp((kg - r[0]) / (r[1] - r[0]), 0, 1);
}

/** Pay for a job: distance x rate x cargo factor x weight, then the bonuses. Returns a breakdown. */
export function jobPay({ km, cargo, kg, trailer, fragile, urgent, hazmat }) {
  const C = CARGO[cargo];
  const base = km * BASE_RATE * (C?.rate ?? 1) * weightFactor(trailer || C?.trailer, kg);
  const bonuses = [];
  let mult = 1;
  for (const k of ['fragile', 'urgent', 'hazmat']) {
    if (({ fragile, urgent, hazmat })[k]) {
      mult += BONUS[k];
      bonuses.push(k);
    }
  }
  return { base: Math.max(MIN_PAY, Math.round(base)), bonuses, pay: Math.max(MIN_PAY, Math.round(base * mult)) };
}

/** Seconds allowed from pickup, given the route length in metres. Urgent loads get a tight deadline. */
export function allowedSeconds(lenM, urgent) {
  return Math.round(((lenM / (urgent ? AVG_SPEED * 1.3 : AVG_SPEED)) + (urgent ? 50 : 120)) / 5) * 5;
}

/** One speeding citation: grows with how far over the posted limit the truck is. */
export function speedingFine(overKmh) {
  return 40 + Math.round(clamp(overKmh, 0, 60) * 2);
}

/** Is the truck over the limit enough to be cited (same threshold as the limit sign turning red)? */
export function isSpeeding(kmh, limitKmh) {
  return limitKmh != null && kmh > limitKmh * 1.1 + 4;
}

/**
 * Final settlement of a delivery.
 * outcome: { elapsed (s since pickup), damageDelta (rig damage points gained), fines ($ of citations) }
 * Returns the line items and the net payout (never below zero).
 */
export function settleJob(job, { elapsed = 0, damageDelta = 0, fines = 0 } = {}) {
  const lateSec = Math.max(0, elapsed - job.allowedSec);
  const lateMin = lateSec / 60;
  const lateFee = lateSec > 0 ? Math.round(job.pay * Math.min(0.5, 0.15 + 0.1 * lateMin)) : 0;
  const dmg = Math.max(0, damageDelta);
  const damageFee = Math.round(job.pay * Math.min(0.7, dmg * 0.012 * (job.fragile ? 2 : 1)));
  const fineFee = Math.round(Math.max(0, fines));
  const clean = lateSec === 0 && dmg < 1 && fineFee === 0;
  const tip = clean ? Math.round(job.pay * 0.1) : 0;
  const total = Math.max(0, job.pay - lateFee - damageFee - fineFee + tip);
  return { gross: job.pay, lateSec, lateFee, damage: Math.round(dmg), damageFee, fines: fineFee, tip, total, onTime: lateSec === 0, clean };
}

// ── Generation ───────────────────────────────────────────────────────────────

/** Route length in metres between two settlements over the real road network (crow x 1.3 if none). */
export function routeDistance(W, a, b) {
  try {
    const r = planRoute(W, { x: a.x, z: a.z }, b);
    if (r) {
      r.build();
      if (r.length > 0) return r.length;
    }
  } catch {
    /* fall through */
  }
  return Math.hypot(a.x - b.x, a.z - b.z) * 1.3;
}

function pickWeight(rnd, trailer, C) {
  const [lo, hi] = TRAILER_CARGO[trailer];
  let u = rnd();
  if (C.heavy !== undefined) u = u * 0.35 + C.heavy * 0.65;
  if (C.light) u *= 0.55;
  return roundTo(lo + (hi - lo) * u, 100);
}

/**
 * Build one job between two depots, or null if the pair cannot carry the cargo.
 * `dist(nodeA, nodeB)` returns the route length in metres (inject it for tests; defaults to the real router).
 */
export function makeJob(W, from, to, cargoId, rnd, dist = (a, b) => routeDistance(W, a, b)) {
  const C = CARGO[cargoId];
  if (!C || !C.from.includes(from.type) || !C.to.includes(to.type) || from.id === to.id) return null;
  const kg = pickWeight(rnd, C.trailer, C);
  const urgent = rnd() < 0.12 + (C.urgentBias || 0) * 0.35;
  const lenM = dist(from.node, to.node);
  const km = lenM / 1000;
  const job = {
    id: `${from.id}>${to.id}|${cargoId}|${kg}`,
    cargo: cargoId,
    cargoName: C.name,
    trailer: C.trailer,
    kg,
    fragile: !!C.fragile,
    hazmat: !!C.hazmat,
    urgent,
    from: { id: from.id, type: from.type, icon: from.icon, company: from.company, town: from.town, x: from.x, z: from.z, r: from.r },
    to: { id: to.id, type: to.type, icon: to.icon, company: to.company, town: to.town, x: to.x, z: to.z, r: to.r },
    lenM: Math.round(lenM),
    km: +km.toFixed(2),
  };
  job.allowedSec = allowedSeconds(lenM, urgent);
  const p = jobPay(job);
  job.pay = p.pay;
  job.basePay = p.base;
  return job;
}

/**
 * Offers around a position. opts: { seed (board number), count (default 8), trailer (filter, optional),
 * minKm, maxKm, radius (m, search for origins), dist }.
 */
export function generateJobs(W, pos, opts = {}) {
  const seed = opts.seed ?? 0, count = opts.count ?? 8, radius = opts.radius ?? 9000;
  const minKm = opts.minKm ?? 2.5, maxKm = opts.maxKm ?? 22;
  const dist = opts.dist || ((a, b) => routeDistance(W, a, b));
  const origins = depotsNear(W, pos.x, pos.z, radius).slice(0, 7);
  const reach = maxKm * 1000 / 1.25;
  const out = [], seen = new Set();
  const rnd = prng(hashStr(`jobs|${W.sd}|${seed}|${Math.round(pos.x / 500)}|${Math.round(pos.z / 500)}`));
  let guard = 0;
  while (out.length < count && origins.length && guard++ < count * 14) {
    const from = origins[Math.floor(rnd() * origins.length)];
    const cargos = Object.keys(CARGO).filter((c) => CARGO[c].from.includes(from.type) && (!opts.trailer || CARGO[c].trailer === opts.trailer));
    if (!cargos.length) continue;
    const cid = cargos[Math.floor(rnd() * cargos.length)];
    const C = CARGO[cid];
    const dests = depotsNear(W, from.x, from.z, reach).filter((d) => d.id !== from.id && C.to.includes(d.type) && Math.hypot(d.x - from.x, d.z - from.z) > minKm * 1000 / 1.6);
    if (!dests.length) continue;
    const to = dests[Math.floor(rnd() * Math.min(dests.length, 9))];
    const job = makeJob(W, from, to, cid, rnd, dist);
    if (!job || job.km < minKm || job.km > maxKm || seen.has(job.id)) continue;
    seen.add(job.id);
    out.push(job);
  }
  const od = (j) => Math.hypot(j.from.x - pos.x, j.from.z - pos.z);
  return out.sort((a, b) => od(a) - od(b) || a.km - b.km || (a.id < b.id ? -1 : 1));
}
