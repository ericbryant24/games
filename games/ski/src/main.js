/* Copycats — the app around the simulation: menu, countdown, the chase, results and
   the scoreboard. The world steps on a fixed clock inside Sim; this file feeds it your
   thumbs and draws whatever comes out. */

import { Sim, TRAITS, TRAIT_LABEL, CHARACTERS, character, trickName } from './sim.js';
import { View } from './render/view.js';
import { OUTFITS } from './render/rider.js';
import { Hud, fmt } from './hud.js';
import { Controls } from './input.js';

const el = id => document.getElementById(id);
const scene = el('scene');
const COLORS = OUTFITS.map(o => '#' + o.jacket.toString(16).padStart(6, '0'));

const SETTINGS_KEY = 'copycats.settings.v1';
const SCORES_KEY = 'copycats.scores.v1';

let settings = { character: 'Eric', ...load(SETTINGS_KEY, {}) };
let scores = load(SCORES_KEY, []);
let sim = null, view = null, hud = null;
const controls = new Controls().attach(el('surface'));
let running = false, paused = false, raf = 0, last = 0, endAt = 0;
let air = null;
let freeze = false;   // debugging: draw without stepping the world   // how the current jump started, for telling tricks from steering

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

/* --- menu ----------------------------------------------------------------- */
/* Who you are. Pick one; the other three come after you. */
const picker = el('who');
picker.innerHTML = CHARACTERS.map(c => `<button data-v="${c.name}">
  <i style="background:${COLORS[c.outfit]}"></i>${c.name}<em>${c.kind === 'board' ? 'snowboard' : 'skis'}</em></button>`).join('');

for (const seg of document.querySelectorAll('.seg')) {
  const key = seg.dataset.opt;
  for (const b of seg.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === String(settings[key]));
    b.addEventListener('click', () => {
      for (const o of seg.querySelectorAll('button')) o.classList.remove('on');
      b.classList.add('on');
      settings[key] = b.dataset.v;
      save(SETTINGS_KEY, settings);
    });
  }
}

function playerName() { return character(settings.character).name; }
function best() { return scores.length ? scores[0].time : 0; }

function renderBoard(highlight) {
  const wrap = el('boardWrap');
  wrap.classList.toggle('hidden', !scores.length);
  el('board').innerHTML = scores.slice(0, 5).map(s =>
    `<li class="${s === highlight ? 'me' : ''}"><span class="n">${esc(s.name)}</span><span class="t">${fmt(s.time)}</span></li>`).join('');
}
renderBoard();

/* --- lifecycle ------------------------------------------------------------ */
function start() {
  el('start').classList.add('hidden');
  el('results').classList.add('hidden');
  el('paused').classList.add('hidden');
  el('loading').classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { build(); } catch (err) { fail(err); return; }
    el('loading').classList.add('hidden');
    el('menuBtn').hidden = false;
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }));
}

function build() {
  if (view) { view.dispose(); view = null; }
  sim = new Sim({ seed: Math.floor(Math.random() * 1e9), character: playerName(), countdown: 4 });
  view = new View(scene, sim, { quality: 'high', camera: 'chase' });
  hud = hud || new Hud(el('hud'));
  hud.msgs = []; hud.pop = null;
  hud.resize();
  controls.reset();
  air = null;
  showRoster();
  view.update(0);
  running = true; paused = false; endAt = 0;
}

function fail(err) {
  running = false;
  el('loading').classList.add('hidden');
  el('start').classList.remove('hidden');
  const box = el('start').querySelector('.sheetbox');
  if (!box.querySelector('.gl-error')) {
    const p = document.createElement('p');
    p.className = 'sub gl-error';
    p.style.color = '#c8352a';
    p.textContent = 'This game needs WebGL and this browser would not give it to us. ' +
      'Try another browser, or switch hardware acceleration back on. (' +
      String((err && err.message) || err).slice(0, 120) + ')';
    box.insertBefore(p, box.querySelector('.field'));
  }
  console.error(err);
}

