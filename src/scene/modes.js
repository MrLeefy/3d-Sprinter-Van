// View-mode & focus styling, exploded view, cutaway clipping, selection and picking.
import * as THREE from 'three';
import { byId } from '../data/components.js';
import { copyPatch } from './bodyShell.js';

export const SIM_FOCUS = {
  none: null,
  thermal: { systems: ['climate', 'envelope'], ids: ['window-covers', 'insulation', 'slideout-pod', 'fresh-tank', 'grey-tank', 'smoke-co-alarm', 'co-alarm-bed', 'fan-main', 'fan-bath'], routes: ['air'] },
  electrical: { systems: ['electrical'], ids: ['rooftop-ac', 'cooktop', 'microwave', 'fridge', 'combi-heater', 'water-pump', 'fan-main', 'fan-bath', 'range-hood', 'fresh-air-inlet', 'emergency-stop', 'main-fuse', 'slideout-pod', 'starter-battery', 'grey-tank', 'toilet', 'outdoor-kitchen'], routes: ['electrical'] },
  water: { systems: ['water'], ids: ['combi-heater', 'sink', 'drinking-filter', 'grey-tank', 'fuel-tank', 'heater-fuel-pump'], routes: ['water'] },
  ventilation: { systems: ['ventilation'], ids: ['rooftop-ac', 'ac-plenum', 'ac-duct', 'combi-heater', 'combi-cowl', 'cooktop', 'wetbath', 'shower-pan', 'toilet'], routes: ['air'] },
  mechanical: { systems: ['mechanical'], ids: ['seat-driver', 'seat-passenger', 'lagun-table', 'mattress', 'bed-platform', 'bed-step', 'galley-drawers', 'fridge', 'microwave', 'prep-board', 'sink', 'trash-bins', 'toilet', 'wetbath', 'laundry', 'wardrobe', 'tower', 'oh-galley-1', 'oh-galley-2', 'oh-galley-3', 'oh-bed-pass', 'oh-bed-drv', 'window-covers', 'outdoor-kitchen', 'outdoor-shower'], routes: [] },
  living: null,
  resources: null,
};

