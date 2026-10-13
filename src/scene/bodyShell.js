// Lofted Sprinter shell. One smooth surface is swept through cross-sections along the van
// (side rows → rounded cant rail → crowned roof), so the high roof, raked windshield, short
// hood and rounded nose blend into each other. Door apertures are cut exactly on grid lines;
// windows, rubber seals, panel gaps, headlights and road grime are drawn by a shader patch
// on the paint, and matching glass patches are cut by the same signed-distance function.
import * as THREE from 'three';

export const XR = -1.62; // rear face of the body
export const XF = 5.24; // nose (front of the grille surround)
export const YB = 0.55; // rocker / sill line
const RN = 0.45; // plan radius of the nose corners
const RR = 0.06; // plan radius of the rear corners
const BELT = 1.3; // shoulder character line
const TOP0 = 2.5; // top of the vertical side on the cargo body (roof 2.72 − cant radius 0.22)

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Monotone cubic (Fritsch–Carlson) interpolation through [x, y] points. */
function pchip(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), n = pts.length;
  const h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// Side elevation: top of the body (roof → brow → windshield → hood → nose)
export const topY = pchip([
  [XR, 2.6], [-1.585, 2.67], [-1.545, 2.705], [-1.5, 2.72], [3.2, 2.72], [3.42, 2.7], [3.58, 2.63], [3.7, 2.52], [3.79, 2.4],
  [3.86, 2.3], [3.905, 2.255], [4.445, 1.27], [4.52, 1.225], [4.75, 1.15], [4.95, 1.1], [5.1, 1.06], [5.19, 1.03], [XF, 1.0],
]);
const cornerR = pchip([[XR, 0.12], [-1.5, 0.22], [3.2, 0.22], [3.7, 0.17], [3.9, 0.1], [4.44, 0.1], [4.6, 0.15], [XF, 0.13]]);
const crown = pchip([[XR, 0.01], [-1.5, 0.012], [3.2, 0.012], [3.9, 0.075], [4.44, 0.075], [4.6, 0.05], [XF, 0.035]]);

/** Plan view: half-width at the beltline. */
export function halfW(x) {
  let w = 1.01 - 0.03 * smooth(3.7, 5.0, x);
  const xs = XF - RN;
  if (x > xs) {
    const d = Math.min(x - xs, RN);
    w -= RN - Math.sqrt(RN * RN - d * d);
  }
  const xr = XR + RR;
  if (x < xr) {
    const d = Math.min(xr - x, RR);
    w -= RR - Math.sqrt(RR * RR - d * d);
  }
  return w;
}

/** Outer half-width of the side skin at (x, y): tuck-under, shoulder crease, tumble-home. */
export function sideW(x, y) {
  let w = halfW(x);
  if (y < 0.8) w -= 0.03 * ((0.8 - y) / 0.25) ** 2;
  w += 0.006 * Math.exp(-(((y - BELT) / 0.022) ** 2));
  if (y > BELT) w -= 0.045 * ((y - BELT) / 1.2) ** 1.6;
  return w;
}

// Side rows (absolute heights on the cargo body; aperture edges 0.6 / 1.5 / 2.15 / 2.49 lie on rows)
const ROWS = [0.55, 0.575, 0.6, 0.62, 0.65, 0.68, 0.71, 0.74, 0.77, 0.8, 0.83, 0.86, 0.9, 0.95, 1.0, 1.06, 1.12, 1.18, 1.23, 1.26, 1.28, 1.3, 1.32,
  1.34, 1.38, 1.44, 1.5, 1.58, 1.66, 1.74, 1.82, 1.9, 1.98, 2.06, 2.15, 2.22, 2.3, 2.38, 2.44, 2.49, 2.5];
const NR = ROWS.length;
const NC = 8; // corner segments
const NT = 12; // roof segments to the centreline
const NH = NR + NC + NT; // points per half-section
const NJ = 2 * NH - 1; // points around the full section

