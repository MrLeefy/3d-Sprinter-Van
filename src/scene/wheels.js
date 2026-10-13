// LT245/75R16 all-terrain tyre on a 16" six-spoke alloy (6 × 130 mm bolt circle), with brake disc
// and caliper behind the spokes. Built with the axle along local +z (outer face toward +z).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const R_RIM = 0.203; // 16 in bead seat
const R_CROWN = 0.378; // carcass under the tread
const R_OUT = 0.395; // tread surface
const W_HALF = 0.122; // half section width at the sidewall bulge

let shared = null;

function letteringTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.font = '700 70px "Barlow Condensed", "Arial Narrow", sans-serif';
  const txt = 'ALL-TERRAIN  ·  LT245/75R16  E  ·  M+S  ·  3PMSF  ·  ';
  // fit a whole number of repeats so the text joins seamlessly around the tyre
  const w = g.measureText(txt).width;
  const n = Math.max(1, Math.floor(c.width / w));
  g.setTransform(c.width / (n * w), 0, 0, 1, 0, 0);
  for (let i = 0; i < n; i++) g.fillText(txt, i * w, 66);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  t.anisotropy = 8;
  return t;
}

/** Flat annulus with polar UVs (u around, v outward) for text that follows the sidewall. */
function polarRing(r0, r1, seg = 160) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r0, s * r0, 0, c * r1, s * r1, 0);
    uv.push(1 - i / seg, 0, 1 - i / seg, 1);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Six-spoke face: a disc with six tapered windows, extruded. */
function spokeFace() {
  const s = new THREE.Shape();
  s.absarc(0, 0, 0.19, 0, Math.PI * 2, false);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const rIn = 0.088, rOut = 0.168;
    const spokeOut = 0.055 / rOut, spokeIn = 0.048 / rIn; // spokes widen toward the hub
    const h = new THREE.Path();
    h.absarc(0, 0, rOut, a0 + spokeOut / 2, a1 - spokeOut / 2, false);
    h.absarc(0, 0, rIn, a1 - spokeIn / 2, a0 + spokeIn / 2, true);
    h.closePath();
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 3, curveSegments: 48 });
  return g;
}

