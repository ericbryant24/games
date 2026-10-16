/* One rider on the snow: a skier or a snowboarder. The same physics for you and for the
   three on your tail — the only differences are in the numbers each rider carries.

   On the snow: gravity along the slope, edges that carve the velocity round towards
   where the skis point (up to the grip a carve can hold) and skid off whatever is left,
   snow friction and air drag. Over a convex lip the snow falls away faster than the
   rider can follow and they leave the ground. In the air: gravity and drag, and you can
   spin. Landing: too much speed into the slope, or skis too far across the direction of
   travel, and it is a crash. */

import { clamp, wrapAngle } from './noise.js';

export const G = 9.81;
export const RADIUS = 0.32;

/* carve   lateral acceleration a clean carve can hold, m/s²
   yaw     fastest the skis can be swung round at low speed, rad/s
   grip    how quickly skidding is scrubbed off, 1/s
   drag    air drag per unit mass (upright, tucked), 1/m
   land    vertical speed into the slope a rider can absorb, m/s
   align   how far skis can be across the direction of travel on landing, rad
   spin    rotation rate in the air, rad/s
   flip    somersault rate in the air, rad/s
   pop     ollie, m/s */
export const RIDER = {
  player: { kind: 'ski', carve: 22, yaw: 4.4, grip: 12, drag: 0.0068, tuckDrag: 0.0038,
    land: 16, align: 0.95, spin: 5.2, flip: 5.0, pop: 3.8 },
  ski: { kind: 'ski', carve: 22, yaw: 4.4, grip: 12, drag: 0.0068, tuckDrag: 0.0038,
    land: 9.0, align: 0.8, spin: 5.0, flip: 4.8, pop: 3.8 },
  playerBoard: { kind: 'board', carve: 20, yaw: 4.0, grip: 11, drag: 0.0070, tuckDrag: 0.0040,
    land: 16.5, align: 0.95, spin: 5.2, flip: 5.0, pop: 3.9 },
  board: { kind: 'board', carve: 19, yaw: 3.8, grip: 10, drag: 0.0070, tuckDrag: 0.0042,
    land: 10.5, align: 0.95, spin: 4.6, flip: 4.6, pop: 3.9 }
};

const _n = { x: 0, y: 1, z: 0 };
const _near = [];

export class Skier {
  constructor(spec, opts) {
    this.spec = spec;
    this.name = opts.name;
    this.isPlayer = !!opts.isPlayer;
    this.x = opts.x; this.z = opts.z;
    this.y = opts.terrain.height(this.x, this.z);
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.psi = opts.psi || 0;          // heading: 0 is straight down the fall line (+z)
    this.air = false;
    this.airTime = 0;
    this.crashed = false;
    this.crashT = 0;
    this.cause = '';
    this.causeBy = null;

    // Inputs, set each step by the player's thumbs or a follower's brain.
    this.steer = 0;        // -1 left .. 1 right
    this.tuck = false;
    this.brake = 0;        // 0..1
    this.wantJump = false;
    this.flipIn = 0;       // in the air: -1 backflip .. 1 front flip
    this.skating = 0;      // seconds of skating left to show
    this.absorb = false;   // crouched, ready to soak up a landing
    this.yawVel = 0;       // how fast the skis are swinging, rad/s
    this.hard = false;     // in a hard, skidding turn
    this.stumble = 0;      // seconds of wobble left after a heavy landing
    this.boost = 0;        // catch-up push, m/s² (followers only)

    // What the renderer and the HUD want to know.
    this.speed = 0;
    this.skid = 0;         // 0..1 how hard the edges are scraping
    this.lean = 0;         // signed lateral g, for leaning into the turn
    this.popCd = 0;
    this.jumped = false;   // set on the step an ollie happens
    this.landed = 0;       // impact of the landing that just happened, 0 if none
    this.spinTotal = 0;    // yaw turned through since take-off, rad (+ = left)
    this.pitch = 0;        // somersault since take-off, rad (+ = forwards)
    this.airId = 0;        // counts take-offs
    this.lastTrick = null; // { spin, flip } of the jump just landed
    this.nx = 0; this.ny = 1; this.nz = 0;
    this.remember();
  }

  get alive() { return !this.crashed; }

  /* Keep the last step's pose, so drawing can blend between steps. */
  remember() { this.px = this.x; this.py = this.y; this.pz = this.z; this.ppsi = this.psi; this.ppitch = this.pitch; }

