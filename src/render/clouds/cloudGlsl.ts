// Volumetric clouds after Schneider ("The Real-time Volumetric Cloudscapes of
// Horizon Zero Dawn", 2015) and Hillaire (energy-conserving integration).

const NOISE3D = /* glsl */ `
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Tileable gradient (Perlin) noise with integer period.
float perlin3(vec3 p, float period) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(hash33(mod(i, period)) * 2.0 - 1.0, f);
  float n100 = dot(hash33(mod(i + vec3(1, 0, 0), period)) * 2.0 - 1.0, f - vec3(1, 0, 0));
  float n010 = dot(hash33(mod(i + vec3(0, 1, 0), period)) * 2.0 - 1.0, f - vec3(0, 1, 0));
  float n110 = dot(hash33(mod(i + vec3(1, 1, 0), period)) * 2.0 - 1.0, f - vec3(1, 1, 0));
  float n001 = dot(hash33(mod(i + vec3(0, 0, 1), period)) * 2.0 - 1.0, f - vec3(0, 0, 1));
  float n101 = dot(hash33(mod(i + vec3(1, 0, 1), period)) * 2.0 - 1.0, f - vec3(1, 0, 1));
  float n011 = dot(hash33(mod(i + vec3(0, 1, 1), period)) * 2.0 - 1.0, f - vec3(0, 1, 1));
  float n111 = dot(hash33(mod(i + vec3(1, 1, 1), period)) * 2.0 - 1.0, f - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float perlinFbm3(vec3 p, float period, int octaves) {
  float sum = 0.0;
  float amp = 1.0;
  float norm = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves) break;
    sum += perlin3(p, period) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2.0;
    period *= 2.0;
  }
  return sum / norm;
}

// Tileable Worley (cellular) noise, returns 1 - F1 (bright cell centers).
float worley3(vec3 p, float period) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float minD = 1.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = hash33(mod(i + g, period));
        vec3 r = g + o - f;
        minD = min(minD, dot(r, r));
      }
    }
  }
  return 1.0 - sqrt(minD);
}

float worleyFbm(vec3 p, float period) {
  return worley3(p, period) * 0.625 + worley3(p * 2.0, period * 2.0) * 0.25 + worley3(p * 4.0, period * 4.0) * 0.125;
}

float remap(float v, float lo, float hi, float nlo, float nhi) {
  return nlo + (v - lo) / max(hi - lo, 1e-5) * (nhi - nlo);
}
`;

/** Shape noise: R = Perlin-Worley, GBA = Worley FBM at 3 frequencies. */
export const SHAPE_NOISE_FRAG = /* glsl */ `
precision highp float;
uniform float uSlice;
uniform float uSize;
varying vec2 vUv;
${NOISE3D}
void main() {
  vec3 p = vec3(vUv, (uSlice + 0.5) / uSize);
  float pfbm = perlinFbm3(p * 4.0, 4.0, 5) * 0.5 + 0.5;
  float w0 = worleyFbm(p * 4.0, 4.0);
  float perlinWorley = remap(pfbm, 0.0, 1.0, w0, 1.0);
  float w1 = worleyFbm(p * 8.0, 8.0);
  float w2 = worleyFbm(p * 16.0, 16.0);
  float w3 = worleyFbm(p * 32.0, 32.0);
  gl_FragColor = vec4(clamp(perlinWorley, 0.0, 1.0), w1, w2, w3);
}
`;

/** Detail noise: Worley FBM at 3 higher frequencies. */
export const DETAIL_NOISE_FRAG = /* glsl */ `
precision highp float;
uniform float uSlice;
uniform float uSize;
varying vec2 vUv;
${NOISE3D}
void main() {
  vec3 p = vec3(vUv, (uSlice + 0.5) / uSize);
  gl_FragColor = vec4(worleyFbm(p * 4.0, 4.0), worleyFbm(p * 8.0, 8.0), worleyFbm(p * 16.0, 16.0), 1.0);
}
`;

