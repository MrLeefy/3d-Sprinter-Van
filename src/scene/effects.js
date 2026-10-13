// Driving effects, all in world coordinates inside the land group (so they stay put while the van
// moves through them): dust, snow powder, flung mud, water spray and tyre smoke from a particle ring
// buffer, and skid marks / wheel ruts from a ring buffer of ground quads.
import * as THREE from 'three';

const N = 700; // particles
const MARKS = 1600; // mark quads
const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const rnd = (a = -1, b = 1) => a + Math.random() * (b - a);

// kind → emitter settings. rate: particles/s at full effect; the rest per particle.
const EMIT = {
  gravel: { col: lin([0.62, 0.56, 0.46]), rate: 46, life: [0.9, 1.8], s0: 0.5, s1: 2.6, a: 0.38, up: [0.6, 1.8], drag: 1.3, g: -0.4 },
  dirt: { col: lin([0.5, 0.4, 0.3]), rate: 54, life: [0.9, 1.9], s0: 0.5, s1: 2.8, a: 0.42, up: [0.6, 1.9], drag: 1.3, g: -0.4 },
  sand: { col: lin([0.72, 0.6, 0.45]), rate: 60, life: [1.0, 2.1], s0: 0.5, s1: 3.0, a: 0.4, up: [0.6, 1.9], drag: 1.2, g: -0.5 },
  grass: { col: lin([0.5, 0.5, 0.34]), rate: 18, life: [0.6, 1.1], s0: 0.35, s1: 1.4, a: 0.22, up: [0.4, 1.2], drag: 1.6, g: 0.5 },
  forest: { col: lin([0.34, 0.3, 0.2]), rate: 16, life: [0.6, 1.0], s0: 0.35, s1: 1.2, a: 0.2, up: [0.4, 1.0], drag: 1.6, g: 0.6 },
  rock: { col: lin([0.55, 0.52, 0.48]), rate: 28, life: [0.7, 1.3], s0: 0.4, s1: 1.8, a: 0.3, up: [0.5, 1.4], drag: 1.4, g: 0 },
  snow: { col: lin([0.92, 0.95, 1.0]), rate: 80, life: [1.1, 2.4], s0: 0.7, s1: 3.6, a: 0.55, up: [0.8, 2.6], drag: 1.1, g: -0.8 },
  packed: { col: lin([0.88, 0.92, 0.98]), rate: 34, life: [0.8, 1.5], s0: 0.5, s1: 2.0, a: 0.35, up: [0.5, 1.5], drag: 1.3, g: -0.3 },
  ice: { col: lin([0.85, 0.93, 1.0]), rate: 30, life: [0.7, 1.3], s0: 0.35, s1: 1.4, a: 0.3, up: [0.4, 1.2], drag: 1.4, g: 0 },
  mud: { col: lin([0.24, 0.17, 0.11]), rate: 40, life: [0.7, 1.3], s0: 0.35, s1: 0.8, a: 0.85, up: [1.6, 4.2], drag: 0.4, g: 9 },
  shallow: { col: lin([0.8, 0.88, 0.95]), rate: 90, life: [0.7, 1.3], s0: 0.5, s1: 2.4, a: 0.5, up: [1.2, 3.4], drag: 0.7, g: 5 },
  water: { col: lin([0.8, 0.88, 0.95]), rate: 120, life: [0.8, 1.5], s0: 0.6, s1: 3, a: 0.55, up: [1.4, 3.8], drag: 0.7, g: 5 },
  mist: { col: lin([0.75, 0.78, 0.82]), rate: 40, life: [0.8, 1.5], s0: 0.8, s1: 3.2, a: 0.22, up: [0.3, 1.2], drag: 1.2, g: -0.3 },
  smoke: { col: lin([0.62, 0.62, 0.64]), rate: 70, life: [0.9, 1.7], s0: 0.5, s1: 2.6, a: 0.34, up: [0.3, 1.0], drag: 1.2, g: -0.5 },
};
const HARD = new Set(['asphalt', 'county', 'street', 'plowed']);
// wheel mark colours and base alpha when the wheel just rolls (ruts) vs. slides (skids)
const RUT = {
  snow: [lin([0.62, 0.68, 0.78]), 0.34], packed: [lin([0.5, 0.55, 0.62]), 0.2], mud: [lin([0.1, 0.07, 0.05]), 0.5], grass: [lin([0.18, 0.22, 0.1]), 0.2],
  forest: [lin([0.12, 0.12, 0.07]), 0.2], dirt: [lin([0.22, 0.16, 0.11]), 0.3], gravel: [lin([0.3, 0.27, 0.22]), 0.16], sand: [lin([0.4, 0.32, 0.22]), 0.25],
};
const SKID = [lin([0.012, 0.012, 0.014]), 0.62];

