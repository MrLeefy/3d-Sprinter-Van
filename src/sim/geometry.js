// Axis-aligned box utilities shared by the acceptance tests and the scene.
import { INTERIOR, wallZAt } from '../data/vehicle.js';

export const EPS = 0.002; // 2 mm tolerance: touching faces are not a clash

export function overlap1(a, b, eps = EPS) {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > eps;
}

export function boxesOverlap(a, b, eps = EPS) {
  return overlap1(a.x, b.x, eps) && overlap1(a.y, b.y, eps) && overlap1(a.z, b.z, eps);
}

export function overlapVolume(a, b) {
  const d = (p, q) => Math.max(0, Math.min(p[1], q[1]) - Math.max(p[0], q[0]));
  return d(a.x, b.x) * d(a.y, b.y) * d(a.z, b.z);
}

export function translate(b, dx = 0, dy = 0, dz = 0) {
  return { x: [b.x[0] + dx, b.x[1] + dx], y: [b.y[0] + dy, b.y[1] + dy], z: [b.z[0] + dz, b.z[1] + dz] };
}

export function volume(b) {
  return (b.x[1] - b.x[0]) * (b.y[1] - b.y[0]) * (b.z[1] - b.z[0]);
}

export function contains(outer, inner, eps = EPS) {
  return ['x', 'y', 'z'].every((k) => inner[k][0] >= outer[k][0] - eps && inner[k][1] <= outer[k][1] + eps);
}

export function pointInBox(p, b, pad = 0) {
  return p[0] >= b.x[0] - pad && p[0] <= b.x[1] + pad && p[1] >= b.y[0] - pad && p[1] <= b.y[1] + pad && p[2] >= b.z[0] - pad && p[2] <= b.z[1] + pad;
}

export function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function center(b) {
  return [(b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2];
}

/** Distance from point to box (0 if inside). */
export function pointBoxDist(p, b) {
  const dx = Math.max(b.x[0] - p[0], 0, p[0] - b.x[1]);
  const dy = Math.max(b.y[0] - p[1], 0, p[1] - b.y[1]);
  const dz = Math.max(b.z[0] - p[2], 0, p[2] - b.z[1]);
  return Math.hypot(dx, dy, dz);
}

/** Wheel-arch obstacle boxes (driver & passenger). */
export function archBoxes() {
  const a = INTERIOR.arch;
  return [
    { x: [a.x0, a.x1], y: [0.69, a.yTop], z: [-0.9, -a.zIn] },
    { x: [a.x0, a.x1], y: [0.69, a.yTop], z: [a.zIn, 0.9] },
  ];
}

/** Does an interior box fit inside the finished envelope (walls, floor, ceiling, taper)? */
export function insideEnvelope(c) {
  const b = c.box;
  const I = INTERIOR;
  const issues = [];
  if (b.y[0] < I.floorY - EPS) issues.push(`below floor by ${((I.floorY - b.y[0]) * 1000).toFixed(0)} mm`);
  if (b.y[1] > I.ceilY + EPS) issues.push(`above ceiling by ${((b.y[1] - I.ceilY) * 1000).toFixed(0)} mm`);
  if (b.x[0] < I.x0 - EPS) issues.push(`behind rear-door trim by ${((I.x0 - b.x[0]) * 1000).toFixed(0)} mm`);
  if (b.x[1] > I.x1 + EPS) issues.push(`forward of B-pillar by ${((b.x[1] - I.x1) * 1000).toFixed(0)} mm`);
  const yTest = c.followsWall ? Math.min(b.y[1], I.shoulderY) : b.y[1];
  const lim = wallZAt(yTest);
  const zMax = Math.max(Math.abs(b.z[0]), Math.abs(b.z[1]));
  if (zMax > lim + EPS) issues.push(`through side wall by ${((zMax - lim) * 1000).toFixed(0)} mm at y=${yTest.toFixed(2)}`);
  return issues;
}
