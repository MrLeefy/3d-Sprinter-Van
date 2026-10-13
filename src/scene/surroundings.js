// Surroundings: a ring of distant hills (or desert mesas), pine tree lines, and instanced ground
// cover near the van — grass that sways with the scenario's wind, dry shrubs, rocks, snow mounds.
// Everything is deterministic (seeded) and switched per scenario; none of it is clickable.
import * as THREE from 'three';
import { groundHeight } from './setup.js';

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash1(x) {
  const s = Math.sin(x * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}
function fbm1(x, oct = 5) {
  let a = 0.5, s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise1(x);
    x *= 2.03;
    a *= 0.5;
  }
  return s;
}

/** Polar ring of terrain between r0 and r1; style 'hills' or 'mesa'. */
function horizonGeometry(style, seed) {
  const segA = 360, segR = 14, r0 = 118, r1 = 230;
  const pos = [], col = [], idx = [];
  for (let j = 0; j <= segR; j++) {
    const t = j / segR;
    const r = r0 + (r1 - r0) * t;
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2;
      const u = (i / segA) * 24 + seed;
      let h;
      if (style === 'mesa') {
        const base = fbm1(u * 0.6, 4);
        const plateau = base > 0.52 ? 1 : base > 0.47 ? (base - 0.47) / 0.05 : 0;
        h = 3 + plateau * (18 + 10 * fbm1(u * 0.25 + 7)) + 2 * fbm1(u * 3);
      } else h = 2 + 26 * Math.pow(fbm1(u * 0.5, 5), 1.6) + 3 * fbm1(u * 4);
      const rise = Math.min(1, t * 2.2) * (1 - 0.15 * t);
      pos.push(Math.cos(a) * r, h * rise - 0.4, Math.sin(a) * r);
      const k = 0.75 + 0.25 * Math.min(1, (h * rise) / 20);
      col.push(k, k, k);
      if (i < segA && j < segR) {
        const p = j * (segA + 1) + i;
        idx.push(p, p + 1, p + segA + 1, p + 1, p + segA + 2, p + segA + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Low-poly pine: trunk plus three stacked cones, coloured per vertex (tips can carry snow). */
function pineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.16, 1.4, 6).translate(0, 0.7, 0);
  parts.push([trunk, [0.32, 0.22, 0.14]]);
  for (const [r, h, y] of [[1.5, 2.6, 1.2], [1.15, 2.2, 2.6], [0.75, 1.8, 3.8]]) parts.push([new THREE.ConeGeometry(r, h, 8).translate(0, y + h / 2, 0), [0.13, 0.27, 0.15]]);
  const pos = [], nor = [], col = [], snow = [];
  for (const [g, c] of parts) {
    const ng = g.toNonIndexed();
    const p = ng.attributes.position, n = ng.attributes.normal;
    const foliage = c !== parts[0][1];
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(...c);
      // winter variant: upward-facing needles carry snow
      const k = foliage ? Math.min(1, Math.max(0, n.getY(i)) * 1.6) : 0;
      snow.push(c[0] + (0.95 - c[0]) * k, c[1] + (0.97 - c[1]) * k, c[2] + (1.0 - c[2]) * k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.userData.colors = { green: new Float32Array(col), snow: new Float32Array(snow) };
  return g;
}

/** A tuft of tapered grass blades leaning outward; normals bent upward for soft lighting. */
function tuftGeometry(seed, blades = 12) {
  const rnd = prng(seed);
  const pos = [], nor = [], col = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd() * 0.6;
    const h = 0.09 + rnd() * 0.16, w = 0.01 + rnd() * 0.008, lean = 0.04 + rnd() * 0.08;
    const cx = Math.cos(a), cz = Math.sin(a);
    const ox = cx * rnd() * 0.05, oz = cz * rnd() * 0.05; // blades spread over a small clump
    const px = -cz * w, pz = cx * w;
    const tip = [ox + cx * lean, h, oz + cz * lean];
    const v = [[ox + px, 0, oz + pz], [ox - px, 0, oz - pz], tip];
    for (const p of v) pos.push(...p);
    const n = new THREE.Vector3(cx, 2.2, cz).normalize();
    for (let k = 0; k < 3; k++) nor.push(n.x, n.y, n.z);
    col.push(0.45, 0.5, 0.42, 0.45, 0.5, 0.42, 1.15, 1.15, 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const rnd = prng(seed);
  const bump = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!bump.has(key)) bump.set(key, 0.78 + rnd() * 0.4);
    const k = bump.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.62, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

// Scenario dressing: horizon style & tint, tree tint, ground-cover counts and tints
const DRESS = {
  summer: { horizon: 'mesa', hillTint: 0xb98a5e, trees: 0, grass: 0, shrubs: 700, shrubTint: 0xb39a6a, rocks: 260, rockTint: 0xa88e74 },
  winter: { horizon: 'hills', hillTint: 0xe8eef4, trees: 260, treeTint: 0xffffff, grass: 0, shrubs: 80, shrubTint: 0x8a7d66, rocks: 70, rockTint: 0x6e6a66 },
  rain: { horizon: 'hills', hillTint: 0x55624e, trees: 280, treeTint: 0x6f7e70, grass: 6000, grassTint: 0x6f8a52, shrubs: 0, rocks: 120, rockTint: 0x5c5853 },
  humid: { horizon: 'hills', hillTint: 0x6a8a52, trees: 320, treeTint: 0x9db08e, grass: 7000, grassTint: 0x8fb05a, shrubs: 0, rocks: 60, rockTint: 0x8a8278 },
  overnight: { horizon: 'hills', hillTint: 0x6b7a56, trees: 300, treeTint: 0x8f9f86, grass: 5500, grassTint: 0x9aa868, shrubs: 120, shrubTint: 0xa69a6e, rocks: 140, rockTint: 0x8c8479 },
  multiday: { horizon: 'hills', hillTint: 0x748658, trees: 300, treeTint: 0x95a68a, grass: 6000, grassTint: 0x98ae62, shrubs: 100, shrubTint: 0xa69a6e, rocks: 120, rockTint: 0x8c8479 },
};

export class Surroundings {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'surroundings';
    scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
    // horizon
    this.hillMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0x6a8a52 });
    this.hills = new THREE.Mesh(horizonGeometry('hills', 3.7), this.hillMat);
    this.mesas = new THREE.Mesh(horizonGeometry('mesa', 11.3), this.hillMat);
    for (const m of [this.hills, this.mesas]) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    // trees in clusters between 55 and 115 m
    const rnd = prng(7);
    this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: 0x9db08e });
    this.trees = new THREE.InstancedMesh(pineGeometry(), this.treeMat, 320);
    const o = new THREE.Object3D();
    const clusters = Array.from({ length: 40 }, () => ({ a: rnd() * Math.PI * 2, r: 48 + rnd() * 60 }));
    for (let i = 0; i < 320; i++) {
      const c = clusters[i % clusters.length];
      const a = c.a + (rnd() - 0.5) * 0.22, r = c.r + (rnd() - 0.5) * 16;
      const s = 0.7 + rnd() * 1.1;
      o.position.set(Math.cos(a) * r, groundHeight(Math.cos(a) * r, Math.sin(a) * r) - 0.2, Math.sin(a) * r);
      o.rotation.set(0, rnd() * 6.28, (rnd() - 0.5) * 0.06);
      o.scale.set(s, s * (0.85 + rnd() * 0.4), s);
      o.updateMatrix();
      this.trees.setMatrixAt(i, o.matrix);
    }
    this.group.add(this.trees);
    // near ground cover
    const near = (n, seed, rMin, rMax, scale, sink = 0) => {
      const r2 = prng(seed);
      const mats = [];
      let tries = 0;
      while (mats.length < n && tries++ < n * 20) {
        const a = r2() * Math.PI * 2;
        const r = rMin + Math.pow(r2(), 1.35) * (rMax - rMin);
        const x = 1.8 + Math.cos(a) * r, z = Math.sin(a) * r;
        if (x > -3.1 && x < 6.1 && z > -1.8 && z < 3.9) continue; // keep the van, awning and kitchen clear
        const s = scale[0] + r2() * (scale[1] - scale[0]);
        o.position.set(x, groundHeight(x, z) - sink * s, z);
        o.rotation.set((r2() - 0.5) * 0.3, r2() * 6.28, (r2() - 0.5) * 0.3);
        o.scale.set(s, s * (0.8 + r2() * 0.5), s);
        o.updateMatrix();
        mats.push(o.matrix.clone());
      }
      return mats;
    };
    const tint = new THREE.Color();
    const place = (mesh, mats, vary = 0) => {
      mats.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        if (vary) mesh.setColorAt(i, tint.setScalar(1 - vary + Math.random() * vary * 1.6));
      });
      mesh.count = mats.length;
      mesh.userData.max = mats.length;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, color: 0x8fb05a });
    this.grassMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.uniforms.uWind = this.uniforms.uWind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float sway = sin(uTime * 1.9 + ip.x * 0.37 + ip.z * 0.29) * 0.6 + sin(uTime * 3.3 + ip.x * 0.9 - ip.z * 0.4) * 0.3;
        transformed.x += sway * uWind * position.y * 0.45;
        transformed.z += sway * uWind * position.y * 0.25;`,
      );
    };
    this.grass = place(new THREE.InstancedMesh(tuftGeometry(5), this.grassMat, 7000), near(7000, 21, 2.0, 30, [0.9, 1.8]), 0.3);
    this.shrubMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, color: 0xb39a6a });
    this.shrubMat.onBeforeCompile = this.grassMat.onBeforeCompile;
    this.shrubs = place(new THREE.InstancedMesh(tuftGeometry(9, 16), this.shrubMat, 700), near(700, 33, 2.6, 40, [1.2, 2.8]), 0.35);
    this.rockMat = new THREE.MeshStandardMaterial({ roughness: 0.92, color: 0x8c8479, flatShading: true });
    this.rocks = place(new THREE.InstancedMesh(rockGeometry(4), this.rockMat, 320), near(320, 45, 2.6, 40, [0.05, 0.34], 0.25), 0.3);
    this.rocks.castShadow = true;
    this.scnId = null;
  }

  setScenario(id, wx) {
    const d = DRESS[id] || DRESS.multiday;
    this.uniforms.uWind.value = Math.min(1.2, 0.15 + (wx?.wind ?? 3) / 9);
    if (this.scnId === id) return;
    this.scnId = id;
    this.hills.visible = d.horizon === 'hills';
    this.mesas.visible = d.horizon === 'mesa';
    this.hillMat.color.set(d.hillTint);
    this.trees.count = d.trees;
    this.trees.visible = d.trees > 0;
    if (d.treeTint) this.treeMat.color.set(d.treeTint);
    const tc = this.trees.geometry.attributes.color;
    tc.array.set(this.trees.geometry.userData.colors[id === 'winter' ? 'snow' : 'green']);
    tc.needsUpdate = true;
    this.grass.count = Math.min(d.grass, this.grass.userData.max);
    this.grass.visible = d.grass > 0;
    if (d.grassTint) this.grassMat.color.set(d.grassTint);
    this.shrubs.count = Math.min(d.shrubs, this.shrubs.userData.max);
    this.shrubs.visible = d.shrubs > 0;
    if (d.shrubTint) this.shrubMat.color.set(d.shrubTint);
    this.rocks.count = Math.min(d.rocks, this.rocks.userData.max);
    this.rockMat.color.set(d.rockTint);
  }

  /** Night and overcast dim the vertex-coloured dressing a little more than the PBR lights alone. */
  update(dt) {
    this.uniforms.uTime.value += dt;
  }
}
