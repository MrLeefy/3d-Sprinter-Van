// Builds every catalogued component into the scene and indexes the meshes.
import * as THREE from 'three';
import { COMPONENTS, SYSTEMS } from '../data/components.js';
import { boxMesh } from './geom.js';
import { systemMaterial } from './materials.js';
import { tagAll } from './builders/common.js';
import { rearBuilders } from './builders/rear.js';
import { galleyBuilders } from './builders/galley.js';
import { cabRoofBuilders } from './builders/cabroof.js';

const BUILDERS = { ...rearBuilders, ...galleyBuilders, ...cabRoofBuilders };

export function buildComponents(ctx) {
  const root = new THREE.Group();
  root.name = 'components';
  const index = new Map();
  for (const c of COMPONENTS) {
    const fn = BUILDERS[c.id];
    let obj;
    try {
      obj = fn ? fn(c, ctx) : boxMesh(c.box, systemMaterial(SYSTEMS[c.system]?.color || '#888', { emissive: 0.05 }), 0.01);
    } catch (e) {
      console.error('builder failed', c.id, e);
      obj = boxMesh(c.box, systemMaterial('#ff00ff'), 0.01);
    }
    const g = new THREE.Group();
    g.name = c.id;
    g.add(obj);
    tagAll(g, c.id, 'component');
    g.userData.cid = c.id;
    g.userData.system = c.system;
    g.userData.zone = c.zone;
    root.add(g);
    index.set(c.id, g);
  }
  // Rear-door attachments were parented to the door groups; tag them too
  return { root, index };
}
