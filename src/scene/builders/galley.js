// Mid-van builders: galley, pantry tower, wardrobe, wet bath, table.
import * as THREE from 'three';
import { boxMesh, boxC, B, cylBetween, pivotGroup, addWorld, tube, rbox } from '../geom.js';
import { seg, lerp } from './common.js';
import { overhead } from './shared.js';

const cyl = (r, h, mat, s = 20) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, s), mat);
  m.castShadow = true;
  return m;
};

const FOOD = [0xd94b3a, 0x4caf50, 0xf2c94c, 0xf5f5f5, 0x8d6e63, 0xff9800, 0x3f51b5];
const foodMats = FOOD.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));

export const galleyBuilders = {
  'galley-base'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0], b.x[0] + 0.018, b.y[0], b.y[1], b.z[0], b.z[1]), M.cabinetEdge, 0.004));
    g.add(boxMesh(B(b.x[1] - 0.018, b.x[1], b.y[0], b.y[1], b.z[0], b.z[1]), M.cabinetEdge, 0.004));
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], 0.8, b.z[0], -0.31), M.trim, 0.004)); // toe-kick
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], b.z[0], b.z[0] + 0.015), M.cabinet, 0.002)); // back
    g.add(boxMesh(B(1.214, 1.23, 0.8, b.y[1], -0.84, -0.26), M.cabinet, 0.002)); // dividers
    g.add(boxMesh(B(1.68, 1.7, 0.8, b.y[1], -0.84, -0.26), M.cabinet, 0.002));
    g.add(boxMesh(B(1.7, 2.082, 1.31, 1.585, -0.28, -0.258), M.cabinetEdge, 0.006)); // tilt-out front under sink
    g.add(boxMesh(B(1.82, 1.98, 1.43, 1.44, -0.26, -0.245), M.trim, 0.003));
    // toe-kick heat outlet
    g.add(boxMesh(B(2.0, 2.09, 0.745, 0.785, -0.312, -0.305), M.aluDark, 0.002));
    return g;
  },

  fridge(c, { M, rig, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], b.z[0], b.z[1] - 0.03), M.white, 0.01));
    const drawers = [];
    for (const [y0, y1, travel] of [[b.y[0], 1.105, 0.35], [1.11, b.y[1], 0.4]]) {
      const d = new THREE.Group();
      d.add(boxMesh(B(b.x[0] + 0.004, b.x[1] - 0.004, y0 + 0.004, y1 - 0.004, b.z[1] - 0.03, b.z[1]), M.brushed, 0.008));
      d.add(boxMesh(B(b.x[0] + 0.06, b.x[1] - 0.06, y1 - 0.05, y1 - 0.035, b.z[1], b.z[1] + 0.025), M.trim, 0.006));
      d.add(boxMesh(B(b.x[0] + 0.03, b.x[1] - 0.03, y0 + 0.03, y1 - 0.06, b.z[1] - 0.44, b.z[1] - 0.03), M.white, 0.01));
      for (let i = 0; i < 5; i++) {
        const f = boxC(b.x[0] + 0.08 + (i % 3) * 0.14, y0 + 0.08, b.z[1] - 0.12 - Math.floor(i / 3) * 0.16, 0.1, 0.1 + (i % 2) * 0.06, 0.1, foodMats[i % foodMats.length], 0.01);
        d.add(f);
      }
      g.add(d);
      drawers.push([d, travel]);
    }
    g.add(boxMesh(B(b.x[1] - 0.12, b.x[1] - 0.03, b.y[1] - 0.03, b.y[1] - 0.01, b.z[1] + 0.001, b.z[1] + 0.004), M.screen, 0.002));
    rig.on('fridgeDrawers', (v) => drawers.forEach(([d, t], i) => (d.position.z = t * seg(v, i * 0.2, 0.8 + i * 0.2))));
    reg.fridge = g;
    return g;
  },

  'galley-drawers'(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const hs = [0.23, 0.2, 0.15, 0.12];
    let y = b.y[0];
    const ds = [];
    hs.forEach((h, i) => {
      const d = new THREE.Group();
      const y0 = y + 0.003, y1 = y + h - 0.003;
      d.add(boxMesh(B(b.x[0], b.x[1], y0, y1, b.z[1] - 0.02, b.z[1]), M.cabinetEdge, 0.006));
      d.add(boxMesh(B((b.x[0] + b.x[1]) / 2 - 0.09, (b.x[0] + b.x[1]) / 2 + 0.09, y1 - 0.04, y1 - 0.03, b.z[1], b.z[1] + 0.022), M.trim, 0.005));
      d.add(boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, y0 + 0.01, y1 - 0.02, b.z[1] - 0.48, b.z[1] - 0.02), M.cabinet, 0.004));
      if (i === 0) {
        const pot = cyl(0.11, 0.14, M.steel);
        pot.position.set(b.x[0] + 0.15, y0 + 0.09, b.z[1] - 0.2);
        d.add(pot);
        const pan = cyl(0.12, 0.05, M.trimGloss);
        pan.position.set(b.x[0] + 0.32, y0 + 0.05, b.z[1] - 0.3);
        d.add(pan);
      }
      if (i === 3) for (let k = 0; k < 6; k++) d.add(boxC(b.x[0] + 0.06 + k * 0.06, y0 + 0.04, b.z[1] - 0.25, 0.015, 0.012, 0.22, M.steel, 0.004));
      g.add(d);
      ds.push(d);
      y += h;
    });
    rig.on('drawers', (v) => ds.forEach((d, i) => (d.position.z = 0.42 * seg(v, 0.12 * (3 - i), 0.64 + 0.12 * (3 - i)))));
    return g;
  },

  'trash-bins'(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const d = new THREE.Group();
    d.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], b.z[1] - 0.02, b.z[1] + 0.002), M.cabinetEdge, 0.006));
    d.add(boxMesh(B(1.82, 1.98, b.y[1] - 0.05, b.y[1] - 0.04, b.z[1] + 0.002, b.z[1] + 0.022), M.trim, 0.004));
    const green = new THREE.MeshStandardMaterial({ color: 0x3c8d5a, roughness: 0.7 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x5b6168, roughness: 0.7 });
    d.add(boxMesh(B(b.x[0] + 0.01, (b.x[0] + b.x[1]) / 2 - 0.005, b.y[0] + 0.01, b.y[1] - 0.06, b.z[0] + 0.02, b.z[1] - 0.03), green, 0.02));
    d.add(boxMesh(B((b.x[0] + b.x[1]) / 2 + 0.005, b.x[1] - 0.01, b.y[0] + 0.01, b.y[1] - 0.06, b.z[0] + 0.02, b.z[1] - 0.03), grey, 0.02));
    g.add(d);
    rig.on('trashPullout', (v) => (d.position.z = 0.36 * v));
    return g;
  },

  'drinking-filter'(c, { M }) {
    const m = cyl(0.04, c.box.y[1] - c.box.y[0], M.white);
    m.position.set((c.box.x[0] + c.box.x[1]) / 2, (c.box.y[0] + c.box.y[1]) / 2, (c.box.z[0] + c.box.z[1]) / 2);
    return m;
  },

  countertop(c, { M, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    const s = new THREE.Shape();
    // shape in (x, -z)
    s.moveTo(b.x[0], -b.z[0]);
    s.lineTo(b.x[1], -b.z[0]);
    s.lineTo(b.x[1], -b.z[1] - 0.02);
    s.lineTo(b.x[0], -b.z[1] - 0.02);
    s.lineTo(b.x[0], -b.z[0]);
    const hole = (x0, x1, z0, z1) => {
      const p = new THREE.Path();
      p.moveTo(x0, -z0);
      p.lineTo(x0, -z1);
      p.lineTo(x1, -z1);
      p.lineTo(x1, -z0);
      p.lineTo(x0, -z0);
      return p;
    };
    s.holes.push(hole(1.72, 2.06, -0.72, -0.32));
    s.holes.push(hole(1.325, 1.585, -0.79, -0.31));
    const geo = new THREE.ExtrudeGeometry(s, { depth: b.y[1] - b.y[0], bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.004, bevelSegments: 1 });
    const m = new THREE.Mesh(geo, M.quartz);
    m.rotation.x = -Math.PI / 2;
    m.position.y = b.y[0];
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    // stainless backsplash & under-cabinet glow
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[1], 2.1, -0.855, -0.849), M.brushed, 0.002));
    // galley outlets
    g.add(boxMesh(B(0.9, 1.02, 1.7, 1.8, -0.849, -0.842), M.white, 0.004));
    reg.counter = m;
    return g;
  },

  cooktop(c, { M, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0], b.x[1], 1.629, 1.637, b.z[0], b.z[1]), M.ceramic, 0.004));
    g.add(boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, b.y[0], 1.6, b.z[0] + 0.02, b.z[1] - 0.02), M.trim, 0.004));
    reg.cookZones = [];
    for (const [z, r] of [[-0.66, 0.1], [-0.45, 0.085]]) {
      const mat = M.cookZone.clone();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 6, 40), mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set((b.x[0] + b.x[1]) / 2, 1.638, z);
      g.add(ring);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 32), mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set((b.x[0] + b.x[1]) / 2, 1.6372, z);
      g.add(disc);
      reg.cookZones.push(mat);
    }
    for (let i = 0; i < 5; i++) g.add(boxMesh(B(b.x[0] + 0.05 + i * 0.045, b.x[0] + 0.07 + i * 0.045, 1.637, 1.638, -0.33, -0.31), M.white, 0.001));
    // cookware shown while cooking
    const ware = new THREE.Group();
    const pan = cyl(0.12, 0.05, M.trimGloss, 28);
    pan.position.set((b.x[0] + b.x[1]) / 2, 1.665, -0.45);
    ware.add(pan);
    ware.add(cylBetween([(b.x[0] + b.x[1]) / 2 + 0.1, 1.68, -0.45], [(b.x[0] + b.x[1]) / 2 + 0.3, 1.7, -0.45], 0.01, M.trim));
    const pot = cyl(0.1, 0.13, M.steel, 28);
    pot.position.set((b.x[0] + b.x[1]) / 2, 1.705, -0.67);
    ware.add(pot);
    ware.visible = false;
    g.add(ware);
    reg.cookware = ware;
    return g;
  },

  sink(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const t = 0.006;
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[0] + t, b.z[0], b.z[1]), M.steel, 0.004));
    g.add(boxMesh(B(b.x[0], b.x[0] + t, b.y[0], 1.6, b.z[0], b.z[1]), M.steel, 0.002));
    g.add(boxMesh(B(b.x[1] - t, b.x[1], b.y[0], 1.6, b.z[0], b.z[1]), M.steel, 0.002));
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], 1.6, b.z[0], b.z[0] + t), M.steel, 0.002));
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], 1.6, b.z[1] - t, b.z[1]), M.steel, 0.002));
    const drain = cyl(0.03, 0.004, M.chrome);
    drain.position.set((b.x[0] + b.x[1]) / 2, b.y[0] + 0.008, (b.z[0] + b.z[1]) / 2);
    g.add(drain);
    // faucet
    const fb = cyl(0.022, 0.06, M.chrome);
    fb.position.set(1.89, 1.66, -0.78);
    g.add(fb);
    g.add(tube([[1.89, 1.69, -0.78], [1.89, 1.93, -0.78], [1.89, 1.93, -0.58], [1.89, 1.84, -0.56]], 0.012, M.chrome, { corner: 0.09 }));
    g.add(tube([[1.8, 1.63, -0.8], [1.8, 1.76, -0.8], [1.8, 1.76, -0.72]], 0.006, M.chrome, { corner: 0.04 }));
    // cutting-board cover (stands up against the backsplash when the sink is in use)
    const cover = pivotGroup(0, 1.632, -0.735);
    addWorld(cover, boxMesh(B(b.x[0] - 0.01, b.x[1] + 0.01, 1.632, 1.652, -0.735, b.z[1] + 0.01), M.walnut, 0.006));
    g.add(cover);
    rig.on('sinkCover', (v) => (cover.rotation.x = -v * 1.45));
    return g;
  },

  'prep-board'(c, { M, rig }) {
    const m = boxMesh(c.box, M.walnut, 0.004);
    const g = new THREE.Group();
    g.add(m);
    rig.on('prepBoard', (v) => (m.position.z = (c.box.z[0] + c.box.z[1]) / 2 + 0.35 * v));
    return g;
  },

  'oh-galley-1': overhead,
  'oh-galley-3': overhead,
  'oh-galley-2'(c, ctx) {
    const b = c.box;
    return overhead({ ...c, box: B(b.x[0], b.x[1], 2.285, b.y[1], b.z[0], b.z[1]) }, ctx);
  },

  'range-hood'(c, { M, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(b, M.brushed, 0.006));
    g.add(boxMesh(B(b.x[0] + 0.03, b.x[1] - 0.03, b.y[0] - 0.002, b.y[0] + 0.002, b.z[0] + 0.03, b.z[1] - 0.05), M.aluDark, 0.002));
    for (const x of [b.x[0] + 0.07, b.x[1] - 0.07]) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), M.lightOn);
      l.rotation.x = Math.PI / 2;
      l.position.set(x, b.y[0] - 0.003, b.z[1] - 0.03);
      g.add(l);
    }
    return g;
  },

  'lagun-table'(c, { M, rig }) {
    const g = new THREE.Group();
    const P = new THREE.Vector2(2.1, -0.3);
    const yT = 1.42;
    const top = new THREE.Group();
    top.add(boxMesh(B(-0.2, 0.2, 0, 0.028, -0.35, 0.35), M.oakFigured, 0.012));
    g.add(top);
    const l1 = new THREE.Mesh(rbox(0.25, 0.03, 0.04, 0.01), M.aluDark);
    const l2 = new THREE.Mesh(rbox(0.25, 0.03, 0.04, 0.01), M.aluDark);
    g.add(l1, l2);
    g.add(boxC(2.115, 1.36, -0.3, 0.03, 0.14, 0.08, M.aluDark, 0.006));
    const S = new THREE.Vector2(2.32, -0.47), D = new THREE.Vector2(2.4, 0.0);
    const place = (v) => {
      const a0 = Math.atan2(S.y - P.y, S.x - P.x), a1 = Math.atan2(D.y - P.y, D.x - P.x);
      const r = lerp(S.distanceTo(P), D.distanceTo(P), v);
      const a = lerp(a0, a1, v);
      const T = new THREE.Vector2(P.x + r * Math.cos(a), P.y + r * Math.sin(a));
      top.position.set(T.x, yT, T.y);
      // two-link arm IK (link 0.25 m)
      const d = Math.min(0.499, T.distanceTo(P));
      const base = Math.atan2(T.y - P.y, T.x - P.x);
      const off = Math.acos(d / 0.5);
      const E = new THREE.Vector2(P.x + 0.25 * Math.cos(base - off), P.y + 0.25 * Math.sin(base - off));
      for (const [m, A, Bv] of [[l1, P, E], [l2, E, T]]) {
        m.position.set((A.x + Bv.x) / 2, yT - 0.03, (A.y + Bv.y) / 2);
        m.rotation.y = -Math.atan2(Bv.y - A.y, Bv.x - A.x);
      }
    };
    place(0);
    rig.on('table', place);
    return g;
  },

  tower(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const fz = b.z[1];
    g.add(boxMesh(B(b.x[0], b.x[1], 1.03, b.y[1], b.z[0], fz - 0.02), M.cabinet, 0.006));
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], 1.03, -0.665, fz - 0.02), M.cabinet, 0.006));
    g.add(boxMesh(B(b.x[1] - 0.018, b.x[1], 1.63, b.y[1], b.z[0], fz), M.cabinetEdge, 0.004));
    g.add(boxMesh(B(b.x[0], b.x[0] + 0.018, b.y[0], b.y[1], -0.665, fz), M.cabinetEdge, 0.004));
    const door = (x0, x1, y0, y1, hingeLeft) => {
      const piv = pivotGroup(hingeLeft ? x0 : x1, 0, fz);
      addWorld(piv, boxMesh(B(x0 + 0.003, x1 - 0.003, y0 + 0.003, y1 - 0.003, fz - 0.02, fz), M.cabinetEdge, 0.006));
      addWorld(piv, boxMesh(B(hingeLeft ? x1 - 0.05 : x0 + 0.03, hingeLeft ? x1 - 0.03 : x0 + 0.05, y0 + 0.05, y0 + 0.2, fz, fz + 0.02), M.trim, 0.004));
      g.add(piv);
      return { piv, s: hingeLeft ? 1 : -1 };
    };
    const doors = [door(b.x[0] + 0.02, b.x[1], b.y[0] + 0.03, 1.29, true), door(b.x[0] + 0.02, 0.235, 1.62, 2.58, true), door(0.245, b.x[1], 1.96, 2.58, false)];
    g.add(boxMesh(B(0.245, b.x[1], 1.62, 1.955, fz - 0.02, fz), M.cabinetEdge, 0.004));
    g.add(boxMesh(B(b.x[0] + 0.02, b.x[1], 1.29, 1.31, fz - 0.4, fz), M.cabinet, 0.002));
    g.add(boxMesh(B(b.x[0] + 0.02, b.x[1], 1.595, 1.615, fz - 0.4, fz), M.cabinet, 0.002));
    // pantry contents
    for (let i = 0; i < 6; i++) g.add(boxC(-0.05 + (i % 3) * 0.2, 1.7 + Math.floor(i / 3) * 0.32, -0.62, 0.1, 0.18, 0.12, foodMats[(i + 2) % foodMats.length], 0.01));
    rig.on('overheads', (v) => doors.forEach(({ piv, s }) => (piv.rotation.y = s * -v * 1.7)));
    return g;
  },

  microwave(c, { M, rig, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], b.z[0], b.z[1] - 0.02), M.steel, 0.008));
    const glow = boxMesh(B(b.x[0] + 0.03, b.x[1] - 0.12, b.y[0] + 0.03, b.y[1] - 0.03, b.z[1] - 0.03, b.z[1] - 0.025), M.lightOn.clone(), 0.002);
    g.add(glow);
    reg.microwaveGlow = glow.material;
    const piv = pivotGroup(b.x[0], 0, b.z[1]);
    addWorld(piv, boxMesh(B(b.x[0] + 0.004, b.x[1] - 0.1, b.y[0] + 0.006, b.y[1] - 0.006, b.z[1] - 0.02, b.z[1]), M.ceramic, 0.006));
    g.add(piv);
    g.add(boxMesh(B(b.x[1] - 0.095, b.x[1] - 0.005, b.y[0] + 0.006, b.y[1] - 0.006, b.z[1] - 0.02, b.z[1]), M.trimGloss, 0.004));
    g.add(boxMesh(B(b.x[1] - 0.08, b.x[1] - 0.02, b.y[1] - 0.07, b.y[1] - 0.04, b.z[1], b.z[1] + 0.002), M.screen, 0.002));
    rig.on('microwaveDoor', (v) => (piv.rotation.y = -v * 1.6));
    return g;
  },

  'cleaning-closet'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    const vac = cyl(0.05, 0.42, M.red);
    vac.position.set(0.2, b.y[0] + 0.24, -0.56);
    g.add(vac);
    g.add(boxC(0.45, b.y[0] + 0.15, -0.56, 0.22, 0.3, 0.03, M.trim, 0.01));
    return g;
  },

  'control-panel'(c, { M, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(b.x[1] - b.x[0] - 0.04, b.y[1] - b.y[0] - 0.04), mat);
    scr.position.set((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, -0.4535);
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], -0.457, -0.455), M.trimGloss, 0.004));
    g.add(scr);
    reg.screen = { canvas, ctx: canvas.getContext('2d'), tex };
    return g;
  },

  'cerbo-gx'(c, { M }) {
    return boxMesh(c.box, M.victron, 0.004);
  },

  'fire-blanket'(c, { M }) {
    return boxMesh(c.box, M.red, 0.012);
  },

  wardrobe(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const fz = b.z[0];
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], fz + 0.02, b.z[1]), M.cabinet, 0.006));
    g.add(boxMesh(B(b.x[1] - 0.018, b.x[1], b.y[0], b.y[1], fz, b.z[1]), M.cabinetEdge, 0.004));
    const doors = [];
    for (const [x0, x1, left] of [[b.x[0], (b.x[0] + b.x[1]) / 2, true], [(b.x[0] + b.x[1]) / 2, b.x[1], false]]) {
      const piv = pivotGroup(left ? x0 : x1, 0, fz);
      addWorld(piv, boxMesh(B(x0 + 0.003, x1 - 0.003, 1.12, b.y[1] - 0.004, fz, fz + 0.02), M.cabinetEdge, 0.006));
      addWorld(piv, boxMesh(B(left ? x1 - 0.05 : x0 + 0.03, left ? x1 - 0.03 : x0 + 0.05, 1.5, 1.7, fz - 0.02, fz), M.trim, 0.004));
      g.add(piv);
      doors.push({ piv, s: left ? 1 : -1 });
    }
    // clothes on rail
    g.add(cylBetween([b.x[0] + 0.03, 2.4, 0.6], [b.x[1] - 0.03, 2.4, 0.6], 0.01, M.steel));
    const cloth = [0x4b6584, 0xa5b1c2, 0x8d6e63, 0x2d3436, 0xd1ccc0, 0x6a8caf];
    for (let i = 0; i < 9; i++) g.add(boxC(b.x[0] + 0.07 + i * 0.065, 2.0, 0.6, 0.04, 0.75, 0.38, new THREE.MeshStandardMaterial({ color: cloth[i % cloth.length], roughness: 0.95 }), 0.015));
    g.add(boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, 1.11, 1.13, fz + 0.02, b.z[1]), M.cabinet, 0.002));
    rig.on('overheads', (v) => doors.forEach(({ piv, s }) => (piv.rotation.y = s * v * 1.6)));
    return g;
  },

  laundry(c, { M, rig }) {
    const g = new THREE.Group();
    const b = c.box;
    const d = new THREE.Group();
    d.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1], b.z[0] - 0.025, b.z[0] - 0.005), M.cabinetEdge, 0.006));
    d.add(boxMesh(B((b.x[0] + b.x[1]) / 2 - 0.09, (b.x[0] + b.x[1]) / 2 + 0.09, b.y[1] - 0.05, b.y[1] - 0.04, b.z[0] - 0.045, b.z[0] - 0.025), M.trim, 0.004));
    d.add(boxMesh(B(b.x[0] + 0.03, (b.x[0] + b.x[1]) / 2, b.y[0] + 0.02, b.y[1] - 0.04, b.z[0] + 0.02, b.z[1] - 0.04), M.fabric, 0.03));
    const bucket = cyl(0.13, 0.25, new THREE.MeshStandardMaterial({ color: 0x4f86c6, roughness: 0.6 }));
    bucket.position.set(b.x[1] - 0.18, b.y[0] + 0.15, (b.z[0] + b.z[1]) / 2);
    d.add(bucket);
    g.add(d);
    rig.on('laundry', (v) => (d.position.z = -0.35 * v));
    return g;
  },

  'extinguisher-galley': extinguisher,
  'extinguisher-bed': extinguisher,
  'extinguisher-cab': extinguisher,

  'emergency-stop'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0] - 0.02, b.x[1] + 0.02, b.y[0] - 0.02, b.y[1] + 0.02, 0.345, 0.355), new THREE.MeshStandardMaterial({ color: 0xf2c418, roughness: 0.5 }), 0.004));
    const btn = cyl(0.025, 0.03, M.red);
    btn.rotation.x = Math.PI / 2;
    btn.position.set((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, 0.33);
    g.add(btn);
    return g;
  },

  wetbath(c, { M, rig, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    const az = b.z[0];
    const dx0 = 0.02, dx1 = 0.57, dy1 = 2.05;
    // aisle wall with door opening (oak outside — looks like cabinetry)
    g.add(boxMesh(B(b.x[0], dx0, b.y[0], b.y[1], az, az + 0.025), M.cabinetEdge, 0.004));
    g.add(boxMesh(B(dx1, b.x[1], b.y[0], b.y[1], az, az + 0.025), M.cabinetEdge, 0.004));
    g.add(boxMesh(B(dx0, dx1, dy1, b.y[1], az, az + 0.025), M.cabinetEdge, 0.004));
    // front & rear walls (GRP), toilet hatch in rear wall
    g.add(boxMesh(B(b.x[1] - 0.025, b.x[1], b.y[0], b.y[1], az + 0.025, b.z[1]), M.grp, 0.004));
    g.add(boxMesh(B(b.x[0], b.x[0] + 0.025, 1.28, b.y[1], az + 0.025, b.z[1]), M.grp, 0.004));
    g.add(boxMesh(B(b.x[0], b.x[0] + 0.025, b.y[0], 1.28, az + 0.025, 0.27), M.grp, 0.004));
    g.add(boxMesh(B(b.x[0], b.x[0] + 0.025, b.y[0], 1.28, 0.66, b.z[1]), M.grp, 0.004));
    const hatch = pivotGroup(b.x[0] + 0.025, 1.28, 0);
    addWorld(hatch, boxMesh(B(b.x[0], b.x[0] + 0.025, 0.8, 1.28, 0.27, 0.66), M.grp, 0.004));
    g.add(hatch);
    // inner GRP lining on the van wall
    g.add(boxMesh(B(b.x[0] + 0.025, b.x[1] - 0.025, b.y[0], 1.9, 0.835, 0.85), M.grp, 0.002));
    // inside: mirror, towel hooks, LED, shelf, drying line
    g.add(boxMesh(B(b.x[1] - 0.03, b.x[1] - 0.025, 1.55, 2.0, 0.35, 0.7), M.chrome, 0.004));
    g.add(boxMesh(B(0.1, 0.4, 1.6, 1.62, 0.78, 0.835), M.grp, 0.004));
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), M.lightOn);
    led.rotation.x = Math.PI / 2;
    led.position.set(0.3, 2.615, 0.2);
    g.add(led);
    g.add(cylBetween([b.x[0] + 0.03, 2.15, 0.3], [b.x[1] - 0.03, 2.15, 0.3], 0.003, M.steel));
    // bi-fold door (2 × 0.275 m leaves) folding into the aisle
    const leafW = (dx1 - dx0) / 2;
    const l1 = pivotGroup(dx1, 0, az);
    addWorld(l1, boxMesh(B(dx1 - leafW, dx1 - 0.002, b.y[0] + 0.01, dy1 - 0.005, az - 0.002, az + 0.02), M.cabinetEdge, 0.006));
    for (let y = 0.8; y < 1.0; y += 0.03) addWorld(l1, boxMesh(B(dx1 - leafW + 0.04, dx1 - 0.04, y, y + 0.012, az - 0.006, az + 0.002), M.aluDark, 0.002));
    const l2 = pivotGroup(-leafW, 0, 0);
    const leaf2 = boxMesh(B(-leafW + 0.002, 0, b.y[0] + 0.01, dy1 - 0.005, -0.002, 0.02), M.cabinetEdge, 0.006);
    l2.add(leaf2);
    l2.add(boxMesh(B(-leafW + 0.03, -leafW + 0.05, 1.3, 1.5, -0.025, -0.002), M.trim, 0.004));
    l1.add(l2);
    g.add(l1);
    rig.on('wetbathDoor', (v) => {
      const th = v * 1.35;
      l1.rotation.y = -th;
      l2.rotation.y = 2 * th;
    });
    rig.on('toilet', (v) => (hatch.rotation.z = -seg(v, 0, 0.3) * 1.5));
    reg.bathLight = led;
    return g;
  },

  'shower-pan'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(b, M.grp, 0.01));
    g.add(boxMesh(B(b.x[0], 0.5, b.y[1], 1.07, 0.665, b.z[1]), M.grp, 0.03)); // moulded arch seat
    const drain = cyl(0.04, 0.004, M.chrome);
    drain.position.set(0.3, b.y[1] + 0.002, 0.45);
    g.add(drain);
    return g;
  },

  'shower-fixtures'(c, { M }) {
    const g = new THREE.Group();
    g.add(cylBetween([-0.115, 1.1, 0.42], [-0.115, 2.2, 0.42], 0.011, M.chrome));
    const head = cyl(0.05, 0.02, M.chrome, 24);
    head.rotation.z = Math.PI / 2 - 0.4;
    head.position.set(-0.085, 2.0, 0.42);
    g.add(head);
    g.add(tube([[-0.11, 1.2, 0.36], [-0.05, 1.05, 0.38], [-0.07, 1.6, 0.42], [-0.09, 1.98, 0.42]], 0.007, M.trim, { corner: 0.12 }));
    const mixer = cyl(0.04, 0.02, M.chrome, 24);
    mixer.rotation.z = Math.PI / 2;
    mixer.position.set(-0.115, 1.22, 0.33);
    g.add(mixer);
    g.add(boxC(-0.09, 1.22, 0.33, 0.04, 0.012, 0.012, M.chrome, 0.004));
    return g;
  },
};

function extinguisher(c, { M }) {
  const g = new THREE.Group();
  const b = c.box;
  const h = b.y[1] - b.y[0];
  const body = cyl(0.045, h - 0.07, M.red);
  body.position.set((b.x[0] + b.x[1]) / 2, b.y[0] + (h - 0.07) / 2, (b.z[0] + b.z[1]) / 2);
  g.add(body);
  const head = boxC(body.position.x, b.y[1] - 0.04, body.position.z, 0.04, 0.06, 0.06, M.trim, 0.008);
  g.add(head);
  return g;
}