/** Weather map: R coverage, G cloud type (0 stratus .. 1 cumulonimbus), B rain darkness. */
export const WEATHER_MAP_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
${NOISE3D}
void main() {
  vec3 p = vec3(vUv * 6.0, 0.37);
  float big = perlinFbm3(p, 6.0, 4) * 0.5 + 0.5;
  float cells = worleyFbm(vec3(vUv * 10.0, 0.61), 10.0);
  float coverage = clamp(remap(big * 0.6 + cells * 0.4, 0.3, 0.85, 0.0, 1.0), 0.0, 1.0);
  float type = clamp(perlinFbm3(vec3(vUv * 3.0, 0.83), 3.0, 3) * 0.7 + 0.5, 0.0, 1.0);
  float rain = clamp(perlinFbm3(vec3(vUv * 4.0, 0.19), 4.0, 3) * 0.8 + 0.4, 0.0, 1.0);
  gl_FragColor = vec4(coverage, type, rain, 1.0);
}
`;

/** Shared cloud density model (used by the raymarch and by ground shadows). */
export const CLOUD_UNIFORMS = /* glsl */ `
uniform sampler2D uCloudWeather;
uniform vec2 uCloudOffset;     // weather map scroll (meters)
uniform float uCloudWeatherScale; // 1 / weather tile size (1/m)
uniform float uCloudCoverage;  // global 0..1
uniform float uCloudBottom;
uniform float uCloudTop;
uniform float uCloudType;      // global type bias
`;

export const CLOUD_MARCH_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler3D uShapeNoise;
uniform sampler3D uDetailNoise;
uniform sampler2D uHistory;
uniform sampler2D uSkyViewLUT;
uniform sampler2D uTransmittanceLUT;
${CLOUD_UNIFORMS}
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbientTop;
uniform vec3 uAmbientBottom;
uniform float uTime;
uniform float uFrame;
uniform vec2 uJitter;
uniform float uSteps;
uniform float uHistoryWeight;
uniform float uDensityScale;
uniform vec2 uWind;
varying vec2 vUv;
${NOISE3D}

float hg(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

float heightGradient(float h, float type) {
  // Stratus low & flat, cumulus puffy, cumulonimbus tall.
  float stratus = smoothstep(0.0, 0.07, h) * smoothstep(0.24, 0.12, h);
  float cumulus = smoothstep(0.0, 0.18, h) * smoothstep(0.62, 0.35, h);
  float nimbus = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.7, h);
  return type < 0.5 ? mix(stratus, cumulus, type * 2.0) : mix(cumulus, nimbus, (type - 0.5) * 2.0);
}

float cloudDensity(vec3 p, bool detail) {
  float h = clamp((p.y - uCloudBottom) / (uCloudTop - uCloudBottom), 0.0, 1.0);
  vec2 wuv = (p.xz + uCloudOffset) * uCloudWeatherScale;
  vec3 weather = texture2D(uCloudWeather, wuv).rgb;
  float coverage = clamp(weather.r * 1.1 + (uCloudCoverage - 0.5) * 1.3, 0.0, 1.0) * smoothstep(0.0, 0.15, uCloudCoverage);
  if (coverage <= 0.01) return 0.0;
  float type = clamp(weather.g * 0.6 + uCloudType * 0.6 - 0.1, 0.0, 1.0);
  // Skew with height so clouds lean downwind.
  vec3 sp = p + vec3(uWind.x, 0.0, uWind.y) * h * 400.0;
  vec4 shape = texture(uShapeNoise, sp * 0.00022 + vec3(uTime * 0.0003, 0.0, 0.0));
  float lowFbm = shape.g * 0.625 + shape.b * 0.25 + shape.a * 0.125;
  float base = remap(shape.r, -(1.0 - lowFbm), 1.0, 0.0, 1.0);
  base *= heightGradient(h, type);
  float withCoverage = remap(base, 1.0 - coverage, 1.0, 0.0, 1.0) * coverage;
  if (withCoverage <= 0.0) return 0.0;
  if (detail) {
    vec3 d = texture(uDetailNoise, p * 0.0021 + vec3(0.0, uTime * 0.004, 0.0)).rgb;
    float highFbm = d.r * 0.625 + d.g * 0.25 + d.b * 0.125;
    float modifier = mix(highFbm, 1.0 - highFbm, clamp(h * 8.0, 0.0, 1.0));
    withCoverage = remap(withCoverage, modifier * 0.28, 1.0, 0.0, 1.0);
  }
  return max(withCoverage, 0.0) * uDensityScale * (0.7 + weather.b * 0.6);
}

float lightMarch(vec3 p) {
  float stepLen = (uCloudTop - uCloudBottom) * 0.09 / max(uSunDir.y, 0.2);
  float od = 0.0;
  for (int i = 0; i < 5; i++) {
    p += uSunDir * stepLen * (1.0 + float(i) * 0.6);
    if (p.y > uCloudTop) break;
    od += cloudDensity(p, i < 2) * stepLen * (1.0 + float(i) * 0.6);
  }
  return od;
}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 uv = vUv + uJitter;
  vec4 world = uInvViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(world.xyz / world.w - uCamPos);
  vec3 ro = uCamPos;
  vec4 result = vec4(0.0, 0.0, 0.0, 1.0);
  float entry = 1e9;

  if (rd.y > 0.01 && uCloudCoverage > 0.01) {
    float t0 = (uCloudBottom - ro.y) / rd.y;
    float t1 = (uCloudTop - ro.y) / rd.y;
    t0 = max(t0, 0.0);
    float maxDist = 60000.0;
    if (t0 < maxDist) {
      t1 = min(t1, maxDist);
      entry = t0;
      float steps = uSteps;
      float dt = (t1 - t0) / steps;
      float t = t0 + dt * ign(gl_FragCoord.xy + uFrame * 5.588);
      float cosTheta = dot(rd, uSunDir);
      float phase = mix(hg(cosTheta, 0.8), hg(cosTheta, -0.25), 0.3);
      vec3 sun = uSunColor * uSunIntensity;
      vec3 scattered = vec3(0.0);
      float transmittance = 1.0;
      float zeroRun = 0.0;
      for (int i = 0; i < 96; i++) {
        if (float(i) >= steps || transmittance < 0.01) break;
        vec3 p = ro + rd * t;
        float coarse = cloudDensity(p, false);
        if (coarse > 0.0) {
          float density = cloudDensity(p, true);
          if (density > 0.0) {
            float h = clamp((p.y - uCloudBottom) / (uCloudTop - uCloudBottom), 0.0, 1.0);
            float od = lightMarch(p);
            // Direct beam with anisotropic phase + multiple scattering, which
            // sees reduced extinction and is ~isotropic (calibrated so a sunlit
            // cloud top approaches a white Lambertian surface, E/pi).
            float beer = exp(-od * 0.045);
            float beerMS = exp(-od * 0.045 * 0.2);
            float powder = mix(1.0, 1.0 - exp(-density * 1.6), 0.35);
            vec3 lightSum = sun * (beer * phase * 1.1 + beerMS * 0.3 * powder);
            vec3 ambient = mix(uAmbientBottom, uAmbientTop, h);
            vec3 S = (lightSum + ambient) * density * 0.045;
            float sigmaT = density * 0.045;
            float trans = exp(-sigmaT * dt);
            scattered += transmittance * (S - S * trans) / max(sigmaT, 1e-5);
            transmittance *= trans;
          }
          zeroRun = 0.0;
        } else {
          zeroRun += 1.0;
        }
        t += dt * (zeroRun > 3.0 ? 1.6 : 1.0);
        if (t > t1) break;
      }
      // Aerial perspective: distant clouds dissolve into the sky.
      float fade = exp(-entry / 26000.0) * smoothstep(0.01, 0.08, rd.y);
      result = vec4(scattered * fade, mix(1.0, transmittance, fade));
    }
  }

  // Temporal reprojection of the cloud layer.
  if (uHistoryWeight > 0.0 && entry < 1e8) {
    vec3 hitPos = ro + rd * min(entry + 400.0, 60000.0);
    vec4 prevClip = uPrevViewProj * vec4(hitPos, 1.0);
    vec2 prevUv = prevClip.xy / prevClip.w * 0.5 + 0.5;
    if (prevClip.w > 0.0 && all(greaterThan(prevUv, vec2(0.0))) && all(lessThan(prevUv, vec2(1.0)))) {
      vec4 history = texture2D(uHistory, prevUv);
      result = mix(result, history, uHistoryWeight);
    }
  }
  gl_FragColor = result;
}
`;

/** Ground cloud shadow: transmittance of the sun through the weather-map column. */
export const CLOUD_SHADOW_GLSL = /* glsl */ `
float atmoCloudShadow(vec3 worldPos, vec3 lightDir) {
  if (uCloudCoverage <= 0.01 || lightDir.y <= 0.02) return 1.0;
  float t = (uCloudBottom + (uCloudTop - uCloudBottom) * 0.3 - worldPos.y) / lightDir.y;
  vec2 p = worldPos.xz + lightDir.xz * t;
  vec3 weather = texture2D(uCloudWeather, (p + uCloudOffset) * uCloudWeatherScale).rgb;
  float coverage = clamp(weather.r * 1.1 + (uCloudCoverage - 0.5) * 1.3, 0.0, 1.0) * smoothstep(0.0, 0.15, uCloudCoverage);
  float thick = smoothstep(0.35, 0.75, coverage) * (0.55 + 0.45 * weather.b);
  return 1.0 - thick * 0.82;
}
`;
