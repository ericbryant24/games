/* GLSL shared between the sky dome and the water, so that what the water reflects is
   the same sky you can see above it. The wave code is the exact Gerstner sum the
   physics runs on, fed from the same uniforms. */

export const NOISE = /* glsl */`
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
/* Three octaves, not four. The fourth costs a full noise lookup per pixel and at the
   scales this is used at you cannot see it. */
float fbm(vec2 p) {
  float v = 0.0, a = 0.56;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
`;

/* Sky as a function of direction. Used for the dome and for the water's reflection. */
export const SKY = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunTint;
uniform float uCloudAmount;
uniform float uCloudDrift;
uniform float uHaze;

float cloudField(vec3 dir) {
  if (dir.y < 0.015) return 0.0;
  vec2 p = dir.xz * (1400.0 / max(dir.y, 0.015));
  p = p * 0.00085 + vec2(uCloudDrift, uCloudDrift * 0.42);
  float f = fbm(p);
  f = smoothstep(0.52 - uCloudAmount * 0.30, 0.86, f);
  // Thin the cloud out toward the horizon so the deck does not look roofed in.
  return f * smoothstep(0.015, 0.30, dir.y);
}

vec3 skyColor(vec3 dir, float cloudy) {
  vec3 d = normalize(dir);
  float up = clamp(d.y, -1.0, 1.0);
  float h = pow(1.0 - max(up, 0.0), 2.6);
  vec3 col = mix(uZenith, uHorizon, h);

  float cosT = dot(d, uSunDir);
  col += uSunTint * pow(max(cosT, 0.0), 8.0) * 0.34;             // broad glow
  col += uSunTint * pow(max(cosT, 0.0), 1400.0) * 9.0;           // the disc itself

  if (cloudy > 0.0 && uCloudAmount > 0.001) {
    float c = cloudField(d) * cloudy;
    // Cloud shaded by how close it is to the sun: bright rim, cool grey body.
    vec3 lit = mix(vec3(0.62, 0.66, 0.72), vec3(1.02, 0.99, 0.94),
                   0.5 + 0.5 * pow(max(cosT, 0.0), 3.0));
    col = mix(col, lit, c * 0.88);
  }
  // Haze band at the horizon, and a soft fade below it.
  col = mix(col, uHorizon * 1.04, uHaze * pow(1.0 - abs(up), 8.0));
  col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.09, up));
  return col;
}
`;

/* The Gerstner sum. Identical parameters to water.js, uploaded as uniform arrays so
   the two can never drift apart. */
export const WAVES = /* glsl */`
#define MAX_WAVES 8
uniform vec4 uWaveA[MAX_WAVES];   // dirX, dirZ, amplitude, wavenumber
uniform vec4 uWaveB[MAX_WAVES];   // steepness, phase, omega, hull response
uniform int uWaveCount;
uniform float uTime;

/* Returns the displacement, and fills in the surface normal plus a crest-compression
   term that tells the shading where the water is being pinched into whitecaps. */
vec3 waveDisplace(vec2 p, float damp, out vec3 nrm, out float crest) {
  vec3 disp = vec3(0.0);
  vec2 dh = vec2(0.0);
  float jac = 0.0;
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uWaveCount) break;
    vec2 dir = uWaveA[i].xy;
    float amp = uWaveA[i].z * damp;
    float k = uWaveA[i].w;
    float q = uWaveB[i].x;
    float f = k * dot(dir, p) - uWaveB[i].z * uTime + uWaveB[i].y;
    float s = sin(f), c = cos(f);
    disp.y += amp * s;
    disp.xz += q * amp * dir * c;
    dh += amp * k * c * dir;
    jac += q * amp * k * s;
  }
  nrm = normalize(vec3(-dh.x, 1.0, -dh.y));
  crest = jac;
  return disp;
}
`;

/* Filmic tone curve, then the sRGB transfer function. Three applies that encoding for
   its own materials but not for a raw ShaderMaterial, so these shaders have to do it
   themselves or everything they draw comes out crushed almost to black. */
export const TONEMAP = /* glsl */`
vec3 tonemap(vec3 x) {
  x = max(x * 1.28, vec3(0.0));               // a little exposure before the curve
  vec3 a = x * (2.51 * x + 0.03);
  vec3 b = x * (2.43 * x + 0.59) + 0.14;
  return clamp(a / b, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) * 1.055 - 0.055,
             step(vec3(0.0031308), c));
}
vec3 present(vec3 c) { return toSRGB(tonemap(c)); }
`;