export class Effects {
  constructor(world) {
    this.world = world;
    this.root = world.land.envRoot;
    // particles
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.age = new Float32Array(N).fill(99);
    this.life = new Float32Array(N).fill(1);
    this.s0 = new Float32Array(N);
    this.s1 = new Float32Array(N);
    this.a0 = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.size = new Float32Array(N);
    this.alpha = new Float32Array(N);
    this.col = new Float32Array(N * 3);
    this.head = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uDay: { value: 1 } },
      transparent: true,
      depthWrite: false,
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aCol; uniform float uScale; uniform float uDay; varying float vA; varying vec3 vC;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aSize * uScale / max(0.6, -mv.z), 0.0, 220.0); vA = aAlpha; vC = aCol * (0.18 + 0.82 * uDay); }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.15, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.root.add(this.points);
    this.acc = 0;
    // skid marks / ruts
    const mg = new THREE.BufferGeometry();
    this.mpos = new Float32Array(MARKS * 4 * 3);
    this.mcol = new Float32Array(MARKS * 4 * 4);
    const idx = new Uint16Array(MARKS * 6);
    for (let i = 0; i < MARKS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    mg.setAttribute('position', new THREE.BufferAttribute(this.mpos, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('color', new THREE.BufferAttribute(this.mcol, 4).setUsage(THREE.DynamicDrawUsage));
    mg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.marks = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -14, side: THREE.DoubleSide }));
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 4;
    this.root.add(this.marks);
    this.mhead = 0;
    this.mcount = 0;
    this.last = [null, null, null, null];
    mg.setDrawRange(0, 0);
    this.visible = true;
  }

  setVisible(v) {
    this.visible = v;
    this.points.visible = v;
    this.marks.visible = v;
  }

  clear() {
    this.age.fill(99);
    this.mhead = this.mcount = 0;
    this.marks.geometry.setDrawRange(0, 0);
    this.last.fill(null);
  }

  spawn(x, y, z, vx, vy, vz, e, size = 1) {
    const i = this.head++ % N;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0;
    this.life[i] = rnd(e.life[0], e.life[1]);
    this.s0[i] = e.s0 * size * rnd(0.7, 1.2);
    this.s1[i] = e.s1 * size * rnd(0.7, 1.2);
    this.a0[i] = e.a * rnd(0.7, 1.1);
    this.drag[i] = e.drag;
    this.grav[i] = e.g;
    this.col.set(e.col, i * 3);
  }

  /** Four wheel contact points in world coordinates. */
  wheels(D) {
    const c = Math.cos(D.yaw), s = Math.sin(D.yaw);
    const w = (lx, lz) => [D.x + lx * c + lz * s, D.z - lx * s + lz * c];
    return [w(0, -0.86), w(0, 0.86), w(4.325, -0.86), w(4.325, 0.86)];
  }

  update(dt, D) {
    const T = this.world.terrain;
    this.mat.uniforms.uDay.value = 1 - this.world.terrain.season.u.uNight.value * 0.82;
    const st = this.world.stage;
    const size = st.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.mat.uniforms.uScale.value = size.y / (2 * Math.tan((st.camera.fov * Math.PI) / 360));
    if (D.active && this.visible) this.emit(dt, D, T);
    else this.last.fill(null);
    // advance particles
    let alive = false;
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      alive = true;
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(k);
      this.alpha[i] = this.a0[i] * (1 - k) * Math.min(1, k * 8);
    }
    if (alive || this._wasAlive) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.aSize.needsUpdate = true;
      this.points.geometry.attributes.aAlpha.needsUpdate = true;
      this.points.geometry.attributes.aCol.needsUpdate = true;
    }
    this._wasAlive = alive;
  }

  emit(dt, D, T) {
    const sp = Math.abs(D.v);
    const key = D.surfaceKey;
    const wet = T.season.u.uWet.value > 0.55;
    const slide = Math.max(D.slip > 0.45 ? D.slip : 0, D.lock, D.spinning > 0.35 ? D.spinning : 0);
    const W = this.wheels(D);
    const c = Math.cos(D.yaw), s = Math.sin(D.yaw);
    // what comes off the tyres
    let kind = EMIT[key] ? key : null;
    if (HARD.has(key)) kind = slide > 0.3 && sp > 6 ? 'smoke' : wet && sp > 12 ? 'mist' : null;
    else if (slide > 0.5 && sp > 6 && (key === 'packed' || key === 'ice')) kind = key;
    const e = kind && EMIT[kind];
    if (e) {
      const loose = HARD.has(key) ? slide : 1;
      const f = Math.min(1, Math.max(0, (sp - 1.5) / 9)) * (0.3 + 0.7 * Math.min(1, sp / 14)) * loose + (D.spinning > 0.2 ? D.spinning * 0.7 : 0);
      this.acc += e.rate * f * dt * (D.cfgLowFx ? 0.5 : 1);
      while (this.acc >= 1) {
        this.acc -= 1;
        const w = W[Math.random() < 0.8 ? (Math.random() < 0.5 ? 0 : 1) : 2 + (Math.random() < 0.5 ? 0 : 1)];
        const gy = T.heightAt(w[0], w[1]) + 0.2;
        const back = Math.sign(D.v || 1) * -1;
        const k = rnd(0.2, 0.55) * sp;
        this.spawn(w[0], gy, w[1], c * back * k + s * rnd(-1.4, 1.4) + rnd(-0.3, 0.3), rnd(e.up[0], e.up[1]), -s * back * k + c * rnd(-1.4, 1.4) + rnd(-0.3, 0.3), e, 1 + sp * 0.02);
      }
    } else this.acc = 0;
    // marks: skids on pavement, ruts on soft ground
    const hard = HARD.has(key);
    const rut = RUT[key];
    for (let i = 0; i < 4; i++) {
      const want = hard ? slide > 0.35 && sp > 3.5 : rut && sp > 0.8 && key !== 'water' && key !== 'shallow';
      const w = W[i];
      if (!want) {
        this.last[i] = null;
        continue;
      }
      const [col, a0] = hard ? SKID : rut;
      const a = hard ? a0 * Math.min(1, (slide - 0.2) * 1.6) : a0 * Math.min(1, sp / 5);
      const y = T.heightAt(w[0], w[1]) + (hard || key === 'snow' ? 0.12 : 0.05);
      const l = this.last[i];
      if (l && Math.hypot(w[0] - l.x, w[1] - l.z) < 0.4) continue;
      if (l && Math.hypot(w[0] - l.x, w[1] - l.z) < 3) this.addQuad(l, { x: w[0], y, z: w[1] }, 0.26, col, a, i);
      this.last[i] = { x: w[0], y, z: w[1] };
    }
  }

  addQuad(p, q, wd, col, a, wheel) {
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * (wd / 2), nz = (dx / l) * (wd / 2);
    const i = this.mhead % MARKS;
    this.mhead++;
    this.mcount = Math.min(MARKS, this.mcount + 1);
    const P = this.mpos, C = this.mcol, o = i * 12, co = i * 16;
    const pts = [[p.x - nx, p.y, p.z - nz], [p.x + nx, p.y, p.z + nz], [q.x - nx, q.y, q.z - nz], [q.x + nx, q.y, q.z + nz]];
    pts.forEach((v, k) => P.set(v, o + k * 3));
    for (let k = 0; k < 4; k++) C.set([col[0], col[1], col[2], a], co + k * 4);
    this.marks.geometry.attributes.position.needsUpdate = true;
    this.marks.geometry.attributes.color.needsUpdate = true;
    this.marks.geometry.setDrawRange(0, this.mcount * 6);
    void wheel;
  }
}
