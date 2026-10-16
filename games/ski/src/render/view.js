/* Everything you can see: renderer, light, sky, the mountain, the riders, their tracks
   and the snow they throw. The camera hangs above and behind you looking down the fall
   line — portrait-first, so the hill ahead fills the top of the screen and the three
   chasing you are in view below. */

import * as THREE from '../../vendor/three.module.min.js';
import { World } from './world.js';
import { RiderMesh, OUTFITS } from './rider.js';
import { Tracks } from './grooves.js';
import { Snow, Flakes } from './powder.js';

export const QUALITY = {
  low:    { pixel: 1.0,  shadow: 0,    dx: 2.2, dz: 1.4, ahead: 220, tree: 0.4, spray: 400, flakes: 0 },
  medium: { pixel: 1.75, shadow: 2048, dx: 1.3, dz: 0.85, ahead: 280, tree: 1, spray: 700, flakes: 220 },
  high:   { pixel: 2.5,  shadow: 2048, dx: 1.0, dz: 0.7, ahead: 320, tree: 1, spray: 900, flakes: 360 }
};

const HORIZON = new THREE.Color(0xdfeaf6);
const ZENITH = new THREE.Color(0x5f9be0);
const UP = new THREE.Vector3(0, 1, 0);
const BLOB_GEO = new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2);
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
const SUN_DIR = new THREE.Vector3(-0.72, 0.46, 0.52).normalize();
const LIGHT_U = new THREE.Vector3(0, 1, 0).cross(SUN_DIR).normalize();
const LIGHT_W = SUN_DIR.clone().cross(LIGHT_U).normalize();

