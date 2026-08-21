/* Computer skippers.

   The helm runs as a small state machine, because the hard part of sailing a boat is
   not choosing the fast angle — it is knowing when you are not allowed to. A boat with
   no speed cannot point, cannot tack and cannot be steered, so the skipper commits to
   one heading and drives until it has way on. Everything else follows from that.

   One angle convention throughout: `tack` is the sign of the true wind angle, so +1 is
   starboard tack (or starboard gybe) and -1 is port, and the heading we want is always
   `windFrom - tack * angle`. */

import { wrapPi, PHASE } from './course.js';

/* Best angles by wind speed, read off the boat's own polar (tools/polar.mjs). Upwind
   widens a touch in a breeze as the rig depowers; downwind you square away deeper once
   there is pressure to work with. */
const BEAT = [[2.5, 0.86], [5, 0.79], [7, 0.735], [10, 0.70], [13, 0.735], [18, 0.80]];
const RUN  = [[2.5, 2.44], [5, 2.62], [7, 2.62], [10, 2.79], [13, 2.79], [18, 2.72]];

function lerpTable(table, w) {
  if (w <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (w <= table[i][0]) {
      const [w0, v0] = table[i - 1], [w1, v1] = table[i];
      return v0 + (v1 - v0) * (w - w0) / (w1 - w0);
    }
  }
  return table[table.length - 1][1];
}
export const beatAngle = w => lerpTable(BEAT, w);
export const runAngle = w => lerpTable(RUN, w);

/* Hoist the kite on the way down the run and drop it before the beat. Shared with the
   player's boat — nobody wants a spinnaker button on a phone. */
export function manageSpinnaker(boat, dt) {
  const twa = Math.abs(boat.tel.twa);
  const want = boat.spinnaker ? twa > 1.62 : twa > 1.92;      // ~93 up, ~110 down
  if (want !== boat.spinnaker) {
    boat._kiteTimer = (boat._kiteTimer || 0) + dt;
    if (boat._kiteTimer > (want ? 1.4 : 0.7)) {               // hoists are slower than drops
      boat.spinnaker = want;
      boat._kiteTimer = 0;
    }
  } else boat._kiteTimer = 0;
}

/* Reef as it comes on to blow. A 7 m boat carrying full main and jib in 25 knots is
   grossly over-canvassed: it heels, the helm loads up until the rudder cannot hold it,
   and the boat luffs itself to a standstill. Rolling a reef in is what real crews do,
   and it is the difference between racing and survival. */
export function manageReef(boat, dt) {
  const target = Math.max(0, Math.min(0.85, (boat.tel.tws - 9.0) / 5.5));
  const rate = target > boat.reef ? 0.09 : 0.05;    // shaking one out takes longer
  boat.reef += Math.sign(target - boat.reef) * Math.min(Math.abs(target - boat.reef), rate * dt);
}

export const MODE = {
  SAIL: 'sail',      // up to speed: sail the fast angle and work the shifts
  BUILD: 'build',    // slow: hold one wide angle on this tack and drive
  TURN: 'turn',      // committed to a tack or a gybe
  IRONS: 'irons'     // stopped head to wind: back the sail and steer out
};

/* The speed a boat can expect to make upwind in a given breeze, m/s. The helm's
   decisions are all relative to this: "slow" in 6 knots of wind is a different number
   from "slow" in 20, and absolute gates leave a boat stuck in one mode all race. */
function paceFor(tws) {
  return Math.max(0.8, Math.min(3.2, 0.42 * tws));
}

export class Skipper {
  constructor(boat, opts = {}) {
    this.boat = boat;
    this.skill = opts.skill ?? 0.75;
    this.corridor = opts.corridor ?? (34 + Math.random() * 46);
    this.startSlot = opts.startSlot ?? 0;
    this.tack = opts.tack ?? 1;
    this.mode = MODE.BUILD;
    this.turnTo = boat.psi;
    this.turnKind = 'tack';
    this.turnT = 0;
    this.ironsT = 0;
    this.escapeDir = 0;
    this.trimTarget = boat.trim;
    this.targetHeading = boat.psi;
    this.noise = Math.random() * 100;
    this.think = 0;
    this.lastTackAt = -99;
    this.why = 'build';
  }

