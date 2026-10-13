// Instanced vegetation and rock geometry + season-aware materials.
import * as THREE from 'three';
import { prng } from '../world/noise.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));

/** Conifer: trunk + five tiers of cones (≈ 13 m). Colour sets: `green` and `snow` (snow-laden needles). */
export function conifer() {
  const dark = lin([0.14, 0.31, 0.17]), trunk = lin([0.3, 0.21, 0.14]);
  const parts = [[new THREE.CylinderGeometry(0.16, 0.26, 2.8, 6).translate(0, 1.4, 0), trunk, false]];
  const tiers = [[2.3, 3.4, 2.2], [1.95, 3.1, 4.3], [1.55, 2.8, 6.3], [1.15, 2.5, 8.2], [0.7, 2.3, 9.9]];
  for (const [r, h, y] of tiers) parts.push([new THREE.ConeGeometry(r, h, 8).translate(0, y + h / 2 - 0.4, 0), dark, true]);
  const pos = [], nor = [], col = [], snow = [];
  for (const [g, c, foliage] of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.attributes.position, n = ng.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const v = foliage ? 0.8 + 0.4 * Math.min(1, Math.max(0, p.getY(i) / 12)) : 1;
      col.push(c[0] * v, c[1] * v, c[2] * v);
      const k = foliage ? Math.min(1, Math.max(0, n.getY(i)) * 1.6) : 0;
      snow.push(c[0] + (0.8 - c[0]) * k, c[1] + (0.85 - c[1]) * k, c[2] + (0.92 - c[2]) * k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.userData.sets = { green: new Float32Array(col), snow: new Float32Array(snow) };
  return g;
}

/** Cottonwood / aspen: trunk + three crown blobs flagged by aCrown (the shader shrinks and tints them by season). */
export function broadleaf() {
  const rnd = prng(31);
  const parts = [];
  parts.push([new THREE.CylinderGeometry(0.12, 0.22, 2.6, 6).translate(0, 1.3, 0), 0]);
  for (const [r, x, y, z] of [[1.55, 0, 3.7, 0], [1.1, 0.95, 3.0, 0.4], [1.0, -0.8, 3.1, -0.5]]) parts.push([new THREE.IcosahedronGeometry(r, 1).scale(1, 0.85, 1).translate(x, y, z), 1]);
  const pos = [], nor = [], col = [], crown = [];
  for (const [g, c] of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.attributes.position, n = ng.attributes.normal;
    for (let i = 0; i < p.count; i += 3) {
      const v = 0.82 + 0.18 * rnd();
      for (let k = 0; k < 3; k++) {
        pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
        nor.push(n.getX(i + k), n.getY(i + k), n.getZ(i + k));
        if (c) col.push(v, v, v);
        else col.push(...lin([0.3, 0.22, 0.15]));
        crown.push(c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aCrown', new THREE.Float32BufferAttribute(crown, 1));
  return g;
}

export function tuft(seed, blades = 12) {
  const rnd = prng(seed);
  const pos = [], nor = [], col = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rnd() * 0.6;
    const h = 0.09 + rnd() * 0.16, w = 0.01 + rnd() * 0.008, lean = 0.04 + rnd() * 0.08;
    const cx = Math.cos(a), cz = Math.sin(a);
    const ox = cx * rnd() * 0.05, oz = cz * rnd() * 0.05;
    const px = -cz * w, pz = cx * w;
    for (const p of [[ox + px, 0, oz + pz], [ox - px, 0, oz - pz], [ox + cx * lean, h, oz + cz * lean]]) pos.push(...p);
    const n = new THREE.Vector3(cx, 2.2, cz).normalize();
    for (let k = 0; k < 3; k++) nor.push(n.x, n.y, n.z);
    col.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.15, 1.15, 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export function rock(seed) {
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

/** Round hay bale lying on its side. */
export function bale() {
  const g = new THREE.CylinderGeometry(0.9, 0.9, 1.2, 14).rotateZ(Math.PI / 2).translate(0, 0.9, 0);
  return g;
}

const SWAY = `
  #ifdef USE_INSTANCING
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
    vec3 ip = vec3(0.0);
  #endif
  float sway = sin(uTime * 1.9 + ip.x * 0.37 + ip.z * 0.29) * 0.6 + sin(uTime * 3.3 + ip.x * 0.9 - ip.z * 0.4) * 0.3;
  transformed.x += sway * uWind * position.y * 0.45;
  transformed.z += sway * uWind * position.y * 0.25;`;

export function makeVegMaterials(season) {
  const sway = (sh) => {
    sh.uniforms.uTime = season.u.uTime;
    sh.uniforms.uWind = season.u.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;').replace('#include <begin_vertex>', '#include <begin_vertex>' + SWAY);
  };
  const grass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, color: 0xd8c070 });
  grass.onBeforeCompile = sway;
  grass.customProgramCacheKey = () => 'vegGrass';
  const shrub = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, color: 0x9a9f78 });
  shrub.onBeforeCompile = sway;
  shrub.customProgramCacheKey = () => 'vegShrub';
  const pine = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const broad = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  broad.onBeforeCompile = (sh) => {
    sh.uniforms.uLeaf = season.u.uLeaf;
    sh.uniforms.uLeafCol = { value: season.leaf };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCrown;\nvarying float vCrown;\nuniform float uLeaf;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCrown = aCrown;
        float lf = mix(1.0, mix(0.42, 1.0, uLeaf), aCrown);
        transformed.xz *= lf;
        transformed.y = mix(transformed.y, 3.0 + (transformed.y - 3.0) * mix(0.6, 1.0, uLeaf), aCrown);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCrown;\nuniform vec3 uLeafCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uLeafCol * 1.05, vCrown);');
  };
  broad.customProgramCacheKey = () => 'vegBroad';
  const rockM = new THREE.MeshStandardMaterial({ roughness: 0.92, color: 0x8c8479, flatShading: true });
  const baleM = new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0xc9a85a });
  return { grass, shrub, pine, broad, rock: rockM, bale: baleM };
}
