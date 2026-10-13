// Infrared camera: every surface is shaded by an estimated surface temperature (ironbow palette).
// Temperatures come from the live simulation snapshot: sol-air temperature and night-sky cooling on
// the outside, film-coefficient drops across each envelope element (U-value), stratified cabin air,
// and the running appliances (heater, cooktop, inverter, AC, batteries…). Steady-state estimates —
// not a measured image.
import * as THREE from 'three';

const H_OUT = 20; // exterior film coefficient, W/m²K
const H_IN = 8; // interior film coefficient, W/m²K
const U = { wall: 1.1, roof: 1.0, cab: 2.0, glass: 5.8, glassCov: 1.6, floor: 0.9 };

export const IR_RANGE = { min: -20, max: 40 };
const SHARED = {
  uTmin: { value: -20 },
  uTmax: { value: 40 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uTrefl: { value: 0 },
};

const VERT = /* glsl */ `
#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vWN;
varying vec3 vWP;
varying vec3 vOP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vOP = position;
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * wp;
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}`;

const FRAG = /* glsl */ `
#include <common>
#include <clipping_planes_pars_fragment>
uniform float uT, uTback, uSolar, uSky, uStrat, uCabX, uCabT;
uniform float uTmin, uTmax, uTrefl;
uniform vec3 uSunDir;
varying vec3 vWN;
varying vec3 vWP;
varying vec3 vOP;
vec3 ironbow(float t) {
  // black → indigo → magenta → red → orange → yellow → white (sRGB), returned linear
  vec3 c0 = vec3(0.0, 0.0, 0.02), c1 = vec3(0.13, 0.02, 0.45), c2 = vec3(0.55, 0.05, 0.55), c3 = vec3(0.86, 0.18, 0.2),
       c4 = vec3(0.98, 0.5, 0.05), c5 = vec3(1.0, 0.85, 0.2), c6 = vec3(1.0, 1.0, 0.92);
  t = clamp(t, 0.0, 1.0) * 6.0;
  vec3 c = t < 1.0 ? mix(c0, c1, t) : t < 2.0 ? mix(c1, c2, t - 1.0) : t < 3.0 ? mix(c2, c3, t - 2.0) : t < 4.0 ? mix(c3, c4, t - 3.0) : t < 5.0 ? mix(c4, c5, t - 4.0) : mix(c5, c6, t - 5.0);
  return pow(c, vec3(2.2));
}
float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  #include <clipping_planes_fragment>
  vec3 n = normalize(vWN);
  float T = (vOP.x > uCabX ? uCabT : uT);
  if (!gl_FrontFacing) { n = -n; T = uTback; }
  T += uSolar * max(dot(n, uSunDir), 0.0) - uSky * max(n.y, 0.0) + uStrat * (vWP.y - 1.6);
  T += (h3(floor(vWP * 50.0)) - 0.5) * 0.3;
  vec3 v = normalize(cameraPosition - vWP);
  float graze = pow(1.0 - abs(dot(n, v)), 5.0);
  T = mix(T, uTrefl, graze * 0.45);
  float t = (T - uTmin) / (uTmax - uTmin);
  gl_FragColor = vec4(ironbow(t), 1.0);
}`;

function irMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...SHARED,
      uT: { value: 20 }, uTback: { value: 20 }, uSolar: { value: 0 }, uSky: { value: 0 }, uStrat: { value: 0 },
      uCabX: { value: 99 }, uCabT: { value: 20 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    clipping: true,
    toneMapped: false,
  });
}

