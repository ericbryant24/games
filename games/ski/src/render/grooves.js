/* The lines everyone leaves in the snow: two grooves behind a skier, one wide swathe
   behind a board. Each is a ribbon laid on the surface, broken wherever its rider
   was in the air. */

import * as THREE from '../../vendor/three.module.min.js';

const MAX = 520;
const SPACING = 0.35;

function grooveTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 4;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 4);
  for (let x = 0; x < 64; x++) {
    const u = x / 63;
    let a;
    if (kind === 'board') a = Math.max(0, 1 - Math.pow(Math.abs(u - 0.5) / 0.46, 6)) * 0.85;
    else a = Math.max(Math.exp(-Math.pow((u - 0.27) / 0.1, 2)), Math.exp(-Math.pow((u - 0.73) / 0.1, 2)));
    for (let y = 0; y < 4; y++) {
      const i = (y * 64 + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Tracks {
  constructor(terrain, kind) {
    this.T = terrain;
    this.width = kind === 'board' ? 0.42 : 0.5;
    this.pts = [];
    this.dist = 0;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 2 * 3);
    this.col = new Float32Array(MAX * 2 * 4);
    this.uv = new Float32Array(MAX * 2 * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    // Lit as if lying flat; near enough on a ribbon this narrow.
    const nrm = new Float32Array(MAX * 2 * 3);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    this.geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    this.idx = new Uint32Array((MAX - 1) * 6);
    this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.MeshLambertMaterial({
      color: 0xa9bad6, map: grooveTexture(kind), vertexColors: true, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.last = null;
    this.broken = true;
  }

  update(r) {
    if (r.air || (r.crashed && r.speed < 0.5)) { this.broken = true; return; }
    if (this.last && Math.hypot(r.x - this.last.x, r.z - this.last.z) < SPACING) return;
    const fx = Math.sin(r.psi), fz = Math.cos(r.psi);
    const step = this.last ? Math.hypot(r.x - this.last.x, r.z - this.last.z) : 0;
    this.dist += step;
    const p = { x: r.x, z: r.z, rx: -fz, rz: fx, v: this.dist / 2.2, brk: this.broken,
      a: r.crashed ? 0.9 : 0.55 + 0.35 * Math.min(1, r.skid * 2) };
    // Crashing leaves a wide gouge.
    const w = (r.crashed ? 1.1 : this.width) / 2;
    p.lx = r.x + p.rx * w; p.lz = r.z + p.rz * w;
    p.qx = r.x - p.rx * w; p.qz = r.z - p.rz * w;
    p.ly = this.T.height(p.lx, p.lz) + 0.035;
    p.qy = this.T.height(p.qx, p.qz) + 0.035;
    this.pts.push(p);
    if (this.pts.length > MAX) this.pts.shift();
    this.last = p;
    this.broken = false;
    this._rebuild();
  }

  _rebuild() {
    const P = this.pts, n = P.length;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      // Fade the oldest out so the end of the line is not a hard cut.
      const fade = Math.min(1, i / 40) * p.a;
      this.pos.set([p.lx, p.ly, p.lz, p.qx, p.qy, p.qz], i * 6);
      this.col.set([1, 1, 1, fade, 1, 1, 1, fade], i * 8);
      this.uv.set([0, p.v, 1, p.v], i * 4);
    }
    for (let i = 0; i < n - 1; i++) {
      if (P[i + 1].brk) continue;
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      this.idx[k++] = a; this.idx[k++] = c; this.idx[k++] = b;
      this.idx[k++] = b; this.idx[k++] = c; this.idx[k++] = d;
    }
    this.geo.setDrawRange(0, k);
    for (const name of ['position', 'color', 'uv']) this.geo.attributes[name].needsUpdate = true;
    this.geo.index.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mat.map.dispose(); this.mat.dispose(); }
}
