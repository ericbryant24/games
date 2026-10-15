/* The mountain you can see: one chunk of snow per terrain segment, each carrying its
   own trees and rocks as instanced meshes. Chunks are built just ahead of the camera
   and thrown away once they are well behind it. */

import * as THREE from '../../vendor/three.module.min.js';
import { SEG } from '../terrain.js';
import { lowPoly, merge, paint } from './geom.js';

const SNOW = new THREE.Color(0xf6f9fd);
const SNOW_SHADE = new THREE.Color(0xdfe8f5);
const SNOW_DEEP = new THREE.Color(0xcdd9ec);
const ROCK = new THREE.Color(0x6c6f7b);
const ROCK_DARK = new THREE.Color(0x4d505c);
const SHADE = new THREE.Color(0xa7b9d6);      // snow falling away from you
const DYE = new THREE.Color(0x2f74e0);        // the blue line painted on a kicker's lip
const CORNICE = new THREE.Color(0x93a6c4);    // the edge of a drop
const HOLLOW = new THREE.Color(0x8fa5c8);     // shade round the foot of a tree

export class World {
  constructor(terrain, opts = {}) {
    this.T = terrain;
    this.q = opts;                         // { dx, dz, width, shadows, treeDetail }
    this.root = new THREE.Group();
    this.chunks = new Map();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.trees = makeTrees(opts.treeDetail ?? 1);
    this.rocks = makeRocks();
    this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.rockMat = this.treeMat;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  /* Keep chunks alive from `behind` metres up the hill to `ahead` metres down it.
     New chunks are built one a frame, nearest first, well before they come into view,
     so building never lands on the frame you need. `all` builds everything at once. */
  update(z, behind = 70, ahead = 300, all = false) {
    const k0 = Math.floor((z - behind) / SEG);
    const k1 = Math.floor((z + ahead) / SEG);
    this.T.ensure(z + ahead + SEG);
    const here = Math.floor(z / SEG);
    let budget = all ? Infinity : 1;
    // Nearest first: the one you are on, then the next ones down, then behind.
    const order = [];
    for (let k = here; k <= k1; k++) order.push(k);
    for (let k = here - 1; k >= k0; k--) order.push(k);
    for (const k of order) {
      if (this.chunks.has(k)) continue;
      const urgent = k >= here - 1 && k <= here + 2;
      if (budget <= 0 && !urgent) break;
      this.chunks.set(k, this._build(k));
      budget--;
    }
    for (const [k, c] of this.chunks) {
      if (k < k0 - 1 || k > k1 + 1) {
        this.root.remove(c.group);
        c.mesh.geometry.dispose();
        for (const m of c.inst) m.dispose();
        this.chunks.delete(k);
      }
    }
  }

  _build(k) {
    const T = this.T;
    const { dx = 1.6, width = 240 } = this.q;
    // Rows must land exactly on the segment's ends, or neighbouring chunks crack apart.
    const nz = Math.round(SEG / (this.q.dz || 1)) + 1;
    const dz = SEG / (nz - 1);
    const z0 = k * SEG, z1 = z0 + SEG;
    const mid = T.centre(z0 + SEG / 2);
    const xs = Math.floor((mid - width / 2) / dx) * dx;
    const nx = Math.ceil(width / dx) + 1;

    // Heights on a grid one cell wider all round, so normals at the edges are right.
    const H = new Float32Array((nx + 2) * (nz + 2));
    for (let j = 0; j < nz + 2; j++) {
      const z = z0 + (j - 1) * dz;
      for (let i = 0; i < nx + 2; i++) H[j * (nx + 2) + i] = T.height(xs + (i - 1) * dx, z);
    }
    const pos = new Float32Array(nx * nz * 3);
    const nrm = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const c = new THREE.Color();
    const W = nx + 2;
    const feats = [];
    for (const kk of [k - 1, k]) { const sg = T.segs.get(kk); if (sg) feats.push(...sg.features); }
    for (let j = 0; j < nz; j++) {
      const z = z0 + j * dz;
      const cz = T.centre(z), hw = T.halfWidth(z), fall = T.slope(z);
      for (let i = 0; i < nx; i++) {
        const x = xs + i * dx;
        const h = H[(j + 1) * W + i + 1];
        const hx = (H[(j + 1) * W + i + 2] - H[(j + 1) * W + i]) / (2 * dx);
        const hz = (H[(j + 2) * W + i + 1] - H[j * W + i + 1]) / (2 * dz);
        const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
        const ny = inv;
        const v = (j * nx + i) * 3;
        pos[v] = x; pos[v + 1] = h; pos[v + 2] = z;
        nrm[v] = -hx * inv; nrm[v + 1] = ny; nrm[v + 2] = -hz * inv;

        // Snow, a little bluer in the hollows and off-piste; rock where it is too steep
        // for snow to stick.
        const off = Math.max(0, Math.abs(x - cz) - hw) / 30;
        const ripple = T.n.noise(x / 9 + 3.1, z / 9 - 7.7) * 0.5 + 0.5;
        c.copy(SNOW).lerp(SNOW_SHADE, Math.min(1, ripple * 0.45 + off * 0.5));
        // Shade whatever drops away more steeply than the hill does, so bumps, the backs
        // of kickers and the edges of drops read from above.
        const away = -(hz + fall);
        if (away > 0.05) c.lerp(SHADE, Math.min(0.75, (away - 0.05) * 1.3));
        const rock = smooth(0.80, 0.55, ny);
        if (rock > 0) c.lerp(ripple > 0.5 ? ROCK : ROCK_DARK, rock);
        else if (ny < 0.9) c.lerp(SNOW_DEEP, (0.9 - ny) * 1.5);
        for (const f of feats) markFeature(f, x, z, c);
        col[v] = c.r; col[v + 1] = c.g; col[v + 2] = c.b;
      }
    }
    this._shadeUnder(T.segs.get(k), col, xs, z0, dx, dz, nx, nz);
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, d = a + nx, e = d + 1;
        idx[p++] = a; idx[p++] = d; idx[p++] = b;
        idx[p++] = b; idx[p++] = d; idx[p++] = e;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;

    const group = new THREE.Group();
    group.add(mesh);
    const inst = this._props(T.segs.get(k), group);
    this.root.add(group);
    return { group, mesh, inst };
  }

  /* A soft blue darkening in the snow round the foot of every tree and rock — the
     shade and the dished-out snow that make them sit in the ground, not on it. */
  _shadeUnder(seg, col, xs, z0, dx, dz, nx, nz) {
    if (!seg) return;
    const t = new THREE.Color();
    for (const o of seg.obstacles) {
      const R = o.kind === 'tree' ? 2.4 * o.s : 1.6 * o.s;
      const i0 = Math.max(0, Math.floor((o.x - R - xs) / dx)), i1 = Math.min(nx - 1, Math.ceil((o.x + R - xs) / dx));
      const j0 = Math.max(0, Math.floor((o.z - R - z0) / dz)), j1 = Math.min(nz - 1, Math.ceil((o.z + R - z0) / dz));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(xs + i * dx - o.x, z0 + j * dz - o.z) / R;
          if (d >= 1) continue;
          const v = (j * nx + i) * 3;
          const f = (1 - d) * (1 - d) * 0.42;
          t.setRGB(col[v], col[v + 1], col[v + 2]).lerp(HOLLOW, f);
          col[v] = t.r; col[v + 1] = t.g; col[v + 2] = t.b;
        }
      }
    }
  }

  _props(seg, group) {
    const out = [];
    if (!seg) return out;
    const byVar = [[], [], []];
    const rocks = [[], [], []];
    for (const o of seg.obstacles) (o.kind === 'tree' ? byVar : rocks)[o.v].push(o);
    const m = this._m, q = this._q, s = this._s, pp = this._p, e = this._e;
    const add = (geo, list, kind) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, this.treeMat, list.length);
      list.forEach((o, i) => {
        if (kind === 'tree') {
          e.set(0, o.rot, 0);
          s.set(o.s, o.s * (0.9 + (o.rot % 0.3)), o.s);
          pp.set(o.x, o.y - 0.15, o.z);
        } else {
          e.set(o.rot * 0.3, o.rot, o.rot * 0.17);
          s.set(o.s * 1.1, o.s * 0.85, o.s);
          pp.set(o.x, o.y, o.z);
        }
        q.setFromEuler(e);
        m.compose(pp, q, s);
        im.setMatrixAt(i, m);
      });
      im.castShadow = true;
      im.receiveShadow = kind === 'rock';
      im.computeBoundingSphere();
      group.add(im);
      out.push(im);
    };
    for (let v = 0; v < 3; v++) add(this.trees[v], byVar[v], 'tree');
    for (let v = 0; v < 3; v++) add(this.rocks[v], rocks[v], 'rock');
    return out;
  }

  dispose() {
    for (const c of this.chunks.values()) {
      c.mesh.geometry.dispose();
      for (const m of c.inst) m.dispose();
    }
    this.chunks.clear();
    for (const g of [...this.trees, ...this.rocks]) g.dispose();
    this.material.dispose();
    this.treeMat.dispose();
  }
}

