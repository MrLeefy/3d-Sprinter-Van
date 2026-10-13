// Procedural Sprinter 170" high-roof body: lofted shell (bodyShell.js), glazing, doors,
// wheels, lights, bumpers, roof rack, interior linings and insulation layers.
import * as THREE from 'three';
import { boxMesh, boxC, B, roundedRectPath, cylBetween } from './geom.js';
import { buildShell, sideW, halfW, topSurfaceY, XR, XF, YB } from './bodyShell.js';
import { buildWheel } from './wheels.js';
import { INTERIOR } from '../data/vehicle.js';

const ZO = 1.01; // outer half-width at the beltline

/** Black plastic wheel-arch flare (annulus above the sill), on one side. */
function archFlare(ax, side, M) {
  const cy = 0.395, r0 = 0.468, r1 = 0.535;
  const a = Math.asin((YB - 0.005 - cy) / r1), b = Math.asin((YB - 0.005 - cy) / r0);
  const s = new THREE.Shape();
  s.absarc(ax, cy, r1, a, Math.PI - a, false);
  s.absarc(ax, cy, r0, Math.PI - b, b, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 36 });
  const m = new THREE.Mesh(g, M.trim);
  m.position.z = side * (sideW(ax, 0.75) - 0.016);
  if (side < 0) m.scale.z = -1;
  m.castShadow = true;
  return m;
}