/** Which temperature profile a mesh belongs to. */
function profileOf(m, M) {
  const ud = m.userData;
  const orig = ud.origMat || m.material;
  if (ud.irProfile) return ud.irProfile;
  if (orig === M.cookZone) return 'cookZone';
  if (orig === M.lightOn || orig === M.ledStrip) return 'lamp';
  if (ud.cid === 'occupant') return 'person';
  if (ud.kind === 'glass') return 'glass';
  if (ud.kind === 'wheel' || ud.kind === 'chassis') return 'chassis';
  if (ud.kind === 'rack') return 'exteriorMetal';
  if (ud.kind === 'lining') return ud.cid === 'insulation' && m.position.y < 0.75 ? 'floor' : 'lining';
  if (ud.kind === 'insulation') return 'lining';
  if (ud.kind === 'body') return 'skin';
  const id = ud.cid || '';
  const SPECIFIC = {
    'combi-heater': 'heater', 'combi-cowl': 'cowl', cooktop: 'cooktop', fridge: 'fridge', microwave: 'microwave',
    'battery-a': 'battery', 'battery-b': 'battery', inverter: 'inverter', mppt: 'mppt', 'orion-1': 'dcdc', 'orion-2': 'dcdc',
    'rooftop-ac': 'acUnit', 'ac-plenum': 'acCold', 'ac-duct': 'acCold', 'solar-1': 'solar', 'solar-2': 'solar', 'solar-3': 'solar',
    'fresh-tank': 'freshWater', 'grey-tank': 'greyWater', 'grey-dump': 'greyWater', 'fuel-tank': 'outside', 'heater-fuel-pump': 'outside',
    'starter-battery': 'cab', mattress: 'mattress', 'slideout-pod': 'pod', 'sliding-door': 'skin', 'rear-doors': 'skin',
    awning: 'exteriorMetal', 'roof-rack': 'exteriorMetal', starlink: 'exteriorMetal', 'hood-vent': 'exteriorMetal', 'toilet-vent': 'exteriorMetal',
    'fill-inlet': 'skinPart', 'shore-inlet': 'skinPart', 'outdoor-shower': 'skinPart', 'rear-door-table': 'exteriorMetal', 'rear-door-bench': 'exteriorMetal',
    'window-covers': 'cover', 'outdoor-kitchen': 'interior', wetbath: 'bath', 'shower-pan': 'bath', 'shower-fixtures': 'bath', 'seat-driver': 'cab', 'seat-passenger': 'cab',
  };
  return SPECIFIC[id] || 'interior';
}

export class Infrared {
  constructor(world) {
    this.world = world;
    this.on = false;
    this.mats = new Map(); // profile → material
    this.clipMats = new Map();
    this.groundMat = irMaterial();
    this.groundMat.uniforms.uStrat.value = 0;
    this.prof = {};
    this.skyT = 0;
  }

  mat(profile, clip) {
    if (!this.mats.has(profile)) this.mats.set(profile, irMaterial());
    const base = this.mats.get(profile);
    if (!clip) return base;
    if (!this.clipMats.has(profile)) {
      const m = new THREE.ShaderMaterial({ uniforms: base.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, clipping: true, toneMapped: false });
      m.clippingPlanes = this.world.modes.planes;
      this.clipMats.set(profile, m);
    }
    return this.clipMats.get(profile);
  }

  /** Swap in IR materials (called from Modes.apply after normal styling). */
  applyMaterials(cut) {
    const { M } = this.world;
    const roots = [this.world.body.root, this.world.comps.root, this.world.person.root];
    for (const r of roots) {
      r.traverse((m) => {
        if (!m.isMesh) return;
        if (m.material === M.ghost || m.material === M.xrayBody || m.material === M.glassClear) return;
        const p = profileOf(m, M);
        m.userData.irP = p;
        m.material = this.mat(p, cut);
      });
    }
  }

  setStage(on) {
    const st = this.world.stage;
    this.on = on;
    st.sky.visible = !on;
    st.contact.visible = !on;
    if (on) {
      if (!this.savedGround) this.savedGround = st.ground.material;
      st.ground.material = this.groundMat;
      st.scene.fog = null;
      st.renderer.toneMapping = THREE.NoToneMapping;
      st.renderer.toneMappingExposure = 1;
      if (st.aoPass) st.aoPass.enabled = false;
      if (st.bloomPass) st.bloomPass.strength = 0.25;
      st.rain.visible = st.snow.visible = false;
    } else {
      if (this.savedGround) st.ground.material = this.savedGround;
      st.scene.fog = st.fog;
      st.scene.background = null;
      st.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      if (st.aoPass) st.aoPass.enabled = true;
    }
    this.world.flows.group.visible = !on;
  }

