// Thermal envelope, HVAC equipment and air paths.

// Envelope elements: area (m²), U (W/m²K) insulated, solar absorptance (white paint),
// orientation used for solar gain. Areas derived from the body geometry in vehicle.js.
export const ENVELOPE = [
  { id: 'wall-drv', name: 'Driver side wall', area: 8.4, U: 1.1, alpha: 0.3, orient: 'side', layer: 'Thinsulate SM600L + ply lining' },
  { id: 'wall-pass', name: 'Passenger side wall', area: 6.06, U: 1.1, alpha: 0.3, orient: 'side', layer: 'Thinsulate SM600L + ply lining' },
  { id: 'slide-door', name: 'Sliding door (opaque)', area: 1.79, U: 1.4, alpha: 0.3, orient: 'side', layer: 'Thinsulate in door, insulated door card' },
  { id: 'roof', name: 'Roof (high roof + cab)', area: 8.8, U: 1.0, alpha: 0.3, orient: 'roof', layer: 'Thinsulate 50 mm + lining' },
  { id: 'floor', name: 'Cargo floor', area: 7.7, U: 0.9, alpha: 0, orient: 'floor', layer: '25 mm XPS + 12 mm ply' },
  { id: 'cab-floor', name: 'Cab floor & firewall', area: 2.6, U: 2.0, alpha: 0, orient: 'floor', layer: 'OEM + acoustic mat' },
  { id: 'rear-doors', name: 'Rear doors (opaque)', area: 2.9, U: 1.4, alpha: 0.3, orient: 'rear', layer: 'Thinsulate in door, insulated door card' },
  { id: 'cab-metal', name: 'Cab doors & pillars', area: 4.0, U: 2.0, alpha: 0.3, orient: 'side', layer: 'Partial Thinsulate in cab doors' },
  { id: 'windshield', name: 'Windshield', area: 1.65, U: 5.6, Ucov: 1.6, shgc: 0.5, shgcCov: 0.08, glass: true, orient: 'front' },
  { id: 'cab-windows', name: 'Cab door windows', area: 0.84, U: 5.8, Ucov: 1.6, shgc: 0.55, shgcCov: 0.08, glass: true, orient: 'side' },
  { id: 'door-window', name: 'Sliding-door window', area: 0.55, U: 5.8, Ucov: 1.6, shgc: 0.35, shgcCov: 0.08, glass: true, orient: 'side' },
  { id: 'rear-windows', name: 'Rear-door windows', area: 0.5, U: 5.8, Ucov: 1.6, shgc: 0.35, shgcCov: 0.08, glass: true, orient: 'rear' },
];

export const POD_ENVELOPE = { id: 'pod', name: 'Slide-out pod (deployed)', area: 1.9, U: 1.3, alpha: 0.3, orient: 'side', layer: 'GRP sandwich + seals' };

export const AIR = {
  volumeM3: 13.4, // conditioned air volume (cargo + cab, net of furniture)
  infiltrationACH: 0.4, // sealed van, door seals in good condition
  rhoCp: 1206, // J/(m³·K)
  thermalMassJK: 220000, // air + linings + furniture effectively coupled (≈ 1 h time constant)
};

export const HEATER = {
  model: 'Truma Combi D 6 E',
  dieselStagesW: [2000, 4000, 6000],
  dieselLph: { 2000: 0.22, 4000: 0.4, 6000: 0.63 },
  minModW: 1000, // average 110 mL/h at 1000 W when cycling (Truma data)
  electricW: [900, 1800],
  dcW: { idle: 0, heating: 30, boost: 48 },
  airflowM3h: 287,
  efficiencyNote: 'Diesel ≈ 9.9 kWh/L heat content; Combi D modulates between stages',
};

export const AC = {
  model: 'Dometic RTX 2000 12 V',
  ratedCoolW: 1900, // between 1700 W (Dometic) and 2000 W (retail) ratings
  minElecW: 245, // 19 A eco
  maxElecW: 742, // 58 A max
  quietMaxFrac: 0.55,
  ambientMaxC: 52,
  ambientMinC: 5,
  shr: 0.75, // sensible heat ratio → 25 % latent (dehumidification)
};

export function acCapacityW(Tout) {
  // Capacity falls ~1 % per °C above 35 °C; slightly higher below.
  return AC.ratedCoolW * Math.max(0.6, 1 - 0.01 * (Tout - 35));
}

export function acCOP(Tout) {
  // Variable-speed 12 V DC compressor: COP ≈ 3.1 @27 °C falling to ≈ 2.2 @45 °C.
  return Math.max(1.6, 3.1 - 0.05 * Math.max(0, Tout - 27));
}

export function heatPumpCOP(Tout) {
  // Optional 120 V heat-pump roof unit (conceptual): useless below about -5 °C.
  if (Tout < -5) return 0;
  return Math.max(1.4, 2.0 + 0.06 * Tout);
}

export const PEOPLE = {
  sensibleW: { sleep: 60, rest: 75, active: 95 },
  latentGph: { sleep: 35, rest: 45, active: 70 },
  co2Lph: { sleep: 14, rest: 18, active: 30 },
};

