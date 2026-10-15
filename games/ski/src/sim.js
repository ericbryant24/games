/* The whole world, headless: the mountain, you, the three on your tail, and the rules.
   Nothing in here knows anything is being drawn, which is what lets tools/ski.mjs run
   whole chases with no screen.

   Rules: they follow your line and copy your jumps. Every one of them that crashes is
   one fewer on your tail; shake all three and you win, and your score is how long it
   took. Crash yourself — into a tree, a rock, a bad landing or one of them — and they win. */

import { Terrain } from './terrain.js';
import { Skier, RIDER, RADIUS } from './skier.js';
import { clamp, wrapAngle, mulberry32, hash } from './noise.js';

export const DT = 1 / 120;
const TRAIL_STEP = 0.5;          // metres between breadcrumbs on your line

/* The three on your tail. Who they are and what they are good at is rolled fresh
   for every run, from the run's seed. Each has five abilities, 0..1:
     landing  how big a hit they can absorb
     line     how faithfully they hold your line (a poor line cuts your corners)
     eyes     how early they spot a tree or rock, and how hard they swerve
     tricks   how fast they can spin and flip to copy yours
     carving  how tight they can turn
   Every one of them has a clear weakness and a clear strength, so there is always
   a way to shake each of them — if you can find it. */
export const TRAITS = ['landing', 'line', 'eyes', 'tricks', 'carving'];
export const TRAIT_LABEL = { landing: 'Landings', line: 'Line', eyes: 'Eyes', tricks: 'Tricks', carving: 'Carving' };
const WEAK = { landing: 'shaky landings', line: 'cuts corners', eyes: 'slow to spot trees',
  tricks: 'slow spinner', carving: 'wide turns' };
const STRONG = { landing: 'lands anything', line: 'glued to your line', eyes: 'sharp eyes',
  tricks: 'trick monster', carving: 'carves tight' };
const GAPS = [4.5, 8, 11.5];

/* The crew. You play one of them; the other three chase you. `outfit` picks their
   colours in render/rider.js. */
export const CHARACTERS = [
  { name: 'Eric', kind: 'ski', outfit: 0 },
  { name: 'Brent', kind: 'ski', outfit: 1 },
  { name: 'Tyler', kind: 'ski', outfit: 2 },
  { name: 'Trevor', kind: 'board', outfit: 3 }
];
export function character(name) { return CHARACTERS.find(c => c.name === name) || CHARACTERS[0]; }

export function rollChasers(seed, you = 'Eric') {
  const r = mulberry32(hash(seed, 4242));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const crew = shuffle(CHARACTERS.filter(c => c.name !== character(you).name));
  const weak = shuffle([...TRAITS]).slice(0, 3);
  return crew.map((who, i) => {
    const kind = who.kind;
    const strongPick = shuffle(TRAITS.filter(t => t !== weak[i]))[0];
    const a = {};
    for (const t of TRAITS) a[t] = 0.3 + r() * 0.45;
    a[weak[i]] = r() * 0.18;
    a[strongPick] = 0.82 + r() * 0.18;
    const base = RIDER[kind];
    const trick = 0.6 + 0.6 * a.tricks;
    const spec = {
      ...base,
      land: 7.0 + 4.2 * a.landing + (kind === 'board' ? 0.8 : 0),
      align: 0.6 + 0.35 * a.landing,
      spin: RIDER.player.spin * trick,
      flip: RIDER.player.flip * trick,
      carve: base.carve - 2 + 3.4 * a.carving,
      yaw: base.yaw * (0.8 + 0.3 * a.carving)
    };
    return {
      name: who.name, kind, outfit: who.outfit, spec, abilities: a,
      gap: GAPS[i],
      look: 0.74 - 0.44 * a.line,
      react: 0.30 + 0.32 * a.eyes,
      aware: 0.5 + 0.5 * a.eyes,
      blurb: `${STRONG[strongPick]}, ${WEAK[weak[i]]}`
    };
  });
}

