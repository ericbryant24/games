/* The whole simulated world, with no reference to anything you can see. Keeping it
   renderer-free means the race can be run headless in a test (see tools/race.mjs). */

import { Boat, CLASS_7M } from './physics.js';
import { WaveField } from './water.js';
import { Wind } from './wind.js';
import { Course, Race, PHASE, wrapPi } from './course.js';
import { Skipper, manageSpinnaker, manageReef } from './ai.js';

const RIVALS = [
  { name: 'Halcyon',   sail: 'GBR 41', skill: 0.94, hue: 0.02 },
  { name: 'Kestrel',   sail: 'USA 17', skill: 0.86, hue: 0.13 },
  { name: 'Marlin',    sail: 'FRA 8',  skill: 0.78, hue: 0.55 },
  { name: 'Nordvind',  sail: 'NOR 23', skill: 0.70, hue: 0.83 },
  { name: 'Perihelion', sail: 'AUS 5', skill: 0.62, hue: 0.35 }
];

const SUBSTEP = 1 / 100;

export class Sim {
  constructor(opts = {}) {
    const windSpeed = opts.windSpeed ?? 7;
    const windDir = opts.windDir ?? 0;             // wind blows FROM this bearing
    this.time = 0;

    this.wind = new Wind(windDir, windSpeed);
    this.wind.shifty = opts.shifty ?? 1;
    this.wind.gustiness = opts.gustiness ?? 1;
    this.waves = new WaveField().configure(windDir + Math.PI, windSpeed,
      windDir + Math.PI - 0.55, opts.swell ?? 0.5);
    this.seaState = opts.seaState ?? 1;

    this.course = new Course({ axis: windDir, laps: opts.laps ?? 1 });
    this.boats = [];
    this.skippers = [];

    const fleetSize = Math.min(RIVALS.length, opts.rivals ?? 4);
    const slots = fleetSize + 1;
    const spread = this.course.lineLength * 0.86;

    // Everyone lines up below the line, spread across it, on starboard tack.
    const order = shuffled(slots, opts.seed ?? 1);
    this.player = new Boat(CLASS_7M, {
      name: opts.playerName || 'Kittiwake', sail: 'YOU', isPlayer: true
    });
    this.placeOnLine(this.player, order[0], slots, spread, windDir);
    this.boats.push(this.player);

    for (let i = 0; i < fleetSize; i++) {
      const r = RIVALS[i];
      const b = new Boat(CLASS_7M, { name: r.name, sail: r.sail });
      b.hue = r.hue;
      this.placeOnLine(b, order[i + 1], slots, spread, windDir);
      this.boats.push(b);
      const slot = ((order[i + 1] + 0.5) / slots - 0.5) * spread;
      this.skippers.push(new Skipper(b, {
        skill: clamp01(r.skill * (opts.difficulty ?? 1)),
        startSlot: slot
      }));
    }

    this.race = new Race(this.course, this.boats, {
      countdown: opts.countdown ?? 25,
      onEvent: e => this.events.push(e)
    });
    this.race.clock = -(opts.countdown ?? 25);
    this.events = [];
    this._acc = 0;
  }

  placeOnLine(boat, slotIndex, slots, spread, windDir) {
    const c = this.course;
    const off = ((slotIndex + 0.5) / slots - 0.5) * spread;
    const depth = 34 + (slotIndex % 3) * 9;
    boat.x = c.lineDirX * off - c.lineNormX * depth;
    boat.z = c.lineDirZ * off - c.lineNormZ * depth;
    boat.psi = wrapPi(windDir + Math.PI / 2 * 0.95);   // reaching along the line
    boat.u = 1.6;
    boat.trim = 0.45;
  }

  /* Advance the world. `dt` is real elapsed time; physics runs on fixed substeps. */
  step(dt) {
    this._acc += Math.min(dt, 0.25);
    let steps = 0;
    while (this._acc >= SUBSTEP && steps < 30) {
      this.tick(SUBSTEP);
      this._acc -= SUBSTEP;
      steps++;
    }
  }

  tick(dt) {
    this.time += dt;
    this.wind.update(dt);
    this.wind.setShadowSources(this.boats);
    this.race.update(dt);

    const env = { wind: this.wind, waves: this.waves, time: this.time };
    for (const s of this.skippers) s.update(dt, this.race, this.course, this.boats);
    if (this.player.autoTrim) {
      const mode = Math.abs(this.player.tel.twa) < 1.05 ? 'point' : 'drive';
      this.player.slewTrim(this.player.bestTrim(mode, 21), dt, 0.7);
    }
    manageSpinnaker(this.player, dt);
    manageReef(this.player, dt);

    for (const b of this.boats) b.step(dt, env);
    this.separate();
  }

  /* Hulls are solid: push overlapping boats apart instead of letting them merge. */
  separate() {
    const R = 3.6;
    for (let i = 0; i < this.boats.length; i++) {
      for (let j = i + 1; j < this.boats.length; j++) {
        const a = this.boats[i], b = this.boats[j];
        let dx = b.x - a.x, dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d > R * 2 || d < 1e-4) continue;
        const push = (R * 2 - d) * 0.5;
        dx /= d; dz /= d;
        a.x -= dx * push; a.z -= dz * push;
        b.x += dx * push; b.z += dz * push;
        // A collision costs both boats speed, the way a real one does.
        a.u *= 0.985; b.u *= 0.985;
      }
    }
  }

  progressOf(boat) { return this.race.progress.get(boat); }
  get phase() { return this.race.phase; }
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/* Deterministic shuffle so a given seed always lines the fleet up the same way. */
function shuffled(n, seed) {
  const a = Array.from({ length: n }, (_, i) => i);
  let s = seed * 9301 + 49297;
  for (let i = n - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export { PHASE };
