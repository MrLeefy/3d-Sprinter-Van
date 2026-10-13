// Endless terrain. The van stays at the scene origin (floating origin); this module moves and
// turns the world around it. Ground is streamed in 48 m chunks generated from a deterministic
// height function, with a winding track, lakes (ice in winter), forests, shrubs, rocks, grass
// that sways in the wind and boulders. Every chunk is reproducible from its coordinates, so the
// same place always looks the same. Trees and boulders near the van are exported as colliders.
import * as THREE from 'three';

export const CHUNK = 48;
const SEG = 24; // 2 m grid
const VIEW = 3; // chunks streamed on each side (≈ 170 m)

// ── Noise ──────────────────────────────────────────────────────────────────
function h2(x, z, s) {
  const v = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}
function vnoise(x, z, s) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = h2(ix, iz, s), b = h2(ix + 1, iz, s), c = h2(ix, iz + 1, s), d = h2(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z, s, oct = 4) {
  let a = 0.5, t = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    t += a * vnoise(x, z, s + i * 13);
    n += a;
    x = x * 2.03 + 17.1;
    z = z * 2.03 - 9.7;
    a *= 0.5;
  }
  return t / n;
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Centre line of the track (runs along ±x forever, passing the camp on the driver side). */
export function roadZ(x) {
  return -6 + 26 * Math.sin(x / 170) + 9 * (Math.sin(x / 53 + 1.1) - Math.sin(1.1));
}
export const ROAD_HALF = 3.0;

// Per-scenario landscape: relief, water, vegetation densities (per 48 m chunk) and tints
export const BIOMES = {
  summer: { amp: 6, freq: 0.0055, lakes: false, ice: false, trees: 0, forest: 1, grass: 0, shrubs: 140, rocks: 60, boulders: 3, hill: 'mesa', hillTint: 0xb98a5e,
    grassTint: 0x9aa868, shrubTint: 0xb39a6a, rockTint: 0xa88e74, treeTint: 0x95a68a, road: 0xc4ad88, surface: 'sand', wet: 0 },
  winter: { amp: 6.5, freq: 0.006, lakes: true, ice: true, trees: 90, forest: 0.48, grass: 0, shrubs: 25, rocks: 25, boulders: 2, hill: 'hills', hillTint: 0xe8eef4,
    grassTint: 0x9aa868, shrubTint: 0x8a7d66, rockTint: 0x6e6a66, treeTint: 0xffffff, road: 0xd7dee6, surface: 'snow', wet: 0 },
  rain: { amp: 6, freq: 0.0065, lakes: true, ice: false, trees: 100, forest: 0.5, grass: 650, shrubs: 0, rocks: 40, boulders: 2, hill: 'hills', hillTint: 0x55624e,
    grassTint: 0x6f8a52, shrubTint: 0xa69a6e, rockTint: 0x5c5853, treeTint: 0x6f7e70, road: 0x5e4c3c, surface: 'mud', wet: 1 },
  humid: { amp: 5, freq: 0.0065, lakes: true, ice: false, trees: 110, forest: 0.47, grass: 750, shrubs: 0, rocks: 20, boulders: 1, hill: 'hills', hillTint: 0x6a8a52,
    grassTint: 0x8fb05a, shrubTint: 0xa69a6e, rockTint: 0x8a8278, treeTint: 0x9db08e, road: 0x8a7158, surface: 'grass', wet: 0.25 },
  overnight: { amp: 8, freq: 0.006, lakes: true, ice: false, trees: 100, forest: 0.5, grass: 600, shrubs: 30, rocks: 45, boulders: 3, hill: 'hills', hillTint: 0x6b7a56,
    grassTint: 0x9aa868, shrubTint: 0xa69a6e, rockTint: 0x8c8479, treeTint: 0x8f9f86, road: 0x8f7a5e, surface: 'grass', wet: 0 },
  multiday: { amp: 8, freq: 0.006, lakes: true, ice: false, trees: 100, forest: 0.5, grass: 650, shrubs: 25, rocks: 40, boulders: 3, hill: 'hills', hillTint: 0x748658,
    grassTint: 0x98ae62, shrubTint: 0xa69a6e, rockTint: 0x8c8479, treeTint: 0x95a68a, road: 0x8f7a5e, surface: 'grass', wet: 0 },
};