function rowY(r, sideTop) {
  const lin = YB + ((r - YB) * (sideTop - YB)) / (TOP0 - YB);
  const pw = r <= BELT ? r : BELT + ((r - BELT) * (sideTop - BELT)) / (TOP0 - BELT);
  const t = smooth(BELT + 0.05, BELT + 0.45, sideTop);
  return lin + (pw - lin) * t;
}

/** Half cross-section at station x: [{z, y}] from the sill up and over to the centreline. */
export function halfSection(x) {
  const yT = topY(x), R = Math.min(cornerR(x), (yT - YB) * 0.45), cr = crown(x);
  const sideTop = yT - R;
  const H = [];
  for (const r of ROWS) {
    const y = rowY(r, sideTop);
    H.push({ z: sideW(x, y), y });
  }
  const zA = H[H.length - 1].z, yA = sideTop;
  const zB = zA - R;
  for (let k = 1; k <= NC; k++) {
    const t = k / NC, u = 1 - t;
    H.push({ z: u * u * zA + 2 * u * t * zA + t * t * zB, y: u * u * yA + 2 * u * t * yT + t * t * yT });
  }
  for (let k = 1; k <= NT; k++) {
    const z = zB * (1 - k / NT);
    H.push({ z, y: yT + cr * (1 - (z / zB) ** 2) });
  }
  return H;
}

/** Height of the roof / windshield / hood surface at (x, z) (top portion of the section). */
export function topSurfaceY(x, z) {
  const yT = topY(x), R = Math.min(cornerR(x), (yT - YB) * 0.45);
  const zB = sideW(x, yT - R) - R;
  const q = Math.min(1, Math.abs(z) / zB);
  return yT + crown(x) * (1 - q * q);
}

function stations() {
  const xs = new Set();
  const add = (a, b, step) => {
    const n = Math.max(1, Math.ceil((b - a) / step - 1e-9));
    for (let i = 0; i <= n; i++) xs.add(+(a + ((b - a) * i) / n).toFixed(5));
  };
  for (let k = 0; k <= 10; k++) xs.add(+(XR + RR - RR * Math.cos((k / 10) * (Math.PI / 2))).toFixed(5)); // rear corner (by angle)
  add(XR + RR, -1.45, 0.02);
  add(-1.45, -0.56, 0.05);
  add(-0.56, 0.56, 0.02); // rear wheel arch
  add(0.56, 3.2, 0.05);
  add(3.2, 3.82, 0.02); // brow
  add(3.82, XF - RN, 0.02); // windshield, front arch
  for (let k = 0; k <= 28; k++) xs.add(+(XF - RN + RN * Math.sin((k / 28) * (Math.PI / 2))).toFixed(5)); // nose (by angle)
  for (const x of [-1.45, -0.25, 1.42, 2.72, 2.82]) xs.add(x);
  return [...xs].filter((x) => x >= XR - 1e-6 && x <= XF + 1e-6).sort((a, b) => a - b);
}

