/* Sky dome. Shares its colour function with the water, so the reflection and the thing
   being reflected cannot disagree. */

import * as THREE from '../../vendor/three.module.min.js';
import { NOISE, SKY, TONEMAP } from './shaders.js';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  // Sit the dome on the camera and push it to the back of the depth range.
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p;
}
`;

const FRAG = /* glsl */`
precision highp float;
${NOISE}
${SKY}
${TONEMAP}
varying vec3 vDir;
void main() {
  gl_FragColor = vec4(present(skyColor(normalize(vDir), 1.0)), 1.0);
}
`;

/* Weather presets. Each one sets the light as well as the sky, because a grey day
   changes what the water does with the light as much as what the sky looks like. */
export const WEATHER = {
  bright: {
    label: 'Bright', sunElev: 0.72, sunAz: -0.55, cloud: 0.34, haze: 0.42,
    zenith: [0.09, 0.26, 0.62], horizon: [0.62, 0.78, 0.92], sun: [1.00, 0.90, 0.72],
    deep: [0.007, 0.034, 0.070], shallow: [0.030, 0.145, 0.180],
    sunLight: [1.00, 0.95, 0.86], sunIntensity: 2.7, ambient: [0.64, 0.78, 0.95], ambientIntensity: 1.45
  },
  hazy: {
    label: 'Hazy', sunElev: 0.50, sunAz: -0.9, cloud: 0.55, haze: 0.72,
    zenith: [0.26, 0.42, 0.62], horizon: [0.83, 0.86, 0.87], sun: [1.00, 0.86, 0.66],
    deep: [0.013, 0.042, 0.070], shallow: [0.045, 0.140, 0.170],
    sunLight: [1.00, 0.94, 0.84], sunIntensity: 2.1, ambient: [0.68, 0.76, 0.88], ambientIntensity: 1.35
  },
  overcast: {
    label: 'Overcast', sunElev: 0.62, sunAz: -1.5, cloud: 0.92, haze: 0.80,
    zenith: [0.36, 0.42, 0.50], horizon: [0.70, 0.73, 0.76], sun: [0.85, 0.85, 0.86],
    deep: [0.022, 0.044, 0.062], shallow: [0.058, 0.130, 0.150],
    sunLight: [0.90, 0.92, 0.96], sunIntensity: 1.2, ambient: [0.70, 0.75, 0.82], ambientIntensity: 1.55
  },
  evening: {
    label: 'Evening', sunElev: 0.145, sunAz: 2.5, cloud: 0.46, haze: 0.68,
    zenith: [0.10, 0.20, 0.44], horizon: [0.98, 0.72, 0.50], sun: [1.00, 0.66, 0.36],
    deep: [0.012, 0.032, 0.062], shallow: [0.060, 0.120, 0.160],
    sunLight: [1.00, 0.74, 0.50], sunIntensity: 2.3, ambient: [0.50, 0.56, 0.76], ambientIntensity: 1.05
  }
};

export class Sky {
  constructor() {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.74) },
      uZenith: { value: new THREE.Color(0.14, 0.32, 0.62) },
      uHorizon: { value: new THREE.Color(0.72, 0.83, 0.91) },
      uSunTint: { value: new THREE.Color(1.0, 0.9, 0.72) },
      uCloudAmount: { value: 0.4 },
      uCloudDrift: { value: 0 },
      uHaze: { value: 0.5 }
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: false
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 40, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  sunDirection(preset) {
    const el = preset.sunElev, az = preset.sunAz;
    const c = Math.cos(el);
    return new THREE.Vector3(Math.sin(az) * c, Math.sin(el), Math.cos(az) * c).normalize();
  }
}

/* Copy a weather preset into the sky and the ocean, which share these uniform names. */
export function applyWeather(preset, sky, ocean, sun, ambient) {
  const dir = sky.sunDirection(preset);
  for (const u of [sky.uniforms, ocean.uniforms]) {
    u.uSunDir.value.copy(dir);
    u.uZenith.value.setRGB(...preset.zenith);
    u.uHorizon.value.setRGB(...preset.horizon);
    u.uSunTint.value.setRGB(...preset.sun);
    u.uCloudAmount.value = preset.cloud;
    u.uHaze.value = preset.haze;
  }
  ocean.uniforms.uDeep.value.setRGB(...preset.deep);
  ocean.uniforms.uShallow.value.setRGB(...preset.shallow);
  if (sun) {
    sun.color.setRGB(...preset.sunLight);
    sun.intensity = preset.sunIntensity;
    sun.position.copy(dir).multiplyScalar(300);
  }
  if (ambient) {
    ambient.color.setRGB(...preset.ambient);
    ambient.intensity = preset.ambientIntensity;
  }
  return dir;
}
