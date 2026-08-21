/* Gerstner wave field. The exact same parameters drive the vertex shader and the
   boat physics, so what you see on screen is what the hull actually rides on. */

export const G = 9.81;
export const MAX_WAVES = 8;

/* Significant wave height from wind speed, in the shape of Pierson-Moskowitz but
   scaled for the sort of inshore water a race is sailed on: about 0.8 m in 14 knots,
   1.5 m in 19. */
export function significantHeight(windSpeed) {
  return Math.min(2.4, 0.0175 * windSpeed * windSpeed);
}

/* Wavelength of the dominant wind wave. Race courses are inshore and fetch-limited, so
   the sea is short and steep rather than the long swell of an open ocean — which is
   also what makes the water look like water. */
export function peakWavelength(windSpeed) {
  return Math.max(4.5, Math.min(32, 0.17 * windSpeed * windSpeed + 3));
}

/* How much of a wave a hull of length L actually feels as pitch, roll and surge.
   Waves much shorter than the boat pass underneath it; long ones tilt the whole hull. */
function lengthResponse(lambda, hullLength) {
  const r = lambda / (1.4 * hullLength);
  return (r * r) / (r * r + 1);
}

export class WaveField {
  constructor(hullLength = 6.5) {
    this.waves = [];
    this.hullLength = hullLength;
    this.A = new Float32Array(MAX_WAVES * 4); // dirX, dirZ, amplitude, k
    this.B = new Float32Array(MAX_WAVES * 4); // steepness, phase, omega, response
    this.count = 0;
  }

  /* Build a small directional spectrum: wind-driven chop spread around the wind
     direction, plus a long swell running in from a slightly different quarter. */
  configure(windDir, windSpeed, swellDir = windDir - 0.5, swellHeight = 0.45) {
    const hs = significantHeight(windSpeed);
    const peak = peakWavelength(windSpeed);
    const waves = [];

    // Wind sea: five components fanned around the wind, from a little longer than the
    // dominant wave down to the chop that gives the surface its texture.
    const bands = [
      { scale: 2.10, w: 0.21, spread: 0.09 },
      { scale: 1.00, w: 0.34, spread: -0.31 },
      { scale: 0.54, w: 0.24, spread: 0.44 },
      { scale: 0.30, w: 0.14, spread: -0.64 },
      { scale: 0.17, w: 0.07, spread: 0.86 }
    ];
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      waves.push(this._mk(windDir + b.spread, peak * b.scale, hs * 0.5 * b.w, 0.62, i * 1.7));
    }
    // Swell: long, low and smooth, running in from its own quarter.
    waves.push(this._mk(swellDir, 120, swellHeight * 0.5, 0.28, 0.9));
    waves.push(this._mk(swellDir + 0.22, 84, swellHeight * 0.32, 0.28, 2.3));

    this.waves = waves;
    this.count = Math.min(waves.length, MAX_WAVES);
    for (let i = 0; i < this.count; i++) {
      const w = this.waves[i];
      this.A[i * 4] = w.dx; this.A[i * 4 + 1] = w.dz; this.A[i * 4 + 2] = w.amp; this.A[i * 4 + 3] = w.k;
      this.B[i * 4] = w.q; this.B[i * 4 + 1] = w.phase; this.B[i * 4 + 2] = w.omega;
      this.B[i * 4 + 3] = lengthResponse(2 * Math.PI / w.k, this.hullLength);
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
  sample(x, z, t, out = { y: 0, nx: 0, ny: 1, nz: 0, dhdx: 0, dhdz: 0, hullX: 0, hullZ: 0 }) {
    let y = 0, dhdx = 0, dhdz = 0, hullX = 0, hullZ = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      const dx = this.A[o], dz = this.A[o + 1], amp = this.A[o + 2], k = this.A[o + 3];
      const phase = this.B[o + 1], omega = this.B[o + 2], resp = this.B[o + 3];
      const f = k * (dx * x + dz * z) - omega * t + phase;
      const s = Math.sin(f), c = Math.cos(f);
      y += amp * s;
      const d = amp * k * c;
      dhdx += d * dx; dhdz += d * dz;
      // The slope the hull actually responds to, short waves discounted.
      hullX += d * dx * resp; hullZ += d * dz * resp;
    }
    out.y = y; out.dhdx = dhdx; out.dhdz = dhdz;
    out.hullX = hullX; out.hullZ = hullZ;
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
