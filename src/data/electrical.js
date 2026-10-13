// Electrical system definition: bank, sources, loads, circuits and routed cables.
// Power figures are electrical INPUT power at the device terminals.

export const BANK = {
  nominalV: 12.8,
  capacityAh: 600, // 2 × 300 Ah in parallel
  get capacityWh() { return this.nominalV * this.capacityAh; }, // 7680 Wh
  minSoc: 0.1, // BMS low-SoC disconnect (keeps reserve)
  shedSoc: 0.2, // Cerbo load-shedding: AC compressor & cooktop inhibited below this
  maxDischargeA: 400, // 2 × 200 A continuous
  bmsContactorA: 500,
  chargeEff: 0.98,
  coldChargeLimitC: 0, // LiFePO4 must not be charged below 0 °C (garage is heated)
};

export const INVERTER = {
  model: 'Victron MultiPlus-II 12/3000/120',
  continuousW25: 2400,
  continuousW40: 2200,
  peakW: 5500,
  efficiency: 0.92, // typical at mid load (93 % max)
  idleW: 13,
  chargerA: 120,
};

export const SOURCES = {
  solar: { wp: 1020, panels: 3, mpptMaxA: 70, derate: 0.78, note: 'Flat mount, heat, soiling, MPPT & wiring losses' },
  alternator: { chargers: 2, ampsEach: 50, v: 14.2, efficiency: 0.985, note: '2 × Orion XS 12/12-50A (needs heavy-duty alternator)' },
  shore: { inletA: 30, v: 120, defaultLimitA: 15, note: 'Inverter input current limit set to the pedestal (15 A or 30 A)' },
};

