// Physically based atmosphere (after Hillaire 2020, "A Scalable and Production
// Ready Sky and Atmosphere Rendering Technique"). Units: megameters (Mm) for
// planet-scale distances, as in Andrew Helmer's public reference.

export const ATMOSPHERE_COMMON = /* glsl */ `
#ifndef ATMO_COMMON
#define ATMO_COMMON
const float ATMO_PI = 3.14159265358979;
const float groundRadiusMM = 6.360;
const float atmosphereRadiusMM = 6.460;
const vec3 rayleighScatteringBase = vec3(5.802, 13.558, 33.1);
const float rayleighAbsorptionBase = 0.0;
const float mieScatteringBase = 3.996;
const float mieAbsorptionBase = 4.4;
const vec3 ozoneAbsorptionBase = vec3(0.650, 1.881, 0.085);
const vec3 groundAlbedo = vec3(0.3);

float safeAcos(float x) { return acos(clamp(x, -1.0, 1.0)); }

float getMiePhase(float cosTheta) {
  const float g = 0.8;
  const float scale = 3.0 / (8.0 * ATMO_PI);
  float num = (1.0 - g * g) * (1.0 + cosTheta * cosTheta);
  float denom = (2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
  return scale * num / denom;
}

float getRayleighPhase(float cosTheta) {
  const float k = 3.0 / (16.0 * ATMO_PI);
  return k * (1.0 + cosTheta * cosTheta);
}

void getScatteringValues(vec3 pos, float mieScale, out vec3 rayleighScattering, out float mieScattering, out vec3 extinction) {
  float altitudeKM = (length(pos) - groundRadiusMM) * 1000.0;
  float rayleighDensity = exp(-altitudeKM / 8.0);
  float mieDensity = exp(-altitudeKM / 1.2) * mieScale;
  rayleighScattering = rayleighScatteringBase * rayleighDensity;
  float rayleighAbsorption = rayleighAbsorptionBase * rayleighDensity;
  mieScattering = mieScatteringBase * mieDensity;
  float mieAbsorption = mieAbsorptionBase * mieDensity;
  vec3 ozoneAbsorption = ozoneAbsorptionBase * max(0.0, 1.0 - abs(altitudeKM - 25.0) / 15.0);
  extinction = rayleighScattering + rayleighAbsorption + mieScattering + mieAbsorption + ozoneAbsorption;
}

// Distance to sphere surface along ray, or -1.0 if no hit (from inside: far hit).
float rayIntersectSphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  if (c > 0.0 && b > 0.0) return -1.0;
  float discr = b * b - c;
  if (discr < 0.0) return -1.0;
  if (discr > b * b) return (-b + sqrt(discr));
  return -b - sqrt(discr);
}

vec3 getValFromTLUT(sampler2D tex, vec3 pos, vec3 sunDir) {
  float height = length(pos);
  vec3 up = pos / height;
  float sunCosZenithAngle = dot(sunDir, up);
  vec2 uv = vec2(clamp(0.5 + 0.5 * sunCosZenithAngle, 0.0, 1.0),
                 clamp((height - groundRadiusMM) / (atmosphereRadiusMM - groundRadiusMM), 0.0, 1.0));
  return texture2D(tex, uv).rgb;
}

vec3 getValFromMultiScattLUT(sampler2D tex, vec3 pos, vec3 sunDir) {
  float height = length(pos);
  vec3 up = pos / height;
  float sunCosZenithAngle = dot(sunDir, up);
  vec2 uv = vec2(clamp(0.5 + 0.5 * sunCosZenithAngle, 0.0, 1.0),
                 clamp((height - groundRadiusMM) / (atmosphereRadiusMM - groundRadiusMM), 0.0, 1.0));
  return texture2D(tex, uv).rgb;
}
#endif
`;

/** Pass 1: transmittance to the top of the atmosphere (256×64, static). */
export const TRANSMITTANCE_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_COMMON}
varying vec2 vUv;
uniform float uMieScale;
const float sunTransmittanceSteps = 40.0;

