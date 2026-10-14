// Visual semi rig for drive mode: sleeper tractor, articulated trailer (any of six types), spinning
// and steering wheels, cab interior with a live instrument cluster, headlights and lamp glow.
// Positions are in the floating-origin scene frame (tractor reference point at the origin, +x
// forward, +z right); `update` takes the physics rig and the terrain and poses everything.
import * as THREE from 'three';
import { buildCabInterior, buildTractor, buildTrailer, TRACTOR, TRAILER, vehicleMaterial } from './vehicles.js';
import { SPEC } from '../sim/truck.js';

const CAB = { eye: [2.72, 2.62, -0.55] };

export class TruckRig {
  constructor(world) {
    this.world = world;
    const atlas = world.land.towns.atlas;
    this.atlas = atlas;
    this.root = new THREE.Group();
    this.root.name = 'semi';
    this.root.visible = false;
    world.stage.scene.add(this.root);
    // tractor
    this.tractorModel = buildTractor({ sleeper: true });
    this.tractorMat = vehicleMaterial(world.terrain.season, atlas);
    this.tractor = new THREE.Group();
    this.root.add(this.tractor);
    const body = new THREE.Mesh(this.tractorModel.geo, this.tractorMat);
    body.castShadow = body.receiveShadow = true;
    this.tractor.add(body);
    this.tWheels = this.addWheels(this.tractor, this.tractorModel, this.tractorMat);
    // cab interior (only shown from the cockpit camera) and its steering wheel and gauges
    const cab = buildCabInterior();
    this.cabMat = vehicleMaterial(world.terrain.season, atlas);
    this.cabMat.userData.uTint.value.setRGB(1, 1, 1);
    this.interior = new THREE.Group();
    this.interior.visible = false;
    this.interior.add(new THREE.Mesh(cab.geo, this.cabMat));
    this.wheelPivot = new THREE.Group();
    this.wheelPivot.position.set(...cab.wheelPos);
    this.wheelPivot.rotation.z = cab.wheelTilt;
    this.wheelSpin = new THREE.Group();
    this.wheelSpin.add(new THREE.Mesh(cab.wheelGeo, this.cabMat));
    this.wheelPivot.add(this.wheelSpin);
    this.interior.add(this.wheelPivot);
    this.buildGauge(cab.gauge);
    this.tractor.add(this.interior);
    // headlights, parked on the tractor
    this.beams = [];
    for (const s of [-1, 1]) {
      const l = new THREE.SpotLight(0xfff1dc, 0, 95, 0.4, 0.55, 1.1);
      l.position.set(7.0, 1.0, s * 0.85);
      l.target.position.set(32, -0.4, s * 1.8);
      this.tractor.add(l, l.target);
      this.beams.push(l);
    }
    // trailer
    this.trailerYaw = new THREE.Group();
    this.trailerTilt = new THREE.Group();
    this.trailerYaw.add(this.trailerTilt);
    this.root.add(this.trailerYaw);
    this.trailerMat = vehicleMaterial(world.terrain.season, atlas);
    this.trailerKey = null;
    this.trailerMesh = null;
    this.tintT = new THREE.Color(1, 1, 1);
    this.gaugeT = 0;
    this.shake = 0;
  }

  /** Wheel holders: steer pivot → spin pivot → mesh (mirrored on the left). */
  addWheels(parent, model, mat) {
    const list = [];
    for (const w of model.wheels) {
      const hold = new THREE.Group();
      hold.position.set(w.x, w.y, w.z);
      const spin = new THREE.Group();
      const m = new THREE.Mesh(model.wheelGeo, mat);
      if (w.side < 0) m.rotation.y = Math.PI;
      m.castShadow = true;
      spin.add(m);
      hold.add(spin);
      parent.add(hold);
      list.push({ hold, spin, w });
    }
    return list;
  }