  enter(mode) {
    if (mode === this.mode) return;
    if (mode === MODE.BUILD || mode === MODE.IRONS) {
      // Commit to the side the wind is already on. Anything else means turning through
      // the wind with no speed, which does not end well.
      const t = Math.sign(this.boat.tel.twa);
      if (t) this.tack = t;
    }
    if (mode === MODE.IRONS) this.escapeDir = 0;
    if (this.mode === MODE.IRONS) this.ironsT = 0;   // leaving the escape: start clean
    if (mode === MODE.TURN) this.turnT = 0;
    this.mode = mode;
  }

  update(dt, race, course, fleet) {
    const b = this.boat;
    const tel = b.tel;
    const w = tel.twFrom;
    const p = race.progress.get(b);
    const leg = course.legs[Math.min(p.leg, course.legs.length - 1)];
    const downwind = leg && (leg.type === 'run' || leg.type === 'finish');
    const beat = beatAngle(tel.tws);
    const run = runAngle(tel.tws);
    const best = downwind ? run : beat;
    const pace = paceFor(tel.tws);
    // Way on means motion *forwards*. A boat sliding astern out of a bad tack has no
    // steerage at all, however fast the ground is going by.
    const way = b.u;
    // Trust the boat only while it is genuinely sailing: near the no-go zone the sign
    // of the wind angle flickers, and following it flips the target every few seconds.
    if (this.mode === MODE.SAIL && way > pace * 0.58) {
      const clean = downwind ? Math.abs(tel.twa) < best * 1.08 : Math.abs(tel.twa) > best * 0.80;
      if (clean) this.tack = Math.sign(tel.twa) || this.tack;
    }

    /* --- state machine ---------------------------------------------------- */
    const stalled = way < Math.min(0.55, pace * 0.30) && Math.abs(tel.twa) < 0.40;
    // Capped: without a ceiling a long stall leaves the counter so high that the boat
    // drops straight back into the escape the moment it gets going again.
    this.ironsT = stalled ? Math.min(2.5, this.ironsT + dt) : Math.max(0, this.ironsT - dt * 2);

    switch (this.mode) {
      case MODE.IRONS:
        if (Math.abs(tel.twa) > 0.85 && way > 0.1) this.enter(MODE.BUILD);
        break;
      case MODE.TURN:
        this.turnT += dt;
        if (Math.abs(wrapPi(b.psi - this.turnTo)) < 0.13) this.enter(MODE.SAIL);
        else if (this.turnT > 13 || (this.turnT > 4.5 && way < pace * 0.22)) this.enter(MODE.BUILD);
        break;
      case MODE.BUILD:
        if (this.ironsT > 1.4) this.enter(MODE.IRONS);
        else if (way > pace * 0.80) this.enter(MODE.SAIL);
        break;
      default:
        if (this.ironsT > 1.4) this.enter(MODE.IRONS);
        else if (way < pace * 0.45) this.enter(MODE.BUILD);
    }

    /* --- where do we want to point? --------------------------------------- */
    let target;
    let trimMode = downwind ? 'drive' : 'point';
    let easeExtra = 0;

    if (p.finished) {
      target = b.psi; this.why = 'done';
    } else if (race.phase === PHASE.PRESTART) {
      target = this.startApproach(race, course, beat);
    } else if (p.ocs && !p.penaltyCleared) {
      // Get back below the line on a broad reach, not dead square: squared away is the
      // slowest angle on the boat and the last thing you want when you owe the line.
      target = wrapPi(w + Math.PI - this.tack * 0.55); this.why = 'ocs';
    } else if (p.leg === 0 && course.lineSide(b.x, b.z) > 10) {
      target = wrapPi(w + Math.PI - this.tack * 0.55); this.why = 'restart';
    } else if (this.mode === MODE.IRONS) {
      if (!this.escapeDir) this.escapeDir = -(b.boomSide || Math.sign(tel.twa) || 1);
      target = wrapPi(w - this.escapeDir * 1.15);
      easeExtra = Math.abs(tel.twa) < 0.55 ? 0.8 : 0;   // back the sail to spin the bow off
      this.why = 'irons';
    } else if (this.mode === MODE.TURN) {
      target = this.turnTo;
      easeExtra = 0.18;
      this.why = this.turnKind;
    } else if (this.mode === MODE.BUILD) {
      // One heading, wide enough to accelerate hard, on the tack we are already on.
      const power = downwind ? run * 0.86 : Math.min(1.20, beat + 0.28);
      target = wrapPi(w - this.tack * power);
      trimMode = 'drive';
      this.why = 'build ' + (this.tack > 0 ? 'stbd' : 'port');
    } else {
      target = this.tactics(race, course, beat, run, downwind, pace);
    }

    target += this.avoid(fleet);
    this.targetHeading = target;

    /* --- helm ------------------------------------------------------------- */
    const turning = this.mode === MODE.TURN;
    const lim = b.spec.maxRudder * (turning || this.mode === MODE.IRONS ? 1 : 0.78);
    if (this.mode === MODE.IRONS && !p.finished) {
      // Getting out of irons, hold the helm hard over open-loop. A heading controller
      // chatters here, because the blade's sense reverses as the boat starts to go
      // astern and the boat sits right on that point.
      b.rudder = lim * -this.escapeDir * (way < -0.05 ? -1 : 1);
    } else {
      let err = wrapPi(target - b.psi);
      err += Math.sin(race.clock * 0.7 + this.noise) * (1 - this.skill) * 0.11;
      let cmd = err * (turning ? 3.1 : 2.0 + 0.9 * this.skill) - b.r * (1.7 + 0.5 * this.skill);
      if (way < -0.15) cmd = -cmd;   // making way astern, the helm works backwards
      b.rudder = Math.max(-lim, Math.min(lim, cmd));
    }

    /* --- sheets ----------------------------------------------------------- */
    this.think += dt;
    if (this.think > 0.25) {
      this.think = 0;
      const heelTarget = 19 + 6 * this.skill;
      this.trimTarget = b.bestTrim(trimMode, heelTarget) + easeExtra +
        (1 - this.skill) * Math.sin(this.noise + race.clock * 0.31) * 0.10;
      if (this.mode === MODE.BUILD) this.trimTarget += 0.04;   // a crack, for less leeway
    }
    b.slewTrim(Math.max(0, Math.min(1, this.trimTarget)), dt, 0.45 + 0.4 * this.skill);
    manageSpinnaker(b, dt);
    manageReef(b, dt);
  }

