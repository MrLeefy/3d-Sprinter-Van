// Procedural Sprinter 170" high-roof body: shell panels, glazing, doors, wheels,
// lights, bumpers, roof rack, interior linings and insulation layers.
import * as THREE from 'three';
import { boxMesh, boxC, B, extrude, roundedRectPath, cylBetween, pivotGroup, addWorld } from './geom.js';
import { INTERIOR } from '../data/vehicle.js';

const ZO = 1.01; // outer half-width
const WALL_T = 0.022;

function sideShape() {
  const s = new THREE.Shape();
  const yb = 0.55;
  s.moveTo(-1.62, yb);
  const arch = (cx) => {
    const r = 0.47, cy = 0.395;
    const a0 = Math.atan2(yb - cy, -Math.sqrt(r * r - (yb - cy) ** 2));
    const a1 = Math.atan2(yb - cy, Math.sqrt(r * r - (yb - cy) ** 2));
    s.lineTo(cx + r * Math.cos(a0), yb);
    s.absarc(cx, cy, r, a0, a1, true);
  };
  arch(0);
  arch(4.325);
  s.lineTo(5.2, yb);
  s.lineTo(5.24, 0.96);
  s.quadraticCurveTo(5.05, 1.08, 4.47, 1.24);
  s.lineTo(3.88, 2.28);
  s.quadraticCurveTo(3.7, 2.48, 3.4, 2.5);
  s.lineTo(-1.62, 2.5);
  s.lineTo(-1.62, yb);
  return s;
}

function cabWindowPath() {
  const p = new THREE.Path();
  p.moveTo(2.98, 1.42);
  p.lineTo(4.28, 1.42);
  p.lineTo(3.86, 2.16);
  p.lineTo(3.02, 2.16);
  p.lineTo(2.98, 1.42);
  return p;
}

function roofSection(outer = true) {
  // Cross-section in (X = -z, Y = y) for extrusion along world +x
  const s = new THREE.Shape();
  s.moveTo(-ZO, 2.49);
  s.quadraticCurveTo(-ZO, 2.71, -0.78, 2.712);
  s.quadraticCurveTo(0, 2.745, 0.78, 2.712);
  s.quadraticCurveTo(ZO, 2.71, ZO, 2.49);
  s.lineTo(ZO - 0.03, 2.49);
  s.quadraticCurveTo(ZO - 0.03, 2.685, 0.77, 2.685);
  s.quadraticCurveTo(0, 2.715, -0.77, 2.685);
  s.quadraticCurveTo(-ZO + 0.03, 2.685, -ZO + 0.03, 2.49);
  s.lineTo(-ZO, 2.49);
  return s;
}

