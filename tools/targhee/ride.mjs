/* Headless runs down the real mountain: an autopilot heads down the fall line,
   weaving and dodging trees, with the chasers on its tail.
     node ride.mjs [place] [runs] */
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { Mountain } from '../../games/ski/src/mountain.js';
import { Sim } from '../../games/ski/src/sim.js';
import { wrapAngle, clamp } from '../../games/ski/src/noise.js';

const meta = JSON.parse(fs.readFileSync('../../games/ski/data/targhee.json', 'utf8'));
const png = PNG.sync.read(fs.readFileSync('../../games/ski/data/targhee.png'));
const place = process.argv[2] || 'fred', runs = Number(process.argv[3] || 4);

for (let r = 0; r < runs; r++) {
  const T = new Mountain(meta, png.data, 7 + r);
  const sim = new Sim({ seed: 50 + r, terrain: T, start: T.start(place), countdown: 0 });
  const p = sim.player;
  let t = 0, maxV = 0, near = [];
  const y0 = p.y;
  while (t < 400 && sim.phase === 'run' || (t < 0.1)) {
    const down = T.downhill(p.x, p.z, 20) ?? p.psi;
    const weave = Math.sin(t * 0.7) * 0.55;
    T.nearby(p.x, p.z, 26, near);
    let best = down + weave, bs = -1e9;
    for (let a = -1.2; a <= 1.2; a += 0.08) {
      const h = down + a, fx = Math.sin(h), fz = Math.cos(h);
      let sc = -Math.abs(a - weave) * 2;
      for (const o of near) {
        const dx = o.x - p.x, dz = o.z - p.z, ah = dx * fx + dz * fz;
        if (ah < 0 || ah > 22) continue;
        if (Math.abs(dx * fz - dz * fx) - o.r < 1.3) sc -= 30 * (1 - ah / 26);
      }
      if (sc > bs) { bs = sc; best = h; }
    }
    p.steer = p.air ? 0 : clamp(-wrapAngle(best - p.psi) * 3, -1, 1);
    p.brake = p.speed > 16 ? 0.6 : 0; p.tuck = false;
    sim.step(1 / 60); t += 1 / 60;
    maxV = Math.max(maxV, p.speed);
    sim.events.length = 0;
  }
  const down = Math.round(y0 - p.y);
  console.log(`${T.places[place].name}: ${sim.phase.padEnd(5)} after ${sim.runTime.toFixed(0)} s, ` +
    `${Math.round(sim.distance)} m skied, ${down} m vertical, top ${(maxV * 3.6).toFixed(0)} km/h` +
    (p.crashed ? `, you: ${p.cause}` : '') + ` | chasers: ` +
    sim.chasers.map(c => `${c.cfg.name} ${c.lives} li`).join(', ') + ` | trees near start: ${T.nearby(T.places[place].x, T.places[place].z, 60, []).length}`);
}
