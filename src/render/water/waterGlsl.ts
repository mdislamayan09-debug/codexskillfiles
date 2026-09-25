import { WORLD_SIZE } from '../../world/WorldConfig';
import { NOISE_LIB } from '../terrain/terrainLayers';

// Water shading for sea, lakes and rivers. The surface is a patched
// MeshPhysicalMaterial so sun/moon light, cascaded + cloud shadows, IBL and
// aerial perspective all come from the shared lighting path; the patch adds
// wave geometry, per-pixel normals from the wave cascades, depth-aware
// refraction and absorption, screen-space + sky reflections, foam and
// sub-surface glow on backlit crests.

/** Tileable foam/noise texture: r bubbly foam, g streaks, b fine noise, a broad noise. */
export const FOAM_BAKE_FRAG = /* glsl */ `
${NOISE_LIB}
varying vec2 vUv;
void main() {
  vec2 p = vUv;
  vec4 v1 = pvoronoi(p * 7.0, vec2(7.0), 0.95);
  vec4 v2 = pvoronoi(p * 19.0 + 3.1, vec2(19.0), 0.95);
  vec4 v3 = pvoronoi(p * 53.0 + 7.7, vec2(53.0), 1.0);
  float e1 = 1.0 - smoothstep(0.0, 0.2, v1.y - v1.x);
  float e2 = 1.0 - smoothstep(0.0, 0.16, v2.y - v2.x);
  float bubbles = smoothstep(0.62, 0.18, v3.x) * (0.4 + 0.6 * hash12(floor(p * 53.0)));
  float n = pfbm(p * 5.0, vec2(5.0), 4) * 0.5 + 0.5;
  float foam = clamp(e1 * 0.6 + e2 * 0.5 + bubbles * 0.45, 0.0, 1.0) * (0.35 + 0.65 * n);
  foam = max(foam, smoothstep(0.62, 0.9, n) * 0.8);
  float streak = pfbm(vec2(p.x * 3.0, p.y * 29.0), vec2(3.0, 29.0), 4) * 0.5 + 0.5;
  float fine = pfbm(p * 31.0, vec2(31.0), 3) * 0.5 + 0.5;
  float broad = pfbm(p * 2.0, vec2(2.0), 4) * 0.5 + 0.5;
  gl_FragColor = vec4(foam, streak, fine, broad);
}
`;

const WATER_COMMON = /* glsl */ `
uniform sampler2D uWaterInfo;
uniform sampler2D uWaterLevel;
uniform vec3 uCascadeSize;
uniform vec3 uCascadeAmp;
uniform float uSeaState;
uniform float uShoreAmp;
uniform float uWaterTime;

vec2 waterWorldUv(vec2 xz) { return xz / ${WORLD_SIZE.toFixed(1)} + 0.5; }

// Breakers rolling toward the coast along the shore distance field.
// Returns (height, dHeight/dDistance, crest foam, 0).
vec4 shoreWave(vec2 xz, vec4 info) {
  float d = info.r;
  float env = smoothstep(-1.5, 4.0, d) * (1.0 - smoothstep(24.0, 62.0, d)) * info.g;
  if (env <= 0.0) return vec4(0.0);
  const float lambda = 13.0;
  float groups = 0.5 + 0.5 * sin(uWaterTime * 0.11 + dot(xz, vec2(0.021, 0.017)) + 1.3 * sin(dot(xz, vec2(-0.009, 0.013)) + uWaterTime * 0.03));
  float w = fract(d / lambda + uWaterTime * 0.105);
  float r = clamp(w / 0.08, 0.0, 1.0);
  float rise = r * r * (3.0 - 2.0 * r);
  float back = exp(-w * 5.0);
  float h = rise * back;
  float dRise = w < 0.08 ? 6.0 * r * (1.0 - r) / 0.08 : 0.0;
  float dh = dRise * back - 5.0 * h;
  float shoal = mix(1.0, 1.7, 1.0 - smoothstep(3.0, 26.0, d)) * smoothstep(-1.5, 2.5, d);
  float amp = 0.34 * uShoreAmp * env * (0.35 + 0.65 * groups) * shoal;
  float foam = smoothstep(0.5, 0.95, h) * (1.0 - smoothstep(5.0, 20.0, d)) * env * (0.4 + 0.6 * groups);
  return vec4(amp * h, amp * dh / lambda, foam, 0.0);
}
`;

