import * as THREE from 'three';
import { createFullscreenMaterial, createHdrTarget, FullscreenPass } from '../FullscreenPass';

// ---------------------------------------------------------------------------
// Temporal anti-aliasing and upscaling. Every frame the camera is nudged by a
// different sub-pixel offset (Halton 2, 3), so over sixteen frames each
// screen pixel is sampled at sixteen places. The resolve runs at the display
// resolution: it rebuilds each display pixel from the nearest scene samples
// (the scene may be rendered smaller), reprojects last frame's result through
// the depth buffer, clamps it to what this frame's neighbourhood allows (so
// moving leaves and opened doors don't ghost), and blends. Edges, thin twigs,
// grass and specular sparkle come out as if supersampled, at full display
// resolution, for the price of one full-screen pass.

const RESOLVE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uCurrent;
uniform sampler2D uDepth;
uniform sampler2D uHistory;
uniform sampler2D uExposure;
uniform vec2 uInSize;
uniform vec2 uOutSize;
uniform vec2 uJitter;        // input pixels: sample k sits at k + 0.5 + uJitter
uniform mat4 uInvViewProj;   // this frame, unjittered
uniform mat4 uPrevViewProj;  // last frame, unjittered
uniform float uBlend;        // this frame's share when a sample lands on the pixel
uniform float uReset;
uniform float uExposureScale;
varying vec2 vUv;

vec3 toYCoCg(vec3 c) {
  return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25)));
}
vec3 fromYCoCg(vec3 c) {
  return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}
float max3(vec3 c) { return max(c.r, max(c.g, c.b)); }

// Blending and clamping happen on tone-mapped values, so one bright sparkle
// cannot drag a whole pixel's history around (the flicker of sunlit water).
// Mapping by the brightest channel keeps every channel below one, so the
// way back is exact.
vec3 compress(vec3 c, float e) { return c * e / (1.0 + max3(c) * e); }
vec3 expand(vec3 c, float e) { return c / (e * max(1.0 - max3(c), 1e-3)); }

// Catmull-Rom history in five bilinear taps: stays sharp while it moves.
vec3 sampleHistory(vec2 uv) {
  vec2 samplePos = uv * uOutSize;
  vec2 tp1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - tp1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 tp0 = (tp1 - 1.0) / uOutSize;
  vec2 tp3 = (tp1 + 2.0) / uOutSize;
  vec2 tp12 = (tp1 + w2 / w12) / uOutSize;
  vec3 r = texture2D(uHistory, vec2(tp12.x, tp0.y)).rgb * (w12.x * w0.y)
         + texture2D(uHistory, vec2(tp0.x, tp12.y)).rgb * (w0.x * w12.y)
         + texture2D(uHistory, tp12).rgb * (w12.x * w12.y)
         + texture2D(uHistory, vec2(tp3.x, tp12.y)).rgb * (w3.x * w12.y)
         + texture2D(uHistory, vec2(tp12.x, tp3.y)).rgb * (w12.x * w3.y);
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / ws, vec3(0.0));
}

