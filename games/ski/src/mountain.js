/* A real mountain, from data: Grand Targhee, built by tools/targhee/build.mjs from
   public elevation (USGS 3DEP) and land cover (ESA WorldCover).

   Same questions as the endless Terrain — height, surface normal, what is nearby — so
   the physics, the chasers and the renderer work on it unchanged. Unlike the endless
   run, downhill can be any direction: downhill() says which way the hill falls here.

   Coordinates: x east, z south, metres from the map's origin; y up, metres above sea
   level. */

import { mulberry32, hash, Perlin, clamp } from './noise.js';

export const TILE = 32;                 // tree generation and lookup tile, metres

export class Mountain {
  /* meta: the .json; rgba: the .png's pixels (Uint8Array/Uint8ClampedArray, RGBA) */
  constructor(meta, rgba, seed = 1) {
    this.isMountain = true;
    this.meta = meta;
    this.name = meta.name;
    this.cell = meta.cell;
    this.x0 = meta.x0; this.z0 = meta.z0;
    this.w = meta.width; this.h = meta.height;
    this.places = meta.places;
    const n = this.w * this.h;
    this.hgt = new Float32Array(n);
    this.forest = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      this.hgt[k] = meta.baseHeight + (rgba[k * 4] * 256 + rgba[k * 4 + 1]) / 10;
      this.forest[k] = rgba[k * 4 + 2];
    }
    this.seed = seed;
    this.n = new Perlin(seed + 11);
    this.tiles = new Map();
    this.minX = this.x0 + 40; this.maxX = this.x0 + (this.w - 1) * this.cell - 40;
    this.minZ = this.z0 + 40; this.maxZ = this.z0 + (this.h - 1) * this.cell - 40;
  }

  /* --- the ground ------------------------------------------------------------ */

  /* Bicubic (Catmull-Rom) through the 5 m grid, so slopes and their changes are smooth,
     plus a little fine texture so the snow is never glassy. */
  height(x, z) {
    return this.ground(x, z) + 0.28 * this.n.noise(x / 11, z / 11) + 0.1 * this.n.noise(x / 4.3 + 7, z / 4.3);
  }

  ground(x, z) {
    const c = this.cell;
    let gx = (x - this.x0) / c, gz = (z - this.z0) / c;
    gx = clamp(gx, 1, this.w - 3); gz = clamp(gz, 1, this.h - 3);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const H = this.hgt, W = this.w;
    const row = (jj) => {
      const o = jj * W + i;
      return cr(H[o - 1], H[o], H[o + 1], H[o + 2], fx);
    };
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), fz);
  }

  normal(x, z, out, e = 0.3) {
    const hx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const hz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
    out.x = -hx * inv; out.y = inv; out.z = -hz * inv;
    return out;
  }

  /* Forest density 0..1 at a point (bilinear). */
  density(x, z) {
    const c = this.cell;
    const gx = clamp((x - this.x0) / c, 0, this.w - 2), gz = clamp((z - this.z0) / c, 0, this.h - 2);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, F = this.forest, W = this.w;
    const a = F[j * W + i], b = F[j * W + i + 1], d = F[(j + 1) * W + i], e = F[(j + 1) * W + i + 1];
    return ((a * (1 - fx) + b * fx) * (1 - fz) + (d * (1 - fx) + e * fx) * fz) / 255;
  }

  /* Which way the hill falls here, as a heading (0 = +z, as the skiers use), judged
     over a wide patch so it follows the mountain, not each bump. */
  downhill(x, z, span = 24) {
    const hx = this.ground(x + span, z) - this.ground(x - span, z);
    const hz = this.ground(x, z + span) - this.ground(x, z - span);
    if (Math.abs(hx) + Math.abs(hz) < 1e-3) return null;
    return Math.atan2(-hx, -hz);
  }

  /* Pitch of the hill along a heading, rise over run, measured over 40 m. */
  fallAlong(x, z, yaw) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    return Math.max(0.05, (this.ground(x - dx * 10, z - dz * 10) - this.ground(x + dx * 30, z + dz * 30)) / 40);
  }

  /* Keep a rider on the map: at the edge, stop dead against an invisible fence. */
  contain(r) {
    let hit = false;
    if (r.x < this.minX) { r.x = this.minX; r.vx = Math.max(0, r.vx); hit = true; }
    if (r.x > this.maxX) { r.x = this.maxX; r.vx = Math.min(0, r.vx); hit = true; }
    if (r.z < this.minZ) { r.z = this.minZ; r.vz = Math.max(0, r.vz); hit = true; }
    if (r.z > this.maxZ) { r.z = this.maxZ; r.vz = Math.min(0, r.vz); hit = true; }
    return hit;
  }

  /* Where a run starting at a named place begins: a few metres down from the point,
     facing down the hill. */
  start(key) {
    const p = this.places[key] || Object.values(this.places)[0];
    let x = p.x, z = p.z;
    let yaw = this.downhill(x, z, 30) ?? 0;
    // Step a little way down so nobody starts balanced on a summit cairn.
    for (let k = 0; k < 6; k++) {
      x += Math.sin(yaw) * 5; z += Math.cos(yaw) * 5;
      yaw = this.downhill(x, z, 20) ?? yaw;
    }
    return { x, z, psi: yaw };
  }

  /* The endless terrain's housekeeping hooks; a fixed mountain needs none. */
  ensure() {}
  prune() {}

  /* --- trees and rocks ------------------------------------------------------- */

  /* Everything that can be hit within about R of (x, z), pushed into `out`. */
  nearby(x, z, R, out) {
    out.length = 0;
    const i0 = Math.floor((x - R) / TILE), i1 = Math.floor((x + R) / TILE);
    const j0 = Math.floor((z - R) / TILE), j1 = Math.floor((z + R) / TILE);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      for (const o of this.tile(i, j)) out.push(o);
    }
    return out;
  }

  /* The trees and rocks in one tile, generated the same way every time from the forest
     density, and cached. */
  tile(i, j) {
    const key = i * 65536 + j;
    let t = this.tiles.get(key);
    if (t) return t;
    t = [];
    const rnd = mulberry32(hash(this.seed, i, j, 4111));
    const step = 3.1, x0 = i * TILE, z0 = j * TILE;
    const nrm = { x: 0, y: 1, z: 0 };
    for (let zz = z0 + step / 2; zz < z0 + TILE; zz += step) {
      for (let xx = x0 + step / 2; xx < x0 + TILE; xx += step) {
        const x = xx + (rnd() - 0.5) * step * 0.9, z = zz + (rnd() - 0.5) * step * 0.9;
        if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) { rnd(); continue; }
        const d = this.density(x, z);
        const roll = rnd();
        this.normal(x, z, nrm, 1.2);
        // Dense timber fills in; open slopes keep a scattering of lone trees.
        const pTree = d > 0.05 ? 0.06 + 0.5 * Math.pow(d, 1.4) : 0.004;
        if (roll < pTree && nrm.y > 0.72) {
          const s = 0.75 + rnd() * 0.75;
          t.push({ kind: 'tree', x, z, y: this.ground(x, z), r: 0.42 * s, h: 7.5 * s, s, rot: rnd() * 6.283, v: Math.floor(rnd() * 3) });
        } else if (roll > 0.993 || (nrm.y < 0.7 && roll > 0.9)) {
          const size = 0.6 + rnd() * (nrm.y < 0.7 ? 1.6 : 0.9);
          t.push({ kind: 'rock', x, z, y: this.ground(x, z) - size * 0.25, r: size * 0.82, h: size * 0.95, s: size, rot: rnd() * 6.283, v: Math.floor(rnd() * 3) });
        }
      }
    }
    if (this.tiles.size > 3000) this.tiles.clear();
    this.tiles.set(key, t);
    return t;
  }
}

function cr(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/* Load a map in the browser: its .json and its packed .png, decoded exactly. */
export async function loadMountain(base, seed) {
  const meta = await (await fetch(base + '.json', { cache: 'no-cache' })).json();
  const blob = await (await fetch(base + '.png', { cache: 'no-cache' })).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
  return new Mountain(meta, px, seed);
}

