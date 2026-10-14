// Roadside Assistance & Tow Service (pure JS, headless).
// Handles vehicle immobilization detection (dead engine, empty fuel, rollover)
// and roadside flatbed recovery to the nearest town depot or service station.
import { depotsNear, depotOf } from '../world/jobs.js';

export const TOW_RATES = {
  baseFee: 150, // USD flat dispatch callout fee
  perKm: 4.0,   // USD per km of recovery distance
  engineSurcharge: 75,   // USD winch & flatbed loading for dead engine
  fuelSurcharge: 40,     // USD roadside fuel delivery & system prime
  rolloverSurcharge: 250, // USD heavy winching & uprighting recovery
  emergencyFuelL: 20.0,  // Litres of diesel provided on empty tank
};

export const TOW_STATES = {
  IDLE: 'idle',
  DISPATCHED: 'dispatched',
  EN_ROUTE: 'en_route',
  HOOKUP: 'hookup',
  TOWING: 'towing',
  RECOVERED: 'recovered',
};

/**
 * Determine if a vehicle is immobilized and unable to drive.
 * Checks for dead engine, empty fuel tank, or rollover.
 */
export function isImmobilized(van) {
  if (!van) return { immobilized: false, reason: null, details: 'No vehicle provided' };

  // 1. Engine dead (heavy collision damage to front radiator/engine bay)
  const engineDead = Boolean(
    van.dmg?.engineDead ||
    van.engineDead ||
    (van.dmg?.zone?.front !== undefined && van.dmg.zone.front >= 0.97) ||
    van.engineOut
  );

  // 2. Out of fuel
  const fuelL = van.fuelL ?? van.state?.fuelL ?? van.fuel ?? 100;
  const outOfFuel = fuelL <= 0;

  // 3. Rolled over on roof/side
  const rolled = Boolean(van.rolledVan || van.rolled || van.rig?.rolled);

  if (engineDead) {
    return {
      immobilized: true,
      reason: 'engineDead',
      details: 'Radiator crushed / engine bay compromised — zero engine power',
      fuelL,
      engineDead: true,
      rolled,
    };
  }

  if (outOfFuel) {
    return {
      immobilized: true,
      reason: 'outOfFuel',
      details: 'Diesel tank empty (0.0 L) — engine starved',
      fuelL,
      engineDead: false,
      rolled,
    };
  }

  if (rolled) {
    return {
      immobilized: true,
      reason: 'rollover',
      details: 'Vehicle overturned on side or roof',
      fuelL,
      engineDead,
      rolled: true,
    };
  }

  return {
    immobilized: false,
    reason: null,
    details: 'Vehicle operational',
    fuelL,
    engineDead: false,
    rolled: false,
  };
}

/**
 * Locate the nearest settlement depot, service station or town centre.
 */