  buildGauge(q) {
    const cv = (this.gaugeCv = document.createElement('canvas'));
    cv.width = 512;
    cv.height = 256;
    this.gaugeCtx = cv.getContext('2d');
    this.gaugeTex = new THREE.CanvasTexture(cv);
    this.gaugeTex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.BufferGeometry();
    const p = [...q.a, ...q.b, ...q.c, ...q.a, ...q.c, ...q.d];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.gaugeTex, toneMapped: false, side: THREE.DoubleSide }));
    this.interior.add(mesh);
  }

  drawGauge(rig, kmh, units) {
    const g = this.gaugeCtx, W = 512, H = 256;
    g.fillStyle = '#05080b';
    g.fillRect(0, 0, W, H);
    const dial = (cx, cy, r, f, label, warn) => {
      g.lineWidth = 12;
      g.strokeStyle = '#1a232b';
      g.beginPath();
      g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
      g.stroke();
      g.strokeStyle = warn ? '#ff5b4a' : '#7fd7ff';
      g.beginPath();
      g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * Math.max(0, Math.min(1, f))));
      g.stroke();
      g.fillStyle = '#9fb3c0';
      g.font = '600 20px system-ui';
      g.textAlign = 'center';
      g.fillText(label, cx, cy + r + 8);
    };
    dial(110, 118, 82, rig.rpm / 2200, 'RPM ×100', rig.rpm > 2000);
    dial(402, 118, 82, kmh / 120, units === 'mph' ? 'MPH' : 'KM/H', false);
    g.fillStyle = '#e8f4ff';
    g.font = '700 54px system-ui';
    g.textAlign = 'center';
    g.fillText(String(Math.round(units === 'mph' ? kmh * 0.621371 : kmh)), 402, 132);
    g.font = '700 40px system-ui';
    g.fillText(String(Math.round(rig.rpm / 100)), 110, 130);
    g.fillStyle = '#ffd36b';
    g.font = '700 40px system-ui';
    g.fillText(rig.gear < 0 ? 'R' : rig.gear === 0 ? 'N' : String(rig.gear), 256, 70);
    // air pressure and fuel bars
    const bar = (x, f, col, label) => {
      g.fillStyle = '#1a232b';
      g.fillRect(x, 150, 90, 12);
      g.fillStyle = col;
      g.fillRect(x, 150, 90 * Math.max(0, Math.min(1, f)), 12);
      g.fillStyle = '#9fb3c0';
      g.font = '600 18px system-ui';
      g.fillText(label, x + 45, 184);
    };
    bar(211, rig.air / 125, rig.air < 70 ? '#ff5b4a' : '#7fd7ff', 'AIR');
    g.fillStyle = '#1a232b';
    g.fillRect(211, 200, 90, 12);
    g.fillStyle = rig.fuel / SPEC.fuelTank < 0.15 ? '#ff5b4a' : '#ffb347';
    g.fillRect(211, 200, 90 * Math.max(0, Math.min(1, rig.fuel / SPEC.fuelTank)), 12);
    g.fillStyle = '#9fb3c0';
    g.font = '600 18px system-ui';
    g.fillText('FUEL', 256, 234);
    this.gaugeTex.needsUpdate = true;
  }

  /** (Re)build the trailer for a type/cargo; cached per key so switching is cheap. */
  setTrailer(type, { name = 'BIG SKY FREIGHT', style = 2, cargo = 'lumber' } = {}) {
    const key = `${type}|${name}|${style}|${cargo}`;
    this.hasTrailer = type !== 'none';
    this.trailerYaw.visible = this.hasTrailer;
    if (!this.hasTrailer || key === this.trailerKey) return;
    this.trailerKey = key;
    if (this.trailerMesh) {
      this.trailerTilt.clear();
      this.trailerMesh = null;
      this.tWheelsT?.length && (this.tWheelsT.length = 0);
    }
    const decal = (text, st) => this.atlas.slot(text, st);
    const model = (this.trailerModel = buildTrailer(type, { decal, name, style, cargo }));
    const mesh = new THREE.Mesh(model.geo, this.trailerMat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.trailerTilt.add(mesh);
    this.trailerMesh = mesh;
    this.tWheelsT = this.addWheels(this.trailerTilt, model, this.trailerMat);
  }

  setTint(tractor, trailer) {
    this.tractorMat.userData.uTint.value.setRGB(...tractor);
    this.trailerMat.userData.uTint.value.setRGB(...trailer);
  }

  /**
   * Pose the rig. D = driver (x, z, yaw, spin, delta, pitch/roll offsets), rig = physics rig, T = terrain.
   * `hGround` is the terrain height the land is shifted by (so scene y = world height − hGround).
   */
  update(dt, D, rig, T, hGround, opts = {}) {
    const { cockpit = false, lights = {}, units = 'mph', rolled = 0 } = opts;
    const c = Math.cos(D.yaw), s = Math.sin(D.yaw);
    this.root.visible = true;
    this.interior.visible = cockpit;
    this.tractor.position.set(0, D.dyn.h, 0);
    this.tractor.rotation.set(D.roll + D.dyn.r + rolled, 0, D.pitch + D.dyn.p, 'XZY');
    for (const q of this.tWheels) {
      q.spin.rotation.z = -D.spin;
      if (q.w.steer) q.hold.rotation.y = rig.delta;
    }
    // steering wheel (≈ 3 turns lock to lock)
    this.wheelSpin.rotation.x = -(rig.delta / SPEC.maxSteer) * Math.PI * 1.5;
    // lamps
    const u = this.tractorMat.userData.uLamp.value;
    const head = lights.head ? 1 : 0, tail = lights.brake ? 2.6 : head ? 0.7 : 0.08;
    u.set(head, tail, lights.brake ? 1 : 0, 0);
    this.cabMat.userData.uLamp.value.set(0, 0, 0, 0);
    for (const b of this.beams) b.intensity = head ? 46 : 0;
    // trailer
    if (this.hasTrailer && this.trailerMesh) {
      const g = rig.geometry(D.x, D.z);
      const to = (wx, wz) => {
        const dx = wx - D.x, dz = wz - D.z;
        return [dx * c - dz * s, dx * s + dz * c];
      };
      const [kx, kz] = to(g.kx, g.kz);
      const hK = T.heightAt(g.kx, g.kz), hT = T.heightAt(g.tx, g.tz);
      const phi = rig.thetaT - rig.theta;
      // roll from the heights either side of the trailer's tandem
      const hx = Math.cos(rig.thetaT), hz = -Math.sin(rig.thetaT);
      const lx = g.tx + hz * 1.3, lz = g.tz + hx * 1.3, rx = g.tx - hz * 1.3, rz = g.tz - hx * 1.3;
      const roll = -Math.atan2(T.heightAt(lx, lz) - T.heightAt(rx, rz), 2.6);
      this.trailerYaw.position.set(kx, hK - hGround + D.dyn.h * 0.5, kz);
      this.trailerYaw.rotation.set(0, phi, 0);
      this.trailerTilt.rotation.set(roll, 0, Math.atan2(hK - hT, SPEC.kingToAxle), 'XZY');
      if (rolled) this.trailerTilt.rotation.x += rolled;
      for (const q of this.tWheelsT) q.spin.rotation.z = -D.spin;
      const tu = this.trailerMat.userData.uLamp.value;
      tu.set(0, tail, lights.brake ? 1 : 0, 0);
    }
    if (cockpit) {
      this.gaugeT -= dt;
      if (this.gaugeT <= 0) {
        this.gaugeT = 0.1;
        this.drawGauge(rig, Math.abs(rig.v) * 3.6, units);
      }
    }
  }

  hide() {
    this.root.visible = false;
    for (const b of this.beams) b.intensity = 0;
  }
}

export { CAB, TRACTOR, TRAILER };
