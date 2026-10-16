/* Two ski poles, Grand Mountain Adventure style: the left half of the screen is your
   left pole, the right half your right.

     hold one side            turn the other way — right turns you left (slide outward
                              for a sharp turn)
     hold both                crouch — let go to jump
     tap left, right, left…   skate, to get going
     drag down on a side      brake
     in the air:
       hold one side          spin that way
       drag both up / down    backflip / front flip

   Keyboard: arrows turn, down crouches (let go, or space, to jump), up brakes. */

const QUICK = 28;        // px outward that turns a hold into a sharp turn
const DRAG = 30;         // px down (or up) that counts as a drag

export class Controls {
  constructor() {
    this.steer = 0;          // -1 .. 1 (1.5 for a sharp turn), screen right positive
    this.vert = 0;           // both poles dragged: -1 up .. 1 down, for flips
    this.crouch = false;     // both poles held
    this.brake = 0;          // 0 .. 1
    this.jump = false;       // set when a crouch is let go; whoever reads it clears it
    this.skate = 0;          // pending skate pushes; whoever reads them clears them
    this.poles = [];         // the touches, for drawing
    this.keys = new Set();
    this._ptr = new Map();
    this._both = false;
    this._lastTap = { side: '', t: 0 };
  }

  attach(surface, target = window) {
    const down = (e) => {
      if (e.target.closest && e.target.closest('button, a, input, .screen')) return;
      try { surface.setPointerCapture(e.pointerId); } catch { /* already gone */ }
      const side = e.clientX < window.innerWidth / 2 ? 'L' : 'R';
      this._ptr.set(e.pointerId, { side, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        t0: performance.now() });
      if (this._sides().L && this._sides().R) this._both = true;
      e.preventDefault();
    };
    const move = (e) => {
      const p = this._ptr.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      e.preventDefault();
    };
    const up = (e) => {
      const p = this._ptr.get(e.pointerId);
      if (!p) return;
      this._ptr.delete(e.pointerId);
      // Letting go of a crouch is the jump.
      if (this._both) { this.jump = true; this._both = false; return; }
      // Quick taps on alternate sides skate you along.
      const now = performance.now();
      if (now - p.t0 < 240 && Math.hypot(p.x - p.x0, p.y - p.y0) < 16) {
        if (this._lastTap.side && this._lastTap.side !== p.side && now - this._lastTap.t < 600) this.skate++;
        this._lastTap = { side: p.side, t: now };
      }
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
    target.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if ((k === 'arrowdown' || k === 's') && this.keys.has(k)) this.jump = true;
      this.keys.delete(k);
    });
    target.addEventListener('blur', () => { this.keys.clear(); });
    return this;
  }

  _sides() {
    const s = { L: null, R: null };
    for (const p of this._ptr.values()) s[p.side] = p;
    return s;
  }

  update(dt) {
    const { L, R } = this._sides();
    let ts = 0, tv = 0, brake = 0, crouch = false;
    if (L && R) {
      crouch = true;
      const dy = ((L.y - L.y0) + (R.y - R.y0)) / 2;
      tv = Math.abs(dy) > DRAG ? clamp(dy / 70, -1, 1) : 0;
    } else if (L || R) {
      const p = L || R, dir = L ? -1 : 1;
      const out = (p.x - p.x0) * dir;
      ts = dir * (out > QUICK ? 1.5 : 1);
      const dy = p.y - p.y0;
      if (dy > DRAG) brake = clamp((dy - DRAG) / 60 + 0.3, 0, 1);
    }

    const k = this.keys;
    if (k.size) {
      // Touch poles are crossed over (right side turns you left); keys are not, so they
      // are pre-crossed here to come out the natural way round.
      ts = (k.has('arrowleft') || k.has('a') ? 1 : 0) - (k.has('arrowright') || k.has('d') ? 1 : 0);
      const dn = k.has('arrowdown') || k.has('s'), upk = k.has('arrowup') || k.has('w');
      crouch = dn;
      brake = upk ? 1 : 0;
      tv = (dn ? 1 : 0) - (upk ? 1 : 0);
    }

    // Poles bite progressively rather than snapping, like leaning onto an edge.
    this.steer += (ts - this.steer) * Math.min(1, dt * 40);
    this.vert += (tv - this.vert) * Math.min(1, dt * 14);
    this.brake = brake;
    this.crouch = crouch;
    this.poles = [...this._ptr.values()];
  }

  reset() {
    this.steer = 0; this.vert = 0; this.brake = 0; this.crouch = false;
    this.jump = false; this.skate = 0; this.poles = [];
    this._ptr.clear(); this._both = false;
  }
}

const KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's']);
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
