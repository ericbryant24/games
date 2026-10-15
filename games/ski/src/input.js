/* One thumb, anywhere on the screen. Where it lands is the middle: drag across to carve,
   drag down to tuck, drag up to brake. Tap to jump — or tap with a second finger while
   the first is still steering. In the air, the same drags spin and flip you.

   Keyboard: arrows or WASD, space to jump. */

export class Controls {
  constructor() {
    this.steer = 0;          // -1 .. 1, right positive
    this.vert = 0;           // -1 .. 1, down (tuck / front flip) positive
    this.jump = false;       // set on a tap; whoever reads it clears it
    this.touch = null;       // { x0, y0, x, y } for drawing the thumb
    this.keys = new Set();
    this._ptr = new Map();
    this._target = { steer: 0, vert: 0 };
  }

  attach(surface, target = window) {
    const down = (e) => {
      if (e.target.closest && e.target.closest('button, a, input, .screen')) return;
      surface.setPointerCapture?.(e.pointerId);
      // A second finger is a jump, and leaves the steering thumb alone.
      if (this._ptr.size >= 1) { this.jump = true; this._ptr.set(e.pointerId, { extra: true }); e.preventDefault(); return; }
      this._ptr.set(e.pointerId, { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: 0 });
      this.touch = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      e.preventDefault();
    };
    const move = (e) => {
      const p = this._ptr.get(e.pointerId);
      if (!p || p.extra) return;
      const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
      p.moved = Math.max(p.moved, Math.hypot(dx, dy));
      const span = Math.max(46, Math.min(80, window.innerWidth * 0.16));
      this._target.steer = clamp(dx / span, -1, 1);
      this._target.vert = dead(clamp(dy / (span * 1.1), -1, 1), 0.25);
      this.touch.x = e.clientX; this.touch.y = e.clientY;
      e.preventDefault();
    };
    const up = (e) => {
      const p = this._ptr.get(e.pointerId);
      if (!p) return;
      this._ptr.delete(e.pointerId);
      if (p.extra) return;
      if (performance.now() - p.t0 < 230 && p.moved < 14) this.jump = true;
      this._target.steer = 0; this._target.vert = 0;
      this.touch = null;
    };
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', up);
    surface.addEventListener('lostpointercapture', up);
    surface.style.touchAction = 'none';

    target.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === ' ') { if (!e.repeat) this.jump = true; e.preventDefault(); return; }
      if (KEYS.has(k)) { this.keys.add(k); e.preventDefault(); }
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    target.addEventListener('blur', () => { this.keys.clear(); });
    return this;
  }

  update(dt) {
    let ts = this._target.steer, tv = this._target.vert;
    const k = this.keys;
    if (k.size) {
      ts = (k.has('arrowright') || k.has('d') ? 1 : 0) - (k.has('arrowleft') || k.has('a') ? 1 : 0);
      tv = (k.has('arrowdown') || k.has('s') ? 1 : 0) - (k.has('arrowup') || k.has('w') ? 1 : 0);
    }
    const r = Math.min(1, dt * 14);
    this.steer += (ts - this.steer) * r;
    this.vert += (tv - this.vert) * r;
  }

  reset() {
    this.steer = 0; this.vert = 0; this.jump = false; this.touch = null;
    this._target.steer = 0; this._target.vert = 0;
    this._ptr.clear();
  }
}

const KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's']);
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dead(v, d) { return Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d); }