/** Front bumper: rounded in plan to follow the nose. */
function frontBumper(M) {
  const s = new THREE.Shape();
  const pts = [];
  for (let k = 0; k <= 24; k++) {
    const x = 4.8 + (XF + 0.1 - 4.8) * (k / 24);
    pts.push([x, Math.min(halfW(Math.min(x, XF)) + 0.03, 1.0)]);
  }
  s.moveTo(4.8, -pts[0][1]);
  for (const [x, z] of pts) s.lineTo(x, -z);
  s.quadraticCurveTo(XF + 0.13, 0, XF + 0.1, pts[24][1]);
  for (const [x, z] of [...pts].reverse()) s.lineTo(x, z);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 4, curveSegments: 16 });
  g.rotateX(Math.PI / 2); // shape (x, z) → world x/z, extrusion downward
  const m = new THREE.Mesh(g, M.trim);
  m.position.y = 0.66;
  m.castShadow = m.receiveShadow = true;
  return m;
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

  // ── Lofted shell ───────────────────────────────────────────
  const S = buildShell(M);
  for (const m of [...Object.values(S.panels), S.rearCap, S.frontCap]) {
    root.add(tag(m));
    shell.push(m);
  }
  for (const k of ['windshield', 'cabL', 'cabR']) {
    root.add(tag(S.glass[k], 'window-covers', 'glass'));
    glass.push(S.glass[k]);
  }
  parts.podSkin = S.pod; // re-parented by the slide-out pod builder

  for (const side of [-1, 1]) {
    // wheel-arch flares
    for (const ax of [0, 4.325]) root.add(tag(archFlare(ax, side, M)));
    // black rub strips
    for (const [x0, x1] of [[-1.56, -0.56], [0.56, side > 0 ? 1.4 : 3.8]]) {
      const z = sideW((x0 + x1) / 2, 0.66);
      const rub = boxMesh(B(x0, x1, 0.6, 0.72, z - 0.006, z + 0.014), M.trim, 0.006);
      if (side < 0) rub.position.z *= -1;
      root.add(tag(rub));
    }
    // cab door handle
    {
      const z = sideW(3.0, 1.33);
      const h = boxMesh(B(2.95, 3.12, 1.31, 1.35, z - 0.008, z + 0.018), M.trim, 0.008);
      if (side < 0) h.position.z *= -1;
      root.add(tag(h));
    }
    // side marker
    {
      const z = sideW(1.03, 0.795);
      const mk = boxMesh(B(1.0, 1.06, 0.78, 0.81, z - 0.004, z + 0.006), M.amber, 0.004);
      if (side < 0) mk.position.z *= -1;
      root.add(tag(mk));
    }
    // mirrors
    const zm = sideW(4.2, 1.45);
    root.add(tag(cylBetween([4.22, 1.44, side * (zm - 0.01)], [4.14, 1.54, side * (zm + 0.17)], 0.018, M.trim)));
    const mir = boxC(4.1, 1.64, side * (zm + 0.2), 0.1, 0.36, 0.2, M.trim, 0.035);
    root.add(tag(mir));
    const mirGlass = boxC(4.045, 1.64, side * (zm + 0.2), 0.01, 0.3, 0.16, M.chrome, 0.004);
    root.add(tag(mirGlass));
    // rear tail-light clusters on the D-pillars
    const tl = boxMesh(B(XR - 0.035, XR - 0.012, 0.78, 1.62, side > 0 ? 0.856 : -0.936, side > 0 ? 0.936 : -0.856), M.tail, 0.012);
    root.add(tag(tl));
    parts['tail' + side] = tl;
  }
  // sliding-door track cover (passenger rear quarter)
  {
    const z = sideW(0.8, 1.515);
    root.add(tag(boxMesh(B(0.12, 1.42, 1.5, 1.53, z - 0.004, z + 0.012), M.trim, 0.004)));
  }

  // ── Nose: grille, bumper, wipers ───────────────────────────
  const grille = boxMesh(B(XF - 0.02, XF + 0.035, 0.66, 0.97, -0.5, 0.5), M.trimGloss, 0.035);
  root.add(tag(grille));
  for (const y of [0.73, 0.81, 0.89]) root.add(tag(boxMesh(B(XF + 0.02, XF + 0.045, y, y + 0.02, -0.47, 0.47), M.chrome, 0.008)));
  const star = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 10, 36), M.chrome);
  star.position.set(XF + 0.048, 0.84, 0);
  star.rotation.y = Math.PI / 2;
  root.add(tag(star));
  for (let k = 0; k < 3; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.075, 0.012), M.chrome);
    const a = (k * 2 * Math.PI) / 3;
    spoke.position.set(XF + 0.05, 0.84 + Math.cos(a) * 0.037, Math.sin(a) * 0.037);
    spoke.rotation.x = -a;
    root.add(tag(spoke));
  }
  root.add(tag(frontBumper(M)));
  root.add(tag(boxMesh(B(XF + 0.06, XF + 0.135, 0.44, 0.56, -0.42, 0.42), M.trimGloss, 0.02))); // lower intake
  for (const s of [-1, 1]) {
    const z0 = s * 0.05, z1 = s * 0.74;
    root.add(tag(cylBetween([4.45, topSurfaceY(4.45, z0) + 0.012, z0], [4.3, topSurfaceY(4.3, z1) + 0.012, z1], 0.007, M.trim)));
  }
  // dashboard (visible through glass)
  root.add(tag(boxMesh(B(3.86, 4.36, 1.0, 1.29, -0.94, 0.94), M.trim, 0.06)));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.02, 10, 32), M.trim);
  wheel.position.set(3.72, 1.42, -0.43);
  wheel.rotation.y = Math.PI / 2;
  wheel.rotation.x = 0.45;
  root.add(tag(wheel));
  root.add(tag(boxMesh(B(3.15, 3.9, 0.7, 0.98, -0.12, 0.12), M.trim, 0.04))); // centre console

  // ── Rear: bumper, step, doors ──────────────────────────────
  root.add(tag(boxMesh(B(-1.73, -1.56, 0.38, 0.62, -0.99, 0.99), M.trim, 0.05)));
  root.add(tag(boxMesh(B(-1.745, -1.7, 0.55, 0.6, -0.35, 0.35), M.alu, 0.01))); // step plate

  const doorShape = () => {
    const s = new THREE.Shape();
    const r = 0.03;
    s.moveTo(0.19, 0.62 + r);
    s.quadraticCurveTo(0.19, 0.62, 0.19 + r, 0.62);
    s.lineTo(1.03 - r, 0.62);
    s.quadraticCurveTo(1.03, 0.62, 1.03, 0.62 + r);
    s.lineTo(1.03, 2.52 - r);
    s.quadraticCurveTo(1.03, 2.52, 1.03 - r, 2.52);
    s.lineTo(0.19 + r, 2.52);
    s.quadraticCurveTo(0.19, 2.52, 0.19, 2.52 - r);
    s.lineTo(0.19, 0.62 + r);
    s.holes.push(roundedRectPath(0.3, 1.8, 0.95, 2.34, 0.05));
    return s;
  };
  for (const s of [-1, 1]) {
    // pivot outboard of the corner (offset 270° hinge)
    const g = new THREE.Group();
    g.position.set(-1.62, 0, s * 1.03);
    const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(doorShape(), { depth: 0.035, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 6 }), M.paint);
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
    const gl = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(roundedRectPath(0.3, 1.8, 0.95, 2.34, 0.05).getPoints())), M.glass);
    gl.rotation.y = panel.rotation.y;
    gl.position.x = s < 0 ? -0.018 : -0.017;
    tag(gl, 'window-covers', 'glass');
    g.add(gl);
    glass.push(gl);
    // window seal
    const seal = new THREE.Mesh(new THREE.ExtrudeGeometry(Object.assign(new THREE.Shape(roundedRectPath(0.285, 1.785, 0.965, 2.355, 0.06).getPoints()), { holes: [roundedRectPath(0.3, 1.8, 0.95, 2.34, 0.05)] }), { depth: 0.008, bevelEnabled: false }), M.rubber);
    seal.rotation.y = panel.rotation.y;
    seal.position.x = s < 0 ? -0.036 : -0.044;
    g.add(tag(seal, 'rear-doors'));
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

  // ── Sliding door (lofted skin cut from the shell) ──────────
  {
    const sd = INTERIOR.slidingDoor;
    const g = new THREE.Group();
    g.add(tag(S.door, 'sliding-door'));
    shell.push(S.door);
    g.add(tag(S.glass.door, 'window-covers', 'glass'));
    glass.push(S.glass.door);
    const zh = sideW(sd.x1 - 0.12, 1.32);
    const handle = boxMesh(B(sd.x1 - 0.2, sd.x1 - 0.05, 1.3, 1.34, zh - 0.004, zh + 0.022), M.trim, 0.008);
    g.add(tag(handle, 'sliding-door'));
    const zr = sideW(2.0, 0.66);
    g.add(tag(boxMesh(B(sd.x0 + 0.03, sd.x1 - 0.03, 0.6, 0.72, zr - 0.006, zr + 0.014), M.trim, 0.006), 'sliding-door'));
    const card = boxMesh(B(sd.x0 + 0.05, sd.x1 - 0.05, 0.7, 1.5, ZO - 0.05, ZO - 0.035), M.felt, 0.004);
    g.add(tag(card, 'sliding-door', 'lining'));
    linings.push(card);
    root.add(g);
    parts.slidingDoor = g;
  }

  // ── Wheels ─────────────────────────────────────────────────
  for (const x of [0, 4.325]) {
    for (const s of [-1, 1]) {
      const w = buildWheel(M, s);
      w.position.set(x, 0.395, s * 0.865);
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
  const spare = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 12, 40), M.tyre);
  spare.rotation.x = Math.PI / 2;
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
    const ins = boxMesh(B(-1.55, 2.75, 0.72, 2.48, s > 0 ? I.wallZ + 0.015 : -0.95, s > 0 ? 0.95 : -I.wallZ - 0.015), M.insulation, 0.01, { cast: false });
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
    for (let x = -1.4; x <= 2.6; x += 0.62) rack.add(cylBetween([x, 2.715, s * 0.72], [x, 2.87, s * 0.72], 0.012, M.alu));
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
