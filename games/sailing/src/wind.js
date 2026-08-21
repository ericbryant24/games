/* True wind field: a mean breeze plus oscillating shifts and drifting gust cells,
   and the wind shadows boats throw downwind of themselves. */

function hash2(ix, iz) {
  let h = ix * 374761393 + iz * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xffff) / 0xffff;
}
function valueNoise(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = x - x0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0), b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1), d = hash2(x0 + 1, z0 + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

export class Wind {
  /**
   * @param {number} baseFrom  bearing the wind blows FROM, radians (0 = from the north)
   * @param {number} baseSpeed mean true wind speed at 10 m, m/s
   */
  constructor(baseFrom = 0, baseSpeed = 7) {
    this.baseFrom = baseFrom;
    this.baseSpeed = baseSpeed;
    this.shifty = 1.0;   // multiplier on the oscillating shifts
    this.gustiness = 1.0;
    this.t = 0;
    this.cellDrift = 0;  // gust cells travel downwind over time
    this.shadows = [];
  }

  update(dt) {
    this.t += dt;
    this.cellDrift += dt * this.baseSpeed * 0.55;
  }

  /* Shift from the mean direction, radians. Three periods so it never feels metronomic. */
  shift(t = this.t) {
    return this.shifty * (
      0.105 * Math.sin(t / 47.0 + 0.7) +
      0.062 * Math.sin(t / 19.3 + 2.1) +
      0.028 * Math.sin(t / 7.7)
    );
  }

  /* True wind at a point: the bearing it blows FROM, and its speed. */
  sample(x, z, out = { from: 0, speed: 0 }) {
    const from = this.baseFrom + this.shift();

    // Gust cells drift with the breeze, so pressure arrives from upwind.
    const ux = Math.sin(from), uz = Math.cos(from); // unit vector pointing upwind
    const px = (x + ux * this.cellDrift) / 62;
    const pz = (z + uz * this.cellDrift) / 62;
    const n = valueNoise(px, pz) * 0.65 + valueNoise(px * 2.7 + 11.3, pz * 2.7 - 4.1) * 0.35;
    let dir = from + this.gustiness * (n - 0.5) * 0.20;  // pressure usually comes with a shift
    let speed = this.baseSpeed * Math.max(0.25, 1 + this.gustiness * (n - 0.5) * 0.52);

    // Wind shadows: a cone of soft air stretching downwind of each rig.
    for (let i = 0; i < this.shadows.length; i++) {
      const s = this.shadows[i];
      const rx = x - s.x, rz = z - s.z;
      const along = rx * s.dirX + rz * s.dirZ;             // distance downwind of it
      if (along <= 0 || along > s.length) continue;
      const across = -rx * s.dirZ + rz * s.dirX;
      const halfWidth = s.width * (0.45 + 0.55 * (along / s.length)); // the cone spreads
      if (Math.abs(across) > halfWidth) continue;
      const fade = (1 - along / s.length) * (1 - Math.abs(across) / halfWidth);
      speed *= 1 - s.strength * fade;
      dir += (across > 0 ? -1 : 1) * 0.16 * fade;          // air bends around the blanket
    }

    out.from = dir;
    out.speed = speed;
    return out;
  }

  /* Rebuild the shadow list from the current fleet — once per physics tick. */
  setShadowSources(boats) {
    this.shadows.length = 0;
    const from = this.baseFrom + this.shift();
    const dirX = -Math.sin(from), dirZ = -Math.cos(from); // downwind travel direction
    for (const b of boats) {
      this.shadows.push({ x: b.x, z: b.z, dirX, dirZ, length: 58, width: 9, strength: 0.55, boat: b });
    }
  }

  /* sample(), but ignoring the shadow a boat casts on itself. */
  sampleFor(x, z, self, out = { from: 0, speed: 0 }) {
    const all = this.shadows;
    if (self) this.shadows = all.filter(s => s.boat !== self);
    this.sample(x, z, out);
    this.shadows = all;
    return out;
  }
}
