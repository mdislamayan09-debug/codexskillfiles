// Final composite: exposure → tone map (AgX default, ACES optional) → grade →
// vignette / grain / chromatic fringe → accessibility filters → sRGB.

export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform sampler2D uGodRays;
uniform sampler2D uExposure;
uniform sampler2D uDepth;
uniform float uBloomStrength;
uniform float uGodRayStrength;
uniform vec3 uGodRayColor;
uniform float uManualExposure;
uniform float uAutoExposure;
uniform int uToneMapper;
uniform vec3 uWhiteBalance;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uVignette;
uniform float uGrain;
uniform float uFringe;
uniform float uTime;
uniform int uColorblind;
uniform float uDamage;
uniform float uLowHealth;
uniform float uFlash;
uniform float uFade;
uniform float uUnderwater;
uniform vec3 uUnderwaterColor;
uniform float uNear;
uniform float uFar;
uniform vec2 uResolution;
uniform float uSharpen;
varying vec2 vUv;

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 v) {
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  v = m * v;
  v = clamp(log2(max(v, vec3(1e-10))), minEv, maxEv);
  v = (v - minEv) / (maxEv - minEv);
  return agxContrast(v);
}
vec3 agxEotf(vec3 v) {
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return mi * v;
}
vec3 agxLook(vec3 v) {
  float luma = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = pow(max(v, vec3(0.0)), vec3(1.12));
  return luma + 1.18 * (v - luma);
}
// ACES fitted (Stephen Hill), output is display-referred linear.
vec3 acesFitted(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = inM * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(outM * (a / b), 0.0, 1.0);
}
vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Daltonization: shift information lost to a color deficiency into channels that remain.
vec3 daltonize(vec3 rgb, int mode) {
  mat3 sim;
  if (mode == 1) sim = mat3(0.0, 0.0, 0.0, 2.02344, 1.0, 0.0, -2.52581, 0.0, 1.0);        // protan (LMS)
  else if (mode == 2) sim = mat3(1.0, 0.494207, 0.0, 0.0, 0.0, 0.0, 0.0, 1.24827, 1.0);  // deutan
  else sim = mat3(1.0, 0.0, -0.395913, 0.0, 1.0, 0.801109, 0.0, 0.0, 0.0);               // tritan
  const mat3 rgb2lms = mat3(17.8824, 3.45565, 0.0299566, 43.5161, 27.1554, 0.184309, 4.11935, 3.86714, 1.46709);
  const mat3 lms2rgb = mat3(0.0809444479, -0.0102485335, -0.000365296938, -0.130504409, 0.0540193266, -0.00412161469, 0.116721066, -0.113614708, 0.693511405);
  vec3 lms = rgb2lms * rgb;
  vec3 simRgb = lms2rgb * (sim * lms);
  vec3 err = rgb - simRgb;
  vec3 shift = vec3(0.0, err.r * 0.7 + err.g, err.r * 0.7 + err.b);
  return clamp(rgb + shift, 0.0, 1.0);
}
float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;
  float edge = dot(centered, centered);
  vec3 col;
  if (uFringe > 0.0) {
    vec2 shift = centered * edge * uFringe;
    col = vec3(texture2D(uColor, uv - shift).r, texture2D(uColor, uv).g, texture2D(uColor, uv + shift).b);
  } else {
    col = texture2D(uColor, uv).rgb;
    if (uSharpen > 0.0) {
      // Contrast-adaptive sharpening (after AMD's CAS): push the pixel away
      // from its four neighbours, less where local contrast is already high,
      // and never past the neighbourhood's own range (no halos).
      vec2 t = 1.0 / uResolution;
      vec3 n = texture2D(uColor, uv + vec2(0.0, t.y)).rgb;
      vec3 s = texture2D(uColor, uv - vec2(0.0, t.y)).rgb;
      vec3 e = texture2D(uColor, uv + vec2(t.x, 0.0)).rgb;
      vec3 w = texture2D(uColor, uv - vec2(t.x, 0.0)).rgb;
      vec3 mn = min(col, min(min(n, s), min(e, w)));
      vec3 mx = max(col, max(max(n, s), max(e, w)));
      float lmn = dot(mn, vec3(0.2126, 0.7152, 0.0722));
      float lmx = dot(mx, vec3(0.2126, 0.7152, 0.0722));
      float amp = sqrt(clamp(lmn / max(lmx, 1e-5), 0.0, 1.0));
      float k = -uSharpen * amp * 0.2;
      vec3 sharp = (col + (n + s + e + w) * k) / (1.0 + 4.0 * k);
      col = clamp(sharp, mn, mx);
    }
  }
  col += texture2D(uBloom, uv).rgb * uBloomStrength;
  col += texture2D(uGodRays, uv).rgb * uGodRayColor * uGodRayStrength;

  if (uUnderwater > 0.0) {
    float dist = linearDepth(texture2D(uDepth, uv).r);
    float fog = 1.0 - exp(-dist * 0.09 * uUnderwater);
    float caustic = 0.85 + 0.15 * sin(uv.x * 40.0 + uTime * 2.0) * sin(uv.y * 33.0 - uTime * 1.7);
    col = mix(col * vec3(0.55, 0.85, 0.9) * caustic, uUnderwaterColor, fog);
  }

  float exposure = uAutoExposure > 0.5 ? texture2D(uExposure, vec2(0.5)).r : 1.0;
  col *= exposure * uManualExposure;
  col *= uWhiteBalance;
  col *= 1.0 + uFlash * 3.0;

  // Contrast around mid-grey in log space, saturation in linear.
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 logc = log2(max(col, vec3(1e-6)));
  logc = (logc - log2(0.18)) * uContrast + log2(0.18);
  col = exp2(logc);
  float lumaSat = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float desat = uLowHealth * 0.65;
  col = mix(vec3(lumaSat), col, uSaturation * (1.0 - desat));

  vec3 display;
  if (uToneMapper == 1) {
    display = linearToSrgb(acesFitted(col));
  } else {
    display = agxEotf(agxLook(agx(col)));
  }
  display = clamp(display, 0.0, 1.0);

  // Lift / gamma / gain in display space.
  display = pow(max(display * uGain + uLift * (1.0 - display), vec3(0.0)), 1.0 / uGamma);

  float vig = 1.0 - uVignette * smoothstep(0.08, 0.55, edge);
  display *= vig;
  // Hurt: red pulse at the edges.
  display = mix(display, vec3(0.55, 0.04, 0.03), uDamage * smoothstep(0.05, 0.45, edge));

  float grain = hash12(gl_FragCoord.xy + fract(uTime * 13.37) * 311.0) - 0.5;
  display += grain * uGrain;
  // Anti-banding dither.
  display += (hash12(gl_FragCoord.xy * 1.37 + 7.1) - 0.5) / 255.0;

  if (uColorblind > 0) display = daltonize(display, uColorblind);
  display *= 1.0 - uFade;
  gl_FragColor = vec4(clamp(display, 0.0, 1.0), 1.0);
}
`;

/** Restores the opaque color (with AO) and depth into the second MSAA pass. */
export const RESTORE_FRAG = /* glsl */ `
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform sampler2D uAO;
uniform float uAOStrength;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uColor, vUv).rgb;
  float ao = texture2D(uAO, vUv).r;
  c *= mix(1.0, ao, uAOStrength);
  gl_FragColor = vec4(c, 1.0);
  gl_FragDepth = texture2D(uDepth, vUv).r;
}
`;
