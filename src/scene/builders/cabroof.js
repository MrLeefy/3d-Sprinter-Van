// Cab, ceiling, roof, exterior and underbody builders.
import * as THREE from 'three';
import { boxMesh, boxC, B, cylBetween, pivotGroup, addWorld, rbox } from '../geom.js';
import { seg, lerp } from './common.js';
import { CAB } from '../../data/vehicle.js';

const cyl = (r, h, mat, s = 20) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, s), mat);
  m.castShadow = true;
  return m;
};

function seat(side) {
  return (c, { M, rig }) => {
    const g = new THREE.Group();
    const z = side * Math.abs(CAB.driverZ);
    g.add(boxMesh(B(2.9, 3.3, 0.7, 0.98, z - 0.24, z + 0.24), M.trim, 0.02));
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 32), M.aluDark);
    ring.position.set(CAB.seatPivotX, 0.995, z);
    g.add(ring);
    const s = pivotGroup(CAB.seatPivotX, 0, z);
    addWorld(s, boxMesh(B(2.86, 3.36, 1.0, 1.17, z - 0.26, z + 0.26), M.leather, 0.06));
    const back = pivotGroup(2.9, 1.15, z);
    addWorld(back, boxMesh(B(2.84, 2.96, 1.15, 1.9, z - 0.26, z + 0.26), M.leather, 0.06));
    addWorld(back, boxMesh(B(2.85, 2.95, 1.92, 2.12, z - 0.14, z + 0.14), M.leather, 0.05));
    back.rotation.z = 0.18;
    back.position.set(2.9 - CAB.seatPivotX, 1.15, 0); // re-base into the swivel group
    s.add(back);
    for (const dz of [-0.3, 0.3]) addWorld(s, boxMesh(B(2.95, 3.3, 1.3, 1.36, z + dz - 0.03, z + dz + 0.03), M.trim, 0.02));
    g.add(s);
    rig.on('seatSwivel', (v) => (s.rotation.y = side * v * Math.PI));
    return g;
  };
}