export const WATER_VERTEX_PARS = /* glsl */ `
${WATER_COMMON}
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform float uDispTexels;
attribute vec4 aBody;   // swell, chop, turbidity, milky
attribute vec4 aFlow;   // flow x, flow z (m/s), whitewater, spacing (m)
attribute vec2 aKind;   // kind (0 sea, 1 lake, 2 river), rest level
varying vec3 vWaterWorld;
varying vec2 vRestXZ;
varying vec4 vBody;
varying vec4 vFlow;
varying vec2 vKind;
varying vec4 vInfo;
varying float vCrest;
`;

export const WATER_BEGIN_VERTEX = /* glsl */ `
vec3 transformed = vec3(position);
vec3 wRest = (modelMatrix * vec4(position, 1.0)).xyz;
vec4 body = aBody;
vec4 info = texture2D(uWaterInfo, waterWorldUv(wRest.xz));
if (aKind.x < 0.5) {
  // Open sea vs. landlocked pools (marsh): pools are calm and murky.
  body.x *= info.g * smoothstep(1.0, 42.0, info.r);
  body.y *= mix(0.25, 1.0, info.g) * smoothstep(-2.0, 6.0, info.r);
  body.z = mix(0.9, body.z, info.g);
} else {
  info = vec4(0.0);
}
vec3 disp = vec3(0.0);
float spacing = max(aFlow.w, 0.05);
float swellAmp = body.x * uSeaState * uCascadeAmp.x;
float chopAmp = body.y * uCascadeAmp.y;
if (swellAmp > 1e-3) {
  float lod = log2(max(1.0, spacing * uDispTexels / uCascadeSize.x * 2.0));
  disp += textureLod(uDisp0, wRest.xz / uCascadeSize.x, lod).xyz * swellAmp;
}
if (chopAmp > 1e-3 && aKind.x < 1.5) {
  float lod = log2(max(1.0, spacing * uDispTexels / uCascadeSize.y * 2.0));
  float fade = 1.0 - smoothstep(0.35, 1.0, spacing / uCascadeSize.y * 6.0);
  disp += textureLod(uDisp1, wRest.xz / uCascadeSize.y, lod).xyz * chopAmp * fade;
}
vec4 sw = shoreWave(wRest.xz, info);
disp.y += sw.x;
disp.xz -= info.ba * sw.x * 0.55;
transformed += disp;
vWaterWorld = wRest + disp;
vRestXZ = wRest.xz;
vBody = body;
vFlow = aFlow;
vKind = aKind;
vInfo = info;
vCrest = disp.y;
`;