export class Modes {
  constructor(stage, M, body, comps, systems, viz, person) {
    Object.assign(this, { stage, M, body, comps, systems, viz, person });
    this.planes = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0.55), new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.45)];
    this.cutMats = new Map();
    this.explode = 0;
    this.explodeTarget = 0;
    this.view = 'normal';
    this.sim = 'none';
    this.cut = { type: 'dollhouse', z: 0.55, y: 2.45 };
    this.showServices = false;
    // wrap body children so they can be exploded independently of their animations
    const kids = [...body.root.children];
    for (const k of kids) {
      const w = new THREE.Group();
      body.root.add(w);
      w.add(k);
      const box = new THREE.Box3().setFromObject(k);
      const c = box.getCenter(new THREE.Vector3());
      w.userData.explode = bodyExplode(c, k);
    }
    for (const [id, g] of comps.index) g.userData.explode = compExplode(byId[id]);
    // remember original materials
    const remember = (o) =>
      o.traverse((m) => {
        if (m.isMesh && !m.userData.origMat) m.userData.origMat = m.material;
      });
    remember(body.root);
    remember(comps.root);
    remember(systems.root);
    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffd43b);
    this.selBox.visible = false;
    this.selBox.renderOrder = 10;
    this.selBox.material.depthTest = false;
    this.selBox.material.transparent = true;
    stage.scene.add(this.selBox);
    this.selection = null;
    this.activeAct = null;
    this.related = new Set();
  }

  cutMat(orig) {
    if (!this.cutMats.has(orig)) {
      const m = copyPatch(orig, orig.clone());
      m.clippingPlanes = this.planes;
      m.clipIntersection = false;
      m.side = THREE.DoubleSide;
      this.cutMats.set(orig, m);
    }
    return this.cutMats.get(orig);
  }

  setCut(type, z, y) {
    this.cut = { type, z, y };
    this.planes[0].constant = type === 'roof' ? 99 : z;
    this.planes[1].constant = type === 'side' ? 99 : y;
  }

  /** Apply styles for the current view/sim/selection. */
  apply() {
    const { M } = this;
    const view = this.view;
    const focus = SIM_FOCUS[this.sim];
    const xray = view === 'xray' || (focus && view !== 'cutaway');
    const cut = view === 'cutaway';
    this.setCut(this.cut.type, this.cut.z, this.cut.y);
    this.explodeTarget = view === 'exploded' ? 1 : 0;
    // Body
    this.body.root.traverse((m) => {
      if (!m.isMesh) return;
      const kind = m.userData.kind;
      const orig = m.userData.origMat;
      m.visible = true;
      if (kind === 'insulation') {
        m.visible = this.sim === 'thermal' || view === 'exploded';
        m.material = cut ? this.cutMat(orig) : orig;
        return;
      }
      if (kind === 'component') {
        const cid = m.userData.cid;
        const inF = !focus || focus.ids.includes(cid) || focus.systems.includes(byId[cid]?.system);
        m.material = inF ? orig : M.ghost;
        return;
      }
      if (kind === 'wheel' || kind === 'chassis') {
        m.material = orig;
        return;
      }
      if (kind === 'rack') {
        m.material = xray && focus ? M.ghost : orig;
        return;
      }
      if (kind === 'glass') {
        if (m.userData.bodyGlass && xray) m.visible = false;
        m.material = cut ? this.cutMat(orig) : xray ? M.glassClear : orig;
        return;
      }
      if (kind === 'lining') {
        if (xray) m.visible = m.userData.cid === 'insulation' && m.position.y < 0.75;
        m.material = cut ? this.cutMat(orig) : orig;
        if (xray && m.visible) m.material = focus ? M.ghost : orig;
        return;
      }
      // painted shell
      m.material = cut ? this.cutMat(orig) : xray ? M.xrayBody : orig;
    });
    // Components
    for (const [id, g] of this.comps.index) {
      const inFocus = !focus || focus.systems.includes(byId[id].system) || focus.ids.includes(id) || this.related.has(id);
      const ghost = focus && !inFocus;
      g.traverse((m) => {
        if (!m.isMesh) return;
        m.material = ghost ? M.ghost : m.userData.origMat;
      });
      if (id === 'window-covers' || id === 'insulation' || id === 'lighting') continue;
    }
    // Systems
    const routes = focus?.routes || [];
    const showAll = view === 'xray' || view === 'cutaway' || this.showServices;
    for (const [k, g] of Object.entries(this.systems.groups)) {
      g.visible = view !== 'exploded' && (routes.includes(k) || (showAll && !focus));
    }
    // Occupant keeps its own materials (restored here after the infrared view)
    this.person.root.traverse((m) => {
      if (!m.isMesh) return;
      if (!m.userData.origMat) m.userData.origMat = m.material;
      m.material = m.userData.origMat;
    });
    if (this.ir && this.infrared) this.infrared.applyMaterials(cut);
    this.viz.thermal.visible = this.sim === 'thermal';
    this.viz.setMechVisible(this.sim === 'mechanical', this.activeAct);
    this.person.root.visible = this.person.root.visible && this.sim === 'living';
  }

  setSelection(id) {
    this.selection = id;
    this.related = new Set();
    if (id && byId[id]) {
      for (const d of byId[id].depends || []) this.related.add(d);
      for (const c of Object.values(byId)) if ((c.depends || []).includes(id)) this.related.add(c.id);
    }
    this.updateSelBox();
  }

  updateSelBox() {
    const g = this.selection && this.comps.index.get(this.selection);
    if (!g) {
      this.selBox.visible = false;
      return;
    }
    const b = new THREE.Box3().setFromObject(g);
    if (b.isEmpty()) {
      const c = byId[this.selection];
      b.set(new THREE.Vector3(c.box.x[0], c.box.y[0], c.box.z[0]), new THREE.Vector3(c.box.x[1], c.box.y[1], c.box.z[1]));
    }
    b.expandByScalar(0.01);
    this.selBox.box.copy(b);
    this.selBox.visible = true;
  }

  tick(dt) {
    const k = 1 - Math.exp(-dt * 4);
    this.explode += (this.explodeTarget - this.explode) * k;
    if (Math.abs(this.explode - this.explodeTarget) < 1e-3) this.explode = this.explodeTarget;
    const e = this.explode;
    for (const w of this.body.root.children) if (w.userData.explode) w.position.copy(w.userData.explode).multiplyScalar(e);
    for (const g of this.comps.index.values()) if (g.userData.explode) g.position.copy(g.userData.explode).multiplyScalar(e);
    if (this.selection) {
      this.updateSelBox();
      this.selBox.material.opacity = 0.65 + 0.35 * Math.sin(performance.now() / 180);
    }
  }

  /** Raycast pick: returns { cid, kind, point, feature } */
  pick(raycaster) {
    const targets = [this.comps.root, this.person.root, this.viz.mech];
    const throughBody = this.view !== 'normal' || SIM_FOCUS[this.sim];
    if (!throughBody) targets.unshift(this.body.root);
    if (Object.values(this.systems.groups).some((g) => g.visible)) targets.push(this.systems.root);
    const hits = raycaster.intersectObjects(targets, true);
    const visibleChain = (o) => {
      while (o) {
        if (!o.visible) return false;
        o = o.parent;
      }
      return true;
    };
    let ghostHit = null;
    for (const h of hits) {
      const o = h.object;
      if (!visibleChain(o)) continue;
      if (o.material?.clippingPlanes?.length && this.view === 'cutaway') {
        const p = h.point;
        if (this.planes.some((pl) => pl.distanceToPoint(p) < 0)) continue;
      }
      if (o.userData.kind === 'feature') return { feature: o.userData.feature, point: h.point };
      const cid = o.userData.cid;
      if (!cid) continue;
      if (o.material === this.M.ghost) {
        if (!ghostHit) ghostHit = { cid, kind: o.userData.kind, point: h.point, route: o.userData.route };
        continue;
      }
      return { cid, kind: o.userData.kind, point: h.point, route: o.userData.route, object: o, face: h.face };
    }
    return ghostHit;
  }
}

