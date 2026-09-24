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
  /** Internal resolution relative to the canvas. */
  renderScale: number;
  maxDpr: number;
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
}

export const QUALITY_PRESETS: Record<QualityName, QualitySettings> = {
  low: {
    name: 'low',
    renderScale: 0.7,
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
  },
  medium: {
    name: 'medium',
    renderScale: 0.85,
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
  },
  high: {
    name: 'high',
    renderScale: 1,
    maxDpr: 1.5,
    msaa: 4,
    shadowMapSize: 2048,
    shadowCascades: 3,
    shadowDistance: 320,
    ssao: true,
    godRays: true,
    bloom: true,
    cloudSteps: 56,
    cloudDivisor: 4,
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
  },
  extra: {
    name: 'extra',
    renderScale: 1,
    maxDpr: 2,
    msaa: 4,
    shadowMapSize: 4096,
    shadowCascades: 4,
    shadowDistance: 480,
    ssao: true,
    godRays: true,
    bloom: true,
    cloudSteps: 72,
    cloudDivisor: 3,
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
  },
  max: {
    name: 'max',
    renderScale: 1,
    maxDpr: 3,
    msaa: 4,
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
  if (/apple m\d (max|ultra)/.test(r)) return 'extra';
  if (/apple m\d pro/.test(r)) return 'extra';
  if (r.includes('apple m') || r.includes('apple gpu')) return 'high';
  if (/rtx [34]0[789]0|rtx 50|rx 7[89]00|rx 9070/.test(r)) return 'max';
  if (/rtx|radeon rx [67]/.test(r)) return 'extra';
  if (r.includes('intel') && !r.includes('arc')) return 'medium';
  return 'high';
}
