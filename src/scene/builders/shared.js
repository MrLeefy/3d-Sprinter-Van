// Builders shared by several zones.
import * as THREE from 'three';
import { boxMesh, B, pivotGroup, addWorld } from '../geom.js';

export function overhead(c, { M, rig, reg }) {
  const g = new THREE.Group();
  const b = c.box;
  const inboard = Math.abs(b.z[0]) < Math.abs(b.z[1]) ? b.z[0] : b.z[1];
  const sgn = inboard === b.z[0] ? 1 : -1; // wall side direction
  g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], Math.min(b.z[0], b.z[1]), Math.max(b.z[0], b.z[1])), M.cabinet, 0.008));
  const n = Math.max(1, Math.round((b.x[1] - b.x[0]) / 0.45));
  const w = (b.x[1] - b.x[0]) / n;
  const doors = [];
  for (let i = 0; i < n; i++) {
    const piv = pivotGroup(0, b.y[1] - 0.01, inboard);
    const x0 = b.x[0] + i * w + 0.004, x1 = b.x[0] + (i + 1) * w - 0.004;
    addWorld(piv, boxMesh(B(x0, x1, b.y[0] + 0.004, b.y[1] - 0.01, inboard - sgn * 0.018, inboard - sgn * 0.002), M.cabinetEdge, 0.006));
    addWorld(piv, boxMesh(B((x0 + x1) / 2 - 0.08, (x0 + x1) / 2 + 0.08, b.y[0] + 0.02, b.y[0] + 0.03, inboard - sgn * 0.03, inboard - sgn * 0.018), M.trim, 0.004));
    piv.position.x = 0;
    g.add(piv);
    doors.push(piv);
  }
  // under-cabinet LED strip
  const led = boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, b.y[0] - 0.006, b.y[0], inboard + sgn * 0.02, inboard + sgn * 0.04), M.ledStrip, 0.002, { cast: false });
  g.add(led);
  reg.ledStrips.push(led);
  rig.on('overheads', (v) => doors.forEach((d) => (d.rotation.x = sgn * v * 1.35)));
  return g;
}