function showRoster() {
  el('rosterList').innerHTML = sim.chasers.map((c, i) => {
    const a = c.cfg.abilities;
    const lo = Math.min(...TRAITS.map(t => a[t])), hi = Math.max(...TRAITS.map(t => a[t]));
    return `<li><span class="dot" style="background:${COLORS[c.cfg.outfit]}"></span>
      <span class="nm">${c.cfg.name}<em>${c.cfg.kind === 'board' ? 'snowboard' : 'skis'}</em></span>
      <span class="bl">${c.cfg.blurb}</span>
      <div class="bars">${TRAITS.map(t => `<span class="bar ${a[t] === lo ? 'weak' : a[t] === hi ? 'strong' : ''}">
        ${TRAIT_LABEL[t]}<i><b style="width:${Math.round(a[t] * 100)}%"></b></i></span>`).join('')}</div></li>`;
  }).join('');
  el('rosterList').insertAdjacentHTML('beforeend',
    '<li class="hint"><b>Hold right</b> to turn left, <b>left</b> to turn right · <b>hold both</b> to crouch, <b>let go</b> to jump</li>');
  el('roster').classList.remove('low');
  el('roster').classList.remove('hidden');
}

/* --- the loop ------------------------------------------------------------- */
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000) || 0;
  last = now;
  if (!running || paused) return;

  controls.update(dt);
  drive(dt);
  if (!freeze) sim.step(dt);
  for (const e of sim.events.splice(0)) onEvent(e);

  view.update(dt);
  view.render();
  hud.draw(sim, view, controls, dt, best(), COLORS);

  if (endAt && performance.now() > endAt) results();
}

/* Your thumb → the skier. On the snow: carve, tuck, brake. In the air the same drags
   spin and flip — but only once you have moved your thumb since take-off, so carving
   over a bump does not throw you into an accidental spin. */
function drive(dt) {
  const p = sim.player;
  // A crouch let go on the snow is a jump; one let go in the air is just letting go.
  if (controls.jump) { p.wantJump = sim.phase !== 'countdown' && !p.air; controls.jump = false; }
  const pushes = controls.skate;
  controls.skate = 0;
  if (p.crashed) return;
  // The poles cross over: hold the right side to turn left, the left side to turn right.
  const flip = -1;
  if (!p.air) {
    air = null;
    p.steer = controls.steer * flip;
    p.tuck = controls.crouch;
    p.brake = controls.brake;
    p.flipIn = 0;
    // Alternate taps skate you along — a push each, worth less the faster you go.
    if (pushes && sim.phase === 'run' && p.speed < 12) {
      const k = pushes * 1.4 * (1 - p.speed / 12);
      p.vx += Math.sin(p.psi) * k; p.vz += Math.cos(p.psi) * k;
      p.skating = 0.5;
    }
    return;
  }
  // In the air a pole held from before take-off does nothing until you press again,
  // so carving over a lip does not throw you into a spin you never asked for.
  if (!air) air = { steer: controls.steer, vert: controls.vert, spin: Math.abs(controls.steer) < 0.3, flip: Math.abs(controls.vert) < 0.3 };
  if (!air.spin && Math.abs(controls.steer - air.steer) > 0.5) air.spin = true;
  if (!air.flip && Math.abs(controls.vert - air.vert) > 0.5) air.flip = true;
  const live = p.airTime > 0.08;
  p.steer = air.spin && live && Math.abs(controls.steer) > 0.2 ? Math.max(-1, Math.min(1, controls.steer)) * flip : 0;
  p.flipIn = air.flip && live && Math.abs(controls.vert) > 0.2 ? controls.vert : 0;
  p.tuck = false; p.brake = 0;
}

function onEvent(e) {
  switch (e.type) {
    case 'count': hud.message(String(e.n), 'big', 0.9); break;
    case 'go':
      hud.message('GO!', 'big', 1.1);
      setTimeout(() => el('roster').classList.add('hidden'), 1200);
      break;
    case 'trick': hud.trick(e.name); break;
    case 'crash': {
      const r = e.rider;
      if (r.isPlayer) {
        hud.message('Wipeout!', 'bad', 3, `You ${cause(e, true)}`);
      } else if (!e.late) {
        const left = e.left;
        hud.message(`${r.name} ${cause(e, false)}`, 'good', 2.6,
          left ? `${left} still on your tail` : '');
      }
      break;
    }
    case 'won':
      hud.message('Lost them all!', 'big', 3.5, fmt(e.time));
      endAt = performance.now() + 2600;
      break;
    case 'lost':
      endAt = performance.now() + 2400;
      break;
  }
}

