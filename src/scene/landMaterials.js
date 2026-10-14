// Shader materials for the land: splat terrain (grass / forest floor / badlands strata / fields /
// rock / snow), road surfaces with markings, wear, snow and puddles, and lake water / ice.
// All of them are MeshStandardMaterial patches so they keep PBR lighting, shadows and fog.
import * as THREE from 'three';
import { loadPBR } from './materials.js';
import { GLSL_NOISE } from './season.js';

// Road surface class ids (aRoad.z)
export const RC = { interstate: 1, highway: 2, county: 3, gravel: 4, dirt: 5, street: 6, sidewalk: 7, pavement: 8, lawn: 9, lot: 10 };

export function makeTerrainMaterial(season) {
  const g = loadPBR('aerial_grass_rock', { repeat: 1 / 7, normalScale: 0.9 });
  const forest = loadPBR('forrest_ground_01', { repeat: 1 }).map;
  const dirt = loadPBR('aerial_sand', { repeat: 1 }).map;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: g.map, normalMap: g.normalMap, normalScale: g.normalScale, roughness: 0.93, metalness: 0, envMapIntensity: 0.5 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tForest = { value: forest };
    sh.uniforms.tDirt = { value: dirt };
    for (const k of ['uSnowLine', 'uWet', 'uGrassTint', 'uForestTint', 'uCropTint']) sh.uniforms[k] = season.u[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aW;\nvarying vec4 vW;\nvarying vec2 vWXZ;\nvarying float vWY;\nvarying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = aW; vWXZ = uv; vWY = position.y; vON = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tForest;
        uniform sampler2D tDirt;
        uniform float uSnowLine;
        uniform float uWet;
        uniform vec3 uGrassTint;
        uniform vec3 uForestTint;
        uniform vec3 uCropTint;
        varying vec4 vW;
        varying vec2 vWXZ;
        varying float vWY;
        varying vec3 vON;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 wp = vWXZ;
        vec3 macro = texture2D(map, mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.27 + vec2(0.37, 0.71)).rgb;
        float vary = 0.82 + 0.36 * vn(wp / 37.0);
        vec3 grass = mix(diffuseColor.rgb, macro, 0.4) * vary * uGrassTint;
        float lum = dot(grass, vec3(0.333));
        vec3 forestC = texture2D(tForest, wp / 5.0).rgb * uForestTint * (0.9 + 0.2 * vn(wp / 11.0));
        vec3 dirtC = texture2D(tDirt, wp / 6.0).rgb;
        float sl = 1.0 - clamp(normalize(vON).y, 0.0, 1.0);
        float sband = fract(vWY * 0.19 + 0.55 * vn(wp / 70.0));
        vec3 strata = mix(L3(vec3(0.55, 0.36, 0.26)), L3(vec3(0.80, 0.68, 0.50)), smoothstep(0.15, 0.55, sband)) * (0.7 + 0.5 * dot(dirtC, vec3(0.333)));
        strata = mix(strata, L3(vec3(0.38, 0.27, 0.22)), smoothstep(0.82, 0.98, sband));
        vec3 col = grass;
        col = mix(col, forestC, smoothstep(0.38, 0.72, vW.x));
        col = mix(col, strata, vW.y);
        if (vW.w > 0.03) {
          vec2 cs = vec2(240.0, 400.0);
          vec2 fcell = floor(wp / cs);
          vec2 ff = fract(wp / cs);
          float fh = h21(fcell + 3.1);
          float ang = h21(fcell + 9.7) < 0.5 ? 0.0 : 1.5708;
          float rows = 0.86 + 0.14 * sin(dot(wp, vec2(cos(ang), sin(ang))) * 2.6);
          vec3 crop = fh < 0.26 ? L3(vec3(0.66, 0.55, 0.24)) : fh < 0.5 ? L3(vec3(0.33, 0.50, 0.17)) : fh < 0.66 ? L3(vec3(0.36, 0.27, 0.18)) : fh < 0.82 ? L3(vec3(0.50, 0.58, 0.25)) : grass;
          crop = (fh >= 0.82 ? crop : crop * uCropTint * rows) * (0.9 + 0.2 * vn(wp / 9.0));
          float edge = smoothstep(0.0, 0.012, ff.x) * smoothstep(0.0, 0.012, 1.0 - ff.x) * smoothstep(0.0, 0.01, ff.y) * smoothstep(0.0, 0.01, 1.0 - ff.y);
          col = mix(col, mix(grass * 0.75, crop, edge), smoothstep(0.25, 0.55, vW.w));
        }
        float rock = max(smoothstep(0.30, 0.52, sl), smoothstep(190.0, 262.0, vWY) * 0.85);
        col = mix(col, L3(vec3(0.46, 0.43, 0.40)) * (0.75 + 0.5 * lum), rock);
        float snowN = vn(wp / 45.0) - 0.5;
        float gSnow = smoothstep(uSnowLine - 12.0, uSnowLine + 24.0, vWY + 14.0 * snowN);
        gSnow *= 1.0 - 0.8 * smoothstep(0.36, 0.7, sl);
        col = mix(col, L3(vec3(0.93, 0.95, 1.0)) * (0.93 + 0.07 * vn(wp / 3.1)), gSnow * 0.97);
        col *= 1.0 - uWet * 0.32 * (1.0 - gSnow);
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.78, gSnow);
        roughnessFactor = mix(roughnessFactor, 0.45, uWet * 0.7 * (1.0 - gSnow));`);
  };
  mat.customProgramCacheKey = () => 'landTerrain';
  return mat;
}

export function makeRoadMaterial(season, { far = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.45, polygonOffset: true, polygonOffsetFactor: far ? -2 : -2, polygonOffsetUnits: far ? -40 : -6, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    for (const k of ['uSnowLine', 'uWet', 'uGrassTint']) sh.uniforms[k] = season.u[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;\nvarying float vRY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad; vRY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSnowLine;
        uniform float uWet;
        uniform vec3 uGrassTint;
        varying vec4 vRoad;
        varying float vRY;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float cls = floor(vRoad.z + 0.5);
        float ru = vRoad.x;
        float rs = vRoad.y;
        float wd = vRoad.w;
        float rm = abs(ru) * wd * 0.5;
        float sm = ru * wd * 0.5;
        float gr = vn(vec2(rs * 0.7, sm * 0.7)) * 0.6 + vn(vec2(rs * 2.9, sm * 2.9)) * 0.4;
        vec3 col = vec3(0.1);
        float rRough = 0.92;
        float wear = 0.0;
        float paved = (cls < 3.5 || cls == 6.0 || cls == 8.0 || cls == 10.0) ? 1.0 : 0.0;
        if (paved > 0.5) {
          col = vec3(0.085 + 0.05 * gr);
          float lanes = cls == 1.0 ? 3.65 : cls == 2.0 ? 3.5 : 3.3;
          float lc = abs(fract(rm / lanes) - 0.5) * lanes;
          wear = exp(-pow((lc - 0.85) / 0.35, 2.0)) * (cls == 8.0 || cls == 10.0 ? 0.0 : 1.0);
          col *= 1.0 - 0.2 * wear;
          rRough = 0.9 - 0.14 * wear;
          vec3 yellow = vec3(0.84, 0.64, 0.08);
          vec3 white = vec3(0.8);
          float fade = 0.88 - 0.32 * gr;
          float yel = 0.0;
          float wht = 0.0;
          float dash = step(fract(rs / 12.0), 0.33);
          if (cls == 1.0) {
            yel = step(abs(rm - 0.22), 0.065);
            // dashed lane line at 3.65 m, solid edge line at 7.3 m, then a paved shoulder with a milled rumble strip
            wht = step(abs(rm - 3.65), 0.075) * dash + step(abs(rm - 7.3), 0.1);
            float shoulder = step(7.42, rm);
            col *= 1.0 + 0.3 * shoulder;
            col *= 1.0 - 0.3 * shoulder * step(rm, 8.1) * step(fract(rs / 0.5), 0.45);
          } else if (cls == 2.0) {
            float solid = step(0.35, h21(vec2(floor(rs / 160.0), 4.0)));
            float d2 = step(fract(rs / 9.0), 0.3);
            yel = step(abs(rm - 0.14), 0.055) * (solid + (1.0 - solid) * d2);
            wht = step(abs(rm - 3.8), 0.075);
            float shoulder = step(3.92, rm);
            col *= 1.0 + 0.25 * shoulder;
            col *= 1.0 - 0.3 * shoulder * step(rm, 4.5) * step(fract(rs / 0.5), 0.45);
          } else if (cls == 3.0) {
            yel = step(rm, 0.06) * step(fract(rs / 10.0), 0.3);
          } else if (cls == 6.0) {
            if (wd > 13.5) yel = step(abs(rm - 0.14), 0.05);
            else yel = step(rm, 0.06) * step(fract(rs / 8.0), 0.4);
          } else if (cls == 8.0) {
            col *= 0.8 + 0.3 * vn(vec2(rs, sm) * 0.35);
          } else if (cls == 10.0) {
            // rest area / weigh station / auxiliary lane: aged asphalt, parking-stall ticks, painted edge
            col *= 1.18 + 0.2 * gr;
            float lw = wd * 0.5;
            wht = step(rm, 0.1) * step(lw, 5.0) * step(fract(rs / 9.0), 0.4);
            wht += step(fract(rs / 3.7), 0.04) * step(2.0, rm) * step(rm, lw - 4.0) * step(9.0, lw);
            wht += step(abs(rm - lw), 0.07) * step(9.0, lw);
          }
          col = mix(col, yellow, yel * fade);
          col = mix(col, white, wht * fade);
          rRough = mix(rRough, 0.62, max(yel, wht));
          col = mix(col, L3(vec3(0.30, 0.27, 0.20)), smoothstep(wd * 0.5 - 0.8, wd * 0.5, rm) * (cls == 6.0 || cls == 8.0 || cls == 10.0 ? 0.0 : 1.0));
        } else if (cls == 7.0) {
          col = L3(vec3(0.56, 0.55, 0.52)) * (0.88 + 0.14 * gr);
          col *= 1.0 - 0.25 * step(fract(rs / 1.7), 0.02);
          rRough = 0.85;
        } else if (cls == 9.0) {
          // mown town lawn: aRoad.y / aRoad.x·w/2 carry the world x / z (mod 1000)
          float mow = 0.5 + 0.5 * sin((rs + sm) * 0.9);
          col = L3(vec3(0.27, 0.40, 0.14)) * uGrassTint * (0.82 + 0.3 * vn(vec2(rs, sm) * 0.45) + 0.05 * mow);
          rRough = 0.95;
        } else if (cls == 4.0) {
          col = mix(L3(vec3(0.46, 0.38, 0.28)), L3(vec3(0.60, 0.51, 0.40)), gr);
          col *= 1.0 - 0.22 * exp(-pow((rm - 0.9) / 0.4, 2.0));
          col = mix(col, L3(vec3(0.30, 0.34, 0.16)), smoothstep(wd * 0.5 - 0.7, wd * 0.5, rm));
          rRough = 1.0;
        } else {
          col = L3(vec3(0.31, 0.24, 0.17)) * (0.8 + 0.4 * gr);
          col *= 1.0 - 0.25 * exp(-pow((rm - 0.85) / 0.35, 2.0));
          col = mix(col, L3(vec3(0.28, 0.34, 0.14)), smoothstep(0.6, 0.0, rm) * 0.8);
          col = mix(col, L3(vec3(0.30, 0.34, 0.15)), smoothstep(wd * 0.5 - 0.6, wd * 0.5, rm));
          rRough = 1.0;
        }
        float pack = smoothstep(uSnowLine - 12.0, uSnowLine + 24.0, vRY + 3.0) * (cls == 7.0 ? 1.0 : 0.9);
        float clearP = paved > 0.5 ? (0.5 * wear + (cls <= 2.0 ? 0.35 : 0.0)) : 0.15 * wear;
        pack *= 1.0 - clamp(clearP, 0.0, 0.9);
        col = mix(col, vec3(0.86, 0.89, 0.94) * (0.95 + 0.05 * gr), pack);
        rRough = mix(rRough, 0.8, pack);
        col *= 1.0 - uWet * 0.3 * (1.0 - pack);
        rRough = mix(rRough, 0.3, uWet * 0.8 * (1.0 - pack));
        float pud = smoothstep(0.66, 0.74, vn(vec2(rs * 0.08, sm * 0.4 + 3.0))) * uWet * (1.0 - pack);
        col *= 1.0 - 0.3 * pud;
        rRough = mix(rRough, 0.04, pud);
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rRough;');
  };
  mat.customProgramCacheKey = () => (far ? 'landRoadFar' : 'landRoad');
  return mat;
}

export function makeWaterMaterial(season) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d4350, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.9, envMapIntensity: 1.4 });
  mat.onBeforeCompile = (sh) => {
    for (const k of ['uIce', 'uTime']) sh.uniforms[k] = season.u[k];
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vLP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uIce;
        uniform float uTime;
        varying vec2 vLP;
        ${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float cr = vn(vLP * 0.09) * 0.6 + vn(vLP * 0.5) * 0.4;
        vec3 iceC = mix(L3(vec3(0.72, 0.82, 0.88)), L3(vec3(0.93, 0.96, 0.98)), cr);
        float cracks = smoothstep(0.02, 0.0, abs(vn(vLP * 0.11 + 4.0) - 0.5) - 0.0);
        iceC = mix(iceC, L3(vec3(0.96, 0.98, 1.0)), cracks * 0.5);
        diffuseColor.rgb = mix(diffuseColor.rgb, iceC, uIce);
        diffuseColor.a = mix(0.9, 1.0, uIce);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 wv = vec2(
          cos(vLP.x * 0.35 + uTime * 1.3) * 0.5 + cos(vLP.x * 0.9 - vLP.y * 0.7 + uTime * 2.1) * 0.3 + cos(vLP.y * 1.7 + uTime * 2.9) * 0.15,
          cos(vLP.y * 0.4 - uTime * 1.1) * 0.5 + cos(vLP.y * 1.1 + vLP.x * 0.6 - uTime * 1.9) * 0.3 + cos(vLP.x * 1.9 - uTime * 2.7) * 0.15);
        normal = normalize(normal + (viewMatrix * vec4(wv.x, 0.0, wv.y, 0.0)).xyz * 0.07 * (1.0 - uIce));`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.05, 0.3, uIce);');
  };
  mat.customProgramCacheKey = () => 'landWater';
  return mat;
}