export const VENT_RATES = {
  // m³/h of outdoor air exchanged at each fan level (balanced with the inlet / door louvre)
  fanMain: [0, 120, 300, 700],
  fanBath: [0, 50, 250, 600],
  hood: [0, 90, 200],
  freshFan: [0, 50, 80],
};

// Heating ducts (65 mm) from the Combi, ceiling AC duct, kitchen exhaust duct
export const DUCTS = [
  { id: 'd-heat-bath', kind: 'heat', from: 'combi-heater', to: 'wetbath', r: 0.033,
    pts: [[-0.62, 0.98, 0.75], [-0.55, 1.1, 0.75], [-0.4, 1.1, 0.74], [-0.16, 1.1, 0.74], [-0.11, 1.12, 0.74]] },
  { id: 'd-heat-bed', kind: 'heat', from: 'combi-heater', to: 'bed-platform', r: 0.033,
    pts: [[-0.75, 1.04, 0.45], [-0.7, 1.45, 0.38], [-0.45, 1.45, 0.1], [-0.2, 1.45, 0.05], [-0.155, 1.42, 0.04]] },
  { id: 'd-heat-galley', kind: 'heat', from: 'combi-heater', to: 'galley-base', r: 0.033,
    pts: [[-0.85, 1.04, 0.42], [-0.8, 1.45, 0.25], [-0.5, 1.45, -0.3], [-0.14, 1.3, -0.52], [0.0, 0.85, -0.56], [0.6, 0.77, -0.32], [2.0, 0.77, -0.32], [2.1, 0.77, -0.3]] },
  { id: 'd-heat-cab', kind: 'heat', from: 'galley-base', to: 'seat-driver', r: 0.028,
    pts: [[2.1, 0.77, -0.3], [2.45, 0.76, -0.05], [2.75, 0.76, 0.0]] },
  { id: 'd-ac', kind: 'ac', from: 'ac-plenum', to: 'ac-duct', r: 0.03, rect: [0.3, 0.065],
    pts: [[-0.56, 2.588, -0.1], [2.3, 2.588, -0.1]] },
  { id: 'd-hood', kind: 'exhaust', from: 'range-hood', to: 'hood-vent', r: 0.05, pts: [[1.45, 2.28, -0.57], [1.45, 2.5, -0.57], [1.45, 2.75, -0.57]] },
  { id: 'd-fresh', kind: 'fresh', from: 'fresh-air-inlet', to: 'fresh-air-inlet', r: 0.05, pts: [[2.45, 2.82, 0.25], [2.45, 2.55, 0.25]] },
];