// Loads. `levels` = selectable operating points (W). `auto` loads are computed by the
// simulation (thermostats, compressor duty). `bus`: dc (12 V) or ac (120 V via inverter).
export const LOADS = [
  { id: 'ac', name: 'Rooftop AC', comp: 'rooftop-ac', bus: 'dc', circuit: 'roof-ac', icon: '❄',
    levels: [{ n: 'Off', w: 0 }, { n: 'Quiet (night)', w: 250 }, { n: 'Auto', w: 'auto' }, { n: 'Max', w: 742 }] },
  { id: 'induction', name: 'Induction cooktop', comp: 'cooktop', bus: 'ac', circuit: 'ac-cooktop', icon: '🍳',
    levels: [{ n: 'Off', w: 0 }, { n: 'Simmer', w: 500 }, { n: 'Medium', w: 1200 }, { n: 'Boost', w: 1800 }] },
  { id: 'microwave', name: 'Convection microwave', comp: 'microwave', bus: 'ac', circuit: 'ac-micro', icon: '◫',
    levels: [{ n: 'Off', w: 0 }, { n: 'Reheat', w: 1500 }] },
  { id: 'fridge', name: 'Fridge / freezer', comp: 'fridge', bus: 'dc', circuit: 'dc-fridge', icon: '🧊',
    levels: [{ n: 'Off', w: 0 }, { n: 'Auto', w: 'auto' }] },
  { id: 'heater', name: 'Combi heater (diesel)', comp: 'combi-heater', bus: 'dc', circuit: 'dc-heater', icon: '♨',
    levels: [{ n: 'Off', w: 0 }, { n: 'Auto', w: 'auto' }] },
  { id: 'heaterElec', name: 'Combi electric element', comp: 'combi-heater', bus: 'ac', circuit: 'ac-heater', icon: '⚡',
    levels: [{ n: 'Off', w: 0 }, { n: '900 W', w: 900 }, { n: '1800 W', w: 1800 }] },
  { id: 'pump', name: 'Water pump', comp: 'water-pump', bus: 'dc', circuit: 'dc-pump', icon: '💧',
    levels: [{ n: 'Idle', w: 0 }, { n: 'Running', w: 80 }] },
  { id: 'fanMain', name: 'Main roof fan', comp: 'fan-main', bus: 'dc', circuit: 'dc-fans', icon: '✣',
    levels: [{ n: 'Off', w: 0 }, { n: 'Low', w: 12 }, { n: 'Med', w: 30 }, { n: 'High', w: 60 }] },
  { id: 'fanBath', name: 'Wet-bath fan', comp: 'fan-bath', bus: 'dc', circuit: 'dc-fans', icon: '✣',
    levels: [{ n: 'Off', w: 0 }, { n: 'Low', w: 12 }, { n: 'Med', w: 30 }, { n: 'High', w: 60 }] },
  { id: 'hood', name: 'Range hood', comp: 'range-hood', bus: 'dc', circuit: 'dc-hood', icon: '⌂',
    levels: [{ n: 'Off', w: 0 }, { n: 'Low', w: 20 }, { n: 'Boost', w: 60 }] },
  { id: 'freshFan', name: 'Fresh-air inlet fan', comp: 'fresh-air-inlet', bus: 'dc', circuit: 'dc-fans', icon: '≋',
    levels: [{ n: 'Off', w: 0 }, { n: 'Night 50 m³/h', w: 7 }, { n: 'Boost 80 m³/h', w: 14 }] },
  { id: 'lights', name: 'Lighting', comp: 'lighting', bus: 'dc', circuit: 'dc-lights', icon: '☀',
    levels: [{ n: 'Off', w: 0 }, { n: 'Evening (dim)', w: 10 }, { n: 'Full', w: 30 }] },
  { id: 'usb', name: 'USB-C devices / laptops', comp: 'outlets-dinette', bus: 'dc', circuit: 'dc-usb', icon: '⌁',
    levels: [{ n: 'Off', w: 0 }, { n: 'Phones', w: 20 }, { n: '1 laptop', w: 65 }, { n: '2 laptops + monitor', w: 160 }] },
  { id: 'outlets', name: '120 V outlets (misc)', comp: 'outlets-galley', bus: 'ac', circuit: 'ac-outlets', icon: '⏚',
    levels: [{ n: 'Off', w: 0 }, { n: 'Small (blender)', w: 300 }, { n: 'Kettle/hair dryer', w: 1200 }] },
  { id: 'starlink', name: 'Satellite internet + router', comp: 'starlink', bus: 'dc', circuit: 'dc-comms', icon: '⌖',
    levels: [{ n: 'Off', w: 0 }, { n: 'On', w: 38 }] },
  { id: 'greyHeat', name: 'Grey-tank heat pad', comp: 'grey-tank', bus: 'dc', circuit: 'dc-greyheat', icon: '≈',
    levels: [{ n: 'Off', w: 0 }, { n: 'Auto (<2 °C)', w: 'auto' }] },
  { id: 'toiletFan', name: 'Toilet vent fan', comp: 'toilet', bus: 'dc', circuit: 'dc-small', icon: '·',
    levels: [{ n: 'Off', w: 0 }, { n: 'On', w: 1 }] },
  { id: 'monitor', name: 'Monitoring, alarms, BMS', comp: 'cerbo-gx', bus: 'dc', circuit: 'dc-small', icon: '◉',
    levels: [{ n: 'On', w: 6 }] },
  { id: 'slideout', name: 'Slide-out actuators (momentary)', comp: 'slideout-pod', bus: 'dc', circuit: 'dc-slide', icon: '⇔',
    levels: [{ n: 'Idle', w: 0 }, { n: 'Moving', w: 240 }] },
  { id: 'heatPump', name: 'Heat-pump option (120 V)', comp: 'rooftop-ac', bus: 'ac', circuit: 'ac-heater', icon: '⇅', optional: true,
    levels: [{ n: 'Off', w: 0 }, { n: 'Auto', w: 'auto' }] },
];

export const loadById = Object.fromEntries(LOADS.map((l) => [l.id, l]));

