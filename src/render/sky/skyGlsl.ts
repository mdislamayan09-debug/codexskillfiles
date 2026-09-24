import { ATMOSPHERE_COMMON } from '../atmosphere/atmosphereGlsl';

/** Sky radiance for a world-space direction. Shared by the view pass and IBL capture. */
export const SKY_RADIANCE_GLSL = /* glsl */ `
${ATMOSPHERE_COMMON}
uniform sampler2D uSkyViewLUT;
uniform sampler2D uSkyViewMoonLUT;
uniform vec3 uViewPosMM;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunIntensity;
uniform float uEclipse;
uniform float uMoonIntensity;
uniform float uMoonPhaseLight;
uniform mat3 uStarRotation;
uniform float uTime;
uniform float uAurora;
uniform float uCloudCover;
uniform vec3 uResonanceTint;
uniform float uResonance;

vec3 sampleSkyLUT(sampler2D lut, vec3 rayDir, vec3 lightDir) {
  float height = length(uViewPosMM);
  vec3 up = vec3(0.0, 1.0, 0.0);
  float horizonAngle = safeAcos(sqrt(height * height - groundRadiusMM * groundRadiusMM) / height);
  float altitudeAngle = horizonAngle - safeAcos(dot(rayDir, up));
  float azimuthAngle;
  if (abs(altitudeAngle) > (0.5 * ATMO_PI - 0.0001)) {
    azimuthAngle = 0.0;
  } else {
    vec3 right = cross(lightDir, up);
    vec3 forward = cross(up, right);
    vec3 projectedDir = normalize(rayDir - up * dot(rayDir, up));
    float sinTheta = dot(projectedDir, right);
    float cosTheta = dot(projectedDir, forward);
    azimuthAngle = atan(sinTheta, cosTheta) + ATMO_PI;
  }
  float v = 0.5 + 0.5 * sign(altitudeAngle) * sqrt(abs(altitudeAngle) * 2.0 / ATMO_PI);
  return texture2D(lut, vec2(azimuthAngle / (2.0 * ATMO_PI), v)).rgb;
}

float skyHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 skyHash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float skyValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash12(i), skyHash12(i + vec2(1.0, 0.0)), u.x),
             mix(skyHash12(i + vec2(0.0, 1.0)), skyHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec3 starColor(float t) {
  // Cool blue-white to warm orange.
  return mix(vec3(1.0, 0.72, 0.48), vec3(0.72, 0.82, 1.0), t);
}

vec3 starField(vec3 dir) {
  vec3 d = uStarRotation * dir;
  vec3 a = abs(d);
  vec2 uv;
  float face;
  if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
  // Milky Way: a tilted great circle, denser and glowing.
  vec3 galacticNormal = normalize(vec3(0.3, 0.55, 0.78));
  float band = exp(-pow(dot(d, galacticNormal), 2.0) * 22.0);
  float cells = 150.0;
  vec2 g = uv * cells;
  vec2 cell = floor(g);
  vec3 col = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      vec3 h = skyHash32(c + face * 1237.0);
      float density = 0.28 + 0.5 * band;
      if (h.z > density) continue;
      vec2 starPos = c + 0.2 + 0.6 * h.xy;
      float dist = length(g - starPos);
      float mag = pow(skyHash12(c * 1.7 + face), 9.0) * 4.0 + 0.04;
      float twinkle = 0.75 + 0.25 * sin(uTime * (1.5 + 4.0 * h.x) + h.y * 40.0);
      float core = exp(-dist * dist * 28.0);
      col += starColor(h.x) * core * mag * twinkle;
    }
  }
  // Diffuse galactic glow with dust lanes.
  float dust = skyValueNoise(uv * 9.0 + face * 3.1) * 0.6 + skyValueNoise(uv * 23.0 - face) * 0.4;
  col += vec3(0.55, 0.6, 0.75) * band * (0.35 + 0.65 * smoothstep(0.35, 0.8, dust)) * 0.045;
  return col * 0.012;
}

vec3 moonDisc(vec3 rayDir) {
  const float moonRadius = 0.0115;
  float c = dot(rayDir, uMoonDir);
  if (c < cos(moonRadius * 1.02)) return vec3(0.0);
  vec3 t = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0001)));
  vec3 b = cross(t, uMoonDir);
  vec2 p = vec2(dot(rayDir, t), dot(rayDir, b)) / moonRadius;
  float r2 = dot(p, p);
  if (r2 > 1.0) return vec3(0.0);
  vec3 n = normalize(t * p.x + b * p.y - uMoonDir * sqrt(1.0 - r2));
  float lit = max(0.0, dot(n, uSunDir));
  float maria = skyValueNoise(p * 3.2 + 7.0) * 0.6 + skyValueNoise(p * 7.5) * 0.4;
  float crater = skyValueNoise(p * 22.0);
  float albedo = 0.55 + 0.25 * smoothstep(0.35, 0.65, maria) + 0.1 * crater;
  float earthshine = 0.012;
  float edge = smoothstep(1.0, 0.94, r2);
  return vec3(1.0, 0.97, 0.92) * albedo * (lit + earthshine) * edge * 0.9;
}

vec3 aurora(vec3 rayDir) {
  if (uAurora < 0.01 || rayDir.y < 0.02) return vec3(0.0);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float h = 0.9 + fi * 0.055;
    vec2 p = rayDir.xz / rayDir.y * h;
    p.y += 1.8; // curtains hang in the northern sky (-Z)
    float wave = skyValueNoise(vec2(p.x * 0.9 + uTime * 0.03, fi * 0.21)) * 1.6;
    float ribbon = exp(-pow((p.y + wave - 0.6) * 3.2, 2.0));
    float streak = skyValueNoise(vec2(p.x * 14.0 + uTime * 0.25, fi)) * 0.7 + 0.3;
    vec3 tint = mix(vec3(0.15, 1.0, 0.45), vec3(0.55, 0.25, 1.0), smoothstep(4.0, 13.0, fi));
    col += tint * ribbon * streak * (1.0 - fi / 16.0);
  }
  float north = smoothstep(0.1, -0.6, rayDir.z);
  return col * north * uAurora * 0.0035 * smoothstep(0.02, 0.2, rayDir.y);
}

vec3 skyRadiance(vec3 rayDir, bool withDiscs) {
  vec3 dir = rayDir;
  // Keep the horizon color below the horizon instead of the planet's shadow.
  vec3 lutDir = normalize(vec3(dir.x, max(dir.y, 0.002), dir.z));
  vec3 sun = sampleSkyLUT(uSkyViewLUT, lutDir, uSunDir) * uSunIntensity;
  vec3 moon = sampleSkyLUT(uSkyViewMoonLUT, lutDir, uMoonDir) * uMoonIntensity;
  vec3 lum = sun + moon;
  // Night airglow floor so the sky never reads as a void.
  float night = smoothstep(0.05, -0.2, uSunDir.y);
  lum += vec3(0.00035, 0.00055, 0.0011) * night;
  // Overcast flattens and greys the sky dome.
  float lumY = dot(lum, vec3(0.2126, 0.7152, 0.0722));
  lum = mix(lum, vec3(lumY) * vec3(0.92, 0.95, 1.0) * 0.8, uCloudCover * 0.7);
  if (withDiscs) {
    float skyBright = dot(sun + moon, vec3(0.2126, 0.7152, 0.0722));
    float starVis = clamp(1.0 - skyBright * 90.0, 0.0, 1.0) * (1.0 - uCloudCover);
    if (dir.y > -0.02) lum += starField(dir) * starVis;
    lum += aurora(dir) * night * (1.0 - uCloudCover * 0.8);
    vec3 moonT = getValFromTLUT(uTransmittanceLUTSky, uViewPosMM, uMoonDir);
    lum += moonDisc(dir) * moonT * (0.35 + 0.65 * uMoonPhaseLight) * 0.12 * (1.0 - uCloudCover * 0.9);
    float cosSun = dot(dir, uSunDir);
    const float sunRadius = 0.0068;
    if (cosSun > cos(sunRadius)) {
      vec3 sunT = getValFromTLUT(uTransmittanceLUTSky, uViewPosMM, uSunDir);
      float r = sqrt(max(0.0, 1.0 - cosSun * cosSun)) / sunRadius;
      float limb = 1.0 - 0.55 * (1.0 - sqrt(max(0.0, 1.0 - r * r)));
      lum += sunT * limb * 420.0 * (1.0 - uCloudCover * 0.97) * (1.0 - uEclipse);
    }
    // In eclipse: the corona, pale streamers round the dark disc.
    if (uEclipse > 0.01 && cosSun > cos(sunRadius * 6.0)) {
      float rr = acos(clamp(cosSun, -1.0, 1.0)) / sunRadius;
      vec3 d2 = normalize(dir - uSunDir * cosSun);
      float streams = 0.6 + 0.4 * sin(atan(d2.y, d2.x + 1e-4) * 7.0);
      float corona = step(1.0, rr) * exp(-(rr - 1.0) * 1.1) * streams;
      lum += vec3(0.85, 0.9, 1.0) * corona * 3.5 * uEclipse * (1.0 - uCloudCover * 0.9);
    }
  }
  lum += uResonanceTint * uResonance * 0.06 * (0.6 + 0.4 * smoothstep(-0.1, 0.6, dir.y));
  if (dir.y < 0.0) lum *= mix(1.0, 0.35, smoothstep(0.0, -0.25, dir.y));
  return lum;
}
`;