  /** Recompute every profile temperature from the snapshot. */
  update(snap, sunDir) {
    if (!this.on || !snap) return;
    const wx = snap.wx, To = wx.T, Ti = snap.Tin, G = wx.ghi || 0, cloud = wx.cloud ?? 0;
    const W = snap.byLoad || {}, lv = snap.levels || {};
    const night = G < 5;
    const sunUp = sunDir.y > 0.02 && G > 5;
    const skyT = To - (night ? 18 : 10) * (1 - 0.8 * cloud);
    this.skyT = skyT;
    const solar = (a) => (sunUp ? (a * G * 1.1) / H_OUT : 0); // °C rise at normal incidence
    const sky = (night ? 4.5 : 1.2) * (1 - 0.8 * cloud);
    const dT = Ti - To;
    const strat = snap.Qheat > 0 ? 1.8 : snap.Qcool > 0 ? 1.1 : 0.5;
    const glassU = snap.covers > 0.5 ? U.glassCov : U.glass;
    const P = {};
    const set = (k, o) => (P[k] = { T: o.T, back: o.back ?? o.T, solar: o.solar ?? 0, sky: o.sky ?? 0, strat: o.strat ?? 0, cabX: o.cabX ?? 99, cabT: o.cabT ?? o.T });
    // envelope
    set('shell', { T: To + (dT * U.wall) / H_OUT, back: Ti - (dT * U.cab) / H_IN, solar: solar(0.3), sky, cabX: 2.82, cabT: To + (dT * U.cab) / H_OUT });
    set('skin', { T: To + (dT * U.cab) / H_OUT * 0.5, solar: solar(0.35), sky });
    set('skinPart', { T: To + (dT * U.cab) / H_OUT, solar: solar(0.4), sky });
    set('pod', { T: To + (dT * 1.3) / H_OUT, back: Ti - 1, solar: solar(0.3), sky });
    set('glass', { T: To + (dT * glassU) / H_OUT, back: snap.glassT, solar: solar(0.08), sky: sky * 0.5 });
    set('cover', { T: Ti - (Ti - snap.glassT) * 0.6, strat });
    set('lining', { T: Ti - (dT * U.wall) / H_IN, solar: solar(0.3) * (U.wall / H_IN), strat });
    set('floor', { T: Ti - (dT * U.floor) / H_IN - 0.6, strat: 0 });
    set('chassis', { T: To + (snap.driving ? 12 : 0), solar: solar(0.6) });
    set('exteriorMetal', { T: To, solar: solar(0.45), sky });
    set('outside', { T: To + (snap.driving ? 4 : 0) });
    set('solar', { T: To + (sunUp ? 0.028 * G : 0), sky: sky * 1.2 });
    // cabin & furniture
    set('interior', { T: Ti, strat });
    set('cab', { T: Ti - (dT * 0.08), strat, solar: solar(0.25) * 0.4 });
    set('mattress', { T: Ti + (snap.occ > 0 && (snap.hour >= 22 || snap.hour < 7) ? 4 : 0.5), strat });
    set('person', { T: 31 });
    set('lamp', { T: Ti + 8 * Math.min(1, (lv.lights ?? 1) * 0.6) });
    // services & appliances
    const heating = snap.Qheat > 0;
    set('heater', { T: Math.max(Ti + 2, 0.4 * snap.boilerT + 0.6 * Ti) + (heating ? 22 : 0) });
    set('cowl', { T: heating && snap.heaterSource !== 'electric' ? 95 : To + (dT * U.cab) / H_OUT, solar: solar(0.4) });
    const ind = W.induction || 0;
    set('cooktop', { T: Ti + (ind > 0 ? 18 : 0) });
    set('cookZone', { T: ind > 0 ? 120 + Math.min(110, ind / 18) : Ti + 0.5 });
    set('fridge', { T: Ti + ((W.fridge || 0) > 0 ? 2.5 : 0.8), strat });
    set('microwave', { T: Ti + ((W.microwave || 0) > 0 ? 24 : 0.5) });
    set('battery', { T: Ti + 0.8 + Math.min(8, Math.abs(snap.batA || 0) / 40) });
    set('inverter', { T: Ti + 3 + Math.min(30, (snap.invOut || 0) / 70) });
    set('mppt', { T: Ti + 1 + (snap.solarW || 0) / 60 });
    set('dcdc', { T: Ti + 1 + (snap.altW || 0) / 90 });
    set('acUnit', { T: snap.Qcool > 0 ? To + 14 : To, solar: solar(0.3), sky });
    set('acCold', { T: snap.Qcool > 0 ? 12 : Ti, strat: 0 });
    set('freshWater', { T: Ti - 1.2 });
    set('greyWater', { T: To < 5 ? Math.max(To, 6) : To + 1 });
    set('bath', { T: (snap.act?.water?.shower || snap.drawL > 2) ? 36 : Ti - 0.5, strat });
    this.prof = P;
    // range: frame the envelope from outside, the cabin from inside
    const c = this.world.stage.camera.position;
    const inside = c.x > -1.6 && c.x < 4.2 && Math.abs(c.z) < 0.95 && c.y > 0.7 && c.y < 2.65;
    let lo, hi;
    if (inside) {
      lo = Math.min(Ti - 10, snap.glassT - 2);
      hi = Ti + 16;
    } else {
      lo = Math.min(To, Ti, skyT + 6) - 4;
      hi = Math.max(Ti, To + solar(0.3), To) + 16;
    }
    IR_RANGE.min = Math.round(lo);
    IR_RANGE.max = Math.round(Math.max(hi, lo + 22));
    SHARED.uTmin.value = IR_RANGE.min;
    SHARED.uTmax.value = IR_RANGE.max;
    SHARED.uSunDir.value.copy(sunDir);
    SHARED.uTrefl.value = skyT;
    for (const [k, mat] of this.mats) {
      const p = P[k] || P.interior;
      const u = mat.uniforms;
      u.uT.value = p.T;
      u.uTback.value = p.back;
      u.uSolar.value = p.solar;
      u.uSky.value = p.sky;
      u.uStrat.value = p.strat;
      u.uCabX.value = p.cabX;
      u.uCabT.value = p.cabT;
    }
    // ground: sunlit soil heats up; snow stays at or below 0 °C
    const gu = this.groundMat.uniforms;
    const snowy = (wx.snow ?? 0) > 0 || To < -2;
    gu.uT.value = snowy ? Math.min(0, To + 1) : To + (sunUp ? 0.018 * G : -2 * (1 - cloud));
    gu.uTback.value = gu.uT.value;
    gu.uSky.value = 0;
    gu.uSolar.value = 0;
    const st = this.world.stage;
    st.scene.background = this.paletteColor(skyT + 2);
  }

