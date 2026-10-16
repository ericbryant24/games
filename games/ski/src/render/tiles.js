/* The visible mountain when it is a real one: square tiles all around you instead of
   the endless run's strip. Fine near you, coarser further out, each with a skirt
   hanging below its edges so tiles of different detail never show a crack. Trees and
   rocks come from the mountain's own forest map.

   Built on World, which supplies the materials, the trees and rocks, and the glitter. */

import * as THREE from '../../vendor/three.module.min.js';
import { World } from './world.js';

const SIZE = 64;                                    // metres per tile
const LODS = [                                      // [out to distance, grid spacing]
  [130, 1.0], [260, 2.0], [400, 4.0]
];

const SNOW = new THREE.Color(0xf6f9fd);
const SNOW_SHADE = new THREE.Color(0xd6e1f1);
const GULLY = new THREE.Color(0xb8c8e2);
const ROCK = new THREE.Color(0x6c6f7b);
const ROCK_DARK = new THREE.Color(0x4d505c);
const FOREST_FLOOR = new THREE.Color(0xc9d5e8);

export class TileWorld extends World {
  constructor(terrain, opts = {}) {
    super(terrain, opts);
    this.isTiles = true;
    this.tilesOn = new Map();       // key → { lod, group, mesh, inst }
    this.job = null;
  }

