// Stylised occupant used by Daily-living mode. Faces +x in its local frame.
import * as THREE from 'three';

const ANCHORS = {
  bed: { p: [-0.95, 1.8, 0.0], lie: true },
  lounge: { p: [-0.72, 1.86, 0.3], yaw: 0 },
  aisleRear: { p: [0.25, 1.65, -0.18], yaw: 0 },
  galley: { p: [1.45, 1.65, 0.02], yaw: Math.PI / 2 },
  sink: { p: [1.9, 1.65, 0.02], yaw: Math.PI / 2 },
  tower: { p: [0.18, 1.65, -0.05], yaw: Math.PI / 2 },
  dinette: { p: [3.02, 1.27, 0.43], yaw: Math.PI },
  wetbath: { p: [0.28, 1.72, 0.45], yaw: Math.PI },
  rear: { p: [-2.35, 0.92, -0.55], yaw: 0 },
  outdoorKitchen: { p: [-2.55, 0.92, 0.05], yaw: 0 },
  outside: { p: [3.0, 0.92, 2.6], yaw: 0, hidden: true },
};
// sitToilet shares the wet bath with a different hip position
ANCHORS.sitToilet = { p: [0.05, 1.3, 0.46], yaw: 0 };

const POSES = {
  stand: { hip: [0, 0], knee: [0, 0], sh: [0.05, 0.05], el: [0.15, 0.15], torso: 0 },
  walk: { hip: [0, 0], knee: [0, 0], sh: [0, 0], el: [0.2, 0.2], torso: 0.04 },
  sit: { hip: [1.5, 1.5], knee: [-1.5, -1.5], sh: [0.3, 0.3], el: [0.9, 0.9], torso: -0.05 },
  work: { hip: [1.5, 1.5], knee: [-1.5, -1.5], sh: [0.75, 0.7], el: [1.25, 1.3], torso: 0.12 },
  cook: { hip: [0, 0], knee: [0, 0], sh: [0.6, 0.55], el: [1.3, 1.2], torso: 0.12 },
  lie: { hip: [0, 0], knee: [0, 0], sh: [0.05, 0.05], el: [0.2, 0.2], torso: 0 },
  lounge: { hip: [1.35, 1.35], knee: [-0.15, -0.25], sh: [0.5, 0.45], el: [1.6, 1.5], torso: -0.35 },
  shower: { hip: [0, 0], knee: [0, 0], sh: [2.6, 2.5], el: [1.6, 1.7], torso: 0.05 },
  sitToilet: { hip: [1.5, 1.5], knee: [-1.5, -1.5], sh: [0.2, 0.2], el: [1.2, 1.2], torso: 0.15 },
  hidden: { hip: [0, 0], knee: [0, 0], sh: [0, 0], el: [0, 0], torso: 0 },
};