export const WATER_FRAGMENT_PARS = /* glsl */ `
${WATER_COMMON}
uniform sampler2D uDer0;
uniform sampler2D uDer1;
uniform sampler2D uDer2;
uniform sampler2D uFoamTex;
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform float uCamNear;
uniform float uCamFar;
uniform mat4 projectionMatrix;
uniform float uFoamJacobian;
uniform float uSkyClamp;
uniform vec3 uWaterLightColor;
uniform vec3 uWaterLightDir;
uniform float uUnderwaterView;
uniform vec3 uCascadeSlopeVar;
uniform vec3 uCascadeMinWave;
uniform vec3 uCascadeMaxWave;
varying vec3 vWaterWorld;
varying vec2 vRestXZ;
varying vec4 vBody;
varying vec4 vFlow;
varying vec2 vKind;
varying vec4 vInfo;
varying float vCrest;

float waterDepthToViewZ(float depth, float near, float far) {
  return (near * far) / ((far - near) * depth - far);
}

float waterViewDist(vec2 uv, float refZ, float refDist) {
  float z = -waterDepthToViewZ(texture2D(uSceneDepth, uv).r, uCamNear, uCamFar);
  return z / max(refZ, 1e-4) * refDist;
}

// Two-phase flow advection offsets (rivers): returns (offsetA, offsetB) and weight of A.
void flowPhases(vec2 flow, out vec2 offA, out vec2 offB, out float wA) {
  const float period = 3.0;
  float t0 = fract(uWaterTime / period);
  float t1 = fract(uWaterTime / period + 0.5);
  offA = flow * t0 * period;
  offB = flow * t1 * period + vec2(0.37, 0.61);
  wA = 1.0 - abs(1.0 - 2.0 * t0);
}

vec4 waterReflect(vec3 posV, vec3 nV, float surfY) {
  vec3 dir = reflect(normalize(posV), nV);
  vec4 result = vec4(0.0);
  // A ray reflected downward off a wave's back would only meet the water
  // again; marching it finds the sea bed through the surface instead.
  float dirUp = (vec4(dir, 0.0) * viewMatrix).y;
#if WATER_SSR_STEPS > 0
  if (dir.z < 0.35 && dirUp > 0.0) {
    float stepLen = 0.4 + (-posV.z) * 0.012;
    vec3 p = posV;
    vec3 prev = p;
    for (int i = 0; i < WATER_SSR_STEPS; i++) {
      prev = p;
      p += dir * stepLen;
      stepLen *= 1.24;
      vec4 clip = projectionMatrix * vec4(p, 1.0);
      if (clip.w <= 0.0) break;
      vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float d = texture2D(uSceneDepth, uv).r;
      if (d >= 0.99999) continue;
      float sceneZ = -waterDepthToViewZ(d, uCamNear, uCamFar);
      if (-p.z > sceneZ) {
        vec3 a = prev;
        vec3 b = p;
        for (int j = 0; j < 5; j++) {
          vec3 m = 0.5 * (a + b);
          vec4 mc = projectionMatrix * vec4(m, 1.0);
          vec2 muv = mc.xy / mc.w * 0.5 + 0.5;
          float mz = -waterDepthToViewZ(texture2D(uSceneDepth, muv).r, uCamNear, uCamFar);
          if (-m.z > mz) b = m; else a = m;
        }
        vec4 bc = projectionMatrix * vec4(b, 1.0);
        vec2 buv = bc.xy / bc.w * 0.5 + 0.5;
        float bz = -waterDepthToViewZ(texture2D(uSceneDepth, buv).r, uCamNear, uCamFar);
        float hitY = cameraPosition.y + (vec4(b, 0.0) * viewMatrix).y;
        if (-b.z - bz < max(2.0, stepLen * 2.0) && hitY > surfY - 0.25) {
          vec2 e = smoothstep(vec2(0.0), vec2(0.07), buv) * smoothstep(vec2(1.0), vec2(0.93), buv);
          result = vec4(min(texture2D(uSceneColor, buv).rgb, vec3(uSkyClamp)), e.x * e.y);
        }
        break;
      }
    }
  }
#endif
  if (result.a < 0.999) {
    // Sky at infinity, straight from the rendered frame (clouds included).
    vec4 c = projectionMatrix * vec4(dir, 0.0);
    if (c.w > 0.0) {
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && texture2D(uSceneDepth, uv).r >= 0.99999) {
        vec2 e = smoothstep(vec2(0.0), vec2(0.1), uv) * smoothstep(vec2(1.0), vec2(0.9), uv);
        float w = e.x * e.y * (1.0 - result.a);
        vec3 sky = min(texture2D(uSceneColor, uv).rgb, vec3(uSkyClamp));
        result.rgb = (result.rgb * result.a + sky * w) / max(result.a + w, 1e-4);
        result.a += w;
      }
    }
  }
  return result;
}
`;