  /* Pose blended a fraction `a` of the way from the last step to this one. */
  pose(a, out) {
    out.x = this.px + (this.x - this.px) * a;
    out.y = this.py + (this.y - this.py) * a;
    out.z = this.pz + (this.z - this.pz) * a;
    out.psi = this.ppsi + wrapAngle(this.psi - this.ppsi) * a;
    out.pitch = this.ppitch + (this.pitch - this.ppitch) * a;
    return out;
  }

  crash(cause, by = null) {
    if (this.crashed) return;
    this.crashed = true;
    this.cause = cause;
    this.causeBy = by;
    this.crashT = 0;
    this.pitch = 0;
  }

  step(dt, terrain) {
    this.jumped = false;
    this.landed = 0;
    this.popCd -= dt;
    if (this.crashed) { this.crashT += dt; this._tumble(dt, terrain); return; }
    if (this.air) this._fly(dt, terrain); else this._ski(dt, terrain);
    if (!this.crashed) this._hits(terrain);
  }

  _ski(dt, T) {
    const s = this.spec;
    const n = T.normal(this.x, this.z, _n);
    this.nx = n.x; this.ny = n.y; this.nz = n.z;

    // Gravity along the slope.
    let vx = this.vx + G * n.y * n.x * dt;
    let vy = this.vy + (-G + G * n.y * n.y) * dt;
    let vz = this.vz + G * n.y * n.z * dt;
    let vn = vx * n.x + vy * n.y + vz * n.z;
    vx -= vn * n.x; vy -= vn * n.y; vz -= vn * n.z;
    let speed = Math.hypot(vx, vy, vz);

    // Swing the skis: quick and nimble, a little less so at full speed or tucked. The
    // swing itself has a little momentum, so turns roll in and out as smooth arcs
    // instead of snapping on and off with your thumb.
    // A normal hold carves: the skis swing only as fast as the edges can bend your path,
    // so the turn is a clean sweeping arc that keeps your speed. A hard turn (steer
    // beyond 1) pivots the skis across the hill as fast as they will go, and the skid
    // that follows scrubs the speed off — hold it and you stop.
    const hard = Math.abs(this.steer) > 1.05;
    const pivot = s.yaw * clamp(16 / (speed + 6), 0.5, 1) * (this.tuck ? 0.7 : 1);
    const carveRate = Math.max(1.2, (s.carve * 1.1) / Math.max(speed, 1));
    const yawRate = hard ? s.yaw * 1.1 : Math.min(pivot, carveRate);
    const turnIn = hard ? Math.sign(this.steer) : clamp(this.steer, -1, 1);
    this.yawVel += (-turnIn * yawRate - this.yawVel) * Math.min(1, dt * (hard ? 14 : 8));
    this.hard = hard;
    // A hockey stop: once a hard turn has the skis right across the hill, they stay
    // there on their edges instead of swinging on round uphill.
    if (hard) {
      const nh = Math.hypot(n.x, n.z);
      if (nh > 0.02) {
        const downhill = (Math.sin(this.psi) * n.x + Math.cos(this.psi) * n.z) / nh;
        const cross = Math.cos(this.psi) * n.x - Math.sin(this.psi) * n.z;   // which way is downhill: left or right
        if (downhill < 0.08 && Math.sign(this.yawVel) === Math.sign(-cross)) this.yawVel = 0;
      }
    }
    this.psi = wrapAngle(this.psi + this.yawVel * dt);

    // Ski direction and its sideways partner, both in the plane of the snow.
    let fx = Math.sin(this.psi), fy = 0, fz = Math.cos(this.psi);
    const fn = fx * n.x + fz * n.z;
    fx -= fn * n.x; fy -= fn * n.y; fz -= fn * n.z;
    let fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // l = n × f
    const lx = n.y * fz - n.z * fy, ly = n.z * fx - n.x * fz, lz = n.x * fy - n.y * fx;

    let along = vx * fx + vy * fy + vz * fz;
    let side = vx * lx + vy * ly + vz * lz;
    let skid = 0, lean = 0;
    if (speed > 0.05) {
      // Skis are symmetric: running backwards is just the other way along them.
      const back = along < 0 ? -1 : 1;
      along *= back;
      const beta = Math.atan2(side, along);
      // A carve bends the path without losing speed, up to what the edges hold.
      const maxTurn = (s.carve * (this.tuck ? 0.75 : 1)) / Math.max(speed, 2) * dt;
      const turn = clamp(beta, -maxTurn, maxTurn);
      const b2 = beta - turn;
      along = speed * Math.cos(b2);
      side = speed * Math.sin(b2);
      lean = -(turn / dt) * speed / G;
      // Whatever is still sideways skids. Skidding costs some speed, but the edges
      // push a share of it back along the skis, so a quick turn does not stall you.
      const keep = Math.exp(-s.grip * dt);
      const scrub = Math.abs(side) * (1 - keep);
      skid = scrub / dt;
      side *= keep;
      // In a carve the edges hand most of a little skid back as speed; in a hard turn
      // the skid is the point, and it costs you.
      along += scrub * (hard ? 0 : 0.45);
      if (hard) along *= Math.exp(-dt * (1.2 + 2.4 * Math.min(1, Math.abs(beta) / 0.5)));
      along *= back;
    }
    vx = fx * along + lx * side;
    vy = fy * along + ly * side;
    vz = fz * along + lz * side;
    speed = Math.hypot(vx, vy, vz);

    // Snow friction, the brake (a skid-stop), air drag.
    const mu = 0.032 + this.brake * 0.8;
    const c = this.tuck ? s.tuckDrag : s.drag;
    const decel = mu * G * n.y + c * speed * speed;
    if (speed > 1e-4) {
      const k = Math.max(0, speed - decel * dt) / speed;
      vx *= k; vy *= k; vz *= k;
    }
    // A skate step or two when nearly stopped, so nobody is stranded on a flat.
    const push = (speed < 3 && !this.brake ? 1.8 : 0) + this.boost;
    if (push) { vx += fx * push * dt; vy += fy * push * dt; vz += fz * push * dt; }
    if (speed < 3 && !this.brake) this.skating = Math.max(this.skating, 0.3);
    this.skating = Math.max(0, this.skating - dt);
    this.stumble = Math.max(0, this.stumble - dt);

    this.skid = clamp((skid / 14) + this.brake * Math.min(1, speed / 6), 0, 1);
    this.lean += (clamp(lean, -1.2, 1.2) - this.lean) * Math.min(1, dt * 10);

    // Ollie.
    if (this.wantJump && this.popCd <= 0) {
      vx += n.x * s.pop; vy += n.y * s.pop; vz += n.z * s.pop;
      this.wantJump = false;
      this.popCd = 0.55;
      this.jumped = true;
      this._launch(vx, vy, vz);
      return;
    }
    this.wantJump = false;

    this.vx = vx; this.vy = vy; this.vz = vz;
    this.speed = Math.hypot(vx, vy, vz);
    this.x += vx * dt; this.z += vz * dt;
    const yFree = this.y + vy * dt;
    const h = T.height(this.x, this.z);

    // Does the snow fall away faster than we can follow it? Check the curvature of the
    // ground along the line of travel against what gravity can hold us to.
    const hs = Math.hypot(vx, vz);
    if (hs > 2) {
      const ux = vx / hs, uz = vz / hs, e = 0.9;
      const hf = T.height(this.x + ux * e, this.z + uz * e);
      const hb = T.height(this.x - ux * e, this.z - uz * e);
      const d1 = (hf - hb) / (2 * e);
      const d2 = (hf - 2 * h + hb) / (e * e);
      const kappa = d2 / Math.pow(1 + d1 * d1, 1.5);
      const support = G * n.y + this.speed * this.speed * kappa;
      // Only a real lip throws you: rolls and bumps you ride over, knees soaking them up.
      if (support < -0.3 * G || yFree - h > 0.3) {
        this.y = Math.max(yFree, h);
        this._launch(vx, vy, vz);
        return;
      }
    }
    // Stay on the snow, turning the velocity to follow it.
    this.y = h;
    T.normal(this.x, this.z, _n);
    const vn2 = vx * _n.x + vy * _n.y + vz * _n.z;
    let wx = vx - vn2 * _n.x, wy = vy - vn2 * _n.y, wz = vz - vn2 * _n.z;
    const wl = Math.hypot(wx, wy, wz);
    if (wl > 1e-6) {
      const k = this.speed / wl;
      this.vx = wx * k; this.vy = wy * k; this.vz = wz * k;
    }
  }

