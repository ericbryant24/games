/* Headless race: checks the fleet can actually get round the course. */
import { Sim, PHASE } from '../games/sailing/src/sim.js';
import { KTS } from '../games/sailing/src/physics.js';

const windSpeed = Number(process.argv[2] || 7);
const laps = Number(process.argv[3] || 1);
const sim = new Sim({ windSpeed, laps, rivals: 4, seed: 3 });
// The player's boat is sailed by the same autopilot as the fleet, for the test only.
import { Skipper } from '../games/sailing/src/ai.js';
sim.skippers.push(new Skipper(sim.player, { skill: 0.8, startSlot: 0 }));

const dt = 1 / 50;
let t = 0;
const seen = new Set();
while (t < 60 * 22 && !sim.race.allFinished) {
  sim.step(dt); t += dt;
  for (const e of sim.events.splice(0)) {
    const k = `${e.type}:${e.boat?.name || ''}`;
    if (e.type === 'gun') console.log(`  [${fmt(sim.race.clock)}] GUN`);
    else if (!seen.has(k) || e.type === 'rounded' || e.type === 'finish') {
      seen.add(k);
      console.log(`  [${fmt(sim.race.clock)}] ${e.type.padEnd(8)} ${(e.boat?.name || '').padEnd(11)}` +
        (e.mark ? e.mark.kind : '') + (e.time !== undefined ? ` ${fmt(e.time)}` : ''));
    }
  }
}
function fmt(s) { const m = Math.floor(Math.abs(s) / 60); const r = Math.abs(s) % 60;
  const rr = Math.floor(r); return `${s < 0 ? "-" : " "}${m}:${String(rr).padStart(2, "0")}`; }

console.log(`\nTWS ${(windSpeed * KTS).toFixed(1)} kn, ${laps} lap(s) — after ${fmt(t)}`);
console.log('place boat         status        leg  finish   avg kn');
for (const b of sim.race.order) {
  const p = sim.progressOf(b);
  const legName = sim.course.legs[Math.min(p.leg, sim.course.legs.length - 1)].label;
  console.log(String(p.place).padStart(4), b.name.padEnd(12),
    (p.finished ? 'finished' : legName).padEnd(13), String(p.leg).padStart(3),
    (p.finished ? fmt(p.finishTime) : '   —  ').padStart(8),
    p.finished ? ((sim.race.remaining(b, { leg: 0 }) / p.finishTime) * KTS).toFixed(2).padStart(8) : '');
}
if (!sim.race.allFinished) { console.log('\n*** NOT EVERYONE FINISHED ***'); process.exitCode = 1; }
