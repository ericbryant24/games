/* Everything you can see: renderer, light, sky, the mountain, the riders, their tracks
   and the snow they throw. The camera hangs above and behind you looking down the fall
   line — portrait-first, so the hill ahead fills the top of the screen and the three
   chasing you are in view below. */

import * as THREE from '../../vendor/three.module.min.js';
import { World } from './world.js';
import { RiderMesh, OUTFITS } from './rider.js';
import { Tracks } from './tracks.js';
import { Snow, Flakes } from './snow.js';

export const QUALITY = {
  low:    { pixel: 1.0,  shadow: 0,    dx: 2.2, dz: 1.4, ahead: 220, tree: 0.4, spray: 400, flakes: 0 },
  medium: { pixel: 1.75, shadow: 2048, dx: 1.3, dz: 0.85, ahead: 280, tree: 1, spray: 700, flakes: 220 },
  high:   { pixel: 2.5,  shadow: 2048, dx: 1.0, dz: 0.7, ahead: 320, tree: 1, spray: 900, flakes: 360 }
};

const HORIZON = new THREE.Color(0xdfeaf6);
const ZENITH = new THREE.Color(0x5f9be0);
const SUN_DIR = new THREE.Vector3(-0.62, 0.58, 0.30).normalize();
const LIGHT_U = new THREE.Vector3(0, 1, 0).cross(SUN_DIR).normalize();
const LIGHT_W = SUN_DIR.clone().cross(LIGHT_U).normalize();

export class View {
  constructor(canvas, sim, opts = {}) {
    this.sim = sim;
    this.canvas = canvas;
    const qname = opts.quality || 'medium';
    const q = this.q = QUALITY[qname];
    this.mode = opts.camera || 'reverse';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: qname !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixel));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    if (q.shadow) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.scene = new THREE.Scene();
    this.scene.background = HORIZON.clone();
    this.scene.fog = new THREE.Fog(HORIZON.clone(), 110, q.ahead + 20);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2500);

    // Bright sun, and a sky that fills the shadows with blue — the look of a clear day
    // on snow.
    this.sun = new THREE.DirectionalLight(0xfff1dc, 1.9);
    this.hemi = new THREE.HemisphereLight(0xa9c6f2, 0x7d88a0, 0.95);
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
      mesh.root.scale.setScalar(this.mode === 'reverse' ? 1.45 : 1.15);
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
      const A = (portrait ? 8.5 : 6) + v * 0.1;
      const dist = (portrait ? 54 : 46) + v * 0.55;
      const e = (portrait ? 1.17 : 1.02) - Math.atan(this.fall);
      const tz = p.z + A;
      const ty = T.height(x + (p.x - x) * 0.7, tz);
      look.set(x + (p.x - x) * 0.7, ty, tz);
      out.set(x, ty + Math.sin(e) * dist, tz + Math.cos(e) * dist);
      return;
    }
    // Behind: further back and higher as you speed up; looking well ahead of you.
    const back = (portrait ? 15 : 13) + v * 0.22;
    const up = (portrait ? 23 : 17) + v * 0.30;
    const ahead = (portrait ? 4 : 8) + v * 0.45;
    out.set(x, 0, p.z - back);
    out.y = Math.max(p.y + up, T.height(x, p.z - back) + 4);
    look.set(x + (p.x - x) * 0.7, p.y - 1.5, p.z + ahead);
  }

  /* The pitch of the hill around you, smoothed: rise over run down the fall line. */
  _fall(z, x) {
    const T = this.sim.terrain;
    return Math.max(0.05, (T.height(x, z - 10) - T.height(x, z + 30)) / 40);
  }

  snapCamera() {
    const p = this.sim.player;
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
    this.snow.update(dt, this.h);

    // The camera drifts across the hill after you, and is a touch springy vertically
    // so landings register. Down the hill it keeps exact pace, or you would shudder.
    const k = 1 - Math.exp(-dt * 2.4);
    this.camX += (this.at.x - this.camX) * k;
    this.fall += (this._fall(this.at.z, this.camX) - this.fall) * (1 - Math.exp(-dt * 0.8));
    const want = this._v;
    const look = this._look || (this._look = new THREE.Vector3());
    this._target(want, look);
    const ky = 1 - Math.exp(-dt * 5);
    this.cam.set(want.x, this.cam.y + (want.y - this.cam.y) * ky, want.z);
    this.look.set(look.x, this.look.y + (look.y - this.look.y) * ky, look.z);
    if (p.landed > 3) this.shake = Math.min(0.5, p.landed * 0.04);
    if (p.crashed && p.crashT < 0.02) this.shake = 0.7;
    this.shake *= Math.exp(-dt * 6);
    this.camera.position.copy(this.cam);
    if (this.shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.camera.lookAt(this.look);
    const portrait = this.camera.aspect < 1;
    const fov = this.mode === 'reverse'
      ? (portrait ? 56 : 42) + Math.min(4, p.speed * 0.12)
      : (portrait ? 62 : 48) + Math.min(8, p.speed * 0.2);
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
    const amount = r.skid * Math.min(1, r.speed / 8);
    if (amount < 0.06) return;
    const n = amount * dt * 90;
    const count = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    if (!count) return;
    // Out from the edges, to the outside of the turn.
    const side = r.lean > 0 ? 1 : -1;
    const rx = -Math.cos(r.psi) * side, rz = Math.sin(r.psi) * side;
    sn.emit(r.x + rx * 0.3, r.y + 0.05, r.z + rz * 0.3,
      rx * 2.5 * amount + r.vx * 0.45, 1.6 * amount, rz * 2.5 * amount + r.vz * 0.45, count, 0.9, 0.45, 0.6);
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
