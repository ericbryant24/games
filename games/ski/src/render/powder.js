/* Snow in the air: spray thrown off edges, bursts on landings and crashes, and a few
   flakes drifting down past the camera. */

import * as THREE from '../../vendor/three.module.min.js';
import { dotTexture } from './geom.js';

const VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(uColor, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

export class Snow {
  constructor(count = 700) {
    this.n = count;
    this.p = new Float32Array(count * 3);
    this.v = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.base = new Float32Array(count);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.uniforms = {
      uMap: { value: dotTexture() }, uColor: { value: new THREE.Color(0xffffff) }, uScale: { value: 400 }
    };
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  emit(x, y, z, vx, vy, vz, count, spread = 1.5, size = 0.5, life = 0.8) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      this.p[i * 3] = x + (Math.random() - 0.5) * 0.4;
      this.p[i * 3 + 1] = y + Math.random() * 0.2;
      this.p[i * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
      this.v[i * 3] = vx + (Math.random() - 0.5) * spread * 2;
      this.v[i * 3 + 1] = vy + Math.random() * spread;
      this.v[i * 3 + 2] = vz + (Math.random() - 0.5) * spread * 2;
      this.max[i] = this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.base[i] = size * (0.6 + Math.random() * 0.8);
    }
  }

  update(dt, viewHeight) {
    this.uniforms.uScale.value = viewHeight * 0.9;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const j = i * 3;
      const drag = Math.exp(-dt * 2.2);
      this.v[j] *= drag; this.v[j + 2] *= drag;
      this.v[j + 1] = this.v[j + 1] * drag - 5 * dt;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      const t = Math.max(0, this.life[i] / this.max[i]);
      this.alpha[i] = Math.min(1, t * 1.6) * 0.9;
      this.size[i] = this.base[i] * (1.8 - t);
    }
    for (const name of ['position', 'aSize', 'aAlpha']) this.geo.attributes[name].needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.uniforms.uMap.value.dispose(); this.mesh.material.dispose(); }
}

/* A light fall of flakes in a box that travels with the camera. */
export class Flakes {
  constructor(count = 260) {
    this.n = count;
    this.p = new Float32Array(count * 3);
    this.off = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.off[i * 3] = (Math.random() - 0.5) * 50;
      this.off[i * 3 + 1] = Math.random() * 30;
      this.off[i * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mesh = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.16, map: dotTexture(32), transparent: true, depthWrite: false, opacity: 0.85
    }));
    this.mesh.frustumCulled = false;
    this.t = 0;
  }

  update(dt, cx, cy, cz) {
    this.t += dt;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      const fall = (this.off[j + 1] - this.t * 1.4) % 30;
      const y = fall < 0 ? fall + 30 : fall;
      const sway = Math.sin(this.t * 0.8 + i) * 0.6;
      this.p[j] = cx + wrap(this.off[j] + sway - cx, 50);
      this.p[j + 1] = cy - 22 + y;
      this.p[j + 2] = cz + wrap(this.off[j + 2] - cz, 50);
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mesh.material.map.dispose(); this.mesh.material.dispose(); }
}

function wrap(v, size) {
  const h = size / 2;
  return ((v + h) % size + size) % size - h;
}