// ── Shader patch ────────────────────────────────────────────────────────────
const GLSL_COMMON = /* glsl */ `
varying vec3 vBP;
varying vec3 vBN;
uniform float uDRL;
float sdRR(vec2 p, vec2 c, vec2 h, float r) {
  vec2 d = abs(p - c) - h + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
float halfPlane(vec2 p, vec2 a, vec2 b) { vec2 e = normalize(b - a); return dot(p - a, vec2(e.y, -e.x)); }
// Signed distance to the glazed openings (negative inside the glass)
float bodyCut(vec3 p, vec3 n) {
  float d = 1e3;
  float az = abs(p.z);
  vec2 sp = p.xy;
  if (abs(n.z) > 0.35 && az > 0.75) {
    float w = sdRR(sp, vec2(3.615, 1.79), vec2(0.635, 0.37), 0.07);      // cab door glass
    w = max(w, halfPlane(sp, vec2(4.25, 1.42), vec2(3.85, 2.16)));
    d = min(d, w);
    if (p.z > 0.0) d = min(d, sdRR(sp, vec2(1.97, 1.885), vec2(0.43, 0.335), 0.06)); // sliding door
  }
  if (p.x > 3.86 && p.x < 4.5 && az < 0.95 && p.y > 1.15 && n.x > 0.12) {
    float s = (p.x - 3.905) * 2.04;                                          // distance along the rake
    d = min(d, sdRR(vec2(s, az), vec2(0.555, 0.0), vec2(0.555, 0.835), 0.09));
  }
  return d;
}
// Panel gap of half-width 1.2 mm: anti-aliased, and faded to its pixel coverage when it is
// thinner than a pixel so distant seams read as a soft line instead of dashes.
float gapLine(float d) {
  float aa = max(fwidth(d), 1e-5);
  float hw = 0.0012;
  float core = 1.0 - smoothstep(hw - 0.5 * aa, hw + 0.5 * aa, abs(d));
  return core * clamp(2.0 * hw / aa, 0.3, 1.0);
}
float bodyGaps(vec3 p, vec3 n) {
  float g = 0.0;
  float az = abs(p.z);
  vec2 sp = p.xy;
  if (abs(n.z) > 0.35 && az > 0.75) {
    float cd = sdRR(sp, vec2(3.59, 1.435), vec2(0.77, 0.835), 0.05);        // cab doors
    cd = max(cd, halfPlane(sp, vec2(4.36, 1.3), vec2(3.93, 2.27)));
    cd = max(cd, -(length(sp - vec2(4.325, 0.395)) - 0.53));
    g = max(g, gapLine(cd));
    if (p.z > 0.0) g = max(g, gapLine(sdRR(sp, vec2(2.07, 1.545), vec2(0.65, 0.945), 0.004)));
    else {
      g = max(g, gapLine(sdRR(sp, vec2(-0.85, 1.825), vec2(0.6, 0.325), 0.004)));   // slide-out pod
      g = max(g, gapLine(sdRR(sp, vec2(3.635, 0.985), vec2(0.085, 0.065), 0.025))); // fuel flap
    }
  }
  if (n.y > 0.3 && p.x > 4.45) g = max(g, gapLine(sdRR(vec2(p.x, az), vec2(4.97, 0.0), vec2(0.44, 0.8), 0.12))); // hood
  return g;
}
// Swept headlight cluster: x = lens area, y = DRL light guide, z = projector chrome rings, w = projector lenses
vec4 headlight(vec3 p) {
  float az = abs(p.z);
  float k = smoothstep(5.16, 4.88, p.x);
  float yl = mix(0.858, 0.998, k * k);
  float yu = 1.034 - 0.012 * k;
  float aa = max(fwidth(p.y), 1e-5);
  float m = smoothstep(yl - aa, yl + aa, p.y) * (1.0 - smoothstep(yu - aa, yu + aa, p.y));
  m *= smoothstep(4.868, 4.884, p.x) * smoothstep(0.47, 0.48, az);
  float drl = smoothstep(yu - 0.023, yu - 0.019, p.y) * (1.0 - smoothstep(yu - 0.012, yu - 0.008, p.y));
  vec2 q = vec2(az, p.y);
  float d1 = min(length(q - vec2(0.6, 0.94)), length(q - vec2(0.725, 0.95)));
  float ring = smoothstep(0.043, 0.039, d1) * smoothstep(0.026, 0.03, d1);
  float lens = smoothstep(0.029, 0.025, d1);
  return vec4(m, drl * m, ring * m, lens * m);
}
`;

const BODY_UNIFORMS = { uDRL: { value: 0 } };
export function setDRL(v) {
  BODY_UNIFORMS.uDRL.value = v;
}

function patchVertex(shader) {
  shader.uniforms.uDRL = BODY_UNIFORMS.uDRL;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBP;\nvarying vec3 vBN;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = position;\nvBN = normal;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_COMMON);
}

