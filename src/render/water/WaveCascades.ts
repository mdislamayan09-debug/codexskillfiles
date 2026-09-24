import * as THREE from 'three';
import { createRng } from '../../core/rng';

// Ocean waves as three tileable cascades. Each cascade is a periodic domain
// of `size` meters whose wave vectors sit on the domain's lattice, so the sum
// of a few dozen spectrum-sampled waves tiles perfectly. Every frame the GPU
// evaluates the sums into displacement + derivative textures (with mips for
// filtering); the CPU mirrors the same waves for gameplay height queries.

export interface CascadeConfig {
  size: number;
  minWavelength: number;
  maxWavelength: number;
}

/** Non-commensurate domain sizes hide the tiling of each band. */
export const CASCADES: readonly CascadeConfig[] = [
  { size: 211, minWavelength: 19, maxWavelength: 211 },
  { size: 37.3, minWavelength: 2.9, maxWavelength: 19 },
  { size: 5.17, minWavelength: 0.32, maxWavelength: 2.9 },
];

export const MAX_WAVES = 64;
const GRAVITY = 9.81;

export interface Wave {
  kx: number;
  kz: number;
  amplitude: number;
  phase0: number;
  omega: number;
}

/**
 * Samples a Phillips spectrum on the cascade lattice (deterministic), keeps
 * the most energetic `count` waves, amplitudes normalized so all cascades
 * together have a significant wave height of 1 m.
 */