export function buildBody(M) {
  const root = new THREE.Group();
  root.name = 'body';
  const shell = []; // painted exterior (x-ray target)
  const glass = [];
  const linings = [];
  const insulation = [];
  const parts = {};
  const tag = (m, cid = 'van-body', kind = 'body') => {
    m.userData.cid = cid;
    m.userData.kind = kind;
    return m;
  };

  // ── Side walls ─────────────────────────────────────────────
  for (const side of [-1, 1]) {
    const shape = sideShape();
    shape.holes.push(cabWindowPath());
    if (side > 0) shape.holes.push(roundedRectPath(INTERIOR.slidingDoor.x0, 0.6, INTERIOR.slidingDoor.x1, INTERIOR.slidingDoor.yTop, 0.06));
    else shape.holes.push(roundedRectPath(-1.45, 1.5, -0.25, 2.15, 0.035));
    const wall = extrude(shape, WALL_T, M.paint, 0.006);
    wall.position.z = side > 0 ? ZO - WALL_T - 0.006 : -ZO + 0.006;
    root.add(tag(wall));
    shell.push(wall);
    // character line & black rub strip
    const crease = boxMesh(B(-1.6, 3.9, 1.3, 1.318, side * ZO - 0.004, side * ZO + 0.006), M.paint, 0.003);
    crease.position.z = side * (ZO + 0.001);
    root.add(tag(crease));
    shell.push(crease);
    for (const [x0, x1] of [[-1.58, -0.5], [0.5, side > 0 ? 1.38 : 3.82]]) {
      const rub = boxMesh(B(x0, x1, 0.6, 0.72, -0.012, 0.012), M.trim, 0.006);
      rub.position.z = side * (ZO + 0.006);
      root.add(tag(rub));
    }
    // cab window glass
    const cg = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(cabWindowPath().getPoints())), M.glass);
    cg.position.z = side * (ZO - 0.012);
    root.add(tag(cg, 'window-covers', 'glass'));
    glass.push(cg);
    // door seams
    for (const [x, y0, y1] of [[2.82, 0.6, 2.42], [4.36, 0.62, 1.32]]) {
      const seam = boxMesh(B(x - 0.003, x + 0.003, y0, y1, -0.004, 0.004), M.trim, 0.001);
      seam.position.z = side * (ZO + 0.002);
      root.add(tag(seam));
    }
    // door handle (cab)
    const h = boxMesh(B(2.95, 3.12, 1.3, 1.34, -0.015, 0.015), M.trim, 0.008);
    h.position.z = side * (ZO + 0.01);
    root.add(tag(h));
    // side marker
    const mk = boxMesh(B(1.0, 1.06, 0.78, 0.81, -0.006, 0.006), M.amber, 0.004);
    mk.position.z = side * (ZO + 0.004);
    root.add(tag(mk));
    // mirrors
    const arm = cylBetween([4.2, 1.42, side * 0.99], [4.12, 1.52, side * 1.16], 0.018, M.trim);
    root.add(tag(arm));
    const mir = boxC(4.1, 1.62, side * 1.19, 0.1, 0.36, 0.2, M.trim, 0.03);
    root.add(tag(mir));
    const mirGlass = boxC(4.045, 1.62, side * 1.19, 0.01, 0.3, 0.16, M.chrome, 0.004);
    root.add(tag(mirGlass));
  }
  // fuel flap (driver, front)
  const flap = boxMesh(B(3.55, 3.72, 0.92, 1.05, -ZO - 0.004, -ZO + 0.004), M.paint, 0.01);
  root.add(tag(flap));

  // ── Roof (high roof) ───────────────────────────────────────
  const roofG = new THREE.ExtrudeGeometry(roofSection(), { depth: 3.4 + 1.62, bevelEnabled: false, curveSegments: 24 });
  const roof = new THREE.Mesh(roofG, M.paint);
  roof.rotation.y = Math.PI / 2;
  roof.position.x = -1.62;
  roof.castShadow = roof.receiveShadow = true;
  root.add(tag(roof));
  shell.push(roof);
  // Roof front cap sloping to the windshield header
  const cap = new THREE.Shape();
  cap.moveTo(3.48, 2.4);
  cap.lineTo(3.48, 2.6);
  cap.quadraticCurveTo(3.7, 2.6, 3.78, 2.4);
  cap.lineTo(3.48, 2.4);
  const capM = new THREE.Mesh(new THREE.ExtrudeGeometry(cap, { depth: 2.02 - 0.24, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 5, curveSegments: 16 }), M.paint);
  capM.position.z = -(2.02 - 0.24) / 2;
  capM.castShadow = true;
  root.add(tag(capM));
  shell.push(capM);
  // roof ribs (subtle)
  for (let x = -1.3; x < 3.3; x += 0.42) {
    const rib = boxMesh(B(x, x + 0.05, 2.72, 2.738, -0.6, 0.6), M.paint, 0.01);
    root.add(tag(rib));
  }

  // ── Nose: hood, fascia, grille, lights, bumper ─────────────
  const nose = new THREE.Shape();
  nose.moveTo(4.42, 0.62);
  nose.lineTo(5.18, 0.62);
  nose.lineTo(5.2, 0.96);
  nose.quadraticCurveTo(5.0, 1.05, 4.5, 1.18);
  nose.lineTo(4.42, 0.62);
  const noseM = new THREE.Mesh(new THREE.ExtrudeGeometry(nose, { depth: 1.98 - 0.14, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 4 }), M.paint);
  noseM.position.z = -(1.98 - 0.14) / 2;
  noseM.castShadow = true;
  root.add(tag(noseM));
  shell.push(noseM);
  const grille = boxMesh(B(5.22, 5.27, 0.7, 0.98, -0.52, 0.52), M.trimGloss, 0.03);
  root.add(tag(grille));
  for (const y of [0.76, 0.84, 0.92]) root.add(tag(boxMesh(B(5.255, 5.28, y, y + 0.018, -0.5, 0.5), M.chrome, 0.006)));
  for (const s of [-1, 1]) {
    const hl = boxMesh(B(5.08, 5.26, 0.9, 1.03, s > 0 ? 0.56 : -0.96, s > 0 ? 0.96 : -0.56), M.headlight, 0.03);
    hl.rotation.z = -0.12;
    root.add(tag(hl));
    const drl = boxMesh(B(5.2, 5.265, 0.905, 0.92, s > 0 ? 0.6 : -0.92, s > 0 ? 0.92 : -0.6), M.lightOn, 0.004);
    root.add(tag(drl));
    parts['drl' + s] = drl;
  }
  const bumper = boxMesh(B(5.12, 5.34, 0.4, 0.69, -1.0, 1.0), M.trim, 0.06);
  root.add(tag(bumper));
  root.add(tag(boxMesh(B(5.3, 5.345, 0.44, 0.58, -0.45, 0.45), M.trimGloss, 0.02)));
  // windshield
  const ws = new THREE.BufferGeometry();
  const wv = [4.47, 1.25, -0.93, 4.47, 1.25, 0.93, 3.89, 2.27, 0.9, 3.89, 2.27, -0.9];
  ws.setAttribute('position', new THREE.Float32BufferAttribute(wv, 3));
  ws.setIndex([0, 1, 2, 0, 2, 3]);
  ws.computeVertexNormals();
  const wsm = new THREE.Mesh(ws, M.glass);
  wsm.material = M.glass;
  root.add(tag(wsm, 'window-covers', 'glass'));
  glass.push(wsm);
  for (const s of [-1, 1]) root.add(tag(cylBetween([4.46, 1.27, s * 0.05], [4.3, 1.5, s * 0.75], 0.008, M.trim)));
  // A-pillars
  for (const s of [-1, 1]) root.add(tag(cylBetween([4.48, 1.24, s * 0.96], [3.88, 2.29, s * 0.94], 0.045, M.paint)));
  // dashboard (visible through glass)
  const dash = boxMesh(B(3.9, 4.45, 1.0, 1.32, -0.95, 0.95), M.trim, 0.06);
  root.add(tag(dash));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.02, 10, 32), M.trim);
  wheel.position.set(3.72, 1.42, -0.43);
  wheel.rotation.y = Math.PI / 2;
  wheel.rotation.x = 0.45;
  root.add(tag(wheel));
  root.add(tag(boxMesh(B(3.15, 3.9, 0.7, 0.98, -0.12, 0.12), M.trim, 0.04))); // centre console

  // ── Rear: pillars, lights, bumper, doors ────────────────────
  for (const s of [-1, 1]) {
    const p = boxMesh(B(-1.645, -1.6, 0.55, 2.52, s > 0 ? 0.84 : -ZO, s > 0 ? ZO : -0.84), M.paint, 0.02);
    root.add(tag(p));
    shell.push(p);
    const tl = boxMesh(B(-1.655, -1.635, 0.78, 1.62, s > 0 ? 0.88 : -0.995, s > 0 ? 0.995 : -0.88), M.tail, 0.015);
    root.add(tag(tl));
    parts['tail' + s] = tl;
  }
  const header = boxMesh(B(-1.645, -1.6, 2.5, 2.6, -ZO, ZO), M.paint, 0.02);
  root.add(tag(header));
  shell.push(header);
  root.add(tag(boxMesh(B(-1.7, -1.56, 0.38, 0.62, -1.0, 1.0), M.trim, 0.04)));
  root.add(tag(boxMesh(B(-1.72, -1.68, 0.55, 0.6, -0.35, 0.35), M.alu, 0.01))); // step plate

  const doorShape = () => {
    const s = new THREE.Shape();
    s.moveTo(0.19, 0.62);
    s.lineTo(1.03, 0.62);
    s.lineTo(1.03, 2.52);
    s.lineTo(0.19, 2.52);
    s.lineTo(0.19, 0.62);
    s.holes.push(roundedRectPath(0.3, 1.8, 0.95, 2.34, 0.04));
    return s;
  };
  for (const s of [-1, 1]) {
    // pivot outboard of the corner (offset 270° hinge)
    const g = new THREE.Group();
    g.position.set(-1.62, 0, s * 1.03);
    const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(doorShape(), { depth: 0.035, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }), M.paint);
    panel.castShadow = true;
    // shape X → lateral offset from pivot (towards centreline); extrude → rearward
    if (s < 0) {
      panel.rotation.y = -Math.PI / 2; // local x → +z, local z → -x
    } else {
      panel.rotation.y = Math.PI / 2; // local x → -z, local z → +x
      panel.position.x = -0.035;
    }
    tag(panel, 'rear-doors');
    g.add(panel);
    shell.push(panel);
    const gl = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(roundedRectPath(0.3, 1.8, 0.95, 2.34, 0.04).getPoints())), M.glass);
    gl.rotation.y = panel.rotation.y;
    gl.position.x = s < 0 ? -0.018 : -0.017;
    tag(gl, 'window-covers', 'glass');
    g.add(gl);
    glass.push(gl);
    // inner door card (lining)
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.0, 0.7), M.felt);
    card.position.set(0.012, 1.25, -s * 0.6);
    tag(card, 'rear-doors', 'lining');
    g.add(card);
    linings.push(card);
    // hinges
    for (const y of [0.9, 2.2]) {
      const hg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.22), M.trim);
      hg.position.set(-0.02, y, -s * 0.1);
      tag(hg, 'rear-doors');
      g.add(hg);
    }
    // handle
    if (s > 0) {
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.2), M.trim);
      hd.position.set(-0.04, 1.3, -0.9);
      g.add(tag(hd, 'rear-doors'));
    }
    root.add(g);
    parts[s < 0 ? 'rearDoorDrv' : 'rearDoorPass'] = g;
  }
  // Ladder on the driver door (tradesman look)
  {
    const g = parts.rearDoorDrv;
    for (const dz of [0.32, 0.72]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.1, 0.03), M.alu);
      rail.position.set(-0.09, 1.65, dz);
      g.add(tag(rail, 'rear-doors'));
    }
    for (let y = 0.85; y < 2.7; y += 0.28) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8), M.alu);
      rung.rotation.x = Math.PI / 2;
      rung.position.set(-0.09, y, 0.52);
      g.add(tag(rung, 'rear-doors'));
    }
  }

  // ── Sliding door ───────────────────────────────────────────
  {
    const sd = INTERIOR.slidingDoor;
    const g = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(sd.x0 + 0.01, 0.61);
    s.lineTo(sd.x1 - 0.01, 0.61);
    s.lineTo(sd.x1 - 0.01, sd.yTop - 0.01);
    s.lineTo(sd.x0 + 0.01, sd.yTop - 0.01);
    s.lineTo(sd.x0 + 0.01, 0.61);
    const win = roundedRectPath(sd.x0 + 0.12, 1.55, sd.x1 - 0.32, 2.22, 0.05);
    s.holes.push(win);
    const panel = extrude(s, 0.02, M.paint, 0.005);
    panel.position.z = ZO - 0.022;
    g.add(tag(panel, 'sliding-door'));
    shell.push(panel);
    const gl = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(win.getPoints())), M.glass);
    gl.position.z = ZO - 0.01;
    g.add(tag(gl, 'window-covers', 'glass'));
    glass.push(gl);
    const handle = boxMesh(B(sd.x1 - 0.2, sd.x1 - 0.05, 1.3, 1.34, ZO, ZO + 0.03), M.trim, 0.008);
    g.add(tag(handle, 'sliding-door'));
    const card = boxMesh(B(sd.x0 + 0.05, sd.x1 - 0.05, 0.7, 1.5, ZO - 0.04, ZO - 0.025), M.felt, 0.004);
    g.add(tag(card, 'sliding-door', 'lining'));
    linings.push(card);
    root.add(g);
    parts.slidingDoor = g;
    // track
    root.add(tag(boxMesh(B(0.1, 1.42, 1.5, 1.53, ZO, ZO + 0.012), M.trim, 0.004)));
  }

  // ── Wheels ─────────────────────────────────────────────────
  const prof = [[0.205, -0.11], [0.3, -0.122], [0.36, -0.12], [0.385, -0.1], [0.395, -0.05], [0.395, 0.05], [0.385, 0.1], [0.36, 0.12], [0.3, 0.122], [0.205, 0.11]];
  const tireG = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48);
  const rimG = new THREE.CylinderGeometry(0.2, 0.2, 0.2, 32);
  const capG = new THREE.CylinderGeometry(0.075, 0.075, 0.03, 20);
  const spokeG = new THREE.BoxGeometry(0.03, 0.012, 0.16);
  for (const x of [0, 4.325]) {
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(x, 0.395, s * 0.865);
      const t = new THREE.Mesh(tireG, M.tire);
      t.rotation.x = Math.PI / 2;
      t.castShadow = true;
      w.add(t);
      const rim = new THREE.Mesh(rimG, M.trim);
      rim.rotation.x = Math.PI / 2;
      w.add(rim);
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.195, 0.01, 32), M.rim);
      face.rotation.x = Math.PI / 2;
      face.position.z = s * 0.1;
      w.add(face);
      for (let i = 0; i < 6; i++) {
        const sp = new THREE.Mesh(spokeG, M.trim);
        sp.position.z = s * 0.106;
        sp.rotation.z = (i * Math.PI) / 3;
        sp.position.x = Math.cos((i * Math.PI) / 3 + Math.PI / 2) * 0.11;
        sp.position.y = Math.sin((i * Math.PI) / 3 + Math.PI / 2) * 0.11;
        w.add(sp);
      }
      const c = new THREE.Mesh(capG, M.chrome);
      c.rotation.x = Math.PI / 2;
      c.position.z = s * 0.112;
      w.add(c);
      w.traverse((m) => tag(m, 'van-body', 'wheel'));
      root.add(w);
      // arch liner
      const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.3, 32, 1, true, -Math.PI / 2 - 1.25, 2.5), M.underbody);
      liner.rotation.x = Math.PI / 2;
      liner.position.set(x, 0.395, s * 0.84);
      root.add(tag(liner));
    }
  }

  // ── Underbody & chassis ────────────────────────────────────
  root.add(tag(boxMesh(B(-1.6, 5.2, 0.52, 0.56, -0.98, 0.98), M.underbody, 0.01), 'van-body', 'chassis'));
  for (const s of [-1, 1]) root.add(tag(boxMesh(B(-1.5, 4.9, 0.36, 0.5, s * 0.48 - 0.04, s * 0.48 + 0.04), M.underbody, 0.01), 'van-body', 'chassis'));
  root.add(tag(cylBetween([0, 0.395, -0.75], [0, 0.395, 0.75], 0.06, M.underbody), 'van-body', 'chassis'));
  root.add(tag(boxC(0, 0.37, 0, 0.3, 0.24, 0.3, M.underbody, 0.06), 'van-body', 'chassis'));
  root.add(tag(cylBetween([0.1, 0.42, 0], [4.0, 0.45, 0], 0.035, M.alu), 'van-body', 'chassis')); // driveshaft
  root.add(tag(cylBetween([-1.1, 0.38, -0.3], [3.8, 0.4, -0.25], 0.03, M.aluDark), 'van-body', 'chassis')); // exhaust
  // spare wheel under the rear
  const spare = new THREE.Mesh(tireG, M.tire);
  spare.position.set(-1.05, 0.42, 0);
  root.add(tag(spare, 'van-body', 'chassis'));

  // ── Interior linings (floor, walls, ceiling) ───────────────
  const I = INTERIOR;
  const floor = boxMesh(B(-1.55, 2.78, 0.69, I.floorY, -0.89, 0.89), M.floor, 0.004);
  root.add(tag(floor, 'insulation', 'lining'));
  linings.push(floor);
  const cabFloor = boxMesh(B(2.78, 4.0, 0.64, 0.7, -0.95, 0.95), M.rubber, 0.004);
  root.add(tag(cabFloor, 'van-body', 'lining'));
  for (const s of [-1, 1]) {
    const ws = new THREE.Shape();
    ws.moveTo(I.x0, I.floorY);
    ws.lineTo(I.x1, I.floorY);
    ws.lineTo(I.x1, I.shoulderY);
    ws.lineTo(I.x0, I.shoulderY);
    ws.lineTo(I.x0, I.floorY);
    if (s > 0) ws.holes.push(roundedRectPath(I.slidingDoor.x0, I.floorY + 0.001, I.slidingDoor.x1, I.shoulderY - 0.001, 0.0));
    else ws.holes.push(roundedRectPath(-1.45, 1.5, -0.25, I.shoulderY - 0.001, 0.0));
    const lw = new THREE.Mesh(new THREE.ExtrudeGeometry(ws, { depth: 0.012, bevelEnabled: false }), M.felt);
    lw.position.z = s > 0 ? I.wallZ : -I.wallZ - 0.012;
    lw.receiveShadow = true;
    root.add(tag(lw, 'insulation', 'lining'));
    linings.push(lw);
    // upper tumble-home panel
    const up = new THREE.Mesh(new THREE.PlaneGeometry(I.x1 - I.x0, Math.hypot(I.ceilY - I.shoulderY, I.wallZ - I.ceilWallZ)), M.felt);
    up.position.set((I.x0 + I.x1) / 2, (I.shoulderY + I.ceilY) / 2, s * (I.wallZ + I.ceilWallZ) / 2);
    up.rotation.y = s > 0 ? Math.PI : 0;
    up.rotation.x = s * -Math.atan2(I.wallZ - I.ceilWallZ, I.ceilY - I.shoulderY) * (s > 0 ? -1 : 1);
    up.material = M.felt;
    up.material.side = THREE.DoubleSide;
    root.add(tag(up, 'insulation', 'lining'));
    linings.push(up);
    // insulation fill between skin and lining
    const ins = boxMesh(B(-1.55, 2.75, 0.72, 2.48, s > 0 ? I.wallZ + 0.015 : -ZO + 0.03, s > 0 ? ZO - 0.03 : -I.wallZ - 0.015), M.insulation, 0.01, { cast: false });
    ins.visible = false;
    root.add(tag(ins, 'insulation', 'insulation'));
    insulation.push(ins);
  }
  const ceil = boxMesh(B(I.x0, I.x1, I.ceilY, I.ceilY + 0.02, -I.ceilWallZ, I.ceilWallZ), M.ceiling, 0.004);
  root.add(tag(ceil, 'insulation', 'lining'));
  linings.push(ceil);
  const roofIns = boxMesh(B(-1.55, 2.75, I.ceilY + 0.02, 2.68, -0.8, 0.8), M.insulation, 0.01, { cast: false });
  roofIns.visible = false;
  root.add(tag(roofIns, 'insulation', 'insulation'));
  insulation.push(roofIns);
  const floorIns = boxMesh(B(-1.55, 2.75, 0.69, 0.715, -0.88, 0.88), M.xps, 0.002, { cast: false });
  floorIns.visible = false;
  root.add(tag(floorIns, 'insulation', 'insulation'));
  insulation.push(floorIns);
  // wheel-arch covers inside
  for (const s of [-1, 1]) {
    const a = boxMesh(B(I.arch.x0, I.arch.x1, I.floorY, I.arch.yTop, s > 0 ? I.arch.zIn : -I.wallZ, s > 0 ? I.wallZ : -I.arch.zIn), M.felt, 0.05);
    root.add(tag(a, 'insulation', 'lining'));
    linings.push(a);
  }

  // ── Roof rack & fairing ────────────────────────────────────
  const rack = new THREE.Group();
  for (const s of [-1, 1]) {
    rack.add(boxMesh(B(-1.47, 2.66, 2.86, 2.9, s * 0.72 - 0.02, s * 0.72 + 0.02), M.alu, 0.01));
    for (let x = -1.4; x <= 2.6; x += 0.62) rack.add(cylBetween([x, 2.735, s * 0.72], [x, 2.87, s * 0.72], 0.012, M.alu));
  }
  for (const x of [-1.46, -0.5, 0.02, 0.56, 1.1, 1.6, 2.12, 2.6]) rack.add(boxMesh(B(x, x + 0.035, 2.885, 2.92, -0.74, 0.74), M.alu, 0.006));
  const fair = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 1.6), M.alu);
  fair.position.set(2.75, 2.83, 0);
  fair.rotation.z = 0.7;
  rack.add(fair);
  rack.traverse((m) => {
    tag(m, 'roof-rack', 'rack');
    if (m.isMesh) m.castShadow = true;
  });
  root.add(rack);

  return { root, shell, glass, linings, insulation, parts };
}