/** Paint: cut the windows, draw seals, panel gaps, headlights, grime. */
export function patchPaint(mat) {
  mat.onBeforeCompile = (shader) => {
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float bCut = bodyCut(vBP, vBN);
        if (bCut < 0.0) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sealAA = max(fwidth(bCut), 1e-5);
        float bSeal = 1.0 - smoothstep(0.0175 - sealAA, 0.0175 + sealAA, bCut);
        float bGap = bodyGaps(vBP, vBN);
        vec4 hl = headlight(vBP);
        float bHL = hl.x;
        float bArch = min(length(vBP.xy - vec2(0.0, 0.395)), length(vBP.xy - vec2(4.325, 0.395)));
        float bGrime = (1.0 - smoothstep(0.56, 1.0, vBP.y)) * 0.2 + (1.0 - smoothstep(0.48, 0.78, bArch)) * 0.16 * step(0.7, abs(vBN.z));
        diffuseColor.rgb *= 1.0 - bGrime * vec3(0.9, 1.0, 1.15);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018), max(bSeal, bGap * 0.9));
        vec3 hlCol = vec3(0.035, 0.04, 0.045);
        hlCol = mix(hlCol, vec3(0.75, 0.76, 0.78), hl.z);   // chrome bezels
        hlCol = mix(hlCol, vec3(0.012, 0.014, 0.018), hl.w); // projector lenses
        hlCol = mix(hlCol, vec3(0.82, 0.83, 0.85), hl.y);    // frosted DRL light guide
        diffuseColor.rgb = mix(diffuseColor.rgb, hlCol, bHL);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, bSeal);
        roughnessFactor = mix(roughnessFactor, 0.06, bHL);
        roughnessFactor = min(1.0, roughnessFactor + bGrime * 0.5);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.9, bHL * (0.55 + 0.4 * hl.z) * (1.0 - hl.y));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float bDRL = hl.y;
        totalEmissiveRadiance += vec3(1.0, 0.97, 0.92) * bDRL * uDRL * 8.0;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= (1.0 - max(bSeal, bGap)) * (1.0 - bGrime * 2.0);
        #endif`);
  };
  mat.customProgramCacheKey = () => 'bodyPaint';
  mat.userData.bodyPatch = 'paint';
  return mat;
}

/** Glass patches: keep only the glazed area; black ceramic frit around the windshield. */
export function patchGlass(mat) {
  mat.onBeforeCompile = (shader) => {
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float bCut = bodyCut(vBP, vBN);
        if (bCut > 0.0) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float frit = smoothstep(-0.055, -0.05, bCut) * step(abs(vBP.z), 0.9) * step(3.86, vBP.x);
        vec2 dg = fract(vec2(vBP.z, vBP.x * 2.04) * 160.0) - 0.5;
        float dotPx = fwidth(vBP.z * 160.0) + fwidth(vBP.x * 2.04 * 160.0);
        float dots = mix(step(length(dg), 0.32), 0.3, smoothstep(0.15, 0.45, dotPx)) * smoothstep(-0.075, -0.055, bCut);
        float wsMask = step(abs(vBP.z), 0.9) * step(3.86, vBP.x);
        frit *= wsMask;
        dots *= wsMask;
        diffuseColor = mix(diffuseColor, vec4(0.01, 0.01, 0.012, 1.0), max(frit, dots));`);
  };
  mat.customProgramCacheKey = () => 'bodyGlass';
  mat.userData.bodyPatch = 'glass';
  return mat;
}

let depthMat = null;
function bodyDepthMaterial() {
  if (!depthMat) {
    depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depthMat.onBeforeCompile = (shader) => {
      patchVertex(shader);
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (bodyCut(vBP, vBN) < 0.0) discard;`);
    };
    depthMat.customProgramCacheKey = () => 'bodyDepth';
  }
  return depthMat;
}

