/* Windward-leeward course, start sequence, mark roundings and standings.
   Marks are laid on the wind axis measured at the moment the course is set, so a
   shift during the race skews the beat exactly the way it does on the water. */

const TAU = Math.PI * 2;

export function wrapPi(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export const PHASE = {
  PRESTART: 'prestart',
  RACING: 'racing',
  FINISHED: 'finished'
};

/* One rounding requirement: get inside the proximity circle, then cross the exit
   line. Forgiving enough to be fun, strict enough that you cannot cut a corner. */
class Gate {
  constructor(kind, mark, exitX, exitZ, radius = 34) {
    this.kind = kind;         // 'mark' | 'line'
    this.mark = mark;
    this.exitX = exitX; this.exitZ = exitZ;   // unit normal you must cross going out
    this.radius = radius;
    this.side = mark ? mark.side : 'port';
  }
}

export class Course {
  constructor(opts = {}) {
    this.laps = opts.laps ?? 1;
    this.beatLength = opts.beatLength ?? 300;
    this.lineLength = opts.lineLength ?? 92;
    this.leewardOffset = opts.leewardOffset ?? 58;  // leeward mark sits just above the finish
    this.axis = opts.axis ?? 0;         // wind bearing the course was laid on
    this.marks = [];
    this.legs = [];
    this.build();
  }

  build() {
    const a = this.axis;
    const ux = Math.sin(a), uz = Math.cos(a);          // unit vector, upwind
    const rx = Math.cos(a), rz = -Math.sin(a);         // unit vector, to the right
    const half = this.lineLength / 2;

    // Start / finish line, centred on the origin and square to the wind axis.
    this.pin = { x: -rx * half, z: -rz * half, kind: 'pin', name: 'Pin' };
    this.boatEnd = { x: rx * half, z: rz * half, kind: 'committee', name: 'Committee' };
    // Windward mark at the top of the beat. The leeward mark sits a short way
    // upwind of the line, so the last leg is a run down through the finish.
    this.windward = { x: ux * this.beatLength, z: uz * this.beatLength, kind: 'windward', name: 'Windward', side: 'port' };
    this.leeward = { x: ux * this.leewardOffset, z: uz * this.leewardOffset, kind: 'leeward', name: 'Leeward', side: 'port' };
    this.marks = [this.pin, this.boatEnd, this.windward, this.leeward];

    // Line geometry: crossing "upwind" means the start, "downwind" means the finish.
    this.lineDirX = rx; this.lineDirZ = rz;
    this.lineNormX = ux; this.lineNormZ = uz;

    // The sequence of things you must do, in order.
    const legs = [];
    legs.push({ type: 'start', label: 'Start', target: null,
                gate: new Gate('line', null, ux, uz) });
    for (let lap = 0; lap < this.laps; lap++) {
      legs.push({ type: 'beat', label: 'Windward mark', target: this.windward,
                  gate: new Gate('mark', this.windward, ux, uz) });
      legs.push({ type: 'run', label: 'Leeward mark', target: this.leeward,
                  gate: new Gate('mark', this.leeward, -ux, -uz) });
    }
    legs.push({ type: 'finish', label: 'Finish', target: null,
                gate: new Gate('line', null, -ux, -uz) });
    this.legs = legs;
    this.totalLegs = legs.length;
  }

  /* Signed distance from the line: positive is upwind of it (the course side). */
  lineSide(x, z) {
    return x * this.lineNormX + z * this.lineNormZ;
  }
  /* How far along the line, from its centre. |value| < half is between the marks. */
  lineAlong(x, z) {
    return x * this.lineDirX + z * this.lineDirZ;
  }

  /* Where a boat on this leg is trying to get to. */
  legTarget(index) {
    const leg = this.legs[Math.min(index, this.legs.length - 1)];
    if (leg.target) return leg.target;
    // Line legs: aim for a point on the line, favouring the boat end slightly.
    const t = leg.type === 'start' ? 0.18 : 0.0;
    return {
      x: this.lineDirX * this.lineLength * t * 0.5,
      z: this.lineDirZ * this.lineLength * t * 0.5,
      kind: leg.type
    };
  }
}

/* Per-boat race progress. */
export class Progress {
  constructor(boat) {
    this.boat = boat;
    this.leg = 0;
    this.near = false;         // inside the current gate's proximity circle
    this.prevSide = 0;
    this.lap = 0;
    this.finished = false;
    this.finishTime = null;
    this.ocs = false;          // over early: must return and start again
    this.penaltyCleared = true;
    this.distToGo = Infinity;
    this.place = 1;
  }
}

export class Race {
  constructor(course, boats, opts = {}) {
    this.course = course;
    this.boats = boats;
    this.progress = new Map(boats.map(b => [b, new Progress(b)]));
    this.phase = PHASE.PRESTART;
    this.countdown = opts.countdown ?? 25;
    this.clock = 0;             // seconds since the gun (negative before it)
    this.messages = [];
    this.onEvent = opts.onEvent || (() => {});
    for (const b of boats) {
      const p = this.progress.get(b);
      p.prevSide = course.lineSide(b.x, b.z);
    }
  }

  get timeToStart() { return -this.clock; }

  update(dt) {
    const prevClock = this.clock;
    this.clock += dt;
    if (this.phase === PHASE.PRESTART) {
      if (prevClock < 0 && this.clock >= 0) {
        this.phase = PHASE.RACING;
        this.onEvent({ type: 'gun' });
        // Anyone on the course side of the line at the gun is over early.
        for (const b of this.boats) {
          const p = this.progress.get(b);
          if (this.course.lineSide(b.x, b.z) > 0) {
            p.ocs = true; p.penaltyCleared = false;
            this.onEvent({ type: 'ocs', boat: b });
          }
        }
      }
    }
    for (const b of this.boats) this.advance(b, dt);
    this.rank();
  }

  advance(boat, dt) {
    const c = this.course;
    const p = this.progress.get(boat);
    if (p.finished) return;

    // An early starter has to dip back below the line before they can race.
    if (p.ocs && !p.penaltyCleared) {
      if (c.lineSide(boat.x, boat.z) < -4) {
        p.penaltyCleared = true;
        p.prevSide = c.lineSide(boat.x, boat.z);
        this.onEvent({ type: 'cleared', boat });
      }
      return;
    }

    const leg = c.legs[p.leg];
    if (!leg) return;
    const gate = leg.gate;

    if (gate.kind === 'line') {
      const side = c.lineSide(boat.x, boat.z);
      const along = c.lineAlong(boat.x, boat.z);
      const wantUp = gate.exitX === c.lineNormX && gate.exitZ === c.lineNormZ;
      const crossed = wantUp ? (p.prevSide <= 0 && side > 0) : (p.prevSide >= 0 && side < 0);
      // Must cross between the marks, not around the end of the line.
      if (crossed && Math.abs(along) <= c.lineLength / 2 + 6) {
        if (this.phase !== PHASE.PRESTART || !wantUp) {
          p.leg++;
          if (leg.type === 'finish') {
            p.finished = true;
            p.finishTime = this.clock;
            this.onEvent({ type: 'finish', boat, time: this.clock });
          } else {
            this.onEvent({ type: 'started', boat });
          }
        }
      }
      p.prevSide = side;
    } else {
      const m = gate.mark;
      const dx = boat.x - m.x, dz = boat.z - m.z;
      const dist = Math.hypot(dx, dz);
      if (dist < gate.radius) p.near = true;
      if (p.near && (dx * gate.exitX + dz * gate.exitZ) > 0) {
        p.near = false;
        p.leg++;
        if (leg.type === 'beat') p.lap++;
        this.onEvent({ type: 'rounded', boat, mark: m });
        const nxt = c.legs[p.leg];
        if (nxt && nxt.gate.kind === 'line') p.prevSide = c.lineSide(boat.x, boat.z);
      }
    }

    // Distance still to sail, used for the running order.
    p.distToGo = this.remaining(boat, p);
  }

  remaining(boat, p) {
    const c = this.course;
    let total = 0;
    for (let i = p.leg; i < c.legs.length; i++) {
      const from = i === p.leg ? boat : c.legTarget(i - 1);
      const to = c.legTarget(i);
      total += Math.hypot(to.x - from.x, to.z - from.z);
    }
    return total;
  }

  rank() {
    const order = [...this.boats].sort((a, b) => {
      const pa = this.progress.get(a), pb = this.progress.get(b);
      if (pa.finished && pb.finished) return pa.finishTime - pb.finishTime;
      if (pa.finished) return -1;
      if (pb.finished) return 1;
      if (pb.leg !== pa.leg) return pb.leg - pa.leg;
      return pa.distToGo - pb.distToGo;
    });
    order.forEach((b, i) => { this.progress.get(b).place = i + 1; });
    this.order = order;
  }

  get allFinished() {
    return this.boats.every(b => this.progress.get(b).finished);
  }
}
