/* Low-poly people. A skier is a pair of skis, two-piece legs that bend at the knee,
   a torso that leans forward from the hips, arms and poles, and a helmeted head.
   A snowboarder is the same body stood sideways on a board.

   The hierarchy, outside in:
     root     position on the snow, heading
     align    tilts to the slope under the feet
     flip     somersaults about the hips
     tumble   what a crash does to you
     lean     into the turn
     ...the body */

import * as THREE from '../../vendor/three.module.min.js';
import { lowPoly, paint } from './geom.js';

export const OUTFITS = [
  { jacket: 0xe8463a, pants: 0x283449, helmet: 0xf4f4f4, gear: 0x1d1f25, accent: 0xffd44a },
  { jacket: 0xffbf26, pants: 0x3b3550, helmet: 0x2b2f3a, gear: 0x2a2d35, accent: 0x2d2f39 },
  { jacket: 0x22b8a7, pants: 0x1f3440, helmet: 0xeaeaea, gear: 0x1b2229, accent: 0xff6a3d },
  { jacket: 0x8a5cf0, pants: 0x2a2236, helmet: 0x161616, gear: 0x26222e, accent: 0x9ff06a }
];

const SKIN = 0xe9b48f;
const GOGGLE = 0x1a2840;

function box(w, h, d, hex) { return paint(lowPoly(new THREE.BoxGeometry(w, h, d)), hex); }

export class RiderMesh {
  constructor(kind, outfit, material) {
    this.kind = kind;
    this.mat = material;
    const o = outfit;
    const M = g => { const m = new THREE.Mesh(g, material); m.castShadow = true; return m; };

    this.root = new THREE.Group();
    this.align = new THREE.Group();
    this.flip = new THREE.Group();
    this.tumble = new THREE.Group();
    this.lean = new THREE.Group();
    this.root.add(this.align);
    this.align.add(this.flip);
    this.flip.position.y = 0.85;
    this.flip.add(this.tumble);
    this.tumble.add(this.lean);
    this.lean.position.y = -0.85;

    // What you stand on.
    this.feet = new THREE.Group();
    this.lean.add(this.feet);
    if (kind === 'board') {
      const board = box(0.30, 0.04, 1.5, o.accent);
      board.translate(0, 0.03, 0);
      this.feet.add(M(board));
      const nose = box(0.27, 0.04, 0.16, o.accent).rotateX(-0.45).translate(0, 0.07, 0.8);
      const tail = box(0.27, 0.04, 0.16, o.accent).rotateX(0.45).translate(0, 0.07, -0.8);
      this.feet.add(M(nose), M(tail));
    } else {
      this.skis = [];
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        g.position.x = s * 0.13;
        const ski = box(0.09, 0.03, 1.7, o.accent).translate(0, 0.02, 0.1);
        const tip = box(0.09, 0.03, 0.18, o.accent).rotateX(-0.5).translate(0, 0.06, 1.0);
        g.add(M(ski), M(tip));
        this.feet.add(g);
        this.skis.push(g);
      }
    }

    // The body. For a boarder it stands across the board, facing the toe edge.
    this.body = new THREE.Group();
    this.lean.add(this.body);
    if (kind === 'board') this.body.rotation.y = Math.PI / 2;