// Conductor data: resistance (Ω/m, copper @20 °C) and ampacity (A).
// DC ampacity: ABYC E-11, 105 °C insulation, outside engine spaces (single conductor).
// AC ampacity: NEC / NFPA 1192 branch-circuit practice.
export const WIRE = {
  '4/0': { r: 0.000161, dcA: 445 }, '2/0': { r: 0.000256, dcA: 330 }, '1/0': { r: 0.000323, dcA: 285 },
  '2': { r: 0.000513, dcA: 210 }, '4': { r: 0.000815, dcA: 160 }, '6': { r: 0.0013, dcA: 120 },
  '8': { r: 0.00206, dcA: 80 }, '10': { r: 0.00328, dcA: 60, acA: 30 }, '12': { r: 0.00521, dcA: 45, acA: 20 },
  '14': { r: 0.00829, dcA: 35, acA: 15 }, '16': { r: 0.0132, dcA: 25 },
};

// Circuits: protection & conductor per branch, with one-way length for voltage-drop checks.
// maxA = worst-case continuous current; bundled DC branches are derated ×0.7.
export const CIRCUITS = [
  { id: 'battery-main', name: 'Battery → Class-T → BMS bus', bus: 'dc', awg: '4/0', fuseA: 400, lengthM: 1.2, maxA: 345, critical: true },
  { id: 'inverter', name: 'Lynx → MultiPlus-II', bus: 'dc', awg: '4/0', fuseA: 300, lengthM: 1.0, maxA: 2400 / 0.92 / 11.5 },
  { id: 'roof-ac', name: 'Lynx → rooftop AC', bus: 'dc', awg: '2', fuseA: 80, lengthM: 4.0, maxA: 58, critical: true },
  { id: 'dc-panel', name: 'Lynx → DC fuse panel', bus: 'dc', awg: '4', fuseA: 100, lengthM: 0.8, maxA: 70 },
  { id: 'mppt', name: 'MPPT → Lynx', bus: 'dc', awg: '6', fuseA: 80, lengthM: 0.8, maxA: 70 },
  { id: 'pv', name: 'Array → PV isolator → MPPT', bus: 'dc', awg: '8', fuseA: 40, lengthM: 6.0, maxA: 3 * 10.5, pv: true, vNom: 34 },
  { id: 'alt-feed', name: 'Starter battery → 2 × Orion XS', bus: 'dc', awg: '1/0', fuseA: 150, lengthM: 5.5, maxA: 110 },
  { id: 'orion-out', name: 'Orion XS → Lynx (each)', bus: 'dc', awg: '6', fuseA: 60, lengthM: 0.8, maxA: 50 },
  { id: 'dc-fridge', name: 'Fridge', bus: 'dc', awg: '10', fuseA: 15, lengthM: 3.2, maxA: 8, bundled: true, critical: true },
  { id: 'dc-heater', name: 'Combi heater (12 V)', bus: 'dc', awg: '12', fuseA: 10, lengthM: 1.5, maxA: 8.3, bundled: true, critical: true },
  { id: 'dc-pump', name: 'Water pump', bus: 'dc', awg: '12', fuseA: 15, lengthM: 2.0, maxA: 8, bundled: true },
  { id: 'dc-fans', name: 'Roof fans + inlet fan', bus: 'dc', awg: '12', fuseA: 15, lengthM: 4.5, maxA: 11, bundled: true },
  { id: 'dc-hood', name: 'Range hood', bus: 'dc', awg: '14', fuseA: 10, lengthM: 4.0, maxA: 5, bundled: true },
  { id: 'dc-lights', name: 'Lighting', bus: 'dc', awg: '14', fuseA: 10, lengthM: 5.0, maxA: 3, bundled: true },
  { id: 'dc-usb', name: 'USB-C outlets', bus: 'dc', awg: '10', fuseA: 25, lengthM: 4.0, maxA: 16, bundled: true },
  { id: 'dc-comms', name: 'Starlink + router', bus: 'dc', awg: '12', fuseA: 10, lengthM: 4.0, maxA: 4, bundled: true },
  { id: 'dc-greyheat', name: 'Grey-tank heat pad + dump valve tape', bus: 'dc', awg: '14', fuseA: 10, lengthM: 3.5, maxA: 5.5, bundled: true },
  { id: 'dc-slide', name: 'Slide-out actuators', bus: 'dc', awg: '10', fuseA: 30, lengthM: 1.5, maxA: 20, bundled: true },
  { id: 'dc-small', name: 'Monitoring, alarms, toilet fan', bus: 'dc', awg: '16', fuseA: 5, lengthM: 3.0, maxA: 1, bundled: true },
  { id: 'ac-main', name: 'Inverter → AC panel (30 A main)', bus: 'ac', awg: '10', breakerA: 30, maxA: 25 },
  { id: 'ac-cooktop', name: 'Induction cooktop (dedicated)', bus: 'ac', awg: '12', breakerA: 20, maxA: 15 },
  { id: 'ac-micro', name: 'Microwave (dedicated)', bus: 'ac', awg: '12', breakerA: 20, maxA: 12.5 },
  { id: 'ac-outlets', name: 'Galley & dinette outlets (GFCI)', bus: 'ac', awg: '12', breakerA: 20, maxA: 12 },
  { id: 'ac-outdoor', name: 'Outdoor kitchen outlet (GFCI)', bus: 'ac', awg: '12', breakerA: 20, maxA: 15 },
  { id: 'ac-heater', name: 'Combi element / heat-pump option', bus: 'ac', awg: '14', breakerA: 15, maxA: 15 },
  { id: 'shore', name: 'Shore inlet → MultiPlus AC-in', bus: 'ac', awg: '10', breakerA: 30, maxA: 30 },
];

