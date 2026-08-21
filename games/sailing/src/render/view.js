/* Everything you can see: renderer, scene, chase camera and the models that stand in
   for the simulation. Portrait-first — the camera sits a little higher and further back
   than it would in landscape so there is water ahead of the bow to read. */

import * as THREE from '../../vendor/three.module.min.js';
import { Ocean, MAX_SHADOWS } from './ocean.js';
import { Sky, WEATHER, applyWeather } from './sky.js';
import { BoatMesh } from './boatmesh.js';
import { Wake } from './wake.js';
import { CourseView } from './marks.js';

const HULL_COLORS = [0xf2f4f6, 0x1d3b56, 0xbc3b2a, 0x2f6b4f, 0xe4dcc6, 0x3a3f46];
const KITE_COLORS = [0xffbe52, 0xff5f7e, 0x54c2f0, 0x8be36a, 0xffe066, 0xb08cff];

export const QUALITY = {
  low:    { rings: 62,  segments: 72,  pixel: 1.0,  detail: 0.4, radius: 1100, spray: 90,  wake: 44 },
  medium: { rings: 92,  segments: 104, pixel: 1.35, detail: 1.0, radius: 1400, spray: 170, wake: 64 },
  high:   { rings: 128, segments: 132, pixel: 2.0,  detail: 1.0, radius: 1700, spray: 260, wake: 84 }
};

export class View {
  constructor(canvas, sim, opts = {}) {
    this.sim = sim;
    this.canvas = canvas;
    const q = this.q = QUALITY[opts.quality || 'medium'];

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: (opts.quality || 'medium') !== 'low',
      powerPreference: 'high-performance', alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixel));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.35, 6000);
    this.camera.position.set(0, 6, -14);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.ambient = new THREE.HemisphereLight(0x88aadd, 0x2a3a44, 0.9);
    this.scene.add(this.sun, this.ambient);

    this.sky = new Sky();
    this.ocean = new Ocean(sim.waves, { rings: q.rings, segments: q.segments, radius: q.radius });
    this.ocean.syncWaves();
    this.scene.add(this.sky.mesh, this.ocean.mesh);

    this.courseView = new CourseView(sim.course, sim.waves);
    this.scene.add(this.courseView.root);

    /* One model per boat. The player's gets full detail and a full wake. */
    this.boats = sim.boats.map((b, i) => {
      const mesh = new BoatMesh(b.spec, {
        color: b.isPlayer ? HULL_COLORS[0] : HULL_COLORS[1 + (i % (HULL_COLORS.length - 1))],
        kite: b.isPlayer ? KITE_COLORS[0] : KITE_COLORS[i % KITE_COLORS.length],
        detail: b.isPlayer ? 1 : q.detail,
        sail: b.sail
      });
      this.scene.add(mesh.root);
      const wake = new Wake(sim.waves, {
        samples: b.isPlayer ? q.wake : Math.round(q.wake * 0.6),
        spray: b.isPlayer ? q.spray : Math.round(q.spray * 0.35)
      });
      this.scene.add(wake.mesh, wake.sprayMesh);
      return { boat: b, mesh, wake };
    });

    this.weather = WEATHER[opts.weather || 'bright'];
    this.setWeather(opts.weather || 'bright');

    this.shadows = sim.boats.slice(0, MAX_SHADOWS).map(b => ({ x: 0, z: 0, psi: 0, amount: 0 }));
    this.camPos = new THREE.Vector3(0, 6, -14);
    this.camLook = new THREE.Vector3();
    this.camRoll = 0;
    this.shake = 0;
    this.resize();
  }

  setWeather(name) {
    this.weather = WEATHER[name] || WEATHER.bright;
    this.sunDir = applyWeather(this.weather, this.sky, this.ocean, this.sun, this.ambient);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // A tall portrait window needs a wider vertical angle to see any water at all.
    this.camera.fov = h > w ? 60 : 50;
    this.camera.updateProjectionMatrix();
  }

  /* Snap the camera straight to where it should be — used when a race starts. */
  jumpToBoat() {
    const b = this.sim.player;
    const fx = Math.sin(b.psi), fz = Math.cos(b.psi);
    this.camPos.set(b.x - fx * 15, b.y + 5.3, b.z - fz * 15);
    for (const e of this.boats) e.wake.reset();
  }

  update(dt, time) {
    const sim = this.sim;
    const player = sim.player;

    this.sky.uniforms.uCloudDrift.value = time * 0.0035;
    this.ocean.uniforms.uCloudDrift.value = this.sky.uniforms.uCloudDrift.value;
    this.ocean.uniforms.uFoam.value = 0.5 + Math.min(1.6, sim.wind.baseSpeed * 0.16);
    const wf = sim.wind.baseFrom;
    this.ocean.uniforms.uWindDir.value.set(-Math.sin(wf), 0, -Math.cos(wf));

    for (let i = 0; i < this.boats.length; i++) {
      const e = this.boats[i];
      e.mesh.update(e.boat, time, dt);
      e.wake.update(e.boat, time, dt);
      const s = this.shadows[i];
      if (s) {
        s.x = e.boat.x; s.z = e.boat.z; s.psi = e.boat.psi;
        // Below a knot or so a hull makes no white water at all.
        s.amount = Math.max(0, Math.min(1, (e.boat.tel.speed - 0.55) / 2.9));
      }
    }
    this.courseView.update(time);

    /* Chase camera. It trails the boat's heading, leans with the heel, and eases back
       as the boat speeds up, which is most of what makes speed feel like speed. */
    const spd = player.tel.speed;
    const dist = 14.5 + spd * 0.80;
    const height = 5.1 + spd * 0.22;
    // Swing a little wide through a turn, but only a little: a hard round-up would
    // otherwise throw the boat clean out of frame.
    const lead = Math.max(-0.20, Math.min(0.20, -player.r * 0.45));
    const psi = player.psi + lead;
    const fx = Math.sin(psi), fz = Math.cos(psi);
    const want = new THREE.Vector3(
      player.x - fx * dist, player.y + height, player.z - fz * dist);
    // Critically damped follow: firm enough to keep up, soft enough to breathe.
    const k = 1 - Math.exp(-dt * 3.4);
    this.camPos.lerp(want, k);
    // Never let the camera dip into the sea.
    const surf = sim.waves.sample(this.camPos.x, this.camPos.z, time, this._w || (this._w = {}));
    this.camPos.y = Math.max(this.camPos.y, surf.y + 1.4);

    const look = new THREE.Vector3(
      player.x + Math.sin(player.psi) * 7.0,
      player.y + 3.6,
      player.z + Math.cos(player.psi) * 7.0);
    this.camLook.lerp(look, 1 - Math.exp(-dt * 5.0));

    this.camera.position.copy(this.camPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);
    // Roll the horizon a fraction of the boat's heel — a hint, not a fairground ride.
    this.camRoll += ((-player.phi * 0.22) - this.camRoll) * Math.min(1, dt * 4);
    this.camera.rotateZ(this.camRoll);
    this.camera.fov = (this.camera.aspect < 1 ? 60 : 50) + Math.min(5, spd * 0.8);
    this.camera.updateProjectionMatrix();

    this.ocean.update(time, this.camera, this.shadows);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