/** Fullscreen sky: drawn last among opaques at the far plane (early-Z culls covered pixels). */
export const SKY_VIEW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const SKY_VIEW_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTransmittanceLUTSky;
${SKY_RADIANCE_GLSL}
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform sampler2D uCloudTex;
uniform float uCloudsEnabled;
varying vec2 vUv;
void main() {
  vec4 world = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rayDir = normalize(world.xyz / world.w - uCamPos);
  vec3 col = skyRadiance(rayDir, true);
  if (uCloudsEnabled > 0.5) {
    vec4 cloud = texture2D(uCloudTex, vUv);
    col = col * cloud.a + cloud.rgb;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Sky dome for the environment (IBL) capture: rays from vertex directions. */
export const SKY_DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

export const SKY_DOME_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTransmittanceLUTSky;
${SKY_RADIANCE_GLSL}
uniform vec3 uGroundAlbedo;
uniform vec3 uSunColorIBL;
varying vec3 vDir;
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyRadiance(dir, false);
  // Lower hemisphere: sunlit ground bounce instead of the planet's shadow.
  float below = smoothstep(0.02, -0.12, dir.y);
  vec3 skyIrr = sampleSkyLUT(uSkyViewLUT, vec3(0.0, 1.0, 0.0), uSunDir) * uSunIntensity * 3.14159;
  vec3 ground = uGroundAlbedo * (uSunColorIBL * uSunIntensity * max(uSunDir.y, 0.0) + skyIrr) / 3.14159;
  col = mix(col, ground, below);
  gl_FragColor = vec4(col, 1.0);
}
`;