vec3 getSunTransmittance(vec3 pos, vec3 sunDir) {
  if (rayIntersectSphere(pos, sunDir, groundRadiusMM) > 0.0) return vec3(0.0);
  float atmoDist = rayIntersectSphere(pos, sunDir, atmosphereRadiusMM);
  float t = 0.0;
  vec3 transmittance = vec3(1.0);
  for (float i = 0.0; i < sunTransmittanceSteps; i += 1.0) {
    float newT = ((i + 0.3) / sunTransmittanceSteps) * atmoDist;
    float dt = newT - t;
    t = newT;
    vec3 newPos = pos + t * sunDir;
    vec3 rayleighScattering, extinction;
    float mieScattering;
    getScatteringValues(newPos, uMieScale, rayleighScattering, mieScattering, extinction);
    transmittance *= exp(-dt * extinction);
  }
  return transmittance;
}

void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float sunTheta = safeAcos(sunCosTheta);
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(0.0, sunCosTheta, -sin(sunTheta)));
  gl_FragColor = vec4(getSunTransmittance(pos, sunDir), 1.0);
}
`;

/** Pass 2: second-and-higher-order scattering approximation (32×32, static). */
export const MULTISCATTER_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_COMMON}
varying vec2 vUv;
uniform sampler2D uTransmittanceLUT;
uniform float uMieScale;
const float mulScattSteps = 20.0;
const int sqrtSamples = 8;

vec3 getSphericalDir(float theta, float phi) {
  float cosPhi = cos(phi);
  float sinPhi = sin(phi);
  float cosTheta = cos(theta);
  float sinTheta = sin(theta);
  return vec3(sinPhi * sinTheta, cosPhi, sinPhi * cosTheta);
}

void getMulScattValues(vec3 pos, vec3 sunDir, out vec3 lumTotal, out vec3 fms) {
  lumTotal = vec3(0.0);
  fms = vec3(0.0);
  float invSamples = 1.0 / float(sqrtSamples * sqrtSamples);
  for (int i = 0; i < sqrtSamples; i++) {
    for (int j = 0; j < sqrtSamples; j++) {
      float theta = ATMO_PI * (float(i) + 0.5) / float(sqrtSamples);
      float phi = safeAcos(1.0 - 2.0 * (float(j) + 0.5) / float(sqrtSamples));
      vec3 rayDir = getSphericalDir(theta, phi);
      float atmoDist = rayIntersectSphere(pos, rayDir, atmosphereRadiusMM);
      float groundDist = rayIntersectSphere(pos, rayDir, groundRadiusMM);
      float tMax = atmoDist;
      if (groundDist > 0.0) tMax = groundDist;
      float cosTheta = dot(rayDir, sunDir);
      float miePhaseValue = getMiePhase(cosTheta);
      float rayleighPhaseValue = getRayleighPhase(-cosTheta);
      vec3 lum = vec3(0.0), lumFactor = vec3(0.0), transmittance = vec3(1.0);
      float t = 0.0;
      for (float stepI = 0.0; stepI < mulScattSteps; stepI += 1.0) {
        float newT = ((stepI + 0.3) / mulScattSteps) * tMax;
        float dt = newT - t;
        t = newT;
        vec3 newPos = pos + t * rayDir;
        vec3 rayleighScattering, extinction;
        float mieScattering;
        getScatteringValues(newPos, uMieScale, rayleighScattering, mieScattering, extinction);
        vec3 sampleTransmittance = exp(-dt * extinction);
        vec3 scatteringNoPhase = rayleighScattering + mieScattering;
        vec3 scatteringF = (scatteringNoPhase - scatteringNoPhase * sampleTransmittance) / extinction;
        lumFactor += transmittance * scatteringF;
        vec3 sunTransmittance = getValFromTLUT(uTransmittanceLUT, newPos, sunDir);
        vec3 rayleighInScattering = rayleighScattering * rayleighPhaseValue;
        float mieInScattering = mieScattering * miePhaseValue;
        vec3 inScattering = (rayleighInScattering + mieInScattering) * sunTransmittance;
        vec3 scatteringIntegral = (inScattering - inScattering * sampleTransmittance) / extinction;
        lum += scatteringIntegral * transmittance;
        transmittance *= sampleTransmittance;
      }
      if (groundDist > 0.0) {
        vec3 hitPos = pos + groundDist * rayDir;
        if (dot(pos, sunDir) > 0.0) {
          hitPos = normalize(hitPos) * groundRadiusMM;
          lum += transmittance * groundAlbedo * getValFromTLUT(uTransmittanceLUT, hitPos, sunDir);
        }
      }
      fms += lumFactor * invSamples;
      lumTotal += lum * invSamples;
    }
  }
}

void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float sunTheta = safeAcos(sunCosTheta);
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(0.0, sunCosTheta, -sin(sunTheta)));
  vec3 lum, fms;
  getMulScattValues(pos, sunDir, lum, fms);
  vec3 psi = lum / (1.0 - fms);
  gl_FragColor = vec4(psi, 1.0);
}
`;