export function buildCascadeWaves(windDirX: number, windDirZ: number, windSpeed: number, count: number, seed = 0x5ea): Wave[][] {
  const rng = createRng(seed);
  const len = Math.hypot(windDirX, windDirZ) || 1;
  const wx = windDirX / len;
  const wz = windDirZ / len;
  const L = (windSpeed * windSpeed) / GRAVITY;
  const gaussian = () => {
    const u = Math.max(1e-6, rng());
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const cascades: Wave[][] = [];
  let variance = 0;
  for (const cfg of CASCADES) {
    const dk = (2 * Math.PI) / cfg.size;
    const kMin = (2 * Math.PI) / cfg.maxWavelength;
    const kMax = (2 * Math.PI) / cfg.minWavelength;
    const nMax = Math.ceil(kMax / dk);
    const candidates: Wave[] = [];
    for (let n = -nMax; n <= nMax; n += 1) {
      for (let m = -nMax; m <= nMax; m += 1) {
        const kx = n * dk;
        const kz = m * dk;
        const k = Math.hypot(kx, kz);
        if (k < kMin || k > kMax) continue;
        const cosW = (kx * wx + kz * wz) / k;
        // Directional spreading narrows at the spectral peak and broadens for
        // short waves, so ripples cross-hatch instead of running in parallel.
        const kPeak = 1 / (L * Math.SQRT2);
        const spread = 6 - 5.2 * Math.min(1, Math.max(0, Math.log2(k / kPeak) / 5));
        let directional = Math.pow(Math.abs(cosW), spread);
        if (cosW < 0) directional *= 0.12;
        const p = (Math.exp(-1 / ((k * L) ** 2)) / k ** 4) * (0.08 + directional);
        const r = Math.hypot(gaussian(), gaussian()) / Math.SQRT2;
        const amplitude = Math.sqrt(2 * p * dk * dk) * r;
        candidates.push({ kx, kz, amplitude, phase0: rng() * Math.PI * 2, omega: Math.sqrt(GRAVITY * k) });
      }
    }
    candidates.sort((a, b) => b.amplitude - a.amplitude);
    const chosen = candidates.slice(0, count);
    for (const w of chosen) variance += (w.amplitude * w.amplitude) / 2;
    cascades.push(chosen);
  }
  // Significant wave height Hs = 4σ → normalize to 1 m.
  const scale = 1 / (4 * Math.sqrt(variance));
  for (const waves of cascades) for (const w of waves) w.amplitude *= scale;
  return cascades;
}

const SIM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const SIM_FRAG = /* glsl */ `
precision highp float;
#define MAX_WAVES ${MAX_WAVES}
uniform vec4 uWaves[MAX_WAVES];
uniform int uCount;
uniform float uSize;
uniform float uChop;
varying vec2 vUv;
layout(location = 0) out vec4 oDisp;
layout(location = 1) out vec4 oDeriv;
void main() {
  vec2 x = vUv * uSize;
  vec3 d = vec3(0.0);
  float hx = 0.0, hz = 0.0, dxx = 0.0, dzz = 0.0, dxz = 0.0;
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uCount) break;
    vec4 w = uWaves[i];
    float kl = length(w.xy);
    vec2 kh = w.xy / kl;
    float th = dot(w.xy, x) + w.w;
    float s = sin(th);
    float c = cos(th);
    float a = w.z;
    d.y += a * c;
    d.xz -= kh * (a * s * uChop);
    hx -= a * w.x * s;
    hz -= a * w.y * s;
    float ac = a * c * uChop;
    dxx -= kh.x * w.x * ac;
    dzz -= kh.y * w.y * ac;
    dxz -= kh.x * w.y * ac;
  }
  oDisp = vec4(d, dxz);
  oDeriv = vec4(hx, hz, dxx, dzz);
}
`;

export class WaveCascades {
  /** Per cascade: [displacement (xyz, dDx/dz), derivatives (dh/dx, dh/dz, dDx/dx, dDz/dz)]. */
  readonly targets: THREE.WebGLRenderTarget[] = [];
  readonly waves: Wave[][];
  readonly sizes = new THREE.Vector3();
  /** Horizontal displacement factor (choppiness). */
  chop = 0.9;
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly mesh: THREE.Mesh;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private time = 0;

  constructor(readonly resolution: number, readonly wavesPerCascade: number, windDirX = 0.86, windDirZ = 0.5) {
    this.waves = buildCascadeWaves(windDirX, windDirZ, 11, wavesPerCascade);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(geometry);
    this.mesh.frustumCulled = false;
    CASCADES.forEach((cfg, i) => {
      const target = new THREE.WebGLRenderTarget(resolution, resolution, {
        count: 2,
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: true,
        depthBuffer: false,
        stencilBuffer: false,
      });
      for (const texture of target.textures) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = 4;
      }
      this.targets.push(target);
      const uniforms = {
        uWaves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },
        uCount: { value: this.waves[i].length },
        uSize: { value: cfg.size },
        uChop: { value: this.chop },
      };
      this.materials.push(
        new THREE.ShaderMaterial({
          glslVersion: THREE.GLSL3,
          vertexShader: SIM_VERT,
          fragmentShader: SIM_FRAG,
          uniforms,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
    });
    this.sizes.set(CASCADES[0].size, CASCADES[1].size, CASCADES[2].size);
  }

  /** Slope variance of each cascade at unit amplitude (for filtered roughness). */
  slopeVariance(): THREE.Vector3 {
    const v = [0, 0, 0];
    this.waves.forEach((waves, c) => {
      for (const w of waves) v[c] += ((w.kx * w.kx + w.kz * w.kz) * w.amplitude * w.amplitude) / 2;
    });
    return new THREE.Vector3(v[0], v[1], v[2]);
  }

  displacement(i: number): THREE.Texture {
    return this.targets[i].textures[0];
  }

  derivatives(i: number): THREE.Texture {
    return this.targets[i].textures[1];
  }

  /** Evaluate all cascades on the GPU for `time` (seconds). */
  update(renderer: THREE.WebGLRenderer, time: number): void {
    this.time = time;
    const previous = renderer.getRenderTarget();
    for (let c = 0; c < this.targets.length; c += 1) {
      const material = this.materials[c];
      const packed = material.uniforms.uWaves.value as THREE.Vector4[];
      const waves = this.waves[c];
      for (let i = 0; i < waves.length; i += 1) {
        const w = waves[i];
        // Phase in double precision so long sessions never lose precision.
        const phase = (w.phase0 - w.omega * time) % (Math.PI * 2);
        packed[i].set(w.kx, w.kz, w.amplitude, phase);
      }
      material.uniforms.uChop.value = this.chop;
      this.mesh.material = material;
      renderer.setRenderTarget(this.targets[c]);
      renderer.render(this.mesh, this.camera);
    }
    renderer.setRenderTarget(previous);
  }

  /**
   * Surface height (m, relative to rest level) of the given cascades at a
   * world point, for buoyancy and camera checks. `amplitudes` scales each
   * cascade like the shader does.
   */
  heightAt(x: number, z: number, amplitudes: readonly number[], time = this.time): number {
    let h = 0;
    for (let c = 0; c < this.waves.length; c += 1) {
      const scale = amplitudes[c] ?? 0;
      if (scale === 0) continue;
      let sum = 0;
      for (const w of this.waves[c]) sum += w.amplitude * Math.cos(w.kx * x + w.kz * z + w.phase0 - w.omega * time);
      h += sum * scale;
    }
    return h;
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    for (const m of this.materials) m.dispose();
    this.mesh.geometry.dispose();
  }
}
