/* People, rounded and smoothly shaded. A skier is a pair of skis, two-piece legs that bend at the knee,
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
import { paint } from './geom.js';

export const OUTFITS = [
  { jacket: 0xe8463a, pants: 0x283449, helmet: 0xf4f4f4, gear: 0x1d1f25, accent: 0xffd44a },
  { jacket: 0xffbf26, pants: 0x3b3550, helmet: 0x2b2f3a, gear: 0x2a2d35, accent: 0x2d2f39 },
  { jacket: 0x22b8a7, pants: 0x1f3440, helmet: 0xeaeaea, gear: 0x1b2229, accent: 0xff6a3d },
  { jacket: 0x8a5cf0, pants: 0x2a2236, helmet: 0x161616, gear: 0x26222e, accent: 0x9ff06a }
];

const SKIN = 0xe9b48f;
const GOGGLE = 0x1a2840;

/* Rounded, smoothly shaded parts — no hard facets on people. */
function smoothed(g, hex) { g.computeVertexNormals(); return paint(g, hex); }
function capsule(r, len, hex, seg = 12) { return smoothed(new THREE.CapsuleGeometry(r, len, 6, seg), hex); }
function ball(r, hex, sx = 1, sy = 1, sz = 1) {
  return smoothed(new THREE.SphereGeometry(r, 18, 12).scale(sx, sy, sz), hex);
}

/* A ski: long, thin, with its tip curling up and a little camber in the tail. */
function skiGeo(hex) {
  const g = new THREE.BoxGeometry(0.085, 0.022, 1.7, 2, 1, 24);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) + 0.1;
    let y = p.getY(i) + 0.02;
    if (z > 0.62) y += (z - 0.62) ** 2 * 0.55;
    if (z < -0.62) y += (-0.62 - z) ** 2 * 0.12;
    const w = z > 0.85 ? Math.max(0.55, 1 - (z - 0.85) * 2.2) : 1;
    p.setXYZ(i, p.getX(i) * w, y, z);
  }
  return smoothed(g, hex);
}