export const cabRoofBuilders = {
  'seat-driver': seat(-1),
  'seat-passenger': seat(1),

  'ac-plenum'(c, { M, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0], b.y[1] - 0.005, b.z[0], b.z[1]), M.white, 0.02));
    for (let i = 0; i < 6; i++) {
      const x = -1.18 + i * 0.022;
      g.add(boxMesh(B(x, x + 0.01, b.y[0] - 0.003, b.y[0] + 0.002, -0.22, 0.22), M.aluDark, 0.002));
    }
    for (const z of [-0.33, 0.33]) for (const x of [-1.2, -0.66]) g.add(boxMesh(B(x - 0.06, x + 0.06, b.y[0] - 0.004, b.y[0] + 0.002, z - 0.04, z + 0.04), M.trim, 0.004));
    g.add(boxMesh(B(-0.98, -0.88, b.y[0] - 0.004, b.y[0] + 0.002, -0.12, 0.12), M.trim, 0.002));
    reg.acLouvres = g;
    return g;
  },

  'ac-duct'(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(b, M.white, 0.012));
    for (const x of [0.2, 1.2, 2.2]) g.add(boxMesh(B(x - 0.15, x + 0.15, b.y[0] - 0.003, b.y[0] + 0.001, -0.15, -0.05), M.trim, 0.002));
    return g;
  },

  'fresh-air-inlet'(c, { M }) {
    const g = new THREE.Group();
    g.add(boxMesh(B(2.32, 2.58, 2.6, 2.618, 0.12, 0.38), M.white, 0.006));
    for (let x = 2.35; x < 2.56; x += 0.03) g.add(boxMesh(B(x, x + 0.012, 2.596, 2.6, 0.14, 0.36), M.aluDark, 0.001));
    const cowl = boxMesh(B(2.35, 2.56, 2.725, 2.8, 0.14, 0.36), M.white, 0.03);
    g.add(cowl);
    g.add(boxMesh(B(2.555, 2.565, 2.735, 2.79, 0.16, 0.34), M.trim, 0.002));
    return g;
  },

  'smoke-co-alarm': alarm,
  'co-alarm-bed': alarm,

  'outlets-bed'(c, { M, reg }) {
    const g = new THREE.Group();
    g.add(boxMesh(B(-0.17, -0.15, 1.75, 1.85, 0.3, 0.42), M.white, 0.004));
    // gooseneck reading lights
    for (const [x, z] of [[-1.06, 0.6], [-1.06, -0.62]]) {
      g.add(cylBetween([x, 2.2, z], [x + 0.06, 2.1, z], 0.006, M.trim));
      const head = cyl(0.025, 0.03, M.trim);
      head.position.set(x + 0.08, 2.08, z);
      g.add(head);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), M.lightOn);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(x + 0.08, 2.064, z);
      g.add(lens);
    }
    return g;
  },
  'outlets-galley'() {
    return new THREE.Group();
  },
  'outlets-dinette'(c, { M }) {
    return boxMesh(B(2.1, 2.115, 1.2, 1.3, -0.6, -0.48), M.white, 0.003);
  },

  lighting(c, { M, reg }) {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.035, 0.035, 0.008, 20);
    for (const x of [-1.25, -0.75, 0.3, 1.0, 1.7, 2.45]) {
      for (const z of [-0.42, 0.42]) {
        if (x > -0.2 && x < 0.66 && z > 0) continue; // wet bath has its own light
        const p = new THREE.Mesh(geo, M.lightOn);
        p.position.set(x, 2.616, z);
        g.add(p);
      }
    }
    // cove strip along the ceiling edges
    for (const s of [-1, 1]) {
      const strip = boxMesh(B(-1.4, 2.6, 2.6, 2.606, s * 0.735 - 0.006, s * 0.735 + 0.006), M.ledStrip, 0.002, { cast: false });
      g.add(strip);
      reg.ledStrips.push(strip);
    }
    return g;
  },

  'window-covers'(c, { M, rig, body }) {
    const g = new THREE.Group();
    const covers = [];
    const add = (mesh, parent = g) => {
      mesh.userData.cid = 'window-covers';
      mesh.userData.kind = 'component';
      parent.add(mesh);
      covers.push(mesh);
      return mesh;
    };
    // windshield (inside)
    const wsGeo = new THREE.PlaneGeometry(1.8, 1.12);
    wsGeo.rotateY(Math.PI / 2);
    wsGeo.rotateZ(Math.atan2(0.58, 1.02));
    const ws = new THREE.Mesh(wsGeo, M.coverSilver);
    ws.position.set(4.14, 1.74, 0);
    add(ws);
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape([new THREE.Vector2(2.98, 1.42), new THREE.Vector2(4.28, 1.42), new THREE.Vector2(3.86, 2.16), new THREE.Vector2(3.02, 2.16)]);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), M.cover);
      m.position.z = s * 0.965;
      m.material.side = THREE.DoubleSide;
      add(m);
    }
    // sliding-door window cover rides with the door
    const sdc = boxMesh(B(1.55, 2.38, 1.56, 2.21, 0.96, 0.975), M.cover, 0.004);
    add(sdc, body.parts.slidingDoor);
    // rear windows (on the door groups, local coords)
    for (const [k, s] of [['rearDoorDrv', -1], ['rearDoorPass', 1]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.56, 0.67), M.cover);
      m.position.set(0.02, 2.07, -s * 0.625);
      add(m, body.parts[k]);
    }
    rig.on('covers', (v) => covers.forEach((m) => (m.visible = v > 0.02) && m.scale.set(1, Math.max(0.02, v), 1)));
    return g;
  },

  insulation() {
    return new THREE.Group();
  },

  'solar-1': solar, 'solar-2': solar, 'solar-3': solar,

  'rooftop-ac'(c, { M, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, b.y[0], b.y[0] + 0.03, b.z[0] + 0.02, b.z[1] - 0.02), M.rubber, 0.01));
    g.add(boxMesh(B(b.x[0], b.x[1], b.y[0] + 0.03, b.y[1], b.z[0], b.z[1]), M.white, 0.09));
    for (const s of [-1, 1]) for (let x = b.x[0] + 0.12; x < b.x[1] - 0.12; x += 0.05) g.add(boxMesh(B(x, x + 0.025, b.y[0] + 0.08, b.y[1] - 0.08, s * (b.z[1] + 0.001) - 0.005, s * (b.z[1] + 0.001) + 0.005), M.aluDark, 0.003));
    const fan = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = boxC(0, 0, 0, 0.2, 0.004, 0.05, M.trim, 0.002);
      blade.position.x = 0.1;
      const h = new THREE.Group();
      h.add(blade);
      h.rotation.y = (i * Math.PI) / 2;
      fan.add(h);
    }
    fan.position.set((b.x[0] + b.x[1]) / 2, b.y[1] + 0.002, 0);
    g.add(fan);
    const grille = new THREE.Mesh(new THREE.CircleGeometry(0.23, 30), M.aluDark);
    grille.rotation.x = -Math.PI / 2;
    grille.position.set(fan.position.x, b.y[1] + 0.001, 0);
    g.add(grille);
    reg.fans.push({ obj: fan, load: 'ac', axis: 'y' });
    return g;
  },

  'fan-main': maxxfan('fanMain'),
  'fan-bath': maxxfan('fanBath'),

  'hood-vent': mushroom,
  'toilet-vent': mushroom,

  starlink(c, { M }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(B(b.x[0] + 0.05, b.x[1] - 0.05, 2.885, 2.9, b.z[0] + 0.05, b.z[1] - 0.05), M.alu, 0.004));
    const dish = boxMesh(B(b.x[0], b.x[1], 2.9, 2.925, b.z[0], b.z[1]), M.white, 0.015);
    dish.rotation.z = 0.08;
    g.add(dish);
    return g;
  },

  awning(c, { M, rig, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    g.add(boxMesh(b, M.white, 0.04));
    for (const x of [b.x[0] + 0.2, b.x[1] - 0.2]) g.add(boxMesh(B(x - 0.04, x + 0.04, 2.7, 2.9, 0.7, 0.95), M.alu, 0.006));
    const L = b.x[1] - b.x[0] - 0.1;
    const fabric = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), M.awning);
    fabric.castShadow = true;
    fabric.receiveShadow = true;
    g.add(fabric);
    const bar = boxMesh(B(b.x[0] + 0.05, b.x[1] - 0.05, -0.03, 0.03, -0.035, 0.035), M.white, 0.01);
    g.add(bar);
    const ledStrip = boxMesh(B(b.x[0] + 0.1, b.x[1] - 0.1, -0.036, -0.03, -0.01, 0.01), M.ledStrip, 0.002, { cast: false });
    bar.add(ledStrip);
    reg.ledStrips.push(ledStrip);
    const arms = [];
    for (const x of [b.x[0] + 0.25, b.x[1] - 0.25]) {
      const a = new THREE.Mesh(rbox(0.04, 0.04, 1, 0.01), M.alu);
      g.add(a);
      arms.push({ m: a, x });
    }
    const legs = [];
    for (const x of [b.x[0] + 0.1, b.x[1] - 0.1]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 10), M.alu);
      g.add(l);
      legs.push({ m: l, x });
    }
    // warm camp light hung from the roller, aimed down and out over the living area
    const spot = new THREE.SpotLight(0xffc27a, 0, 9, 1.05, 0.85, 1.6);
    spot.position.set((b.x[0] + b.x[1]) / 2, 2.55, 1.15);
    spot.target.position.set((b.x[0] + b.x[1]) / 2, 0, 2.9);
    g.add(spot, spot.target);
    reg.awningLight = spot;
    const z0 = 1.0, y0 = 2.66;
    rig.on('awning', (v) => {
      const ext = 2.5 * v;
      const zf = z0 + ext, yf = y0 - 0.41 * v;
      const show = v > 0.01;
      fabric.visible = bar.visible = show;
      if (show) {
        const len = Math.hypot(ext, y0 - yf);
        fabric.scale.set(L, Math.max(0.001, len), 1);
        fabric.position.set((b.x[0] + b.x[1]) / 2, (y0 + yf) / 2, (z0 + zf) / 2);
        fabric.rotation.set(-Math.PI / 2 + Math.atan2(y0 - yf, ext), 0, 0);
      }
      bar.position.set(0, yf, zf);
      for (const { m, x } of arms) {
        m.visible = show;
        const len = Math.hypot(ext * 0.92, 0.25 + (y0 - yf));
        m.scale.set(1, 1, Math.max(0.001, len));
        m.position.set(x, (y0 - 0.25 + yf) / 2, (z0 + 0.02 + zf) / 2);
        m.rotation.x = Math.atan2(y0 - 0.25 - yf, ext);
      }
      for (const { m, x } of legs) {
        const lv = seg(v, 0.8, 1);
        m.visible = lv > 0;
        const h = yf * lv;
        m.scale.set(1, Math.max(0.001, h), 1);
        m.position.set(x, yf - h / 2, zf - 0.03);
      }
    });
    return g;
  },

  'grey-tank'(c, { M, reg }) {
    const g = new THREE.Group();
    const b = c.box;
    const jacket = new THREE.MeshStandardMaterial({ color: 0x4d545c, roughness: 0.95, transparent: true, opacity: 0.55, depthWrite: false });
    g.add(boxMesh(b, jacket, 0.03, { cast: false }));
    const water = boxMesh(B(b.x[0] + 0.03, b.x[1] - 0.03, b.y[0] + 0.03, b.y[1] - 0.03, b.z[0] + 0.03, b.z[1] - 0.03), M.greyWater, 0.02, { cast: false });
    water.geometry = water.geometry.clone();
    water.geometry.translate(0, (b.y[1] - b.y[0] - 0.06) / 2, 0);
    water.position.y = b.y[0] + 0.03;
    g.add(water);
    reg.levels.grey = { mesh: water };
    g.add(boxMesh(B(b.x[0] + 0.1, b.x[1] - 0.1, b.y[0] - 0.006, b.y[0], b.z[0] + 0.1, b.z[1] - 0.1), M.red, 0.002)); // heat pad
    return g;
  },
  'grey-dump'(c, { M }) {
    const g = new THREE.Group();
    g.add(cylBetween([c.box.x[0], 0.42, 0.6], [c.box.x[1], 0.42, 0.6], 0.025, M.trim));
    g.add(boxC(c.box.x[1] - 0.03, 0.47, 0.6, 0.03, 0.08, 0.06, M.aluDark, 0.006));
    return g;
  },
  'fuel-tank'(c, { M }) {
    return boxMesh(c.box, M.trimGloss, 0.05);
  },
  'heater-fuel-pump'(c, { M }) {
    const m = cyl(0.025, 0.12, M.trim);
    m.rotation.z = 1.2;
    m.position.set(0.17, 0.48, -0.28);
    return m;
  },
  'starter-battery'(c, { M }) {
    return boxMesh(c.box, M.battery, 0.01);
  },
  'roof-rack'() {
    return new THREE.Group();
  },
  'sliding-door'() {
    return new THREE.Group();
  },
  'rear-doors'() {
    return new THREE.Group();
  },

  'rear-door-table'(c, { M, rig, body }) {
    // On the passenger door (local frame: x = door inner face normal, z = lateral, y = up)
    const door = body.parts.rearDoorPass;
    const g = new THREE.Group();
    const piv = new THREE.Group();
    piv.position.set(0.03, 0.95, -0.6);
    const top = boxMesh(B(0, 0.4, -0.02, 0.0, -0.26, 0.26), M.oak, 0.006);
    piv.add(top);
    const brace = cylBetween([0.02, -0.25, 0], [0.32, -0.02, 0], 0.008, M.steel);
    piv.add(brace);
    door.add(piv);
    top.userData.cid = brace.userData.cid = 'rear-door-table';
    top.userData.kind = brace.userData.kind = 'component';
    rig.on('rearTable', (v) => {
      piv.rotation.z = (1 - v) * (Math.PI / 2);
      brace.visible = v > 0.8;
    });
    return g;
  },
  'rear-door-bench'(c, { M, rig, body }) {
    const door = body.parts.rearDoorDrv;
    const g = new THREE.Group();
    const piv = new THREE.Group();
    piv.position.set(0.03, 0.47, 0.6);
    const seatM = boxMesh(B(0, 0.34, -0.03, 0.0, -0.26, 0.26), M.oak, 0.008);
    piv.add(seatM);
    const legs = [];
    for (const z of [-0.22, 0.22]) {
      const l = cylBetween([0.3, -0.03, z], [0.3, -0.47, z], 0.01, M.alu);
      piv.add(l);
      legs.push(l);
    }
    door.add(piv);
    for (const m of [seatM, ...legs]) {
      m.userData.cid = 'rear-door-bench';
      m.userData.kind = 'component';
    }
    rig.on('rearTable', (v) => {
      piv.rotation.z = (1 - v) * (Math.PI / 2);
      legs.forEach((l) => (l.visible = v > 0.85));
    });
    return g;
  },

  'leak-sensors'(c, { M }) {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.02, 0.02, 0.012, 14);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c7ed6, roughness: 0.5, emissive: 0x0b3d6e, emissiveIntensity: 0.6 });
    for (const p of [[-1.35, 0.745, 0.55], [-0.5, 0.745, -0.1], [0.3, 0.806, 0.2], [1.9, 0.806, -0.45], [-0.85, 0.745, 0.35]]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...p);
      g.add(m);
    }
    return g;
  },
};