// Air-flow streamlines for the ventilation / thermal visualisations.
// Each: kind (fresh, stale, cook, bath, acCold, heatWarm, recirc, battery, defrost), loads that power it.
export const AIRFLOWS = [
  { id: 'a-fresh', kind: 'fresh', requires: ['freshFan'], label: 'Filtered fresh air in',
    pts: [[2.45, 3.0, 0.25], [2.45, 2.82, 0.25], [2.45, 2.5, 0.25], [2.35, 2.1, 0.1], [1.8, 1.7, 0.05], [1.0, 1.75, -0.05], [0.4, 1.8, -0.15], [0.0, 1.9, -0.15]] },
  { id: 'a-fresh-bed', kind: 'fresh', requires: ['freshFan'], label: 'Night sweep past the bed',
    pts: [[0.0, 1.9, -0.15], [-0.4, 1.95, -0.1], [-0.9, 1.9, 0.2], [-0.6, 2.1, 0.05], [-0.13, 2.0, 0.2], [0.1, 2.3, 0.4], [0.3, 2.62, 0.47], [0.3, 3.0, 0.47]] },
  { id: 'a-stale', kind: 'stale', requires: ['fanMain'], label: 'Stale air out (main fan)',
    pts: [[0.6, 1.2, 0.0], [1.0, 1.6, 0.1], [1.5, 2.2, 0.25], [1.7, 2.62, 0.27], [1.7, 2.9, 0.27], [1.85, 3.1, 0.27]] },
  { id: 'a-cook', kind: 'cook', requires: ['hood'], label: 'Cooking steam & fumes → hood → roof',
    pts: [[1.455, 1.65, -0.55], [1.455, 1.9, -0.56], [1.45, 2.18, -0.57], [1.45, 2.5, -0.57], [1.45, 2.82, -0.57], [1.5, 3.05, -0.57]] },
  { id: 'a-bath', kind: 'bath', requires: ['fanBath'], label: 'Shower steam → bath fan',
    pts: [[0.25, 1.4, 0.45], [0.3, 1.9, 0.5], [0.3, 2.4, 0.47], [0.3, 2.62, 0.47], [0.3, 2.9, 0.47], [0.35, 3.1, 0.47]] },
  { id: 'a-bath-makeup', kind: 'fresh', requires: ['fanBath'], label: 'Make-up air via door louvre',
    pts: [[0.2, 0.9, -0.2], [0.25, 0.85, 0.05], [0.3, 0.95, 0.25], [0.3, 1.3, 0.4]] },
  { id: 'a-ac-supply', kind: 'acCold', requires: ['ac'], label: 'Cold supply air (ceiling duct)',
    pts: [[-0.93, 2.56, 0.0], [-0.4, 2.59, -0.1], [0.2, 2.59, -0.1], [0.25, 2.3, -0.1], [0.25, 1.5, -0.2]] },
  { id: 'a-ac-supply2', kind: 'acCold', requires: ['ac'], label: 'Cold supply → galley',
    pts: [[0.2, 2.59, -0.1], [1.2, 2.59, -0.1], [1.25, 2.2, -0.12], [1.3, 1.6, -0.15]] },
  { id: 'a-ac-supply3', kind: 'acCold', requires: ['ac'], label: 'Cold supply → dinette',
    pts: [[1.2, 2.59, -0.1], [2.2, 2.59, -0.1], [2.3, 2.1, -0.1], [2.5, 1.6, 0.0]] },
  { id: 'a-ac-bed', kind: 'acCold', requires: ['ac'], label: 'Bed louvre (night)',
    pts: [[-0.93, 2.5, 0.25], [-0.95, 2.2, 0.35], [-1.0, 1.85, 0.4]] },
  { id: 'a-ac-return', kind: 'recirc', requires: ['ac'], label: 'Return air through filter',
    pts: [[0.25, 1.4, -0.2], [-0.2, 1.75, -0.1], [-0.7, 2.05, 0.0], [-0.93, 2.45, 0.0], [-0.93, 2.75, 0.0]] },
  { id: 'a-ac-condenser', kind: 'hotOut', requires: ['ac'], label: 'Condenser heat rejected on roof',
    pts: [[-0.96, 2.9, 0.0], [-0.96, 3.0, 0.35], [-0.96, 3.15, 0.75], [-0.96, 3.3, 1.1]] },
  { id: 'a-heat-bath', kind: 'heatWarm', requires: ['heater'], duct: 'd-heat-bath', label: 'Warm air → wet bath',
    pts: [[-0.62, 0.98, 0.75], [-0.55, 1.1, 0.75], [-0.16, 1.1, 0.74], [0.1, 1.2, 0.6], [0.3, 1.6, 0.45]] },
  { id: 'a-heat-bed', kind: 'heatWarm', requires: ['heater'], duct: 'd-heat-bed', label: 'Warm air → bed / aisle',
    pts: [[-0.75, 1.04, 0.45], [-0.7, 1.45, 0.38], [-0.2, 1.45, 0.05], [0.0, 1.35, 0.0], [0.3, 1.6, -0.1], [0.0, 2.0, -0.1], [-0.6, 1.9, 0.1]] },
  { id: 'a-heat-galley', kind: 'heatWarm', requires: ['heater'], duct: 'd-heat-galley', label: 'Warm air → galley toe-kick & cab',
    pts: [[-0.85, 1.04, 0.42], [-0.5, 1.45, -0.3], [-0.14, 1.3, -0.52], [0.0, 0.85, -0.56], [0.6, 0.77, -0.32], [2.0, 0.77, -0.32], [2.45, 0.8, -0.05], [2.8, 1.2, 0.0], [3.5, 1.7, 0.0], [3.9, 2.0, 0.0]] },
  { id: 'a-heat-return', kind: 'recirc', requires: ['heater'], label: 'Return air → garage louvre → heater',
    pts: [[0.5, 1.0, -0.1], [0.0, 0.85, -0.2], [-0.15, 0.85, -0.2], [-0.5, 0.95, 0.3], [-0.62, 0.9, 0.55]] },
  { id: 'a-heater-exhaust', kind: 'exhaust', requires: ['heater'], label: 'Combustion exhaust (sealed) → wall cowl',
    pts: [[-0.62, 1.0, 0.8], [-0.35, 1.18, 0.86], [-0.35, 1.18, 1.04], [-0.37, 1.25, 1.3], [-0.42, 1.5, 1.6]] },
  { id: 'a-battery', kind: 'battery', requires: ['monitor'], label: 'Electrical-bay cooling',
    pts: [[-1.3, 0.8, -0.55], [-1.0, 1.1, -0.6], [-0.6, 1.25, -0.4], [-0.17, 1.35, -0.33], [0.2, 1.5, -0.2]] },
  { id: 'a-defrost', kind: 'heatWarm', requires: ['heater'], label: 'Warm, dry air across the windshield',
    pts: [[3.9, 2.0, 0.0], [4.05, 2.2, -0.4], [4.1, 2.3, 0.4], [3.8, 2.45, 0.0]] },
  { id: 'a-toilet', kind: 'stale', requires: ['toiletFan'], label: 'Toilet vent',
    pts: [[-0.4, 1.25, 0.46], [-0.35, 1.46, 0.62], [-0.1, 1.6, 0.66], [-0.07, 2.6, 0.65], [-0.07, 2.95, 0.65]] },
];
