/* A picture of the wind, for the water to wear.

   The ocean shader needs to know where the pressure is so it can darken and roughen
   those patches. Rather than reimplement the wind's noise in GLSL — where it would
   drift out of step with the physics and lie to the player — the field is sampled on
   the CPU into a small texture and handed over. */

import * as THREE from '../../vendor/three.module.min.js';

const N = 64;                 // grid resolution across the mapped area

export class GustMap {
  constructor(wind, size = 900) {
    this.wind = wind;
    this.size = size;         // metres across
    this.data = new Uint8Array(N * N);
    this.texture = new THREE.DataTexture(this.data, N, N, THREE.RedFormat);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.origin = new THREE.Vector2();
    this.timer = 0;
    this._s = { from: 0, speed: 0 };
  }

  /* Recentre and refill, a few times a second — gust cells drift at walking pace. */
  update(dt, centreX, centreZ, force = false) {
    this.timer -= dt;
    if (!force && this.timer > 0) return;
    this.timer = 0.16;

    this.origin.set(centreX, centreZ);
    const step = this.size / (N - 1);
    const base = this.wind.baseSpeed;
    const half = this.size * 0.5;
    let k = 0;
    for (let j = 0; j < N; j++) {
      const z = centreZ - half + j * step;
      for (let i = 0; i < N; i++) {
        const x = centreX - half + i * step;
        this.wind.sample(x, z, this._s);
        // Normalised so 0.5 is the mean breeze; the shader keys its contrast off that.
        const v = 0.5 * (this._s.speed / Math.max(0.5, base));
        this.data[k++] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
    this.texture.needsUpdate = true;
  }
}