/** Shared single-scattering raymarch used by the sky-view and aerial LUTs. */
export const RAYMARCH_SCATTERING = /* glsl */ `
uniform sampler2D uTransmittanceLUT;
uniform sampler2D uMultiScatterLUT;
uniform float uMieScale;

vec3 raymarchScattering(vec3 pos, vec3 rayDir, vec3 sunDir, float tMax, float numSteps, out vec3 transmittanceOut) {
  float cosTheta = dot(rayDir, sunDir);
  float miePhaseValue = getMiePhase(cosTheta);
  float rayleighPhaseValue = getRayleighPhase(-cosTheta);
  vec3 lum = vec3(0.0);
  vec3 transmittance = vec3(1.0);
  float t = 0.0;
  for (float i = 0.0; i < 64.0; i += 1.0) {
    if (i >= numSteps) break;
    float newT = ((i + 0.3) / numSteps) * tMax;
    float dt = newT - t;
    t = newT;
    vec3 newPos = pos + t * rayDir;
    vec3 rayleighScattering, extinction;
    float mieScattering;
    getScatteringValues(newPos, uMieScale, rayleighScattering, mieScattering, extinction);
    vec3 sampleTransmittance = exp(-dt * extinction);
    vec3 sunTransmittance = getValFromTLUT(uTransmittanceLUT, newPos, sunDir);
    vec3 psiMS = getValFromMultiScattLUT(uMultiScatterLUT, newPos, sunDir);
    vec3 rayleighInScattering = rayleighScattering * (rayleighPhaseValue * sunTransmittance + psiMS);
    vec3 mieInScattering = mieScattering * (miePhaseValue * sunTransmittance + psiMS);
    vec3 inScattering = rayleighInScattering + mieInScattering;
    vec3 scatteringIntegral = (inScattering - inScattering * sampleTransmittance) / extinction;
    lum += scatteringIntegral * transmittance;
    transmittance *= sampleTransmittance;
  }
  transmittanceOut = transmittance;
  return lum;
}
`;

/** Pass 3: sky-view LUT (192×108, per frame). Sun at azimuth 0. */
export const SKYVIEW_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_COMMON}
${RAYMARCH_SCATTERING}
varying vec2 vUv;
uniform vec3 uViewPos; // Mm, relative to planet center
uniform vec3 uSunDir;  // world space
const float numScatteringSteps = 30.0;

