/* Wake and spray. The wake is a ribbon of foam laid down behind the boat and left to
   sit on the water, so it stays where the boat put it while the boat sails on. */

import * as THREE from '../../vendor/three.module.min.js';

function foamTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 64);            // transparent: the foam is what we draw in
  // Soft blobby foam, denser along the middle of the ribbon.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 64;
    const edge = 1 - Math.abs(y / 64 - 0.5) * 2;
    const r = 1.5 + Math.random() * 6 * edge;
    const a = 0.10 + Math.random() * 0.75 * edge;
    g.fillStyle = `rgba(255,255,255,${a})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  /* Force every pixel's colour to white and keep only the alpha. A cleared canvas
     leaves transparent pixels black, and once the sampler interpolates between those
     and the foam you get a grey fringe down the edge of the wake. */
  const img = g.getImageData(0, 0, 128, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
  }
  g.putImageData(img, 0, 0);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function sprayTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.45, 'rgba(236,246,252,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Wake {
  constructor(waves, opts = {}) {
    this.waves = waves;
    this.max = opts.samples ?? 72;
    this.spacing = opts.spacing ?? 1.1;      // metres between ribbon ribs
    this.life = opts.life ?? 13;             // seconds before a rib has faded out
    this.samples = [];

    /* Four vertices across each rib rather than two, with the outer pair transparent.
       A two-wide strip has a hard edge down each side, and at close range that reads as
       a polygon lying on the water. */
    this.across = [-1, -0.52, 0.52, 1];
    this.acrossAlpha = [0, 1, 1, 0];
    const W = this.across.length;
    const verts = new Float32Array(this.max * W * 3);
    const colors = new Float32Array(this.max * W * 4);
    const uvs = new Float32Array(this.max * W * 2);
    const idx = [];
    for (let i = 0; i < this.max - 1; i++) {
      for (let c = 0; c < W - 1; c++) {
        const a = i * W + c, b = a + 1, d = (i + 1) * W + c, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(idx);
    this.geometry.setDrawRange(0, 0);

    this.quadsPerRib = (this.across.length - 1) * 6;
    this.mesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({
      map: foamTexture(), transparent: true, vertexColors: true,
      depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;

    /* Spray: a pool of short-lived points thrown up at the bow. */
    const n = opts.spray ?? 220;
    this.spray = { n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
      life: new Float32Array(n), size: new Float32Array(n), next: 0 };
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.spray.pos, 3));
    sg.setAttribute('size', new THREE.BufferAttribute(this.spray.size, 1));
    this.sprayMesh = new THREE.Points(sg, new THREE.PointsMaterial({
      map: sprayTexture(), size: 0.5, transparent: true, depthWrite: false,
      sizeAttenuation: true, opacity: 0.85, blending: THREE.NormalBlending
    }));
    this.sprayMesh.frustumCulled = false;
    this.sprayMesh.renderOrder = 4;
    this._wave = { y: 0, dhdx: 0, dhdz: 0, hullX: 0, hullZ: 0 };
  }

  reset() {
    this.samples.length = 0;
    this.geometry.setDrawRange(0, 0);
    for (let i = 0; i < this.spray.n; i++) this.spray.life[i] = 0;
  }

  update(boat, time, dt) {
    const spd = boat.tel.speed;
    const sx = Math.cos(boat.psi), sz = -Math.sin(boat.psi);
    const fx = Math.sin(boat.psi), fz = Math.cos(boat.psi);
    const sternX = boat.x - fx * boat.spec.loa * 0.48;
    const sternZ = boat.z - fz * boat.spec.loa * 0.48;

    const last = this.samples[this.samples.length - 1];
    if (!last || Math.hypot(sternX - last.x, sternZ - last.z) > this.spacing) {
      this.samples.push({
        x: sternX, z: sternZ, sx, sz, t: time,
        // A faster boat leaves a wider, brighter wake; a drifting one barely marks it.
        w: 0.55 + spd * 0.20, a: Math.max(0, Math.min(0.60, (spd - 0.6) * 0.22))
      });
      if (this.samples.length > this.max) this.samples.shift();
    }

    const pos = this.geometry.attributes.position.array;
    const col = this.geometry.attributes.color.array;
    const uv = this.geometry.attributes.uv.array;
    let k = 0;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      const age = (time - s.t) / this.life;
      if (age >= 1) continue;
      // Foam spreads and thins as it drifts astern.
      const spread = s.w * (1 + age * 1.9);
      const fade = (1 - age) * (1 - age) * s.a;
      for (let c = 0; c < this.across.length; c++) {
        const off = this.across[c] * spread;
        const px = s.x + s.sx * off;
        const pz = s.z + s.sz * off;
        this.waves.sample(px, pz, time, this._wave);
        pos[k * 3] = px;
        pos[k * 3 + 1] = this._wave.y + 0.035;
        pos[k * 3 + 2] = pz;
        col[k * 4] = 1; col[k * 4 + 1] = 1; col[k * 4 + 2] = 1;
        col[k * 4 + 3] = fade * this.acrossAlpha[c];
        uv[k * 2] = i * 0.5;
        uv[k * 2 + 1] = c / (this.across.length - 1);
        k++;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.uv.needsUpdate = true;
    const ribs = k / this.across.length;
    this.geometry.setDrawRange(0, Math.max(0, (ribs - 1) * this.quadsPerRib));

    /* Spray off the bow, when the boat is pressing into it. */
    const sp = this.spray;
    const rate = boat.spray * 60 * dt;
    let emit = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
    const bowX = boat.x + fx * boat.spec.loa * 0.46;
    const bowZ = boat.z + fz * boat.spec.loa * 0.46;
    while (emit-- > 0) {
      const i = sp.next = (sp.next + 1) % sp.n;
      const lat = (Math.random() - 0.5) * 0.7;
      sp.pos[i * 3] = bowX + sx * lat;
      sp.pos[i * 3 + 1] = boat.y + 0.15;
      sp.pos[i * 3 + 2] = bowZ + sz * lat;
      const out = (Math.random() * 0.8 + 0.5) * Math.sign(lat || 1);
      sp.vel[i * 3] = fx * spd * 0.55 + sx * out * 1.9;
      sp.vel[i * 3 + 1] = 1.6 + Math.random() * 2.7 * boat.spray;
      sp.vel[i * 3 + 2] = fz * spd * 0.55 + sz * out * 1.9;
      sp.life[i] = 0.55 + Math.random() * 0.75;
      sp.size[i] = 0.16 + Math.random() * 0.4;
    }
    for (let i = 0; i < sp.n; i++) {
      if (sp.life[i] <= 0) { sp.size[i] = 0; continue; }
      sp.life[i] -= dt;
      sp.vel[i * 3 + 1] -= 9.81 * dt * 0.55;
      sp.pos[i * 3] += sp.vel[i * 3] * dt;
      sp.pos[i * 3 + 1] += sp.vel[i * 3 + 1] * dt;
      sp.pos[i * 3 + 2] += sp.vel[i * 3 + 2] * dt;
      if (sp.life[i] <= 0) sp.size[i] = 0;
      else sp.size[i] *= 1 + dt * 0.6;
    }
    this.sprayMesh.geometry.attributes.position.needsUpdate = true;
    this.sprayMesh.geometry.attributes.size.needsUpdate = true;
  }
}