export function findNearestDepot(W, x, z, options = {}) {
  const maxSearchRadius = options.maxRadius ?? 60000;

  // 1. Check known freight & service depots
  try {
    const nearbyDepots = depotsNear(W, x, z, maxSearchRadius);
    if (nearbyDepots && nearbyDepots.length > 0) {
      const top = nearbyDepots[0];
      const dist = Math.hypot(top.x - x, top.z - z);
      const y = W.heightAt(top.x, top.z);
      return {
        id: top.id,
        name: top.company || top.label,
        town: top.town,
        type: 'depot',
        kind: top.type,
        x: top.x,
        z: top.z,
        y,
        distanceM: dist,
      };
    }
  } catch {
    // Fall back to node search if depot lookup fails
  }

  // 2. Check settlement nodes
  const nodes = W.nodesNear(x, z, maxSearchRadius);
  const serviceNodes = nodes.filter((n) =>
    ['truckstop', 'city', 'town', 'village', 'lodge', 'farm'].includes(n.kind)
  );

  const candidates = serviceNodes.length > 0 ? serviceNodes : nodes;
  if (!candidates.length) {
    // Ultimate fallback: world origin
    return {
      id: 'origin',
      name: 'Central Service Depot',
      town: 'Central',
      type: 'depot',
      kind: 'truckstop',
      x: 0,
      z: 0,
      y: W.heightAt(0, 0),
      distanceM: Math.hypot(x, z),
    };
  }

  candidates.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  const bestNode = candidates[0];

  // Check if node has a depot
  const nodeDepot = depotOf(W, bestNode);
  const targetX = nodeDepot ? nodeDepot.x : bestNode.x;
  const targetZ = nodeDepot ? nodeDepot.z : bestNode.z;
  const targetY = W.heightAt(targetX, targetZ);

  return {
    id: bestNode.key || bestNode.id || `${bestNode.i},${bestNode.j}`,
    name: nodeDepot?.company || `${bestNode.name} Service Station`,
    town: bestNode.name,
    type: bestNode.kind === 'truckstop' ? 'service_station' : 'depot',
    kind: bestNode.kind,
    x: targetX,
    z: targetZ,
    y: targetY,
    distanceM: Math.hypot(targetX - x, targetZ - z),
  };
}

/**
 * Calculate itemized roadside recovery billing.
 */
export function calculateTowFee(distanceM, reason, repairCost = 0) {
  const km = distanceM / 1000;
  const base = TOW_RATES.baseFee;
  const mileage = Math.round(km * TOW_RATES.perKm);

  let surcharge = 0;
  if (reason === 'engineDead') surcharge = TOW_RATES.engineSurcharge;
  else if (reason === 'outOfFuel') surcharge = TOW_RATES.fuelSurcharge;
  else if (reason === 'rollover') surcharge = TOW_RATES.rolloverSurcharge;

  const total = base + mileage + surcharge + repairCost;

  return {
    base,
    mileage,
    km: Number(km.toFixed(1)),
    surcharge,
    repairCost,
    total,
    reason,
  };
}

/**
 * Perform recovery of the van to the nearest town depot or service station.
 */
export function dispatchTow(W, van, options = {}) {
  const status = isImmobilized(van);
  if (!status.immobilized && !options.force) {
    return {
      success: false,
      reason: 'Vehicle is not immobilized',
      van,
    };
  }

  const curX = van.x ?? 0;
  const curZ = van.z ?? 0;
  const dest = findNearestDepot(W, curX, curZ, options);

  const repairCost = van.dmg?.repairCost ? van.dmg.repairCost() : 0;
  const invoice = calculateTowFee(dest.distanceM, status.reason, repairCost);

  // ── Execute vehicle recovery ─────────────────────────────────────
  // 1. Reposition to destination depot/station
  van.x = dest.x;
  van.z = dest.z;
  van.y = dest.y;

  // 2. Halt all velocities and momentum
  van.v = 0;
  van.vy = 0;
  van.yawRate = 0;

  // 3. Upright vehicle
  if (van.rolledVan !== undefined) van.rolledVan = false;
  if (van.rolled !== undefined) van.rolled = false;
  if (van.roll !== undefined) van.roll = 0;
  if (van.pitch !== undefined) van.pitch = 0;

  // 4. Engine repair if damaged
  if (status.reason === 'engineDead' || options.repair !== false) {
    if (typeof van.dmg?.repair === 'function') {
      van.dmg.repair();
    } else if (van.dmg?.zone) {
      van.dmg.zone.front = 0;
      van.dmg.zone.rear = 0;
      van.dmg.zone.left = 0;
      van.dmg.zone.right = 0;
      if (van.dmg.flat !== undefined) van.dmg.flat = 0;
      if (van.dmg.pull !== undefined) van.dmg.pull = 0;
    }
  }

  // 5. Emergency fuel if empty
  if (status.reason === 'outOfFuel' || (van.fuelL !== undefined && van.fuelL <= 0)) {
    if (van.fuelL !== undefined) van.fuelL = Math.max(van.fuelL, TOW_RATES.emergencyFuelL);
    if (van.state?.fuelL !== undefined) van.state.fuelL = Math.max(van.state.fuelL, TOW_RATES.emergencyFuelL);
  }

  return {
    success: true,
    destination: dest,
    distanceM: dest.distanceM,
    invoice,
    reason: status.reason,
    timestamp: Date.now(),
  };
}

