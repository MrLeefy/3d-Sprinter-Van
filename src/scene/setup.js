// Rendering stage: renderer & quality tiers, physical sky with procedural clouds and stars,
// image-based lighting regenerated from that sky, scenario grounds, contact shadow,
// precipitation and the post-processing chain (ambient occlusion, bloom, AA, output).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { loadPBR } from './materials.js';

export const QUALITY = {
  high: { label: 'High', dpr: 2, shadow: 4096, ao: true, bloom: true, msaa: 4, smaa: false, points: true },
  medium: { label: 'Medium', dpr: 1.5, shadow: 2048, ao: false, bloom: true, msaa: 4, smaa: false, points: true },
  low: { label: 'Low', dpr: 1, shadow: 1024, ao: false, bloom: false, msaa: 0, smaa: true, points: false },
  lite: { label: 'Lite', dpr: 1, shadow: 0, ao: false, bloom: false, msaa: 0, smaa: false, points: false },
};

export function autoQuality() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 700;
  return mobile ? 'low' : 'high';
}

// ── Sky shader: Preetham scattering + clouds + night sky ─────────────────────
const SKY_EXTRA = /* glsl */ `
uniform float uExposure;
uniform float uCloud;
uniform float uNight;
uniform float uTime;
uniform vec3 uGround;
uniform vec3 uCloudTint;
uniform vec3 uMoonDir;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<6;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.3,9.1); a*=0.5; } return s; }
`;