  update(x, z, all = false) {
    const want = new Map();
    const R = LODS[LODS.length - 1][0];
    const i0 = Math.floor((x - R) / SIZE), i1 = Math.floor((x + R) / SIZE);
    const j0 = Math.floor((z - R) / SIZE), j1 = Math.floor((z + R) / SIZE);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cx = (i + 0.5) * SIZE, cz = (j + 0.5) * SIZE;
        const d = Math.max(0, Math.hypot(cx - x, cz - z) - SIZE * 0.7);
        const lod = LODS.findIndex(l => d < l[0]);
        if (lod < 0) continue;
        want.set(i * 4096 + j, { i, j, lod, d });
      }
    }
    // Drop what is no longer wanted, or is wanted at a different detail and has been
    // replaced.
    for (const [k, t] of this.tilesOn) {
      const w = want.get(k);
      if (!w) this._drop(k, t);
    }
    // Build: anything close and missing right now; the rest a slice at a time, nearest
    // first.
    const todo = [...want.entries()]
      .filter(([k, w]) => { const t = this.tilesOn.get(k); return !t || t.lod !== w.lod; })
      .sort((a, b) => a[1].d - b[1].d);
    for (const [k, w] of todo) {
      const t = this.tilesOn.get(k);
      if (all || (!t && w.d < 50)) {
        if (this.job && this.job.k === k) this.job = null;
        this._place(k, this._run(this._steps(w.i, w.j, w.lod)), w.lod);
      }
    }
    if (!this.job) {
      const next = todo.find(([k, w]) => { const t = this.tilesOn.get(k); return !t || t.lod !== w.lod; });
      if (next) this.job = { k: next[0], lod: next[1].lod, steps: this._steps(next[1].i, next[1].j, next[1].lod) };
    }
    if (this.job) {
      const t0 = performance.now();
      while (performance.now() - t0 < 4) {
        const r = this.job.steps.next();
        if (r.done) {
          const w = want.get(this.job.k);
          if (w) this._place(this.job.k, r.value, this.job.lod);
          else this._dispose(r.value);
          this.job = null;
          break;
        }
      }
    }
  }

  _run(g) { let r; while (!(r = g.next()).done) { /* keep going */ } return r.value; }

  _place(k, built, lod) {
    const old = this.tilesOn.get(k);
    if (old) this._drop(k, old);
    this.root.add(built.group);
    this.tilesOn.set(k, { ...built, lod });
  }

  _drop(k, t) {
    this.root.remove(t.group);
    this._dispose(t);
    this.tilesOn.delete(k);
  }

  _dispose(t) {
    t.mesh.geometry.dispose();
    for (const m of t.inst) m.dispose();
  }

  /* One tile, a few rows at a time. */
  *_steps(ti, tj, lod) {
    const T = this.T, step = LODS[lod][1];
    const n = Math.round(SIZE / step) + 1;
    const x0 = ti * SIZE, z0 = tj * SIZE;
    // Heights on a grid one wider all round, for normals and curvature at the edges.
    const N = n + 2;
    const H = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) H[j * N + i] = T.height(x0 + (i - 1) * step, z0 + (j - 1) * step);
      if (j % 8 === 7) yield;
    }
    // The surface, plus a skirt: a second ring of vertices hanging below the edge.
    const ring = 4 * (n - 1);
    const count = n * n + ring;
    const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        const h = H[(j + 1) * N + i + 1];
        const hx = (H[(j + 1) * N + i + 2] - H[(j + 1) * N + i]) / (2 * step);
        const hz = (H[(j + 2) * N + i + 1] - H[j * N + i + 1]) / (2 * step);
        const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
        const v = (j * n + i) * 3;
        pos[v] = x; pos[v + 1] = h; pos[v + 2] = z;
        nrm[v] = -hx * inv; nrm[v + 1] = inv; nrm[v + 2] = -hz * inv;
        // Gullies and hollows hold a bluer shade; open ridges are bright.
        const lap = (H[(j + 1) * N + i + 2] + H[(j + 1) * N + i] + H[(j + 2) * N + i + 1] + H[j * N + i + 1] - 4 * h) / (step * step);
        const ripple = T.n.noise(x / 9 + 3.1, z / 9 - 7.7) * 0.5 + 0.5;
        c.copy(SNOW).lerp(SNOW_SHADE, ripple * 0.35);
        c.lerp(GULLY, Math.max(0, Math.min(0.45, lap * 2.5)));
        c.lerp(FOREST_FLOOR, T.density(x, z) * 0.35);
        const rock = smooth(0.78, 0.55, inv);
        if (rock > 0) c.lerp(ripple > 0.5 ? ROCK : ROCK_DARK, rock);
        col[v] = c.r; col[v + 1] = c.g; col[v + 2] = c.b;
      }
      if (j % 12 === 11) yield;
    }
    // Skirt vertices: the edge walked round, dropped a few metres.
    const edge = [];
    for (let i = 0; i < n - 1; i++) edge.push(i);                       // top, left→right
    for (let j = 0; j < n - 1; j++) edge.push(j * n + n - 1);           // right, top→bottom
    for (let i = n - 1; i > 0; i--) edge.push((n - 1) * n + i);         // bottom, right→left
    for (let j = n - 1; j > 0; j--) edge.push(j * n);                   // left, bottom→top
    edge.forEach((src, k) => {
      const v = (n * n + k) * 3, s3 = src * 3;
      pos[v] = pos[s3]; pos[v + 1] = pos[s3 + 1] - 3 * step; pos[v + 2] = pos[s3 + 2];
      nrm[v] = nrm[s3]; nrm[v + 1] = nrm[s3 + 1]; nrm[v + 2] = nrm[s3 + 2];
      col[v] = col[s3]; col[v + 1] = col[s3 + 1]; col[v + 2] = col[s3 + 2];
    });
    const idx = new Uint32Array((n - 1) * (n - 1) * 6 + ring * 12);
    let p = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
        idx[p++] = a; idx[p++] = d; idx[p++] = b;
        idx[p++] = b; idx[p++] = d; idx[p++] = e;
      }
    }
    for (let k = 0; k < ring; k++) {
      const a = edge[k], b = edge[(k + 1) % ring], a2 = n * n + k, b2 = n * n + (k + 1) % ring;
      // Two-sided by listing both windings, so it never vanishes from either view.
      idx[p++] = a; idx[p++] = b; idx[p++] = a2;
      idx[p++] = b; idx[p++] = b2; idx[p++] = a2;
      idx[p++] = a; idx[p++] = a2; idx[p++] = b;
      idx[p++] = b; idx[p++] = a2; idx[p++] = b2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx.subarray(0, p), 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.add(mesh);

    // Trees and rocks, for tiles close enough to see them.
    let inst = [];
    if (lod < 2) {
      const obstacles = [];
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) obstacles.push(...T.tile(ti * 2 + a, tj * 2 + b));
      inst = this._props({ obstacles }, group);
    }
    yield;
    return { group, mesh, inst };
  }

  dispose() {
    for (const [k, t] of this.tilesOn) this._drop(k, t);
    super.dispose();
  }
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