/* Paint the cues a rider needs: a dye line on each kicker's lip, and a darkening band
   along the edge of every drop. */
function markFeature(f, x, z, c) {
  if (f.type === 'kicker') {
    const u = z - f.z;
    if (Math.abs(x - f.x) < f.W / 2 + 0.2 && u > f.L - 0.9 && u < f.L + 0.2) c.lerp(DYE, 0.85);
  } else if (f.type === 'drop' && x > f.xa - 2 && x < f.xb + 2) {
    const lip = f.z0 + f.zw * Math.sin(x * f.zf + f.zp);
    const d = lip - z;
    if (d > -0.3 && d < 5) c.lerp(CORNICE, 0.7 * (1 - Math.max(0, d) / 5));
  }
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* Low-poly pines: a short trunk and stacked tiers, each with snow lying on top. */
function makeTrees(detail) {
  const seg = detail > 0.5 ? 7 : 5;
  const GREEN = [0x2c5a45, 0x24503f, 0x386a4c];
  const out = [];
  for (let v = 0; v < 3; v++) {
    const parts = [];
    parts.push(paint(lowPoly(new THREE.CylinderGeometry(0.13, 0.2, 1.4, 5)).translate(0, 0.7, 0), 0x5b3d2b));
    const tiers = v === 2 ? 4 : 3;
    const height = v === 1 ? 7.6 : 7.0;
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers;
      const r = (v === 1 ? 1.75 : 2.0) * (1 - f * 0.68);
      const h = (height - 1.0) / tiers * 1.55;
      const y = 1.0 + (height - 1.0 - h * 0.62) * f;
      const cone = lowPoly(new THREE.ConeGeometry(r, h, seg)).rotateY(t * 0.7).translate(0, y + h / 2, 0);
      parts.push(paint(cone, GREEN[(t + v) % 3]));
      // Snow on the tier: a lighter cone over its top half.
      const sr = r * 0.66, sh = h * 0.52;
      const snow = lowPoly(new THREE.ConeGeometry(sr, sh, seg)).rotateY(t * 0.7 + 0.3)
        .translate(0, y + h - sh / 2 + 0.04, 0);
      parts.push(paint(snow, 0xf1f6fc));
    }
    out.push(merge(parts));
  }
  return out;
}

function makeRocks() {
  const out = [];
  for (let v = 0; v < 3; v++) {
    const g = lowPoly(new THREE.IcosahedronGeometry(1, v === 2 ? 1 : 0));
    const p = g.attributes.position;
    // Knock the shape about, the same way for vertices that share a corner.
    const jitter = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!jitter.has(key)) jitter.set(key, 0.75 + Math.random() * 0.45);
      const k = jitter.get(key);
      p.setXYZ(i, p.getX(i) * k, Math.max(-0.4, p.getY(i)) * k * 0.9, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    // Snow sits on the faces that look up.
    const n = g.attributes.normal;
    const col = new Float32Array(p.count * 3);
    const rock = new THREE.Color(v === 1 ? 0x7a7d88 : 0x666975), snow = new THREE.Color(0xf2f6fb);
    for (let i = 0; i < p.count; i += 3) {
      const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
      const c = ny > 0.62 ? snow : rock;
      for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.push(g);
  }
  return out;
}
