// Renderer, camera, controls, lighting, sky, ground and weather effects.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export function createStage(container, { lite = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(lite ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !lite;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.setSize(container.clientWidth, container.clientHeight);
  labels.domElement.className = 'label-layer';
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.05, 400);
  camera.position.set(8.2, 3.4, 7.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(1.6, 1.3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.4;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.update();

  // Lights
  const hemi = new THREE.HemisphereLight(0xcfe5ff, 0x6b5a45, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.target.position.set(1.5, 1, 0);
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.35);
  fill.position.set(-6, 4, -5);
  scene.add(fill);

  // Interior point lights (switched by the lighting system)
  const interior = [];
  for (const [x, z] of lite ? [] : [[-0.9, 0], [0.3, -0.15], [1.3, 0], [2.35, 0]]) {
    const l = new THREE.PointLight(0xffd6a0, 0, 4.5, 1.6);
    l.position.set(x, 2.45, z);
    scene.add(l);
    interior.push(l);
  }
  const bathLight = new THREE.PointLight(0xfff0dc, 0, 2.2, 1.6);
  bathLight.position.set(0.3, 2.4, 0.45);
  if (!lite) {
    scene.add(bathLight);
    interior.push(bathLight);
  }

  // Sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x8ec5ff) }, horizon: { value: new THREE.Color(0xf3e2c0) }, ground: { value: new THREE.Color(0x9a8f7a) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, ground, clamp(-h*4.0,0.0,1.0)); gl_FragColor = vec4(c,1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat);
  scene.add(sky);

  // Ground with soft radial fade
  const gc = document.createElement('canvas');
  gc.width = gc.height = 512;
  const g2 = gc.getContext('2d');
  const grad = g2.createRadialGradient(256, 256, 30, 256, 256, 256);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.55, '#f2f2f2');
  grad.addColorStop(1, '#d0d0d0');
  g2.fillStyle = grad;
  g2.fillRect(0, 0, 512, 512);
  const r = mulberry(5);
  for (let i = 0; i < 9000; i++) {
    g2.fillStyle = `rgba(${90 + r() * 60},${90 + r() * 60},${80 + r() * 50},${0.05 + r() * 0.08})`;
    g2.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
  }
  const groundTex = new THREE.CanvasTexture(gc);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xa79f86, map: groundTex, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.fog = new THREE.Fog(0xe6e2d3, 40, 160);

  // Precipitation
  const rainN = 3500;
  const rainPos = new Float32Array(rainN * 6);
  for (let i = 0; i < rainN; i++) {
    const x = (Math.random() - 0.5) * 24 + 1.5, y = Math.random() * 12, z = (Math.random() - 0.5) * 24;
    rainPos.set([x, y, z, x + 0.02, y - 0.35, z], i * 6);
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaec6dd, transparent: true, opacity: 0.45 }));
  rain.visible = false;
  rain.frustumCulled = false;
  scene.add(rain);
  const snowN = 2500;
  const snowPos = new Float32Array(snowN * 3);
  for (let i = 0; i < snowN; i++) snowPos.set([(Math.random() - 0.5) * 24 + 1.5, Math.random() * 12, (Math.random() - 0.5) * 24], i * 3);
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
  const dotTex = new THREE.CanvasTexture(dot);
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, map: dotTex, transparent: true, opacity: 0.95, depthWrite: false }));
  snow.visible = false;
  snow.frustumCulled = false;
  scene.add(snow);
  // Stars
  const starPos = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    const v = new THREE.Vector3().randomDirection();
    v.y = Math.abs(v.y) * 0.9 + 0.1;
    v.normalize().multiplyScalar(170);
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, map: dotTex, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(stars);

  const stage = { renderer, labels, scene, camera, controls, hemi, sun, fill, interior, bathLight, sky, skyMat, ground, groundMat, rain, snow, stars };
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
  };
  stage.onResize = onResize;
  requestAnimationFrame(onResize);
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe(container);
  return stage;
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Apply a scenario's weather & the time of day to the stage. */
export function applyWeather(stage, scn, wx, hour) {
  const v = scn.visuals;
  const dayFrac = wx.sunAlt;
  const night = dayFrac <= 0.02;
  const top = new THREE.Color(v.sky), hor = new THREE.Color(v.horizon);
  const nightTop = new THREE.Color(0x0b1326), nightHor = new THREE.Color(0x26324a);
  const k = Math.min(1, dayFrac * 3);
  stage.skyMat.uniforms.top.value.copy(nightTop).lerp(top, k);
  stage.skyMat.uniforms.horizon.value.copy(nightHor).lerp(hor, k);
  // dusk warmth
  if (dayFrac > 0 && dayFrac < 0.25) stage.skyMat.uniforms.horizon.value.lerp(new THREE.Color(0xffa66b), (0.25 - dayFrac) * 2.2);
  const groundCol = v.snowGround ? new THREE.Color(0xf2f5f8) : new THREE.Color(v.ground);
  if (wx.rain) groundCol.multiplyScalar(0.7);
  stage.groundMat.color.copy(groundCol).multiplyScalar(0.45 + 0.55 * k);
  stage.groundMat.roughness = wx.rain ? 0.35 : 0.95;
  // Sun path: rises in the east (+z side), sets in the west, southern sky (−x)
  const t = (hour - wx.sunrise) / (wx.sunset - wx.sunrise);
  const az = Math.PI * Math.min(1, Math.max(0, t));
  const elev = Math.max(0.05, dayFrac) * (scn.id === 'winter' ? 0.55 : 1.1);
  const dir = new THREE.Vector3(-Math.sin(az) * 0.6 - 0.3, Math.sin(elev) * 1.0 + 0.05, Math.cos(az));
  stage.sun.position.copy(dir.normalize().multiplyScalar(18)).add(new THREE.Vector3(1.5, 0, 0));
  const cloud = wx.cloud ?? 0;
  stage.sun.intensity = night ? 0.12 : (0.6 + 2.4 * dayFrac) * (1 - 0.75 * cloud) * v.sun;
  stage.sun.color.set(night ? 0x9fb3d9 : dayFrac < 0.25 ? 0xffc48a : 0xfff2e0);
  if (night) stage.sun.position.set(-8, 14, -6);
  stage.hemi.intensity = night ? 0.18 : 0.35 + 0.65 * k * (1 - 0.3 * cloud);
  stage.hemi.color.copy(stage.skyMat.uniforms.top.value);
  stage.scene.environmentIntensity = night ? 0.12 : 0.25 + 0.35 * k;
  stage.renderer.toneMappingExposure = night ? 1.15 : 1.0;
  stage.scene.fog.color.copy(stage.skyMat.uniforms.horizon.value);
  stage.scene.fog.near = 20 - v.haze * 15;
  stage.scene.fog.far = 160 - v.haze * 110 - (wx.rain ? 40 : 0);
  stage.rain.visible = !!wx.rain;
  stage.snow.visible = (wx.snow ?? 0) > 0;
  stage.stars.material.opacity = night ? 0.9 : 0;
}

export function animatePrecip(stage, dt) {
  if (stage.rain.visible) {
    const a = stage.rain.geometry.attributes.position;
    for (let i = 0; i < a.count; i += 2) {
      let y = a.getY(i) - dt * 14;
      if (y < 0) y += 12;
      a.setY(i, y);
      a.setY(i + 1, y - 0.35);
    }
    a.needsUpdate = true;
  }
  if (stage.snow.visible) {
    const a = stage.snow.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) - dt * 0.9;
      if (y < 0) y += 12;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin(y * 2 + i) * dt * 0.15);
    }
    a.needsUpdate = true;
  }
}