  /** Approximate apparent temperature at a picked point (for the hover read-out). */
  sample(mesh, point, normal) {
    const p = this.prof[mesh?.userData?.irP];
    if (!p) return null;
    const n = normal || new THREE.Vector3(0, 1, 0);
    let T = mesh.worldToLocal(point.clone()).x > p.cabX ? p.cabT : p.T;
    T += p.solar * Math.max(n.dot(SHARED.uSunDir.value), 0) - p.sky * Math.max(n.y, 0) + p.strat * (point.y - 1.6);
    return T;
  }

  paletteColor(T) {
    const t = Math.min(1, Math.max(0, (T - IR_RANGE.min) / (IR_RANGE.max - IR_RANGE.min))) * 6;
    const C = [[0, 0, 0.02], [0.13, 0.02, 0.45], [0.55, 0.05, 0.55], [0.86, 0.18, 0.2], [0.98, 0.5, 0.05], [1, 0.85, 0.2], [1, 1, 0.92]];
    const i = Math.min(5, Math.floor(t)), f = t - i;
    const c = C[i].map((v, k) => v + (C[i + 1][k] - v) * f);
    return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  }
}

/** CSS gradient of the palette for the legend. */
export const IRONBOW_CSS = 'linear-gradient(90deg, #000005, #210573, #8c0d8c, #db2e33, #fa800d, #ffd933, #fffff0)';