function bodyExplode(c, obj) {
  const v = new THREE.Vector3();
  const k = obj.userData?.kind;
  if (obj.userData?.explodeDir) return v.fromArray(obj.userData.explodeDir);
  if (c.y > 2.62) v.set(0, 1.5, 0);
  else if (c.z > 0.62) v.set(0, 0, 1.35);
  else if (c.z < -0.62) v.set(0, 0, -1.35);
  else if (c.x < -1.5) v.set(-1.3, 0, 0);
  else if (c.x > 3.9) v.set(1.3, 0, 0);
  else if (c.y < 0.6 && k !== 'lining') v.set(0, -0.8, 0);
  if (k === 'lining' || k === 'insulation') v.multiplyScalar(0.55);
  return v;
}

function compExplode(c) {
  const v = new THREE.Vector3();
  if (!c) return v;
  if (c.placement === 'roof' || c.placement === 'through-roof') v.set(0, 2.1, 0);
  else if (c.placement === 'underbody') v.set(0, -0.95, 0);
  else if (c.zone === 'exterior') v.set(0, 0.6, 1.9);
  else if (c.zone === 'garage') v.set(-0.9, -0.15, 0);
  else if (c.zone === 'bed') v.set(-0.4, 0.7, 0);
  else if (c.zone === 'galley') v.set(0, 0.2, -0.75);
  else if (c.zone === 'tower') v.set(0, 0.2, -0.8);
  else if (c.zone === 'wardrobe') v.set(0, 0.2, 0.75);
  else if (c.zone === 'wetbath') v.set(0, 0.3, 0.9);
  else if (c.zone === 'cab') v.set(1.0, 0.0, 0);
  else if (c.zone === 'dinette') v.set(0.6, 0.3, 0);
  else if (c.zone === 'aisle') v.set(0, 1.0, 0);
  if (c.id === 'slideout-pod') v.set(-0.4, 0.7, -1.2);
  if (c.id === 'combi-cowl') v.set(-0.9, -0.15, 1.2);
  if (c.id === 'shore-inlet') v.set(-0.9, -0.15, -1.2);
  return v;
}
