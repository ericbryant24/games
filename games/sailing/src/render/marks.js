/* Course furniture: inflatable marks, the committee boat and the pin, all of it riding
   the same waves as the fleet so nothing looks pinned to a flat plane. */

import * as THREE from '../../vendor/three.module.min.js';

function markMesh(color, size) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.62, size * 0.86, size * 1.5, 14, 1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  body.position.y = size * 0.55;
  const top = new THREE.Mesh(new THREE.SphereGeometry(size * 0.62, 14, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  top.position.y = size * 1.30;
  top.scale.y = 0.7;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.66, size * 0.66, size * 0.20, 14),
    new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.7 }));
  band.position.y = size * 0.95;
  g.add(body, top, band);
  return g;
}

function committeeBoat() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeef1f3, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x27303a, roughness: 0.6 });
  // A stubby motor launch: hull, cabin, mast with the class flag.
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.62, 8.5, 12, 1, false, 0, Math.PI), white);
  hull.rotation.z = Math.PI / 2;
  hull.rotation.y = Math.PI / 2;
  hull.position.y = 0.42;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.12, 8.4), white);
  deck.position.y = 0.86;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.95, 2.6), white);
  cabin.position.set(0, 1.38, 0.6);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 8.42), dark);
  stripe.position.y = 0.78;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 8), dark);
  mast.position.set(0, 2.9, -1.4);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xd8452f, roughness: 0.8, side: THREE.DoubleSide }));
  flag.position.set(0.52, 4.35, -1.4);
  g.add(hull, deck, stripe, cabin, mast, flag);
  g.userData.flag = flag;
  return g;
}

export class CourseView {
  constructor(course, waves) {
    this.course = course;
    this.waves = waves;
    this.root = new THREE.Group();
    this.items = [];

    const add = (mesh, mark, bob) => {
      this.root.add(mesh);
      this.items.push({ mesh, mark, bob });
    };
    add(markMesh(0xff7a1a, 1.15), course.windward, 1);
    add(markMesh(0xff7a1a, 1.15), course.leeward, 1);
    add(markMesh(0xffd23f, 0.95), course.pin, 1);
    const cb = committeeBoat();
    add(cb, course.boatEnd, 0.35);
    this.committee = cb;

    // The start line itself, as a faint float line between the marks.
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push(new THREE.Vector3(
        course.pin.x + (course.boatEnd.x - course.pin.x) * t, 0.1,
        course.pin.z + (course.boatEnd.z - course.pin.z) * t));
    }
    this.lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
    this.lineMesh = new THREE.Line(this.lineGeom, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.30 }));
    this.root.add(this.lineMesh);
    this._w = { y: 0, dhdx: 0, dhdz: 0, hullX: 0, hullZ: 0 };
  }

  update(time) {
    for (const it of this.items) {
      this.waves.sample(it.mark.x, it.mark.z, time, this._w);
      it.mesh.position.set(it.mark.x, this._w.y, it.mark.z);
      // Marks lean with the wave face; the committee boat only nods.
      it.mesh.rotation.z = -Math.atan(this._w.dhdx) * it.bob;
      it.mesh.rotation.x = Math.atan(this._w.dhdz) * it.bob;
    }
    // Point the committee boat along the line, and flutter the flag.
    const c = this.course;
    this.committee.rotation.y = Math.atan2(c.lineDirX, c.lineDirZ);
    const f = this.committee.userData.flag;
    if (f) f.rotation.y = Math.sin(time * 3.1) * 0.22 - 0.4;

    const lp = this.lineGeom.attributes.position.array;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = c.pin.x + (c.boatEnd.x - c.pin.x) * t;
      const z = c.pin.z + (c.boatEnd.z - c.pin.z) * t;
      this.waves.sample(x, z, time, this._w);
      lp[i * 3 + 1] = this._w.y + 0.08;
    }
    this.lineGeom.attributes.position.needsUpdate = true;
  }
}