function makeSkyMaterial() {
  const S = Sky.SkyShader;
  let frag = S.fragmentShader.replace('uniform vec3 up;', 'uniform vec3 up;\n' + SKY_EXTRA);
  frag = frag.replace(
    'gl_FragColor = vec4( retColor, 1.0 );',
    /* glsl */ `
      retColor *= uExposure;
      float up01 = max(direction.y, 0.0);
      // night sky gradient & stars
      vec3 nightCol = mix(vec3(0.020, 0.030, 0.060), vec3(0.004, 0.007, 0.018), pow(up01, 0.5));
      vec2 sg = floor(direction.xz / max(direction.y, 0.05) * 90.0 + direction.y * 300.0);
      float star = step(0.9965, h21(sg)) * smoothstep(0.02, 0.25, direction.y) * (0.6 + 0.4 * sin(uTime * 3.0 + h21(sg + 7.0) * 40.0));
      nightCol += vec3(star) * 0.9;
      float md = dot(direction, uMoonDir);
      nightCol += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99955, 0.9997, md) * 1.6 + pow(max(md, 0.0), 300.0) * 0.12 + pow(max(md, 0.0), 12.0) * 0.025);
      retColor = mix(retColor, nightCol, uNight);
      // procedural cloud layer
      if (direction.y > 0.0) {
        vec2 cuv = direction.xz / (direction.y + 0.08) * 0.9 + vec2(uTime * 0.004, uTime * 0.0015);
        float n = fbm(cuv * 1.6);
        float cov = smoothstep(1.02 - uCloud * 0.95, 1.12 - uCloud * 0.6, n + 0.28);
        float sunGlow = pow(max(dot(direction, vSunDirection), 0.0), 6.0);
        float lit = clamp(0.55 + 0.6 * (n - 0.45) + sunGlow * 0.6, 0.0, 1.4);
        vec3 cloudDay = mix(vec3(0.42, 0.46, 0.52), vec3(1.05, 1.03, 1.0), lit) * mix(1.0, 0.55, uCloud);
        vec3 cloudCol = mix(cloudDay * uCloudTint, vec3(0.03, 0.035, 0.05), uNight);
        float fade = smoothstep(0.0, 0.18, direction.y);
        retColor = mix(retColor, cloudCol * uExposure * 1.6, cov * fade);
        // overcast flattens the whole dome
        retColor = mix(retColor, mix(vec3(0.55, 0.58, 0.62) * uExposure * 1.4, nightCol, uNight), smoothstep(0.6, 1.0, uCloud) * 0.7);
      }
      // ground below the horizon
      retColor = mix(retColor, uGround, smoothstep(0.0, -0.06, direction.y));
      gl_FragColor = vec4( retColor, 1.0 );`,
  );
  return new THREE.ShaderMaterial({
    name: 'StealthSky',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsUtils.clone(S.uniforms), {
      uExposure: { value: 1 }, uCloud: { value: 0.1 }, uNight: { value: 0 }, uTime: { value: 0 },
      uGround: { value: new THREE.Color(0x5a5446) }, uCloudTint: { value: new THREE.Color(1, 1, 1) }, uMoonDir: { value: new THREE.Vector3(-0.4, 0.75, -0.5).normalize() },
    }]),
    vertexShader: S.vertexShader,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

export function createStage(container, { quality = autoQuality() } = {}) {
  const Q = QUALITY[quality] || QUALITY.high;
  const renderer = new THREE.WebGLRenderer({ antialias: Q.msaa > 0 && !Q.ao && !Q.bloom, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.dpr));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = Q.shadow > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.setSize(container.clientWidth, container.clientHeight);
  labels.domElement.className = 'label-layer';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.05, 900);
  camera.position.set(8.2, 3.4, 7.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(1.6, 1.3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.3;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.update();

  // ── Lights ───────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x6b5a45, 0.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2e0, 3);
  sun.castShadow = Q.shadow > 0;
  sun.shadow.mapSize.set(Q.shadow || 512, Q.shadow || 512);
  Object.assign(sun.shadow.camera, { left: -6.5, right: 6.5, top: 6.5, bottom: -6.5, near: 0.5, far: 40 });
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  sun.target.position.set(1.4, 1, 0);
  scene.add(sun, sun.target);

  // Interior point lights (switched by the lighting system)
  const interior = [];
  if (Q.points) {
    for (const [x, z] of [[-0.95, 0.05], [0.25, -0.15], [1.3, -0.05], [2.35, 0]]) {
      const l = new THREE.PointLight(0xffc98f, 0, 4.2, 1.7);
      l.position.set(x, 2.42, z);
      scene.add(l);
      interior.push(l);
    }
  }
  const bathLight = new THREE.PointLight(0xfff0dc, 0, 2.2, 1.6);
  bathLight.position.set(0.25, 2.4, 0.45);
  if (Q.points) scene.add(bathLight);

  // ── Sky & image-based lighting ───────────────────────────
  const skyMat = makeSkyMaterial();
  const sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skyMat);
  sky.scale.setScalar(800);
  sky.frustumCulled = false;
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, skyMat);
  envSky.scale.setScalar(100);
  envScene.add(envSky);
  let envRT = null;
  const refreshEnv = () => {
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0, 0.1, 200);
    scene.environment = envRT.texture;
  };

  // ── Ground ───────────────────────────────────────────────
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, envMapIntensity: 0.6 });
  // Break up texture tiling: blend a rotated macro-scale sample and a slow brightness variation
  groundMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        vec2 ruv = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.27 + vec2(0.37, 0.71);
        vec4 macro = texture2D( map, ruv );
        float vary = texture2D( map, vMapUv * 0.043 + vec2(0.5) ).g;
        sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, macro.rgb, 0.4) * (0.82 + 0.36 * vary);
        diffuseColor *= sampledDiffuseColor;
      #endif`);
  };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 96), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grounds = {};
  const setGround = (id) => {
    if (!grounds[id]) grounds[id] = loadPBR(id, { repeat: 42, normalScale: 0.9 });
    const t = grounds[id];
    // Snow reads as dirty with its photo albedo under grazing light; keep only its relief
    groundMat.map = id === 'snow_02' ? null : t.map;
    groundMat.normalMap = t.normalMap;
    groundMat.roughnessMap = t.roughnessMap || null;
    groundMat.needsUpdate = true;
  };
  // Soft contact shadow under the van (ambient occlusion of the body on the ground)
  const cs = document.createElement('canvas');
  cs.width = 256;
  cs.height = 128;
  const cg = cs.getContext('2d');
  const grd = cg.createRadialGradient(128, 64, 8, 128, 64, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.42)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  cg.fillStyle = grd;
  cg.fillRect(0, 0, 256, 128);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 3.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cs), transparent: true, depthWrite: false, toneMapped: false }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(1.85, 0.004, 0);
  contact.renderOrder = 1;
  scene.add(contact);

  scene.fog = new THREE.Fog(0xe6e2d3, 60, 320);

  // ── Precipitation ────────────────────────────────────────
  const rainN = 6000;
  const rainPos = new Float32Array(rainN * 6);
  for (let i = 0; i < rainN; i++) {
    const x = (Math.random() - 0.5) * 30 + 1.5, y = Math.random() * 14, z = (Math.random() - 0.5) * 30;
    rainPos.set([x, y, z, x + 0.025, y - 0.42, z + 0.01], i * 6);
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc4d6e6, transparent: true, opacity: 0.32, depthWrite: false }));
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);
  const snowN = 4000;
  const snowPos = new Float32Array(snowN * 3);
  for (let i = 0; i < snowN; i++) snowPos.set([(Math.random() - 0.5) * 30 + 1.5, Math.random() * 14, (Math.random() - 0.5) * 30], i * 3);
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const dg = dot.getContext('2d');
  const rg = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  dg.fillStyle = rg;
  dg.fillRect(0, 0, 32, 32);
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, map: new THREE.CanvasTexture(dot), transparent: true, opacity: 0.95, depthWrite: false }));
  snow.visible = false;
  snow.frustumCulled = false;
  scene.add(snow);

  // ── Post-processing ──────────────────────────────────────
  let composer = null, aoPass = null, bloomPass = null;
  const usePost = Q.ao || Q.bloom || Q.smaa;
  if (usePost) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (Q.ao) {
      aoPass = new GTAOPass(scene, camera, size.x, size.y);
      aoPass.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
      aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      aoPass.blendIntensity = 0.9;
      composer.addPass(aoPass);
    }
    if (Q.bloom) {
      bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.42, 0.55, 1.05);
      composer.addPass(bloomPass);
    }
    composer.addPass(new OutputPass());
    if (Q.smaa) composer.addPass(new SMAAPass(size.x, size.y));
  }

  const stage = {
    quality, Q, renderer, labels, scene, camera, controls, hemi, sun, interior, bathLight, sky, skyMat, ground, groundMat, setGround,
    contact, rain, snow, fog: scene.fog, composer, aoPass, bloomPass, refreshEnv, envDirty: true, envT: 0,
    render() {
      if (stage.envDirty && performance.now() - stage.envT > 400) {
        stage.envDirty = false;
        stage.envT = performance.now();
        refreshEnv();
      }
      if (composer) composer.render();
      else renderer.render(scene, camera);
      labels.render(scene, camera);
    },
  };
  const onResize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    // Centre the scene in the free area between the floating panels (desktop layout)
    const css = getComputedStyle(document.documentElement);
    const lw = parseFloat(css.getPropertyValue('--left-w')) || 0;
    const rw = parseFloat(css.getPropertyValue('--right-w')) || 0;
    if (w > 900) camera.setViewOffset(w, h, (rw - lw) / 2, 22, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    }
  };
  stage.onResize = onResize;
  requestAnimationFrame(onResize);
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(container);
  return stage;
}

