// Distant mountains and ridgelines: two rings of silhouette far beyond the streamed land, drawn with
// aerial haze that follows the scene fog colour. The silhouettes are the real raw terrain (see
// world/horizon.js); the season only decides where snow sits on them.
import * as THREE from 'three';
import { RINGS, RIDGE_BASE, ridgeProfile } from '../world/horizon.js';

const N = 160;
const REBUILD = 420;

function makeMaterial(season, haze) {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uSnowLine: season.u.uSnowLine, uFog: { value: new THREE.Color(0xc8d2dc) }, uLight: { value: 1 }, uHaze: { value: haze } },
    vertexShader: `
      attribute float aElev;
      attribute float aT;
      varying float vElev;
      varying float vT;
      void main() {
        vElev = aElev;
        vT = aT;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uSnowLine;
      uniform vec3 uFog;
      uniform float uLight;
      uniform float uHaze;
      varying float vElev;
      varying float vT;
      void main() {
        vec3 forest = pow(vec3(0.22, 0.30, 0.24), vec3(2.2));
        vec3 rock = pow(vec3(0.46, 0.43, 0.40), vec3(2.2));
        vec3 base = mix(forest, rock, smoothstep(110.0, 250.0, vElev));
        float snow = smoothstep(uSnowLine - 10.0, uSnowLine + 40.0, vElev) * (0.35 + 0.65 * smoothstep(0.35, 0.95, vT));
        base = mix(base, pow(vec3(0.93, 0.95, 1.0), vec3(2.2)), snow);
        base *= uLight * (0.8 + 0.3 * vT);
        float haze = clamp(uHaze + (1.0 - vT) * (1.0 - uHaze) * 1.4, 0.0, 1.0);
        gl_FragColor = vec4(mix(base, uFog, haze), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class Ridges {
  constructor(land, stage) {
    this.land = land;
    this.stage = stage;
    this.group = new THREE.Group();
    this.group.name = 'ridges';
    land.envRoot.add(this.group);
    this.rings = RINGS.map((ring) => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 3 * 3), elev = new Float32Array(N * 3), t = new Float32Array(N * 3);
      const idx = [];
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        for (let r = 0; r < 2; r++) idx.push(i * 3 + r, j * 3 + r, i * 3 + r + 1, j * 3 + r, j * 3 + r + 1, i * 3 + r + 1);
        t[i * 3] = 0;
        t[i * 3 + 1] = 0.45;
        t[i * 3 + 2] = 1;
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aElev', new THREE.BufferAttribute(elev, 1));
      g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, makeMaterial(land.season, ring.haze));
      mesh.frustumCulled = false;
      mesh.renderOrder = -50;
      this.group.add(mesh);
      return { ring, mesh };
    });
    this.center = null;
  }

  rebuild(x, z) {
    this.center = [x, z];
    for (const { ring, mesh } of this.rings) {
      const { top, elev } = ridgeProfile(this.land.world, x, z, ring, N);
      const P = mesh.geometry.attributes.position.array, E = mesh.geometry.attributes.aElev.array;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const px = Math.cos(a) * ring.r, pz = Math.sin(a) * ring.r;
        const mid = RIDGE_BASE + (top[i] - RIDGE_BASE) * 0.45;
        const ys = [RIDGE_BASE, mid, top[i]];
        for (let r = 0; r < 3; r++) {
          const o = (i * 3 + r) * 3;
          P[o] = px;
          P[o + 1] = ys[r];
          P[o + 2] = pz;
          E[i * 3 + r] = elev[i];
        }
      }
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.attributes.aElev.needsUpdate = true;
      mesh.position.set(x, 0, z);
    }
  }

  update(x, z) {
    if (!this.center || Math.hypot(x - this.center[0], z - this.center[1]) > REBUILD) this.rebuild(x, z);
  }

  /** Follow the scene fog colour so the haze matches the horizon day and night. */
  tick() {
    const f = this.stage.fog;
    if (!f) return;
    const lum = f.color.r * 0.3 + f.color.g * 0.59 + f.color.b * 0.11;
    for (const { ring, mesh } of this.rings) {
      const u = mesh.material.uniforms;
      u.uFog.value.copy(f.color);
      u.uLight.value = Math.min(1, 0.06 + lum * 1.5);
      u.uHaze.value = Math.min(0.92, ring.haze + (f.density - 0.0011) * 90);
    }
  }

  setVisible(v) {
    this.group.visible = v;
  }
}