  _launch(vx, vy, vz) {
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.air = true;
    this.airTime = 0;
    this.yawVel = 0;
    this.spinTotal = 0;
    this.pitch = 0;
    this.airId++;
  }

  _fly(dt, T) {
    const s = this.spec;
    this.airTime += dt;
    this.vy -= G * dt;
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    const c = (this.tuck ? s.tuckDrag : s.drag) * speed;
    this.vx -= this.vx * c * dt; this.vy -= this.vy * c * dt; this.vz -= this.vz * c * dt;
    const turn = -this.steer * s.spin * dt;
    this.psi = wrapAngle(this.psi + turn);
    this.spinTotal += turn;
    this.pitch += this.flipIn * s.flip * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.speed = Math.hypot(this.vx, this.vy, this.vz);
    this.skid *= Math.exp(-dt * 8);
    this.lean *= Math.exp(-dt * 4);

    const h = T.height(this.x, this.z);
    if (this.y > h) return;

    // Landing.
    const n = T.normal(this.x, this.z, _n);
    this.y = h;
    const into = -(this.vx * n.x + this.vy * n.y + this.vz * n.z);
    let tx = this.vx + into * n.x, ty = this.vy + into * n.y, tz = this.vz + into * n.z;
    const ts = Math.hypot(tx, ty, tz);
    // How far across the line of travel are the skis? Backwards is fine.
    let across = 0;
    if (Math.hypot(tx, tz) > 2) {
      across = Math.abs(wrapAngle(this.psi - Math.atan2(tx, tz)));
      across = Math.min(across, Math.PI - across);
    }
    this.air = false;
    this.landed = into;
    const tilt = Math.abs(wrapAngle(this.pitch));
    const tricked = Math.abs(this.spinTotal) > 1.2 || Math.abs(this.pitch) > 1.2;
    this.lastTrick = { spin: this.spinTotal, flip: this.pitch };
    this.pitch = 0;
    if (tilt > 0.75) { this.crash(tilt > 2.2 ? 'head' : 'flip'); return; }
    // Crouching as you land soaks up a good deal more. A heavy landing short of the
    // limit is a stumble — it costs speed, not the run.
    const limit = s.land * (this.absorb ? 1.25 : 1);
    if (into > limit) { this.crash('hard'); return; }
    if (across > s.align && ts > 3) { this.crash(tricked ? 'spin' : 'sideways'); return; }
    const heavy = into > limit * 0.7;
    if (heavy) this.stumble = 0.8;
    const keep = heavy ? 0.6 : 1 - 0.18 * clamp(into / limit, 0, 1) - 0.25 * (across / s.align);
    this.vx = tx * keep; this.vy = ty * keep; this.vz = tz * keep;
    this.speed = ts * keep;
    // Ride away along the skis' line, whichever end is in front.
    if (across > 0.05) {
      const vpsi = Math.atan2(tx, tz);
      const flip = Math.abs(wrapAngle(this.psi - vpsi)) > Math.PI / 2 ? Math.PI : 0;
      const d = wrapAngle(vpsi + flip - this.psi);
      this.psi = wrapAngle(this.psi + d * 0.5);
    }
  }

