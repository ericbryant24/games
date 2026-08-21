/* The sea. A polar grid of water kept centred under the camera and displaced in the
   vertex shader by the same wave field the hull is riding on, so the boat sits in the
   water rather than on it. */

import * as THREE from '../../vendor/three.module.min.js';
import { NOISE, SKY, WAVES, TONEMAP } from './shaders.js';
import { MAX_WAVES } from '../water.js';

export const MAX_SHADOWS = 6;

/* Rings spaced geometrically: dense enough to hold a wave shape right beside the hull,
   coarse out at the horizon where a wave is a fraction of a pixel wide. */
function discGeometry(rings, segments, inner, outer) {
  const verts = [];
  const idx = [];
  verts.push(0, 0, 0);                                    // centre, closes the hole
  const growth = Math.pow(outer / inner, 1 / (rings - 1));
  let r = inner;
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      verts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    r *= growth;
  }
  // Wound so the faces look up. Get this backwards and the whole sea is back-face
  // culled: you see nothing but a bright sliver where the far edge goes edge-on.
  const at = (ring, seg) => 1 + ring * segments + (seg % segments);
  for (let s = 0; s < segments; s++) idx.push(0, at(0, s), at(0, s + 1));
  for (let i = 0; i < rings - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const a = at(i, s), b = at(i, s + 1), c = at(i + 1, s + 1), d = at(i + 1, s);
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer * 1.1);
  return g;
}

const VERT = /* glsl */`
${WAVES}
uniform float uFade;          // distance at which wave detail is damped out
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
varying float vDist;

void main() {
  vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
  float d = length(position.xz);
  vDist = d;
  // Damp the swell away toward the horizon: at that range a wave is sub-pixel and all
  // it does is alias, and a flat distance reads as a horizon anyway.
  float damp = 1.0 - 0.94 * smoothstep(uFade * 0.30, uFade, d);
  vec3 nrm;
  float crest;
  vec3 disp = waveDisplace(world.xz, damp, nrm, crest);
  world += disp;
  vWorld = world;
  vNormal = mix(vec3(0.0, 1.0, 0.0), nrm, damp);
  vCrest = crest;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
${NOISE}
${SKY}
${TONEMAP}
uniform vec3 uCamera;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uTime;
uniform float uFoam;          // how readily the sea breaks, from the wind strength
uniform float uFade;
uniform vec3 uWindDir;
uniform sampler2D uGust;      // the wind field around the boat, as pressure 0..1
uniform vec2 uGustOrigin;
uniform float uGustSize;
uniform vec4 uShadows[${MAX_SHADOWS}];   // x, z, heading, how hard she is going
varying vec3 vWorld;
varying vec3 vNormal;
varying float vCrest;
varying float vDist;

void main() {
  /* Pressure on the water. Reading the surface for the dark patches where a gust is
     coming through is a real skill, so the shader is fed the same wind field the sails
     are working in — what you can see is what you will get. */
  vec2 gp = (vWorld.xz - uGustOrigin) / uGustSize + 0.5;
  float gust = texture2D(uGust, clamp(gp, 0.001, 0.999)).r;
  float pressure = clamp((gust - 0.42) * 2.3, -0.6, 1.0);

  vec3 view = uCamera - vWorld;
  float dist = length(view);
  view /= dist;
  vec3 nrm = normalize(vNormal);

  // Ripple detail: too fine for the mesh to carry, so it lives in the normal.
  float rippleFade = 1.0 - smoothstep(40.0, 340.0, dist);
  if (rippleFade > 0.001) {
    vec2 rp = vWorld.xz * 1.05 + uWindDir.xz * uTime * 0.75;
    float n1 = vnoise(rp) - 0.5;
    // The second, finer octave is only worth paying for within a few boat lengths.
    float fine = 1.0 - smoothstep(12.0, 70.0, dist);
    float n2 = fine > 0.001 ? (vnoise(rp * 2.7 + 31.0) - 0.5) * fine : 0.0;
    // A gust roughens the surface it crosses, which is what makes it visible.
    float rough = 0.30 * (1.0 + 0.85 * pressure);
    nrm = normalize(nrm + vec3(n1 * 0.9 + n2 * 0.45, 0.0, n2 * 0.9 - n1 * 0.4) * rippleFade * rough);
  }

  // Held below 1 on purpose: physically the sea goes mirror-flat at a grazing angle,
  // but a little of the water's own colour left in stops the distance going to milk.
  float fres = 0.021 + 0.83 * pow(1.0 - max(dot(nrm, view), 0.0), 4.2);

  vec3 refl = reflect(-view, nrm);
  refl.y = abs(refl.y) * 0.92 + 0.02;              // never sample below the horizon
  vec3 sky = skyColor(refl, 1.0) * vec3(0.80, 0.90, 1.0);   // water reflects cool

  // Body of the water. Crests are lighter because light gets through the thin water
  // at the top of a wave; troughs hold the deep colour.
  float lift = clamp(vWorld.y * 0.42 + 0.30, 0.0, 1.0);
  vec3 body = mix(uDeep, uShallow, lift);
  float through = pow(max(dot(normalize(vec3(uSunDir.x, -uSunDir.y, uSunDir.z)), -view), 0.0), 3.0);
  body += uShallow * through * 0.22 * lift;

  // Ruffled water scatters less sky back at you, so pressure reads as a dark patch.
  vec3 col = mix(body, sky, fres * (1.0 - 0.42 * max(pressure, 0.0)));

  // Sun on the water: a tight highlight near to, breaking up into glitter further off.
  vec3 halfVec = normalize(view + uSunDir);
  float rough = mix(420.0, 34.0, smoothstep(20.0, 420.0, dist));
  float spec = pow(max(dot(nrm, halfVec), 0.0), rough);
  float glitter = mix(1.0, 0.35 + 1.5 * vnoise(vWorld.xz * 3.1 + uTime * 1.7),
                      smoothstep(30.0, 200.0, dist));
  col += uSunTint * spec * 2.1 * glitter;

  // Whitecaps, only where the wave field is really pinching the surface together, and
  // broken up so they read as water tumbling rather than as patches of paint.
  float breakUp = 0.40 + 1.15 * fbm(vWorld.xz * 0.62 + uWindDir.xz * uTime * 0.35);
  float foam = smoothstep(0.62, 1.25, vCrest * uFoam * breakUp * (1.0 + 0.30 * pressure));
  foam *= 0.35 + 0.65 * vnoise(vWorld.xz * 2.4 + uWindDir.xz * uTime * 0.9);
  foam *= 1.0 - smoothstep(uFade * 0.30, uFade * 0.8, vDist);
  col = mix(col, vec3(0.90, 0.94, 0.97), clamp(foam, 0.0, 0.72));

  /* Each hull gets a shadow under it, a collar of white water along the waterline and
     a bow wave running aft in a V. Without these a boat looks laid on the sea rather
     than pushing through it. */
  for (int i = 0; i < ${MAX_SHADOWS}; i++) {
    float go = uShadows[i].w;
    if (go < 0.0) continue;
    vec2 rel = vWorld.xz - uShadows[i].xy;
    if (dot(rel, rel) > 900.0) continue;
    float c = cos(uShadows[i].z), s = sin(uShadows[i].z);
    // Local frame: y forward along the boat, x out to starboard.
    vec2 loc = vec2(rel.x * c - rel.y * s, rel.x * s + rel.y * c);
    float e = length(loc / vec2(1.9, 4.6));
    col *= 1.0 - 0.40 * (1.0 - smoothstep(0.30, 1.0, e));

    // A narrow collar of white water along the waterline.
    float foamHull = smoothstep(1.12, 0.99, e) * smoothstep(0.78, 0.96, e) * go * 0.50;
    // Bow wave: two lines of white water opening out behind the stem.
    float aft = 3.4 - loc.y;
    float bow = 0.0;
    if (aft > 0.0 && aft < 20.0) {
      float arm = 0.8 + aft * 0.28;
      float band = abs(abs(loc.x) - arm);
      bow = smoothstep(1.1, 0.12, band) * (1.0 - aft / 20.0) * go * 0.42;
    }
    float foam = foamHull + bow;
    if (foam > 0.002) {
      foam *= 0.70 + 0.55 * vnoise(loc * 2.2 + uTime * 1.4);
      col = mix(col, vec3(0.93, 0.96, 0.98), clamp(foam, 0.0, 0.62));
    }
  }

  // Fog the sea into the sky so the horizon is a join, not an edge.
  vec3 hazeDir = normalize(vec3(vWorld.x - uCamera.x, 0.6, vWorld.z - uCamera.z));
  float fog = smoothstep(uFade * 0.42, uFade * 0.98, vDist);
  col = mix(col, skyColor(hazeDir, 0.0), fog);

  gl_FragColor = vec4(present(col), 1.0);
}
`;

