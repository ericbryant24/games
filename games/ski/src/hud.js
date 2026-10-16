/* Everything drawn over the scene: the clock, who is still on your tail, name tags,
   arrows for anyone off the bottom of the screen, messages, and your thumb. */

const FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
const INK = '#13233a';

export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.msgs = [];
    this.pop = null;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w; this.h = h;
  }

  message(text, kind = 'info', seconds = 2.4, sub = '') {
    // Keep the stack short: a newer message pushes the oldest out.
    this.msgs.push({ text, sub, kind, t: seconds, life: seconds });
    if (this.msgs.length > 3) this.msgs.shift();
  }

  trick(text) { this.pop = { text, t: 1.4 }; }

  draw(sim, view, controls, dt, best, colors) {
    const g = this.g, w = this.w, h = this.h;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const top = 12;

    // Name tags, and arrows for chasers out of shot.
    sim.riders.forEach((r, i) => {
      const s = view.project(r.x, r.y + 2.3, r.z);
      const col = colors[r.outfit];
      const label = r.isPlayer ? r.name : r.name;
      if (!s.behind && s.y > 70 && s.y < h - 10 && s.x > -40 && s.x < w + 40) {
        if (r.isPlayer && sim.phase !== 'countdown') return;
        this._tag(s.x, s.y, label, col, r.crashed);
      } else if (!r.isPlayer && !r.crashed) {
        const d = Math.hypot(r.x - sim.player.x, r.z - sim.player.z);
        const x = Math.max(28, Math.min(w - 28, s.behind ? w - s.x : s.x));
        if (s.y < 70 && !s.behind) this._arrow(x, 104, col, `${r.name} ${Math.round(d)}m`, true);
        else this._arrow(x, h - 34, col, `${r.name} ${Math.round(d)}m`);
      }
    });

    // Clock.
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const clock = sim.phase === 'countdown' ? 0 : (sim.phase === 'run' ? sim.runTime : sim.endTime);
    g.font = `800 30px ${FONT}`;
    g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.strokeText(fmt(clock), w / 2, top + 2);
    g.fillStyle = INK;
    g.fillText(fmt(clock), w / 2, top + 2);
    if (best) {
      g.font = `700 11px ${FONT}`;
      g.fillStyle = 'rgba(19,35,58,0.6)';
      g.fillText(`BEST ${fmt(best)}`, w / 2, top + 36);
    }

    // Who is still on your tail.
    const chips = sim.chasers;
    const cw = Math.min(104, (w - 32) / 3 - 6);
    const x0 = w / 2 - (chips.length * (cw + 6) - 6) / 2;
    chips.forEach((c, i) => {
      const x = x0 + i * (cw + 6), y = top + 54;
      const out = c.lives === 0, down = c.skier.crashed && !out;
      g.fillStyle = out ? 'rgba(255,255,255,0.45)' : down ? 'rgba(255,236,200,0.9)' : 'rgba(255,255,255,0.88)';
      rr(g, x, y, cw, 26, 13); g.fill();
      g.fillStyle = colors[c.skier.outfit];
      g.beginPath(); g.arc(x + 14, y + 13, 6, 0, Math.PI * 2); g.fill();
      if (c.cfg.kind === 'board') { g.fillStyle = '#fff'; g.fillRect(x + 10, y + 12, 8, 2); }
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = `700 12px ${FONT}`;
      g.fillStyle = out ? 'rgba(19,35,58,0.45)' : INK;
      g.fillText(c.cfg.name, x + 25, y + 13.5);
      if (out) {
        const tw = g.measureText(c.cfg.name).width;
        g.strokeStyle = '#e8463a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x + 23, y + 14); g.lineTo(x + 27 + tw, y + 12); g.stroke();
      } else {
        // One pip per life left.
        for (let k = 0; k < c.lives; k++) {
          g.fillStyle = down ? '#e89a3a' : INK;
          g.beginPath(); g.arc(x + cw - 10 - k * 9, y + 13, 3, 0, Math.PI * 2); g.fill();
        }
      }
    });

    // Speed, top right.
    g.textAlign = 'right'; g.textBaseline = 'top';
    g.font = `800 20px ${FONT}`;
    const kmh = String(Math.round(sim.player.speed * 3.6));
    g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.strokeText(kmh, w - 16, top + 6); g.fillStyle = INK; g.fillText(kmh, w - 16, top + 6);
    g.font = `700 10px ${FONT}`; g.fillStyle = 'rgba(19,35,58,0.6)';
    g.fillText('KM/H', w - 16, top + 29);

    // Messages, stacked under the chips.
    let my = Math.max(118, h * 0.2);   // up under the chips, clear of you
    for (const m of this.msgs) {
      m.t -= dt;
      const a = Math.min(1, m.t * 2.5, (m.life - m.t) * 8);
      g.globalAlpha = Math.max(0, a);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const big = m.kind === 'big';
      g.font = `${big ? 900 : 800} ${big ? 36 : 16}px ${FONT}`;
      const fill = m.kind === 'good' ? '#178a4e' : m.kind === 'bad' ? '#c8352a' : INK;
      g.lineWidth = big ? 8 : 5; g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(m.text, w / 2, my); g.fillStyle = fill; g.fillText(m.text, w / 2, my);
      if (m.sub) {
        g.font = `700 12px ${FONT}`;
        g.lineWidth = 4; g.strokeText(m.sub, w / 2, my + (big ? 32 : 20));
        g.fillStyle = 'rgba(19,35,58,0.8)'; g.fillText(m.sub, w / 2, my + (big ? 32 : 20));
      }
      my += big ? 64 : (m.sub ? 46 : 30);
    }
    g.globalAlpha = 1;
    this.msgs = this.msgs.filter(m => m.t > 0);

    // Trick pop, just above you.
    if (this.pop) {
      this.pop.t -= dt;
      const s = view.project(sim.player.x, sim.player.y + 3, sim.player.z);
      const k = Math.max(0, this.pop.t / 1.4);
      g.globalAlpha = Math.min(1, k * 3);
      g.textAlign = 'center';
      g.font = `900 ${22 + 8 * (1 - k)}px ${FONT}`;
      g.lineWidth = 6; g.strokeStyle = '#13233a';
      g.strokeText(this.pop.text, s.x, s.y - 30 * (1 - k));
      g.fillStyle = '#ffd44a';
      g.fillText(this.pop.text, s.x, s.y - 30 * (1 - k));
      g.globalAlpha = 1;
      if (this.pop.t <= 0) this.pop = null;
    }

    // The poles: a ring where each thumb landed, a dot where it is now.
    for (const t of controls.poles) {
      g.strokeStyle = 'rgba(19,35,58,0.22)'; g.lineWidth = 2;
      g.beginPath(); g.arc(t.x0, t.y0, 30, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      const dx = Math.max(-36, Math.min(36, t.x - t.x0)), dy = Math.max(-36, Math.min(36, t.y - t.y0));
      g.beginPath(); g.arc(t.x0 + dx, t.y0 + dy, 14, 0, Math.PI * 2); g.fill();
    }
  }

  _tag(x, y, text, col, down) {
    const g = this.g;
    g.font = `800 10px ${FONT}`;
    const tw = g.measureText(text).width + 12;
    g.globalAlpha = down ? 0.4 : 0.72;
    g.fillStyle = col;
    rr(g, x - tw / 2, y - 16, tw, 15, 7.5); g.fill();
    g.beginPath(); g.moveTo(x - 4, y - 1.5); g.lineTo(x + 4, y - 1.5); g.lineTo(x, y + 3); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x, y - 8);
    g.globalAlpha = 1;
  }

  _arrow(x, y, col, text, up = false) {
    const g = this.g;
    g.fillStyle = col;
    g.beginPath();
    if (up) { g.moveTo(x, y); g.lineTo(x - 9, y + 11); g.lineTo(x + 9, y + 11); }
    else { g.moveTo(x, y + 14); g.lineTo(x - 9, y + 3); g.lineTo(x + 9, y + 3); }
    g.fill();
    g.font = `800 10px ${FONT}`; g.textAlign = 'center'; g.textBaseline = up ? 'top' : 'bottom';
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.85)';
    const ty = up ? y + 13 : y + 1;
    g.strokeText(text, x, ty); g.fillStyle = INK; g.fillText(text, x, ty);
  }
}

export function fmt(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