// Rolling resistance and grip by surface (for the drive model)
export const SURFACES = {
  road: { label: 'Track', crr: 0.016, mu: 0.8 },
  snowroad: { label: 'Packed-snow track', crr: 0.022, mu: 0.38 },
  wetroad: { label: 'Wet track', crr: 0.02, mu: 0.6 },
  sand: { label: 'Sand', crr: 0.07, mu: 0.5 },
  snow: { label: 'Snow', crr: 0.035, mu: 0.3 },
  mud: { label: 'Mud', crr: 0.06, mu: 0.4 },
  grass: { label: 'Grass', crr: 0.045, mu: 0.55 },
  ice: { label: 'Lake ice', crr: 0.012, mu: 0.12 },
};

// ── Geometry helpers ───────────────────────────────────────────────────────
function horizonGeometry(style, seed) {
  const segA = 360, segR = 12, r0 = 190, r1 = 330;
  const pos = [], col = [], idx = [];
  for (let j = 0; j <= segR; j++) {
    const t = j / segR, r = r0 + (r1 - r0) * t;
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2;
      const u = (i / segA) * 24 + seed;
      let h;
      if (style === 'mesa') {
        const base = fbm(u * 0.6, seed, 1, 4);
        const plateau = base > 0.55 ? 1 : base > 0.49 ? (base - 0.49) / 0.06 : 0;
        h = 3 + plateau * (26 + 14 * fbm(u * 0.25, 7, 2)) + 3 * fbm(u * 3, 1, 3);
      } else h = 3 + 40 * Math.pow(fbm(u * 0.5, 2, 4, 5), 1.6) + 4 * fbm(u * 4, 3, 5);
      const rise = Math.min(1, t * 2.2) * (1 - 0.15 * t);
      pos.push(Math.cos(a) * r, h * rise - 2, Math.sin(a) * r);
      const k = 0.75 + 0.25 * Math.min(1, (h * rise) / 25);
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

function pineGeometry() {
  const parts = [[new THREE.CylinderGeometry(0.1, 0.16, 1.4, 6).translate(0, 0.7, 0), [0.32, 0.22, 0.14], false]];
  for (const [r, h, y] of [[1.5, 2.6, 1.2], [1.15, 2.2, 2.6], [0.75, 1.8, 3.8]]) parts.push([new THREE.ConeGeometry(r, h, 8).translate(0, y + h / 2, 0), [0.13, 0.27, 0.15], true]);
  const pos = [], nor = [], col = [], snow = [];
  for (const [g, c, foliage] of parts) {
    const ng = g.toNonIndexed();
    const p = ng.attributes.position, n = ng.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(...c);
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

function tuftGeometry(seed, blades = 12) {
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

// Shared index buffer for every chunk grid
const GRID_INDEX = (() => {
  const idx = [];
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const p = j * (SEG + 1) + i;
      idx.push(p, p + SEG + 1, p + 1, p + 1, p + SEG + 1, p + SEG + 2);
    }
  }
  return new THREE.Uint16BufferAttribute(idx, 1);
})();

// ── Ground shader: anti-tiling + track (ruts, crown, puddles) ───────────────
const ROAD_GLSL = /* glsl */ `
uniform vec3 uRoadTint;
uniform float uWet;
varying vec2 vGP;
float rH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rH(i), rH(i + vec2(1, 0)), f.x), mix(rH(i + vec2(0, 1)), rH(i + vec2(1, 1)), f.x), f.y); }
float roadZ(float x) { return -6.0 + 26.0 * sin(x / 170.0) + 9.0 * (sin(x / 53.0 + 1.1) - sin(1.1)); }
`;

export class Terrain {
  constructor(stage) {
    this.stage = stage;
    this.envRoot = new THREE.Group();
    this.envRoot.name = 'terrain';
    this.farRoot = new THREE.Group();
    stage.scene.add(this.envRoot, this.farRoot);
    this.groundMat = stage.groundMat;
    this.roadUniforms = { uRoadTint: { value: new THREE.Color(0x8f7a5e) }, uWet: { value: 0 } };
    this.patchGround(this.groundMat);
    this.override = null;
    this.chunks = new Map();
    this.queue = [];
    this.center = null;
    this.colliders = [];
    this.scnId = null;
    this.biome = BIOMES.multiday;
    this.waterLevel = -1e9;
    this.windU = { uTime: { value: 0 }, uWind: { value: 0.3 } };
    // water & ice
    this.waterMat = new THREE.MeshPhysicalMaterial({ color: 0x1d3a42, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.88, envMapIntensity: 1.3 });
    this.iceMat = new THREE.MeshStandardMaterial({ color: 0xd6e6f2, roughness: 0.25, envMapIntensity: 1.4 });
    // horizon (follows the van's heading so it stays put on the skyline)
    this.hillMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0x6a8a52 });
    this.hills = new THREE.Mesh(horizonGeometry('hills', 3.7), this.hillMat);
    this.mesas = new THREE.Mesh(horizonGeometry('mesa', 11.3), this.hillMat);
    for (const m of [this.hills, this.mesas]) {
      m.frustumCulled = false;
      this.farRoot.add(m);
    }
    // instanced scatter (world-space instance matrices inside envRoot)
    this.scatter = new THREE.Group();
    this.envRoot.add(this.scatter);
    const sway = (sh) => {
      sh.uniforms.uTime = this.windU.uTime;
      sh.uniforms.uWind = this.windU.uWind;
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
    const inst = (geo, mat, cap, { cast = false } = {}) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = cast;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scatter.add(m);
      return m;
    };
    this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    this.grassMat.onBeforeCompile = sway;
    this.shrubMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    this.shrubMat.onBeforeCompile = sway;
    this.rockMat = new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true });
    this.trees = inst(pineGeometry(), this.treeMat, 4200, { cast: true });
    this.grass = inst(tuftGeometry(5), this.grassMat, 7000);
    this.shrubs = inst(tuftGeometry(9, 16), this.shrubMat, 3600);
    this.rocks = inst(rockGeometry(4), this.rockMat, 2600, { cast: true });
    this.boulders = inst(rockGeometry(8), this.rockMat, 220, { cast: true });
    this.view = { x: 0, z: 0, h: 0, yaw: 0 };
  }

  /** Ground material shader: tiling break-up plus the track drawn from the same road function. */
  patchGround(mat) {
    const U = this.roadUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRoadTint = U.uRoadTint;
      shader.uniforms.uWet = U.uWet;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = position.xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + ROAD_GLSL)
        .replace('#include <map_fragment>', `
          float gLum = 1.0;
          #ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D( map, vMapUv );
            vec2 ruv = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.27 + vec2(0.37, 0.71);
            vec4 macro = texture2D( map, ruv );
            float vary = texture2D( map, vMapUv * 0.043 + vec2(0.5) ).g;
            sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, macro.rgb, 0.4) * (0.82 + 0.36 * vary);
            gLum = dot(sampledDiffuseColor.rgb, vec3(0.333));
            diffuseColor *= sampledDiffuseColor;
          #endif
          float rd = abs(vGP.y - roadZ(vGP.x));
          float rEdge = 3.0 + 0.35 * rN(vGP * 0.7);
          float road = 1.0 - smoothstep(rEdge - 0.5, rEdge + 0.4, rd);
          float rut = (1.0 - smoothstep(0.16, 0.34, abs(rd - 0.86))) * road;
          float crown = (1.0 - smoothstep(0.05, 0.4, rd)) * road;
          float grit = rN(vGP * 3.1) * 0.6 + rN(vGP * 11.0) * 0.4;
          vec3 roadCol = uRoadTint * dot(diffuse, vec3(0.333)) * (0.72 + 0.5 * grit) * mix(1.0, 0.8, rut);
          roadCol = mix(roadCol, diffuseColor.rgb, crown * 0.55);
          float puddle = smoothstep(0.62, 0.7, rN(vGP * 0.35 + 4.0)) * road * uWet;
          diffuseColor.rgb = mix(diffuseColor.rgb, roadCol, road);
          diffuseColor.rgb *= 1.0 - puddle * 0.45;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, mix(0.9, 0.55, uWet), road);
          roughnessFactor = mix(roughnessFactor, 0.06, puddle);`);
    };
    mat.customProgramCacheKey = () => 'terrainGround';
    mat.needsUpdate = true;
  }

  // ── Height field ─────────────────────────────────────────────────────────
  rawHeight(x, z) {
    const B = this.biome, f = B.freq;
    return B.amp * (fbm(x * f, z * f, this.seed, 4) - 0.5) * 2.4 + 0.8 * (fbm(x * 0.04, z * 0.04, this.seed + 5, 2) - 0.5);
  }

  /** Ground height at a world point: relief, flattened along the track and in the camp clearing. */
  heightAt(x, z) {
    let h = this.rawHeight(x, z);
    const rz = roadZ(x);
    const d = Math.abs(z - rz);
    if (d < 16) {
      const hr = Math.max(this.rawHeight(x, rz) * 0.75, this.waterLevel + 0.6);
      h = hr + (h - hr) * smooth(3.6, 16, d);
    }
    const r = Math.hypot(x - 1.8, z);
    return h * smooth(10, 32, r);
  }

  /** Surface under a world point: track, terrain type, or water/ice depth. */
  surfaceAt(x, z) {
    const onRoad = Math.abs(z - roadZ(x)) < ROAD_HALF + 0.2;
    const h = this.heightAt(x, z);
    const depth = this.waterLevel - h;
    if (depth > 0.05) return { key: this.biome.ice ? 'ice' : 'water', depth, h };
    const road = this.biome.surface === 'snow' ? 'snowroad' : this.biome.wet > 0.5 ? 'wetroad' : 'road';
    return { key: onRoad ? road : this.biome.surface, depth: 0, h };
  }

  // ── Scenario ─────────────────────────────────────────────────────────────
  setScenario(id, wx) {
    this.windU.uWind.value = Math.min(1.2, 0.15 + (wx?.wind ?? 3) / 9);
    if (this.scnId === id) return;
    this.scnId = id;
    const B = (this.biome = BIOMES[id] || BIOMES.multiday);
    this.seed = { summer: 11, winter: 23, rain: 37, humid: 41, overnight: 53, multiday: 53 }[id] ?? 53;
    this.waterLevel = B.lakes ? -0.42 * B.amp : -1e9;
    this.hills.visible = B.hill === 'hills';
    this.mesas.visible = B.hill === 'mesa';
    this.hillMat.color.set(B.hillTint);
    this.treeMat.color.set(B.treeTint);
    const tc = this.trees.geometry.attributes.color;
    tc.array.set(this.trees.geometry.userData.colors[B.ice ? 'snow' : 'green']);
    tc.needsUpdate = true;
    this.grassMat.color.set(B.grassTint);
    this.shrubMat.color.set(B.shrubTint);
    this.rockMat.color.set(B.rockTint);
    this.roadUniforms.uRoadTint.value.set(B.road);
    this.roadUniforms.uWet.value = B.wet;
    // rebuild everything around the current position
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    this.center = null;
    this.update(this.view.x, this.view.z, true);
  }

  // ── Streaming ────────────────────────────────────────────────────────────
  key(cx, cz) {
    return `${cx},${cz}`;
  }

  /** Stream chunks around world (x, z). `sync` builds everything now (scenario switch / start). */
  update(x, z, sync = false) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    if (!this.center || this.center[0] !== cx || this.center[1] !== cz) {
      this.center = [cx, cz];
      const need = new Set();
      for (let j = -VIEW; j <= VIEW; j++) for (let i = -VIEW; i <= VIEW; i++) need.add(this.key(cx + i, cz + j));
      for (const [k, c] of this.chunks) {
        if (!need.has(k)) {
          this.disposeChunk(c);
          this.chunks.delete(k);
        }
      }
      this.queue = [...need].filter((k) => !this.chunks.has(k)).map((k) => k.split(',').map(Number)).sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
      this.scatterDirty = true;
    }
    let budget = sync ? Infinity : 1;
    while (this.queue.length && budget-- > 0) {
      const [i, j] = this.queue.shift();
      this.buildChunk(i, j);
      this.scatterDirty = true;
    }
    if (this.scatterDirty && (sync || this.queue.length === 0 || this.queue.length % 6 === 0)) {
      this.rebuildScatter(cx, cz);
      this.scatterDirty = this.queue.length > 0;
    }
  }

  buildChunk(cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK, step = CHUNK / SEG;
    const n = (SEG + 1) * (SEG + 1);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let minH = Infinity;
    const e = 0.8;
    for (let j = 0; j <= SEG; j++) {
      for (let i = 0; i <= SEG; i++) {
        const k = j * (SEG + 1) + i;
        const x = x0 + i * step, z = z0 + j * step;
        const h = this.heightAt(x, z);
        minH = Math.min(minH, h);
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        // analytic normal (central differences) so neighbouring chunks shade without seams
        const nx = this.heightAt(x - e, z) - this.heightAt(x + e, z), nz = this.heightAt(x, z - e) - this.heightAt(x, z + e);
        const l = Math.hypot(nx, 2 * e, nz);
        nor[k * 3] = nx / l;
        nor[k * 3 + 1] = (2 * e) / l;
        nor[k * 3 + 2] = nz / l;
        uv[k * 2] = x / 320 + 0.5;
        uv[k * 2 + 1] = -z / 320 + 0.5;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(GRID_INDEX);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.override || this.groundMat);
    mesh.receiveShadow = true;
    mesh.userData.terrain = true;
    this.envRoot.add(mesh);
    const chunk = { cx, cz, mesh, water: null, items: this.scatterFor(cx, cz) };
    if (minH < this.waterLevel) {
      const wg = new THREE.PlaneGeometry(CHUNK, CHUNK).rotateX(-Math.PI / 2).translate(x0 + CHUNK / 2, this.waterLevel, z0 + CHUNK / 2);
      chunk.water = new THREE.Mesh(wg, this.override || (this.biome.ice ? this.iceMat : this.waterMat));
      chunk.water.receiveShadow = true;
      chunk.water.userData.water = true;
      this.envRoot.add(chunk.water);
    }
    this.chunks.set(this.key(cx, cz), chunk);
  }

  disposeChunk(c) {
    this.envRoot.remove(c.mesh);
    c.mesh.geometry.dispose();
    if (c.water) {
      this.envRoot.remove(c.water);
      c.water.geometry.dispose();
    }
  }

  /** Deterministic vegetation & rocks for one chunk (world coordinates). */
  scatterFor(cx, cz) {
    const B = this.biome;
    const rnd = prng((cx * 73856093) ^ (cz * 19349663) ^ (this.seed * 83492791));
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const out = { trees: [], grass: [], shrubs: [], rocks: [], boulders: [] };
    const ok = (x, z, roadGap, clear) => {
      if (Math.abs(z - roadZ(x)) < roadGap) return null;
      if (Math.hypot(x - 1.8, z) < clear) return null;
      const h = this.heightAt(x, z);
      if (h < this.waterLevel + 0.25) return null;
      return h;
    };
    const add = (list, n, roadGap, clear, sMin, sMax, test) => {
      for (let i = 0; i < n; i++) {
        const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
        const s = sMin + rnd() * (sMax - sMin), rot = rnd() * Math.PI * 2, tilt = rnd();
        if (test && !test(x, z)) continue;
        const h = ok(x, z, roadGap, clear);
        if (h === null) continue;
        list.push([x, h, z, s, rot, tilt]);
      }
    };
    add(out.trees, B.trees, 6, 14, 0.7, 1.8, (x, z) => fbm(x * 0.018, z * 0.018, this.seed + 9, 3) > B.forest);
    add(out.grass, B.grass, ROAD_HALF - 0.4, 3.0, 0.9, 1.8, (x, z) => !(Math.abs(z) < 1.4 && x > -2.6 && x < 5.8));
    add(out.shrubs, B.shrubs, ROAD_HALF, 4, 1.2, 2.8);
    add(out.rocks, B.rocks, ROAD_HALF, 4, 0.05, 0.34);
    add(out.boulders, B.boulders, 5, 16, 0.7, 1.7);
    return out;
  }

  /** Fill the instanced meshes from the chunks around (cx, cz); near trees/boulders become colliders. */
  rebuildScatter(cx, cz) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), eu = new THREE.Euler();
    const tint = new THREE.Color();
    const fill = (mesh, kind, radius, { sink = 0, flat = 1, vary = 0 } = {}) => {
      let n = 0;
      const cap = mesh.instanceMatrix.count;
      for (const c of this.chunks.values()) {
        if (Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz)) > radius) continue;
        for (const [x, h, z, sc, rot, tilt] of c.items[kind]) {
          if (n >= cap) break;
          p.set(x, h - sink * sc, z);
          eu.set((tilt - 0.5) * 0.12, rot, (tilt - 0.5) * 0.1);
          q.setFromEuler(eu);
          s.set(sc, sc * flat * (0.85 + tilt * 0.4), sc);
          m.compose(p, q, s);
          mesh.setMatrixAt(n, m);
          if (vary) mesh.setColorAt(n, tint.setScalar(1 - vary + tilt * vary * 1.6));
          n++;
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    fill(this.trees, 'trees', 3);
    fill(this.grass, 'grass', 1, { vary: 0.3 });
    fill(this.shrubs, 'shrubs', 2, { vary: 0.35 });
    fill(this.rocks, 'rocks', 2, { sink: 0.25, vary: 0.3 });
    fill(this.boulders, 'boulders', 3, { sink: 0.3, vary: 0.25 });
    this.colliders = [];
    for (const c of this.chunks.values()) {
      if (Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz)) > 1) continue;
      for (const [x, , z, sc] of c.items.trees) this.colliders.push({ x, z, r: 0.22 * sc, kind: 'tree' });
      for (const [x, , z, sc] of c.items.boulders) this.colliders.push({ x, z, r: 0.85 * sc, kind: 'boulder' });
    }
  }

  /** Place the world so that world point (x, z) at height h sits at the scene origin, heading yaw. */
  setView(x, z, h, yaw) {
    this.view = { x, z, h, yaw };
    this.envRoot.rotation.set(0, -yaw, 0);
    const c = Math.cos(-yaw), s = Math.sin(-yaw);
    // envRoot.position = Ry(-yaw) · (−x, −h, −z)
    this.envRoot.position.set(-x * c - z * s, -h, x * s - z * c);
    this.farRoot.rotation.set(0, -yaw, 0);
    this.farRoot.position.y = -h * 0.3;
  }

  /** Swap every ground/water surface to `mat` (infrared) or back (null). */
  setMaterial(mat) {
    this.override = mat;
    for (const c of this.chunks.values()) {
      c.mesh.material = mat || this.groundMat;
      if (c.water) c.water.material = mat || (this.biome.ice ? this.iceMat : this.waterMat);
    }
    this.scatter.visible = !mat;
  }

  tick(dt) {
    this.windU.uTime.value += dt;
    // instanced trees and rocks are not culled per instance, so only the High tier pays for their shadows
    const hi = this.stage.quality === 'high';
    this.trees.castShadow = this.rocks.castShadow = this.boulders.castShadow = hi;
  }
}
