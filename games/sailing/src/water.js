/* Gerstner wave field. The exact same parameters drive the vertex shader and the
   boat physics, so what you see on screen is what the hull actually rides on. */

export const G = 9.81;
export const MAX_WAVES = 8;

/* Fully developed sea: significant wave height from wind speed (Pierson-Moskowitz-ish,
   trimmed a little so the boat is still sailable at the top of the range). */
export function significantHeight(windSpeed) {
  return Math.min(3.2, 0.021 * windSpeed * windSpeed);
}

export class WaveField {
  constructor() {
    this.waves = [];
    this.A = new Float32Array(MAX_WAVES * 4); // dirX, dirZ, amplitude, k
    this.B = new Float32Array(MAX_WAVES * 4); // steepness, phase, omega, 0
    this.count = 0;
  }

  /* Build a small directional spectrum: wind-driven chop spread around the wind
     direction, plus a long swell running in from a slightly different quarter. */
  configure(windDir, windSpeed, swellDir = windDir - 0.5, swellHeight = 0.45) {
    const hs = significantHeight(windSpeed);
    const waves = [];

    // Wind sea: five components, short to medium, fanned around the wind vector.
    const bands = [
      { lambda: 42, w: 0.44, spread: 0.10 },
      { lambda: 26, w: 0.30, spread: -0.34 },
      { lambda: 15, w: 0.16, spread: 0.46 },
      { lambda: 8.5, w: 0.07, spread: -0.66 },
      { lambda: 4.6, w: 0.03, spread: 0.85 }
    ];
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      const dir = windDir + b.spread;
      waves.push(this._mk(dir, b.lambda, hs * 0.5 * b.w * 2.0, 0.62, i * 1.7));
    }
    // Swell: long, low, smooth, from its own direction.
    waves.push(this._mk(swellDir, 110, swellHeight * 0.5, 0.30, 0.9));
    waves.push(this._mk(swellDir + 0.22, 78, swellHeight * 0.34, 0.30, 2.3));

    this.waves = waves;
    this.count = Math.min(waves.length, MAX_WAVES);
    for (let i = 0; i < this.count; i++) {
      const w = this.waves[i];
      this.A[i * 4] = w.dx; this.A[i * 4 + 1] = w.dz; this.A[i * 4 + 2] = w.amp; this.A[i * 4 + 3] = w.k;
      this.B[i * 4] = w.q;  this.B[i * 4 + 1] = w.phase; this.B[i * 4 + 2] = w.omega; this.B[i * 4 + 3] = 0;
    }
    return this;
  }

  _mk(dir, lambda, amp, steep, phase) {
    const k = (2 * Math.PI) / lambda;
    return {
      dx: Math.cos(dir), dz: Math.sin(dir),
      amp, k, phase,
      omega: Math.sqrt(G * k),
      // Horizontal steepness: keeps crests sharp without letting them self-intersect.
      q: steep
    };
  }

  /* Surface height and normal at a world point. Horizontal Gerstner displacement is
     ignored for the inverse lookup — the error is a fraction of a metre and the hull
     is metres long. */
  sample(x, z, t, out = { y: 0, nx: 0, ny: 1, nz: 0, dhdx: 0, dhdz: 0 }) {
    let y = 0, dhdx = 0, dhdz = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      const dx = this.A[o], dz = this.A[o + 1], amp = this.A[o + 2], k = this.A[o + 3];
      const phase = this.B[o + 1], omega = this.B[o + 2];
      const f = k * (dx * x + dz * z) - omega * t + phase;
      const s = Math.sin(f), c = Math.cos(f);
      y += amp * s;
      const d = amp * k * c;
      dhdx += d * dx;
      dhdz += d * dz;
    }
    out.y = y; out.dhdx = dhdx; out.dhdz = dhdz;
    // Normal of the height field (good enough; steep crests lean a touch more in the shader).
    const inv = 1 / Math.sqrt(dhdx * dhdx + dhdz * dhdz + 1);
    out.nx = -dhdx * inv; out.ny = inv; out.nz = -dhdz * inv;
    return out;
  }

  /* Orbital velocity of the water surface — used for wave-driven surge (surfing). */
  surfaceVelocity(x, z, t, out = { x: 0, y: 0, z: 0 }) {
    let vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      const dx = this.A[o], dz = this.A[o + 1], amp = this.A[o + 2], k = this.A[o + 3];
      const q = this.B[o], phase = this.B[o + 1], omega = this.B[o + 2];
      const f = k * (dx * x + dz * z) - omega * t + phase;
      const s = Math.sin(f), c = Math.cos(f);
      vy += amp * omega * c;
      const h = q * amp * omega * s;
      vx += h * dx; vz += h * dz;
    }
    out.x = vx; out.y = vy; out.z = vz;
    return out;
  }
}