// Peak AC demand management: the GX load manager forbids these combinations on inverter.
export const LOAD_MANAGEMENT = [
  { when: ['microwave'], limit: { induction: 600 }, why: 'Microwave (1.5 kW) + boost cooktop (1.8 kW) would exceed the 2.4 kW inverter rating.' },
  { when: ['heaterElec'], onlyOn: 'shore', why: 'Electric heating only on shore power (or > 90 % SoC with strong solar).' },
  { when: ['outlets:1200'], limit: { induction: 1200, microwave: 0 }, why: 'Kettle / hair dryer shares the inverter budget.' },
];

// Cable routes (polyline points in world metres). kind drives colour & animation.
//   dc+ / dc- main battery cables, dc branch, ac 120 V, pv, alt (alternator feed), shore, data
export const WIRES = [
  { id: 'w-bat-a', kind: 'dcmain', from: 'battery-a', to: 'main-fuse', pts: [[-1.2, 0.96, -0.72], [-0.95, 0.97, -0.75], [-0.885, 0.95, -0.77]] },
  { id: 'w-bat-b', kind: 'dcmain', from: 'battery-b', to: 'main-fuse', pts: [[-1.2, 0.96, -0.46], [-0.95, 0.97, -0.62], [-0.885, 0.95, -0.75]] },
  { id: 'w-fuse-bms', kind: 'dcmain', from: 'main-fuse', to: 'lynx-bms', pts: [[-0.885, 0.95, -0.78], [-0.9, 1.06, -0.8], [-1.19, 1.08, -0.8]] },
  { id: 'w-bms-inv', kind: 'dcmain', from: 'lynx-bms', to: 'inverter', circuit: 'inverter', pts: [[-1.19, 1.04, -0.79], [-0.88, 1.0, -0.79], [-0.8, 0.82, -0.75]] },
  { id: 'w-ac-roof', kind: 'dc', from: 'lynx-bms', to: 'rooftop-ac', circuit: 'roof-ac', load: 'ac',
    pts: [[-1.33, 1.17, -0.8], [-1.48, 1.45, -0.84], [-1.49, 2.4, -0.79], [-1.45, 2.6, -0.6], [-1.15, 2.66, -0.25], [-0.96, 2.7, 0]] },
  { id: 'w-dcpanel', kind: 'dc', from: 'lynx-bms', to: 'dc-panel', circuit: 'dc-panel', pts: [[-1.33, 1.17, -0.8], [-1.33, 1.35, -0.8]] },
  { id: 'w-mppt', kind: 'dc', from: 'mppt', to: 'lynx-bms', circuit: 'mppt', pts: [[-1.06, 1.0, -0.79], [-1.15, 1.03, -0.79], [-1.19, 1.06, -0.79]] },
  { id: 'w-pv', kind: 'pv', from: 'solar-2', to: 'mppt', circuit: 'pv', source: 'solar',
    pts: [[1.08, 2.93, 0.78], [0.04, 2.93, 0.78], [-1.0, 2.8, 0.7], [-1.45, 2.74, -0.62], [-1.5, 2.5, -0.82], [-1.5, 1.5, -0.84], [-1.06, 1.29, -0.79]] },
  { id: 'w-alt', kind: 'alt', from: 'starter-battery', to: 'orion-1', circuit: 'alt-feed', source: 'alternator',
    pts: [[3.07, 0.62, -0.56], [2.2, 0.63, -0.42], [0.4, 0.63, -0.2], [-1.0, 0.63, -0.25], [-1.42, 0.7, -0.3], [-1.42, 1.0, -0.32], [-1.4, 1.2, -0.79]] },
  { id: 'w-orion', kind: 'dc', from: 'orion-1', to: 'lynx-bms', circuit: 'orion-out', source: 'alternator', pts: [[-1.32, 1.22, -0.8], [-1.32, 1.17, -0.8]] },
  { id: 'w-shore', kind: 'shore', from: 'shore-inlet', to: 'inverter', circuit: 'shore', source: 'shore',
    pts: [[-0.68, 0.86, -0.96], [-0.6, 0.9, -0.87], [-0.62, 1.24, -0.86], [-0.69, 1.25, -0.79]] },
  { id: 'w-inv-ac', kind: 'ac', from: 'inverter', to: 'ac-panel', circuit: 'ac-main', pts: [[-0.69, 1.28, -0.79], [-0.85, 1.4, -0.84], [-0.95, 1.38, -0.81]] },
  { id: 'w-ac-cook', kind: 'ac', from: 'ac-panel', to: 'cooktop', circuit: 'ac-cooktop', load: 'induction',
    pts: [[-1.05, 1.42, -0.84], [-0.5, 1.46, -0.865], [0.6, 1.1, -0.865], [1.3, 1.45, -0.845], [1.455, 1.52, -0.55]] },
  { id: 'w-ac-micro', kind: 'ac', from: 'ac-panel', to: 'microwave', circuit: 'ac-micro', load: 'microwave',
    pts: [[-1.05, 1.43, -0.845], [-0.5, 1.48, -0.87], [-0.05, 1.45, -0.86], [0.17, 1.45, -0.8]] },
  { id: 'w-ac-outlets', kind: 'ac', from: 'ac-panel', to: 'outlets-galley', circuit: 'ac-outlets', load: 'outlets',
    pts: [[-1.05, 1.41, -0.85], [-0.5, 1.47, -0.87], [0.6, 1.2, -0.865], [0.96, 1.75, -0.85], [1.9, 1.25, -0.85], [2.1, 1.25, -0.54]] },
  { id: 'w-ac-outdoor', kind: 'ac', from: 'ac-panel', to: 'outdoor-kitchen', circuit: 'ac-outdoor', pts: [[-1.05, 1.31, -0.8], [-1.1, 1.02, -0.32], [-1.15, 0.95, 0.03]] },
  { id: 'w-dc-fridge', kind: 'dc', from: 'dc-panel', to: 'fridge', circuit: 'dc-fridge', load: 'fridge',
    pts: [[-1.33, 1.42, -0.84], [-0.5, 1.44, -0.87], [0.6, 0.95, -0.865], [0.94, 0.84, -0.845]] },
  { id: 'w-dc-heater', kind: 'dc', from: 'dc-panel', to: 'combi-heater', circuit: 'dc-heater', load: 'heater',
    pts: [[-1.33, 1.44, -0.82], [-1.2, 1.47, -0.3], [-0.95, 1.47, 0.35], [-0.88, 1.04, 0.6]] },
  { id: 'w-dc-pump', kind: 'dc', from: 'dc-panel', to: 'water-pump', circuit: 'dc-pump', load: 'pump',
    pts: [[-1.33, 1.44, -0.82], [-1.45, 1.47, 0.1], [-1.38, 1.0, 0.72], [-1.36, 0.88, 0.72]] },
  { id: 'w-dc-fans', kind: 'dc', from: 'dc-panel', to: 'fan-main', circuit: 'dc-fans', load: 'fanMain',
    pts: [[-1.4, 1.44, -0.84], [-1.49, 2.4, -0.79], [-1.3, 2.61, -0.5], [-0.6, 2.61, -0.3], [1.0, 2.61, 0.07], [1.7, 2.61, 0.27]] },
  { id: 'w-dc-bathfan', kind: 'dc', from: 'dc-panel', to: 'fan-bath', circuit: 'dc-fans', load: 'fanBath', pts: [[-0.6, 2.61, -0.3], [0.0, 2.61, 0.06], [0.3, 2.61, 0.47]] },
  { id: 'w-dc-fresh', kind: 'dc', from: 'dc-panel', to: 'fresh-air-inlet', circuit: 'dc-fans', load: 'freshFan', pts: [[1.7, 2.61, 0.27], [2.45, 2.6, 0.25]] },
  { id: 'w-dc-hood', kind: 'dc', from: 'dc-panel', to: 'range-hood', circuit: 'dc-hood', load: 'hood', pts: [[-0.6, 2.61, -0.3], [0.65, 2.61, -0.45], [1.45, 2.4, -0.6]] },
  { id: 'w-dc-lights', kind: 'dc', from: 'dc-panel', to: 'lighting', circuit: 'dc-lights', load: 'lights', pts: [[-1.3, 2.61, -0.45], [-0.2, 2.615, -0.38], [1.0, 2.615, 0.25], [2.5, 2.615, -0.3]] },
  { id: 'w-dc-usb', kind: 'dc', from: 'dc-panel', to: 'outlets-dinette', circuit: 'dc-usb', load: 'usb',
    pts: [[-1.33, 1.42, -0.83], [-0.5, 1.45, -0.87], [0.6, 1.0, -0.865], [1.9, 1.2, -0.85], [2.1, 1.22, -0.55]] },
  { id: 'w-dc-usb-bed', kind: 'dc', from: 'dc-panel', to: 'outlets-bed', circuit: 'dc-usb', load: 'usb', pts: [[-1.2, 1.46, -0.4], [-0.3, 1.47, 0.2], [-0.16, 1.8, 0.36]] },
  { id: 'w-dc-starlink', kind: 'dc', from: 'dc-panel', to: 'starlink', circuit: 'dc-comms', load: 'starlink', pts: [[-1.49, 2.4, -0.79], [-1.4, 2.72, 0.3], [-1.07, 2.9, 0.6]] },
  { id: 'w-dc-grey', kind: 'dc', from: 'dc-panel', to: 'grey-tank', circuit: 'dc-greyheat', load: 'greyHeat', pts: [[-1.42, 0.72, -0.25], [0.2, 0.62, 0.1], [1.1, 0.6, 0.45]] },
  { id: 'w-dc-slide', kind: 'dc', from: 'dc-panel', to: 'slideout-pod', circuit: 'dc-slide', load: 'slideout', pts: [[-1.3, 1.44, -0.84], [-1.1, 1.48, -0.8], [-0.85, 1.48, -0.8]] },
  { id: 'w-dc-toilet', kind: 'dc', from: 'dc-panel', to: 'toilet', circuit: 'dc-small', load: 'toiletFan', pts: [[-1.2, 1.47, -0.2], [-0.5, 1.47, 0.3], [-0.45, 1.25, 0.46]] },
  { id: 'w-estop', kind: 'data', from: 'emergency-stop', to: 'lynx-bms', pts: [[1.35, 1.58, 0.34], [1.0, 2.61, 0.25], [-0.6, 2.61, -0.3], [-1.49, 2.4, -0.8], [-1.33, 1.17, -0.79]] },
  { id: 'w-gx', kind: 'data', from: 'cerbo-gx', to: 'lynx-bms', pts: [[0.37, 1.77, -0.5], [0.2, 2.0, -0.85], [-0.5, 1.48, -0.87], [-1.2, 1.15, -0.8]] },
];