export class View {
  constructor(canvas, sim, opts = {}) {
    this.sim = sim;
    this.canvas = canvas;
    const qname = opts.quality || 'medium';
    const q = this.q = QUALITY[qname];
    this.mode = opts.camera || 'chase';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: qname !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixel));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    if (q.shadow) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.scene = new THREE.Scene();
    this.scene.background = HORIZON.clone();
    // The reverse camera sits a hundred metres off, so its haze starts further out.
    this.scene.fog = this.mode === 'reverse'
      ? new THREE.Fog(HORIZON.clone(), 160, 420)
      : new THREE.Fog(HORIZON.clone(), 130, 400);
    this.camera = new THREE.PerspectiveCamera(50, 1, 4, 2500);

    // Bright sun, and a sky that fills the shadows with blue — the look of a clear day
    // on snow.
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
    this.hemi = new THREE.HemisphereLight(0x9cc0f4, 0x6b7c9c, 0.85);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    if (q.shadow) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(q.shadow, q.shadow);
      const s = this.sun.shadow.camera;
      s.left = -42; s.right = 42; s.top = 50; s.bottom = -50; s.near = 1; s.far = 260;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
    }

    this.sky = makeSky();
    this.scene.add(this.sky);

    this.world = new World(sim.terrain, { dx: q.dx, dz: q.dz, treeDetail: q.tree });
    this.scene.add(this.world.root);

    this.riderMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.riders = sim.riders.map((r, i) => {
      const kind = r.spec.kind;
      const outfit = OUTFITS[(r.outfit ?? i) % OUTFITS.length];
      const mesh = new RiderMesh(kind, outfit, this.riderMat);
      // A touch larger than life, so you can read them from the camera's distance.
      mesh.root.scale.setScalar(this.mode === 'reverse' ? 1.6 : 1.15);
      const tracks = new Tracks(sim.terrain, kind);
      this.scene.add(mesh.root, tracks.mesh);
      return { r, mesh, tracks, color: outfit.jacket };
    });

    this.snow = new Snow(q.spray);
    this.scene.add(this.snow.mesh);
    if (q.flakes) {
      this.flakes = new Flakes(q.flakes);
      this.scene.add(this.flakes.mesh);
    }

    this.cam = new THREE.Vector3();
    this._nv = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.camX = 0;
    this.shake = 0;
    this._v = new THREE.Vector3();
    this.resize();
    this.world.update(sim.player.z, 80, q.ahead, true);
    this.snapCamera();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.w = w; this.h = h;
    this.camera.updateProjectionMatrix();
  }

  /* Where the camera wants to be for the player's current (blended) pose. */
  _target(out, look) {
    const p = this.at, T = this.sim.terrain;
    const v = Math.min(30, this.sim.player.speed);
    const portrait = this.camera.aspect < 1;
    const x = this.camX;
    if (this.mode === 'reverse') {
      // Down the hill, looking back up at you coming towards it: the faces of drops and
      // jumps face the lens, the three chasing you are above you on screen, and about
      // thirty-five metres of the hill ahead fill the screen below you. The angle is
      // set against the slope itself so steep and gentle pitches frame the same.
      // A long lens from a long way off, like GMA: flat, almost isometric perspective,
      // so the riders stay a readable size and the hill does not bend away.
      const A = (portrait ? 8 : 6) + v * 0.1;
      const dist = (portrait ? 100 : 84) + v * 0.9;
      const e = (portrait ? 1.13 : 1.0) - Math.atan(this.fall);
      const tz = p.z + A;
      const ty = T.height(x + (p.x - x) * 0.7, tz);
      look.set(x + (p.x - x) * 0.7, ty, tz);
      out.set(x, ty + Math.sin(e) * dist, tz + Math.cos(e) * dist);
      return;
    }
    // Behind, up the hill, on a long lens like GMA's: you just below the middle of the
    // screen, the three chasing you beneath, and the hill ahead filling the top. Set
    // against the slope itself so steep and gentle pitches frame the same.
    const A = (portrait ? 6 : 8) + v * 0.15;
    const dist = (portrait ? 62 : 56) + v * 0.8;
    const e = (portrait ? 0.52 : 0.42) + Math.atan(this.fall);
    const lx = x + (p.x - x) * 0.7, tz = p.z + A, ty = T.height(lx, tz);
    look.set(lx, ty, tz);
    out.set(x, ty + Math.sin(e) * dist, tz - Math.cos(e) * dist);
  }

  /* The pitch of the hill around you, smoothed: rise over run down the fall line. */
  _fall(z, x) {
    const T = this.sim.terrain;
    return Math.max(0.05, (T.height(x, z - 10) - T.height(x, z + 30)) / 40);
  }

  /* Field of view for the current camera, shape of screen and speed. */
  _fov() {
    const portrait = this.camera.aspect < 1, v = this.sim.player.speed;
    return this.mode === 'reverse'
      ? (portrait ? 30 : 24) + Math.min(2, v * 0.06)
      : (portrait ? 26 : 22) + Math.min(2, v * 0.06);
  }

  snapCamera() {
    const p = this.sim.player;
    this.camera.fov = this._fov();
    this.camera.updateProjectionMatrix();
    this.at = p.pose(1, this.at || {});
    this.camX = p.x;
    this.fall = this._fall(p.z, p.x);
    this._target(this.cam, this.look);
    this.camera.position.copy(this.cam);
    this.camera.lookAt(this.look);
  }

  update(dt) {
    const sim = this.sim, p = sim.player;
    const a = sim.alpha;
    this.world.update(p.z, 80, this.q.ahead);

    for (const e of this.riders) {
      e.at = e.r.pose(a, e.at || {});
      e.mesh.update(e.r, dt, e.at);
      e.tracks.update(e.r);
      this._spray(e.r, dt);
    }
    this.at = this.riders[0].at;
    for (const e of this.riders) this._blob(e);
    this._seeThrough();
    this._pace(dt);
    this.snow.update(dt, this.h);
    this.world.uniforms.uTime.value += dt;

    // The camera floats: it drifts across the hill after you, leaning a little towards
    // where you are heading, and rises and falls slowly so bumps never make it bob.
    // Down the hill it keeps exact pace, or you would shudder.
    const k = 1 - Math.exp(-dt * 2.4);
    const lead = clamp(p.vx * 0.35, -4, 4);
    this.camVX = (this.camVX || 0) + ((this.at.x + lead - this.camX) * 6 - (this.camVX || 0) * 4.9) * dt;
    this.camX += this.camVX * dt;
    this.fall += (this._fall(this.at.z, this.camX) - this.fall) * (1 - Math.exp(-dt * 0.6));
    const want = this._v;
    const look = this._look || (this._look = new THREE.Vector3());
    this._target(want, look);
    const ky = 1 - Math.exp(-dt * 1.8);
    this.cam.set(want.x, this.cam.y + (want.y - this.cam.y) * ky, want.z);
    this.look.set(look.x, this.look.y + (look.y - this.look.y) * ky, look.z);
    // Only a crash jolts the picture, and only a little.
    if (p.crashed && p.crashT < 0.02) this.shake = 0.35;
    this.shake *= Math.exp(-dt * 6);
    this.camera.position.copy(this.cam);
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.look);
    const portrait = this.camera.aspect < 1;
    const fov = this._fov();
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }

    // The sun's shadow box rides along with you, snapped to whole shadow-map texels in
    // the light's own frame so shadow edges do not crawl as you move.
    const c = this._sv || (this._sv = new THREE.Vector3());
    c.set(this.at.x, this.at.y, this.at.z + 10);
    if (this.q.shadow) {
      const texel = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.q.shadow;
      const u = c.dot(LIGHT_U), w = c.dot(LIGHT_W), d = c.dot(SUN_DIR);
      const su = Math.round(u / texel) * texel, sw = Math.round(w / texel) * texel;
      c.copy(LIGHT_U).multiplyScalar(su).addScaledVector(LIGHT_W, sw).addScaledVector(SUN_DIR, d);
    }
    this.sun.position.copy(c).addScaledVector(SUN_DIR, 120);
    this.sun.target.position.copy(c);
    this.sky.position.copy(this.camera.position);
    if (this.flakes) this.flakes.update(dt, this.cam.x, this.at.y + 8, this.at.z + 6);
  }

  /* A soft shadow pooled on the snow right under each rider — it is what makes them
     sit on the hill rather than float over it, and it shrinks and fades as they fly. */
  _blob(e) {
    if (!e.blob) {
      e.blob = new THREE.Mesh(BLOB_GEO, new THREE.MeshBasicMaterial({
        map: blobTexture(), color: 0x2a3a66, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      e.blob.renderOrder = 2;
      this.scene.add(e.blob);
    }
    const T = this.sim.terrain, at = e.at;
    const g = T.height(at.x, at.z), h = Math.max(0, at.y - g);
    T.normal(at.x, at.z, this._n || (this._n = { x: 0, y: 1, z: 0 }));
    e.blob.position.set(at.x, g + 0.04, at.z);
    e.blob.quaternion.setFromUnitVectors(UP, this._nv.set(this._n.x, this._n.y, this._n.z));
    e.blob.rotateY(at.psi);
    const sc = (e.r.spec.kind === 'board' ? 1.25 : 1) * (1 + h * 0.12);
    e.blob.scale.set(sc, 1, sc * 1.5);
    e.blob.material.opacity = 0.42 * Math.max(0, 1 - h / 7);
  }

  /* Tell the trees where you are on screen, so the ones in front of you can thin out. */
  _seeThrough() {
    const at = this.at, pr = this.renderer.getPixelRatio();
    const v = this._sp || (this._sp = new THREE.Vector3());
    v.set(at.x, at.y + 1.0, at.z).project(this.camera);
    const u = this.world.uniforms;
    u.uSee.value.set((v.x * 0.5 + 0.5) * this.w * pr, (v.y * 0.5 + 0.5) * this.h * pr, v.z * 0.5 + 0.5 - 0.0005);
    u.uSeeR.value = 70 * pr;
  }

  /* Keep the frame rate steady: if frames run long, render a touch fewer pixels; when
     there is headroom again, creep back up to full sharpness. */
  _pace(dt) {
    this._ft = this._ft === undefined ? 1 / 60 : this._ft + (dt - this._ft) * 0.05;
    this._pt = (this._pt || 0) + dt;
    if (this._pt < 1.5 || dt <= 0) return;
    this._pt = 0;
    const max = Math.min(window.devicePixelRatio || 1, this.q.pixel);
    let pr = this.renderer.getPixelRatio();
    if (this._ft > 1 / 50 && pr > 1) { pr = Math.max(1, pr - 0.25); this._good = 0; }
    else if (this._ft < 1 / 58 && pr < max && (this._good = (this._good || 0) + 1) >= 3) { pr = Math.min(max, pr + 0.25); this._good = 0; }
    else return;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.w, this.h, false);
  }

  /* Snow thrown up by edges, landings and crashes. */
  _spray(r, dt) {
    const sn = this.snow;
    if (r.landed > 1.5) sn.emit(r.x, r.y, r.z, r.vx * 0.3, 1.2, r.vz * 0.3, Math.min(40, 6 + r.landed * 4), 2.2, 0.7, 0.9);
    if (r.crashed) {
      if (r.crashT < 0.02) sn.emit(r.x, r.y + 0.4, r.z, r.vx * 0.4, 2.5, r.vz * 0.4, 70, 3.5, 0.9, 1.3);
      else if (r.speed > 1.5 && Math.random() < dt * 30) sn.emit(r.x, r.y + 0.2, r.z, r.vx * 0.3, 1, r.vz * 0.3, 2, 1.2, 0.7);
      return;
    }
    if (r.air) return;
    // A fine powder trail off the skis whenever you are really moving.
    if (r.speed > 9 && Math.random() < (r.speed - 9) * dt * 2.2) {
      sn.emit(r.x - Math.sin(r.psi) * 0.6, r.y + 0.05, r.z - Math.cos(r.psi) * 0.6,
        r.vx * 0.25, 0.5, r.vz * 0.25, 1, 0.5, 0.55, 0.7);
    }
    // A carve peels a ribbon of snow off the outside edge, more the harder you lean.
    const carve = Math.max(0, Math.min(1, (Math.abs(r.lean) - 0.3) * 1.4)) * Math.min(1, r.speed / 12);
    if (carve > 0.02) {
      const nc = carve * dt * 70;
      const cc = Math.floor(nc) + (Math.random() < nc % 1 ? 1 : 0);
      if (cc) {
        const sd = r.lean > 0 ? 1 : -1;
        const ox = -Math.cos(r.psi) * sd, oz = Math.sin(r.psi) * sd;
        sn.emit(r.x + ox * 0.35 - Math.sin(r.psi) * 0.4, r.y + 0.05, r.z + oz * 0.35 - Math.cos(r.psi) * 0.4,
          ox * 2.2 * carve + r.vx * 0.35, 1.3 * carve, oz * 2.2 * carve + r.vz * 0.35, cc, 0.6, 0.6, 0.65);
      }
    }
    const amount = r.skid * Math.min(1, r.speed / 8);
    if (amount < 0.06) return;
    const n = amount * dt * 170;
    const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    if (!count) return;
    // Out from the edges, to the outside of the turn.
    const side = r.lean > 0 ? 1 : -1;
    const rx = -Math.cos(r.psi) * side, rz = Math.sin(r.psi) * side;
    sn.emit(r.x + rx * 0.3, r.y + 0.05, r.z + rz * 0.3,
      rx * 3.2 * amount + r.vx * 0.45, 2.0 * amount, rz * 3.2 * amount + r.vz * 0.45, count, 1.1, 0.75, 0.75);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  /* Screen position of a world point, in CSS pixels; z > 1 means behind the camera. */
  project(x, y, z) {
    const v = this._v.set(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, behind: v.z > 1 };
  }

  dispose() {
    this.world.dispose();
    for (const e of this.riders) e.tracks.dispose();
    this.snow.dispose();
    if (this.flakes) this.flakes.dispose();
    this.renderer.dispose();
  }
}

function makeSky() {
  const g = new THREE.SphereGeometry(1500, 24, 12);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: ZENITH }, uHorizon: { value: HORIZON }, uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uTop, pow(h, 0.55));
        float s = max(dot(normalize(vDir), uSun), 0.0);
        c += vec3(1.0, 0.92, 0.78) * (pow(s, 600.0) * 1.5 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
