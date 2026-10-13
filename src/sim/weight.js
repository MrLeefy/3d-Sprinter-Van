// Mass, centre of gravity and axle-load calculation.
import { COMPONENTS } from '../data/components.js';
import { VAN, BODY } from '../data/vehicle.js';
import { WATER } from '../data/plumbing.js';
import { center } from './geometry.js';

// Distributed build items not represented as discrete components (kg, CoG [x,y,z])
export const DISTRIBUTED = [
  { id: 'floor', name: 'Subfloor (XPS + ply + vinyl)', mass: 38, cg: [0.6, 0.71, 0], cost: 650 },
  { id: 'linings', name: 'Wall & ceiling linings, furring', mass: 36, cg: [0.6, 1.8, 0], cost: 900 },
  { id: 'cabling', name: 'Cabling (4/0 → 16 AWG), bus bars, lugs', mass: 19, cg: [-0.6, 1.4, -0.5], cost: 1100 },
  { id: 'plumbing', name: 'PEX, fittings, drains, valves', mass: 7, cg: [0.3, 0.9, 0.1], cost: 500 },
  { id: 'ducting', name: 'Heater ducts & outlets', mass: 4, cg: [0.2, 1.1, 0.1], cost: 280 },
  { id: 'hardware', name: 'Fasteners, rivnuts, adhesives, sealants', mass: 14, cg: [0.4, 1.4, 0], cost: 800 },
  { id: 'bedding', name: 'Bedding & cushions', mass: 7, cg: [-0.8, 1.75, 0], cost: 350 },
];

export function defaultLoadout() {
  return {
    occupants: [{ name: 'Driver', mass: 80, cg: [3.1, 1.2, -0.43] }, { name: 'Passenger', mass: 80, cg: [3.1, 1.2, 0.43] }],
    freshFrac: 1,
    greyFrac: 0,
    gear: [
      { name: 'Garage gear & tools', mass: 45, cg: [-0.9, 1.15, 0] },
      { name: 'Clothing', mass: 25, cg: [0.2, 2.1, 0.4] },
      { name: 'Food & drink', mass: 22, cg: [1.2, 1.3, -0.5] },
      { name: 'Cookware & kitchen', mass: 12, cg: [1.4, 1.2, -0.5] },
    ],
  };
}

export function massItems(loadout = defaultLoadout()) {
  const items = [];
  for (const c of COMPONENTS) {
    if (!c.mass) continue;
    items.push({ id: c.id, name: c.name, mass: c.mass, cg: center(c.box), group: 'build', system: c.system });
  }
  for (const d of DISTRIBUTED) items.push({ ...d, group: 'build', system: 'structure' });
  const tank = COMPONENTS.find((c) => c.id === 'fresh-tank');
  const grey = COMPONENTS.find((c) => c.id === 'grey-tank');
  const heater = COMPONENTS.find((c) => c.id === 'combi-heater');
  items.push({ id: 'water-fresh', name: 'Fresh water', mass: WATER.freshL * loadout.freshFrac, cg: center(tank.box), group: 'fluids' });
  items.push({ id: 'water-boiler', name: 'Boiler water', mass: WATER.boilerL, cg: center(heater.box), group: 'fluids' });
  items.push({ id: 'water-grey', name: 'Grey water', mass: WATER.greyL * loadout.greyFrac, cg: center(grey.box), group: 'fluids' });
  for (const o of loadout.occupants) items.push({ id: 'occ-' + o.name, name: o.name, mass: o.mass, cg: o.cg, group: 'occupants' });
  for (const g of loadout.gear) items.push({ id: 'gear-' + g.name, name: g.name, mass: g.mass, cg: g.cg, group: 'gear' });
  return items;
}

export function weightReport(loadout = defaultLoadout()) {
  const items = massItems(loadout);
  const sum = (f) => items.filter(f).reduce((s, i) => s + i.mass, 0);
  const build = sum((i) => i.group === 'build');
  const fluids = sum((i) => i.group === 'fluids');
  const occupants = sum((i) => i.group === 'occupants');
  const gear = sum((i) => i.group === 'gear');
  const added = build + fluids + occupants + gear;
  const WB = BODY.frontAxleX - BODY.rearAxleX;
  let front = VAN.curbFront.v;
  let rear = VAN.curbRear.v;
  let mx = 0, my = 0, mz = 0;
  for (const i of items) {
    const f = (i.mass * (i.cg[0] - BODY.rearAxleX)) / WB;
    front += f;
    rear += i.mass - f;
    mx += i.mass * i.cg[0];
    my += i.mass * i.cg[1];
    mz += i.mass * i.cg[2];
  }
  const curb = VAN.curbFront.v + VAN.curbRear.v;
  // Base van CoG (assumption): x from axle split, height 0.78 m, centred laterally
  const curbX = (VAN.curbFront.v * WB) / curb;
  const total = curb + added;
  const cg = [(mx + curb * curbX) / total, (my + curb * 0.78) / total, mz / total];
  const payload = VAN.gvwr.v - curb;
  const bySystem = {};
  for (const i of items.filter((x) => x.group === 'build')) bySystem[i.system] = (bySystem[i.system] || 0) + i.mass;
  return {
    items, build, fluids, occupants, gear, added, curb, gvw: total,
    payload, payloadUsed: added, payloadLeft: payload - added,
    front, rear, frontPct: (front / total) * 100,
    gvwr: VAN.gvwr.v, gawrFront: VAN.gawrFront.v, gawrRear: VAN.gawrRear.v,
    cg, lateralOffsetMm: cg[2] * 1000, bySystem,
  };
}