function alarm(c, { M }) {
  const m = cyl(0.055, 0.03, M.white, 24);
  m.position.set((c.box.x[0] + c.box.x[1]) / 2, c.box.y[1] - 0.015, (c.box.z[0] + c.box.z[1]) / 2);
  return m;
}

function solar(c, { M }) {
  const g = new THREE.Group();
  const b = c.box;
  g.add(boxMesh(b, M.alu, 0.004));
  g.add(boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, b.y[1] - 0.004, b.y[1] + 0.001, b.z[0] + 0.02, b.z[1] - 0.02), M.solar, 0.002));
  return g;
}

function mushroom(c, { M }) {
  const g = new THREE.Group();
  const b = c.box;
  const cx = (b.x[0] + b.x[1]) / 2, cz = (b.z[0] + b.z[1]) / 2;
  const r = Math.min(b.x[1] - b.x[0], b.z[1] - b.z[0]) / 2;
  const stem = cyl(r * 0.5, b.y[1] - 2.725, M.white);
  stem.position.set(cx, (2.725 + b.y[1]) / 2, cz);
  g.add(stem);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
  cap.position.set(cx, b.y[1] - r * 0.6, cz);
  cap.castShadow = true;
  g.add(cap);
  const grille = cyl(r * 0.6, 0.01, M.white);
  grille.position.set(cx, 2.615, cz);
  g.add(grille);
  return g;
}

