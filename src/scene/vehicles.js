// Procedural vehicle models: passenger cars, pickups, vans, buses, box trucks and American semi
// tractors with trailers. Every model is one merged geometry (plus separate wheels where they must
// spin) with per-vertex material kind, body-tint weight, lamp glow and decal UVs, drawn by one
// physically-shaded material. Forward is +x, up is +y, right is +z; units are metres.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
export const KIND = { PAINT: 0, GLASS: 1, CHROME: 2, RUBBER: 3, PLASTIC: 4, LENS: 5, METAL: 6, DECAL: 7, RIB: 8, WOOD: 9, CLOTH: 10 };
export const COL = {
  glass: lin([0.035, 0.05, 0.065]), black: lin([0.03, 0.03, 0.035]), dark: lin([0.08, 0.08, 0.09]), steel: lin([0.55, 0.57, 0.6]), alu: lin([0.72, 0.74, 0.77]),
  rubber: lin([0.025, 0.025, 0.028]), white: lin([0.92, 0.92, 0.9]), red: lin([0.7, 0.05, 0.04]), amber: lin([0.95, 0.55, 0.08]), lens: lin([0.85, 0.88, 0.92]),
  frame: lin([0.07, 0.07, 0.08]), wood: lin([0.55, 0.38, 0.2]), plate: lin([0.9, 0.9, 0.82]), seat: lin([0.12, 0.11, 0.12]), dash: lin([0.1, 0.1, 0.11]),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _n3 = new THREE.Matrix3();
const _v = new THREE.Vector3(), _nv = new THREE.Vector3();
const geoCache = new Map();
const cached = (key, make) => {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
};

/** Accumulates vertices from many primitives into one attribute set. */
export class VB {
  constructor() {
    this.P = [];
    this.N = [];
    this.C = [];
    this.K = [];
    this.B = [];
    this.G = [];
    this.D = [];
    this.I = [];
  }

  get count() {
    return this.P.length / 3;
  }

  /** Append a geometry under matrix m. o: { col, kind, body, glow, uv:[u0,v0,u1,v1] } */
  geo(g, m, o = {}) {
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const base = this.count;
    _n3.getNormalMatrix(m);
    const col = o.col || COL.dark, kind = o.kind ?? KIND.PAINT, body = o.body ? 1 : 0, glow = o.glow || 0;
    const r = o.uv || [0, 0, 1, 1];
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      _nv.fromBufferAttribute(nor, i).applyMatrix3(_n3).normalize();
      this.P.push(_v.x, _v.y, _v.z);
      this.N.push(_nv.x, _nv.y, _nv.z);
      this.C.push(col[0], col[1], col[2]);
      this.K.push(kind);
      this.B.push(body);
      this.G.push(glow);
      if (uv && kind !== KIND.RIB) this.D.push(r[0] + (r[2] - r[0]) * uv.getX(i), r[1] + (r[3] - r[1]) * uv.getY(i));
      else this.D.push(_v.x, _v.y);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.I.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) this.I.push(base + i);
    return this;
  }

  tr(g, x, y, z, o, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    return this.geo(g, _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)), o);
  }

  /** Axis-aligned flat box. */
  box(x0, x1, y0, y1, z0, z1, o) {
    return this.tr(cached('box', () => new THREE.BoxGeometry(1, 1, 1)), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, o, 0, 0, 0, x1 - x0, y1 - y0, z1 - z0);
  }

  /** Rounded box by centre and size. */
  rbox(cx, cy, cz, sx, sy, sz, r, o, rx = 0, ry = 0, rz = 0) {
    const rr = Math.min(r, sx / 2 - 1e-3, sy / 2 - 1e-3, sz / 2 - 1e-3);
    if (rr <= 0.003) return this.tr(cached('box', () => new THREE.BoxGeometry(1, 1, 1)), cx, cy, cz, o, rx, ry, rz, sx, sy, sz);
    return this.tr(roundedBox(sx, sy, sz, rr), cx, cy, cz, o, rx, ry, rz);
  }

  /** Cylinder along an axis ('x' | 'y' | 'z'), optionally tapered. */
  cyl(cx, cy, cz, r, len, axis, o, seg = 18, r2 = r, open = false) {
    const g = cached(`cy${seg}${open}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, open));
    const gg = r2 === r ? g : new THREE.CylinderGeometry(r2, r, 1, seg, 1, open);
    const rx = axis === 'z' ? Math.PI / 2 : 0, rz = axis === 'x' ? -Math.PI / 2 : 0;
    return this.tr(gg, cx, cy, cz, o, rx, 0, rz, r2 === r ? r : 1, len, r2 === r ? r : 1);
  }

  /** Quad from four corners (counter-clockwise seen from the front); normal from the winding. */
  quad(a, b, c, d, o) {
    const n = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a)).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a))).normalize();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return this.geo(g, _m.identity(), o);
  }

  /** Quad that faces the given outward direction whatever the corner order. */
  face(a, b, c, d, outward, o) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const flip = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0;
    return flip ? this.quad(a, d, c, b, o) : this.quad(a, b, c, d, o);
  }

  /** Mirror everything already added about the plane z = 0 (for symmetric models built on one side). */
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.K, 1));
    g.setAttribute('aBody', new THREE.Float32BufferAttribute(this.B, 1));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.G, 1));
    g.setAttribute('aDecal', new THREE.Float32BufferAttribute(this.D, 2));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

const rbCache = new Map();
function roundedBox(sx, sy, sz, r) {
  const key = `${sx.toFixed(3)}|${sy.toFixed(3)}|${sz.toFixed(3)}|${r.toFixed(3)}`;
  let g = rbCache.get(key);
  if (!g) rbCache.set(key, (g = RoundedBox(sx, sy, sz, r)));
  return g;
}

/** Rounded box geometry (smooth corners, flat faces). */
function RoundedBox(w, h, d, r, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.attributes.position, n = g.attributes.normal;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 1e-12) {
      dir.normalize();
      v.copy(c).addScaledVector(dir, r);
      p.setXYZ(i, v.x, v.y, v.z);
      n.setXYZ(i, dir.x, dir.y, dir.z);
    }
  }
  return g;
}

// ── Lathe, extrusion and wheel helpers ────────────────────────────────────────
/** Revolve a [radius, y] profile around the y axis, then orient it along an axis. */
export function lathe(vb, pts, cx, cy, cz, axis, o, seg = 24) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const rx = axis === 'z' ? Math.PI / 2 : 0, rz = axis === 'x' ? -Math.PI / 2 : 0;
  vb.tr(g, cx, cy, cz, o, rx, 0, rz);
}

/** Tyre + rim + hub, axis along z, centred at the origin. dual adds a second tyre. */
export function addWheel(vb, r, w, { rim = COL.alu, rimKind = KIND.CHROME, spokes = 5, lugs = 8, truck = false, offset = [0, 0, 0] } = {}) {
  const [ox, oy, oz] = offset;
  const rr = r * (truck ? 0.6 : 0.62);
  const hw = w / 2;
  const prof = [[rr, -hw], [r * 0.94, -hw * 0.98], [r * 0.99, -hw * 0.82], [r, -hw * 0.5], [r, hw * 0.5], [r * 0.99, hw * 0.82], [r * 0.94, hw * 0.98], [rr, hw]];
  lathe(vb, prof, ox, oy, oz, 'z', { col: COL.rubber, kind: KIND.RUBBER }, 26);
  // sidewall shoulder lettering ring (lighter band) and tread grooves
  for (const s of [-1, 1]) lathe(vb, [[r * 0.8, s * hw * 0.99], [r * 0.82, s * hw * 1.0]], ox, oy, oz, 'z', { col: lin([0.09, 0.09, 0.1]), kind: KIND.RUBBER }, 26);
  for (const gz of [-0.25, 0.25]) lathe(vb, [[r * 0.995, gz * w - 0.012], [r * 1.0005, gz * w - 0.012], [r * 1.0005, gz * w + 0.012], [r * 0.995, gz * w + 0.012]], ox, oy, oz, 'z', { col: lin([0.012, 0.012, 0.014]), kind: KIND.RUBBER }, 26);
  // rim: dished face
  const face = hw * (truck ? 0.88 : 0.78);
  lathe(vb, [[0.02, face], [rr * 0.34, face], [rr * 0.4, face - 0.012], [rr * 0.92, face - 0.02], [rr, face - 0.045], [rr, -hw * 0.5]], ox, oy, oz, 'z', { col: rim, kind: rimKind }, 26);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + 0.3;
    const L = rr * 0.78;
    vb.tr(new THREE.BoxGeometry(L, rr * 0.2, 0.012), ox + Math.cos(a) * L * 0.55, oy + Math.sin(a) * L * 0.55, oz + face + 0.002, { col: rim, kind: rimKind }, 0, 0, a);
  }
  vb.cyl(ox, oy, oz + face + 0.006, rr * 0.28, 0.03, 'z', { col: COL.steel, kind: KIND.CHROME }, 14);
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    vb.cyl(ox + Math.cos(a) * rr * 0.32, oy + Math.sin(a) * rr * 0.32, oz + face + 0.012, 0.012, 0.016, 'z', { col: COL.steel, kind: KIND.CHROME }, 6);
  }
}

/** Extrude a closed [x, y] profile across z (width), centred, with a small bevel. */
export function extrudeProfile(pts, width, { bevel = 0.05, steps = 4 } = {}) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, steps, curveSegments: 4 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  return g;
}

/** Points of an arch (wheel well) from angle a0 to a1 around (cx, cy) with radius R, y clamped to the sill. */
export function arch(cx, cy, R, a0 = 0, a1 = Math.PI, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return out;
}

// ── Material ──────────────────────────────────────────────────────────────────
/**
 * One shader for every vehicle. Per-vertex kind sets roughness, metalness and special looks;
 * `aBody` vertices take the tint (instance colour for instanced meshes, otherwise uTint);
 * lamps glow with uLamp = (head, tail, brake) and decals sample the shared sign atlas.
 */
export function vehicleMaterial(season, atlas = null) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, envMapIntensity: 1.1 });
  const uTint = { value: new THREE.Color(1, 1, 1) };
  const uLamp = { value: new THREE.Vector4(0, 0.25, 0, 0) };
  mat.userData = { uTint, uLamp };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = uTint;
    sh.uniforms.uLamp = uLamp;
    sh.uniforms.uNight = season.u.uNight;
    sh.uniforms.uWet = season.u.uWet;
    sh.uniforms.tDecal = { value: atlas?.texture ?? null };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind;\nattribute float aBody;\nattribute float aGlow;\nattribute vec2 aDecal;\nuniform vec3 uTint;\nvarying float vKind;\nvarying float vGlow;\nvarying vec2 vDecal;\nvarying vec3 vTint;\nvarying vec3 vOP;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        vKind = aKind; vGlow = aGlow; vDecal = aDecal; vOP = position;
        #ifdef USE_INSTANCING_COLOR
          vTint = mix(vec3(1.0), instanceColor.xyz, aBody);
        #else
          vTint = mix(vec3(1.0), uTint, aBody);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec4 uLamp;
        uniform float uNight;
        uniform float uWet;
        uniform sampler2D tDecal;
        varying float vKind;
        varying float vGlow;
        varying vec2 vDecal;
        varying vec3 vTint;
        varying vec3 vOP;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float vk = floor(vKind + 0.5);
        diffuseColor.rgb *= vTint;
        if (vk == 7.0) diffuseColor.rgb = texture2D(tDecal, vDecal).rgb;
        if (vk == 8.0) { float rib = 0.5 + 0.5 * sin(vDecal.x * 52.0); diffuseColor.rgb *= 0.9 + 0.1 * rib; }
        if (vk == 0.0) diffuseColor.rgb *= 0.97 + 0.03 * sin(vOP.x * 9.0 + vOP.y * 5.0);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float vr = 0.45, vmt = 0.2;
        if (vk == 0.0) { vr = 0.3; vmt = 0.35; }
        else if (vk == 1.0) { vr = 0.04; vmt = 0.9; }
        else if (vk == 2.0) { vr = 0.16; vmt = 1.0; }
        else if (vk == 3.0) { vr = 0.92; vmt = 0.0; }
        else if (vk == 4.0) { vr = 0.7; vmt = 0.05; }
        else if (vk == 5.0) { vr = 0.08; vmt = 0.1; }
        else if (vk == 6.0) { vr = 0.5; vmt = 0.55; }
        else if (vk == 7.0) { vr = 0.55; vmt = 0.05; }
        else if (vk == 8.0) { vr = 0.45; vmt = 0.4; }
        else if (vk == 9.0) { vr = 0.9; vmt = 0.0; }
        else if (vk == 10.0) { vr = 0.95; vmt = 0.0; }
        vr = mix(vr, vr * 0.6, uWet * 0.6);
        roughnessFactor = vr;`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vmt;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vGlow > 0.5) {
          vec3 lc = vGlow > 2.5 ? vec3(1.0, 0.55, 0.1) : (vGlow > 1.5 ? vec3(1.0, 0.04, 0.02) : vec3(1.0, 0.93, 0.78));
          float lv = vGlow > 2.5 ? uLamp.w : (vGlow > 1.5 ? uLamp.y + uLamp.z : uLamp.x);
          totalEmissiveRadiance += lc * lv * 2.4;
        }`);
  };
  mat.customProgramCacheKey = () => 'vehicleMat1';
  return mat;
}

// ── Cars ──────────────────────────────────────────────────────────────────────
VB.prototype.tri = function tri(a, b, c, outward, o) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const flip = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0;
  if (flip) {
    [b, c] = [c, b];
    n = n.map((x) => -x);
  }
  const l = Math.hypot(...n) || 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([...n.map((x) => x / l), ...n.map((x) => x / l), ...n.map((x) => x / l)], 3));
  g.setIndex([0, 1, 2]);
  return this.geo(g, _m.identity(), o);
};

/** Convex polygon (3D points) as a triangle fan facing outward. */
VB.prototype.poly = function poly(pts, outward, o) {
  for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], outward, o);
  return this;
};

/**
 * Body shell from a side profile. def: { L, half, sill, belt, roofY, tumble, crown, endR, top: [[x, y]…] rear→front over the
 * roof, wheels: [{ x, r }] } — wheel arches are cut into the profile so the wheels sit in real openings.
 */
function carShell(vb, def) {
  const { L, half, sill, belt, roofY, tumble = 0.16, crown = 0.05, endR = 0.55, wheels } = def;
  const pts = def.top.map((p) => p.slice());
  for (const w of [...wheels].sort((a, b) => b.x - a.x)) {
    const R = w.r + 0.075;
    const a0 = Math.asin(Math.max(-1, Math.min(1, (sill - w.r) / R)));
    for (const p of arch(w.x, w.r, R, a0, Math.PI - a0, 10)) pts.push(p);
  }
  const g = extrudeProfile(pts, half * 2, { bevel: 0.07, steps: 6 });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const zf = z / half;
    let s = 1;
    if (y > belt) s = Math.max(0.66, 1 - (tumble * (y - belt)) / Math.max(0.1, roofY - belt));
    else if (y < sill + 0.1) s = 0.965;
    const dx = Math.abs(x) - (L / 2 - endR);
    if (dx > 0) s *= Math.sqrt(Math.max(0.12, 1 - 0.55 * (dx / endR) ** 2));
    z *= s;
    if (y > belt) y -= crown * zf * zf;
    p.setXYZ(i, x, y, z);
  }
  const gs = toCreasedNormals(g, 0.9);
  vb.tr(gs, 0, 0, 0, { col: [1, 1, 1], kind: KIND.PAINT, body: true });
  return (y, x) => {
    let s = 1;
    if (y > belt) s = Math.max(0.66, 1 - (tumble * (y - belt)) / Math.max(0.1, roofY - belt));
    else if (y < sill + 0.1) s = 0.965;
    const dx = Math.abs(x) - (L / 2 - endR);
    if (dx > 0) s *= Math.sqrt(Math.max(0.12, 1 - 0.55 * (dx / endR) ** 2));
    return half * s - (y > belt ? crown * 0.0 : 0);
  };
}

function carDetails(vb, def, zAt) {
  const { L, half, belt } = def;
  const G = { col: COL.glass, kind: KIND.GLASS };
  const sgn = [-1, 1];
  // side glass polygons (x, y) → 3D on the tapered side
  for (const poly of def.sideGlass || []) {
    for (const sd of sgn) {
      const pts3 = poly.map(([x, y]) => [x, y, sd * (zAt(y, x) + 0.012)]);
      vb.poly(pts3, [0, 0, sd], G);
    }
  }
  const quadGlass = (g, inset) => {
    if (!g) return;
    const [[xb, yb], [xt, yt]] = g;
    const zb = zAt(yb, xb) - inset[0], zt = zAt(yt, xt) - inset[1];
    const dx = xt - xb, dy = yt - yb;
    let n = [dy, -dx];
    if (n[1] < 0) n = [-n[0], -n[1]];
    vb.face([xb, yb, -zb], [xb, yb, zb], [xt, yt, zt], [xt, yt, -zt], [n[0], n[1], 0], G);
  };
  quadGlass(def.windshield, [0.07, 0.1]);
  quadGlass(def.rearGlass, [0.07, 0.1]);
  // door shut lines, handles, sills
  for (const sd of sgn) {
    for (const x of def.doorLines || []) vb.box(x - 0.006, x + 0.006, def.sill + 0.06, belt - 0.02, sd * (zAt(belt - 0.1, x) + 0.004), sd * (zAt(belt - 0.1, x) + 0.012), { col: COL.black, kind: KIND.PLASTIC });
    for (const x of def.handles || []) vb.rbox(x, belt - 0.12, sd * (zAt(belt - 0.12, x) + 0.02), 0.13, 0.028, 0.03, 0.01, { col: COL.alu, kind: KIND.CHROME });
    vb.box(-L / 2 + 0.75, L / 2 - 0.75, def.sill - 0.02, def.sill + 0.06, sd * (half * 0.965 - 0.0), sd * (half * 0.965 + 0.02), { col: COL.black, kind: KIND.PLASTIC });
    // mirrors
    const mx = def.mirrorX;
    if (mx !== undefined) {
      vb.rbox(mx, belt + 0.1, sd * (half + 0.12), 0.14, 0.11, 0.16, 0.035, { col: [1, 1, 1], kind: KIND.PAINT, body: true });
      vb.box(mx - 0.02, mx + 0.02, belt + 0.02, belt + 0.1, sd * (half - 0.02), sd * (half + 0.05), { col: COL.black, kind: KIND.PLASTIC });
    }
    // head lamps and fog lamps
    const h = def.head;
    vb.rbox(h.x, h.y, sd * h.z, h.dx, h.dy, h.dz, 0.03, { col: COL.lens, kind: KIND.LENS, glow: 1 });
    vb.rbox(h.x + 0.005, h.y - h.dy * 0.15, sd * (h.z + h.dz * 0.52), h.dx * 0.9, h.dy * 0.15, 0.015, 0.006, { col: COL.alu, kind: KIND.CHROME });
    const t = def.tail;
    vb.rbox(t.x, t.y, sd * t.z, t.dx, t.dy, t.dz, 0.03, { col: COL.red, kind: KIND.LENS, glow: 2 });
    vb.rbox(t.x, t.y - t.dy * 0.7, sd * (t.z), t.dx * 0.8, 0.03, t.dz * 0.95, 0.01, { col: COL.amber, kind: KIND.LENS, glow: 3 });
  }
  // grille, bumpers, plate, exhaust
  const f = def.front;
  vb.rbox(f.x, f.y, 0, 0.05, f.h, f.w, 0.02, { col: COL.black, kind: KIND.PLASTIC });
  for (let i = -2; i <= 2; i++) vb.box(f.x + 0.025, f.x + 0.04, f.y - f.h * 0.35, f.y + f.h * 0.35, i * f.w * 0.17 - 0.012, i * f.w * 0.17 + 0.012, { col: COL.alu, kind: KIND.CHROME });
  vb.rbox(f.x + 0.015, f.y + f.h * 0.52, 0, 0.06, 0.035, f.w * 1.02, 0.012, { col: COL.alu, kind: KIND.CHROME });
  vb.rbox(L / 2 - 0.05, def.sill + 0.16, 0, 0.16, 0.24, half * 1.74, 0.07, { col: COL.black, kind: KIND.PLASTIC });
  vb.rbox(-L / 2 + 0.05, def.sill + 0.17, 0, 0.16, 0.26, half * 1.74, 0.07, { col: COL.black, kind: KIND.PLASTIC });
  vb.rbox(L / 2 - 0.01, def.sill + 0.1, 0, 0.03, 0.12, 0.5, 0.012, { col: COL.black, kind: KIND.PLASTIC });
  vb.box(L / 2 + 0.01, L / 2 + 0.03, def.sill + 0.02, def.sill + 0.16, -0.26, 0.26, { col: COL.plate, kind: KIND.PLASTIC });
  vb.box(-L / 2 - 0.01, -L / 2 - 0.035, def.sill + 0.26, def.sill + 0.4, -0.26, 0.26, { col: COL.plate, kind: KIND.PLASTIC });
  vb.cyl(-L / 2 - 0.02, def.sill + 0.05, half * 0.5, 0.035, 0.1, 'x', { col: COL.alu, kind: KIND.CHROME }, 10);
  // underbody
  vb.box(-L / 2 + 0.3, L / 2 - 0.3, def.sill - 0.18, def.sill + 0.02, -half * 0.9, half * 0.9, { col: COL.black, kind: KIND.PLASTIC });
}

/** Wheel spec for a car: positions in the model frame. */
function carWheels(def) {
  const out = [];
  for (const w of def.wheels) for (const sd of [-1, 1]) out.push({ x: w.x, y: w.r, z: sd * (def.half - w.w / 2 + 0.01), r: w.r, w: w.w, steer: w.x > 0, side: sd, rim: w.rim });
  return out;
}

const CAR_DEFS = {
  sedan: {
    L: 4.72, half: 0.9, sill: 0.28, belt: 1.0, roofY: 1.46, wheels: [{ x: 1.5, r: 0.335, w: 0.225 }, { x: -1.4, r: 0.335, w: 0.225 }],
    top: [[-2.28, 0.3], [-2.36, 0.46], [-2.37, 0.7], [-2.3, 0.94], [-1.8, 0.99], [-1.5, 1.0], [-1.0, 1.4], [-0.2, 1.465], [0.5, 1.44], [1.1, 1.02], [1.6, 0.98], [2.05, 0.92], [2.3, 0.8], [2.37, 0.62], [2.33, 0.42], [2.25, 0.3]],
    sideGlass: [[[-1.42, 1.035], [-0.97, 1.385], [-0.08, 1.43], [-0.08, 1.035]], [[0.04, 1.035], [0.04, 1.43], [0.48, 1.41], [1.02, 1.045]]],
    windshield: [[1.13, 1.03], [0.55, 1.44]], rearGlass: [[-1.5, 1.01], [-1.02, 1.395]], doorLines: [-0.04, 1.0, -1.18], handles: [-0.35, 0.6, -1.45], mirrorX: 1.0,
    head: { x: 2.3, y: 0.78, z: 0.6, dx: 0.1, dy: 0.13, dz: 0.34 }, tail: { x: -2.34, y: 0.82, z: 0.62, dx: 0.08, dy: 0.12, dz: 0.34 }, front: { x: 2.36, y: 0.56, h: 0.15, w: 0.8 },
  },
  suv: {
    L: 4.78, half: 0.93, sill: 0.34, belt: 1.12, roofY: 1.74, wheels: [{ x: 1.5, r: 0.385, w: 0.245 }, { x: -1.4, r: 0.385, w: 0.245 }],
    top: [[-2.3, 0.4], [-2.4, 0.56], [-2.41, 1.1], [-2.36, 1.64], [-2.25, 1.74], [-0.6, 1.76], [0.35, 1.74], [1.0, 1.16], [1.7, 1.1], [2.15, 1.03], [2.34, 0.9], [2.4, 0.7], [2.35, 0.5], [2.27, 0.4]],
    sideGlass: [[[-2.2, 1.17], [-2.22, 1.65], [-1.1, 1.69], [-1.1, 1.17]], [[-1.0, 1.17], [-1.0, 1.69], [-0.1, 1.7], [-0.1, 1.17]], [[0.0, 1.17], [0.0, 1.7], [0.3, 1.69], [0.82, 1.18]]],
    windshield: [[1.02, 1.15], [0.38, 1.73]], rearGlass: [[-2.42, 1.2], [-2.37, 1.62]], doorLines: [-1.05, -0.05, 0.9], handles: [-0.55, 0.4, -1.55], mirrorX: 0.95,
    head: { x: 2.33, y: 0.92, z: 0.66, dx: 0.1, dy: 0.15, dz: 0.34 }, tail: { x: -2.4, y: 1.0, z: 0.7, dx: 0.06, dy: 0.34, dz: 0.12 }, front: { x: 2.4, y: 0.68, h: 0.2, w: 0.82 },
  },
  hatch: {
    L: 4.05, half: 0.85, sill: 0.27, belt: 0.98, roofY: 1.45, wheels: [{ x: 1.28, r: 0.31, w: 0.205 }, { x: -1.2, r: 0.31, w: 0.205 }],
    top: [[-1.95, 0.3], [-2.03, 0.45], [-2.04, 0.8], [-1.98, 1.15], [-1.7, 1.42], [-0.9, 1.46], [0.2, 1.44], [0.85, 1.02], [1.35, 0.96], [1.75, 0.88], [1.97, 0.74], [2.02, 0.58], [1.98, 0.4], [1.9, 0.3]],
    sideGlass: [[[-1.78, 1.04], [-1.58, 1.4], [-0.95, 1.43], [-0.95, 1.04]], [[-0.88, 1.04], [-0.88, 1.43], [-0.1, 1.42], [-0.1, 1.04]], [[0.0, 1.04], [0.0, 1.42], [0.2, 1.42], [0.76, 1.05]]],
    windshield: [[0.85, 1.03], [0.22, 1.43]], rearGlass: [[-1.99, 1.12], [-1.72, 1.4]], doorLines: [-0.92, -0.05], handles: [-0.5, 0.45], mirrorX: 0.8,
    head: { x: 1.96, y: 0.76, z: 0.56, dx: 0.1, dy: 0.12, dz: 0.32 }, tail: { x: -2.02, y: 0.88, z: 0.6, dx: 0.06, dy: 0.14, dz: 0.2 }, front: { x: 2.02, y: 0.55, h: 0.14, w: 0.72 },
  },
  van: {
    L: 5.9, half: 0.98, sill: 0.36, belt: 1.25, roofY: 2.5, tumble: 0.06, crown: 0.04, endR: 0.6, wheels: [{ x: 1.85, r: 0.375, w: 0.235 }, { x: -1.75, r: 0.375, w: 0.235 }],
    top: [[-2.95, 0.42], [-2.99, 0.6], [-2.99, 2.2], [-2.9, 2.46], [-2.7, 2.52], [1.6, 2.54], [2.1, 2.5], [2.55, 1.58], [2.8, 1.12], [2.97, 0.95], [2.99, 0.7], [2.95, 0.48], [2.86, 0.4]],
    sideGlass: [[[1.55, 1.34], [1.55, 2.16], [2.0, 2.14], [2.42, 1.5], [2.4, 1.34]]],
    windshield: [[2.52, 1.6], [2.12, 2.44]], rearGlass: null, doorLines: [1.45, -2.9], handles: [1.7], mirrorX: 2.35,
    head: { x: 2.93, y: 0.95, z: 0.7, dx: 0.1, dy: 0.15, dz: 0.34 }, tail: { x: -2.98, y: 1.1, z: 0.8, dx: 0.06, dy: 0.5, dz: 0.12 }, front: { x: 3.0, y: 0.7, h: 0.2, w: 0.7 },
  },
};

/**
 * A passenger vehicle. Returns { geo, wheels, dims } — wheels are listed separately so the player
 * rig can spin them; `merged()` folds them into the body for instancing.
 */
export function buildCar(kind = 'sedan', { wheels = 'merged', detail = 1 } = {}) {
  if (kind === 'pickup') return buildPickup({ wheels, detail });
  const def = CAR_DEFS[kind] || CAR_DEFS.sedan;
  const vb = new VB();
  const zAt = carShell(vb, def);
  carDetails(vb, def, zAt);
  if (kind === 'van') {
    // rear doors, cargo-van roof rails and a white-van side profile
    for (const sd of [-1, 1]) vb.box(-2.98, -2.99, 0.9, 2.1, sd * 0.45 - 0.01, sd * 0.45 + 0.01, { col: COL.black, kind: KIND.PLASTIC });
    vb.box(-2.99, -3.0, 0.9, 2.1, -0.01, 0.01, { col: COL.black, kind: KIND.PLASTIC });
  }
  const ws = carWheels(def);
  return finish(vb, ws, { L: def.L, W: def.half * 2, H: def.roofY, wheelsMode: wheels, detail, kindName: kind, wheelbase: def.wheels[0].x - def.wheels[1].x });
}

function buildPickup({ wheels, detail }) {
  const vb = new VB();
  const cab = {
    L: 5.9, half: 0.97, sill: 0.4, belt: 1.32, roofY: 1.92, tumble: 0.12, endR: 0.6, wheels: [{ x: 1.75, r: 0.4, w: 0.265 }, { x: -1.45, r: 0.4, w: 0.265 }],
    top: [[-0.35, 0.45], [-0.3, 1.3], [-0.25, 1.4], [-0.15, 1.9], [0.45, 1.93], [1.0, 1.9], [1.45, 1.45], [1.75, 1.28], [2.3, 1.22], [2.75, 1.14], [2.95, 0.98], [2.98, 0.74], [2.92, 0.52], [2.85, 0.45]],
    sideGlass: [[[-0.1, 1.42], [-0.08, 1.85], [0.45, 1.88], [0.5, 1.42]], [[0.58, 1.42], [0.58, 1.88], [0.95, 1.86], [1.38, 1.46], [1.38, 1.42]]],
    windshield: [[1.46, 1.42], [1.0, 1.88]], rearGlass: null, doorLines: [-0.2, 0.55, 1.45], handles: [0.3, 1.2], mirrorX: 1.5,
    head: { x: 2.93, y: 1.0, z: 0.7, dx: 0.1, dy: 0.16, dz: 0.36 }, tail: { x: -2.96, y: 1.0, z: 0.8, dx: 0.06, dy: 0.2, dz: 0.14 }, front: { x: 2.98, y: 0.76, h: 0.26, w: 0.84 },
  };
  // cab shell: only the forward part of the truck (x −0.35 … 2.98); the bed is built separately behind it
  const zAt = carShell(vb, { ...cab, L: 6.6 });
  carDetails(vb, { ...cab, L: 5.9 }, zAt);
  // bed: floor, side walls with wheel arches, headboard and tailgate
  const bedX0 = -2.95, bedX1 = -0.45, W = cab.half * 2;
  vb.box(bedX0, bedX1, 0.78, 0.88, -cab.half + 0.12, cab.half - 0.12, { col: COL.dark, kind: KIND.PLASTIC });
  for (const sd of [-1, 1]) {
    const pts = [[bedX0, 0.45], [bedX0, 1.32], [bedX1, 1.32], [bedX1, 0.45]];
    const R = 0.475;
    const a0 = Math.asin((0.45 - 0.4) / R);
    for (const p of arch(-1.45, 0.4, R, a0, Math.PI - a0, 10).reverse()) pts.push(p);
    const g = extrudeProfile(pts.slice(0, 4).concat(arch(-1.45, 0.4, R, a0, Math.PI - a0, 10).reverse().map((p) => p)), 0.12, { bevel: 0.025, steps: 1 });
    vb.tr(g, 0, 0, sd * (cab.half - 0.06), { col: [1, 1, 1], kind: KIND.PAINT, body: true });
    vb.rbox((bedX0 + bedX1) / 2, 1.335, sd * (cab.half - 0.06), bedX1 - bedX0, 0.05, 0.16, 0.02, { col: COL.alu, kind: KIND.CHROME });
  }
  vb.rbox(bedX1 + 0.05, 1.12, 0, 0.1, 0.5, W - 0.1, 0.03, { col: [1, 1, 1], kind: KIND.PAINT, body: true });
  vb.rbox(bedX0 + 0.04, 1.08, 0, 0.1, 0.55, W - 0.14, 0.03, { col: [1, 1, 1], kind: KIND.PAINT, body: true });
  vb.rbox(bedX0 - 0.03, 1.33, 0, 0.06, 0.05, W - 0.1, 0.02, { col: COL.alu, kind: KIND.CHROME });
  vb.rbox(bedX0 - 0.1, 0.55, 0, 0.14, 0.26, W * 0.92, 0.07, { col: COL.black, kind: KIND.PLASTIC });
  vb.box(bedX0 - 0.2, bedX0 - 0.16, 0.6, 0.74, -0.26, 0.26, { col: COL.plate, kind: KIND.PLASTIC });
  for (const sd of [-1, 1]) vb.rbox(bedX0 - 0.025, 1.04, sd * (cab.half - 0.14), 0.06, 0.2, 0.14, 0.03, { col: COL.red, kind: KIND.LENS, glow: 2 });
  vb.box(bedX1 - 2.5, bedX1 + 0.1, 0.3, 0.46, -cab.half * 0.85, cab.half * 0.85, { col: COL.black, kind: KIND.PLASTIC });
  const ws = carWheels({ ...cab, wheels: cab.wheels.map((w) => ({ ...w })) });
  return finish(vb, ws, { L: 6.0, W, H: cab.roofY, wheelsMode: wheels, detail, kindName: 'pickup', wheelbase: 3.2 });
}

function finish(vb, wheelList, meta) {
  const { wheelsMode, detail } = meta;
  const out = { dims: { L: meta.L, W: meta.W, H: meta.H }, wheels: wheelList, kind: meta.kindName, wheelbase: meta.wheelbase };
  const addAll = (b, mirrorSide) => {
    for (const w of wheelList) {
      const sub = new VB();
      addWheel(sub, w.r, w.w, { spokes: detail > 0.6 ? 5 : 3, lugs: detail > 0.6 ? 5 : 0 });
      void mirrorSide;
      const g = sub.build();
      b.geo(g, new THREE.Matrix4().makeTranslation(w.x, w.y, w.z).multiply(new THREE.Matrix4().makeScale(1, 1, w.side)), { col: [1, 1, 1], kind: KIND.PAINT });
    }
  };
  void addAll;
  if (wheelsMode === 'merged') {
    const wheelVB = new VB();
    for (const w of wheelList) {
      const sub = new VB();
      addWheel(sub, w.r, w.w, { spokes: detail > 0.6 ? 5 : 3, lugs: detail > 0.6 ? 6 : 0 });
      // the wheel is modelled facing +z; for the left side it faces -z
      const mtx = new THREE.Matrix4().makeTranslation(w.x, w.y, w.z);
      if (w.side < 0) mtx.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      copyInto(wheelVB, sub, mtx);
    }
    copyInto(vb, wheelVB, new THREE.Matrix4());
    out.geo = vb.build();
  } else {
    out.geo = vb.build();
    out.wheelGeo = (() => {
      const sub = new VB();
      const w0 = wheelList[0];
      addWheel(sub, w0.r, w0.w, { spokes: 5, lugs: 6 });
      return sub.build();
    })();
  }
  return out;
}

/** Append one builder's vertices into another, transformed (keeps every attribute). */
function copyInto(dst, src, m) {
  const base = dst.count;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) {
    v.set(src.P[i * 3], src.P[i * 3 + 1], src.P[i * 3 + 2]).applyMatrix4(m);
    n.set(src.N[i * 3], src.N[i * 3 + 1], src.N[i * 3 + 2]).applyMatrix3(nm).normalize();
    dst.P.push(v.x, v.y, v.z);
    dst.N.push(n.x, n.y, n.z);
    dst.C.push(src.C[i * 3], src.C[i * 3 + 1], src.C[i * 3 + 2]);
    dst.K.push(src.K[i]);
    dst.B.push(src.B[i]);
    dst.G.push(src.G[i]);
    dst.D.push(src.D[i * 2], src.D[i * 2 + 1]);
  }
  for (const i of src.I) dst.I.push(base + i);
}

// ── Development showroom (used by screenshot scripts) ─────────────────────────
export function showroom(world, items, { ground = true } = {}) {
  const sc = world.stage.scene;
  const root = new THREE.Group();
  root.name = 'showroom';
  sc.add(root);
  world.vanRoot.visible = false;
  world.land.envRoot.visible = false;
  if (ground) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x7c8087, roughness: 0.95 }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    root.add(g);
  }
  for (const it of items) {
    const mat = vehicleMaterial(world.terrain.season, world.land.towns.atlas);
    mat.userData.uTint.value.setRGB(...(it.tint || [1, 1, 1]));
    mat.userData.uLamp.value.set(it.head ?? 0, it.tail ?? 0.3, it.brake ?? 0, 0);
    const grp = new THREE.Group();
    const body = new THREE.Mesh(it.model.geo, mat);
    body.castShadow = body.receiveShadow = true;
    grp.add(body);
    if (it.model.wheelGeo) {
      for (const w of it.model.wheels) {
        const m = new THREE.Mesh(it.model.wheelGeo, mat);
        m.position.set(w.x, w.y, w.z);
        if (w.side < 0) m.rotation.y = Math.PI;
        m.castShadow = true;
        grp.add(m);
      }
    }
    grp.position.set(it.x || 0, it.y || 0, it.z || 0);
    grp.rotation.y = it.yaw || 0;
    root.add(grp);
  }
  return root;
}

// ── Semi tractor ──────────────────────────────────────────────────────────────
const PAINT = { col: [1, 1, 1], kind: KIND.PAINT, body: true };
const CH = { col: COL.alu, kind: KIND.CHROME };
const BLK = { col: COL.black, kind: KIND.PLASTIC };
const FRAME = { col: COL.frame, kind: KIND.METAL };
const GLS = { col: COL.glass, kind: KIND.GLASS };

/** Dimensions shared by the tractor model and the physics (origin = centre of the drive tandem). */
export const TRACTOR = {
  wheelbase: 5.9, // steer axle → drive tandem centre
  steerX: 5.9, driveX: [0.685, -0.685], steerTrack: 1.0, driveTrack: 0.915, dualGap: 0.165,
  tyreR: 0.52, tyreW: 0.295, fifthX: 0.15, fifthY: 1.2, length: 8.6, width: 2.5, height: 3.95, bumperX: 7.35, rearX: -1.95,
};

/**
 * American conventional sleeper tractor. Returns { geo, wheels, ... }; wheels (steer, drive tandem) are
 * separate so the rig can spin and steer them. `style` 'classic' has a chrome grille and stacks.
 */
export function buildTractor({ sleeper = true, wheels = 'separate', detail = 1 } = {}) {
  const T = TRACTOR;
  const vb = new VB();
  const sg = [-1, 1];
  // chassis
  for (const s of sg) vb.box(T.rearX, T.bumperX - 0.35, 0.86, 1.12, s * 0.46 - 0.06, s * 0.46 + 0.06, FRAME);
  vb.box(T.rearX, T.bumperX - 0.35, 0.86, 0.9, -0.5, 0.5, FRAME);
  for (const x of [0, 2.2, 3.9, 5.3]) vb.box(x - 0.08, x + 0.08, 0.9, 1.08, -0.5, 0.5, FRAME);
  // axles, differentials and the steer axle beam
  for (const x of T.driveX) {
    vb.cyl(x, T.tyreR, 0, 0.09, 2.0, 'z', FRAME, 10);
    vb.rbox(x, T.tyreR, 0, 0.55, 0.5, 0.55, 0.12, FRAME);
  }
  vb.cyl(T.steerX, T.tyreR, 0, 0.07, 1.9, 'z', FRAME, 10);
  vb.rbox(1.35, 0.55, 0, 2.2, 0.16, 0.22, 0.05, FRAME);
  // fifth wheel
  vb.rbox(T.fifthX, T.fifthY - 0.06, 0, 1.25, 0.11, 1.18, 0.04, { col: COL.dark, kind: KIND.METAL });
  vb.rbox(T.fifthX + 0.1, T.fifthY + 0.01, 0, 0.9, 0.05, 1.0, 0.02, { col: COL.alu, kind: KIND.METAL });
  vb.box(T.fifthX - 0.55, T.fifthX + 0.1, T.fifthY - 0.01, T.fifthY + 0.04, -0.05, 0.05, { col: COL.black, kind: KIND.METAL });
  vb.rbox(T.fifthX - 0.2, T.fifthY - 0.3, 0, 1.4, 0.35, 0.8, 0.05, FRAME);
  // fuel tanks, battery box, air tanks and steps
  for (const s of sg) {
    vb.cyl(2.55, 0.78, s * 1.08, 0.36, 1.7, 'x', { col: COL.alu, kind: KIND.CHROME }, 20);
    for (const dx of [-0.65, 0.65]) vb.cyl(2.55 + dx, 0.78, s * 1.08, 0.372, 0.06, 'x', { col: COL.steel, kind: KIND.CHROME }, 20);
    vb.cyl(2.55 + 0.85, 0.78, s * 1.08, 0.34, 0.05, 'x', FRAME, 16);
    vb.rbox(1.2, 0.75, s * 1.0, 0.8, 0.5, 0.4, 0.04, FRAME);
    vb.cyl(-0.9, 0.62, s * 0.8, 0.17, 0.9, 'z', FRAME, 12, 0.17);
    // steps
    for (const [x, y] of [[2.1, 0.78], [2.1, 1.28]]) vb.rbox(x, y, s * 1.2, 0.4, 0.04, 0.2, 0.01, { col: COL.alu, kind: KIND.METAL });
  }
  // sleeper cab and day cab
  const cabX0 = 1.7, cabX1 = 3.75, cabY0 = 1.22;
  const roofY = 3.28;
  vb.rbox((cabX0 + cabX1) / 2, (cabY0 + roofY) / 2, 0, cabX1 - cabX0, roofY - cabY0, 2.5, 0.2, PAINT);
  if (sleeper) {
    vb.rbox(0.35, (cabY0 + 3.5) / 2, 0, 2.7, 3.5 - cabY0, 2.55, 0.22, PAINT);
    // roof fairing / deflector: a wedge from the cab roof up to the sleeper roof
    vb.tr(extrudeProfile([[3.72, 3.26], [3.8, 3.36], [2.3, 3.9], [1.3, 3.92], [1.0, 3.55], [3.7, 3.2]], 2.3, { bevel: 0.08, steps: 1 }), 0, 0, 0, PAINT);
    // sleeper windows, vents and a skylight
    for (const s of sg) {
      vb.rbox(0.25, 2.55, s * 1.283, 1.1, 0.5, 0.012, 0.03, GLS);
      vb.rbox(-0.55, 2.0, s * 1.283, 0.4, 0.25, 0.012, 0.03, BLK);
      vb.box(1.2, 1.24, 1.4, 3.05, s * 1.262, s * 1.272, { col: COL.black, kind: KIND.PLASTIC });
    }
    vb.rbox(-0.2, 3.52, 0, 0.5, 0.03, 0.4, 0.02, { col: COL.lens, kind: KIND.GLASS });
    for (const sd of sg) vb.cyl(-1.04, 2.3, sd * 0.85, 0.02, 1.4, 'y', CH, 8);
  } else {
    vb.rbox(cabX0 - 0.2, (cabY0 + 3.0) / 2, 0, 0.5, 3.0 - cabY0, 2.45, 0.14, PAINT);
  }
  // windshield (two panes), side glass, doors
  for (const s of sg) {
    vb.face([3.77, 1.98, s * 1.1], [3.77, 1.98, s * 0.04], [3.73, 3.12, s * 0.04], [3.73, 3.12, s * 1.1], [1, 0.1, 0], GLS);
    vb.face([2.75, 1.88, s * 1.262], [2.75, 3.0, s * 1.262], [3.6, 3.0, s * 1.262], [3.7, 2.0, s * 1.262], [0, 0, s], GLS);
    vb.box(2.7, 2.74, 1.25, 3.18, s * 1.252, s * 1.262, BLK);
    vb.rbox(3.0, 2.0, s * 1.27, 0.2, 0.04, 0.05, 0.015, CH);
    vb.rbox(3.0, 2.8, s * 1.27, 0.04, 0.1, 0.06, 0.015, CH);
    // mirrors on long arms
    vb.cyl(3.35, 2.55, s * 1.4, 0.014, 0.35, 'z', CH, 8);
    vb.cyl(3.35, 1.95, s * 1.4, 0.014, 0.35, 'z', CH, 8);
    vb.rbox(3.35, 2.25, s * 1.6, 0.1, 0.55, 0.09, 0.025, BLK);
    vb.rbox(3.35, 2.25, s * 1.553, 0.085, 0.5, 0.006, 0.003, { col: lin([0.5, 0.6, 0.7]), kind: KIND.GLASS });
    vb.rbox(3.35, 1.7, s * 1.55, 0.12, 0.2, 0.06, 0.02, BLK);
    // cab marker lamps and roof lights
    for (const z of [-0.8, -0.4, 0, 0.4, 0.8]) vb.rbox(3.62, roofY + 0.03, z, 0.1, 0.07, 0.14, 0.02, { col: COL.amber, kind: KIND.LENS });
    vb.rbox(3.0, 1.2, s * 1.265, 0.35, 0.05, 0.03, 0.01, { col: COL.amber, kind: KIND.LENS });
  }
  vb.rbox(3.78, 3.22, 0, 0.55, 0.1, 2.44, 0.04, PAINT, 0, 0, -0.04); // sun visor
  vb.box(3.74, 3.76, 3.1, 3.2, -1.1, 1.1, BLK);
  // hood, grille, fenders, bumper, lights
  vb.rbox(5.3, 1.62, 0, 3.15, 0.95, 1.45, 0.2, PAINT);
  vb.rbox(6.95, 1.5, 0, 0.3, 0.85, 1.3, 0.14, PAINT);
  vb.rbox(7.12, 1.5, 0, 0.08, 0.95, 1.12, 0.05, { col: COL.alu, kind: KIND.CHROME });
  for (let i = -5; i <= 5; i++) vb.box(7.16, 7.2, 1.08, 1.92, i * 0.095 - 0.012, i * 0.095 + 0.012, { col: COL.steel, kind: KIND.CHROME });
  vb.rbox(7.18, 1.52, 0, 0.03, 0.8, 0.96, 0.02, { col: COL.black, kind: KIND.PLASTIC });
  for (let i = -5; i <= 5; i++) vb.box(7.2, 7.24, 1.12, 1.9, i * 0.095 - 0.014, i * 0.095 + 0.014, { col: COL.steel, kind: KIND.CHROME });
  vb.rbox(7.2, 1.98, 0, 0.1, 0.07, 0.6, 0.02, CH);
  vb.rbox(7.28, 0.8, 0, 0.18, 0.34, 2.45, 0.1, { col: COL.alu, kind: KIND.CHROME });
  vb.rbox(7.26, 0.55, 0, 0.12, 0.16, 2.2, 0.05, { col: COL.black, kind: KIND.PLASTIC });
  for (const s of sg) {
    // fenders over the steer tyres
    vb.tr(new THREE.CylinderGeometry(0.66, 0.66, 0.5, 18, 1, false, Math.PI / 2, Math.PI), T.steerX, T.tyreR + 0.03, s * T.steerTrack, PAINT, Math.PI / 2, 0, 0, 1, 1, 1);
    vb.rbox(T.steerX, 1.22, s * T.steerTrack, 1.4, 0.06, 0.52, 0.03, PAINT);
    vb.rbox(6.55, 1.42, s * 0.92, 0.5, 0.36, 0.4, 0.07, PAINT);
    // headlights, turn signals and wheel-well trim
    vb.rbox(7.05, 1.38, s * 0.78, 0.12, 0.3, 0.28, 0.05, { col: COL.lens, kind: KIND.LENS, glow: 1 });
    vb.rbox(7.08, 1.38, s * 0.78, 0.04, 0.34, 0.32, 0.03, CH);
    vb.rbox(7.1, 1.13, s * 0.93, 0.07, 0.1, 0.12, 0.02, { col: COL.amber, kind: KIND.LENS, glow: 3 });
    vb.rbox(7.16, 0.6, s * 0.68, 0.08, 0.1, 0.18, 0.02, { col: COL.lens, kind: KIND.LENS, glow: 1 });
    // exhaust stacks and muffler
    vb.cyl(1.56, 2.55, s * 1.12, 0.085, 2.4, 'y', CH, 14);
    vb.cyl(1.56, 1.3, s * 1.12, 0.2, 0.6, 'y', { col: COL.steel, kind: KIND.CHROME }, 16);
    vb.cyl(1.56, 3.78, s * 1.12, 0.09, 0.05, 'y', CH, 14);
    vb.rbox(1.56, 3.5, s * 1.12, 0.05, 0.05, 0.05, 0.01, FRAME);
    // air cleaner
    vb.cyl(3.9, 2.3, s * 0.85, 0.11, 0.55, 'y', CH, 12);
  }
  // air horns, hoses and the cab-back light bar
  vb.cyl(1.5, 3.6, 0, 0.03, 0.4, 'z', CH, 8);
  vb.rbox(1.72, 2.0, 0.55, 0.02, 0.5, 0.12, 0.01, { col: COL.red, kind: KIND.PLASTIC });
  vb.rbox(1.72, 1.9, -0.55, 0.02, 0.5, 0.12, 0.01, { col: COL.amber, kind: KIND.PLASTIC });
  for (const s of sg) vb.rbox(-1.97, 0.95, s * 0.8, 0.08, 0.12, 0.22, 0.02, { col: COL.red, kind: KIND.LENS, glow: 2 });
  // mud flaps behind the drive tyres
  for (const s of sg) vb.box(-1.55, -1.5, 0.15, 0.7, s * 0.55, s * 1.4, { col: COL.black, kind: KIND.RUBBER });
  // wheel list for the rig
  const ws = [];
  for (const s of sg) ws.push({ x: T.steerX, y: T.tyreR, z: s * T.steerTrack, r: T.tyreR, w: T.tyreW, steer: true, side: s, axle: 'steer' });
  for (const x of T.driveX) for (const s of sg) for (const d of [-1, 1]) ws.push({ x, y: T.tyreR, z: s * (T.driveTrack + d * T.dualGap), r: T.tyreR, w: T.tyreW, steer: false, side: s, axle: 'drive' });
  const out = finishTruckParts(vb, ws, wheels, detail, { truck: true });
  out.dims = { L: T.length, W: T.width, H: T.height };
  out.kind = 'tractor';
  return out;
}

function finishTruckParts(vb, wheelList, mode, detail, wopt = {}) {
  const out = { wheels: wheelList };
  const mk = (w) => {
    const sub = new VB();
    addWheel(sub, w.r, w.w, { truck: true, spokes: detail > 0.6 ? 8 : 5, lugs: detail > 0.6 ? 10 : 0, rim: COL.alu, ...wopt });
    return sub;
  };
  if (mode === 'merged') {
    for (const w of wheelList) {
      const m = new THREE.Matrix4().makeTranslation(w.x, w.y, w.z);
      if (w.side < 0) m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      copyInto(vb, mk(w), m);
    }
    out.geo = vb.build();
  } else {
    out.geo = vb.build();
    out.wheelGeo = mk(wheelList[0]).build();
  }
  return out;
}

// ── Trailers (origin = kingpin, +x forward) ───────────────────────────────────
export const TRAILER = {
  kingToAxle: 12.2, bogieGap: 1.28, frontX: 0.95, rearX: -15.25, width: 2.6, floorY: 1.2, roofY: 4.1, tyreR: 0.52, tyreW: 0.295, track: 0.915, dualGap: 0.165, kingY: 1.2,
  length: 16.2, height: 4.12,
};
export const TRAILER_TYPES = ['dryvan', 'reefer', 'flatbed', 'tanker', 'logs', 'container'];
const noDecal = () => [0, 0, 1, 1];

function trailerChassis(vb, { skirts = true, landing = true } = {}) {
  const T = TRAILER;
  const ax = [-(T.kingToAxle) + T.bogieGap / 2, -(T.kingToAxle) - T.bogieGap / 2];
  for (const s of [-1, 1]) {
    vb.box(T.rearX + 0.3, T.frontX - 0.2, 1.02, 1.22, s * 0.62 - 0.07, s * 0.62 + 0.07, FRAME);
    vb.box(T.rearX + 0.3, T.frontX - 0.2, 0.96, 1.03, s * 0.62 - 0.14, s * 0.62 + 0.14, FRAME);
  }
  for (let x = T.rearX + 0.6; x < T.frontX - 0.3; x += 0.9) vb.box(x - 0.04, x + 0.04, 1.04, 1.18, -1.1, 1.1, FRAME);
  // slider rails and bogie frame
  vb.rbox(-(T.kingToAxle) - 0.2, 0.86, 0, 3.7, 0.12, 1.5, 0.03, FRAME);
  for (const s of [-1, 1]) vb.rbox(-(T.kingToAxle) - 0.2, 0.74, s * 0.78, 3.5, 0.2, 0.1, 0.03, FRAME);
  for (const x of ax) {
    vb.cyl(x, T.tyreR, 0, 0.07, 2.1, 'z', FRAME, 10);
    for (const s of [-1, 1]) {
      vb.rbox(x, 0.82, s * 0.8, 0.25, 0.3, 0.12, 0.03, FRAME);
      vb.cyl(x + 0.38, 0.55, s * 0.55, 0.1, 0.26, 'z', { col: COL.dark, kind: KIND.METAL }, 10);
      vb.box(x - 0.55, x - 0.5, 0.12, 0.65, s * 0.58, s * 1.4, { col: COL.black, kind: KIND.RUBBER });
    }
  }
  // landing gear
  if (landing) {
    for (const s of [-1, 1]) {
      vb.rbox(-3.5, 0.78, s * 1.0, 0.18, 1.0, 0.16, 0.02, FRAME);
      vb.rbox(-3.5, 0.18, s * 1.0, 0.16, 0.07, 0.34, 0.02, FRAME);
      vb.rbox(-3.5, 0.55, s * 1.0, 0.1, 0.5, 0.1, 0.02, { col: COL.steel, kind: KIND.METAL });
    }
    vb.cyl(-3.5, 0.95, 0, 0.03, 2.0, 'z', FRAME, 8);
    vb.cyl(-3.5, 0.95, 1.12, 0.03, 0.25, 'z', CH, 8);
  }
  // kingpin plate
  vb.rbox(-0.2, 1.17, 0, 1.4, 0.08, 1.3, 0.03, { col: COL.alu, kind: KIND.METAL });
  vb.cyl(0, 1.12, 0, 0.05, 0.14, 'y', { col: COL.steel, kind: KIND.METAL }, 8);
  // ICC bumper, tail lights, reflectors, plate
  const rx = T.rearX;
  vb.rbox(rx - 0.12, 0.72, 0, 0.14, 0.26, 2.3, 0.04, FRAME);
  for (const s of [-1, 1]) vb.rbox(rx - 0.08, 0.95, s * 1.05, 0.12, 0.5, 0.14, 0.03, FRAME);
  for (const s of [-1, 1]) for (const [y, z] of [[1.55, 0.2], [1.55, 0.6], [1.55, 1.0]]) vb.cyl(rx - 0.03, y, s * z, 0.075, 0.05, 'x', { col: COL.red, kind: KIND.LENS, glow: 2 }, 12);
  for (const s of [-1, 1]) vb.cyl(rx - 0.03, 1.3, s * 1.15, 0.045, 0.04, 'x', { col: COL.amber, kind: KIND.LENS, glow: 3 }, 10);
  vb.box(rx - 0.04, rx - 0.01, 1.3, 1.62, -0.28, 0.28, { col: COL.plate, kind: KIND.PLASTIC });
  for (let i = 0; i < 9; i++) vb.box(rx - 0.02, rx, 1.24, 1.3, -1.25 + i * 0.28, -1.25 + i * 0.28 + 0.14, { col: i % 2 ? COL.white : lin([0.8, 0.08, 0.08]), kind: KIND.PLASTIC });
  if (skirts) for (const s of [-1, 1]) vb.rbox(-6.9, 0.98, s * 1.31, 6.6, 0.3, 0.03, 0.01, { col: COL.alu, kind: KIND.METAL });
  const ws = [];
  for (const x of ax) for (const s of [-1, 1]) for (const d of [-1, 1]) ws.push({ x, y: T.tyreR, z: s * (T.track + d * T.dualGap), r: T.tyreR, w: T.tyreW, steer: false, side: s, axle: 'trailer' });
  return ws;
}

function vanBody(vb, { reefer = false, decal = noDecal, name = 'BIG SKY FREIGHT', style = 2 } = {}) {
  const T = TRAILER;
  const x0 = T.rearX + 0.04, x1 = T.frontX, y0 = 1.24, y1 = 4.06, hw = 1.29;
  const sideKind = reefer ? KIND.METAL : KIND.RIB;
  const wallCol = reefer ? [1, 1, 1] : [1, 1, 1];
  for (const s of [-1, 1]) vb.rbox((x0 + x1) / 2, (y0 + y1) / 2, s * hw, x1 - x0, y1 - y0, 0.1, 0.03, { col: wallCol, kind: sideKind, body: true });
  vb.rbox((x0 + x1) / 2, y1, 0, x1 - x0 + 0.04, 0.09, 2.64, 0.03, { col: COL.white, kind: KIND.METAL });
  vb.rbox(x1 - 0.02, (y0 + y1) / 2, 0, 0.1, y1 - y0, 2.6, 0.03, { col: wallCol, kind: sideKind, body: true });
  vb.rbox((x0 + x1) / 2, (y0 + 0.1) / 2 + 0.5, 0, x1 - x0, 0.16, 2.56, 0.03, { col: COL.dark, kind: KIND.METAL });
  // top and bottom rails, posts every 1.2 m
  for (const s of [-1, 1]) {
    vb.rbox((x0 + x1) / 2, y1 - 0.05, s * (hw + 0.045), x1 - x0, 0.1, 0.05, 0.015, { col: COL.alu, kind: KIND.METAL });
    vb.rbox((x0 + x1) / 2, y0 + 0.07, s * (hw + 0.045), x1 - x0, 0.14, 0.05, 0.015, { col: COL.alu, kind: KIND.METAL });
    for (let x = x0 + 0.3; x < x1; x += 1.22) vb.box(x - 0.025, x + 0.025, y0 + 0.14, y1 - 0.1, s * (hw + 0.05), s * (hw + 0.058), { col: COL.alu, kind: KIND.METAL });
    // red reflective strip with white dashes
    vb.box(x0 + 0.2, x1 - 0.2, y0 + 0.2, y0 + 0.27, s * (hw + 0.052), s * (hw + 0.06), { col: lin([0.75, 0.07, 0.07]), kind: KIND.PLASTIC });
    for (let x = x0 + 0.5; x < x1 - 0.4; x += 1.1) vb.box(x, x + 0.45, y0 + 0.2, y0 + 0.27, s * (hw + 0.058), s * (hw + 0.064), { col: COL.white, kind: KIND.PLASTIC });
    // amber side markers
    for (const x of [x0 + 0.5, -T.kingToAxle + 0.6, -6.5, x1 - 0.5]) vb.rbox(x, y0 + 0.5, s * (hw + 0.06), 0.14, 0.05, 0.03, 0.01, { col: COL.amber, kind: KIND.LENS, glow: 3 });
  }
  // logo panels (left side reads toward the rear, right side toward the front)
  const rect = decal(name, style);
  const ly0 = 2.1, ly1 = 3.35, lx = -5.8, lw = 5.0;
  vb.quad([lx - lw / 2, ly0, hw + 0.062], [lx + lw / 2, ly0, hw + 0.062], [lx + lw / 2, ly1, hw + 0.062], [lx - lw / 2, ly1, hw + 0.062], { col: [1, 1, 1], kind: KIND.DECAL, uv: rect });
  vb.quad([lx + lw / 2, ly0, -hw - 0.062], [lx - lw / 2, ly0, -hw - 0.062], [lx - lw / 2, ly1, -hw - 0.062], [lx + lw / 2, ly1, -hw - 0.062], { col: [1, 1, 1], kind: KIND.DECAL, uv: rect });
  // rear doors
  const rx = T.rearX;
  for (const s of [-1, 1]) {
    vb.rbox(rx - 0.02, (y0 + y1) / 2, s * 0.6, 0.06, y1 - y0 - 0.1, 1.18, 0.02, { col: wallCol, kind: sideKind, body: true });
    for (const z of [0.18, 0.7, 1.15]) vb.cyl(rx - 0.06, (y0 + y1) / 2 + 0.05, s * z, 0.018, y1 - y0 - 0.25, 'y', CH, 8);
    for (const y of [1.6, 2.6, 3.6]) vb.rbox(rx - 0.05, y, s * 1.2, 0.04, 0.2, 0.06, 0.01, CH);
    for (const y of [1.9, 3.0]) vb.rbox(rx - 0.055, y, s * 0.2, 0.05, 0.1, 0.14, 0.02, { col: COL.steel, kind: KIND.METAL });
  }
  vb.box(rx - 0.04, rx - 0.03, y0, y1, -0.01, 0.01, BLK);
  vb.rbox(rx - 0.05, y1 - 0.08, 0, 0.1, 0.16, 2.6, 0.03, { col: COL.alu, kind: KIND.METAL });
  if (reefer) {
    const rect2 = decal('REEFER · −10°C', 0);
    vb.rbox(x1 + 0.28, 3.3, 0, 0.55, 1.5, 2.1, 0.1, { col: COL.white, kind: KIND.METAL });
    vb.rbox(x1 + 0.28, 2.6, 0, 0.58, 0.1, 2.12, 0.02, { col: COL.dark, kind: KIND.METAL });
    for (const z of [-0.5, 0.5]) {
      vb.cyl(x1 + 0.58, 3.5, z, 0.32, 0.04, 'x', BLK, 18);
      for (let i = 0; i < 6; i++) vb.box(x1 + 0.595, x1 + 0.605, 3.5 - 0.3 + i * 0.12, 3.5 - 0.3 + i * 0.12 + 0.025, z - 0.28, z + 0.28, { col: COL.steel, kind: KIND.METAL });
    }
    vb.quad([x1 + 0.2, 2.3, 0.4], [x1 + 0.2, 2.3, -0.4], [x1 + 0.2, 2.55, -0.4], [x1 + 0.2, 2.55, 0.4], { col: [1, 1, 1], kind: KIND.DECAL, uv: rect2 });
  }
}

/**
 * A semi trailer. type: dryvan | reefer | flatbed | tanker | logs | container. `decal(text, style)` supplies
 * sign-atlas rectangles for logos. Returns { geo, wheels, kingpin: [0, y, 0], axleX, … }.
 */
export function buildTrailer(type = 'dryvan', { wheels = 'separate', detail = 1, decal = noDecal, name = 'BIG SKY FREIGHT', style = 2, cargo = 'lumber' } = {}) {
  const T = TRAILER;
  const vb = new VB();
  let ws;
  if (type === 'dryvan' || type === 'reefer') {
    ws = trailerChassis(vb);
    vanBody(vb, { reefer: type === 'reefer', decal, name, style });
  } else if (type === 'flatbed') {
    ws = trailerChassis(vb, { skirts: false });
    flatbed(vb, cargo);
  } else if (type === 'tanker') {
    ws = trailerChassis(vb, { skirts: false });
    tanker(vb, decal, name, style);
  } else if (type === 'logs') {
    ws = trailerChassis(vb, { skirts: false });
    logTrailer(vb);
  } else if (type === 'container') {
    ws = trailerChassis(vb, { skirts: false });
    containerBody(vb, decal, name, style);
  }
  const out = finishTruckParts(vb, ws, wheels, detail, { truck: true });
  out.dims = { L: T.length, W: T.width, H: T.height };
  out.kind = type;
  return out;
}

function flatbed(vb, cargo) {
  const T = TRAILER;
  const x0 = T.rearX + 0.2, x1 = T.frontX - 0.3, y = 1.36;
  vb.rbox((x0 + x1) / 2, y, 0, x1 - x0, 0.14, 2.55, 0.03, { col: COL.wood, kind: KIND.WOOD });
  for (const s of [-1, 1]) {
    vb.rbox((x0 + x1) / 2, y + 0.02, s * 1.3, x1 - x0, 0.18, 0.1, 0.03, { col: COL.alu, kind: KIND.METAL });
    for (let x = x0 + 0.3; x < x1; x += 0.7) vb.box(x - 0.04, x + 0.04, y - 0.05, y + 0.04, s * 1.3 - 0.06, s * 1.3 + 0.06, { col: COL.dark, kind: KIND.METAL });
  }
  // headboard
  vb.rbox(x1 - 0.05, y + 0.85, 0, 0.1, 1.7, 2.5, 0.03, FRAME);
  for (let i = -2; i <= 2; i++) vb.box(x1 - 0.1, x1, y + 0.2, y + 1.6, i * 0.5 - 0.03, i * 0.5 + 0.03, { col: COL.dark, kind: KIND.METAL });
  const wood = { col: COL.wood, kind: KIND.WOOD };
  const strap = { col: lin([0.9, 0.55, 0.05]), kind: KIND.CLOTH };
  const top = y + 0.07;
  if (cargo === 'pipes') {
    for (let row = 0; row < 3; row++) for (let k = 0; k < 6 - row; k++) vb.cyl((x0 + x1) / 2 + 0.4, top + 0.25 + row * 0.44, (k - (5 - row) / 2) * 0.5, 0.25, 11.5, 'x', { col: lin([0.28, 0.3, 0.33]), kind: KIND.METAL }, 14);
    for (let x = -12.2; x < -1.5; x += 2.4) vb.box(x, x + 0.1, top, top + 1.6, -1.45, 1.45, strap);
  } else if (cargo === 'hay') {
    for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) for (const z of [-0.65, 0.65]) vb.cyl(x1 - 1.3 - i * 2.2, top + 0.7 + row * 1.4, z, 0.68, 1.2, 'z', { col: lin([0.78, 0.66, 0.3]), kind: KIND.CLOTH }, 14);
  } else if (cargo === 'machinery') {
    vb.rbox(-6.2, top + 0.75, 0, 5.4, 0.9, 2.3, 0.1, { col: lin([0.9, 0.7, 0.08]), kind: KIND.PAINT });
    vb.rbox(-4.2, top + 1.75, 0, 1.9, 1.2, 2.0, 0.1, { col: lin([0.92, 0.72, 0.08]), kind: KIND.PAINT });
    vb.rbox(-4.2, top + 1.8, 0, 1.6, 0.8, 1.9, 0.05, { col: COL.glass, kind: KIND.GLASS });
    for (const s of [-1, 1]) vb.rbox(-6.2, top + 0.28, s * 1.05, 5.0, 0.45, 0.5, 0.15, { col: COL.black, kind: KIND.RUBBER });
    vb.rbox(-9.3, top + 1.1, 0, 3.8, 0.28, 0.35, 0.06, { col: lin([0.9, 0.7, 0.08]), kind: KIND.PAINT }, 0, 0, 0.12);
    vb.rbox(-11.4, top + 0.6, 0, 1.4, 0.7, 1.0, 0.06, { col: lin([0.85, 0.65, 0.07]), kind: KIND.PAINT });
  } else {
    // lumber bundles stacked three high with straps
    for (let layer = 0; layer < 3; layer++) for (let b = 0; b < 3; b++) for (let i = 0; i < 3; i++) {
      const bx = x1 - 0.5 - i * 4.1 - 2.0, bz = (b - 1) * 0.78;
      vb.rbox(bx, top + 0.34 + layer * 0.68, bz, 3.95, 0.64, 0.74, 0.03, { col: layer % 2 ? lin([0.72, 0.55, 0.32]) : lin([0.66, 0.48, 0.27]), kind: KIND.WOOD });
    }
    for (let x = -12.0; x < -1.0; x += 2.2) vb.box(x, x + 0.08, top, top + 2.15, -1.2, 1.2, strap);
  }
  void wood;
}

function tanker(vb, decal, name, style) {
  const T = TRAILER;
  const x0 = T.rearX + 0.6, x1 = T.frontX - 0.5, cy = 2.5, R = 1.18;
  const shell = { col: [1, 1, 1], kind: KIND.PAINT, body: true };
  const pro = [];
  const L = x1 - x0 - 2 * 0.55;
  pro.push([0.001, -L / 2 - 0.55]);
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pro.push([R * Math.sin(a), -L / 2 - 0.55 * Math.cos(a)]);
  }
  for (let i = 7; i >= 0; i--) {
    const a = (i / 8) * (Math.PI / 2);
    pro.push([R * Math.sin(a), L / 2 + 0.55 * Math.cos(a)]);
  }
  pro.push([0.001, L / 2 + 0.55]);
  lathe(vb, pro, (x0 + x1) / 2, cy, 0, 'x', { ...shell, kind: KIND.PAINT }, 28);
  // saddles, rings and chrome bands
  for (const x of [x0 + 1.0, (x0 + x1) / 2, x1 - 1.4]) vb.cyl(x, cy, 0, R + 0.02, 0.12, 'x', { col: COL.alu, kind: KIND.CHROME }, 28);
  for (const x of [x0 + 2.5, x0 + 4.5, x1 - 4, x1 - 2.5]) vb.cyl(x, cy, 0, R + 0.012, 0.06, 'x', { col: COL.steel, kind: KIND.CHROME }, 28);
  vb.rbox((x0 + x1) / 2, 1.42, 0, x1 - x0 - 1.8, 0.2, 1.5, 0.05, FRAME);
  // walkway, hatches, vents, ladder, rear valves
  vb.rbox((x0 + x1) / 2, cy + R + 0.04, 0, x1 - x0 - 1.5, 0.05, 0.5, 0.01, { col: COL.alu, kind: KIND.METAL });
  for (const x of [x0 + 2.2, (x0 + x1) / 2, x1 - 2.6]) {
    vb.cyl(x, cy + R + 0.12, 0, 0.3, 0.14, 'y', { col: COL.alu, kind: KIND.CHROME }, 18);
    vb.cyl(x, cy + R + 0.22, 0, 0.18, 0.04, 'y', { col: COL.steel, kind: KIND.CHROME }, 14);
  }
  for (const s of [-1, 1]) vb.cyl(x0 + 1.2, cy + R + 0.4, s * 0.2, 0.012, 0.8, 'y', CH, 6);
  vb.rbox(x0 - 0.45, 1.3, 0, 0.3, 0.55, 0.9, 0.04, { col: COL.alu, kind: KIND.METAL });
  for (const s of [-1, 1]) vb.cyl(x0 - 0.6, 1.35, s * 0.3, 0.09, 0.3, 'x', { col: COL.red, kind: KIND.METAL }, 10);
  vb.rbox(x0 - 0.1, 2.0, -1.2, 0.04, 2.4, 0.4, 0.01, { col: COL.steel, kind: KIND.METAL });
  const rect = decal(name, style);
  vb.quad([-6.3, 1.95, R * 0.98 + 0.002], [-3.3, 1.95, R * 0.98 + 0.002], [-3.3, 3.05, R * 0.98 + 0.002], [-6.3, 3.05, R * 0.98 + 0.002], { col: [1, 1, 1], kind: KIND.DECAL, uv: rect });
  vb.quad([-3.3, 1.95, -R * 0.98 - 0.002], [-6.3, 1.95, -R * 0.98 - 0.002], [-6.3, 3.05, -R * 0.98 - 0.002], [-3.3, 3.05, -R * 0.98 - 0.002], { col: [1, 1, 1], kind: KIND.DECAL, uv: rect });
}

function logTrailer(vb) {
  const T = TRAILER;
  const logs = { col: lin([0.38, 0.25, 0.14]), kind: KIND.WOOD };
  const endc = { col: lin([0.78, 0.62, 0.4]), kind: KIND.WOOD };
  const top = 1.4;
  // reach frame and two bunks
  vb.rbox(-6.0, 1.28, 0, 11.5, 0.16, 0.35, 0.04, FRAME);
  for (const x of [-1.8, -13.4]) {
    vb.rbox(x, top, 0, 0.3, 0.16, 2.6, 0.04, FRAME);
    for (const s of [-1, 1]) {
      vb.rbox(x, top + 1.1, s * 1.25, 0.14, 2.2, 0.12, 0.03, FRAME);
      vb.rbox(x, top + 2.3, s * 1.25, 0.2, 0.08, 0.18, 0.02, { col: COL.steel, kind: KIND.METAL });
    }
  }
  const rows = [[-1.0, 0.0, 1.0], [-0.55, 0.55], [0.0]];
  rows.forEach((zs, ri) => zs.forEach((z, k) => {
    for (let j = 0; j < 2; j++) {
      const r = 0.42 - ri * 0.02 + ((k + j) % 3) * 0.02;
      const len = 12.2 - ((k + ri + j) % 3) * 0.5;
      const x = -7.6 + ((k * 3 + ri) % 2) * 0.4;
      vb.cyl(x, top + 0.45 + ri * 0.72 + j * 0.05, z, r, len, 'x', logs, 14);
      vb.cyl(x + len / 2 + 0.005, top + 0.45 + ri * 0.72 + j * 0.05, z, r * 0.92, 0.02, 'x', endc, 12);
    }
  }));
  for (const x of [-1.8, -13.4]) vb.box(x - 0.05, x + 0.05, top, top + 2.2, -1.38, 1.38, { col: lin([0.9, 0.55, 0.05]), kind: KIND.CLOTH });
}

function containerBody(vb, decal, name, style) {
  const T = TRAILER;
  const x0 = T.rearX + 1.0, x1 = x0 + 12.19, y0 = 1.42, y1 = y0 + 2.59;
  vb.rbox((x0 + x1) / 2, y0 + 0.02, 0, x1 - x0, 0.14, 2.35, 0.03, FRAME);
  vb.rbox((x0 + x1) / 2, (y0 + y1) / 2 + 0.07, 0, x1 - x0, y1 - y0 - 0.14, 2.44, 0.03, { col: [1, 1, 1], kind: KIND.RIB, body: true });
  for (const s of [-1, 1]) for (const x of [x0 + 0.1, x1 - 0.1]) for (const y of [y0 + 0.08, y1 - 0.08]) vb.rbox(x, y, s * 1.2, 0.18, 0.16, 0.12, 0.02, { col: COL.dark, kind: KIND.METAL });
  for (const x of [x0 + 0.1, x1 - 0.1]) for (const y of [y0 + 0.08, y1 - 0.08]) vb.rbox(x, y, 0, 0.18, 0.16, 2.44, 0.02, { col: COL.dark, kind: KIND.METAL });
  const rect = decal(name, style);
  vb.quad([x0 + 1.5, y0 + 0.8, 1.23], [x0 + 6.5, y0 + 0.8, 1.23], [x0 + 6.5, y0 + 1.9, 1.23], [x0 + 1.5, y0 + 1.9, 1.23], { col: [1, 1, 1], kind: KIND.DECAL, uv: rect });
  vb.quad([x0 + 6.5, y0 + 0.8, -1.23], [x0 + 1.5, y0 + 0.8, -1.23], [x0 + 1.5, y0 + 1.9, -1.23], [x0 + 6.5, y0 + 1.9, -1.23], { col: [1, 1, 1], kind: KIND.DECAL, uv: rect });
  // door end with locking bars
  for (const z of [-0.8, -0.3, 0.3, 0.8]) vb.cyl(x0 - 0.1, (y0 + y1) / 2, z, 0.02, y1 - y0 - 0.2, 'y', CH, 8);
}

// ── Cab interior (seen from the cockpit camera) ───────────────────────────────
/**
 * Dashboard, seats, door trim, headliner and a steering wheel for the sleeper tractor. Returns
 * { geo (static), wheelGeo (steering wheel about its own axis, to be placed at `wheelPos`), gaugeQuad: [corners] }.
 */
export function buildCabInterior() {
  const vb = new VB();
  const dk = { col: COL.dash, kind: KIND.PLASTIC };
  const cloth = { col: COL.seat, kind: KIND.CLOTH };
  const trim = { col: lin([0.22, 0.2, 0.19]), kind: KIND.PLASTIC };
  // floor, headliner, door cards and pillars (inward-facing)
  vb.face([1.8, 1.26, -1.18], [3.7, 1.26, -1.18], [3.7, 1.26, 1.18], [1.8, 1.26, 1.18], [0, 1, 0], { col: lin([0.12, 0.11, 0.1]), kind: KIND.CLOTH });
  vb.face([1.8, 3.18, -1.18], [3.7, 3.18, -1.18], [3.7, 3.18, 1.18], [1.8, 3.18, 1.18], [0, -1, 0], { col: lin([0.5, 0.48, 0.44]), kind: KIND.CLOTH });
  for (const s of [-1, 1]) {
    vb.face([1.8, 1.26, s * 1.17], [3.7, 1.26, s * 1.17], [3.7, 1.95, s * 1.17], [1.8, 1.95, s * 1.17], [0, 0, -s], trim);
    vb.face([1.8, 1.95, s * 1.17], [3.7, 1.95, s * 1.17], [3.7, 2.0, s * 1.15], [1.8, 2.0, s * 1.15], [0, 0.3, -s], { col: COL.black, kind: KIND.PLASTIC });
    vb.box(3.62, 3.72, 1.9, 3.18, s * 1.05, s * 1.17, dk); // A pillar
    vb.box(2.68, 2.76, 1.9, 3.18, s * 1.1, s * 1.17, dk); // B pillar
    vb.rbox(3.2, 2.1, s * 1.16, 0.3, 0.06, 0.04, 0.02, { col: COL.alu, kind: KIND.METAL }); // door handle
    vb.rbox(2.2, 2.05, s * 1.12, 0.7, 0.1, 0.1, 0.03, trim); // armrest
  }
  vb.face([1.75, 1.26, -1.2], [1.75, 3.15, -1.2], [1.75, 3.15, 1.2], [1.75, 1.26, 1.2], [1, 0, 0], { col: lin([0.08, 0.07, 0.07]), kind: KIND.CLOTH }); // sleeper curtain
  // dashboard
  vb.rbox(3.5, 1.78, 0, 0.5, 0.42, 2.3, 0.06, dk);
  vb.rbox(3.38, 2.04, -0.55, 0.32, 0.22, 0.95, 0.05, dk); // binnacle hood
  vb.rbox(3.45, 1.95, 0.3, 0.3, 0.35, 0.8, 0.04, dk);
  vb.rbox(3.4, 1.6, 0, 0.6, 0.12, 0.3, 0.03, trim); // centre console / shifter housing
  for (let i = 0; i < 4; i++) vb.cyl(3.3, 2.0 + (i % 2) * 0.1, 0.05 + i * 0.12, 0.04, 0.04, 'x', { col: COL.steel, kind: KIND.CHROME }, 10); // vents / knobs
  vb.rbox(3.3, 1.7, 0.75, 0.14, 0.08, 0.5, 0.02, { col: lin([0.18, 0.18, 0.2]), kind: KIND.PLASTIC });
  // steering column
  vb.cyl(3.24, 1.95, -0.55, 0.045, 0.5, 'y', dk, 10, 0.045);
  // seats
  for (const z of [-0.55, 0.55]) {
    vb.rbox(2.55, 1.55, z, 0.62, 0.22, 0.55, 0.07, cloth);
    vb.rbox(2.3, 2.1, z, 0.16, 0.95, 0.55, 0.07, cloth, 0, 0, 0.12);
    vb.rbox(2.2, 2.68, z, 0.12, 0.22, 0.3, 0.05, cloth, 0, 0, 0.12);
    vb.rbox(2.55, 1.35, z, 0.5, 0.28, 0.4, 0.04, { col: COL.black, kind: KIND.PLASTIC });
  }
  vb.rbox(2.2, 1.45, 0, 0.5, 0.35, 0.4, 0.05, trim); // seat-to-seat console
  // sun visor, mirror, CB radio
  vb.rbox(3.5, 3.05, -0.55, 0.14, 0.04, 0.5, 0.015, trim);
  vb.rbox(3.5, 3.05, 0.55, 0.14, 0.04, 0.5, 0.015, trim);
  vb.rbox(3.62, 2.92, 0, 0.05, 0.1, 0.35, 0.02, COL.black ? { col: COL.black, kind: KIND.GLASS } : dk);
  vb.rbox(3.0, 3.1, 0, 0.14, 0.07, 0.24, 0.02, dk);
  const out = { geo: vb.build() };
  const wv = new VB();
  // steering wheel: rim + spokes + hub in a plane whose normal is local +x (tilted by the caller)
  const ring = new THREE.TorusGeometry(0.205, 0.022, 10, 28);
  wv.tr(ring, 0, 0, 0, { col: COL.dash, kind: KIND.PLASTIC }, 0, Math.PI / 2, 0);
  wv.cyl(0, 0, 0, 0.05, 0.06, 'x', { col: COL.dash, kind: KIND.PLASTIC }, 12);
  for (const a of [Math.PI / 2, Math.PI * 1.17, Math.PI * 1.83]) wv.tr(new THREE.BoxGeometry(0.02, 0.17, 0.03), 0, Math.sin(a) * 0.1, Math.cos(a) * 0.1, { col: COL.dash, kind: KIND.PLASTIC }, a - Math.PI / 2, 0, 0);
  out.wheelGeo = wv.build();
  out.wheelPos = [3.2, 2.14, -0.55];
  out.wheelTilt = -0.45; // rad about z
  // the gauge face (instrument cluster) the cab shows live data on
  out.gauge = { a: [3.265, 1.96, -0.8], b: [3.265, 1.96, -0.3], c: [3.265, 2.17, -0.3], d: [3.265, 2.17, -0.8] };
  return out;
}