/**
 * TowService state machine for simulation and UI roadside assistance.
 */
export class TowService {
  constructor(world, options = {}) {
    this.world = world;
    this.state = TOW_STATES.IDLE;
    this.van = null;
    this.target = null;
    this.invoice = null;
    this.timer = 0;
    this.eta = 0;
    this.stats = {
      totalTows: 0,
      totalBilled: 0,
    };
  }

  isImmobilized(van) {
    return isImmobilized(van);
  }

  canRequestTow(van) {
    return this.state === TOW_STATES.IDLE && isImmobilized(van).immobilized;
  }

  requestTow(van, options = {}) {
    const check = isImmobilized(van);
    if (!check.immobilized && !options.force) {
      return { success: false, reason: 'Vehicle is not immobilized' };
    }

    this.van = van;
    this.target = findNearestDepot(this.world, van.x ?? 0, van.z ?? 0, options);
    const repairCost = van.dmg?.repairCost ? van.dmg.repairCost() : 0;
    this.invoice = calculateTowFee(this.target.distanceM, check.reason, repairCost);

    // Speed of tow truck ~18 m/s (~65 km/h)
    const travelSec = Math.max(4.0, Math.min(30.0, this.target.distanceM / 65));
    this.eta = travelSec;
    this.timer = 0;
    this.state = TOW_STATES.DISPATCHED;

    return {
      success: true,
      state: this.state,
      destination: this.target,
      etaSeconds: Number(this.eta.toFixed(1)),
      invoice: this.invoice,
    };
  }

  step(dt = 1.0) {
    if (this.state === TOW_STATES.IDLE || this.state === TOW_STATES.RECOVERED) {
      return this.state;
    }

    this.timer += dt;

    if (this.timer >= this.eta) {
      this.completeRecovery();
      return this.state;
    }

    if (this.timer >= this.eta * 0.85) {
      this.state = TOW_STATES.TOWING;
    } else if (this.timer >= this.eta * 0.7) {
      this.state = TOW_STATES.HOOKUP;
    } else if (this.timer >= 2.0) {
      this.state = TOW_STATES.EN_ROUTE;
    } else {
      this.state = TOW_STATES.DISPATCHED;
    }

    return this.state;
  }

  recoverImmediate(van = this.van, options = {}) {
    const v = van || this.van;
    if (!v) return { success: false, reason: 'No van provided' };
    const res = dispatchTow(this.world, v, options);
    if (res.success) {
      this.state = TOW_STATES.RECOVERED;
      this.target = res.destination;
      this.invoice = res.invoice;
      this.stats.totalTows += 1;
      this.stats.totalBilled += res.invoice.total;
    }
    return res;
  }

  completeRecovery() {
    if (!this.van || !this.target) return;
    const res = dispatchTow(this.world, this.van, { force: true });
    this.state = TOW_STATES.RECOVERED;
    this.stats.totalTows += 1;
    this.stats.totalBilled += this.invoice?.total ?? 0;
    return res;
  }

  cancel() {
    this.state = TOW_STATES.IDLE;
    this.van = null;
    this.target = null;
    this.invoice = null;
    this.timer = 0;
    this.eta = 0;
  }

  getStatus() {
    return {
      state: this.state,
      destination: this.target,
      etaRemaining: Math.max(0, Number((this.eta - this.timer).toFixed(1))),
      invoice: this.invoice,
      totalTows: this.stats.totalTows,
    };
  }
}
