// Base vehicle definition and the finished interior envelope.
//
// World frame (metres):
//   x  longitudinal, +x towards the front.  x = 0 at the REAR AXLE centreline.
//   y  vertical, y = 0 at ground.
//   z  lateral, +z towards the passenger / curb side (US: sliding-door side).
//
// Every dimension carries a `src` tag:
//   'verified'   – published manufacturer / dealer specification (see docs/ENGINEERING.md)
//   'typical'    – typical published value for this body, confirm on the actual van
//   'assumption' – engineering assumption made for this concept

export const UNITS = { length: 'm', mass: 'kg', power: 'W', energy: 'Wh' };

export const VAN = {
  model: '2025 Mercedes-Benz Sprinter 2500 Cargo Van — High Roof, 170" WB (standard body), RWD, 2.0 L I4 diesel',
  shortName: 'Sprinter 2500 HR 170"',
  wheelbase: { v: 4.325, src: 'verified', note: '170 in' },
  overallLength: { v: 6.967, src: 'verified', note: '274.3 in (dealer data)' },
  bodyWidth: { v: 2.02, src: 'typical', note: 'without mirrors' },
  mirrorWidth: { v: 2.43, src: 'typical', note: 'with mirrors folded out' },
  overallHeight: { v: 2.725, src: 'verified', note: '107.3 in, unladen, without roof equipment' },
  frontOverhang: { v: 0.993, src: 'typical' },
  loadFloorHeight: { v: 0.69, src: 'verified', note: '27.2 in above ground' },
  cargoLength: { v: 4.3, src: 'verified', note: 'L3 load length at floor (4.30–4.41 m quoted)' },
  loadWidth: { v: 1.787, src: 'verified', note: 'max load width' },
  wheelArchGap: { v: 1.35, src: 'verified', note: 'width between wheel arches' },
  interiorHeight: { v: 2.009, src: 'verified', note: '79.1 in high roof' },
  rearOpening: { w: 1.555, h: 1.846, src: 'typical' },
  slidingDoorOpening: { w: 1.3, h: 1.8, src: 'typical' },
  gvwr: { v: 4105, src: 'verified', note: '9,050 lb' },
  gawrFront: { v: 1860, src: 'verified', note: '4,101 lb' },
  gawrRear: { v: 2431, src: 'verified', note: '5,359 lb' },
  // Unladen axle split: one dealer listing gives 2,232 lb front / 3,082 lb rear, which is implausible for an
  // empty front-engine van (appears transposed). A typical ~56 % front split is used — weigh the actual van.
  curbFront: { v: 1350, src: 'typical', note: '≈ 2,976 lb — typical 56 % front split of 5,313 lb curb weight' },
  curbRear: { v: 1060, src: 'typical', note: '≈ 2,337 lb' },
  fuelTank: { v: 92.7, src: 'typical', note: '24.5 US gal' },
  alternator: { v: 250, src: 'assumption', note: 'A — heavy-duty alternator option required for 100 A DC-DC charging' },
  tire: { diameter: 0.79, width: 0.245, src: 'typical', note: '245/75R16 LT' },
  track: { v: 1.72, src: 'typical' },
};

// Derived body stations (x positions)
export const BODY = {
  rearAxleX: 0,
  frontAxleX: VAN.wheelbase.v,
  rearX: -(VAN.overallLength.v - VAN.wheelbase.v - VAN.frontOverhang.v), // ≈ -1.649 (bumper)
  rearDoorOuterX: -1.62,
  cargoRearX: -1.55, // inside face of the rear doors
  cargoFrontX: 2.75, // B-pillar plane (cargo floor length 4.30 m)
  windshieldBaseX: 4.12,
  frontX: VAN.wheelbase.v + VAN.frontOverhang.v, // ≈ 5.318
  halfWidth: VAN.bodyWidth.v / 2,
  roofTopY: VAN.overallHeight.v,
  roofInnerY: VAN.loadFloorHeight.v + VAN.interiorHeight.v, // ≈ 2.699
  highRoofFrontX: 3.55,
};

// Finished interior after insulation and lining (assumption: 25 mm XPS + 12 mm ply + 2 mm
// vinyl floor; Thinsulate in wall/roof cavities with 6–9 mm lining over furring).
export const INTERIOR = {
  floorY: 0.73,
  ceilY: 2.62,
  wallZ: 0.855, // inner face of finished side walls up to the shoulder line
  shoulderY: 1.9, // walls begin to tumble-home above this height
  ceilWallZ: 0.75, // inner wall face at the ceiling
  x0: -1.52, // inside face of rear-door trim
  x1: 2.75,
  // Wheel arches (with insulation covers)
  arch: { x0: -0.5, x1: 0.5, zIn: 0.665, yTop: 1.03 },
  slidingDoor: { x0: 1.42, x1: 2.72, yTop: 0.69 + 1.8 },
  rearDoor: { zHalf: 1.555 / 2, yTop: 0.69 + 1.846 },
};

/** Inner wall half-width at height y (tumble-home above the shoulder line). */
export function wallZAt(y) {
  const I = INTERIOR;
  if (y <= I.shoulderY) return I.wallZ;
  const t = Math.min(1, (y - I.shoulderY) / (I.ceilY - I.shoulderY));
  return I.wallZ - t * (I.wallZ - I.ceilWallZ);
}

export const STANDING_HEIGHT = INTERIOR.ceilY - INTERIOR.floorY; // 1.89 m

/** Seats and cab (simplified OEM geometry, typical values). */
export const CAB = {
  floorY: 0.7,
  seatPivotX: 3.1,
  driverZ: -0.43,
  passengerZ: 0.43,
  cushionY: 1.18,
};
