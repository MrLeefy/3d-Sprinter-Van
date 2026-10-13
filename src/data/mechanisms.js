// Moving assemblies. Each actuator is a 0‥1 value; `master` keyframes map the master
// transformation slider (0‥1) to that actuator so the whole van can be scrubbed.
// Every actuator can also be overridden individually from the UI.

export const STAGES = [
  { at: 0, name: 'Closed cargo van', desc: 'Travel mode: everything latched, window covers off for driving visibility, no exterior clues.' },
  { at: 0.25, name: 'Doors open — systems revealed', desc: 'Sliding & rear doors open (270° detents), lights on, garage and services exposed.' },
  { at: 0.5, name: 'Living mode', desc: 'Seats swivelled, table out, bed in lounge position, wet bath and kitchen opened.' },
  { at: 0.75, name: 'Sleeping + expansion', desc: 'Bed flat, slide-out pod deployed (2.08 m bed), insulated covers on, step down.' },
  { at: 1, name: 'Full camp', desc: 'Awning, outdoor kitchen, rear-door table & bench deployed — fully configured camp.' },
];

export const ACTUATORS = [
  { id: 'slidingDoor', name: 'Sliding door', group: 'Body', master: [[0.03, 0], [0.16, 1]], seconds: 3 },
  { id: 'rearDoors', name: 'Rear doors (to 270°)', group: 'Body', master: [[0.08, 0], [0.24, 1]], seconds: 4 },
  { id: 'lightsOn', name: 'Interior lights', group: 'Body', master: [[0.17, 0], [0.24, 1]], seconds: 1 },
  { id: 'table', name: 'Swing-arm table', group: 'Living', master: [[0.27, 0], [0.36, 1]], seconds: 3 },
  { id: 'seatSwivel', name: 'Cab seat swivel', group: 'Living', master: [[0.34, 0], [0.46, 1]], seconds: 4,
    interlock: 'Parking brake on; table must be swung to centre first (clears the swept seat circle).' },
  { id: 'bedLounge', name: 'Bed ↔ lounge backrest', group: 'Living', master: [[0.4, 0], [0.48, 1], [0.6, 1], [0.66, 0]], seconds: 3 },
  { id: 'wetbathDoor', name: 'Wet-bath bi-fold door', group: 'Bathroom', master: [[0.42, 0], [0.5, 1], [0.58, 1], [0.64, 0]], seconds: 2 },
  { id: 'sinkCover', name: 'Sink cover / cutting board', group: 'Kitchen', master: [[0.42, 0], [0.5, 1]], seconds: 2 },
  { id: 'bedStep', name: 'Fold-down bed step', group: 'Living', master: [[0.6, 0], [0.66, 1]], seconds: 1 },
  { id: 'covers', name: 'Insulated window covers', group: 'Body', master: [[0.6, 0], [0.7, 1]], seconds: 4 },
  { id: 'slideOut', name: 'Slide-out bed pod', group: 'Expansion', master: [[0.64, 0], [0.76, 1]], seconds: 18,
    interlock: 'Ignition off + parking brake; latches released; pod path clear (≥ 0.30 m from obstacles).' },
  { id: 'awning', name: 'Awning', group: 'Expansion', master: [[0.78, 0], [0.9, 1]], seconds: 40 },
  { id: 'outdoorKitchen', name: 'Outdoor kitchen pull-out', group: 'Expansion', master: [[0.8, 0], [0.92, 1]], seconds: 6,
    requires: { rearDoors: 0.98 }, interlock: 'Rear doors latched at 270°.' },
  { id: 'rearTable', name: 'Rear-door table & bench', group: 'Expansion', master: [[0.9, 0], [0.97, 1]], seconds: 6,
    requires: { rearDoors: 0.98 }, interlock: 'Rear doors latched at 270°.' },
  // Independent (not on the master timeline)
  { id: 'drawers', name: 'Galley drawers', group: 'Kitchen', master: null, seconds: 2 },
  { id: 'fridgeDrawers', name: 'Fridge / freezer drawers', group: 'Kitchen', master: null, seconds: 2 },
  { id: 'microwaveDoor', name: 'Microwave door', group: 'Kitchen', master: null, seconds: 1 },
  { id: 'prepBoard', name: 'Pull-out prep board', group: 'Kitchen', master: null, seconds: 2 },
  { id: 'overheads', name: 'Overhead cabinet doors', group: 'Kitchen', master: null, seconds: 2 },
  { id: 'trashPullout', name: 'Trash & recycling pull-out', group: 'Kitchen', master: null, seconds: 2 },
  { id: 'toilet', name: 'Drawer toilet into shower', group: 'Bathroom', master: null, seconds: 3,
    interlock: 'Hatch opened from inside the wet bath.' },
  { id: 'laundry', name: 'Laundry hamper pull-out', group: 'Living', master: null, seconds: 2 },
  { id: 'deckHatches', name: 'Bed-deck service hatches', group: 'Service', master: null, seconds: 2 },
  { id: 'garageHatch', name: 'Garage front access panel', group: 'Service', master: null, seconds: 2 },
  { id: 'outdoorShower', name: 'Outdoor shower hose', group: 'Expansion', master: null, seconds: 3, requires: { rearDoors: 0.98 } },
];

