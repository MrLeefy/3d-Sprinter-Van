// Rear zone builders: bed, slide-out pod, garage, electrical bay, water module, heater, toilet.
import * as THREE from 'three';
import { boxMesh, boxC, B, cylBetween, pivotGroup, addWorld, tube } from '../geom.js';
import { lerp, seg } from './common.js';
import { duvetGeometry, pillowGeometry } from '../props.js';
import { overhead } from './shared.js';

const cyl = (r, h, mat, seg = 20) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.castShadow = true;
  return m;
};

export const rearBuilders = {
  'bed-platform'(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    // deck panels with hatches
    const hatches = [];
    const deckZ = [b.z[0], -0.1, 0.38, b.z[1]];
    for (let i = 0; i < 3; i++) {
      const isHatch = i !== 0;
      const pz0 = deckZ[i], pz1 = deckZ[i + 1];
      if (isHatch) {
        const hg = pivotGroup(b.x[0] + 0.02, b.y[1], 0);
        addWorld(hg, boxMesh(B(b.x[0] + 0.02, -0.55, b.y[0], b.y[1], pz0 + 0.004, pz1 - 0.004), M.oak, 0.004));
        g.add(hg);
        hatches.push(hg);
        g.add(boxMesh(B(-0.55, b.x[1], b.y[0], b.y[1], pz0 + 0.004, pz1 - 0.004), M.oak, 0.004));
      } else {
        g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], pz0, pz1 - 0.004), M.oak, 0.004));
      }
    }
    // aluminium frame posts & rails
    for (const x of [b.x[0] + 0.03, -0.17]) for (const z of [-0.54, 0.0, 0.83]) g.add(boxMesh(B(x - 0.02, x + 0.02, 0.73, b.y[0], z - 0.02, z + 0.02), M.aluDark, 0.004));
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0] - 0.04, b.y[0], 0.82, 0.855), M.aluDark, 0.004));
    // garage front fascia (aisle side) with louvre and access panel
    const fz0 = -0.455, fz1 = 0.075;
    g.add(boxMesh(B(-0.165, -0.15, 1.28, b.y[1], fz0, fz1), M.cabinet, 0.004));
    g.add(boxMesh(B(-0.165, -0.15, 0.73, 0.94, fz0, fz1), M.cabinet, 0.004));
    for (let y = 0.76; y < 0.92; y += 0.03) g.add(boxMesh(B(-0.152, -0.145, y, y + 0.012, fz0 + 0.03, fz1 - 0.03), M.aluDark, 0.002));
    const hatch = pivotGroup(-0.15, 0.94, 0);
    addWorld(hatch, boxMesh(B(-0.165, -0.15, 0.94, 1.28, fz0 + 0.005, fz1 - 0.005), M.cabinetEdge, 0.004));
    addWorld(hatch, boxMesh(B(-0.15, -0.135, 1.22, 1.24, -0.25, -0.13), M.trim, 0.004));
    g.add(hatch);
    rig.on('garageHatch', (v) => (hatch.rotation.z = -v * 1.45));
    rig.on('deckHatches', (v) => hatches.forEach((h, i) => (h.rotation.z = -v * (1.0 + i * 0.05))));
    return g;
  },

  mattress(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const hingeX = -0.86;
    // two mattress sections in a fitted sheet; the rear one hinges up into a lounge backrest
    const front = boxMesh(B(hingeX + 0.005, b.x[1], b.y[0], b.y[1], b.z[0], b.z[1]), M.linen, 0.06);
    g.add(front);
    const back = pivotGroup(hingeX, b.y[0], 0);
    addWorld(back, boxMesh(B(b.x[0], hingeX - 0.005, b.y[0], b.y[1], b.z[0], b.z[1]), M.linen, 0.06));
    // made bed: quilted duvet over both sections, turned back below the pillows
    const made = new THREE.Group();
    const dBack = new THREE.Mesh(duvetGeometry({ x0: b.x[0] + 0.01, x1: hingeX - 0.004, z0: b.z[0] + 0.01, z1: 0.42, y: b.y[1] - 0.012, drape: { z0: 0.05 }, seed: 2 }), M.duvet);
    const dFront = new THREE.Mesh(duvetGeometry({ x0: hingeX + 0.004, x1: b.x[1] - 0.01, z0: b.z[0] + 0.01, z1: 0.42, y: b.y[1] - 0.012, drape: { x1: 0.1, z0: 0.05 }, seed: 5 }), M.duvet);
    for (const m of [dBack, dFront]) m.castShadow = m.receiveShadow = true;
    addWorld(back, dBack);
    made.add(dFront);
    g.add(made);
    // folded duvet stack for lounge mode
    const stack = boxMesh(B(-0.7, -0.24, b.y[1], b.y[1] + 0.09, b.z[0] + 0.04, b.z[0] + 0.42), M.duvet, 0.04);
    g.add(stack);
    // folded throw across the foot
    g.add(boxMesh(B(-1.42, -0.98, b.y[1] + 0.012, b.y[1] + 0.05, b.z[0] + 0.05, b.z[0] + 0.32), M.blanket, 0.018));
    // pillows (the rear one rides on the backrest)
    const pg = pillowGeometry(0.5, 0.13, 0.32);
    for (const [x, seed] of [[-1.15, 0], [-0.55, 1]]) {
      const p = new THREE.Mesh(pg, M.linen);
      p.position.set(x, b.y[1] + 0.06, 0.66);
      p.rotation.y = (seed ? -1 : 1) * 0.04;
      p.castShadow = p.receiveShadow = true;
      if (x < hingeX) addWorld(back, p);
      else g.add(p);
    }
    const strut = cylBetween([-1.2, 1.51, 0.6], [-0.95, 1.51, 0.6], 0.01, M.steel);
    g.add(strut);
    g.add(back);
    rig.on('bedLounge', (v) => {
      back.rotation.z = -v * 1.1;
      strut.scale.set(1, 1 + v * 0.6, 1);
      made.visible = dBack.visible = v < 0.04;
      stack.visible = v >= 0.04;
    });
    return g;
  },

  'slideout-pod'(c, { M, rig, reg, body }) {
    const g = new THREE.Group();
    const b = c.box;
    const mov = new THREE.Group();
    // outer skin: the patch of the lofted body side cut out for the pod (flush, same curvature)
    const zo = -0.975; // GRP frame stays just inside the skin
    if (body?.parts?.podSkin) mov.add(body.parts.podSkin);
    else mov.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], b.z[0], b.z[0] + 0.03), M.paint, 0.01));
    mov.add(boxMesh(B(b.x[0], b.x[1], b.y[1] - 0.03, b.y[1], zo, b.z[1]), M.grp, 0.006));
    mov.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[0] + 0.03, zo, b.z[1]), M.grp, 0.006));
    for (const x of [b.x[0], b.x[1] - 0.03]) mov.add(boxMesh(B(x, x + 0.03, b.y[0], b.y[1], zo, b.z[1]), M.grp, 0.006));
    // interior lining & mattress strip
    mov.add(boxMesh(B(b.x[0] + 0.03, b.x[1] - 0.03, b.y[0] + 0.03, b.y[1] - 0.03, b.z[0] + 0.03, b.z[0] + 0.04), M.felt, 0.004));
    mov.add(boxMesh(B(b.x[0] + 0.04, b.x[1] - 0.04, b.y[0] + 0.04, 1.69, b.z[0] + 0.04, b.z[1] - 0.005), M.linen, 0.04));
    mov.add(boxMesh(B(b.x[0] + 0.05, b.x[1] - 0.05, 1.69, 1.715, b.z[0] + 0.05, b.z[1] - 0.02), M.blanket, 0.012));
    // drip rail
    mov.add(boxMesh(B(b.x[0] - 0.01, b.x[1] + 0.01, b.y[1] + 0.005, b.y[1] + 0.02, b.z[0] - 0.02, b.z[0] + 0.02), M.trim, 0.004));
    // reading light inside pod
    const pl = boxC((b.x[0] + b.x[1]) / 2, b.y[1] - 0.05, b.z[0] + 0.06, 0.12, 0.02, 0.03, M.ledStrip, 0.005);
    mov.add(pl);
    reg.ledStrips.push(pl);
    g.add(mov);
    // bulb seal around the body opening (inside the skin, visible when the pod is out)
    const fl = [B(b.x[0] - 0.02, b.x[1] + 0.02, b.y[1], b.y[1] + 0.02, -0.98, -0.95), B(b.x[0] - 0.02, b.x[1] + 0.02, b.y[0] - 0.02, b.y[0], -1.0, -0.97),
      B(b.x[0] - 0.02, b.x[0], b.y[0], b.y[1], -0.99, -0.96), B(b.x[1], b.x[1] + 0.02, b.y[0], b.y[1], -0.99, -0.96)];
    for (const f of fl) g.add(boxMesh(f, M.rubber, 0.006));
    // telescoping rails & actuators (under the pod, inside the garage ceiling)
    const railsMov = [];
    for (const x of [-1.25, -0.45]) {
      g.add(boxMesh(B(x - 0.02, x + 0.02, 1.455, 1.495, -0.86, -0.56), M.alu, 0.004));
      const r = boxMesh(B(x - 0.014, x + 0.014, 1.462, 1.488, -1.0, -0.7), M.steel, 0.003);
      g.add(r);
      railsMov.push(r);
    }
    const rods = [];
    for (const x of [-1.05, -0.65]) {
      g.add(cylBetween([x, 1.475, -0.58], [x, 1.475, -0.8], 0.022, M.trim));
      const rod = cylBetween([x, 1.475, -0.8], [x, 1.475, -0.98], 0.01, M.steel);
      g.add(rod);
      rods.push(rod);
    }
    // compression latches (rotate open before travel)
    const latches = [];
    for (const [x, y] of [[b.x[0] + 0.02, 1.62], [b.x[0] + 0.02, 2.0], [b.x[1] - 0.02, 1.62], [b.x[1] - 0.02, 2.0]]) {
      const l = boxC(x, y, -0.84, 0.03, 0.06, 0.03, M.red, 0.005);
      g.add(l);
      latches.push(l);
    }
    // fold-down outboard support strut
    const strutPiv = pivotGroup((b.x[0] + b.x[1]) / 2, b.y[0], b.z[0] + 0.02);
    addWorld(strutPiv, cylBetween([(b.x[0] + b.x[1]) / 2, b.y[0], b.z[0] + 0.02], [(b.x[0] + b.x[1]) / 2, b.y[0] - 0.42, b.z[0] + 0.02], 0.012, M.alu));
    mov.add(strutPiv);
    reg.pod = mov;
    rig.on('slideOut', (v) => {
      const s = -0.25 * v;
      mov.position.z = s;
      railsMov.forEach((r) => (r.position.z = -0.85 + s));
      rods.forEach((r) => (r.position.z = -0.89 + s / 2));
      rods.forEach((r) => r.scale.set(1, 1 + v * 1.4, 1));
      latches.forEach((l) => (l.rotation.z = Math.min(1, v * 6) * 1.2));
      strutPiv.rotation.x = -(1 - seg(v, 0.85, 1)) * 1.4 + 0.25;
      strutPiv.visible = v > 0.85;
    });
    return g;
  },

  'oh-bed-pass': overhead, 'oh-bed-drv': overhead,

  'bed-step'(c, { M, rig }) {
    const g = new THREE.Group();
    const step = new THREE.Group();
    step.add(boxMesh(B(-0.43, -0.15, 1.06, 1.1, -0.39, -0.01), M.oak, 0.01));
    step.add(boxMesh(B(-0.155, -0.14, 0.98, 1.1, -0.39, -0.01), M.cabinetEdge, 0.004));
    g.add(step);
    rig.on('bedStep', (v) => (step.position.x = 0.28 * v));
    return g;
  },

  'fresh-tank'(c, { M, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(b, M.tankShell, 0.03, { cast: false }));
    const water = boxMesh(B(b.x[0] + 0.01, b.x[1] - 0.01, b.y[0] + 0.006, b.y[1] - 0.008, b.z[0] + 0.01, b.z[1] - 0.01), M.tankWater, 0.02, { cast: false });
    water.geometry = water.geometry.clone();
    water.geometry.translate(0, (b.y[1] - b.y[0] - 0.014) / 2, 0);
    water.position.y = b.y[0] + 0.006;
    g.add(water);
    reg.levels.fresh = { mesh: water };
    // baffles & fittings
    for (const x of [-0.56, -0.37]) g.add(boxMesh(B(x, x + 0.004, b.y[0] + 0.01, b.y[1] - 0.04, b.z[0] + 0.02, b.z[1] - 0.02), M.tankShell, 0.001, { cast: false }));
    const port = cyl(0.075, 0.02, M.white);
    port.position.set(-0.47, b.y[1] + 0.01, -0.15);
    g.add(port);
    const sensor = boxC(-0.2, b.y[1] - 0.06, -0.55, 0.02, 0.18, 0.04, M.trim, 0.004);
    g.add(sensor);
    return g;
  },

  'garage-bins-front': bins,
  'garage-bins-rear': bins,

  'outdoor-kitchen'(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const mov = new THREE.Group();
    // tray sides
    for (const z of [b.z[0], b.z[1] - 0.02]) mov.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1] - 0.04, z, z + 0.02), M.alu, 0.004));
    mov.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[0] + 0.02, b.z[0], b.z[1]), M.alu, 0.004));
    mov.add(boxMesh(B(b.x[0] - 0.02, b.x[0], b.y[0], b.y[1], b.z[0], b.z[1]), M.walnut, 0.006)); // rear face (visible with doors open)
    mov.add(boxMesh(B(b.x[0], b.x[1], b.y[1] - 0.04, b.y[1], b.z[0], b.z[1]), M.oak, 0.008));
    // plug-in induction plate + utensil rail
    mov.add(boxC(-1.25, b.y[1] + 0.03, 0.03, 0.3, 0.05, 0.34, M.ceramic, 0.01));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.006, 6, 30), M.cookZone);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-1.25, b.y[1] + 0.057, 0.03);
    mov.add(ring);
    mov.add(cylBetween([b.x[0] + 0.05, b.y[1] + 0.12, b.z[1] - 0.02], [b.x[1] - 0.15, b.y[1] + 0.12, b.z[1] - 0.02], 0.006, M.steel));
    // flip-out wing
    const wing = pivotGroup(b.x[0], b.y[1], b.z[1]);
    addWorld(wing, boxMesh(B(b.x[0], b.x[0] + 0.5, b.y[1] - 0.025, b.y[1], b.z[1], b.z[1] + 0.35), M.oak, 0.006));
    mov.add(wing);
    // support legs (deploy when extended)
    const legs = [];
    for (const z of [b.z[0] + 0.03, b.z[1] - 0.03]) {
      const l = cylBetween([b.x[0] + 0.03, b.y[0], z], [b.x[0] + 0.03, 0.0, z], 0.012, M.alu);
      l.visible = false;
      mov.add(l);
      legs.push(l);
    }
    g.add(mov);
    // fixed slide rails
    for (const z of [b.z[0] - 0.01, b.z[1] + 0.005]) g.add(boxMesh(B(b.x[0] + 0.02, b.x[1], b.y[0], b.y[0] + 0.04, z, z + 0.008), M.steel, 0.002));
    rig.on('outdoorKitchen', (v) => {
      mov.position.x = -0.7 * seg(v, 0, 0.75);
      wing.rotation.x = (1 - seg(v, 0.75, 1)) * -Math.PI;
      legs.forEach((l) => (l.visible = v > 0.7));
    });
    return g;
  },

  'combi-heater'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(b, M.truma, 0.03));
    g.add(boxMesh(B(b.x[1] - 0.005, b.x[1] + 0.004, b.y[0] + 0.05, b.y[1] - 0.05, b.z[0] + 0.05, b.z[1] - 0.05), M.aluDark, 0.01));
    g.add(boxMesh(B(b.x[0] + 0.05, b.x[1] - 0.05, b.y[1] - 0.01, b.y[1] + 0.004, b.z[0] + 0.04, b.z[0] + 0.1), M.red, 0.004));
    for (const [z, x] of [[0.45, -0.75], [0.6, -0.85], [0.75, -0.62]]) {
      const o = cyl(0.036, 0.05, M.trim);
      o.position.set(x, b.y[1] + 0.02, z);
      g.add(o);
    }
    return g;
  },

  'combi-cowl'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], 1.008, 1.03), M.white, 0.02));
    for (let y = b.y[0] + 0.025; y < b.y[1] - 0.02; y += 0.022) g.add(boxMesh(B(b.x[0] + 0.015, b.x[1] - 0.015, y, y + 0.008, 1.028, 1.036), M.aluDark, 0.002));
    return g;
  },

  'water-pump'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    const motor = cyl(0.045, 0.11, M.trim);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(b.x[0] + 0.07, b.y[0] + 0.06, (b.z[0] + b.z[1]) / 2);
    g.add(motor);
    g.add(boxC(b.x[1] - 0.05, b.y[0] + 0.06, (b.z[0] + b.z[1]) / 2, 0.08, 0.1, 0.12, M.aluDark, 0.02));
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[0] + 0.01, b.z[0], b.z[1]), M.rubber, 0.003));
    return g;
  },
  accumulator(c, { M }) {
    const m = cyl(0.04, c.box.y[1] - c.box.y[0] - 0.02, M.victron);
    m.position.set((c.box.x[0] + c.box.x[1]) / 2, (c.box.y[0] + c.box.y[1]) / 2, (c.box.z[0] + c.box.z[1]) / 2);
    return m;
  },
  'water-filter'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    const h = cyl(0.05, b.y[1] - b.y[0] - 0.05, M.tankShell);
    h.position.set((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2 - 0.02, (b.z[0] + b.z[1]) / 2);
    g.add(h);
    const capm = cyl(0.058, 0.04, M.white);
    capm.position.set(h.position.x, b.y[1] - 0.02, h.position.z);
    g.add(capm);
    const cart = cyl(0.03, b.y[1] - b.y[0] - 0.08, M.walnut);
    cart.position.copy(h.position);
    g.add(cart);
    return g;
  },
  'water-manifold'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(cylBetween([b.x[0], b.y[0] + 0.03, b.z[0] + 0.04], [b.x[1], b.y[0] + 0.03, b.z[0] + 0.04], 0.014, M.steel));
    g.add(cylBetween([b.x[0], b.y[0] + 0.03, b.z[1] - 0.04], [b.x[1], b.y[0] + 0.03, b.z[1] - 0.04], 0.014, M.steel));
    for (let i = 0; i < 4; i++) {
      const x = b.x[0] + 0.025 + i * 0.04;
      g.add(boxC(x, b.y[0] + 0.06, b.z[0] + 0.04, 0.012, 0.03, 0.03, systemMat(M, 0x2f8cff), 0.004));
      g.add(boxC(x, b.y[0] + 0.06, b.z[1] - 0.04, 0.012, 0.03, 0.03, systemMat(M, 0xff4d2e), 0.004));
    }
    return g;
  },

  toilet(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const mov = new THREE.Group();
    const cx = (b.x[0] + b.x[1]) / 2, cz = (b.z[0] + b.z[1]) / 2;
    mov.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[0] + 0.03, b.z[0], b.z[1]), M.alu, 0.004));
    mov.add(boxMesh(B(b.x[0] + 0.03, b.x[1] - 0.03, b.y[0] + 0.03, b.y[1] - 0.06, b.z[0] + 0.01, b.z[1] - 0.01), M.white, 0.05));
    const seat = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 10, 30), M.white);
    seat.rotation.x = Math.PI / 2;
    seat.scale.set(1, 1.2, 1);
    seat.position.set(cx + 0.03, b.y[1] - 0.05, cz);
    mov.add(seat);
    const lid = pivotGroup(b.x[0] + 0.06, b.y[1] - 0.03, cz);
    addWorld(lid, boxMesh(B(b.x[0] + 0.06, b.x[1] - 0.02, b.y[1] - 0.03, b.y[1], b.z[0] + 0.02, b.z[1] - 0.02), M.oak, 0.02));
    mov.add(lid);
    mov.add(boxC(b.x[0] + 0.1, b.y[0] + 0.15, b.z[1] - 0.01, 0.12, 0.08, 0.02, M.trim, 0.004)); // agitator handle
    g.add(mov);
    for (const z of [b.z[0] - 0.006, b.z[1]]) g.add(boxMesh(B(b.x[0], b.x[1], b.y[0] - 0.02, b.y[0] + 0.01, z, z + 0.006), M.steel, 0.002));
    rig.on('toilet', (v) => {
      mov.position.x = 0.4 * v;
      lid.rotation.z = seg(v, 0.8, 1) * 1.6;
    });
    return g;
  },

  // ── electrical bay ───────────────────────────────
  'battery-a': battery, 'battery-b': battery,
  'main-fuse'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[0] + 0.08, b.z[0], b.z[1]), M.trim, 0.006));
    const sw = cyl(0.035, 0.05, M.red);
    sw.rotation.z = Math.PI / 2;
    sw.position.set((b.x[0] + b.x[1]) / 2, b.y[1] - 0.05, (b.z[0] + b.z[1]) / 2);
    g.add(sw);
    return g;
  },
  inverter(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(b, M.victron, 0.02));
    g.add(boxMesh(B(b.x[0] + 0.05, b.x[1] - 0.05, b.y[1] - 0.16, b.y[1] - 0.06, b.z[1] - 0.004, b.z[1] + 0.003), M.screen, 0.004));
    for (let y = b.y[0] + 0.04; y < b.y[0] + 0.2; y += 0.025) g.add(boxMesh(B(b.x[0] + 0.03, b.x[1] - 0.03, y, y + 0.01, b.z[1] - 0.002, b.z[1] + 0.004), M.aluDark, 0.002));
    return g;
  },
  'elec-backboard'(c, { M }) {
    return boxMesh(c.box, M.oak, 0.004);
  },
  'lynx-bms': victronBox, mppt: victronBox, 'orion-1': victronBox, 'orion-2': victronBox,
  'dc-panel'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(b, M.aluDark, 0.006));
    for (let i = 0; i < 8; i++) {
      const x = b.x[0] + 0.02 + i * 0.03;
      g.add(boxMesh(B(x, x + 0.012, b.y[0] + 0.03, b.y[0] + 0.06, b.z[1], b.z[1] + 0.008), i % 3 === 0 ? M.red : M.amber, 0.002));
    }
    return g;
  },
  'ac-panel'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(b, M.white, 0.006));
    for (let i = 0; i < 6; i++) {
      const x = b.x[0] + 0.02 + i * 0.03;
      g.add(boxMesh(B(x, x + 0.018, b.y[0] + 0.03, b.y[0] + 0.08, b.z[1], b.z[1] + 0.012), M.trim, 0.002));
    }
    return g;
  },
  'shore-inlet'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], -1.03, -1.008), M.paint, 0.012));
    g.add(boxMesh(B(b.x[0] + 0.01, b.x[1] - 0.01, b.y[0] + 0.004, b.y[0] + 0.012, -1.034, -1.026), M.trim, 0.002));
    return g;
  },
  'fill-inlet'(c, { M }) {
    const m = cyl(0.035, 0.04, M.trim);
    m.rotation.z = Math.PI / 2;
    m.position.set(-1.55, (c.box.y[0] + c.box.y[1]) / 2, (c.box.z[0] + c.box.z[1]) / 2);
    return m;
  },
  'outdoor-shower'(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const cy = (b.y[0] + b.y[1]) / 2, cz = (b.z[0] + b.z[1]) / 2;
    g.add(boxC(-1.55, cy, cz, 0.04, 0.1, 0.06, M.chrome, 0.01));
    const hose = tube([[-1.57, cy, cz], [-1.9, cy - 0.3, cz + 0.2], [-2.05, 1.6, cz + 0.45], [-2.0, 2.0, cz + 0.55]], 0.008, M.trim, { corner: 0.2 });
    const head = boxC(-2.0, 2.02, cz + 0.55, 0.06, 0.03, 0.12, M.chrome, 0.012);
    hose.visible = head.visible = false;
    g.add(hose, head);
    rig.on('outdoorShower', (v) => (hose.visible = head.visible = v > 0.5));
    return g;
  },
};