  /* Fast-angle tactics: lay the mark when we can, otherwise work the beat or the run,
     tacking at the layline or when we have strayed out of our corridor. */
  tactics(race, course, beat, run, downwind, pace) {
    const b = this.boat;
    const tel = b.tel;
    const w = tel.twFrom;
    const p = race.progress.get(b);
    const leg = course.legs[Math.min(p.leg, course.legs.length - 1)];
    // Off the start you are really beating to the windward mark; the line is a gate.
    const m = leg && leg.type === 'start' ? course.windward : course.legTarget(p.leg);
    const dx = m.x - b.x, dz = m.z - b.z;
    const bearing = Math.atan2(dx, dz);
    const dist = Math.hypot(dx, dz);
    const best = downwind ? run : beat;

    // The wind angle we would be sailing if we pointed straight at the mark.
    const twaToMark = wrapPi(w - bearing);

    // Can we lay it? Upwind the mark must be wider than our beating angle; downwind it
    // must be shallower than our running angle.
    const canLay = downwind ? Math.abs(twaToMark) <= best : Math.abs(twaToMark) >= best;
    if (canLay || dist < 26) {
      this.why = 'fetch';
      return this.clampSailable(bearing, w, beat, run, downwind);
    }

    // How far off the wind axis through the mark are we? Positive is to the right.
    const perp = (b.x - m.x) * Math.cos(w) - (b.z - m.z) * Math.sin(w);
    const room = Math.min(this.corridor, dist * 0.42 + 12);
    const layline = best * (0.955 + (1 - this.skill) * 0.09);

    let want = this.tack;
    if (Math.sign(twaToMark) === -this.tack && Math.abs(twaToMark) >= layline) want = -this.tack;
    else if (perp * -this.tack > room) want = -this.tack;

    if (want !== this.tack && b.u > pace * 0.72 && race.clock - this.lastTackAt > 6) {
      this.tack = want;
      this.lastTackAt = race.clock;
      this.turnTo = wrapPi(w - want * best);
      this.turnKind = downwind ? 'gybe' : 'tack';
      this.enter(MODE.TURN);
      return this.turnTo;
    }
    this.why = (downwind ? 'run ' : 'beat ') + (this.tack > 0 ? 'stbd' : 'port');
    return wrapPi(w - this.tack * best);
  }