  /* After a crash: tumble on down the hill and slow to a stop in the snow. */
  _tumble(dt, T) {
    if (this.air) {
      this.vy -= G * dt;
      this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
      const h = T.height(this.x, this.z);
      if (this.y <= h) { this.y = h; this.air = false; this.vy = 0; }
      return;
    }
    const n = T.normal(this.x, this.z, _n);
    this.vx += G * n.y * n.x * dt;
    this.vz += G * n.y * n.z * dt;
    const hs = Math.hypot(this.vx, this.vz);
    // A body in the snow stops quickly, and stays stopped on anything but the steeps.
    const decel = 6.5 + 0.4 * hs;
    const k = hs > 1e-3 ? Math.max(0, hs - decel * dt) / hs : 0;
    this.vx *= k; this.vz *= k;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.y = T.height(this.x, this.z);
    this.speed = Math.hypot(this.vx, this.vz);
    this.skid = Math.min(1, this.speed / 8);
  }

  /* Trees and rocks. A rock you are high enough to clear is no trouble. */
  _hits(T) {
    T.nearby(this.x, this.z, 3, _near);
    for (const o of _near) {
      const dx = this.x - o.x, dz = this.z - o.z;
      const r = o.r + RADIUS;
      if (dx * dx + dz * dz > r * r) continue;
      if (this.y > o.y + o.h) continue;
      const d = Math.hypot(dx, dz) || 1;
      // Barely moving, you just come to a stop against it.
      const closing = -(this.vx * dx + this.vz * dz) / d;
      if (closing < 2.5) {
        this.x = o.x + dx / d * r; this.z = o.z + dz / d * r;
        if (closing > 0) { this.vx += dx / d * closing; this.vz += dz / d * closing; }
        continue;
      }
      this.crash(o.kind);
      // Stop dead against it, more or less.
      this.vx = dx / d * 1.5; this.vz = dz / d * 1.5; this.vy = 0;
      return;
    }
  }
}