export class Ocean {
  constructor(waves, opts = {}) {
    this.waves = waves;
    const rings = opts.rings ?? 108;
    const segments = opts.segments ?? 112;
    this.fade = opts.radius ?? 1500;

    this.uniforms = {
      uTime: { value: 0 },
      uWaveA: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },
      uWaveB: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },
      uWaveCount: { value: 0 },
      uCamera: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.74) },
      uSunTint: { value: new THREE.Color(1.0, 0.88, 0.68) },
      uZenith: { value: new THREE.Color(0.14, 0.32, 0.62) },
      uHorizon: { value: new THREE.Color(0.72, 0.83, 0.91) },
      uDeep: { value: new THREE.Color(0.010, 0.048, 0.088) },
      uShallow: { value: new THREE.Color(0.030, 0.145, 0.175) },
      uCloudAmount: { value: 0.45 },
      uCloudDrift: { value: 0 },
      uHaze: { value: 0.55 },
      uFoam: { value: 1.0 },
      uFade: { value: this.fade },
      uWindDir: { value: new THREE.Vector3(0, 0, 1) },
      uGust: { value: null },
      uGustOrigin: { value: new THREE.Vector2() },
      uGustSize: { value: 900 },
      uShadows: { value: Array.from({ length: MAX_SHADOWS }, () => new THREE.Vector4()) }
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms
    });
    this.mesh = new THREE.Mesh(discGeometry(rings, segments, 0.85, this.fade), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /* Push the wave parameters across. Called whenever the sea state changes. */
  syncWaves() {
    const w = this.waves;
    this.uniforms.uWaveCount.value = w.count;
    for (let i = 0; i < w.count; i++) {
      this.uniforms.uWaveA.value[i].set(w.A[i * 4], w.A[i * 4 + 1], w.A[i * 4 + 2], w.A[i * 4 + 3]);
      this.uniforms.uWaveB.value[i].set(w.B[i * 4], w.B[i * 4 + 1], w.B[i * 4 + 2], w.B[i * 4 + 3]);
    }
  }

  update(time, camera, shadows) {
    this.uniforms.uTime.value = time;
    this.uniforms.uCamera.value.copy(camera.position);
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
    if (shadows) {
      for (let i = 0; i < MAX_SHADOWS; i++) {
        const s = shadows[i];
        this.uniforms.uShadows.value[i].set(
          s ? s.x : 0, s ? s.z : 0, s ? s.psi : 0, s ? s.amount : -1);
      }
    }
  }
}