void main() {
  float azimuthAngle = (vUv.x - 0.5) * 2.0 * ATMO_PI;
  float adjV;
  if (vUv.y < 0.5) {
    float coord = 1.0 - 2.0 * vUv.y;
    adjV = -coord * coord;
  } else {
    float coord = vUv.y * 2.0 - 1.0;
    adjV = coord * coord;
  }
  float height = length(uViewPos);
  vec3 up = uViewPos / height;
  float horizonAngle = safeAcos(sqrt(height * height - groundRadiusMM * groundRadiusMM) / height) - 0.5 * ATMO_PI;
  float altitudeAngle = adjV * 0.5 * ATMO_PI - horizonAngle;
  float cosAltitude = cos(altitudeAngle);
  vec3 rayDir = vec3(cosAltitude * sin(azimuthAngle), sin(altitudeAngle), -cosAltitude * cos(azimuthAngle));
  float sunAltitude = (0.5 * ATMO_PI) - safeAcos(dot(normalize(uSunDir), up));
  vec3 sunDir = vec3(0.0, sin(sunAltitude), -cos(sunAltitude));
  float atmoDist = rayIntersectSphere(uViewPos, rayDir, atmosphereRadiusMM);
  float groundDist = rayIntersectSphere(uViewPos, rayDir, groundRadiusMM);
  float tMax = (groundDist < 0.0) ? atmoDist : groundDist;
  vec3 transmittance;
  vec3 lum = raymarchScattering(uViewPos, rayDir, sunDir, tMax, numScatteringSteps, transmittance);
  gl_FragColor = vec4(lum, 1.0);
}
`;

/**
 * Pass 4: aerial perspective froxels (32×32×32) packed as a 1024×32 atlas:
 * slice s occupies x in [32s, 32s+32). Depth is distributed quadratically up
 * to uMaxDistance meters, and the atmosphere is thickened by uDistanceScale.
 */
export const AERIAL_FRAG = /* glsl */ `
precision highp float;
${ATMOSPHERE_COMMON}
${RAYMARCH_SCATTERING}
uniform vec3 uViewPos;       // Mm
uniform vec3 uSunDir;
uniform mat4 uInvViewProj;   // clip → world (direction only)
uniform vec3 uCameraWorld;
uniform float uMaxDistance;  // meters
uniform float uDistanceScale;
const float SLICES = 32.0;

void main() {
  vec2 px = gl_FragCoord.xy;
  float slice = floor(px.x / 32.0);
  vec2 uv = vec2(mod(px.x, 32.0), px.y) / 32.0;
  vec4 clip = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec4 world = uInvViewProj * clip;
  vec3 rayDir = normalize(world.xyz / world.w - uCameraWorld);
  float w = (slice + 1.0) / SLICES;
  float distMeters = w * w * uMaxDistance;
  float tMax = distMeters * uDistanceScale * 1e-6; // meters → Mm
  vec3 transmittance;
  float steps = max(4.0, ceil(slice * 0.35) + 4.0);
  vec3 lum = raymarchScattering(uViewPos, rayDir, normalize(uSunDir), tMax, steps, transmittance);
  float t = dot(transmittance, vec3(0.3333));
  gl_FragColor = vec4(lum, t);
}
`;

/** Sampling helpers for scene materials (atlas → trilinear froxel lookup). */
export const AERIAL_SAMPLE = /* glsl */ `
vec4 sampleAerialLUT(sampler2D lut, vec2 screenUv, float distMeters, float maxDistance) {
  float w = sqrt(clamp(distMeters / maxDistance, 0.0, 1.0)) * 32.0 - 1.0;
  float fade = clamp(w + 1.0, 0.0, 1.0);
  w = clamp(w, 0.0, 31.0);
  float s0 = floor(w);
  float s1 = min(s0 + 1.0, 31.0);
  float f = w - s0;
  float u = clamp(screenUv.x * 32.0, 0.5, 31.5);
  vec2 uv0 = vec2((s0 * 32.0 + u) / 1024.0, screenUv.y);
  vec2 uv1 = vec2((s1 * 32.0 + u) / 1024.0, screenUv.y);
  vec4 a = mix(texture2D(lut, uv0), texture2D(lut, uv1), f);
  // Fade in from zero over the first slice so nearby surfaces stay crisp.
  return mix(vec4(0.0, 0.0, 0.0, 1.0), a, fade);
}
`;