void main() {
  float e = texture2D(uExposure, vec2(0.5)).r * uExposureScale;
  vec2 P = vUv * uInSize;               // this display pixel in scene pixels
  ivec2 k0 = ivec2(floor(P - uJitter)); // the scene sample nearest to it
  ivec2 maxK = ivec2(uInSize) - 1;

  vec3 sum = vec3(0.0);
  float wSum = 0.0;
  float wMax = 0.0;
  vec3 m1 = vec3(0.0);
  vec3 m2 = vec3(0.0);
  vec3 lo = vec3(1e9);
  vec3 hi = vec3(-1e9);
  float closest = 1.0;
  vec2 closestUv = vUv;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      // A plus-shaped cross: five samples rebuild the pixel and bound its
      // history nearly as well as nine, for half the reads.
      if (x != 0 && y != 0) continue;
      ivec2 k = clamp(k0 + ivec2(x, y), ivec2(0), maxK);
      vec2 s = vec2(k) + 0.5 + uJitter;
      vec2 d = s - P;
      float w = exp(-2.29 * dot(d, d));
      vec3 c = compress(max(texelFetch(uCurrent, k, 0).rgb, vec3(0.0)), e);
      sum += c * w;
      wSum += w;
      wMax = max(wMax, w);
      vec3 ycc = toYCoCg(c);
      m1 += ycc;
      m2 += ycc * ycc;
      lo = min(lo, ycc);
      hi = max(hi, ycc);
      // The nearest surface steers the reprojection, so edges move with
      // whatever is in front.
      float z = texelFetch(uDepth, k, 0).r;
      if (z < closest) {
        closest = z;
        closestUv = s / uInSize;
      }
    }
  }
  vec3 current = sum / max(wSum, 1e-5);

  // The held tool and hands are squeezed into the nearest few percent of the
  // depth range and move with the camera: they have no motion of their own.
  bool viewmodel = closest < 0.035;
  vec2 prevUv = vUv;
  if (!viewmodel) {
    vec4 world = uInvViewProj * vec4(closestUv * 2.0 - 1.0, closest * 2.0 - 1.0, 1.0);
    world /= world.w;
    vec4 prev = uPrevViewProj * world;
    prevUv = vUv + (prev.xy / prev.w * 0.5 + 0.5 - closestUv);
  }

  float alpha = clamp(uBlend * wMax * 1.4, 0.02, 1.0);
  if (viewmodel) alpha = max(alpha, 0.35);
  if (uReset > 0.5 || any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)))) alpha = 1.0;

  vec3 result = current;
  if (alpha < 1.0) {
    #ifdef TAA_BILINEAR_HISTORY
    vec3 history = compress(texture2D(uHistory, prevUv).rgb, e);
    #else
    vec3 history = compress(sampleHistory(prevUv), e);
    #endif
    // Variance clipping (Salvi) inside the neighbourhood's min/max box.
    vec3 mu = m1 / 5.0;
    vec3 sigma = sqrt(max(m2 / 5.0 - mu * mu, vec3(0.0)));
    vec3 bmin = max(lo, mu - sigma * 1.35);
    vec3 bmax = min(hi, mu + sigma * 1.35);
    vec3 h = toYCoCg(history);
    vec3 center = (bmin + bmax) * 0.5;
    vec3 extent = max((bmax - bmin) * 0.5, vec3(1e-4));
    vec3 offset = h - center;
    vec3 ts = abs(offset / extent);
    float t = max(ts.x, max(ts.y, ts.z));
    if (t > 1.0) h = center + offset / t;
    history = fromYCoCg(h);
    // Motion softens the history a little each frame: trust it less.
    float motion = length((prevUv - vUv) * uOutSize);
    alpha = min(1.0, alpha + clamp(motion * 0.01, 0.0, 0.12));
    result = mix(history, current, alpha);
  }
  result = expand(clamp(result, 0.0, 0.998), e);
  if (any(isnan(result)) || any(isinf(result))) result = vec3(0.0);
  gl_FragColor = vec4(result, 1.0);
}
`;

function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

const JITTER: [number, number][] = Array.from({ length: 16 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

export class TemporalAA {
  private targets: THREE.WebGLRenderTarget[] = [];
  private current = 0;
  private valid = false;
  private frame = 0;
  private outW = 0;
  private outH = 0;
  private inW = 1;
  private inH = 1;
  /** This frame's sub-pixel offset, in scene pixels. */
  readonly jitter = new THREE.Vector2();
  private readonly viewProj = new THREE.Matrix4();
  private readonly prevViewProj = new THREE.Matrix4();
  private readonly invViewProj = new THREE.Matrix4();
  private readonly lastCamera = new THREE.Vector3(Number.NaN, 0, 0);
  private saved8 = 0;
  private saved9 = 0;
  private jittered = false;
  private readonly pass: FullscreenPass;

  /**
   * @param cheap one bilinear history tap instead of five (Catmull-Rom):
   *   a little softer in motion, for thin graphics budgets.
   */
  constructor(cheap = false) {
    this.pass = new FullscreenPass(
      createFullscreenMaterial({
        fragmentShader: RESOLVE_FRAG,
        defines: cheap ? { TAA_BILINEAR_HISTORY: 1 } : {},
        uniforms: {
          uCurrent: { value: null },
          uDepth: { value: null },
          uHistory: { value: null },
          uExposure: { value: null },
          uInSize: { value: new THREE.Vector2(1, 1) },
          uOutSize: { value: new THREE.Vector2(1, 1) },
          uJitter: { value: this.jitter },
          uInvViewProj: { value: this.invViewProj },
          uPrevViewProj: { value: this.prevViewProj },
          uBlend: { value: 0.1 },
          uReset: { value: 1 },
          uExposureScale: { value: 1 },
        },
      }),
    );
  }

  /** The resolved frame at display resolution (linear HDR). */
  get texture(): THREE.Texture {
    return this.targets[this.current].texture;
  }

  setSize(width: number, height: number): void {
    if (width === this.outW && height === this.outH && this.targets.length) return;
    this.outW = width;
    this.outH = height;
    for (const t of this.targets) t.dispose();
    this.targets = [createHdrTarget(width, height), createHdrTarget(width, height)];
    this.valid = false;
  }

  /** Forget the history (camera cuts, loads, teleports). */
  reset(): void {
    this.valid = false;
  }

  /**
   * Before the scene renders: note the camera's true view, then shift its
   * projection by this frame's sub-pixel offset.
   */
  jitterCamera(camera: THREE.PerspectiveCamera, sceneWidth: number, sceneHeight: number): void {
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.invViewProj.copy(this.viewProj).invert();
    // A jump of more than a few metres in one frame is a cut, not motion.
    if (!(this.lastCamera.distanceToSquared(camera.position) < 12 * 12)) this.valid = false;
    this.lastCamera.copy(camera.position);
    this.inW = sceneWidth;
    this.inH = sceneHeight;
    const [jx, jy] = JITTER[this.frame % JITTER.length];
    this.frame += 1;
    this.jitter.set(jx, jy);
    const e = camera.projectionMatrix.elements;
    this.saved8 = e[8];
    this.saved9 = e[9];
    // Sample k lands on the unjittered point k + 0.5 + jitter.
    e[8] += (2 * jx) / sceneWidth;
    e[9] += (2 * jy) / sceneHeight;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.jittered = true;
  }

  /** Puts the camera's projection back once the scene passes are drawn. */
  restoreCamera(camera: THREE.PerspectiveCamera): void {
    if (!this.jittered) return;
    const e = camera.projectionMatrix.elements;
    e[8] = this.saved8;
    e[9] = this.saved9;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.jittered = false;
  }

  resolve(renderer: THREE.WebGLRenderer, color: THREE.Texture, depth: THREE.Texture, exposure: THREE.Texture, exposureScale: number): void {
    const u = this.pass.material.uniforms;
    u.uCurrent.value = color;
    u.uDepth.value = depth;
    u.uHistory.value = this.targets[this.current].texture;
    u.uExposure.value = exposure;
    u.uExposureScale.value = exposureScale;
    (u.uInSize.value as THREE.Vector2).set(this.inW, this.inH);
    (u.uOutSize.value as THREE.Vector2).set(this.outW, this.outH);
    u.uReset.value = this.valid ? 0 : 1;
    const next = 1 - this.current;
    this.pass.render(renderer, this.targets[next]);
    this.current = next;
    this.prevViewProj.copy(this.viewProj);
    this.valid = true;
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.pass.dispose();
  }
}
