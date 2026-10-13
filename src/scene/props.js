// Soft furnishings and small lived-in props. Purely visual: each prop is parented to the catalogue
// component it rests on, so x-ray ghosting, the exploded view and the infrared camera treat it with
// its host. Nothing here takes part in the engineering checks.
import * as THREE from 'three';

/**
 * Quilted duvet draped over a mattress section. Extents in world metres; `drape` lists which edges
 * hang over ({x0, x1, z0} drop lengths); `fold` turns the head edge (z1) back into a roll.
 */
export function duvetGeometry({ x0, x1, z0, z1, y, drape = {}, fold = true, seed = 1 }) {
  const R = 0.035;
  const dx0 = drape.x0 || 0, dx1 = drape.x1 || 0, dz0 = drape.z0 || 0;
  const sx = 36, sz = 40;
  const g = new THREE.PlaneGeometry(1, 1, sx, sz);
  const p = g.attributes.position;
  const rnd = (a, b) => Math.sin(a * 12.9898 + b * 78.233 + seed * 3.1) * 0.5 + 0.5;
  const wrinkle = (u, v) => 0.0045 * Math.sin(u * 23 + seed) * Math.sin(v * 17 + 2 * seed) + 0.003 * Math.sin(u * 51 + v * 9 + seed);
  // map a 1-D coordinate across "drop | top | drop" into (lateral, height)
  const edge = (t, a, b, da, db) => {
    const la = da > 0 ? (Math.PI / 2) * R + da : 0, lb = db > 0 ? (Math.PI / 2) * R + db : 0;
    const L = la + (b - a) + lb;
    const s = t * L;
    if (s < la) {
      const d = la - s; // distance from the top edge, going outward and down
      if (d < (Math.PI / 2) * R) {
        const th = d / R;
        return [a - R * Math.sin(th), -R * (1 - Math.cos(th))];
      }
      return [a - R - 0.004 * (d - (Math.PI / 2) * R), -R - (d - (Math.PI / 2) * R)];
    }
    if (s > la + (b - a)) {
      const d = s - la - (b - a);
      if (d < (Math.PI / 2) * R) {
        const th = d / R;
        return [b + R * Math.sin(th), -R * (1 - Math.cos(th))];
      }
      return [b + R + 0.004 * (d - (Math.PI / 2) * R), -R - (d - (Math.PI / 2) * R)];
    }
    return [a + (s - la), 0];
  };
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5; // u across x, v along z
    const [X, hx] = edge(u, x0, x1, dx0, dx1);
    const [Z, hz] = edge(v, z0, z1, dz0, 0);
    const onTop = hx === 0 && hz === 0;
    const quilt = onTop ? 0.011 * Math.abs(Math.sin(((X - x0) / 0.22) * Math.PI) * Math.sin(((Z - z0) / 0.22) * Math.PI)) : 0;
    let Y = y + 0.022 + quilt + wrinkle(u, v) + hx + hz + (onTop ? 0.006 * (rnd(Math.round(u * 6), Math.round(v * 6)) - 0.5) : 0);
    // turned-back roll at the head edge
    if (fold && v > 0.9) {
      const f = (v - 0.9) / 0.1;
      Y += 0.035 * Math.sin(f * Math.PI);
    }
    p.setXYZ(i, X, Y, Z);
  }
  g.computeVertexNormals();
  return g;
}

/** Plump pillow: a subdivided box pinched to soft seams, with a slight head dent. */
export function pillowGeometry(w, h, d, dent = 0.25) {
  const g = new THREE.BoxGeometry(1, 1, 1, 18, 6, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = 2 * x, nz = 2 * z;
    const t = Math.sqrt(Math.max(0, 1 - nx ** 6)) * Math.sqrt(Math.max(0, 1 - nz ** 6));
    y *= 0.12 + 0.88 * t;
    if (y > 0) y -= dent * 0.5 * Math.exp(-(nx * nx + nz * nz) / 0.25) * t;
    const bulge = 1 + 0.08 * (1 - (2 * y) ** 2);
    x *= bulge;
    z *= bulge;
    p.setXYZ(i, x * w, y * h, z * d);
  }
  g.computeVertexNormals();
  return g;
}

function mesh(geo, mat, cid, { cast = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  m.userData.cid = cid;
  m.userData.kind = 'component';
  return m;
}

/** Small lived-in details, attached to their host components. */
export function addProps(world) {
  const { M, comps } = world;
  const host = (id) => comps.index.get(id);
  // Woven runner along the aisle (sits on the finished floor)
  {
    const g = host('galley-base');
    const rug = mesh(new THREE.BoxGeometry(1.9, 0.006, 0.26), M.rug, 'galley-base', { cast: false });
    rug.position.set(1.05, 0.733, -0.1);
    for (const dz of [-0.11, 0.11]) {
      const band = mesh(new THREE.BoxGeometry(1.88, 0.0065, 0.018), M.rugBand, 'galley-base', { cast: false });
      band.position.set(1.05, 0.7335, -0.1 + dz);
      g.add(band);
    }
    g.add(rug);
  }
  // Herb pot and a mug on the counter, against the backsplash
  {
    const g = host('countertop');
    const top = 1.63;
    const pot = mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.1, 28), M.ceramicWhite, 'countertop');
    pot.position.set(1.245, top + 0.05, -0.79);
    g.add(pot);
    const soil = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 24), M.soil, 'countertop');
    soil.position.set(1.245, top + 0.095, -0.79);
    g.add(soil);
    const leafGeo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 11; i++) {
      const a = i * 2.39996, r = 0.012 + (i % 4) * 0.008;
      const leaf = mesh(leafGeo, M.leaf, 'countertop');
      leaf.scale.set(0.011, 0.05 + (i % 3) * 0.012, 0.007);
      leaf.position.set(1.245 + Math.cos(a) * r, top + 0.13 + (i % 3) * 0.01, -0.79 + Math.sin(a) * r);
      leaf.rotation.set(Math.sin(a) * 0.55, a, Math.cos(a) * 0.55);
      g.add(leaf);
    }
    const mugPts = [];
    for (let k = 0; k <= 10; k++) mugPts.push(new THREE.Vector2(k < 1 ? 0 : 0.038 + (k === 10 ? -0.004 : 0), k < 1 ? 0 : (k / 10) * 0.09));
    const mug = mesh(new THREE.LatheGeometry(mugPts, 28), M.ceramicGlaze, 'countertop');
    mug.position.set(1.66, top, -0.8);
    g.add(mug);
    const handle = mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 20, Math.PI * 1.2), M.ceramicGlaze, 'countertop');
    handle.position.set(1.66 + 0.04, top + 0.045, -0.8);
    handle.rotation.z = -Math.PI * 0.6;
    g.add(handle);
  }
}
