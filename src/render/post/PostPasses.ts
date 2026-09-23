import * as THREE from 'three';
import { createFullscreenMaterial, createHdrTarget, FullscreenPass } from '../FullscreenPass';

// ---------------------------------------------------------------------------
// Physically based bloom (Jimenez 2014, "Next Generation Post Processing in
// Call of Duty: Advanced Warfare"): 13-tap downsample with Karis average on the
// first mip, tent-filter upsample accumulated back up the chain.

const DOWNSAMPLE_FRAG = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uFirst;
varying vec2 vUv;
float karis(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.25); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(uSource, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(uSource, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(uSource, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(uSource, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(uSource, vUv).rgb;
  vec3 f = texture2D(uSource, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(uSource, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(uSource, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(uSource, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(uSource, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(uSource, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(uSource, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(uSource, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 col;
  if (uFirst > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25;
    vec3 g1 = (b + c + e + f) * 0.25;
    vec3 g2 = (d + e + g + h) * 0.25;
    vec3 g3 = (e + f + h + i) * 0.25;
    vec3 g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) /
          (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

const UPSAMPLE_FRAG = /* glsl */ `
uniform sampler2D uLow;
uniform sampler2D uHigh;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture2D(uLow, vUv).rgb * 4.0;
  s += (texture2D(uLow, vUv + vec2(-t.x, 0.0)).rgb + texture2D(uLow, vUv + vec2(t.x, 0.0)).rgb +
        texture2D(uLow, vUv + vec2(0.0, -t.y)).rgb + texture2D(uLow, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  s += texture2D(uLow, vUv + vec2(-t.x, -t.y)).rgb + texture2D(uLow, vUv + vec2(t.x, -t.y)).rgb +
       texture2D(uLow, vUv + vec2(-t.x, t.y)).rgb + texture2D(uLow, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(texture2D(uHigh, vUv).rgb + s / 16.0, 1.0);
}
`;

export class BloomPass {
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private readonly downPass = new FullscreenPass(
    createFullscreenMaterial({
      fragmentShader: DOWNSAMPLE_FRAG,
      uniforms: { uSource: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } },
    }),
  );
  private readonly upPass = new FullscreenPass(
    createFullscreenMaterial({
      fragmentShader: UPSAMPLE_FRAG,
      uniforms: { uLow: { value: null }, uHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } },
    }),
  );

  constructor(private levels = 6) {}

  setSize(width: number, height: number): void {
    for (const rt of [...this.down, ...this.up]) rt.dispose();
    this.down = [];
    this.up = [];
    let w = Math.max(1, Math.floor(width / 2));
    let h = Math.max(1, Math.floor(height / 2));
    for (let i = 0; i < this.levels; i += 1) {
      this.down.push(createHdrTarget(w, h));
      this.up.push(createHdrTarget(w, h));
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
  }

  get texture(): THREE.Texture {
    return this.up[0].texture;
  }

  render(renderer: THREE.WebGLRenderer, source: THREE.Texture, sourceWidth: number, sourceHeight: number): void {
    const du = this.downPass.material.uniforms;
    let srcTex = source;
    let sw = sourceWidth;
    let sh = sourceHeight;
    for (let i = 0; i < this.down.length; i += 1) {
      du.uSource.value = srcTex;
      (du.uTexel.value as THREE.Vector2).set(1 / sw, 1 / sh);
      du.uFirst.value = i === 0 ? 1 : 0;
      this.downPass.render(renderer, this.down[i]);
      srcTex = this.down[i].texture;
      sw = this.down[i].width;
      sh = this.down[i].height;
    }
    const uu = this.upPass.material.uniforms;
    const last = this.down.length - 1;
    // Seed the chain: the smallest "up" level is just the smallest downsample.
    du.uSource.value = this.down[last].texture;
    (du.uTexel.value as THREE.Vector2).set(1 / this.down[last].width, 1 / this.down[last].height);
    du.uFirst.value = 0;
    this.downPass.render(renderer, this.up[last]);
    for (let i = last - 1; i >= 0; i -= 1) {
      uu.uLow.value = this.up[i + 1].texture;
      uu.uHigh.value = this.down[i].texture;
      (uu.uTexel.value as THREE.Vector2).set(1 / this.up[i + 1].width, 1 / this.up[i + 1].height);
      this.upPass.render(renderer, this.up[i]);
    }
  }

  dispose(): void {
    for (const rt of [...this.down, ...this.up]) rt.dispose();
    this.downPass.dispose();
    this.upPass.dispose();
  }
}

// ---------------------------------------------------------------------------
// Eye adaptation kept entirely on the GPU: center-weighted log luminance →
// mip chain → 1×1 average → temporally adapted exposure (ping-pong).

const LOGLUM_FRAG = /* glsl */ `
uniform sampler2D uSource;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uSource, vUv).rgb;
  float lum = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
  vec2 d = vUv - 0.5;
  float w = exp(-dot(d, d) * 6.0);
  gl_FragColor = vec4(log2(lum) * w, w, 0.0, 1.0);
}
`;

const ADAPT_FRAG = /* glsl */ `
uniform sampler2D uLogLum;
uniform sampler2D uPrevious;
uniform float uDelta;
uniform float uMinExposure;
uniform float uMaxExposure;
uniform float uCompensation;
uniform float uReset;
varying vec2 vUv;
void main() {
  vec2 avg = textureLod(uLogLum, vec2(0.5), 10.0).rg;
  float logAvg = avg.x / max(avg.y, 1e-5);
  float lum = exp2(logAvg);
  // Target: scene average maps to mid-grey, softened so nights stay dark.
  float target = 0.16 / pow(lum, 0.86) * uCompensation;
  target = clamp(target, uMinExposure, uMaxExposure);
  float previous = texture2D(uPrevious, vec2(0.5)).r;
  float speed = target > previous ? 1.1 : 2.4; // dark → bright adapts slower
  float exposure = uReset > 0.5 ? target : previous + (target - previous) * (1.0 - exp(-uDelta * speed));
  gl_FragColor = vec4(exposure, lum, 0.0, 1.0);
}
`;

export class ExposurePass {
  private readonly logLum = new THREE.WebGLRenderTarget(256, 256, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  private readonly targets = [
    createHdrTarget(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }),
    createHdrTarget(1, 1, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }),
  ];
  private readonly readback = new Float32Array(4);
  private current = 0;
  private reset = true;
  private readonly logPass = new FullscreenPass(createFullscreenMaterial({ fragmentShader: LOGLUM_FRAG, uniforms: { uSource: { value: null } } }));
  private readonly adaptPass = new FullscreenPass(
    createFullscreenMaterial({
      fragmentShader: ADAPT_FRAG,
      uniforms: {
        uLogLum: { value: this.logLum.texture },
        uPrevious: { value: null },
        uDelta: { value: 0.016 },
        uMinExposure: { value: 0.12 },
        uMaxExposure: { value: 22 },
        uCompensation: { value: 1 },
        uReset: { value: 1 },
      },
    }),
  );

  get texture(): THREE.Texture {
    return this.targets[this.current].texture;
  }

  setLimits(min: number, max: number, compensation: number): void {
    const u = this.adaptPass.material.uniforms;
    u.uMinExposure.value = min;
    u.uMaxExposure.value = max;
    u.uCompensation.value = compensation;
  }

  forceReset(): void {
    this.reset = true;
  }

  /** Debug only (stalls the GPU): current exposure and metered average luminance. */
  probe(renderer: THREE.WebGLRenderer): { exposure: number; luminance: number } {
    renderer.readRenderTargetPixels(this.targets[this.current], 0, 0, 1, 1, this.readback);
    return { exposure: this.readback[0], luminance: this.readback[1] };
  }

  render(renderer: THREE.WebGLRenderer, source: THREE.Texture, dt: number): void {
    this.logPass.material.uniforms.uSource.value = source;
    this.logPass.render(renderer, this.logLum);
    const next = 1 - this.current;
    const u = this.adaptPass.material.uniforms;
    u.uPrevious.value = this.targets[this.current].texture;
    u.uDelta.value = Math.min(dt, 0.25);
    u.uReset.value = this.reset ? 1 : 0;
    this.adaptPass.render(renderer, this.targets[next]);
    this.current = next;
    this.reset = false;
  }

  dispose(): void {
    this.logLum.dispose();
    for (const t of this.targets) t.dispose();
    this.logPass.dispose();
    this.adaptPass.dispose();
  }
}

// ---------------------------------------------------------------------------
// Scalable ambient obscurance (McGuire 2012) at half resolution, with normals
// reconstructed from depth, followed by a depth-aware separable blur.

const SSAO_FRAG = /* glsl */ `
uniform sampler2D uDepth;
uniform vec2 uTexel;       // of the depth texture
uniform vec4 uProjInfo;    // x,y scale; z,w offset (view-space reconstruction)
uniform float uNear;
uniform float uFar;
uniform float uRadius;     // meters
uniform float uIntensity;
uniform float uProjScale;  // pixels per meter at 1 m
uniform float uFrame;
varying vec2 vUv;

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
vec3 viewPos(vec2 uv) {
  float z = linearDepth(texture2D(uDepth, uv).r);
  return vec3((uv * uProjInfo.xy + uProjInfo.zw) * z, -z);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  float raw = texture2D(uDepth, vUv).r;
  if (raw >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 p = viewPos(vUv);
  vec3 px = viewPos(vUv + vec2(uTexel.x, 0.0));
  vec3 nx = viewPos(vUv - vec2(uTexel.x, 0.0));
  vec3 py = viewPos(vUv + vec2(0.0, uTexel.y));
  vec3 ny = viewPos(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(px.z - p.z) < abs(p.z - nx.z) ? px - p : p - nx;
  vec3 dy = abs(py.z - p.z) < abs(p.z - ny.z) ? py - p : p - ny;
  vec3 n = normalize(cross(dx, dy));
  float radiusPx = uProjScale * uRadius / -p.z;
  if (radiusPx < 1.0) { gl_FragColor = vec4(1.0); return; }
  float spin = ign(gl_FragCoord.xy + uFrame * 5.588238) * 6.2831853;
  const int SAMPLES = 12;
  float sum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float alpha = (float(i) + 0.5) / float(SAMPLES);
    float angle = alpha * 6.2831853 * 3.0 + spin;
    vec2 offset = vec2(cos(angle), sin(angle)) * alpha * radiusPx;
    vec3 q = viewPos(vUv + offset * uTexel);
    vec3 v = q - p;
    float vv = dot(v, v);
    float vn = dot(v, n);
    float f = max(uRadius * uRadius - vv, 0.0);
    sum += f * f * f * max((vn - 0.01 * -p.z) / (vv + 0.01), 0.0);
  }
  float r6 = pow(uRadius, 6.0);
  float ao = max(0.0, 1.0 - sum * uIntensity * 5.0 / (r6 * float(SAMPLES)));
  gl_FragColor = vec4(ao, 1.0, 1.0, 1.0);
}
`;

const AO_BLUR_FRAG = /* glsl */ `
uniform sampler2D uAO;
uniform sampler2D uDepth;
uniform vec2 uDir;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}
void main() {
  float center = linearDepth(texture2D(uDepth, vUv).r);
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + uDir * float(i);
    float d = linearDepth(texture2D(uDepth, uv).r);
    float w = exp(-float(i * i) / 8.0) * max(0.0, 1.0 - abs(d - center) / (center * 0.04 + 0.05));
    sum += texture2D(uAO, uv).r * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / max(wsum, 1e-4), 1.0, 1.0, 1.0);
}
`;

export class SSAOPass {
  private readonly aoTarget = createHdrTarget(1, 1);
  private readonly blurTarget = createHdrTarget(1, 1);
  private readonly aoPass = new FullscreenPass(
    createFullscreenMaterial({
      fragmentShader: SSAO_FRAG,
      uniforms: {
        uDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uProjInfo: { value: new THREE.Vector4() },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uRadius: { value: 1.4 },
        uIntensity: { value: 1.1 },
        uProjScale: { value: 500 },
        uFrame: { value: 0 },
      },
    }),
  );
  private readonly blurPass = new FullscreenPass(
    createFullscreenMaterial({
      fragmentShader: AO_BLUR_FRAG,
      uniforms: { uAO: { value: null }, uDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 } },
    }),
  );
  private frame = 0;

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width / 2));
    const h = Math.max(1, Math.floor(height / 2));
    this.aoTarget.setSize(w, h);
    this.blurTarget.setSize(w, h);
  }

  get texture(): THREE.Texture {
    return this.aoTarget.texture;
  }

  render(renderer: THREE.WebGLRenderer, depth: THREE.Texture, camera: THREE.PerspectiveCamera, fullWidth: number, fullHeight: number): void {
    this.frame = (this.frame + 1) % 64;
    const u = this.aoPass.material.uniforms;
    u.uDepth.value = depth;
    (u.uTexel.value as THREE.Vector2).set(1 / fullWidth, 1 / fullHeight);
    const p = camera.projectionMatrix.elements;
    // Reconstruct view xy from uv and linear depth: xy = (uv * 2 - 1 + offset) / (proj) * z
    (u.uProjInfo.value as THREE.Vector4).set(2 / p[0], 2 / p[5], (p[8] - 1) / p[0], (p[9] - 1) / p[5]);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uProjScale.value = (fullHeight / 2) * p[5];
    u.uFrame.value = this.frame;
    this.aoPass.render(renderer, this.aoTarget);
    const b = this.blurPass.material.uniforms;
    b.uDepth.value = depth;
    b.uNear.value = camera.near;
    b.uFar.value = camera.far;
    b.uAO.value = this.aoTarget.texture;
    (b.uDir.value as THREE.Vector2).set(1 / this.aoTarget.width, 0);
    this.blurPass.render(renderer, this.blurTarget);
    b.uAO.value = this.blurTarget.texture;
    (b.uDir.value as THREE.Vector2).set(0, 1 / this.aoTarget.height);
    this.blurPass.render(renderer, this.aoTarget);
  }

  dispose(): void {
    this.aoTarget.dispose();
    this.blurTarget.dispose();
    this.aoPass.dispose();
    this.blurPass.dispose();
  }
}

// ---------------------------------------------------------------------------
// Crepuscular rays: sky-mask brightness around the sun, radially blurred.

const GODRAY_MASK_FRAG = /* glsl */ `
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uSunUv;
uniform float uAspect;
varying vec2 vUv;
void main() {
  float sky = step(0.99999, texture2D(uDepth, vUv).r);
  vec3 c = texture2D(uColor, vUv).rgb;
  vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
  float falloff = exp(-dot(d, d) * 5.0);
  float lum = min(dot(c, vec3(0.2126, 0.7152, 0.0722)), 12.0);
  gl_FragColor = vec4(c / max(lum, 1e-4) * min(lum, 12.0) * sky * falloff, 1.0);
}
`;

const GODRAY_BLUR_FRAG = /* glsl */ `
uniform sampler2D uMask;
uniform vec2 uSunUv;
uniform float uDensity;
varying vec2 vUv;
void main() {
  const int SAMPLES = 40;
  vec2 delta = (vUv - uSunUv) * uDensity / float(SAMPLES);
  vec2 uv = vUv;
  vec3 sum = vec3(0.0);
  float decay = 1.0;
  for (int i = 0; i < SAMPLES; i++) {
    uv -= delta;
    sum += texture2D(uMask, uv).rgb * decay;
    decay *= 0.965;
  }
  gl_FragColor = vec4(sum / float(SAMPLES), 1.0);
}
`;

export class GodRaysPass {
  private readonly maskTarget = createHdrTarget(1, 1);
  private readonly rayTarget = createHdrTarget(1, 1);
  private readonly maskPass = new FullscreenPass(
    createFullscreenMaterial({
      fragmentShader: GODRAY_MASK_FRAG,
      uniforms: { uColor: { value: null }, uDepth: { value: null }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 } },
    }),
  );
  private readonly blurPass = new FullscreenPass(
    createFullscreenMaterial({
      fragmentShader: GODRAY_BLUR_FRAG,
      uniforms: { uMask: { value: null }, uSunUv: { value: new THREE.Vector2() }, uDensity: { value: 0.9 } },
    }),
  );

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width / 4));
    const h = Math.max(1, Math.floor(height / 4));
    this.maskTarget.setSize(w, h);
    this.rayTarget.setSize(w, h);
  }

  get texture(): THREE.Texture {
    return this.rayTarget.texture;
  }

  render(renderer: THREE.WebGLRenderer, color: THREE.Texture, depth: THREE.Texture, sunUv: THREE.Vector2, aspect: number): void {
    const m = this.maskPass.material.uniforms;
    m.uColor.value = color;
    m.uDepth.value = depth;
    (m.uSunUv.value as THREE.Vector2).copy(sunUv);
    m.uAspect.value = aspect;
    this.maskPass.render(renderer, this.maskTarget);
    const b = this.blurPass.material.uniforms;
    b.uMask.value = this.maskTarget.texture;
    (b.uSunUv.value as THREE.Vector2).copy(sunUv);
    this.blurPass.render(renderer, this.rayTarget);
  }

  dispose(): void {
    this.maskTarget.dispose();
    this.rayTarget.dispose();
    this.maskPass.dispose();
    this.blurPass.dispose();
  }
}
