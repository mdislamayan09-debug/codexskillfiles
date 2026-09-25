export type QualityName = 'low' | 'medium' | 'high' | 'extra' | 'max';

export const QUALITY_ORDER: readonly QualityName[] = ['low', 'medium', 'high', 'extra', 'max'];

export const QUALITY_LABELS: Record<QualityName, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  extra: 'Extra High',
  max: 'Max',
};

export interface QualitySettings {
  name: QualityName;
  /** Scene resolution relative to the canvas (at most `maxDpr` pixels per CSS pixel). */
  renderScale: number;
  /** Dynamic resolution never goes below this share of the canvas. */
  minRenderScale: number;
  maxDpr: number;
  /** Multisampling. Off in every preset: temporal AA does the job better and cheaper. */
  msaa: number;
  shadowMapSize: number;
  shadowCascades: number;
  shadowDistance: number;
  ssao: boolean;
  godRays: boolean;
  bloom: boolean;
  /** 0 off, otherwise raymarch steps for volumetric clouds. */
  cloudSteps: number;
  /** Cloud buffer size divisor per axis (4 = 1/16 of the pixels). */
  cloudDivisor: number;
  /** Terrain grid quads per CDLOD node side (finest spacing = 32 m / N). */
  terrainGrid: number;
  /** Distance where terrain switches to its cheap far-field shading. */
  terrainDetailDistance: number;
  grassDensity: number;
  grassRadius: number;
  vegetationDistance: number;
  impostorDistance: number;
  farPlane: number;
  anisotropy: number;
  /** Sea surface grid vertices per side. */
  waterGrid: number;
  /** Screen-space reflection march steps on water (0 = sky/env only). */
  waterReflectionSteps: number;
  /** Wave cascade texture size and spectrum samples per cascade. */
  waveResolution: number;
  wavesPerCascade: number;
  /**
   * Geometry budget, 1 = the preset as designed. Integrated graphics get less
   * (fitToGpu): the same effects, fewer blades, trees and shadow casters.
   */
  budget: number;
}

export const QUALITY_PRESETS: Record<QualityName, QualitySettings> = {
  low: {
    name: 'low',
    renderScale: 0.75,
    minRenderScale: 0.5,
    maxDpr: 1,
    msaa: 0,
    shadowMapSize: 1024,
    shadowCascades: 2,
    shadowDistance: 140,
    ssao: false,
    godRays: false,
    bloom: true,
    cloudSteps: 0,
    cloudDivisor: 4,
    terrainGrid: 16,
    terrainDetailDistance: 220,
    grassDensity: 0.35,
    grassRadius: 26,
    vegetationDistance: 420,
    impostorDistance: 90,
    farPlane: 4200,
    anisotropy: 2,
    waterGrid: 128,
    waterReflectionSteps: 0,
    waveResolution: 128,
    wavesPerCascade: 32,
    budget: 1,
  },
  medium: {
    name: 'medium',
    renderScale: 0.85,
    minRenderScale: 0.5,
    maxDpr: 1.25,
    msaa: 0,
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowDistance: 220,
    ssao: true,
    godRays: false,
    bloom: true,
    cloudSteps: 36,
    cloudDivisor: 4,
    terrainGrid: 32,
    terrainDetailDistance: 320,
    grassDensity: 0.65,
    grassRadius: 38,
    vegetationDistance: 650,
    impostorDistance: 130,
    farPlane: 5500,
    anisotropy: 4,
    waterGrid: 160,
    waterReflectionSteps: 16,
    waveResolution: 256,
    wavesPerCascade: 40,
    budget: 1,
  },
  high: {
    name: 'high',
    renderScale: 1,
    minRenderScale: 0.55,
    maxDpr: 1.5,
    msaa: 0,
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowDistance: 320,
    ssao: true,
    godRays: true,
    bloom: true,
    cloudSteps: 56,
    cloudDivisor: 3,
    terrainGrid: 32,
    terrainDetailDistance: 420,
    grassDensity: 1,
    grassRadius: 56,
    vegetationDistance: 900,
    impostorDistance: 170,
    farPlane: 7000,
    anisotropy: 8,
    waterGrid: 200,
    waterReflectionSteps: 24,
    waveResolution: 256,
    wavesPerCascade: 48,
    budget: 1,
  },
  extra: {
    name: 'extra',
    renderScale: 1,
    minRenderScale: 0.6,
    maxDpr: 2,
    msaa: 0,
    shadowMapSize: 4096,
    shadowCascades: 4,
    shadowDistance: 480,
    ssao: true,
    godRays: true,
    bloom: true,
    cloudSteps: 72,
    cloudDivisor: 2,
    terrainGrid: 32,
    terrainDetailDistance: 520,
    grassDensity: 1.35,
    grassRadius: 70,
    vegetationDistance: 1200,
    impostorDistance: 230,
    farPlane: 9000,
    anisotropy: 16,
    waterGrid: 256,
    waterReflectionSteps: 32,
    waveResolution: 256,
    wavesPerCascade: 56,
    budget: 1,
  },
  max: {
    name: 'max',
    renderScale: 1,
    minRenderScale: 0.6,
    maxDpr: 3,
    msaa: 0,
    shadowMapSize: 4096,
    shadowCascades: 4,
    shadowDistance: 650,
    ssao: true,
    godRays: true,
    bloom: true,
    cloudSteps: 96,
    cloudDivisor: 2,
    terrainGrid: 32,
    terrainDetailDistance: 650,
    grassDensity: 1.8,
    grassRadius: 85,
    vegetationDistance: 1600,
    impostorDistance: 300,
    farPlane: 11000,
    anisotropy: 16,
    waterGrid: 320,
    waterReflectionSteps: 40,
    waveResolution: 256,
    wavesPerCascade: 64,
    budget: 1,
  },
};