function bins(c, { M }) {
  const g = new THREE.Group();
  const b = c.box;
  const n = Math.max(1, Math.round((b.z[1] - b.z[0]) / 0.3));
  const w = (b.z[1] - b.z[0]) / n;
  const crate = new THREE.MeshStandardMaterial({ color: 0x55606b, roughness: 0.8 });
  for (let i = 0; i < n; i++) {
    g.add(boxMesh(B(b.x[0] + 0.01, b.x[1] - 0.01, b.y[0], b.y[1] - 0.02, b.z[0] + i * w + 0.01, b.z[0] + (i + 1) * w - 0.01), crate, 0.02));
    g.add(boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, b.y[1] - 0.025, b.y[1] - 0.01, b.z[0] + i * w + 0.015, b.z[0] + (i + 1) * w - 0.015), M.trim, 0.01));
  }
  return g;
}

function battery(c, { M }) {
  const g = new THREE.Group();
  const b = c.box;
  g.add(boxMesh(b, M.battery, 0.015));
  g.add(boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, b.y[1] - 0.005, b.y[1] + 0.002, b.z[0] + 0.02, b.z[1] - 0.02), M.victron, 0.004));
  for (const [dx, mat] of [[0.06, M.red], [b.x[1] - b.x[0] - 0.06, M.trim]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), mat);
    t.position.set(b.x[0] + dx, b.y[1] + 0.015, (b.z[0] + b.z[1]) / 2);
    g.add(t);
  }
  return g;
}

function victronBox(c, { M }) {
  const g = new THREE.Group();
  const b = c.box;
  g.add(boxMesh(b, M.victron, 0.008));
  g.add(boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, b.y[1] - 0.04, b.y[1] - 0.015, b.z[1] - 0.002, b.z[1] + 0.003), M.screen, 0.002));
  return g;
}

const _sys = new Map();
function systemMat(M, hex) {
  if (!_sys.has(hex)) _sys.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4 }));
  return _sys.get(hex);
}