export const actuatorById = Object.fromEntries(ACTUATORS.map((a) => [a.id, a]));

/** Piecewise-linear evaluation of keyframes [[t, v], ...]. */
export function evalKeys(keys, t) {
  if (!keys) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * smooth(u);
    }
  }
  return keys[keys.length - 1][1];
}

function smooth(u) {
  return u * u * (3 - 2 * u);
}

/** Resolve all actuator values for a master position + manual overrides, applying interlocks. */
export function resolveActuators(master, overrides = {}) {
  const v = {};
  for (const a of ACTUATORS) {
    v[a.id] = overrides[a.id] ?? (a.master ? evalKeys(a.master, master) : 0);
  }
  const blocked = [];
  for (const a of ACTUATORS) {
    if (!a.requires) continue;
    for (const [dep, min] of Object.entries(a.requires)) {
      if (v[dep] < min && v[a.id] > 0) {
        blocked.push({ id: a.id, reason: a.interlock || `Requires ${dep}` });
        v[a.id] = 0;
      }
    }
  }
  return { values: v, blocked };
}

// Hardware markers for Mechanical mode: [x, y, z], type, label, actuator
export const FEATURES = [
  // Sliding door
  { p: [2.1, 2.47, 1.0], type: 'rail', label: 'Upper door track', act: 'slidingDoor' },
  { p: [1.1, 1.55, 1.02], type: 'rail', label: 'Centre track (rear quarter)', act: 'slidingDoor' },
  { p: [2.1, 0.66, 0.98], type: 'rail', label: 'Lower track & roller', act: 'slidingDoor' },
  { p: [1.45, 1.4, 0.98], type: 'latch', label: 'Door striker / child lock', act: 'slidingDoor' },
  // Rear doors
  { p: [-1.62, 2.2, -0.86], type: 'hinge', label: '270° hinge (upper, driver)', act: 'rearDoors' },
  { p: [-1.62, 0.9, -0.86], type: 'hinge', label: '270° hinge (lower, driver)', act: 'rearDoors' },
  { p: [-1.62, 2.2, 0.86], type: 'hinge', label: '270° hinge (upper, passenger)', act: 'rearDoors' },
  { p: [-1.62, 0.9, 0.86], type: 'hinge', label: '270° hinge (lower, passenger)', act: 'rearDoors' },
  { p: [-1.52, 1.76, 0.05], type: 'latch', label: 'Rear-door emergency release (bed level)', act: 'rearDoors' },
  // Slide-out pod
  { p: [-1.2, 1.47, -0.8], type: 'rail', label: 'Telescoping rail (rear)', act: 'slideOut' },
  { p: [-0.5, 1.47, -0.8], type: 'rail', label: 'Telescoping rail (front)', act: 'slideOut' },
  { p: [-1.05, 1.47, -0.7], type: 'actuator', label: '12 V linear actuator 1500 N (rear)', act: 'slideOut' },
  { p: [-0.65, 1.47, -0.7], type: 'actuator', label: '12 V linear actuator 1500 N (front)', act: 'slideOut' },
  { p: [-1.44, 1.82, -0.86], type: 'latch', label: 'Compression latch ×2 (rear)', act: 'slideOut' },
  { p: [-0.26, 1.82, -0.86], type: 'latch', label: 'Compression latch ×2 (front)', act: 'slideOut' },
  { p: [-0.85, 2.16, -0.98], type: 'seal', label: 'Bulb + wiper seal flange, drip rail', act: 'slideOut' },
  { p: [-0.85, 1.5, -1.05], type: 'support', label: 'Fold-down outboard support strut', act: 'slideOut' },
  // Awning
  { p: [0.9, 2.68, 0.99], type: 'hinge', label: 'Roller cassette & lock', act: 'awning' },
  { p: [-0.6, 2.6, 1.1], type: 'support', label: 'Articulating arm + telescoping leg (rear)', act: 'awning' },
  { p: [2.4, 2.6, 1.1], type: 'support', label: 'Articulating arm + telescoping leg (front)', act: 'awning' },
  // Outdoor kitchen
  { p: [-1.3, 0.76, -0.28], type: 'rail', label: 'Locking full-extension slide (227 kg)', act: 'outdoorKitchen' },
  { p: [-1.3, 0.76, 0.34], type: 'rail', label: 'Locking full-extension slide (227 kg)', act: 'outdoorKitchen' },
  { p: [-1.5, 0.95, 0.36], type: 'hinge', label: 'Flip-out side wing hinge + leg', act: 'outdoorKitchen' },
  // Rear door table / bench
  { p: [-1.6, 1.0, -0.5], type: 'hinge', label: 'Table piano hinge + folding brace', act: 'rearTable' },
  { p: [-1.6, 0.75, 0.5], type: 'hinge', label: 'Bench hinge + drop legs', act: 'rearTable' },
  // Galley
  { p: [1.45, 1.2, -0.3], type: 'rail', label: 'Soft-close full-extension runners ×4', act: 'drawers' },
  { p: [0.94, 1.2, -0.3], type: 'rail', label: 'Fridge drawer slides', act: 'fridgeDrawers' },
  { p: [0.94, 1.56, -0.3], type: 'rail', label: 'Prep-board concealed slides', act: 'prepBoard' },
  { p: [0.9, 2.12, -0.42], type: 'actuator', label: 'Gas struts (overhead doors)', act: 'overheads' },
  { p: [1.5, 2.12, -0.42], type: 'latch', label: 'Push-button travel latches', act: 'overheads' },
  { p: [2.1, 1.38, -0.4], type: 'hinge', label: 'Swing-arm table pivot & lock', act: 'table' },
  { p: [1.88, 1.2, -0.28], type: 'rail', label: 'Trash pull-out slide', act: 'trashPullout' },
  // Wet bath / toilet
  { p: [0.05, 1.5, 0.08], type: 'hinge', label: 'Bi-fold door hinges + lip seal', act: 'wetbathDoor' },
  { p: [-0.4, 0.8, 0.3], type: 'rail', label: 'Toilet slide (227 kg rated)', act: 'toilet' },
  { p: [-0.14, 1.0, 0.46], type: 'seal', label: 'Gasketed toilet hatch', act: 'toilet' },
  // Bed
  { p: [-0.8, 1.55, -0.3], type: 'hinge', label: 'Lounge backrest hinge', act: 'bedLounge' },
  { p: [-0.6, 1.6, 0.6], type: 'actuator', label: 'Gas struts ×2 (backrest)', act: 'bedLounge' },
  { p: [-0.15, 1.1, -0.2], type: 'hinge', label: 'Bed-step hinge + catch', act: 'bedStep' },
  { p: [-1.2, 1.52, 0.6], type: 'hinge', label: 'Deck service hatch (heater)', act: 'deckHatches' },
  // Seats
  { p: [3.1, 0.95, -0.43], type: 'actuator', label: 'Swivel base (driver)', act: 'seatSwivel' },
  { p: [3.1, 0.95, 0.43], type: 'actuator', label: 'Swivel base (passenger)', act: 'seatSwivel' },
  // Laundry
  { p: [1.1, 0.8, 0.38], type: 'rail', label: 'Hamper slide', act: 'laundry' },
];
