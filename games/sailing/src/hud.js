/* Instruments. Drawn on a 2D canvas over the scene: a heading ribbon along the top, a
   wind dial that shows where the breeze actually is relative to the bow, and gauges on
   each thumb pad so you can see what your thumbs are doing without looking away. */

import { KTS } from './physics.js';
import { beatAngle, runAngle } from './ai.js';
import { PHASE } from './course.js';

const DEG = 180 / Math.PI;
const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

const INK = '#eaf4ff';
const DIM = 'rgba(214,232,246,0.62)';
const FAINT = 'rgba(214,232,246,0.26)';
const GREEN = '#6fe39b';
const AMBER = '#ffcf5c';
const RED = '#ff7a6b';
const PANEL = 'rgba(6,20,32,0.42)';

function compass(rad) {
  let d = rad * DEG % 360;
  if (d < 0) d += 360;
  return d;
}
const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.messages = [];
    this.layout = {};
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w; this.h = h;
    const portrait = h >= w;
    const safeTop = 10;
    this.layout = {
      portrait,
      ribbon: { x: 14, y: safeTop, w: w - 28, h: 30 },
      dial: { cx: w / 2, cy: safeTop + 52 + (portrait ? 50 : 34), r: portrait ? 50 : 34 },
      padH: portrait ? Math.min(150, w * 0.40) : Math.min(160, w * 0.22)
    };
  }

  message(text, kind = 'info', seconds = 2.6) {
    this.messages.push({ text, kind, t: seconds });
  }

  /* @param sim  the world  @param controls  thumb state  @param dt  seconds */
  draw(sim, controls, dt) {
    const g = this.ctx;
    const L = this.layout;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.textBaseline = 'middle';

    // Instruments have to be readable against bright water and brighter sky.
    const scrim = g.createLinearGradient(0, 0, 0, L.dial.cy + L.dial.r + 60);
    scrim.addColorStop(0, 'rgba(4,16,28,0.52)');
    scrim.addColorStop(0.55, 'rgba(4,16,28,0.22)');
    scrim.addColorStop(1, 'rgba(4,16,28,0)');
    g.fillStyle = scrim;
    g.fillRect(0, 0, this.w, L.dial.cy + L.dial.r + 60);
    // And a little under the thumb gauges, which sit over open water.
    const foot = g.createLinearGradient(0, this.h - L.padH - 40, 0, this.h);
    foot.addColorStop(0, 'rgba(4,16,28,0)');
    foot.addColorStop(1, 'rgba(4,16,28,0.40)');
    g.fillStyle = foot;
    g.fillRect(0, this.h - L.padH - 40, this.w, L.padH + 40);

    const boat = sim.player;
    const tel = boat.tel;
    const race = sim.race;
    const prog = sim.progressOf(boat);

    this.drawRibbon(g, L.ribbon, sim, boat);
    this.drawDial(g, L.dial, sim, boat);
    this.drawSpeed(g, L, tel, boat);
    this.drawRace(g, L, sim, race, prog);
    this.drawHelm(g, L, controls, boat);
    this.drawSheet(g, L, controls, boat);
    this.drawMessages(g, L, dt);
  }

  /* --- heading ribbon ---------------------------------------------------- */
  drawRibbon(g, r, sim, boat) {
    const pxPerDeg = r.w / 96;
    const hdg = compass(boat.psi);
    const cx = r.x + r.w / 2;
    const at = (deg) => {
      let d = deg - hdg;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      return cx + d * pxPerDeg;
    };

    g.fillStyle = PANEL;
    roundRect(g, r.x, r.y, r.w, r.h, 8);
    g.fill();

    // The no-go zone: everything you cannot point at, shaded out.
    const wf = compass(boat.tel.twFrom);
    const beat = beatAngle(boat.tel.tws) * DEG;
    g.save();
    g.beginPath(); roundRect(g, r.x, r.y, r.w, r.h, 8); g.clip();
    g.fillStyle = 'rgba(255,120,100,0.16)';
    for (const off of [-360, 0, 360]) {
      g.fillRect(at(wf - beat + off), r.y, beat * 2 * pxPerDeg, r.h);
    }

    g.font = `500 9px ${FONT}`;
    g.textAlign = 'center';
    for (let d = Math.floor(hdg - 50); d <= hdg + 50; d++) {
      if (d % 5) continue;
      const x = at(d);
      if (x < r.x - 8 || x > r.x + r.w + 8) continue;
      const major = ((d % 30) + 30) % 30 === 0;
      g.strokeStyle = major ? DIM : FAINT;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, r.y + r.h - (major ? 12 : 6));
      g.lineTo(x, r.y + r.h - 2);
      g.stroke();
      if (major) {
        const dd = ((d % 360) + 360) % 360;
        g.fillStyle = DIM;
        g.fillText(CARDINALS[dd] || String(dd), x, r.y + 9);
      }
    }

    // Where the wind is from, and where the next mark is.
    this.marker(g, at(wf), r, '#9fd8ff', 'wind');
    const mark = sim.course.legTarget(sim.progressOf(boat).leg);
    const bearing = compass(Math.atan2(mark.x - boat.x, mark.z - boat.z));
    this.marker(g, at(bearing), r, AMBER, 'mark');
    g.restore();

    // The lubber line: our own heading.
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, r.y - 3); g.lineTo(cx, r.y + r.h + 3);
    g.stroke();
    g.fillStyle = INK;
    g.font = `700 11px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(String(Math.round(hdg)).padStart(3, '0'), cx, r.y + r.h + 12);
  }

  marker(g, x, r, color, kind) {
    g.fillStyle = color;
    g.beginPath();
    if (kind === 'wind') {
      g.moveTo(x, r.y + r.h - 3);
      g.lineTo(x - 5, r.y + r.h - 11);
      g.lineTo(x + 5, r.y + r.h - 11);
    } else {
      g.moveTo(x, r.y + 3);
      g.lineTo(x - 5, r.y + 11);
      g.lineTo(x + 5, r.y + 11);
    }
    g.closePath();
    g.fill();
  }

  /* --- wind dial ---------------------------------------------------------- */
  drawDial(g, d, sim, boat) {
    const tel = boat.tel;
    const beat = beatAngle(tel.tws);
    const run = runAngle(tel.tws);

    g.save();
    g.translate(d.cx, d.cy);
    g.fillStyle = PANEL;
    g.beginPath(); g.arc(0, 0, d.r + 6, 0, Math.PI * 2); g.fill();

    // Sectors: the no-go zone up top, and the too-deep zone astern.
    // arc() sweeps clockwise by default, so a wedge given back-to-front fills almost
    // the whole circle. Order the ends before drawing.
    const sector = (a0, a1, fill) => {
      g.fillStyle = fill;
      g.beginPath(); g.moveTo(0, 0);
      g.arc(0, 0, d.r, Math.min(a0, a1) - Math.PI / 2, Math.max(a0, a1) - Math.PI / 2);
      g.closePath(); g.fill();
    };
    sector(-beat, beat, 'rgba(255,120,100,0.18)');
    sector(run, 2.0 * Math.PI - run, 'rgba(255,120,100,0.13)');
    // The angles that pay, on both tacks.
    for (const s of [-1, 1]) {
      sector(s * beat, s * (beat + 0.10), 'rgba(111,227,155,0.55)');
      sector(s * run, s * (run - 0.10), 'rgba(111,227,155,0.42)');
    }

    g.strokeStyle = FAINT;
    g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, d.r, 0, Math.PI * 2); g.stroke();

    // Our boat, bow up, heeled the way she is actually heeled.
    g.save();
    g.rotate(0);
    g.fillStyle = 'rgba(234,244,255,0.92)';
    g.beginPath();
    g.moveTo(0, -12); g.lineTo(5, 8); g.lineTo(0, 5); g.lineTo(-5, 8);
    g.closePath(); g.fill();
    g.restore();

    // True and apparent wind, drawn as arrows coming in from where they blow from.
    this.windArrow(g, tel.twa, d.r, '#9fd8ff', 2.4, 'T');
    this.windArrow(g, tel.awa, d.r * 0.74, '#ffd9a0', 1.8, 'A');
    g.restore();

    // Readouts either side of the dial.
    // Readouts under the dial, clear of the speed and race blocks either side.
    const gap = this.layout.portrait ? 32 : 62;
    g.textAlign = 'center';
    g.fillStyle = DIM;
    g.font = `600 9.5px ${FONT}`;
    g.fillText('TWA', d.cx - gap, d.cy + d.r + 12);
    g.fillText('WIND', d.cx + gap, d.cy + d.r + 12);
    g.fillStyle = INK;
    g.font = `700 13px ${FONT}`;
    g.fillText(`${Math.round(Math.abs(tel.twa * DEG))}°${tel.twa >= 0 ? 'S' : 'P'}`,
      d.cx - gap, d.cy + d.r + 26);
    g.fillText(`${(tel.tws * KTS).toFixed(0)} kn`, d.cx + gap, d.cy + d.r + 26);
  }

  windArrow(g, twa, r, color, width, tag) {
    // twa is the angle the wind comes from, relative to the bow.
    const a = twa - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x * 0.34, y * 0.34);
    g.stroke();
    // Arrowhead pointing inward, the way the wind is blowing.
    const ux = -x / r, uy = -y / r;
    const px = -uy, py = ux;
    const tipX = x * 0.34, tipY = y * 0.34;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(tipX - ux * 8 + px * 4.5, tipY - uy * 8 + py * 4.5);
    g.lineTo(tipX - ux * 8 - px * 4.5, tipY - uy * 8 - py * 4.5);
    g.closePath(); g.fill();
  }

  /* --- speed block -------------------------------------------------------- */
  drawSpeed(g, L, tel, boat) {
    const x = 18, y = L.ribbon.y + L.ribbon.h + 60;   // clear of the menu chip
    g.textAlign = 'left';
    g.fillStyle = INK;
    g.font = `700 34px ${FONT}`;
    g.fillText((tel.speed * KTS).toFixed(1), x, y + 4);
    g.font = `600 11px ${FONT}`;
    g.fillStyle = DIM;
    g.fillText('kn', x + 58, y + 12);

    const vmg = tel.vmg * KTS;
    g.font = `600 10px ${FONT}`;
    g.fillStyle = DIM;
    g.fillText('VMG', x, y + 26);
    g.fillStyle = vmg > 0 ? GREEN : INK;
    g.font = `700 12px ${FONT}`;
    g.fillText(`${Math.abs(vmg).toFixed(1)}`, x + 28, y + 26);

    // Inclinometer: a bubble that runs downhill, like the real thing.
    const bx = x, by = y + 46, bw = 68, bh = 7;
    g.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(g, bx, by, bw, bh, 3.5); g.fill();
    const heel = Math.max(-1, Math.min(1, boat.phi / 0.7));
    g.fillStyle = Math.abs(boat.tel.heelDeg) > 26 ? AMBER : 'rgba(159,216,255,0.9)';
    g.beginPath();
    g.arc(bx + bw / 2 + heel * (bw / 2 - 5), by + bh / 2, 4.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = DIM;
    g.font = `600 10px ${FONT}`;
    g.fillText(`${Math.abs(boat.tel.heelDeg).toFixed(0)}°`, bx + bw + 8, by + bh / 2);
    if (boat.reef > 0.05) {
      g.fillStyle = AMBER;
      g.font = `700 10px ${FONT}`;
      g.fillText('REEFED', bx, by + 20);
    }
  }

  /* --- race state --------------------------------------------------------- */
  drawRace(g, L, sim, race, prog) {
    const x = this.w - 18;
    const y = L.ribbon.y + L.ribbon.h + 60;   // clear of the menu chip
    g.textAlign = 'right';

    if (race.phase === PHASE.PRESTART) {
      const t = Math.max(0, race.timeToStart);
      g.fillStyle = t < 6 ? AMBER : INK;
      g.font = `700 34px ${FONT}`;
      g.fillText(t.toFixed(1), x, y + 4);
      g.fillStyle = DIM;
      g.font = `600 11px ${FONT}`;
      g.fillText('to start', x, y + 26);
    } else {
      g.fillStyle = INK;
      g.font = `700 26px ${FONT}`;
      g.fillText(clock(race.clock), x, y);
      g.fillStyle = DIM;
      g.font = `600 11px ${FONT}`;
      const n = sim.boats.length;
      g.fillText(`${ordinal(prog.place)} of ${n}`, x, y + 22);
    }

    const leg = sim.course.legs[Math.min(prog.leg, sim.course.legs.length - 1)];
    const mark = sim.course.legTarget(prog.leg);
    const dist = Math.hypot(mark.x - sim.player.x, mark.z - sim.player.z);
    g.fillStyle = DIM;
    g.font = `600 11px ${FONT}`;
    g.fillText(leg ? leg.label.toUpperCase() : '', x, y + 44);
    g.fillStyle = INK;
    g.font = `700 13px ${FONT}`;
    g.fillText(`${dist < 950 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'}`, x, y + 62);

    if (prog.ocs && !prog.penaltyCleared) {
      g.fillStyle = RED;
      g.font = `700 12px ${FONT}`;
      g.fillText('OVER EARLY — GO BACK', x, y + 82);
    }
  }

  /* --- thumb gauges ------------------------------------------------------- */
  drawHelm(g, L, controls, boat) {
    const size = L.padH;
    const cx = 18 + size / 2;
    const cy = this.h - 22 - size / 2;
    const r = size * 0.40;

    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, r + 12, Math.PI * 0.08, Math.PI * 0.92); g.stroke();

    // Tiller arc with the rudder angle on it.
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
    const t = controls.rudder;
    const a = Math.PI * 0.5 + t * Math.PI * 0.35;
    g.strokeStyle = Math.abs(t) > 0.85 ? AMBER : '#9fd8ff';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, r, Math.PI * 0.5, a, t < 0);
    g.stroke();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 8, 0, Math.PI * 2);
    g.fill();

    g.textAlign = 'center';
    g.fillStyle = DIM;
    g.font = `600 10px ${FONT}`;
    g.fillText('HELM', cx, cy - r - 2);
    g.fillStyle = INK;
    g.font = `700 12px ${FONT}`;
    g.fillText(`${Math.abs(boat.rudder * DEG).toFixed(0)}°`, cx, cy + 16);
  }

  drawSheet(g, L, controls, boat) {
    const size = L.padH;
    const w = 16;
    const x = this.w - 18 - size / 2 - w / 2;
    const top = this.h - 22 - size + 14;
    const h = size - 40;
    const tel = boat.tel;

    g.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(g, x, top, w, h, 8); g.fill();

    // Where the sheet is. Up is trimmed on, down is eased.
    const y = top + controls.trim * h;
    g.fillStyle = 'rgba(159,216,255,0.30)';
    roundRect(g, x, top, w, Math.max(2, y - top), 8); g.fill();

    // Where it wants to be, from the boat's own trim solver — a teaching aid.
    const best = boat.bestTrim(Math.abs(tel.twa) < 1.05 ? 'point' : 'drive', 21);
    const by = top + best * h;
    g.strokeStyle = GREEN;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 7, by); g.lineTo(x + w + 7, by); g.stroke();

    g.fillStyle = INK;
    g.beginPath();
    roundRect(g, x - 5, y - 5, w + 10, 10, 5);
    g.fill();

    g.textAlign = 'center';
    g.fillStyle = boat.autoTrim ? GREEN : DIM;
    g.font = `600 10px ${FONT}`;
    g.fillText(boat.autoTrim ? 'SHEET · AUTO' : 'SHEET', x + w / 2, top - 10);
    g.fillText('IN', x + w / 2 + 26, top + 6);
    g.fillText('OUT', x + w / 2 + 26, top + h - 6);

    // Telltale: the one thing that tells you whether the sail is working.
    let label = 'DRIVING', color = GREEN;
    if (tel.backed) { label = 'BACKED'; color = RED; }
    else if (tel.luffing) { label = 'LUFFING'; color = AMBER; }
    else if (tel.stalled) { label = 'STALLED'; color = AMBER; }
    else if (boat.spinnaker) { label = 'KITE UP'; color = GREEN; }
    g.fillStyle = color;
    g.font = `700 11px ${FONT}`;
    g.fillText(label, this.w - 18 - size / 2, this.h - 26);
  }

  drawMessages(g, L, dt) {
    const y0 = L.dial.cy + L.dial.r + 52;
    g.textAlign = 'center';
    let i = 0;
    for (const m of this.messages) {
      m.t -= dt;
      const alpha = Math.min(1, m.t * 1.6);
      g.globalAlpha = Math.max(0, alpha);
      g.fillStyle = m.kind === 'bad' ? RED : m.kind === 'good' ? GREEN : INK;
      g.font = `700 ${m.kind === 'big' ? 22 : 15}px ${FONT}`;
      g.fillText(m.text, this.w / 2, y0 + i * 24);
      g.globalAlpha = 1;
      i++;
    }
    this.messages = this.messages.filter(m => m.t > 0).slice(-3);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function clock(s) {
  const m = Math.floor(Math.abs(s) / 60);
  const r = Math.floor(Math.abs(s) % 60);
  return `${s < 0 ? '-' : ''}${m}:${String(r).padStart(2, '0')}`;
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
