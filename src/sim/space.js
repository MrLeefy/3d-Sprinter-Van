// Interior space utilisation by rasterising component footprints on a 2 cm grid.
import { COMPONENTS } from '../data/components.js';
import { INTERIOR, STANDING_HEIGHT } from '../data/vehicle.js';
import { volume } from './geometry.js';

const STORAGE = {
  'oh-bed-pass': 0.8, 'oh-bed-drv': 0.8, 'garage-bins-front': 0.85, 'garage-bins-rear': 0.85, 'oh-galley-1': 0.8,
  'oh-galley-2': 0.35, 'oh-galley-3': 0.8, 'galley-drawers': 0.7, wardrobe: 0.6, tower: 0.45, 'trash-bins': 0.8, 'cleaning-closet': 0.6,
};

export function spaceReport() {
  const I = INTERIOR;
  const cell = 0.02;
  const nx = Math.round((I.x1 - I.x0) / cell);
  const nz = Math.round((2 * I.wallZ) / cell);
  const floorGrid = new Uint8Array(nx * nz);
  const headGrid = new Uint8Array(nx * nz);
  const solids = COMPONENTS.filter((c) => c.placement === 'interior' && c.solid !== false && !c.parent && !c.mountedIn);
  for (const c of solids) {
    const b = c.box;
    const i0 = Math.max(0, Math.floor((b.x[0] - I.x0) / cell));
    const i1 = Math.min(nx, Math.ceil((b.x[1] - I.x0) / cell));
    const k0 = Math.max(0, Math.floor((b.z[0] + I.wallZ) / cell));
    const k1 = Math.min(nz, Math.ceil((b.z[1] + I.wallZ) / cell));
    const onFloor = b.y[0] < I.floorY + 0.12;
    const blocksHead = b.y[0] < I.floorY + 1.85 && b.y[1] > I.floorY + 0.12;
    for (let i = i0; i < i1; i++) {
      for (let k = k0; k < k1; k++) {
        if (onFloor) floorGrid[i * nz + k] = 1;
        if (blocksHead) headGrid[i * nz + k] = 1;
      }
    }
  }
  const cellA = cell * cell;
  const grossFloor = (I.x1 - I.x0) * 2 * I.wallZ;
  const builtFloor = floorGrid.reduce((s, v) => s + v, 0) * cellA;
  const openFloor = grossFloor - builtFloor;
  const standing = (nx * nz - headGrid.reduce((s, v) => s + v, 0)) * cellA;
  let storageL = 0;
  const storage = [];
  for (const c of COMPONENTS) {
    if (STORAGE[c.id]) {
      const l = volume(c.box) * STORAGE[c.id] * 1000;
      storageL += l;
      storage.push({ id: c.id, name: c.name, litres: l });
    }
  }
  // Garage free volume (beyond bins): approx 25 % of garage envelope remains open for long items
  const garageL = 1.37 * 1.71 * 0.77 * 1000;
  const interiorVol = grossFloor * STANDING_HEIGHT;
  const builtVol = solids.reduce((s, c) => s + volume(c.box), 0);
  return {
    grossFloor, builtFloor, openFloor, standing, standingHeight: STANDING_HEIGHT,
    storageL, storage: storage.sort((a, b) => b.litres - a.litres), garageL,
    interiorVol, builtVol, utilisation: builtVol / interiorVol,
    bed: { retracted: 1.83, deployed: 2.08, width: 1.33 },
    seats: { travel: 2, dining: 2, sleeping: 2 },
  };
}
