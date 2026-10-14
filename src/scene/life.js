// Things that move: wildlife (deer, cattle, bison) that wander, flee from the van, and sometimes
// cross the road ahead. Everything is instanced in world coordinates inside the land group. Road
// traffic (detailed instanced vehicles with car following, lane changes, semis with trailers,
// horns and collisions) lives in traffic.js and is re-exported here for the world.
import * as THREE from 'three';
import { prng } from '../world/noise.js';

export { Traffic } from './traffic.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
// ── Wildlife ─────────────────────────────────────────────────────────────────
const brown = lin([0.5, 0.36, 0.22]), tan = lin([0.62, 0.48, 0.3]), dark = lin([0.16, 0.11, 0.08]), white = lin([0.9, 0.88, 0.82]), blk = lin([0.08, 0.08, 0.09]);
function boxes(parts) {
  const P = [], N = [], C = [], I = [];
  const F = [
    [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]], [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
    [[0, -1, 0], [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]]], [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]], [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
  ];
  for (const [x0, x1, y0, y1, z0, z1, col] of parts) {
    for (const [n, q] of F) {
      const b = P.length / 3;
      for (const c of q) {
        P.push(c[0] ? x1 : x0, c[1] ? y1 : y0, c[2] ? z1 : z0);
        N.push(...n);
        C.push(...col);
      }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  return g;
}
const legs = (xs, hz, h, w, col) => xs.flatMap((x) => [-1, 1].map((s) => [x - w, x + w, 0, h, s * hz - w, s * hz + w, col]));
const SPECIES = [
  { name: 'deer', max: 16, flee: 11, r: 0.8, geo: () => boxes([[-0.65, 0.65, 0.68, 1.25, -0.22, 0.22, tan], ...legs([-0.5, 0.5], 0.14, 0.7, 0.05, dark), [0.5, 0.85, 1.1, 1.7, -0.1, 0.1, tan], [0.8, 1.2, 1.5, 1.72, -0.1, 0.1, tan], [-0.72, -0.64, 1.0, 1.25, -0.08, 0.08, white], [0.85, 0.92, 1.72, 2.15, -0.1, -0.05, dark], [0.85, 0.92, 1.72, 2.15, 0.05, 0.1, dark]]) },
  { name: 'cattle', max: 12, flee: 3.5, r: 1.0, geo: () => boxes([[-0.95, 0.95, 0.6, 1.3, -0.36, 0.36, brown], ...legs([-0.65, 0.65], 0.24, 0.62, 0.07, dark), [0.95, 1.4, 0.8, 1.22, -0.2, 0.2, brown], [1.3, 1.42, 1.15, 1.25, -0.28, -0.2, white], [1.3, 1.42, 1.15, 1.25, 0.2, 0.28, white]]) },
  { name: 'bison', max: 8, flee: 6, r: 1.3, geo: () => boxes([[-1.2, 1.0, 0.7, 1.75, -0.5, 0.5, dark], [0.1, 0.95, 1.75, 2.15, -0.42, 0.42, dark], ...legs([-0.8, 0.8], 0.3, 0.75, 0.1, blk), [1.0, 1.65, 0.75, 1.5, -0.3, 0.3, blk], [1.55, 1.7, 1.4, 1.55, -0.38, -0.3, white]]) },
];

export class Wildlife {
  constructor(land, world, stage) {
    this.land = land;
    this.world = world;
    this.animals = [];
    this.max = 28;
    this.t = 0;
    this.rnd = prng(777);
    this.meshes = SPECIES.map((sp) => {
      const m = new THREE.InstancedMesh(sp.geo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), sp.max + 2);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      land.envRoot.add(m);
      return m;
    });
    this.id = 0;
  }

  setQuality(tier) {
    this.max = { high: 28, medium: 20, low: 12, lite: 6 }[tier] || 20;
  }

  clear() {
    this.animals.length = 0;
    for (const m of this.meshes) m.count = 0;
  }

  setVisible(v) {
    for (const m of this.meshes) m.visible = v;
  }

  spawn(D) {
    const W = this.world.gen, T = this.world.terrain;
    const night = this.land.season.u.uNight.value, winter = this.land.season.u.uIce.value;
    if (this.rnd() < night * 0.5 + winter * 0.25) return;
    const a = D.yaw + (this.rnd() - 0.5) * 4.2; // mostly ahead and to the sides
    const d = 90 + this.rnd() * 190;
    const x = D.x + Math.cos(a) * d, z = D.z - Math.sin(a) * d;
    if (W.settlementAt(x, z, 60)) return;
    const h = W.heightAt(x, z);
    const sf = W.surfaceAt(x, z);
    if (sf.kind === 'water' || sf.kind === 'street') return;
    if (Math.hypot(W.heightAt(x + 4, z) - h, W.heightAt(x, z + 4) - h) > 2.5) return;
    const bio = {};
    W.biome(x, z, h, bio);
    const r = this.rnd();
    let sp;
    if (bio.forest > 0.45) sp = r < 0.9 ? 0 : 2;
    else if (bio.field > 0.4) sp = r < 0.7 ? 1 : 0;
    else if (bio.bad > 0.4) sp = r < 0.6 ? 2 : 0;
    else sp = r < 0.45 ? 0 : r < 0.75 ? 1 : 2;
    const count = this.animals.filter((q) => q.sp === sp).length;
    if (count >= SPECIES[sp].max) return;
    const herd = sp === 0 ? 1 + Math.floor(this.rnd() * 3) : 2 + Math.floor(this.rnd() * 4);
    const road = W.roadAt(x, z);
    const nearRoad = road && road.d < 70;
    for (let i = 0; i < herd; i++) {
      this.animals.push({
        id: this.id++, sp, x: x + (this.rnd() - 0.5) * 14, z: z + (this.rnd() - 0.5) * 14, y: h, yaw: this.rnd() * Math.PI * 2, v: 0, state: 'graze', t: 2 + this.rnd() * 8, scale: 0.9 + this.rnd() * 0.25,
        tint: sp === 1 ? [[0.55, 0.38, 0.25], [0.12, 0.1, 0.1], [0.85, 0.8, 0.72], [0.45, 0.3, 0.2]][Math.floor(this.rnd() * 4)] : [0.9 + this.rnd() * 0.2, 0.9 + this.rnd() * 0.2, 0.9 + this.rnd() * 0.2],
        crossing: sp === 0 && nearRoad && this.rnd() < 0.45, seen: false, dead: 0,
      });
    }
  }

  update(dt, D) {
    const W = this.world.gen, T = this.world.terrain;
    if (!D.active) {
      if (this.animals.length) this.clear();
      return;
    }
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.5;
      if (this.animals.length < this.max) this.spawn(D);
    }
    const hx = Math.cos(D.yaw), hz = -Math.sin(D.yaw);
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i], S = SPECIES[a.sp];
      const dx = a.x - D.x, dz = a.z - D.z, d = Math.hypot(dx, dz);
      if (d > 360 || a.dead > 2.2) {
        this.animals.splice(i, 1);
        continue;
      }
      if (a.dead > 0) {
        a.dead += dt;
        a.y += 0;
        continue;
      }
      // sightings
      if (!a.seen && d < 55 && (dx * hx + dz * hz) / (d || 1) > 0.35) {
        a.seen = true;
        D.onSight?.(a);
      }
      a.t -= dt;
      const moving = Math.abs(D.v) > 3;
      if (a.state !== 'flee' && a.state !== 'cross' && d < 38 && moving && a.sp !== 1) {
        a.state = 'flee';
        a.t = 3 + this.rnd() * 3;
        a.yaw = Math.atan2(-dz, dx) + (this.rnd() - 0.5) * 0.9; // away from the van
      } else if (a.state === 'flee' && a.t <= 0) {
        a.state = 'walk';
        a.t = 3 + this.rnd() * 5;
      }
      if (a.crossing && a.state !== 'cross' && d < 140 && moving) {
        const q = W.roadAt(a.x, a.z);
        if (q && q.d < 80) {
          a.state = 'cross';
          a.crossDir = q.side > 0 ? -1 : 1; // toward the far side
          a.nx = -q.tz;
          a.nz = q.tx;
          a.t = 14;
          a.crossing = false;
          a.v = 6;
          a.yaw = Math.atan2(-a.nz * a.crossDir, a.nx * a.crossDir);
          D.onWildlife?.('cross');
        }
      }
      if (a.state === 'cross') {
        const q = W.roadAt(a.x, a.z);
        if (a.t <= 0 || (q && Math.abs(q.side) > q.edge.P.width / 2 + 14 && Math.sign(q.side) === a.crossDir * -1)) {
          a.state = 'walk';
          a.t = 4;
        }
      }
      if (a.state === 'graze' && a.t <= 0) {
        a.state = 'walk';
        a.t = 3 + this.rnd() * 6;
        a.yaw += (this.rnd() - 0.5) * 2.2;
      } else if (a.state === 'walk' && a.t <= 0) {
        a.state = 'graze';
        a.t = 4 + this.rnd() * 10;
      }
      const sp = a.state === 'flee' ? S.flee : a.state === 'cross' ? 6.5 : a.state === 'walk' ? 0.9 : 0;
      a.v += (sp - a.v) * Math.min(1, dt * 3);
      if (a.v > 0.02) {
        const nx = a.x + Math.cos(a.yaw) * a.v * dt, nz = a.z - Math.sin(a.yaw) * a.v * dt;
        const sf = W.surfaceAt(nx, nz);
        if (sf.kind === 'water') a.yaw += 2.4;
        else {
          a.x = nx;
          a.z = nz;
        }
      }
      a.y = W.heightAt(a.x, a.z);
      // hit by the van
      if (Math.abs(D.v) > 2.5) {
        const c = Math.cos(D.yaw), s = Math.sin(D.yaw);
        for (const lx of [-0.5, 1.4, 3.2, 4.5]) {
          if (Math.hypot(a.x - (D.x + lx * c), a.z - (D.z - lx * s)) < S.r + 1.0) {
            a.dead = 0.01;
            a.state = 'dead';
            D.v *= 0.55;
            D.emit('animal');
            D.lastHit = S.name;
            break;
          }
        }
      }
    }
    this.paint();
  }

  paint() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), eu = new THREE.Euler(), col = new THREE.Color();
    const n = [0, 0, 0];
    const t = performance.now() / 1000;
    for (const a of this.animals) {
      const mesh = this.meshes[a.sp], i = n[a.sp];
      if (i >= SPECIES[a.sp].max + 2) continue;
      const bob = a.v > 0.3 ? Math.sin(t * (a.v > 4 ? 14 : 6) + a.id) * (a.v > 4 ? 0.14 : 0.04) : 0;
      const fall = a.dead > 0 ? Math.min(1, a.dead * 3) : 0;
      p.set(a.x, a.y + bob, a.z);
      q.setFromEuler(eu.set(fall * 1.45, a.yaw, 0, 'YXZ'));
      sc.setScalar(a.scale);
      mesh.setMatrixAt(i, m4.compose(p, q, sc));
      mesh.setColorAt(i, col.setRGB(a.tint[0], a.tint[1], a.tint[2]));
      n[a.sp] = i + 1;
    }
    this.meshes.forEach((m, k) => {
      m.count = n[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }
}
