// First-person walk-through: eye height of a 1.75 m adult, drag to look, WASD / arrows / on-screen
// pad to move. Collisions come straight from the component catalogue (every furniture box that
// reaches into body height) plus the finished wall planes, so the walk respects the real aisle.
import * as THREE from 'three';
import { COMPONENTS } from '../data/components.js';
import { INTERIOR } from '../data/vehicle.js';

const EYE = 1.63; // above the finished floor
const R = 0.16; // body radius
const SPEED = 1.1; // m/s
const SKIP = new Set(['insulation', 'window-covers', 'lighting', 'ac-duct', 'smoke-co-alarm', 'fan-main', 'fan-bath', 'lagun-table', 'roof-rack', 'awning',
  'sliding-door', 'rear-doors', 'co-alarm-bed', 'control-panel', 'cerbo-gx', 'emergency-stop', 'fresh-air-inlet', 'outlets-galley', 'outlets-bed', 'outlets-dinette',
  'range-hood', 'oh-galley-1', 'oh-galley-2', 'oh-galley-3', 'oh-bed-pass', 'oh-bed-drv', 'extinguisher-galley', 'extinguisher-bed', 'fire-blanket', 'ac-plenum']);

export class Walker {
  constructor(world) {
    this.world = world;
    this.on = false;
    this.pos = new THREE.Vector3(2.35, INTERIOR.floorY, 0.1);
    this.yaw = Math.PI / 2; // looking towards the rear (−x)
    this.pitch = -0.08;
    this.keys = new Set();
    this.pad = { f: 0, s: 0, t: 0 };
    this.bob = 0;
    const y0 = INTERIOR.floorY + 0.12, y1 = INTERIOR.floorY + EYE + 0.1;
    this.boxes = COMPONENTS.filter((c) => c.box && !SKIP.has(c.id) && !['roof', 'underbody', 'through-roof'].includes(c.placement) && c.zone !== 'exterior' && c.box.y[0] < y1 && c.box.y[1] > y0)
      .map((c) => ({ id: c.id, x0: c.box.x[0] - R, x1: c.box.x[1] + R, z0: c.box.z[0] - R, z1: c.box.z[1] + R }));
    this.onKey = (e) => {
      if (!this.on || e.target.closest?.('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        if (e.type === 'keydown') this.keys.add(k);
        else this.keys.delete(k);
        e.preventDefault();
      } else if (k === 'f' && e.type === 'keydown' && !e.repeat) {
        e.preventDefault();
        this.onInteract?.();
      }
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    const dom = world.stage.renderer.domElement;
    let drag = null;
    dom.addEventListener('pointerdown', (e) => {
      if (!this.on) return;
      drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch };
      dom.setPointerCapture?.(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.on || !drag) return;
      const k = 0.0042;
      this.yaw = drag.yaw + (e.clientX - drag.x) * k;
      this.pitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * k, -1.2, 1.1);
    });
    const end = () => (drag = null);
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => {
      if (!this.on) return;
      e.preventDefault();
      this.tryMove(-Math.sign(e.deltaY) * 0.12, 0);
    }, { passive: false });
  }

  blocked(x, z) {
    const I = INTERIOR;
    const vals = this.world.rig?.values || {};
    const doorOpen = (vals.slidingDoor ?? 0) > 0.6;
    const bathOpen = (vals.wetbathDoor ?? 0) > 0.6;
    const inDoorway = doorOpen && x > 1.58 && x < 2.52 && z > I.wallZ - R && z < 1.25;
    const insideShell = x >= I.x0 + R && x <= 2.95 && Math.abs(z) <= I.wallZ - R;
    if (!insideShell && !inDoorway) {
      // Outside on the campsite ground: allow walking around the van if the sliding door is open (or already outside)
      if (!doorOpen && Math.abs(this.pos.z) <= I.wallZ) return true;
      if (x < -5.5 || x > 8.0 || z < -5.0 || z > 5.5) return true;
      // Outer van body footprint
      if (x > -1.85 && x < 5.45 && Math.abs(z) < 1.18) return true;
      // Deployed outdoor kitchen block
      if ((vals.outdoorKitchen ?? 0) > 0.3 && x > -2.75 && x < -1.55 && z > 0.05 && z < 0.95) return true;
      return false;
    }
    for (const b of this.boxes) {
      if (b.id === 'wetbath' && bathOpen && x > -0.02 && x < 0.48 && z > 0.0 && z < 0.71) continue;
      if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return true;
    }
    return false;
  }

  /** Move by (forward, strafe) metres in the look direction, sliding along obstacles. */
  tryMove(f, s) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const dx = fx * f + -fz * s, dz = fz * f + fx * s;
    const p = this.pos;
    if (!this.blocked(p.x + dx, p.z)) p.x += dx;
    if (!this.blocked(p.x, p.z + dz)) p.z += dz;
    return Math.hypot(dx, dz);
  }

  enter(at) {
    const st = this.world.stage;
    this.saved = { p: st.camera.position.clone(), t: st.controls.target.clone() };
    this.on = true;
    this.world.camTween = null;
    st.controls.enabled = false;
    if (at) {
      this.pos.set(at.x, INTERIOR.floorY, at.z);
      this.yaw = at.yaw ?? this.yaw;
    }
    if (this.blocked(this.pos.x, this.pos.z)) this.pos.set(2.35, INTERIOR.floorY, 0.1);
  }

  exit() {
    const st = this.world.stage;
    this.on = false;
    this.keys.clear();
    st.controls.enabled = true;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    st.controls.target.copy(st.camera.position).addScaledVector(fwd, 0.8);
  }

  update(dt) {
    if (!this.on) return;
    const k = this.keys;
    let f = this.pad.f, s = this.pad.s, t = this.pad.t;
    if (k.has('w') || k.has('arrowup')) f += 1;
    if (k.has('s') || k.has('arrowdown')) f -= 1;
    if (k.has('a')) s -= 1;
    if (k.has('d')) s += 1;
    if (k.has('arrowleft') || k.has('q')) t += 1;
    if (k.has('arrowright') || k.has('e')) t -= 1;
    this.yaw += t * 1.6 * dt;
    const moved = f || s ? this.tryMove(f * SPEED * dt, s * SPEED * dt * 0.8) : 0;
    this.bob += moved * 9;
    // Floor height: transition smoothly down the entry step when stepping outside the sliding door
    const inside = this.pos.x >= INTERIOR.x0 && this.pos.x <= 3.05 && Math.abs(this.pos.z) <= 0.92;
    const targetY = inside ? INTERIOR.floorY : this.pos.z < 1.18 && this.pos.x > 1.5 && this.pos.x < 2.6 ? INTERIOR.floorY * 0.5 : 0;
    this.pos.y += (targetY - this.pos.y) * Math.min(1, dt * 10);
    const cam = this.world.stage.camera;
    // the van may sit on a slope: walk on its floor, keep the horizon level
    this.world.vanRoot.updateMatrixWorld();
    cam.position.copy(this.world.vanRoot.localToWorld(new THREE.Vector3(this.pos.x, this.pos.y + EYE + Math.sin(this.bob) * 0.012, this.pos.z)));
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  }
}