/* A snowboard: rounded nose and tail, both turned up. */
function boardGeo(hex) {
  const g = new THREE.BoxGeometry(0.3, 0.03, 1.48, 6, 1, 28);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), az = Math.abs(z);
    let x = p.getX(i), y = p.getY(i) + 0.03;
    if (az > 0.56) {
      const u = Math.min(1, (az - 0.56) / 0.18);
      x *= Math.sqrt(Math.max(0.05, 1 - u * u * 0.92));
      y += u * u * 0.09;
    }
    p.setXYZ(i, x, y, z);
  }
  return smoothed(g, hex);
}

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
      this.feet.add(M(boardGeo(o.accent)));
    } else {
      this.skis = [];
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        g.position.x = s * 0.13;
        g.add(M(skiGeo(o.accent)));
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
    this.hips.add(M(ball(0.17, o.pants, 1.12, 0.8, 0.88)));
    this.legs = [];
    const stance = kind === 'board' ? 0.27 : 0.13;
    for (const s of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.x = s * (kind === 'board' ? 0.13 : 0.11);
      this.hips.add(thigh);
      thigh.add(M(capsule(0.088, 0.3, o.pants).translate(0, -0.23, 0)));
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      thigh.add(knee);
      knee.add(M(ball(0.085, o.pants)));
      knee.add(M(capsule(0.078, 0.29, o.pants).translate(0, -0.21, 0)));
      knee.add(M(ball(0.095, o.gear, 1, 0.78, 1.55).translate(0, -0.44, 0.05)));
      this.legs.push({ thigh, knee, s, stance });
    }

    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    this.torso.add(M(capsule(0.17, 0.26, o.jacket, 14).scale(1.12, 1, 0.8).translate(0, 0.3, 0)));
    // A contrasting band round the waist and a collar.
    this.torso.add(M(capsule(0.176, 0.02, o.accent, 14).scale(1.12, 1, 0.8).translate(0, 0.1, 0)));
    this.torso.add(M(ball(0.1, o.accent, 1.3, 0.6, 1.1).translate(0, 0.56, 0)));
    const head = new THREE.Group();
    head.position.y = 0.68;
    this.torso.add(head);
    head.add(M(ball(0.118, SKIN)));
    head.add(M(smoothed(new THREE.SphereGeometry(0.134, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), o.helmet)
      .translate(0, 0.022, -0.012)));
    head.add(M(ball(0.07, GOGGLE, 1.75, 0.62, 0.75).translate(0, 0.012, 0.098)));
    this.head = head;

    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.22, 0.5, 0);
      this.torso.add(shoulder);
      shoulder.add(M(ball(0.085, o.jacket)));
      shoulder.add(M(capsule(0.062, 0.38, o.jacket).translate(0, -0.25, 0)));
      shoulder.add(M(ball(0.058, o.gear, 1, 1.1, 1).translate(0, -0.52, 0)));
      let pole = null;
      if (kind !== 'board') {
        pole = new THREE.Group();
        pole.position.y = -0.53;
        shoulder.add(pole);
        pole.add(M(smoothed(new THREE.CylinderGeometry(0.011, 0.009, 1.15, 8), 0xc8ccd4).translate(0, -0.5, 0)));
        pole.add(M(smoothed(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 12), 0x30343c).translate(0, -1.0, 0)));
      }
      this.arms.push({ shoulder, pole, s });
    }

    this.crouch = 0;
    this._skate = 0;
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

    // Legs as suspension: feel how sharply the snow underfoot pushes up or drops away,
    // and soak it up at the knees, so the body glides while the skis follow the bumps.
    if (dt > 0) {
      const vy = (at.y - (this._py ?? at.y)) / dt;
      const ay = (vy - (this._pvy ?? vy)) / dt;
      this._py = at.y; this._pvy = vy;
      if (!r.air && !r.crashed) this._absorb = Math.max(-0.25, Math.min(0.45, (this._absorb || 0) + ay * 0.0016));
    }
    this._absorb = (this._absorb || 0) * Math.exp(-dt * 5);

    // How low: tucked, landing, in the air, or just skiing — deeper in a hard carve.
    let want = r.tuck ? 0.88 : 0.42 + Math.min(0.3, Math.abs(this.leanNow || 0) * 0.4) + this._absorb;
    if (r.air) want = 0.55 + Math.min(0.35, Math.abs(r.pitch) + Math.abs(r.spinTotal) * 0.1);
    if (r.air && r.absorb) want = 1;
    if (r.stumble > 0) want = 1;
    if (r.landed) this.crouch = Math.min(1, this.crouch + r.landed * 0.08);
    this.crouch += (want - this.crouch) * Math.min(1, dt * 7);

    // Lean into the turn on a soft spring, so it rolls in and out of each arc rather
    // than snapping — the board leans over its edge instead.
    let leanTo = r.crashed || r.air ? 0 : Math.max(-0.8, Math.min(0.8, -r.lean * 0.55));
    if (r.stumble > 0 && !r.crashed) leanTo += Math.sin(this.time * 18) * 0.25 * r.stumble;
    const k = 60, damp = 2 * Math.sqrt(k);
    this.leanVel = (this.leanVel || 0) + ((leanTo - (this.leanNow || 0)) * k - (this.leanVel || 0) * damp) * dt;
    this.leanNow = (this.leanNow || 0) + this.leanVel * dt;
    this.lean.rotation.z = this.leanNow;

    // A pole plant on the new inside each time you change edges.
    const side = Math.sign(this.leanNow);
    if (side && side !== this._edge && Math.abs(this.leanNow) > 0.12 && !r.air) {
      this._edge = side;
      this._plant = { side, t: 0 };
    }
    if (this._plant) { this._plant.t += dt; if (this._plant.t > 0.45) this._plant = null; }

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
        L.thigh.rotation.z = 0;
        L.knee.rotation.z = 0;
      }
    }
    // Lean the torso forward to keep the weight over the feet, and keep the upper body
    // quieter than the legs through a turn — hips in, shoulders level: angulation.
    this.torso.rotation.x = board ? 0.25 + 0.4 * c : 0.25 + 0.75 * c - (r.brake ? 0.2 : 0);
    this.torso.rotation.z = -(this.leanNow || 0) * (board ? 0.3 : 0.55);
    this.head.rotation.z = -(this.leanNow || 0) * 0.25;
    if (board) this.body.position.z = 0;
    const flail = r.air ? Math.sin(this.time * 9) * 0.15 : 0;
    for (const A of this.arms) {
      if (board) {
        A.shoulder.rotation.z = A.s * (0.9 + flail);
        A.shoulder.rotation.x = -0.3;
      } else {
        // Hands forward, poles trailing; the outside hand lifts a little for balance.
        const outside = Math.max(0, A.s * (this.leanNow || 0));
        A.shoulder.rotation.x = -0.55 - 0.5 * c + flail;
        A.shoulder.rotation.z = A.s * (0.12 + 0.1 * c + outside * 0.5);
        if (A.pole) A.pole.rotation.x = 1.25 + 0.4 * c;
        // Planting: reach forward and touch the pole tip down beside the inside ski.
        const P = this._plant;
        if (P && A.pole && A.s === -P.side && !r.air) {
          const u = Math.sin(Math.min(1, P.t / 0.45) * Math.PI);
          A.shoulder.rotation.x -= 0.45 * u;
          A.pole.rotation.x -= 0.9 * u;
        }
      }
    }
    if (this.skis) {
      // Ski 0 is on the -x side, ski 1 on +x. A positive turn about y swings a tip
      // towards +x.
      const skate = !r.air && !r.crashed ? Math.min(1, (r.skating || 0) * 4) : 0;
      this._skate += (skate - (this._skate || 0)) * 0.25;
      const k = this._skate;
      // Braking: a snowplough, tips together, tails pushed out.
      const plough = !r.air && r.brake ? 0.24 * r.brake : 0;
      // Skating: a V, tips apart, pushing off one ski then the other.
      const ph = this.time * 7.5, side = Math.sin(ph);
      for (let i = 0; i < 2; i++) {
        const sgn = i === 0 ? -1 : 1, L = this.legs[i], ski = this.skis[i];
        const push = Math.max(0, sgn * side);               // this leg is driving out
        const spread = k * (0.08 + 0.3 * push);
        L.thigh.rotation.z = sgn * spread;
        L.knee.rotation.z = -sgn * spread * 0.4;
        ski.rotation.y = sgn * (0.38 * k) - sgn * plough;
        ski.position.x = sgn * (0.13 + 0.8 * Math.sin(spread));
        ski.position.y = k * 0.07 * Math.max(0, -sgn * side); // the other ski lifts to recover
      }
      // Arms swing with the stride.
      for (const A of this.arms) A.shoulder.rotation.x += k * 0.55 * side * A.s;
      this.lean.rotation.z += k * 0.08 * side;
    }
    // A slight shuffle when the boarder is braking: the board sweeps across.
    if (board) this.feet.rotation.y = 0;
  }

  _crash(r, dt) {
    if (!r.crashed) { this.tumble.rotation.set(0, 0, 0); this.flip.position.y = 0.85; this._spun = 0; return; }
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