export class Person {
  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77f, roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x2f6f8f, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.9 });
    const shoes = new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.8 });
    const cap = (r, l, m) => {
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 6, 12), m);
      mesh.castShadow = true;
      return mesh;
    };
    this.root = new THREE.Group();
    this.root.name = 'person';
    this.pelvis = new THREE.Group();
    this.root.add(this.pelvis);
    this.pelvis.add(cap(0.13, 0.12, pants).rotateX(Math.PI / 2));
    this.torso = new THREE.Group();
    this.pelvis.add(this.torso);
    const chest = cap(0.15, 0.32, shirt);
    chest.position.y = 0.27;
    chest.scale.set(1, 1, 1.25);
    this.torso.add(chest);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 14), skin);
    head.position.y = 0.66;
    head.castShadow = true;
    this.torso.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.9 }));
    hair.position.y = 0.67;
    hair.rotation.z = 0.25;
    this.torso.add(hair);
    const limb = (parent, y, z, upper, lower, r, m1, m2, footMat) => {
      const j1 = new THREE.Group();
      j1.position.set(0, y, z);
      parent.add(j1);
      const u = cap(r, upper - 2 * r, m1);
      u.position.y = -upper / 2;
      j1.add(u);
      const j2 = new THREE.Group();
      j2.position.y = -upper;
      j1.add(j2);
      const l = cap(r * 0.85, lower - 2 * r, m2);
      l.position.y = -lower / 2;
      j2.add(l);
      if (footMat) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.1), footMat);
        f.position.set(0.07, -lower - 0.02, 0);
        f.castShadow = true;
        j2.add(f);
      }
      return [j1, j2];
    };
    this.arms = [limb(this.torso, 0.47, 0.21, 0.3, 0.27, 0.05, shirt, skin), limb(this.torso, 0.47, -0.21, 0.3, 0.27, 0.05, shirt, skin)];
    this.legs = [limb(this.pelvis, -0.02, 0.1, 0.44, 0.43, 0.065, pants, pants, shoes), limb(this.pelvis, -0.02, -0.1, 0.44, 0.43, 0.065, pants, pants, shoes)];
    this.root.traverse((m) => {
      if (m.isMesh) {
        m.userData.cid = 'occupant';
        m.userData.kind = 'person';
      }
    });
    this.cur = { ...ANCHORS.aisleRear, pose: 'stand' };
    this.from = null;
    this.to = null;
    this.t = 1;
    this.anchorName = 'aisleRear';
    this.poseName = 'stand';
    this.poseFrom = POSES.stand;
    this.poseBlend = 1;
    this.time = 0;
    this.root.visible = false;
    this.lieQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
    this.place(ANCHORS.aisleRear, 1);
  }

  /** Request a new activity location & pose. */
  go(anchorName, poseName) {
    if (anchorName === this.anchorName && poseName === this.poseName) return;
    const A = ANCHORS[anchorName] || ANCHORS.aisleRear;
    this.path = this.route(this.anchorName, anchorName);
    this.walkT = 0;
    this.walkDur = Math.max(0.6, this.pathLength(this.path) / 1.1);
    this.anchorName = anchorName;
    this.poseFrom = this.currentPose || POSES.stand;
    this.poseName = poseName;
    this.target = A;
  }

  route(a, b) {
    const P = (n) => new THREE.Vector3(...(ANCHORS[n] || ANCHORS.aisleRear).p);
    const inside = (n) => !['rear', 'outdoorKitchen', 'outside'].includes(n);
    const pts = [P(a)];
    const stand = (v, y = 1.65) => new THREE.Vector3(v.x, y, v.z);
    if (inside(a) && inside(b)) {
      pts.push(stand(new THREE.Vector3(Math.min(2.3, Math.max(-0.05, P(a).x)), 0, -0.05)));
      pts.push(stand(new THREE.Vector3(Math.min(2.3, Math.max(-0.05, P(b).x)), 0, -0.05)));
    } else if (inside(a) !== inside(b)) {
      const inPt = inside(a) ? P(a) : P(b);
      const seq = [stand(new THREE.Vector3(Math.min(2.3, Math.max(-0.05, inPt.x)), 0, -0.05)), stand(new THREE.Vector3(2.05, 0, 0.3)), new THREE.Vector3(2.05, 0.92, 1.5), new THREE.Vector3(0.0, 0.92, 2.2), new THREE.Vector3(-2.3, 0.92, 1.4)];
      if (!inside(a)) seq.reverse();
      pts.push(...seq);
    }
    pts.push(P(b));
    return pts;
  }

  pathLength(p) {
    let l = 0;
    for (let i = 1; i < p.length; i++) l += p[i].distanceTo(p[i - 1]);
    return l;
  }

  place(A, blend) {
    this.root.position.set(...A.p);
    if (A.lie) this.root.quaternion.copy(this.lieQ);
    else this.root.quaternion.setFromEuler(new THREE.Euler(0, A.yaw || 0, 0));
  }

  applyPose(P, walkPhase = null, tSec = 0) {
    const [L, R] = this.legs;
    const [AL, AR] = this.arms;
    L[0].rotation.z = P.hip[0];
    R[0].rotation.z = P.hip[1];
    L[1].rotation.z = P.knee[0];
    R[1].rotation.z = P.knee[1];
    AL[0].rotation.z = P.sh[0];
    AR[0].rotation.z = P.sh[1];
    AL[1].rotation.z = P.el[0];
    AR[1].rotation.z = P.el[1];
    this.torso.rotation.z = -P.torso;
    if (walkPhase !== null) {
      const s = Math.sin(walkPhase);
      L[0].rotation.z = 0.45 * s;
      R[0].rotation.z = -0.45 * s;
      L[1].rotation.z = -Math.max(0, -s) * 0.6;
      R[1].rotation.z = -Math.max(0, s) * 0.6;
      AL[0].rotation.z = -0.35 * s;
      AR[0].rotation.z = 0.35 * s;
    } else if (this.poseName === 'cook') {
      AR[0].rotation.z = P.sh[1] + Math.sin(tSec * 5) * 0.12;
      AR[1].rotation.z = P.el[1] + Math.cos(tSec * 5) * 0.15;
    } else if (this.poseName === 'work') {
      AL[1].rotation.z = P.el[0] + Math.sin(tSec * 11) * 0.04;
      AR[1].rotation.z = P.el[1] + Math.cos(tSec * 13) * 0.04;
    } else if (this.poseName === 'shower') {
      AL[1].rotation.z = P.el[0] + Math.sin(tSec * 4) * 0.25;
      AR[1].rotation.z = P.el[1] + Math.cos(tSec * 4) * 0.25;
    } else if (this.poseName === 'lie') {
      this.torso.rotation.x = Math.sin(tSec * 0.8) * 0.01;
    }
    this.currentPose = P;
  }

  update(dt) {
    this.time += dt;
    if (!this.target) {
      this.applyPose(POSES[this.poseName] || POSES.stand, null, this.time);
      return;
    }
    const A = this.target;
    this.walkT = Math.min(1, this.walkT + dt / this.walkDur);
    const walking = this.walkT < 1 && this.path.length > 2;
    if (walking) {
      // traverse polyline (skip the first & last points when the pose is not standing)
      const pts = this.path;
      const total = this.pathLength(pts);
      let d = this.walkT * total;
      let i = 1;
      while (i < pts.length - 1 && d > pts[i].distanceTo(pts[i - 1])) {
        d -= pts[i].distanceTo(pts[i - 1]);
        i++;
      }
      const a = pts[i - 1], b = pts[i];
      const f = Math.min(1, d / Math.max(1e-4, a.distanceTo(b)));
      this.root.position.lerpVectors(a, b, f);
      const dir = b.clone().sub(a);
      dir.y = 0;
      if (dir.lengthSq() > 1e-5) this.root.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(-dir.z, dir.x), 0));
      this.applyPose(POSES.walk, this.time * 7);
      this.root.visible = true;
    } else {
      this.place(A, 1);
      this.applyPose(POSES[this.poseName] || POSES.stand, null, this.time);
      this.root.visible = !A.hidden && this.poseName !== 'hidden';
    }
  }
}

export { ANCHORS };
