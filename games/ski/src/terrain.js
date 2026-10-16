/* The mountain. An endless fall line generated a segment at a time from a seed:
   a meandering run between forest walls, with cliff bands, kickers, rollers, mogul
   fields, tree islands and rock gardens strewn down it.

   Coordinates: x across the hill, z down it (z grows as you descend), y up.
   Height is a pure function of (x, z) once the segments covering z exist, so the
   physics, the followers and the renderer all see exactly the same snow. */

import { mulberry32, hash, Perlin, smoothstep, clamp } from './noise.js';

export const SEG = 64;          // metres of fall line per generated segment
const CELL = 8;                 // obstacle lookup grid
const CLEAR_UNTIL = 2;          // segments at the top with no features: a warm-up

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    this.n = new Perlin(seed);
    const r = mulberry32(hash(seed, 1));
    this.P = {
      g0: 0.33, a1: 0.085, w1: 60 + r() * 35, p1: r() * 6.283, a2: 0.045, w2: 18 + r() * 8, p2: r() * 6.283,
      c1: 30 + r() * 14, cw1: 150 + r() * 70, cp1: r() * 6.283,
      c2: 12 + r() * 7, cw2: 55 + r() * 25, cp2: r() * 6.283,
      hw0: 30, hw1: 9, hww: 110 + r() * 60, hwp: r() * 6.283
    };
    this.base = new Float64Array(8192);
    this.baseLen = 1;            // base[i] = height of the bare slope at z = i metres
    this.segs = new Map();
    this.cum = [0];              // cum[k] = permanent drop from cliffs in segments < k
    this.generated = 0;          // segments [0, generated) exist
    this.pruned = 0;             // segments below this index have been forgotten
    this.ensure(SEG * 4);
  }

  /* --- the shape of the run ------------------------------------------------- */

  /* Fall-line gradient (rise over run) at z. Gentle at the top so a start is calm,
     then varying between about 13° and 25°, getting a touch steeper the further you go. */
  slope(z) {
    const P = this.P;
    if (z < 0) z = 0;
    const g = P.g0 + P.a1 * Math.sin(z / P.w1 + P.p1) + P.a2 * Math.sin(z / P.w2 + P.p2)
      + 0.05 * smoothstep(0, 4000, z);
    return Math.max(0.14, g) * (0.6 + 0.4 * smoothstep(0, 110, z));
  }

  /* Height of the bare slope, from a table integrated a metre at a time and joined
     with cubic Hermite pieces so the gradient is continuous. */
  baseAt(z) {
    if (z <= 0) return -this.slope(0) * z;
    const i = Math.floor(z);
    if (i + 1 >= this.baseLen) this._growBase(i + 2);
    const t = z - i;
    const h0 = this.base[i], h1 = this.base[i + 1];
    const m0 = -this.slope(i), m1 = -this.slope(i + 1);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * h1 + (t3 - t2) * m1;
  }

  _growBase(n) {
    if (n > this.base.length) {
      const b = new Float64Array(Math.max(n, this.base.length * 2));
      b.set(this.base.subarray(0, this.baseLen));
      this.base = b;
    }
    for (let i = this.baseLen; i < n; i++) {
      const a = i - 1;
      // Simpson over one metre.
      const integral = (this.slope(a) + 4 * this.slope(a + 0.5) + this.slope(a + 1)) / 6;
      this.base[i] = this.base[i - 1] - integral;
    }
    this.baseLen = n;
  }

  /* Where the middle of the run is, and how wide the open snow is either side of it. */
  centre(z) {
    const P = this.P;
    const settle = smoothstep(0, 140, z);
    return settle * (P.c1 * Math.sin(z / P.cw1 + P.cp1) - P.c1 * Math.sin(P.cp1) +
      P.c2 * Math.sin(z / P.cw2 + P.cp2) - P.c2 * Math.sin(P.cp2) +
      5 * this.n.noise(z / 48, 3.3));
  }
  halfWidth(z) {
    const P = this.P;
    return P.hw0 + P.hw1 * Math.sin(z / P.hww + P.hwp) - 4 * smoothstep(800, 3000, z);
  }

  /* --- height ---------------------------------------------------------------- */

  height(x, z) {
    const dx = x - this.centre(z);
    // Off the edge of the run the ground banks up steeply into the forest, so the run
    // reads as a valley carved down the mountain.
    const out = Math.max(0, Math.abs(dx) - this.halfWidth(z));
    let h = this.baseAt(z) + 0.0022 * dx * dx + 0.016 * out * out
      + 2.6 * this.n.noise(x / 95 - 31.7, z / 95 + 8.2)     // big rolls and gullies
      + 1.25 * this.n.noise(x / 38, z / 38)
      + 0.40 * this.n.noise(x / 13 + 17.3, z / 13 - 4.1);
    const k = Math.floor(z / SEG);
    if (k >= 1) h -= this.cum[Math.min(k - 1, this.cum.length - 1)];
    for (let kk = k - 1; kk <= k; kk++) {
      if (kk < 0) continue;
      const seg = this.segs.get(kk);
      if (!seg) continue;
      for (const f of seg.features) h += featureHeight(f, x, z);
    }
    return h;
  }

  /* Surface normal by central differences. Writes into `out` = {x, y, z}. */
  normal(x, z, out, e = 0.25) {
    const hx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const hz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
    out.x = -hx * inv; out.y = inv; out.z = -hz * inv;
    return out;
  }

  /* --- generation ------------------------------------------------------------ */

  /* Make sure every segment down to z exists. */
  ensure(z) {
    const want = Math.floor(z / SEG) + 2;
    while (this.generated < want) this._generate(this.generated++);
  }

  /* Forget segments wholly above z; nothing will ever look up there again. */
  prune(z) {
    const k = Math.floor(z / SEG) - 1;
    while (this.pruned < k) { this.segs.delete(this.pruned); this.pruned++; }
  }

  _generate(k) {
    const rnd = mulberry32(hash(this.seed, k, 991));
    const z0 = k * SEG;
    const seg = { k, z0, z1: z0 + SEG, features: [], obstacles: [], grid: new Map(), zones: [] };
    this.segs.set(k, seg);

    if (k >= CLEAR_UNTIL) this._features(seg, rnd);
    // Permanent drop of everything up to and including this segment.
    let drop = 0;
    for (const f of seg.features) if (f.type === 'drop') drop += f.D;
    this.cum[k + 1] = this.cum[k] + drop;

    this._obstacles(seg, rnd);
    for (const o of seg.obstacles) {
      const key = cellKey(o.x, o.z);
      let a = seg.grid.get(key);
      if (!a) seg.grid.set(key, a = []);
      a.push(o);
    }
  }

  _features(seg, rnd) {
    const { z0, k } = seg;
    // Things get busier further down the mountain.
    const busy = clamp(0.55 + k * 0.03, 0.55, 1.0);
    const pick = rnd();
    const zc = z0 + 14 + rnd() * 30;              // keep inside the segment's reach
    const c = this.centre(zc), hw = this.halfWidth(zc);

    if (pick < 0.30) {
      // A cliff band across part of the run, rolling over gently either side of it.
      const span = (0.35 + rnd() * 0.45) * hw * 2;
      const mid = c + (rnd() - 0.5) * hw * 0.9;
      const D = 2.6 + rnd() * (4 + 4 * busy);
      seg.features.push({
        type: 'drop', z0: zc, zw: 1.5 + rnd() * 2, zf: 0.08 + rnd() * 0.12, zp: rnd() * 6.28,
        run: 1.3 + rnd() * 1.6, D, xa: mid - span / 2, xb: mid + span / 2,
        ramp: 26 + rnd() * 12
      });
      seg.zones.push({ kind: 'cliff', z0: zc - 6, z1: zc + 6, xa: mid - span / 2, xb: mid + span / 2 });
    } else if (pick < 0.52) {
      // One to three kickers.
      const nk = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < nk; i++) {
        const kz = z0 + 6 + rnd() * 40;
        const kc = this.centre(kz);
        const kx = kc + (rnd() - 0.5) * this.halfWidth(kz) * 1.2;
        const H = 1.0 + rnd() * 1.4, L = 5.5 + rnd() * 2.5, W = 4.5 + rnd() * 2.5;
        seg.features.push({ type: 'kicker', x: kx, z: kz, H, L, W });
        seg.zones.push({ kind: 'kicker', z0: kz - 6, z1: kz + L + 14, xa: kx - W / 2 - 2, xb: kx + W / 2 + 2 });
      }
    } else if (pick < 0.64) {
      // A roller right across the run — big air if you carry speed into it.
      const s = 5 + rnd() * 3;
      const rz = Math.max(z0 + 3.2 * s, z0 + 22 + rnd() * 16);
      seg.features.push({ type: 'roller', z: rz, A: 1.8 + rnd() * 1.3, s,
        xa: this.centre(rz) - this.halfWidth(rz) - 8, xb: this.centre(rz) + this.halfWidth(rz) + 8 });
      seg.zones.push({ kind: 'roller', z0: rz - 2 * s, z1: rz + 2.5 * s, xa: -1e9, xb: 1e9 });
    } else if (pick < 0.74) {
      seg.features.push({ type: 'moguls', z0: z0 + 4, z1: z0 + 60, A: 0.45 + rnd() * 0.3,
        ph: rnd() * 6.28 });
    } else if (pick < 0.86) {
      // A line of trees across the run with one or two gaps to thread.
      seg.zones.push({ kind: 'gate', z: zc, gaps: gapsFor(rnd, c, hw) });
    } else if (pick < 0.94) {
      seg.zones.push({ kind: 'glade', z0: z0 + 4, z1: z0 + 60, extra: 0.035 + 0.04 * busy });
    } else {
      seg.zones.push({ kind: 'rocks', z0: z0 + 4, z1: z0 + 60, extra: 0.03 + 0.03 * busy });
    }
  }

  _obstacles(seg, rnd) {
    const { z0, k } = seg;
    const step = 3.4;
    const busy = clamp(0.5 + k * 0.04, 0.5, 1.0);
    const zones = seg.zones;
    const inZone = (kind, x, z) => zones.some(q => q.kind === kind &&
      z >= q.z0 && z <= q.z1 && x >= q.xa && x <= q.xb);
    const nrm = { x: 0, y: 1, z: 0 };

    for (let zz = z0 + step / 2; zz < z0 + SEG; zz += step) {
      const c = this.centre(zz), hw = this.halfWidth(zz);
      for (let xx = c - 130; xx < c + 130; xx += step) {
        const x = xx + (rnd() - 0.5) * step * 0.9;
        const z = zz + (rnd() - 0.5) * step * 0.9;
        const d = Math.abs(x - this.centre(z));
        const w = this.halfWidth(z);
        if (k === 0 && z < 40 && d < 20) continue;               // the start area
        let pt, pr;
        if (d > w) { pt = Math.min(0.8, 0.12 + (d - w) * 0.05); pr = 0.02; }
        else {
          pt = 0.006 + 0.010 * busy;
          // Islands of trees inside the run, to weave round.
          const isl = this.n.noise(x / 24 + 50, z / 24 - 20);
          if (isl > 0.42 && k >= 1) pt += 0.30 * busy;
          pr = k >= 1 ? 0.004 + 0.004 * busy : 0;
        }
        for (const q of zones) {
          if (q.kind === 'glade' && z > q.z0 && z < q.z1 && d < w) pt += q.extra;
          if (q.kind === 'rocks' && z > q.z0 && z < q.z1 && d < w) pr += q.extra;
        }
        if (inZone('kicker', x, z) || inZone('roller', x, z)) continue;
        const roll = rnd();
        if (roll > pt + pr) continue;
        this.normal(x, z, nrm, 0.6);
        if (roll < pt) {
          if (nrm.y < 0.8) continue;                              // no trees on a cliff face
          if (inZone('cliff', x, z)) continue;
          this._tree(seg, x, z, rnd);
        } else {
          this._rock(seg, x, z, rnd, 0.6 + rnd() * 1.1);
        }
      }
    }

    // A gate: trees right across, bar the gaps.
    for (const q of zones) {
      if (q.kind !== 'gate') continue;
      const c = this.centre(q.z), hw = this.halfWidth(q.z);
      for (let x = c - hw - 6; x < c + hw + 6; x += 2.4 + rnd() * 1.2) {
        if (q.gaps.some(g => Math.abs(x - g.x) < g.w / 2)) continue;
        this._tree(seg, x, q.z + (rnd() - 0.5) * 2.4, rnd);
      }
    }
    // Rocks along the lip and the foot of each cliff band.
    for (const f of seg.features) {
      if (f.type !== 'drop') continue;
      const n = Math.floor((f.xb - f.xa) / 7);
      for (let i = 0; i < n; i++) {
        if (rnd() > 0.45) continue;
        const x = f.xa + rnd() * (f.xb - f.xa);
        const lip = f.z0 + f.zw * Math.sin(x * f.zf + f.zp);
        const atFoot = rnd() < 0.5;
        this._rock(seg, x, atFoot ? lip + f.run + 0.6 + rnd() * 1.5 : lip + f.run * 0.5, rnd,
          atFoot ? 0.8 + rnd() * 1.0 : 1.0 + rnd() * 1.4);
      }
      // Boulders mark the ends of the band.
      this._rock(seg, f.xa - 1, f.z0 + 1, rnd, 1.6 + rnd());
      this._rock(seg, f.xb + 1, f.z0 + 1, rnd, 1.6 + rnd());
    }
  }

  _tree(seg, x, z, rnd) {
    const s = 0.75 + rnd() * 0.65;
    seg.obstacles.push({ kind: 'tree', x, z, y: this.height(x, z), r: 0.42 * s, h: 7.5 * s,
      s, rot: rnd() * 6.283, v: Math.floor(rnd() * 3) });
  }
  _rock(seg, x, z, rnd, size) {
    seg.obstacles.push({ kind: 'rock', x, z, y: this.height(x, z) - size * 0.25, r: size * 0.82,
      h: size * 0.95, s: size, rot: rnd() * 6.283, v: Math.floor(rnd() * 3) });
  }

  /* Every obstacle within roughly R of (x, z), pushed into `out`. */
  nearby(x, z, R, out) {
    out.length = 0;
    const k0 = Math.floor((z - R) / SEG), k1 = Math.floor((z + R) / SEG);
    const ix0 = Math.floor((x - R) / CELL), ix1 = Math.floor((x + R) / CELL);
    const iz0 = Math.floor((z - R) / CELL), iz1 = Math.floor((z + R) / CELL);
    for (let k = k0; k <= k1; k++) {
      const seg = this.segs.get(k);
      if (!seg) continue;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const a = seg.grid.get(ix * 100003 + iz);
          if (a) for (const o of a) out.push(o);
        }
      }
    }
    return out;
  }

  /* The kind of ground at (x, z) — used by the followers and for flavour text. */
  segmentAt(z) { return this.segs.get(Math.floor(z / SEG)); }
}