    this.hips = new THREE.Group();
    this.body.add(this.hips);
    this.legs = [];
    const stance = kind === 'board' ? 0.27 : 0.13;
    for (const s of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.x = s * (kind === 'board' ? 0.13 : 0.11);
      this.hips.add(thigh);
      thigh.add(M(box(0.15, 0.46, 0.17, o.pants).translate(0, -0.23, 0)));
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      thigh.add(knee);
      knee.add(M(box(0.14, 0.44, 0.15, o.pants).translate(0, -0.22, 0)));
      const boot = M(box(0.15, 0.14, 0.28, o.gear).translate(0, -0.47, 0.04));
      knee.add(boot);
      this.legs.push({ thigh, knee, s, stance });
    }

    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    this.torso.add(M(box(0.40, 0.56, 0.26, o.jacket).translate(0, 0.28, 0)));
    this.torso.add(M(box(0.41, 0.08, 0.27, o.accent).translate(0, 0.06, 0)));
    const head = new THREE.Group();
    head.position.y = 0.66;
    this.torso.add(head);
    head.add(M(paint(lowPoly(new THREE.IcosahedronGeometry(0.13, 1)), SKIN)));
    head.add(M(paint(lowPoly(new THREE.SphereGeometry(0.145, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55)), o.helmet)
      .translate(0, 0.02, -0.005)));
    head.add(M(box(0.24, 0.07, 0.06, GOGGLE).translate(0, 0.01, 0.12)));
    this.head = head;

    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.25, 0.52, 0);
      this.torso.add(shoulder);
      shoulder.add(M(box(0.11, 0.5, 0.12, o.jacket).translate(0, -0.25, 0)));
      shoulder.add(M(box(0.1, 0.1, 0.1, o.gear).translate(0, -0.53, 0)));
      let pole = null;
      if (kind !== 'board') {
        pole = new THREE.Group();
        pole.position.y = -0.53;
        shoulder.add(pole);
        pole.add(M(paint(lowPoly(new THREE.CylinderGeometry(0.012, 0.012, 1.15, 4)), 0xc8ccd4).translate(0, -0.5, 0)));
      }
      this.arms.push({ shoulder, pole, s });
    }

    this.crouch = 0;
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.nrm = new THREE.Vector3(0, 1, 0);
    this.time = Math.random() * 10;
    this.tumbleTo = 0;
  }

  update(r, dt, at) {
    this.time += dt;
    this.root.position.set(at.x, at.y, at.z);
    this.root.rotation.y = at.psi;

    // Square up to the slope underfoot (in the frame of the heading).
    if (!r.air || r.crashed) this.nrm.set(r.nx, r.ny, r.nz);
    else this.nrm.lerp(this.up, Math.min(1, dt * 2));
    const local = this.nrm.clone().applyAxisAngle(this.up, -at.psi);
    this.q.setFromUnitVectors(this.up, local.normalize());
    this.align.quaternion.slerp(this.q, Math.min(1, dt * 12));

    this.flip.rotation.x = r.air ? at.pitch : this.flip.rotation.x * Math.exp(-dt * 10);

    // How low: tucked, landing, in the air, or just skiing.
    let want = r.tuck ? 0.85 : 0.3 + Math.min(0.3, Math.abs(r.lean) * 0.25);
    if (r.air) want = 0.55 + Math.min(0.35, Math.abs(r.pitch) + Math.abs(r.spinTotal) * 0.1);
    if (r.landed) this.crouch = Math.min(1, this.crouch + r.landed * 0.08);
    this.crouch += (want - this.crouch) * Math.min(1, dt * 7);

    // Lean into the turn — the board leans over its edge instead.
    const leanTo = r.crashed ? 0 : Math.max(-0.75, Math.min(0.75, -r.lean * 0.6));
    this.lean.rotation.z += (leanTo - this.lean.rotation.z) * Math.min(1, dt * 8);

    this._pose(r);
    this._crash(r, dt);
  }

  _pose(r) {
    const c = this.crouch;
    const board = this.kind === 'board';
    const hipH = 0.98 - 0.36 * c;
    const legLen = 0.9;
    const a = Math.acos(Math.max(0.2, Math.min(1, (hipH - 0.06) / legLen)));
    this.hips.position.y = hipH;
    for (const L of this.legs) {
      if (board) {
        // Feet apart along the board; knees bend towards the toe edge.
        L.thigh.position.z = 0;
        L.thigh.rotation.z = L.s * 0.28;
        L.thigh.rotation.x = -a;
        L.knee.rotation.x = 2 * a;
        L.knee.rotation.z = -L.s * 0.28;
      } else {
        L.thigh.rotation.x = -a;
        L.knee.rotation.x = 2 * a;
      }
    }
    // Lean the torso forward to keep the weight over the feet.
    this.torso.rotation.x = board ? 0.25 + 0.4 * c : 0.25 + 0.75 * c - (r.brake ? 0.2 : 0);
    if (board) this.body.position.z = 0;
    const flail = r.air ? Math.sin(this.time * 9) * 0.15 : 0;
    for (const A of this.arms) {
      if (board) {
        A.shoulder.rotation.z = A.s * (0.9 + flail);
        A.shoulder.rotation.x = -0.3;
      } else {
        // Hands forward, poles trailing.
        A.shoulder.rotation.x = -0.55 - 0.5 * c + flail;
        A.shoulder.rotation.z = A.s * (0.12 + 0.1 * c);
        if (A.pole) A.pole.rotation.x = 1.25 + 0.4 * c;
      }
    }
    if (this.skis && !r.air) {
      // Skis splay a little when braking: a snowplough.
      const plough = r.brake ? 0.22 * r.brake : 0;
      this.skis[0].rotation.y = -plough; this.skis[1].rotation.y = plough;
    }
    // A slight shuffle when the boarder is braking: the board sweeps across.
    if (board) this.feet.rotation.y = 0;
  }

  _crash(r, dt) {
    if (!r.crashed) { this.tumble.rotation.set(0, 0, 0); this._spun = 0; return; }
    if (!this._spun) {
      // Tumble a whole number of times, more the faster you were going, then lie down.
      const turns = Math.min(3, Math.floor(r.speed / 7));
      this._spun = 1;
      this.tumbleTo = Math.PI * 2 * turns + Math.PI * 0.5;
      this.tumbleSide = (Math.random() - 0.5) * 1.4;
    }
    const k = 1 - Math.exp(-r.crashT * 2.6);
    this.tumble.rotation.x = this.tumbleTo * k;
    this.tumble.rotation.z = this.tumbleSide * k;
    this.flip.position.y = 0.85 - 0.6 * k;
    this.crouch = 0.6;
  }

  reset() { this.flip.position.y = 0.85; this.tumble.rotation.set(0, 0, 0); }
}
