// Sidewalk pedestrians: one instanced mesh of ~90-triangle people. Walking is done entirely in the
// vertex shader (each walker shuttles back and forth along its segment, legs and arms swing about
// their joints, the figure turns at each end), so animation costs nothing on the CPU. At night most
// of them have gone indoors.
import * as THREE from 'three';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const SHIRTS = [[0.75, 0.15, 0.12], [0.15, 0.3, 0.6], [0.9, 0.9, 0.85], [0.2, 0.5, 0.3], [0.85, 0.65, 0.15], [0.35, 0.35, 0.4], [0.6, 0.25, 0.5], [0.9, 0.45, 0.15], [0.1, 0.1, 0.12], [0.5, 0.65, 0.8]].map(lin);
const PANTS = [[0.12, 0.16, 0.3], [0.15, 0.15, 0.17], [0.4, 0.33, 0.22], [0.25, 0.3, 0.4], [0.5, 0.45, 0.35]].map(lin);
const SKIN = [[0.85, 0.62, 0.48], [0.62, 0.42, 0.3], [0.4, 0.26, 0.18], [0.92, 0.75, 0.62]].map(lin);
const CAP = 360;
const RANGE = 170;

function personGeometry() {
  const P = [], N = [], C = [], PT = [], SW = [], PV = [], I = [];
  const faces = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]],
    [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]], [[0, -1, 0], [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]]],
    [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]], [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  ];
  const box = (x0, x1, y0, y1, z0, z1, col, part, swing = 0, pivot = 0) => {
    for (const [n, q] of faces) {
      const b = P.length / 3;
      for (const c of q) {
        P.push(c[0] ? x1 : x0, c[1] ? y1 : y0, c[2] ? z1 : z0);
        N.push(...n);
        C.push(...col);
        PT.push(part);
        SW.push(swing);
        PV.push(pivot);
      }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  };
  const W = [1, 1, 1], SH = lin([0.06, 0.05, 0.05]), HAIR = lin([0.12, 0.08, 0.05]);
  for (const s of [-1, 1]) {
    box(-0.08, 0.08, 0.08, 0.88, s * 0.1 - 0.075, s * 0.1 + 0.075, W, 2, s, 0.88); // trouser leg
    box(-0.08, 0.14, 0, 0.08, s * 0.1 - 0.075, s * 0.1 + 0.075, SH, 0, s, 0.88); // shoe
    box(-0.05, 0.05, 0.86, 1.4, s * 0.225 - 0.04, s * 0.225 + 0.04, W, 1, -s * 0.9, 1.4); // sleeve
    box(-0.045, 0.045, 0.78, 0.86, s * 0.225 - 0.035, s * 0.225 + 0.035, [1, 1, 1], 3, -s * 0.9, 1.4); // hand (skin)
  }
  box(-0.11, 0.11, 0.88, 1.46, -0.19, 0.19, W, 1);
  box(-0.1, 0.1, 1.48, 1.72, -0.1, 0.1, [1, 1, 1], 3);
  box(-0.105, 0.09, 1.66, 1.75, -0.105, 0.105, HAIR, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(PT, 1));
  g.setAttribute('aSwing', new THREE.Float32BufferAttribute(SW, 1));
  g.setAttribute('aPivot', new THREE.Float32BufferAttribute(PV, 1));
  g.setIndex(I);
  return g;
}

