// Headless drive-world harness for tests: the real Driver and Traffic classes on the real world
// generator, with the renderer, terrain streaming and DOM stubbed out. Not a test file itself.
import * as THREE from 'three';
import { World } from '../../src/world/gen.js';
import { Driver } from '../../src/scene/drive.js';
import { SURFACES } from '../../src/scene/land.js';
import { Traffic } from '../../src/scene/traffic.js';
import * as S from '../../src/sim/traffic.js';

if (!globalThis.window) globalThis.window = { addEventListener() {}, __app: null, devicePixelRatio: 1 };
if (!globalThis.navigator || !globalThis.navigator.getGamepads) Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
if (!globalThis.screen) globalThis.screen = {};

/** flat: a level plain of asphalt, for pure vehicle-physics tests. */
export function makeGame({ seed = 1234, tier = 'high', flat = false, surface = 'asphalt' } = {}) {
  const gen = new World(seed);
  const season = { u: { uNight: { value: 0 }, uWet: { value: 0 }, uIce: { value: 0 } } };
  const terrain = {
    heightAt: (x, z) => (flat ? 0 : gen.heightAt(x, z)),
    roadAt: (x, z) => gen.roadAt(x, z),
    surfaceAt(x, z) {
      if (flat) return { key: surface, ...SURFACES[surface], depth: 0, h: 0, kind: 'road', cls: 'highway' };
      const w = gen.surfaceAt(x, z);
      const out = (key) => ({ key, ...SURFACES[key], depth: w.depth, h: w.h, kind: w.kind, cls: w.cls });
      if (w.kind === 'water') return out(w.depth < 0.55 ? 'shallow' : 'water');
      if (w.kind === 'road') return out(w.cls === 'interstate' || w.cls === 'highway' ? 'asphalt' : w.cls === 'county' ? 'county' : w.cls === 'gravel' ? 'gravel' : 'dirt');
      if (w.kind === 'street') return out('street');
      return out('grass');
    },
    setView() {}, update() {}, towns: null, roadside: null, colliders: [], season, envRoot: new THREE.Group(),
  };
  const stage = { controls: { enabled: true, target: new THREE.Vector3() }, camera: new THREE.PerspectiveCamera(60, 1.6, 0.1, 2000), setYaw() {}, night: false, sunScene: { y: 1 }, onResize() {} };
  const fx = { bursts: [], smoke: 0, crash(...a) { this.bursts.push(a); }, smokeAt() { this.smoke++; }, clear() {} };
  const world = { gen, terrain, vanRoot: new THREE.Group(), stage, fx, body: { parts: { wheels: [] } }, M: { tail: { emissive: { setHex() {} }, emissiveIntensity: 0 } } };
  const D = new Driver(world);
  D.ready = true;
  D.active = true;
  D.refreshColliders = function () {}; // tests set D.colCache themselves
  D.log = [];
  D.onEvent = (k) => D.log.push(k);
  D.impacts = [];
  D.onImpact = (kind, closing) => D.impacts.push([kind, +closing.toFixed(1)]);
  const T = new Traffic(terrain, world, stage);
  T.setQuality(tier);
  world.traffic = T;
  return { gen, terrain, world, D, T, stage };
}

/** One frame: the driver, then the traffic around it. */
export function tick(g, dt = 1 / 60, traffic = true) {
  const { gen, D, T, stage } = g;
  gen.buildEdgesFor(D.x - 1500, D.z - 1500, D.x + 1500, D.z + 1500);
  D.update(dt);
  if (!traffic) return;
  stage.camera.position.set(D.x - 10, 4, D.z);
  stage.camera.lookAt(D.x + 30, 1, D.z);
  stage.camera.updateMatrixWorld();
  stage.camera.matrixWorldInverse.copy(stage.camera.matrixWorld).invert();
  T.update(dt, D);
}

/** Put the van on lane `lat` of an edge at arc length s, heading along +s (dir 1) or −s (dir −1). */
export function placeOnEdge(g, e, s, dir = 1, lat = null) {
  const step = e.len / (e.n - 1);
  const k = Math.min(e.n - 2, Math.floor(s / step)), t = s / step - k;
  const x = e.xs[k] + (e.xs[k + 1] - e.xs[k]) * t, z = e.zs[k] + (e.zs[k + 1] - e.zs[k]) * t;
  const dx = e.xs[k + 1] - e.xs[k], dz = e.zs[k + 1] - e.zs[k], l = Math.hypot(dx, dz);
  const tx = (dx / l) * dir, tz = (dz / l) * dir;
  const off = lat ?? e.P.width * 0.22;
  g.D.place(x - tz * off, z + tx * off, Math.atan2(-tz, tx));
  return { tx, tz };
}

/** Add an AI vehicle to the traffic: kind, speed (m/s), lane index; `dead` makes it brake to a stop. */
export function spawnAI(g, e, s, dir, kind = 'sedan', speed = 0, { lane = 0, dead = false } = {}) {
  const lanes = S.laneLats(e.cls, e.P.width);
  const v = g.T.makeVehicle(e, s, dir, kind, lane, lanes[lane], speed || 25, 1);
  v.v = speed;
  v.dead = dead;
  g.T.vehicles.push(v);
  g.T.populated = true;
  return v;
}

/** First edge of a class (building the roads around the origin first). */
export function findEdge(g, cls, minLen = 0) {
  g.gen.buildEdgesFor(-3500, -3500, 3500, 3500);
  for (const e of g.gen.edges.values()) if (e.cls === cls && e.len > minLen) return e;
  return null;
}

/** A town or city node close to the origin. */
export function findTown(g, range = 3) {
  g.gen.buildEdgesFor(-6000, -6000, 6000, 6000);
  for (let i = -range; i <= range; i++) for (let j = -range; j <= range; j++) {
    const n = g.gen.node(i, j);
    if (n.kind === 'town' || n.kind === 'city') return n;
  }
  return null;
}