// Seasonal sun: maximum solar elevation per scenario (deg) for a mid-latitude site
const MAX_ELEV = { summer: 72, winter: 22, rain: 52, humid: 66, overnight: 56, multiday: 55 };
const GROUND_TINT = { aerial_sand: 0xffe2bd, snow_02: 0xf4f8ff, brown_mud_02: 0xd9cfc0, forrest_ground_01: 0xffffff, aerial_grass_rock: 0xf2f2e6 };
const GROUND = { summer: 'aerial_sand', winter: 'snow_02', rain: 'brown_mud_02', humid: 'forrest_ground_01', overnight: 'aerial_grass_rock', multiday: 'aerial_grass_rock' };

/** Sun direction (unit vector) for a scenario day/hour. East = +z, south = −x. */
export function sunDirection(scn, wx, hour) {
  const t = (hour - wx.sunrise) / (wx.sunset - wx.sunrise);
  const maxE = THREE.MathUtils.degToRad(MAX_ELEV[scn.id] ?? 55);
  const elev = t > 0 && t < 1 ? maxE * Math.sin(Math.PI * t) : -0.25;
  const az = Math.PI * 0.5 + Math.PI * Math.min(1, Math.max(0, t)); // east → south → west
  return new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
}

/** Apply a scenario's weather & the time of day to the stage. */
export function applyWeather(stage, scn, wx, hour) {
  const v = scn.visuals;
  const dir = sunDirection(scn, wx, hour);
  const elev = Math.asin(dir.y);
  const night = elev < -0.02;
  const dayK = THREE.MathUtils.clamp((elev + 0.08) / 0.35, 0, 1);
  const cloud = wx.cloud ?? 0;
  const u = stage.skyMat.uniforms;
  u.sunPosition.value.copy(dir).multiplyScalar(400);
  u.turbidity.value = 2.5 + 6 * (v.haze ?? 0) + (wx.rain ? 6 : 0);
  u.rayleigh.value = night ? 0.4 : 1.2 + 1.5 * (1 - dayK);
  u.mieCoefficient.value = 0.004 + 0.01 * (v.haze ?? 0);
  u.mieDirectionalG.value = 0.82;
  u.uExposure.value = 0.32;
  u.uCloud.value = Math.min(0.98, cloud + (wx.rain ? 0.15 : 0));
  u.uNight.value = 1 - THREE.MathUtils.smoothstep(elev, -0.12, 0.04);
  u.uCloudTint.value.set(wx.rain ? 0xb4bcc6 : 0xffffff);
  const groundCol = new THREE.Color(v.snowGround ? 0xe9eef3 : v.ground);
  u.uGround.value.copy(groundCol).multiplyScalar(0.25 + 0.3 * dayK);
  // Ground texture & wetness
  const gid = GROUND[scn.id] || 'aerial_sand';
  stage.setGround(gid);
  stage.groundMat.color.set(GROUND_TINT[gid] ?? 0xffffff).multiplyScalar((v.snowGround ? 0.5 + 0.5 * dayK : 0.35 + 0.42 * dayK) * (wx.rain ? 0.62 : 1));
  stage.groundMat.roughness = wx.rain ? 0.32 : v.snowGround ? 0.8 : 0.95;
  stage.groundMat.envMapIntensity = wx.rain ? 1.4 : v.snowGround ? 1.6 : 0.5;
  // Sun / moon light
  const moonDir = new THREE.Vector3(-0.4, 0.75, -0.5).normalize();
  stage.sun.position.copy(night ? moonDir : dir).multiplyScalar(22).add(stage.sun.target.position);
  const lowSun = THREE.MathUtils.clamp(Math.sin(Math.max(elev, 0)) * 2.2, 0, 1);
  stage.sun.intensity = night ? 0.42 : (0.3 + 2.4 * lowSun) * (1 - 0.8 * cloud) * (0.5 + 0.5 * (v.sun ?? 1));
  stage.sun.color.setHSL(night ? 0.6 : 0.08 - 0.02 * lowSun, night ? 0.35 : 0.9 - 0.75 * lowSun, night ? 0.75 : 0.62 + 0.3 * lowSun);
  stage.hemi.intensity = night ? 0.12 : 0.12 + 0.2 * dayK + (v.snowGround ? 0.25 : 0);
  stage.scene.environmentIntensity = night ? 0.55 : 0.42 + 0.3 * dayK + (v.snowGround ? 0.2 : 0);
  stage.renderer.toneMappingExposure = night ? 1.45 : 1.0;
  const fogCol = new THREE.Color().setHSL(0.6, 0.15, 0.08 + 0.55 * dayK);
  if (!night) fogCol.lerp(new THREE.Color(v.horizon), 0.6);
  stage.fog.color.copy(fogCol);
  stage.fog.near = wx.rain ? 18 : 80 - (v.haze ?? 0) * 50;
  stage.fog.far = wx.rain ? 130 : 420 - (v.haze ?? 0) * 250;
  stage.rain.visible = !!wx.rain;
  stage.snow.visible = (wx.snow ?? 0) > 0;
  stage.contact.material.opacity = night ? 0.5 : 0.75 + 0.25 * cloud;
  if (stage.bloomPass) stage.bloomPass.strength = night ? 0.75 : 0.35;
  stage.envDirty = true;
}

export function animatePrecip(stage, dt) {
  stage.skyMat.uniforms.uTime.value += dt;
  if (stage.rain.visible) {
    const a = stage.rain.geometry.attributes.position;
    for (let i = 0; i < a.count; i += 2) {
      let y = a.getY(i) - dt * 15;
      if (y < 0) y += 14;
      a.setY(i, y);
      a.setY(i + 1, y - 0.42);
    }
    a.needsUpdate = true;
  }
  if (stage.snow.visible) {
    const a = stage.snow.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) - dt * 0.9;
      if (y < 0) y += 14;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin(y * 2 + i) * dt * 0.15);
    }
    a.needsUpdate = true;
  }
}