/** Main water block: runs early in the fragment shader and feeds later overrides. */
export const WATER_FRAGMENT_MAIN = /* glsl */ `
// Pixel footprint on the water, before any discard (derivatives stay valid).
float wFootprint = max(length(dFdx(vRestXZ)), length(dFdy(vRestXZ)));
vec3 wViewPos = -vViewPosition;
float wFragDist = length(wViewPos);
float wFragZ = max(-wViewPos.z, 1e-3);
vec2 wScreenUv = gl_FragCoord.xy / uResolution;
float wKind = vKind.x;
float wLevelHere = texture2D(uWaterLevel, waterWorldUv(vRestXZ)).r;
if (wKind < 0.5) {
  if (wLevelHere > 0.08) discard;
} else if (wKind < 1.5) {
  if (abs(wLevelHere - vKind.y) > 0.4) discard;
}
vec3 wV = normalize(cameraPosition - vWaterWorld);
bool wBelow = !gl_FrontFacing;
float wSwell = vBody.x * uSeaState * uCascadeAmp.x;
float wChop = vBody.y * uCascadeAmp.y;
float wChopFine = vBody.y * uCascadeAmp.z;
float wTurb = vBody.z;
float wMilky = vBody.w;

// Cat's-paw gusts ruffle calm water in drifting patches.
vec4 wNoise = texture2D(uFoamTex, vRestXZ / 190.0 + vec2(0.011, 0.004) * uWaterTime);
float wGust = mix(0.35, 1.35, smoothstep(0.3, 0.75, wNoise.a));
if (wKind > 0.5 && wKind < 1.5) { wChop *= wGust; wChopFine *= wGust; }

vec2 wSlope = vec2(0.0);
float wJx = 1.0;
float wJz = 1.0;
vec2 wFoamUv = vRestXZ / 6.5;
float wFoamWeightA = 1.0;
vec2 wFoamUvB = wFoamUv;
if (wSwell > 1e-3) {
  vec4 c0 = texture2D(uDer0, vRestXZ / uCascadeSize.x) * wSwell;
  wSlope += c0.xy; wJx += c0.z; wJz += c0.w;
}
if (wKind > 1.5) {
  vec2 offA, offB;
  float wA;
  flowPhases(vFlow.xy, offA, offB, wA);
  vec4 a1 = texture2D(uDer1, (vRestXZ - offA) / uCascadeSize.y);
  vec4 b1 = texture2D(uDer1, (vRestXZ - offB) / uCascadeSize.y);
  vec4 a2 = texture2D(uDer2, (vRestXZ - offA) / uCascadeSize.z);
  vec4 b2 = texture2D(uDer2, (vRestXZ - offB) / uCascadeSize.z);
  vec4 c1 = mix(b1, a1, wA) * wChop;
  vec4 c2 = mix(b2, a2, wA) * (wChopFine + vFlow.z * 0.6);
  wSlope += c1.xy + c2.xy; wJx += c1.z + c2.z; wJz += c1.w + c2.w;
  wFoamUv = (vRestXZ - offA) / 5.0;
  wFoamUvB = (vRestXZ - offB) / 5.0;
  wFoamWeightA = wA;
} else {
  if (wChop > 1e-3) {
    vec4 c1 = texture2D(uDer1, vRestXZ / uCascadeSize.y) * wChop;
    wSlope += c1.xy; wJx += c1.z; wJz += c1.w;
  }
  if (wChopFine > 1e-3) {
    vec4 c2 = texture2D(uDer2, vRestXZ / uCascadeSize.z) * wChopFine;
    wSlope += c2.xy; wJx += c2.z; wJz += c2.w;
  }
}
vec4 wShore = wKind < 0.5 ? shoreWave(vRestXZ, vInfo) : vec4(0.0);
wSlope += wShore.y * vInfo.ba;
vec3 wN = normalize(vec3(-wSlope.x / max(wJx, 0.3), 1.0, -wSlope.y / max(wJz, 0.3)));
// Waves smaller than a pixel are averaged away by the mips; their slope
// variance moves into the microfacet roughness instead (LEAN-style), so the
// far sea glitters rather than turning into an oily mirror.
vec3 wLost = clamp(log2(2.0 * wFootprint / uCascadeMinWave) / log2(uCascadeMaxWave / uCascadeMinWave), 0.0, 1.0);
vec3 wAmps = vec3(wSwell, wChop, wChopFine);
float wExtraVar = dot(wLost, uCascadeSlopeVar * wAmps * wAmps);
float wAlphaR = 0.02 + 0.02 * wTurb;
wAlphaR = sqrt(wAlphaR * wAlphaR + 2.0 * wExtraVar);
float wRough = clamp(sqrt(wAlphaR), 0.1, 0.6);
vec3 wNV = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
if (wBelow) wNV = -wNV;

// Water thickness behind this pixel.
float wSceneDist = waterViewDist(wScreenUv, wFragZ, wFragDist);
float wThick = max(0.0, wSceneDist - wFragDist);
float wBottomY = cameraPosition.y - wV.y * wSceneDist;
float wDepthVert = max(0.0, vWaterWorld.y - wBottomY);

// Refraction with a guard against pulling in foreground objects.
float wRefrAmt = 0.045 * clamp(wDepthVert * 0.6, 0.0, 1.0) / (1.0 + wFragDist * 0.01);
vec2 wRuv = wScreenUv + wNV.xy * wRefrAmt;
float wRDist = waterViewDist(wRuv, wFragZ, wFragDist);
if (wRDist < wFragDist) { wRuv = wScreenUv; wRDist = wSceneDist; }
vec3 wRefr = texture2D(uSceneColor, wRuv).rgb;
float wPath = max(0.0, wRDist - wFragDist);
float wRBottom = max(0.0, vWaterWorld.y - (cameraPosition.y - wV.y * wRDist));

vec3 wSigma = mix(mix(vec3(0.34, 0.085, 0.052), vec3(1.05, 0.78, 0.9), wTurb), vec3(0.62, 0.22, 0.2), wMilky);
vec3 wScatter = mix(mix(vec3(0.0035, 0.016, 0.02), vec3(0.018, 0.02, 0.009), wTurb), vec3(0.045, 0.12, 0.115), wMilky);
vec3 wT = exp(-wSigma * (wPath + wRBottom * 1.2));
if (wBelow) wT = exp(-wSigma * wFragDist * 0.6);

// Foam: whitecaps (Jacobian folds), breakers, contact band, whitewater.
float wFoamCov = 0.0;
float wJ = wJx * wJz;
if (wSwell > 1e-3) wFoamCov += smoothstep(uFoamJacobian, uFoamJacobian - 0.45, wJ) * 0.9;
wFoamCov += wShore.z * 1.3;
float wSwash = 0.35 + 0.22 * sin(uWaterTime * 0.8 + vInfo.r * 0.45 + vRestXZ.x * 0.05);
float wBand = 1.0 - smoothstep(0.0, wSwash, wDepthVert);
wFoamCov += wBand * (wKind < 0.5 ? 0.85 * smoothstep(-2.0, 1.0, vInfo.r) : (wKind > 1.5 ? 0.6 : 0.3));
wFoamCov += vFlow.z * 1.1;
vec4 wFt = mix(texture2D(uFoamTex, wFoamUvB), texture2D(uFoamTex, wFoamUv), wFoamWeightA);
float wFoam = clamp((wFt.r + 0.25 * wFt.b - (1.05 - clamp(wFoamCov, 0.0, 1.0))) * 3.0 + max(0.0, wFoamCov - 1.0), 0.0, 1.0);
wFoam *= 1.0 - smoothstep(250.0, 1400.0, wFragDist) * 0.6;
if (wBelow) wFoam *= 0.3;

// Soft intersection with shores and banks.
float wAlpha = smoothstep(0.0, 0.12, wDepthVert + wFoam * 0.1);
if (wBelow) wAlpha = 1.0;

vec3 wAlbedo = mix(wScatter * (vec3(1.0) - wT) * 3.0, vec3(0.82, 0.86, 0.86), wFoam);
wRough = mix(wRough, 0.55, wFoam);

// Backlit crests glow with light scattered through thin water.
float wThin = clamp(vCrest * 0.9 + wShore.x * 2.0, 0.0, 1.5);
float wSssView = pow(clamp(dot(wV, -uWaterLightDir) * 0.5 + 0.5, 0.0, 1.0), 5.0);
vec3 wSss = uWaterLightColor * wScatter * 26.0 * wThin * wSssView * (1.0 - wFoam) * (1.0 - wTurb * 0.7);
vec4 wReflection = waterReflect(wViewPos, wNV, vWaterWorld.y);
if (wBelow) wReflection = vec4(wScatter * 2.0, 1.0);
`;