function cellKey(x, z) { return Math.floor(x / CELL) * 100003 + Math.floor(z / CELL); }

function gapsFor(rnd, c, hw) {
  const n = rnd() < 0.55 ? 1 : 2;
  const gaps = [];
  for (let i = 0; i < n; i++) {
    gaps.push({ x: c + (rnd() - 0.5) * hw * 1.4, w: 4.5 + rnd() * 3 });
  }
  return gaps;
}

/* Height added (or removed) by one feature at (x, z). */
function featureHeight(f, x, z) {
  switch (f.type) {
    case 'drop': {
      const lip = f.z0 + f.zw * Math.sin(x * f.zf + f.zp);
      if (z < lip - 8) return 0;
      const sharp = smoothstep(lip, lip + f.run, z);
      const soft = smoothstep(lip - 8, lip + f.ramp, z);
      const w = smoothstep(f.xa - 6, f.xa, x) * (1 - smoothstep(f.xb, f.xb + 6, x));
      return -f.D * (w * sharp + (1 - w) * soft);
    }
    case 'kicker': {
      const u = z - f.z;
      if (u < 0 || u > f.L + 1.4) return 0;
      const lat = Math.abs(x - f.x);
      if (lat > f.W / 2 + 1.6) return 0;
      const w = 1 - smoothstep(f.W / 2, f.W / 2 + 1.6, lat);
      const p = u <= f.L ? f.H * Math.pow(u / f.L, 1.9) : f.H * (1 - smoothstep(f.L, f.L + 1.4, u));
      return p * w;
    }
    case 'roller': {
      const u = (z - f.z) / f.s;
      if (u < -3.2 || u > 3.2) return 0;
      const w = smoothstep(f.xa, f.xa + 10, x) * (1 - smoothstep(f.xb - 10, f.xb, x));
      return f.A * Math.exp(-u * u) * w;
    }
    case 'moguls': {
      if (z < f.z0 || z > f.z1) return 0;
      const win = smoothstep(f.z0, f.z0 + 8, z) * (1 - smoothstep(f.z1 - 8, f.z1, z));
      // Offset rows, the way moguls form behind the turns of the people before you.
      const a = Math.sin(x * 0.58 + f.ph + Math.sin(z * 0.27) * 1.6);
      const b = Math.sin(z * 0.52 + x * 0.12);
      return f.A * win * (a * b + 0.3 * a);
    }
  }
  return 0;
}
