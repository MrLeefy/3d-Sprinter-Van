// Shared builder infrastructure: the animation rig and tagging helpers.
import * as THREE from 'three';

export class Rig {
  constructor() {
    this.handlers = new Map(); // actuator id → [fn(v, values)]
    this.frame = []; // per-frame fns (dt, sim, t)
    this.values = {};
  }
  on(act, fn) {
    if (!this.handlers.has(act)) this.handlers.set(act, []);
    this.handlers.get(act).push(fn);
  }
  each(fn) {
    this.frame.push(fn);
  }
  apply(values) {
    this.values = values;
    for (const [act, fns] of this.handlers) {
      const v = values[act] ?? 0;
      for (const f of fns) f(v, values);
    }
  }
  tick(dt, sim, t) {
    for (const f of this.frame) f(dt, sim, t);
  }
}

/** Tag every mesh in an object with a component id for picking & mode styling. */
export function tagAll(obj, cid, kind = 'component') {
  obj.traverse((m) => {
    if (m.isMesh || m.isLine || m.isPoints) {
      if (!m.userData.cid) m.userData.cid = cid;
      if (!m.userData.kind) m.userData.kind = kind;
    }
  });
  return obj;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const seg = (v, a, b) => clamp01((v - a) / (b - a));

export function group(...children) {
  const g = new THREE.Group();
  for (const c of children) if (c) g.add(c);
  return g;
}