export class Pedestrians {
  constructor(group, season) {
    this.group = group;
    this.list = [];
    this.dirty = false;
    this.last = [1e9, 1e9];
    const g = personGeometry();
    const inst = (name, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.seg = inst('aSeg', 4); // x, z, dx, dz
    this.mov = inst('aMov', 4); // length, speed, phase, y
    this.shirt = inst('aShirt', 3);
    this.pants = inst('aPants', 3);
    this.skin = inst('aSkin', 3);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uPedT = season.u.uTime;
      sh.uniforms.uNight = season.u.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPart; attribute float aSwing; attribute float aPivot;
          attribute vec4 aSeg; attribute vec4 aMov; attribute vec3 aShirt; attribute vec3 aPants; attribute vec3 aSkin;
          uniform float uPedT; uniform float uNight;`)
        .replace('#include <beginnormal_vertex>', `
          float pPer = 2.0 * aMov.x;
          float pS = mod(aMov.z * pPer + uPedT * aMov.y, pPer);
          float pFwd = pS < aMov.x ? 1.0 : -1.0;
          float pU = pS < aMov.x ? pS : pPer - pS;
          vec2 pD = aSeg.zw * pFwd;
          float pVis = step(fract(aMov.z * 97.0 + 0.31), 1.0 - 0.8 * uNight);
          vec3 objectNormal = vec3( normal );
          objectNormal.xz = objectNormal.x * pD + objectNormal.z * vec2( -pD.y, pD.x );
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif`)
        .replace('#include <color_vertex>', `#include <color_vertex>
          vColor.xyz *= aPart < 0.5 ? vec3(1.0) : (aPart < 1.5 ? aShirt : (aPart < 2.5 ? aPants : aSkin));`)
        .replace('#include <begin_vertex>', `vec3 transformed = position;
          if (aPivot > 0.0) {
            float ang = aSwing * sin(uPedT * aMov.y * 5.4 + aMov.z * 6.2832) * 0.6;
            float cy = transformed.y - aPivot;
            float cs = cos(ang), sn = sin(ang);
            transformed.x = position.x * cs - cy * sn;
            transformed.y = position.x * sn + cy * cs + aPivot;
          }
          transformed.y += 0.02 * abs(sin(uPedT * aMov.y * 5.4 + aMov.z * 6.2832));
          transformed.xz = transformed.x * pD + transformed.z * vec2( -pD.y, pD.x );
          transformed = transformed * pVis + vec3( aSeg.x + aSeg.z * pU, aMov.w, aSeg.y + aSeg.w * pU );`);
    };
    mat.customProgramCacheKey = () => 'pedsMat1';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    group.add(this.mesh);
  }

  setVisible(v) {
    this.mesh.visible = v && this.geo.instanceCount > 0;
    this.want = v;
  }

  /** Replace the walker list: [x, z, dx, dz, len, speed, phase, seed, y]. */
  setList(list) {
    this.list = list;
    this.dirty = true;
  }

  update(px, pz) {
    if (!this.dirty && Math.hypot(px - this.last[0], pz - this.last[1]) < 8) return;
    this.dirty = false;
    this.last = [px, pz];
    const c = [];
    for (let i = 0; i < this.list.length; i++) {
      const w = this.list[i];
      const dx = w[0] + w[2] * w[4] * 0.5 - px, dz = w[1] + w[3] * w[4] * 0.5 - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < RANGE * RANGE) c.push([d2, i]);
    }
    c.sort((a, b) => a[0] - b[0]);
    const n = Math.min(CAP, c.length);
    for (let k = 0; k < n; k++) {
      const w = this.list[c[k][1]];
      const seed = w[7];
      this.seg.setXYZW(k, w[0], w[1], w[2], w[3]);
      this.mov.setXYZW(k, w[4], w[5], w[6], w[8]);
      const sh = SHIRTS[seed % SHIRTS.length], pn = PANTS[(seed >> 3) % PANTS.length], sk = SKIN[(seed >> 5) % SKIN.length];
      this.shirt.setXYZ(k, sh[0], sh[1], sh[2]);
      this.pants.setXYZ(k, pn[0], pn[1], pn[2]);
      this.skin.setXYZ(k, sk[0], sk[1], sk[2]);
    }
    this.geo.instanceCount = n;
    for (const a of [this.seg, this.mov, this.shirt, this.pants, this.skin]) a.needsUpdate = true;
    this.mesh.visible = n > 0 && this.want !== false;
  }
}