/** Transmission added after lighting; F is the view Fresnel term. */
export const WATER_OUTGOING = /* glsl */ `
{
  float wNdV = clamp(dot(normal, geometryViewDir), 0.0, 1.0);
  float wF = 0.02 + 0.98 * pow(1.0 - wNdV, 5.0);
  if (wBelow) {
    // Snell's window: total internal reflection beyond ~48.6 degrees.
    wF = smoothstep(0.62, 0.7, 1.0 - wNdV) * 0.9 + 0.1;
  }
  outgoingLight += wRefr * wT * (1.0 - wF) * (1.0 - wFoam) + wSss;
#if WATER_DEBUG == 1
  outgoingLight = wReflection.rgb * wReflection.a + vec3(1.0, 0.0, 1.0) * (1.0 - wReflection.a) * 0.3;
#elif WATER_DEBUG == 2
  outgoingLight = wRefr * wT;
#elif WATER_DEBUG == 3
  outgoingLight = wN * 0.5 + 0.5;
#elif WATER_DEBUG == 4
  outgoingLight = vec3(wF);
#elif WATER_DEBUG == 5
  outgoingLight = reflectedLight.indirectSpecular;
#elif WATER_DEBUG == 6
  outgoingLight = radiance;
#elif WATER_DEBUG == 7
  outgoingLight = vec3(material.dfg, material.roughness);
#elif WATER_DEBUG == 8
  outgoingLight = vec3(texture2D(dfgLUT, vec2(0.5, 0.5)).rg, texture2D(dfgLUT, vec2(0.1, 0.05)).g);
#endif
}
`;