  /* Never ask for a heading the boat cannot sail. */
  clampSailable(heading, w, beat, run, downwind) {
    const twa = wrapPi(w - heading);
    if (!downwind && Math.abs(twa) < beat) return wrapPi(w - (Math.sign(twa) || this.tack) * beat);
    if (downwind && Math.abs(twa) > run) return wrapPi(w - (Math.sign(twa) || this.tack) * run);
    return heading;
  }

  /* Pre-start: hold a station below your slice of the line, then time the run so you
     arrive with speed as the gun goes. */
  startApproach(race, course, beat) {
    const b = this.boat;
    const w = b.tel.twFrom;
    const t = race.timeToStart;
    const side = course.lineSide(b.x, b.z);       // negative is below the line
    const along = course.lineAlong(b.x, b.z);
    // Stay well inside the line ends: crossing outside a mark is not a start.
    const limit = course.lineLength * 0.40;
    const slot = Math.max(-limit, Math.min(limit, this.startSlot));

    if (t > 13) {
      this.why = 'pre.hold';
      const depth = -30 - Math.abs(slot) * 0.12;
      const sx = course.lineDirX * slot + course.lineNormX * depth;
      const sz = course.lineDirZ * slot + course.lineNormZ * depth;
      const dx = sx - b.x, dz = sz - b.z;
      if (Math.hypot(dx, dz) > 16) return this.clampSailable(Math.atan2(dx, dz), w, beat, Math.PI, false);
      // On station: reach up and down the line, which keeps some speed on.
      this.why = 'pre.jog';
      return wrapPi(w + (along > slot ? -1 : 1) * Math.PI * 0.46);
    }

    // Final approach: aim at our slot and try to arrive on the gun, not before it.
    const px = course.lineDirX * slot, pz = course.lineDirZ * slot;
    const dx = px - b.x, dz = pz - b.z;
    if (side > -4) {
      this.why = 'pre.stall';                     // too close, or over: kill speed
      this.trimTarget = 1;
      return wrapPi(w + Math.PI * 0.55);
    }
    this.why = 'pre.run';
    if (Math.hypot(dx, dz) / Math.max(1.2, b.tel.speed) < t - 3) this.trimTarget = 1;  // burn time
    return this.clampSailable(Math.atan2(dx, dz), w, beat, Math.PI, false);
  }

  /* A gentle steer away from anyone we are about to sail into. */
  avoid(fleet) {
    const b = this.boat;
    let turn = 0;
    for (const o of fleet) {
      if (o === b) continue;
      const dx = o.x - b.x, dz = o.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 900 || d2 < 1e-3) continue;
      const ahead = dx * Math.sin(b.psi) + dz * Math.cos(b.psi);
      if (ahead < 0) continue;                    // only what is in front of us matters
      const across = dx * Math.cos(b.psi) - dz * Math.sin(b.psi);
      turn -= Math.sign(across || 1) * (1 - Math.sqrt(d2) / 30) * 0.42;
    }
    return Math.max(-0.5, Math.min(0.5, turn));
  }
}
