// The season "skin": the land itself (heights, roads, towns, trees, lakes) never changes between
// scenarios or seasons; only how it is drawn does. One shared set of uniforms drives the terrain,
// road, water, vegetation and town shaders.
import * as THREE from 'three';

export const SEASON_KEYS = ['spring', 'summer', 'autumn', 'winter'];

export const SEASONS = {
  spring: { label: 'Spring', snowLine: 150, wet: 0.3, grass: [0.8, 1.15, 0.62], forest: [0.9, 1.1, 0.8], crop: [0.75, 1.15, 0.65], leaf: [0.42, 0.62, 0.26], leafAmt: 0.85, ice: 0, conifer: 'green' },
  summer: { label: 'Summer', snowLine: 245, wet: 0, grass: [1.12, 1.0, 0.7], forest: [1, 1, 0.95], crop: [1, 1, 1], leaf: [0.2, 0.4, 0.14], leafAmt: 1, ice: 0, conifer: 'green' },
  autumn: { label: 'Autumn', snowLine: 190, wet: 0.1, grass: [1.35, 0.98, 0.58], forest: [1.1, 0.9, 0.7], crop: [1.1, 0.85, 0.6], leaf: [0.84, 0.56, 0.12], leafAmt: 0.75, ice: 0, conifer: 'green' },
  winter: { label: 'Winter', snowLine: -80, wet: 0, grass: [0.9, 0.8, 0.65], forest: [0.9, 0.9, 0.95], crop: [0.9, 0.85, 0.8], leaf: [0.3, 0.25, 0.2], leafAmt: 0.12, ice: 1, conifer: 'snow' },
};

// Scenario → default season (the user can override); rain / humid add wetness on top
export const SCENARIO_SEASON = { summer: 'summer', winter: 'winter', rain: 'spring', humid: 'summer', overnight: 'autumn', multiday: 'spring' };
export const SCENARIO_WET = { rain: 1, humid: 0.25 };

export class SeasonState {
  constructor() {
    this.key = 'summer';
    this.u = {
      uSnowLine: { value: 245 },
      uWet: { value: 0 },
      uIce: { value: 0 },
      uGrassTint: { value: new THREE.Vector3(1.2, 1.05, 0.7) },
      uForestTint: { value: new THREE.Vector3(1, 1, 0.95) },
      uCropTint: { value: new THREE.Vector3(1, 1, 1) },
      uLeaf: { value: 1 },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uWind: { value: 0.3 },
    };
    this.leaf = new THREE.Color(0.18, 0.42, 0.14);
    this.conifer = 'green';
    this.listeners = [];
  }

  /** Apply a season, optionally with an explicit wetness (0..1) from the weather. */
  set(key, wet = null) {
    const S = SEASONS[key] || SEASONS.summer;
    this.key = key;
    const u = this.u;
    u.uSnowLine.value = S.snowLine;
    u.uWet.value = wet ?? S.wet;
    u.uIce.value = S.ice;
    u.uGrassTint.value.set(...S.grass);
    u.uForestTint.value.set(...S.forest);
    u.uCropTint.value.set(...S.crop);
    u.uLeaf.value = S.leafAmt;
    this.leaf.setRGB(S.leaf[0], S.leaf[1], S.leaf[2], THREE.SRGBColorSpace);
    this.conifer = S.conifer;
    this.snowy = key === 'winter';
    for (const f of this.listeners) f(this);
  }
}

/** GLSL shared by the terrain, road and building shaders. */
export const GLSL_NOISE = /* glsl */ `
vec3 L3(vec3 c) { return pow(c, vec3(2.2)); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
`;
