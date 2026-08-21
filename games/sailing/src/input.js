/* Two thumbs. The left pad is the tiller: drag across and it deflects, let go and it
   springs back amidships like a real one. The right pad is the sheet: drag up to trim
   on, down to ease, and it stays where you put it, because a sheet does.
   Keyboard works too, for anyone on a desktop: arrows or WASD. */

export class Controls {
  constructor(opts = {}) {
    this.rudder = 0;          // -1 .. 1, scaled to the boat's maximum helm angle
    this.trim = opts.trim ?? 0.4;
    this.rudderTarget = 0;
    this.helmSpring = opts.helmSpring ?? 3.2;   // how fast the helm centres itself
    this.helmRate = opts.helmRate ?? 3.6;       // how fast it answers a key
    this.trimRate = opts.trimRate ?? 0.55;
    this.keys = new Set();
    this.helmActive = false;
    this.sheetActive = false;
    this._pointers = new Map();
    this.onFirstInput = opts.onFirstInput || null;
  }

  /**
   * @param {HTMLElement} helmPad   left-hand pad
   * @param {HTMLElement} sheetPad  right-hand pad
   */
  attach(helmPad, sheetPad, target = window) {
    this.helmPad = helmPad;
    this.sheetPad = sheetPad;

    const down = (pad, kind) => (e) => {
      pad.setPointerCapture?.(e.pointerId);
      const r = pad.getBoundingClientRect();
      this._pointers.set(e.pointerId, {
        kind, x0: e.clientX, y0: e.clientY, rect: r, trim0: this.trim
      });
      if (kind === 'helm') this.helmActive = true; else this.sheetActive = true;
      if (this.onFirstInput) { this.onFirstInput(); this.onFirstInput = null; }
      e.preventDefault();
    };
    const move = (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      if (p.kind === 'helm') {
        // Where the thumb landed is amidships; a short travel gives full helm.
        const span = Math.max(52, Math.min(p.rect.width * 0.42, 120));
        this.rudderTarget = clamp((e.clientX - p.x0) / span, -1, 1);
      } else {
        const span = Math.max(70, p.rect.height * 0.72);
        this.trim = clamp(p.trim0 + (e.clientY - p.y0) / span, 0, 1);
      }
      e.preventDefault();
    };
    const up = (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      this._pointers.delete(e.pointerId);
      if (p.kind === 'helm') {
        this.helmActive = false;
        this.rudderTarget = 0;                 // let go of the tiller and she centres
      } else this.sheetActive = false;
    };

    helmPad.addEventListener('pointerdown', down(helmPad, 'helm'));
    sheetPad.addEventListener('pointerdown', down(sheetPad, 'sheet'));
    for (const el of [helmPad, sheetPad]) {
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.style.touchAction = 'none';
    }

    target.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (KEYS.has(k)) {
        this.keys.add(k);
        if (this.onFirstInput) { this.onFirstInput(); this.onFirstInput = null; }
        e.preventDefault();
      }
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    target.addEventListener('blur', () => this.keys.clear());
    return this;
  }

  get helmLeft() { return this.keys.has('arrowleft') || this.keys.has('a'); }
  get helmRight() { return this.keys.has('arrowright') || this.keys.has('d'); }
  get sheetIn() { return this.keys.has('arrowup') || this.keys.has('w'); }
  get sheetOut() { return this.keys.has('arrowdown') || this.keys.has('s'); }

  update(dt) {
    // Keyboard helm rolls on and springs back the same way the pad does.
    if (this.helmLeft || this.helmRight) {
      const dir = (this.helmRight ? 1 : 0) - (this.helmLeft ? 1 : 0);
      this.rudderTarget = clamp(this.rudderTarget + dir * this.helmRate * dt, -1, 1);
      this.helmActive = true;
    } else if (!this._hasPointer('helm')) {
      this.helmActive = false;
      this.rudderTarget = 0;
    }
    if (this.sheetIn) this.trim = clamp(this.trim - this.trimRate * dt, 0, 1);
    if (this.sheetOut) this.trim = clamp(this.trim + this.trimRate * dt, 0, 1);

    // The helm itself has some inertia: you cannot slam a tiller instantly.
    const rate = this.helmActive ? 9.0 : this.helmSpring;
    this.rudder += (this.rudderTarget - this.rudder) * Math.min(1, dt * rate);
    if (Math.abs(this.rudder) < 0.001) this.rudder = 0;
  }

  _hasPointer(kind) {
    for (const p of this._pointers.values()) if (p.kind === kind) return true;
    return false;
  }
}

const KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's']);
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