export function qualityFromName(name: string | null | undefined): QualitySettings {
  if (name === 'ultra') name = 'extra';
  if (name && name in QUALITY_PRESETS) return { ...QUALITY_PRESETS[name as QualityName] };
  return { ...QUALITY_PRESETS.high };
}

/** Picks a starting preset from the GPU string; the benchmark can refine it. */
export function suggestQuality(renderer: string): QualityName {
  const r = renderer.toLowerCase();
  if (r.includes('swiftshader') || r.includes('llvmpipe') || r.includes('software')) return 'low';
  if (/apple m\d+ (max|ultra)/.test(r)) return 'max';
  if (/apple m\d+ pro/.test(r)) return 'extra';
  if (r.includes('apple m') || r.includes('apple gpu')) return 'high';
  if (/rtx [34]0[789]0|rtx 50|rx 7[89]00|rx 9070/.test(r)) return 'max';
  if (/rtx|radeon rx [67]/.test(r)) return 'extra';
  if (r.includes('intel') && !r.includes('arc')) return 'medium';
  return 'high';
}

/** Integrated graphics share memory and power with the CPU. */
export function isIntegratedGpu(renderer: string): boolean {
  const r = renderer.toLowerCase();
  if (r.includes('intel')) return !r.includes('arc');
  return /radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|mali|adreno|powervr/.test(r);
}

/**
 * Fits a preset's geometry to the graphics card. On integrated graphics every
 * effect stays (volumetric clouds, god rays, ambient occlusion, temporal AA)
 * but the heaviest geometry is cut: grass blades, how far trees keep their
 * full shape, shadow casters and cascades, cloud march steps and the sea's
 * mesh. Dynamic resolution then holds the frame rate. `budget` is also read
 * by the tree and prop streaming.
 */
export function fitToGpu(q: QualitySettings, renderer: string, override?: number): QualitySettings {
  const budget = override ?? (isIntegratedGpu(renderer) ? 0.4 : 1);
  if (budget >= 1) return q;
  const b = Math.max(0.2, budget);
  return {
    ...q,
    budget: b,
    grassDensity: q.grassDensity * Math.min(1, b * 1.1),
    grassRadius: Math.round(q.grassRadius * Math.min(1, 0.25 + b * 0.6)),
    impostorDistance: Math.round(q.impostorDistance * Math.min(1, b * 1.1)),
    vegetationDistance: Math.round(q.vegetationDistance * Math.min(1, 0.35 + b * 0.5)),
    // Two cascades out to under 300 m: every caster is drawn once per cascade.
    shadowCascades: Math.min(q.shadowCascades, 2),
    shadowMapSize: Math.min(q.shadowMapSize, 1536),
    shadowDistance: Math.round(Math.min(280, q.shadowDistance * Math.min(1, 0.4 + b * 0.6))),
    cloudSteps: q.cloudSteps > 0 ? Math.max(28, Math.round(q.cloudSteps * Math.min(1, b) * 0.8)) : 0,
    cloudDivisor: Math.max(q.cloudDivisor, 4),
    terrainDetailDistance: Math.round(q.terrainDetailDistance * Math.min(1, 0.4 + b * 0.6)),
    waterGrid: Math.round(q.waterGrid * Math.min(1, 0.5 + b * 0.5)),
    waterReflectionSteps: Math.round(q.waterReflectionSteps * Math.min(1, 0.4 + b * 0.6)),
    waveResolution: Math.min(q.waveResolution, 128),
    minRenderScale: Math.min(q.minRenderScale, 0.42),
  };
}
