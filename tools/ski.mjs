/* Headless chases for the ski game. The player is handed to a simple autopilot that
   looks down the hill for clear snow, and the three chasers do what they always do.
   Run it after touching the terrain, the physics or the chasers' brains.

     node ski.mjs [runs] [style] [seconds]
       style: weave   — clean, wide turns down the middle (default)
              lure    — deliberately skims past trees and rocks
              straight — barely turns at all
              tricks  — ollies a lot and spins 360s off anything big */

import { Sim } from '../games/ski/src/sim.js';
import { wrapAngle, clamp } from '../games/ski/src/noise.js';

const runs = Number(process.argv[2] || 8);
const style = process.argv[3] || 'weave';
const limit = Number(process.argv[4] || 180);
const verbose = !!process.env.VERBOSE;

function pilot(sim, t) {
  const p = sim.player, T = sim.terrain;
  const near = [];
  T.nearby(p.x, p.z + 16, 26, near);
  const drops = [];
  for (let k = Math.floor(p.z / 64) - 1; k <= Math.floor(p.z / 64) + 1; k++) {
    const seg = T.segs.get(k);
    if (seg) for (const f of seg.features) if (f.type === 'drop' && f.D > 5.5) drops.push(f);
  }
  const c = T.centre(p.z + 18), hw = T.halfWidth(p.z + 18);
  const swing = style === 'straight' ? 0 : Math.sin(t * (style === 'lure' ? 0.9 : 0.6)) * hw * 0.55;
  let best = 0, bestScore = -Infinity;
  for (let a = -1.1; a <= 1.1; a += 0.05) {
    const fx = Math.sin(a), fz = Math.cos(a);
    let score = -Math.abs((p.x + fx * 18) - (c + swing)) * 0.12 - Math.abs(a) * 0.6;
    for (const o of near) {
      const dx = o.x - p.x, dz = o.z - p.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > 26) continue;
      const lat = Math.abs(dx * fz - dz * fx);
      const clear = lat - o.r - 0.4;
      if (clear < 0.9) score -= 40 * (1 - ahead / 30);
      else if (style === 'lure' && clear < 2.2) score += 3;
    }
    for (const f of drops) {
      const ahead = f.z0 - p.z;
      if (ahead < 0 || ahead > 40 || style === 'straight') continue;
      const xAt = p.x + fx / fz * ahead;
      if (xAt > f.xa - 3 && xAt < f.xb + 3) score -= 30;
    }
    if (score > bestScore) { bestScore = score; best = a; }
  }
  const err = wrapAngle(best - p.psi);
  p.steer = p.air ? clamp(-wrapAngle(Math.atan2(p.vx, p.vz) - p.psi) * 3, -1, 1) : clamp(-err * 3, -1, 1);
  p.flipIn = 0;
  if (style === 'tricks' && p.air) {
    // Commit to a 360 on any jump that looks big enough, and finish it.
    if (p.airTime < 0.05) p._go = p.vy > 1.5 && p.speed > 12 && p.popCd < 0.3;
    if (p._go && p.spinTotal < Math.PI * 2 - 0.05) p.steer = -Math.min(1, (Math.PI * 2 - p.spinTotal) * 3);
  }
  if (style === 'tricks' && !p.air && Math.random() < 0.01) p.wantJump = true;
  p.tuck = p.speed < 12;
  p.brake = p.speed > 17 ? 0.5 : 0;
  if (style === 'lure' && !p.air && Math.random() < 0.004) p.wantJump = true;
}

const CAUSE = { tree: 'tree', rock: 'rock', hard: 'hard landing', sideways: 'landed sideways',
  wreck: 'hit a wreck', collision: 'collision', spin: 'botched spin', flip: 'botched flip', head: 'on head' };
let won = 0, lost = 0, open = 0;
const crashes = {}, times = [];
for (let r = 0; r < runs; r++) {
  const sim = new Sim({ seed: 1000 + r * 7, name: 'Bot' });
  let t = 0, airs = 0, maxAir = 0, vmax = 0;
  const dt = 1 / 60;
  while (t < limit && sim.phase !== 'lost' && sim.phase !== 'won') {
    pilot(sim, t);
    const pre = verbose ? sim.riders.map(q => q.airTime) : null;
    sim.step(dt); t += dt;
    if (verbose) sim.riders.forEach((q, i) => {
      if (q.landed > 4 || (q.crashed && q.crashT < dt * 1.01)) console.log(`   ${sim.runTime.toFixed(1)}s ${q.name.padEnd(5)} ` +
        `air ${pre[i].toFixed(2)} into ${q.landed.toFixed(1)} v ${q.speed.toFixed(1)} z ${q.z.toFixed(0)} ${q.crashed ? q.cause : ''}`);
    });
    vmax = Math.max(vmax, sim.player.speed);
    if (sim.player.air) maxAir = Math.max(maxAir, sim.player.airTime);
    for (const e of sim.events.splice(0)) {
      if (e.type === 'crash') {
        const k = `${e.rider.isPlayer ? 'YOU' : e.rider.name}:${e.cause}`;
        crashes[k] = (crashes[k] || 0) + 1;
      }
    }
    if (sim.player.jumped) airs++;
  }
  const res = sim.phase === 'won' ? 'WON ' : sim.phase === 'lost' ? 'lost' : 'open';
  if (sim.phase === 'won') { won++; times.push(sim.endTime); }
  else if (sim.phase === 'lost') lost++; else open++;
  const who = sim.chasers.map(c => `${c.cfg.name}:${c.crashTime === null ? '—' :
    c.crashTime.toFixed(0) + 's ' + CAUSE[c.skier.cause]}`).join('  ');
  console.log(`seed ${String(sim.seed).padStart(5)} ${res} ${sim.runTime.toFixed(1).padStart(6)}s ` +
    `${sim.distance.toFixed(0).padStart(5)}m  avg ${(sim.distance / Math.max(1, sim.runTime) * 3.6).toFixed(0)} km/h ` +
    `max ${(vmax * 3.6).toFixed(0)} maxAir ${maxAir.toFixed(2)}s` +
    (sim.player.crashed ? `  YOU: ${CAUSE[sim.player.cause]}` : '') + `\n      ${who}`);
}
console.log(`\n${style}: won ${won}, lost ${lost}, unresolved ${open}` +
  (times.length ? `, mean win ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}s` : ''));
console.log(crashes);
