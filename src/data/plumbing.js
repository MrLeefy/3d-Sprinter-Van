// Water system: capacities, flows, consumption figures and routed pipework.

export const WATER = {
  freshL: 120,
  freshUsableL: 115,
  boilerL: 10, // Truma Combi integral boiler
  boilerTempC: 60,
  greyL: 95,
  urineL: 6,
  solidsUses: 30,
  pumpLpm: 11.4, // 3.0 GPM free-flow
  showerLpm: 5.7, // 1.5 gpm low-flow head
  faucetLpm: 4.0,
  coldInletC: 12,
  // Daily uses for 2 people (litres), "conservative van-life" profile
  uses: {
    drinkCook: 5.5, // consumed (does not reach grey)
    handWash: 3,
    dishesBreakfast: 6,
    dishesDinner: 8,
    cooking: 3,
    shower: 12, // per person, navy-style (≈ 2 min of running water)
  },
  showerEveryDays: 2,
};

// Pipe kinds: cold, hot, drink, grey, fill, vent, fuel, drain (winterising / low-point)
export const PIPES = [
  { id: 'p-fill', kind: 'fill', from: 'fill-inlet', to: 'fresh-tank', d: 0.038,
    pts: [[-1.53, 1.36, 0.83], [-1.47, 1.45, 0.6], [-1.0, 1.455, 0.3], [-0.7, 1.455, 0.1], [-0.7, 0.99, 0.1]] },
  { id: 'p-tank-pump', kind: 'cold', from: 'fresh-tank', to: 'water-pump', d: 0.019,
    pts: [[-0.74, 0.755, 0.24], [-0.79, 0.755, 0.375], [-1.14, 0.755, 0.375], [-1.3, 0.76, 0.6], [-1.36, 0.8, 0.66]] },
  { id: 'p-pump-acc', kind: 'cold', from: 'water-pump', to: 'accumulator', d: 0.016, pts: [[-1.27, 0.82, 0.72], [-1.2, 0.84, 0.7]] },
  { id: 'p-acc-filter', kind: 'cold', from: 'accumulator', to: 'water-filter', d: 0.016,
    pts: [[-1.2, 0.92, 0.66], [-1.3, 0.92, 0.6], [-1.4, 0.92, 0.52]] },
  { id: 'p-filter-man', kind: 'cold', from: 'water-filter', to: 'water-manifold', d: 0.016, pts: [[-1.38, 0.8, 0.49], [-1.31, 0.78, 0.5]] },
  { id: 'p-man-combi', kind: 'cold', from: 'water-manifold', to: 'combi-heater', d: 0.016,
    pts: [[-1.16, 0.79, 0.54], [-1.13, 0.82, 0.58]] },
  { id: 'p-combi-hot', kind: 'hot', from: 'combi-heater', to: 'water-manifold', d: 0.016,
    pts: [[-1.13, 0.95, 0.5], [-1.18, 0.86, 0.46], [-1.2, 0.8, 0.45]] },
  // Galley run: along the 30 mm gap beside the heater, under the toilet slide, across the
  // front of the tank, then forward inside the tower base and galley toe-kick
  { id: 'p-galley-cold', kind: 'cold', from: 'water-manifold', to: 'sink', d: 0.016,
    pts: [[-1.16, 0.75, 0.44], [-1.14, 0.745, 0.375], [-0.78, 0.745, 0.375], [-0.62, 0.745, 0.3], [-0.165, 0.745, 0.3], [-0.165, 0.745, -0.56], [0.65, 0.745, -0.6], [1.86, 0.76, -0.6], [1.86, 1.62, -0.78]] },
  { id: 'p-galley-hot', kind: 'hot', from: 'water-manifold', to: 'sink', d: 0.016,
    pts: [[-1.16, 0.77, 0.47], [-1.12, 0.765, 0.38], [-0.78, 0.765, 0.38], [-0.62, 0.765, 0.29], [-0.18, 0.765, 0.29], [-0.18, 0.765, -0.58], [0.65, 0.765, -0.62], [1.9, 0.78, -0.62], [1.9, 1.62, -0.78]] },
  { id: 'p-drink', kind: 'drink', from: 'drinking-filter', to: 'sink', d: 0.01,
    pts: [[1.8, 1.15, -0.78], [1.8, 1.4, -0.8], [1.82, 1.63, -0.8]] },
  // Shower: up and over the stowed toilet, through the wet-bath rear wall
  { id: 'p-shower-cold', kind: 'cold', from: 'water-manifold', to: 'shower-fixtures', d: 0.016,
    pts: [[-1.18, 0.8, 0.52], [-1.15, 1.3, 0.52], [-0.16, 1.3, 0.48], [-0.11, 1.3, 0.42]] },
  { id: 'p-shower-hot', kind: 'hot', from: 'water-manifold', to: 'shower-fixtures', d: 0.016,
    pts: [[-1.21, 0.8, 0.55], [-1.18, 1.33, 0.55], [-0.16, 1.33, 0.4], [-0.11, 1.33, 0.38]] },
  { id: 'p-outdoor', kind: 'cold', from: 'water-manifold', to: 'outdoor-shower', d: 0.016,
    pts: [[-1.3, 0.8, 0.56], [-1.3, 0.95, 0.6], [-1.5, 1.0, 0.8], [-1.53, 1.16, 0.83]] },
  { id: 'p-outdoor-hot', kind: 'hot', from: 'water-manifold', to: 'outdoor-shower', d: 0.016,
    pts: [[-1.27, 0.8, 0.46], [-1.27, 0.97, 0.58], [-1.48, 1.02, 0.79], [-1.53, 1.14, 0.83]] },
  // Drains (gravity, ≥ 2 % fall)
  { id: 'p-sink-drain', kind: 'grey', from: 'sink', to: 'grey-tank', d: 0.038,
    pts: [[1.89, 1.41, -0.52], [1.89, 0.95, -0.52], [1.89, 0.66, -0.45], [1.45, 0.64, 0.1], [1.25, 0.61, 0.32]] },
  { id: 'p-shower-drain', kind: 'grey', from: 'shower-pan', to: 'grey-tank', d: 0.038,
    pts: [[0.3, 0.78, 0.48], [0.3, 0.66, 0.48], [0.75, 0.62, 0.48], [0.85, 0.61, 0.48]] },
  { id: 'p-grey-vent', kind: 'vent', from: 'grey-tank', to: 'grey-tank', d: 0.025, pts: [[1.45, 0.6, 0.7], [1.5, 0.64, 0.85], [1.5, 0.6, 0.98]] },
  { id: 'p-grey-dump', kind: 'grey', from: 'grey-tank', to: 'grey-dump', d: 0.038, pts: [[1.5, 0.42, 0.6], [1.6, 0.42, 0.6]] },
  // Winterising / low-point drains
  { id: 'p-frost-dump', kind: 'drain', from: 'combi-heater', to: 'combi-heater', d: 0.012, pts: [[-0.9, 0.74, 0.62], [-0.9, 0.6, 0.62]] },
  { id: 'p-tank-drain', kind: 'drain', from: 'fresh-tank', to: 'fresh-tank', d: 0.016, pts: [[-0.4, 0.735, -0.1], [-0.4, 0.6, -0.1]] },
  // Toilet vent (flexible hose with service loop for the drawer travel)
  { id: 'p-toilet-vent', kind: 'vent', from: 'toilet', to: 'toilet-vent', d: 0.038,
    pts: [[-0.55, 1.25, 0.46], [-0.6, 1.4, 0.5], [-0.35, 1.46, 0.62], [-0.14, 1.46, 0.66], [-0.1, 1.6, 0.66], [-0.07, 2.6, 0.65]] },
  // Diesel to the heater from the OEM tank standpipe
  { id: 'p-fuel', kind: 'fuel', from: 'fuel-tank', to: 'combi-heater', d: 0.008,
    pts: [[1.05, 0.58, -0.55], [0.6, 0.55, -0.4], [0.17, 0.49, -0.28], [-0.5, 0.55, 0.2], [-0.8, 0.6, 0.5], [-0.9, 0.62, 0.62], [-0.9, 0.74, 0.62]] },
];

// Cold-weather protection map (used by freeze checks and the thermal overlay)
export const FREEZE_PROTECTION = [
  { id: 'fresh-tank', method: 'Inside heated envelope (garage shares cabin air via return louvre)' },
  { id: 'water-pump', method: 'Inside heated envelope' },
  { id: 'combi-heater', method: 'FrostControl valve auto-dumps the boiler below 3 °C if unpowered' },
  { id: 'grey-tank', method: '25 mm jacket + 60 W thermostatic pad + heated dump valve (≈ -25 °C limit)', minC: -25 },
  { id: 'p-sink-drain', method: 'Under-floor run insulated, waterless traps hold no water', minC: -25 },
  { id: 'p-shower-drain', method: 'Insulated under-floor run, waterless trap', minC: -25 },
  { id: 'fill-inlet', method: 'Self-draining gravity fill above tank', minC: -40 },
  { id: 'outdoor-shower', method: 'Isolation valve inside the heated garage; jamb fitting drains down when closed', minC: -40 },
];