/** Copy the body shader patch onto a cloned material (cutaway clones). */
export function copyPatch(src, dst) {
  if (src.userData?.bodyPatch) {
    dst.onBeforeCompile = src.onBeforeCompile;
    dst.customProgramCacheKey = src.customProgramCacheKey;
  }
  return dst;
}

// ── Geometry ────────────────────────────────────────────────────────────────
function subGeometry(tris, pos, nor) {
  const map = new Map();
  const P = [], N = [], U = [], I = [];
  for (const v of tris) {
    let k = map.get(v);
    if (k === undefined) {
      k = map.size;
      map.set(v, k);
      P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      N.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
      U.push(pos[v * 3], pos[v * 3 + 1]);
    }
    I.push(k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function capShape(H, hole) {
  const s = new THREE.Shape();
  const loop = [...H.map((p) => [-p.z, p.y]), ...[...H].reverse().slice(1).map((p) => [p.z, p.y])];
  s.moveTo(loop[0][0], loop[0][1]);
  for (const [u, v] of loop.slice(1)) s.lineTo(u, v);
  s.lineTo(loop[0][0], loop[0][1]);
  if (hole) s.holes.push(hole);
  return s;
}

/**
 * Build the shell. Returns meshes for the painted panels (split for the exploded view),
 * the sliding-door skin, the slide-out pod skin, glass patches and the front/rear caps.
 */
export function buildShell(M) {
  const xs = stations();
  const NS = xs.length;
  const pos = new Float32Array(NS * NJ * 3);
  for (let i = 0; i < NS; i++) {
    const H = halfSection(xs[i]);
    for (let j = 0; j < NJ; j++) {
      const left = j < NH;
      const p = left ? H[j] : H[2 * NH - 2 - j];
      const o = (i * NJ + j) * 3;
      pos[o] = xs[i];
      pos[o + 1] = p.y;
      pos[o + 2] = left ? -p.z : p.z;
    }
  }
  const id = (i, j) => i * NJ + j;
  // Classify cells
  const sets = { sideL: [], sideR: [], roof: [], cab: [], door: [], pod: [], all: [] };
  const glassSets = { windshield: [], cabL: [], cabR: [], door: [] };
  const c = new THREE.Vector3();
  for (let i = 0; i < NS - 1; i++) {
    for (let j = 0; j < NJ - 1; j++) {
      const a = id(i, j), b = id(i + 1, j), cc = id(i + 1, j + 1), d = id(i, j + 1);
      const tris = [a, d, b, b, d, cc];
      sets.all.push(...tris);
      c.set(0, 0, 0);
      for (const v of [a, b, cc, d]) c.x += pos[v * 3] / 4, c.y += pos[v * 3 + 1] / 4, c.z += pos[v * 3 + 2] / 4;
      const k1 = j < NH - 1 ? j + 1 : 2 * NH - 2 - j;
      const part = k1 <= NR - 1 ? 'side' : k1 <= NR + NC - 1 ? 'corner' : 'top';
      const side = c.z >= 0 ? 1 : -1;
      // wheel arches (black flares cover the stepped edge)
      if (part === 'side' && [0, 4.325].some((ax) => (c.x - ax) ** 2 + (c.y - 0.395) ** 2 < 0.478 ** 2)) continue;
      let set;
      if (part === 'side' && side > 0 && c.x > 1.42 && c.x < 2.72 && c.y > 0.6 && c.y < 2.49) set = 'door';
      else if (part === 'side' && side < 0 && c.x > -1.45 && c.x < -0.25 && c.y > 1.5 && c.y < 2.15) set = 'pod';
      else if (c.x > 2.82) set = 'cab';
      else if (part === 'top') set = 'roof';
      else set = side < 0 ? 'sideL' : 'sideR';
      sets[set].push(...tris);
      // glass patches (supersets of the glazed areas; the shader trims them)
      if (set === 'door' && c.x > 1.5 && c.x < 2.44 && c.y > 1.52 && c.y < 2.25) glassSets.door.push(...tris);
      if (part === 'side' && c.x > 2.94 && c.x < 4.3 && c.y > 1.39 && c.y < 2.19) glassSets[side < 0 ? 'cabL' : 'cabR'].push(...tris);
      if (part !== 'side' && c.x > 3.86 && c.x < 4.48 && Math.abs(c.z) < 0.9) glassSets.windshield.push(...tris);
    }
  }
  // Smooth normals across the whole skin, then split
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  full.setIndex(sets.all);
  full.computeVertexNormals();
  const nor = full.attributes.normal.array;
  const inset = new Float32Array(pos.length);
  for (let v = 0; v < pos.length; v++) inset[v] = pos[v] - nor[v] * 0.006;
  full.dispose();

  patchPaint(M.paint);
  patchGlass(M.glassCab);
  patchGlass(M.glassPrivacy);
  M.paint.side = THREE.DoubleSide;
  const depth = bodyDepthMaterial();
  const paintMesh = (tris, explodeDir) => {
    const m = new THREE.Mesh(subGeometry(tris, pos, nor), M.paint);
    m.castShadow = m.receiveShadow = true;
    m.customDepthMaterial = depth;
    m.userData.irProfile = 'shell'; // infrared: back faces show the cabin side of the skin
    if (explodeDir) m.userData.explodeDir = explodeDir;
    return m;
  };
  const glassMesh = (tris, mat) => {
    const m = new THREE.Mesh(subGeometry(tris, inset, nor), mat);
    m.userData.bodyGlass = true;
    m.renderOrder = 2;
    return m;
  };
  const panels = {
    sideL: paintMesh(sets.sideL, [0, 0, -1.35]),
    sideR: paintMesh(sets.sideR, [0, 0, 1.35]),
    roof: paintMesh(sets.roof, [0, 1.5, 0]),
    cab: paintMesh(sets.cab, [1.3, 0, 0]),
  };
  const door = paintMesh(sets.door);
  const pod = paintMesh(sets.pod);
  const glass = {
    windshield: glassMesh(glassSets.windshield, M.glassCab),
    cabL: glassMesh(glassSets.cabL, M.glassCab),
    cabR: glassMesh(glassSets.cabR, M.glassCab),
    door: glassMesh(glassSets.door, M.glassPrivacy),
  };
  // Caps: rear frame around the door aperture, and the nose face behind the grille
  const rearHole = new THREE.Path();
  {
    const z = 0.84, y0 = 0.62, y1 = 2.52, r = 0.03;
    rearHole.moveTo(-z + r, y0);
    rearHole.lineTo(z - r, y0);
    rearHole.quadraticCurveTo(z, y0, z, y0 + r);
    rearHole.lineTo(z, y1 - r);
    rearHole.quadraticCurveTo(z, y1, z - r, y1);
    rearHole.lineTo(-z + r, y1);
    rearHole.quadraticCurveTo(-z, y1, -z, y1 - r);
    rearHole.lineTo(-z, y0 + r);
    rearHole.quadraticCurveTo(-z, y0, -z + r, y0);
  }
  const rg = new THREE.ExtrudeGeometry(capShape(halfSection(XR), rearHole), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 6 });
  rg.rotateY(-Math.PI / 2);
  const rearCap = new THREE.Mesh(rg, M.paint);
  rearCap.position.x = XR + 0.008;
  rearCap.castShadow = rearCap.receiveShadow = true;
  rearCap.userData.explodeDir = [-1.3, 0, 0];
  rearCap.userData.irProfile = 'shell';
  const fg = new THREE.ExtrudeGeometry(capShape(halfSection(XF)), { depth: 0.02, bevelEnabled: false });
  fg.rotateY(Math.PI / 2);
  const frontCap = new THREE.Mesh(fg, M.paint);
  frontCap.position.x = XF - 0.012;
  frontCap.castShadow = true;
  frontCap.userData.explodeDir = [1.3, 0, 0];
  return { panels, door, pod, glass, rearCap, frontCap };
}