function cause(e, you) {
  const by = e.by ? e.by.name : 'someone';
  const their = you ? 'your' : 'their';
  switch (e.cause) {
    case 'tree': return you ? 'hit a tree' : 'hugged a tree';
    case 'rock': return 'hit a rock';
    case 'hard': return 'landed too hard';
    case 'sideways': return 'landed sideways';
    case 'spin': return e.trick ? `botched the ${e.trick.toLowerCase()}` : 'botched the spin';
    case 'flip': return e.trick ? `botched the ${e.trick.toLowerCase()}` : 'under-rotated the flip';
    case 'head': return `landed on ${their} head`;
    case 'wreck': return `ploughed into ${by}`;
    case 'collision': return `collided with ${by}`;
  }
  return 'went down';
}

function results() {
  endAt = 0;
  running = false;
  el('menuBtn').hidden = true;
  el('roster').classList.add('hidden');
  const won = sim.phase === 'won';
  const t = sim.endTime;
  let entry = null, rank = -1;
  if (won) {
    entry = { name: playerName(), time: t, at: Date.now() };
    scores.push(entry);
    scores.sort((a, b) => a.time - b.time);
    scores = scores.slice(0, 20);
    rank = scores.indexOf(entry);
    save(SCORES_KEY, scores);
  }
  const shaken = sim.chasers.filter(c => c.skier.crashed && c.crashTime !== null && (won || c.crashTime <= t)).length;
  el('resultTitle').innerHTML = won
    ? `Lost them in ${fmt(t)}${rank === 0 ? '<span class="badge">Best</span>' : ''}`
    : 'They got you';
  el('resultSub').textContent = won
    ? (rank >= 0 ? `#${rank + 1} on your scoreboard. ` : '') + `${Math.round(sim.distance)} m of mountain.`
    : `You ${cause({ cause: sim.player.cause, by: sim.player.causeBy }, true)} after ${fmt(t)}, ` +
      `with ${shaken} of 3 shaken off.`;
  el('resultList').innerHTML = sim.chasers.map((c, i) => {
    const down = c.crashTime !== null && (won || c.crashTime <= t);
    return `<li class="${down ? '' : 'up'}"><span class="dot" style="background:${COLORS[c.cfg.outfit]}"></span>
      <span class="nm">${c.cfg.name}</span>
      <span class="cs">${down ? cause({ cause: c.skier.cause, by: c.skier.causeBy, trick: '' }, false) : 'still on your tail'}</span>
      <span class="tm">${down ? fmt(c.crashTime) : '—'}</span></li>`;
  }).join('');
  renderBoard(entry);
  el('results').classList.remove('hidden');
}

function toMenu() {
  running = false;
  endAt = 0;
  el('paused').classList.add('hidden');
  el('results').classList.add('hidden');
  el('roster').classList.add('hidden');
  el('menuBtn').hidden = true;
  el('start').classList.remove('hidden');
  renderBoard();
}

function setPaused(p) {
  if (!running) return;
  paused = p;
  el('paused').classList.toggle('hidden', !p);
  if (!p) { last = performance.now(); controls.reset(); }
}

/* --- wiring --------------------------------------------------------------- */
el('go').addEventListener('click', start);
el('again').addEventListener('click', start);
el('toMenu').addEventListener('click', toMenu);
el('menuBtn').addEventListener('click', () => setPaused(true));
el('resume').addEventListener('click', () => setPaused(false));
el('quit').addEventListener('click', toMenu);

function resize() {
  if (view) view.resize();
  if (hud) hud.resize();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 150));
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && running) setPaused(!paused);
  else if (e.key === 'Enter' && !running && !el('results').classList.contains('hidden')) start();
});
document.addEventListener('gesturestart', e => e.preventDefault());

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

/* A little for the console. */
window.copycats = { get sim() { return sim; }, get view() { return view; }, start, trickName,
  set freeze(v) { freeze = v; } };
