/* Windward — the app around the simulation: menu, race loop, results.
   The world runs on a fixed timestep inside Sim; this file only decides how much time
   to hand it, then draws whatever came out. */

import { Sim, PHASE } from './sim.js';
import { View } from './render/view.js';
import { Hud } from './hud.js';
import { Controls } from './input.js';
import { KTS } from './physics.js';

const el = id => document.getElementById(id);
const scene = el('scene');
const hudCanvas = el('hud');

const SETTINGS_KEY = 'windward.settings.v1';
const defaults = { wind: 7, weather: 'bright', laps: 1, difficulty: 0.88,
  quality: 'medium', assist: 0 };

let settings = load();
let sim = null, view = null, hud = null, controls = null;
let running = false, paused = false, raf = 0, last = 0;
let finishedAt = 0;

/* --- settings ------------------------------------------------------------- */
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...defaults, ...s };
  } catch { return { ...defaults }; }
}
function save() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

/* Segmented controls in the start screen drive `settings` directly. */
for (const seg of document.querySelectorAll('.seg')) {
  const key = seg.parentElement.dataset.opt || seg.dataset.opt;
  const current = String(settings[key]);
  for (const b of seg.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === current);
    b.addEventListener('click', () => {
      for (const o of seg.querySelectorAll('button')) o.classList.remove('on');
      b.classList.add('on');
      const v = b.dataset.v;
      settings[key] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
      save();
    });
  }
}

/* --- lifecycle ------------------------------------------------------------ */
function startRace() {
  el('start').classList.add('hidden');
  el('results').classList.add('hidden');
  el('loading').classList.remove('hidden');
  el('menuBtn').hidden = false;

  // Let the browser paint the spinner before we build the scene.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (view) { view.dispose(); view = null; }
    sim = new Sim({
      windSpeed: Number(settings.wind),
      windDir: (Math.random() - 0.5) * Math.PI * 2,
      laps: Number(settings.laps),
      difficulty: Number(settings.difficulty),
      rivals: 4,
      countdown: 20,
      seed: Math.floor(Math.random() * 10000) + 1
    });
    view = new View(scene, sim, { quality: settings.quality, weather: settings.weather });
    hud = hud || new Hud(hudCanvas);
    hud.resize();
    controls = new Controls({ trim: 0.42 });
    controls.attach(el('helm'), el('sheet'));
    sim.player.trim = controls.trim;
    sim.player.autoTrim = Number(settings.assist) === 1;

    sim.race.onEvent = onRaceEvent;
    view.jumpToBoat();
    resize();

    hud.message('Get to the line for the gun', 'info', 3.4);
    finishedAt = 0;
    paused = false;
    running = true;
    last = performance.now();
    el('loading').classList.add('hidden');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }));
}

function onRaceEvent(e) {
  if (!hud) return;
  const you = e.boat && e.boat.isPlayer;
  switch (e.type) {
    case 'gun': hud.message('Gun!', 'big', 2.0); break;
    case 'ocs':
      if (you) hud.message('Over early — dip back below the line', 'bad', 4.5);
      break;
    case 'cleared': if (you) hud.message('Cleared — go racing', 'good', 2.4); break;
    case 'started': if (you) hud.message('Started', 'good', 1.6); break;
    case 'rounded':
      if (you) hud.message(`${e.mark.name} mark rounded`, 'good', 2.2);
      break;
    case 'finish':
      if (you) {
        const p = sim.progressOf(e.boat);
        hud.message(`Finished ${ordinal(p.place)}`, 'big', 4.0);
      }
      break;
  }
  if (sim.race.allFinished && !finishedAt) finishedAt = sim.time;
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000) || 0;
  last = now;
  if (!running || paused) return;

  controls.update(dt);
  sim.player.rudder = controls.rudder * sim.player.spec.maxRudder;
  // With the assist on, the boat trims itself and the gauge follows the sheet rather
  // than the other way round.
  if (sim.player.autoTrim) controls.trim = sim.player.trim;
  else sim.player.trim = controls.trim;

  sim.step(dt);
  view.update(dt, sim.time);
  view.render();
  hud.draw(sim, controls, dt);

  // Give the player a moment to watch the finish before the results come up.
  if (finishedAt && sim.time - finishedAt > 3.5) showResults();
  else if (!finishedAt && sim.progressOf(sim.player).finished &&
           sim.time - (sim.progressOf(sim.player).finishTime ?? 0) > 26) showResults();
}

function showResults() {
  running = false;
  el('menuBtn').hidden = true;
  const list = el('resultList');
  const you = sim.progressOf(sim.player);
  el('resultTitle').textContent = you.finished
    ? `${ordinal(you.place)} of ${sim.boats.length}` : 'Race over';
  list.innerHTML = sim.race.order.map(b => {
    const p = sim.progressOf(b);
    // Anyone still out on the course when the results come up has not retired.
    const t = p.finished ? clock(p.finishTime) : 'still racing';
    return `<li class="${b.isPlayer ? 'you' : ''}">
      <span class="pl">${p.finished ? p.place : '—'}</span>
      <span class="nm">${b.name}</span>
      <span class="sl">${b.sail}</span>
      <span class="tm">${t}</span></li>`;
  }).join('');
  el('results').classList.remove('hidden');
}

function quitToMenu() {
  running = false;
  cancelAnimationFrame(raf);
  el('paused').classList.add('hidden');
  el('results').classList.add('hidden');
  el('start').classList.remove('hidden');
  el('menuBtn').hidden = true;
}

function setPaused(p) {
  if (!running) return;
  paused = p;
  el('paused').classList.toggle('hidden', !p);
  if (!p) last = performance.now();
}

/* --- wiring --------------------------------------------------------------- */
el('go').addEventListener('click', startRace);
el('again').addEventListener('click', startRace);
el('backToMenu').addEventListener('click', quitToMenu);
el('menuBtn').addEventListener('click', () => setPaused(true));
el('resume').addEventListener('click', () => setPaused(false));
el('quit').addEventListener('click', quitToMenu);

function resize() {
  scene.style.width = '100%';
  scene.style.height = '100%';
  if (view) view.resize();
  if (hud) hud.resize();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && running) setPaused(!paused);
});
// Stop the page itself scrolling or zooming under the controls.
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); },
  { passive: false });

function clock(s) {
  const m = Math.floor(Math.abs(s) / 60);
  const r = Math.floor(Math.abs(s) % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* Expose a little for debugging from the console. */
window.windward = { get sim() { return sim; }, get view() { return view; }, startRace };