function maxxfan(load) {
  return (c, { M, reg }) => {
    const g = new THREE.Group();
    const b = c.box;
    const cx = (b.x[0] + b.x[1]) / 2, cz = (b.z[0] + b.z[1]) / 2;
    const smoke = new THREE.MeshPhysicalMaterial({ color: 0x2b2f35, roughness: 0.15, transparent: true, opacity: 0.75 });
    g.add(boxMesh(B(b.x[0], b.x[1], 2.725, 2.75, b.z[0], b.z[1]), M.white, 0.01));
    g.add(boxMesh(B(b.x[0] + 0.02, b.x[1] - 0.02, 2.75, b.y[1], b.z[0] + 0.02, b.z[1] - 0.02), smoke, 0.05));
    // interior trim & screen
    g.add(boxMesh(B(cx - 0.21, cx + 0.21, 2.6, 2.618, cz - 0.21, cz + 0.21), M.white, 0.01));
    g.add(boxMesh(B(cx - 0.17, cx + 0.17, 2.598, 2.6, cz - 0.17, cz + 0.17), M.aluDark, 0.002));
    const fan = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const h = new THREE.Group();
      const blade = boxC(0.075, 0, 0, 0.13, 0.004, 0.05, M.trim, 0.002);
      blade.rotation.x = 0.4;
      h.add(blade);
      h.rotation.y = (i * Math.PI) / 3;
      fan.add(h);
    }
    fan.position.set(cx, 2.65, cz);
    g.add(fan);
    reg.fans.push({ obj: fan, load, axis: 'y' });
    return g;
  };
}