/* "Backflip 360" and so on, or '' for a jump with nothing in it. */
export function trickName(t) {
  if (!t) return '';
  const spins = Math.round(Math.abs(t.spin) / Math.PI) * 180;
  const flips = Math.round(Math.abs(t.flip) / (Math.PI * 2));
  const parts = [];
  if (flips) parts.push((flips > 1 ? (flips === 2 ? 'Double ' : 'Triple ') : '') + (t.flip > 0 ? 'front flip' : 'backflip'));
  if (spins >= 180) parts.push(String(spins));
  const s = parts.join(' ');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export class Sim {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 1;
    this.terrain = new Terrain(this.seed);
    const T = this.terrain;
    const x0 = T.centre(0);
    const me = character(opts.character);
    const spec = me.kind === 'board' ? RIDER.playerBoard : RIDER.player;
    this.player = new Skier(spec, { name: me.name, isPlayer: true, x: x0, z: 0, terrain: T });
    this.player.outfit = me.outfit;
    this.roster = opts.roster || rollChasers(this.seed, me.name);
    this.chasers = this.roster.map((c, i) => {
      const sk = new Skier(c.spec, { name: c.name, x: x0 + (i - 1) * 1.6, z: -c.gap, terrain: T });
      sk.cfg = c;
      sk.outfit = c.outfit;
      return { skier: sk, cfg: c, idx: 0, crashTime: null, wasAir: false, copy: 0 };
    });
    this.tricks = new Map();      // your take-off number → the trick you landed
    this.riders = [this.player, ...this.chasers.map(c => c.skier)];

    // Your line, as breadcrumbs. Seeded with the run-in so they have something to follow.
    this.trail = [];
    this.trailBase = 0;           // breadcrumbs dropped off the front of the array
    for (let z = -26; z <= 0; z += TRAIL_STEP) {
      this.trail.push({ x: x0, y: T.height(x0, z), z, s: z + 26, jump: false, air: 0 });
    }
    this.playerS = 26;

    this.phase = 'countdown';     // countdown → run → won | lost
    this.clock = opts.countdown ?? 3;
    this.time = 0;
    this.runTime = 0;
    this.endTime = 0;
    this.distance = 0;
    this.events = [];
    this._acc = 0;
    this._pendingJump = false;
    this._near = [];
  }

  get remaining() { return this.chasers.filter(c => !c.skier.crashed).length; }

  /* Advance by dt seconds of wall time, in fixed steps. */
  step(dt) {
    this._acc += Math.min(dt, 0.25);
    while (this._acc >= DT) { this._acc -= DT; this._tick(DT); }
  }

  /* How far between the last two steps the clock now is, 0..1, for drawing. */
  get alpha() { return this._acc / DT; }

  _tick(dt) {
    const T = this.terrain;
    this.time += dt;
    for (const r of this.riders) r.remember();
    if (this.phase === 'countdown') {
      const before = Math.ceil(this.clock);
      this.clock -= dt;
      if (Math.ceil(this.clock) !== before && this.clock > 0) this.events.push({ type: 'count', n: Math.ceil(this.clock) });
      if (this.clock <= 0) { this.phase = 'run'; this.events.push({ type: 'go' }); }
      return;
    }
    if (this.phase === 'run') this.runTime += dt;

    const p = this.player;
    const wasCrashed = p.crashed, wasAir = p.air;
    p.step(dt, T);
    if (p.jumped) this._pendingJump = true;
    if (wasAir && !p.air && !p.crashed) {
      this.tricks.set(p.airId, p.lastTrick);
      const name = trickName(p.lastTrick);
      if (name) this.events.push({ type: 'trick', rider: p, name });
    }
    this._record();

    for (const c of this.chasers) {
      this._think(c, dt);
      c.skier.step(dt, T);
    }
    this._contacts();

    T.ensure(p.z + 320);
    let back = p.z;
    for (const c of this.chasers) if (!c.skier.crashed) back = Math.min(back, c.skier.z);
    T.prune(back - 90);
    this._trimTrail();
    this.distance = Math.max(this.distance, p.z);

    // Who went down this step?
    if (p.crashed && !wasCrashed) {
      this.events.push({ type: 'crash', rider: p, cause: p.cause, by: p.causeBy });
      if (this.phase === 'run') {
        this.phase = 'lost';
        this.endTime = this.runTime;
        this.events.push({ type: 'lost' });
      }
    }
    for (const c of this.chasers) {
      const s = c.skier;
      if (s.crashed && c.crashTime === null) {
        c.crashTime = this.runTime;
        this.events.push({ type: 'crash', rider: s, cause: s.cause, by: s.causeBy, left: this.remaining,
          trick: c.copy ? trickName(this.tricks.get(c.copy)) : '', late: this.phase === 'lost' });
        if (this.phase === 'run' && this.remaining === 0) {
          this.phase = 'won';
          this.endTime = this.runTime;
          this.events.push({ type: 'won', time: this.runTime });
        }
      }
    }
  }

  /* Drop a breadcrumb every half metre of your line. */
  _record() {
    const p = this.player;
    if (p.crashed) return;
    const last = this.trail[this.trail.length - 1];
    const d = Math.hypot(p.x - last.x, p.z - last.z);
    if (d < TRAIL_STEP) return;
    this.playerS = last.s + d;
    this.trail.push({ x: p.x, y: p.y, z: p.z, s: this.playerS, jump: this._pendingJump,
      air: p.air ? p.airId : 0 });
    this._pendingJump = false;
  }

  _trimTrail() {
    let min = Infinity;
    for (const c of this.chasers) if (!c.skier.crashed) min = Math.min(min, c.idx);
    if (min === Infinity) min = this.trail.length - 2;
    const cut = Math.max(0, min - 20);
    if (cut > 400) {
      this.trail.splice(0, cut);
      for (const c of this.chasers) c.idx = Math.max(0, c.idx - cut);
      this.trailBase += cut;
    }
  }

  /* One chaser's brain: find where they are on your line, aim a little way along it,
     keep their spacing, swerve round what they notice, copy your jumps. */
  _think(c, dt) {
    const s = c.skier, cfg = c.cfg, tr = this.trail, n = tr.length;
    s.boost = 0;
    if (s.crashed) return;

    if (this.player.crashed) {
      // You're down. They pull up and gloat.
      s.steer = 0; s.tuck = false; s.brake = 1; s.wantJump = false;
      return;
    }

    // Nearest breadcrumb, searching forward from where they were.
    const old = c.idx;
    let best = c.idx, bd = Infinity;
    for (let j = c.idx; j < Math.min(n, c.idx + 90); j++) {
      const dx = tr[j].x - s.x, dz = tr[j].z - s.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = j; }
    }
    c.idx = best;
    for (let j = old + 1; j <= c.idx; j++) if (tr[j].jump && !s.air) s.wantJump = true;

    const speed = Math.max(s.speed, 4);
    const look = clamp(cfg.look * speed, 2.5, 15);
    let ti = Math.min(n - 1, c.idx + Math.round(look / TRAIL_STEP));
    const tgt = tr[ti];
    const toPlayer = Math.hypot(this.player.x - s.x, this.player.z - s.z);

    // Taking off: whose jump is this? If you were in the air round here, they have to
    // copy whatever you did up there.
    if (s.air && !c.wasAir) {
      c.copy = 0;
      for (let j = Math.max(0, c.idx - 6); j < Math.min(n, c.idx + 16); j++) {
        if (tr[j].air) { c.copy = tr[j].air; break; }
      }
    }
    c.wasAir = s.air;

    let steer;
    s.flipIn = 0;
    if (s.air) {
      // In the air: match your trick — the one you landed, or the one you are still in.
      let spin = 0, flip = 0;
      const done = c.copy && this.tricks.get(c.copy);
      if (done) { spin = done.spin; flip = done.flip; }
      else if (c.copy && this.player.air && this.player.airId === c.copy) {
        spin = this.player.spinTotal; flip = this.player.pitch;
      }
      steer = clamp(-(spin - s.spinTotal) * 4, -1, 1);
      s.flipIn = clamp((flip - s.pitch) * 4, -1, 1);
    } else {
      const want = Math.atan2(tgt.x - s.x, tgt.z - s.z);
      const err = wrapAngle(want - s.psi);
      steer = clamp(-err * 2.4, -1, 1);
      steer += this._avoid(c, speed, err);
    }
    s.steer = clamp(steer, -1, 1);

    // Spacing: how far back along your line are they?
    const gap = this.playerS - tr[c.idx].s + Math.sqrt(bd) * 0.5;
    const err = gap - cfg.gap;
    s.tuck = err > 3;
    s.brake = err < -1.5 ? clamp((-err - 1.5) / 5, 0, 1) : 0;
    if (toPlayer < 3.2) s.brake = 1;
    // Don't ride up the back of the one in front.
    for (const o of this.chasers) {
      const r = o.skier;
      if (r === s || r.crashed) continue;
      const dx = r.x - s.x, dz = r.z - s.z;
      const ahead = dx * Math.sin(s.psi) + dz * Math.cos(s.psi);
      if (ahead > 0 && ahead < 4.5 && Math.abs(dx * Math.cos(s.psi) - dz * Math.sin(s.psi)) < 1.6) {
        s.brake = Math.max(s.brake, 1 - ahead / 4.5);
        s.tuck = false;
        s.boost = 0;
      }
    }
    s.boost = err > 9 ? clamp((err - 9) * 0.18, 0, 3.2) : 0;
  }

  /* Steering correction away from whatever is in front of them that they have noticed. */
  _avoid(c, speed, aimErr) {
    const s = c.skier, cfg = c.cfg;
    const R = clamp(cfg.react * speed, 3, 14) + 1.5;
    const fx = Math.sin(s.psi), fz = Math.cos(s.psi);
    const rx = -fz, rz = fx;                       // to their right
    let push = 0;
    const consider = (ox, oz, or) => {
      const dx = ox - s.x, dz = oz - s.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > R) return;
      const lat = dx * rx + dz * rz;
      const room = or + RADIUS + 0.55;
      if (Math.abs(lat) > room) return;
      const urgency = (1 - ahead / R) * (1 - 0.5 * Math.abs(lat) / room);
      // Straight at it: go round on the side they were turning to anyway.
      const side = Math.abs(lat) < 0.25 ? (aimErr > 0 ? 1 : -1) : (lat > 0 ? -1 : 1);
      push += side * urgency;
    };
    for (const o of this.terrain.nearby(s.x, s.z, R, this._near)) consider(o.x, o.z, o.r);
    for (const r of this.riders) if (r !== s && (r.crashed || !r.isPlayer)) consider(r.x, r.z, 0.6);
    return clamp(push * cfg.aware * 2.6, -1.6, 1.6);
  }

  /* Riders running into each other, or into someone already on the ground. */
  _contacts() {
    const R = this.riders;
    for (let i = 0; i < R.length; i++) {
      for (let j = i + 1; j < R.length; j++) {
        const a = R[i], b = R[j];
        if (a.crashed && b.crashed) continue;
        const dx = a.x - b.x, dz = a.z - b.z, dy = a.y - b.y;
        if (dx * dx + dz * dz > 0.8 * 0.8 || Math.abs(dy) > 1.3) continue;
        if (a.crashed) b.crash('wreck', a);
        else if (b.crashed) a.crash('wreck', b);
        else { a.crash('collision', b); b.crash('collision', a); }
      }
    }
  }
}