function sharedParts() {
  if (shared) return shared;
  // Tyre carcass profile (radius, axial) from bead to bead
  const prof = [
    [R_RIM + 0.002, -0.104], [0.25, -0.117], [0.3, -W_HALF], [0.345, -0.119], [0.368, -0.11], [R_CROWN - 0.002, -0.098],
    [R_CROWN, -0.07], [R_CROWN + 0.001, 0], [R_CROWN, 0.07], [R_CROWN - 0.002, 0.098], [0.368, 0.11], [0.345, 0.119], [0.3, W_HALF], [0.25, 0.117], [R_RIM + 0.002, 0.104],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const carcass = new THREE.LatheGeometry(prof, 96);
  carcass.rotateX(Math.PI / 2);
  // Tread blocks: four staggered crown rows and two shoulder rows
  const block = new RoundedBoxGeometry(0.048, 0.019, 0.042, 2, 0.005);
  const shoulder = new RoundedBoxGeometry(0.04, 0.016, 0.03, 2, 0.005);
  const rows = [];
  const N = 44;
  for (const [ax, stag, yaw, geo, tilt] of [[-0.074, 0, 0.28, block, 0], [-0.026, 0.5, -0.2, block, 0], [0.026, 0, 0.2, block, 0], [0.074, 0.5, -0.28, block, 0],
    [-0.108, 0.25, 0, shoulder, -0.7], [0.108, 0.75, 0, shoulder, 0.7]]) {
    rows.push({ ax, stag, yaw, geo, tilt, N });
  }
  const barrel = new THREE.LatheGeometry([[0.19, -0.1], [0.212, -0.097], [0.196, -0.088], [0.188, -0.05], [0.188, 0.05], [0.196, 0.082], [0.212, 0.092], [0.2, 0.098]].map(([r, y]) => new THREE.Vector2(r, y)), 64);
  barrel.rotateX(Math.PI / 2);
  shared = {
    carcass, rows, barrel,
    face: spokeFace(),
    lip: new THREE.RingGeometry(0.186, 0.212, 72),
    hub: new THREE.CylinderGeometry(0.062, 0.066, 0.03, 32).rotateX(Math.PI / 2),
    cap: new THREE.SphereGeometry(0.05, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.35),
    nut: new THREE.CylinderGeometry(0.0105, 0.0105, 0.018, 6).rotateX(Math.PI / 2),
    disc: new THREE.CylinderGeometry(0.152, 0.152, 0.026, 48).rotateX(Math.PI / 2),
    hat: new THREE.CylinderGeometry(0.085, 0.085, 0.04, 32).rotateX(Math.PI / 2),
    caliper: new RoundedBoxGeometry(0.12, 0.07, 0.06, 2, 0.012),
    letters: polarRing(0.268, 0.33),
    letterTex: letteringTexture(),
  };
  return shared;
}

/** A complete wheel. `side` = +1 (passenger) or −1 (driver): the driver wheel is turned 180°. */
export function buildWheel(M, side = 1) {
  const S = sharedParts();
  if (!M.tyreLetters.map) {
    M.tyreLetters.map = S.letterTex;
    M.tyreLetters.needsUpdate = true;
  }
  const w = new THREE.Group();
  const add = (geo, mat, setup) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    if (setup) setup(m);
    w.add(m);
    return m;
  };
  add(S.carcass, M.tyre);
  // tread
  const total = S.rows.reduce((n, r) => n + r.N, 0);
  const tread = new THREE.InstancedMesh(S.rows[0].geo, M.tyre, total);
  const shoulders = new THREE.InstancedMesh(S.rows[4].geo, M.tyre, total);
  const o = new THREE.Object3D();
  let a = 0, b = 0;
  for (const r of S.rows) {
    for (let i = 0; i < r.N; i++) {
      const th = ((i + r.stag) / r.N) * Math.PI * 2;
      const rad = r.tilt ? R_CROWN - 0.004 : R_CROWN + 0.008;
      o.position.set(Math.cos(th) * rad, Math.sin(th) * rad, r.ax);
      o.rotation.set(0, 0, th + Math.PI / 2);
      o.rotateY(r.yaw);
      o.rotateX(r.tilt);
      o.updateMatrix();
      if (r.geo === S.rows[0].geo) tread.setMatrixAt(a++, o.matrix);
      else shoulders.setMatrixAt(b++, o.matrix);
    }
  }
  tread.count = a;
  shoulders.count = b;
  for (const m of [tread, shoulders]) {
    m.castShadow = true;
    m.receiveShadow = true;
    w.add(m);
  }
  // raised sidewall lettering (outer face)
  add(S.letters, M.tyreLetters, (m) => (m.position.z = W_HALF + 0.0015));
  // alloy wheel
  add(S.barrel, M.wheelBlack);
  add(S.face, M.wheelBlack, (m) => (m.position.z = 0.052));
  add(S.lip, M.alu, (m) => (m.position.z = 0.0985));
  add(S.hub, M.wheelBlack, (m) => (m.position.z = 0.072));
  add(S.cap, M.chrome, (m) => (m.position.z = 0.087));
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + Math.PI / 6;
    add(S.nut, M.chrome, (m) => m.position.set(Math.cos(t) * 0.065, Math.sin(t) * 0.065, 0.086));
  }
  // brakes (visible through the spokes)
  add(S.disc, M.brakeDisc, (m) => (m.position.z = -0.005));
  add(S.hat, M.aluDark, (m) => (m.position.z = 0.018));
  add(S.caliper, M.caliper, (m) => m.position.set(-0.13, 0.05, 0.018));
  if (side < 0) w.rotation.y = Math.PI;
  return w;
}
