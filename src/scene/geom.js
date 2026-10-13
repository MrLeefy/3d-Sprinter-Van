// Geometry helpers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const rbCache = new Map();

/** Cached rounded box geometry. */
export function rbox(w, h, d, r = 0.008, seg = 2) {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r}|${seg}`;
  if (!rbCache.has(key)) {
    const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    rbCache.set(key, rr > 0.0005 ? new RoundedBoxGeometry(w, h, d, seg, rr) : new THREE.BoxGeometry(w, h, d));
  }
  return rbCache.get(key);
}

/** Mesh spanning an AABB {x:[a,b], y:[a,b], z:[a,b]} (world coords). */
export function boxMesh(b, mat, r = 0.008, { cast = true, receive = true } = {}) {
  const w = b.x[1] - b.x[0], h = b.y[1] - b.y[0], d = b.z[1] - b.z[0];
  const m = new THREE.Mesh(rbox(Math.max(w, 0.002), Math.max(h, 0.002), Math.max(d, 0.002), r), mat);
  m.position.set((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** Box by centre & size. */
export function boxC(cx, cy, cz, w, h, d, mat, r = 0.006) {
  const m = new THREE.Mesh(rbox(w, h, d, r), mat);
  m.position.set(cx, cy, cz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function B(x0, x1, y0, y1, z0, z1) {
  return { x: [x0, x1], y: [y0, y1], z: [z0, z1] };
}

/** Polyline → smooth path with rounded corners (radius r). */
export function roundedPath(points, r = 0.05) {
  const pts = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p)));
  const path = new THREE.CurvePath();
  if (pts.length < 2) return path;
  let prev = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const d1 = b.clone().sub(a), d2 = c.clone().sub(b);
    const l1 = d1.length(), l2 = d2.length();
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = b.clone().sub(d1.normalize().multiplyScalar(rr));
    const p2 = b.clone().add(d2.normalize().multiplyScalar(rr));
    if (prev.distanceTo(p1) > 1e-4) path.add(new THREE.LineCurve3(prev, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
    prev = p2;
  }
  path.add(new THREE.LineCurve3(prev, pts[pts.length - 1].clone()));
  return path;
}

export function tube(points, radius, mat, { corner = 0.06, radial = 8, cast = false } = {}) {
  const path = roundedPath(points, corner);
  const len = path.getLength();
  const segs = Math.max(8, Math.min(220, Math.round(len * 40)));
  const g = new THREE.TubeGeometry(path, segs, radius, radial, false);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = cast;
  m.userData.path = path;
  m.userData.length = len;
  return m;
}

/** Cylinder between two points. */
export function cylBetween(a, b, r, mat, seg = 10) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  m.castShadow = true;
  return m;
}

/** Extruded shape in the XY plane, extruded along +Z by depth. */
export function extrude(shape, depth, mat, bevel = 0.008) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 18 });
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function roundedRectShape(x0, y0, x1, y1, r) {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

export function roundedRectPath(x0, y0, x1, y1, r) {
  const p = new THREE.Path();
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0);
  p.quadraticCurveTo(x1, y0, x1, y0 + r);
  p.lineTo(x1, y1 - r);
  p.quadraticCurveTo(x1, y1, x1 - r, y1);
  p.lineTo(x0 + r, y1);
  p.quadraticCurveTo(x0, y1, x0, y1 - r);
  p.lineTo(x0, y0 + r);
  p.quadraticCurveTo(x0, y0, x0 + r, y0);
  return p;
}

/** Group whose origin is at a pivot point (children positioned in world coords are re-based). */
export function pivotGroup(px, py, pz) {
  const g = new THREE.Group();
  g.position.set(px, py, pz);
  g.userData.pivot = [px, py, pz];
  return g;
}

/** Add a world-positioned mesh into a pivot group (converts to local coords). */
export function addWorld(group, mesh) {
  const p = group.userData.pivot || [0, 0, 0];
  mesh.position.x -= p[0];
  mesh.position.y -= p[1];
  mesh.position.z -= p[2];
  group.add(mesh);
  return mesh;
}

export function label(text, cls = 'lbl') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return el;
}
