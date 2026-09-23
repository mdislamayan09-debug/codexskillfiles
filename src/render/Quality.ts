export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

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
  clouds: 0 | 1 | 2;
  /** Terrain grid quads per CDLOD node side (finest spacing = 32 m / N). */
  terrainGrid: number;
  grassDensity: number;
  grassRadius: number;
  vegetationDistance: number;
  impostorDistance: number;
  farPlane: number;
}

export const QUALITY_PRESETS: Record<QualityName, QualitySettings> = {
  low: {
    name: 'low',
    renderScale: 0.72,
    maxDpr: 1,
    msaa: 0,
    shadowMapSize: 1024,
    shadowCascades: 2,
    shadowDistance: 140,
    ssao: false,
    godRays: false,
    bloom: true,
    clouds: 0,
    terrainGrid: 16,
    grassDensity: 0.3,
    grassRadius: 26,
    vegetationDistance: 420,
    impostorDistance: 90,
    farPlane: 4200,
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
    clouds: 1,
    terrainGrid: 32,
    grassDensity: 0.6,
    grassRadius: 38,
    vegetationDistance: 650,
    impostorDistance: 130,
    farPlane: 5500,
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
    clouds: 2,
    terrainGrid: 32,
    grassDensity: 1,
    grassRadius: 52,
    vegetationDistance: 900,
    impostorDistance: 170,
    farPlane: 7000,
  },
  ultra: {
    name: 'ultra',
    renderScale: 1,
    maxDpr: 2,
    msaa: 4,
    shadowMapSize: 4096,
    shadowCascades: 4,
    shadowDistance: 480,
    ssao: true,
    godRays: true,
    bloom: true,
    clouds: 2,
    terrainGrid: 32,
    grassDensity: 1.4,
    grassRadius: 64,
    vegetationDistance: 1200,
    impostorDistance: 230,
    farPlane: 9000,
  },
};

export function qualityFromName(name: string | null | undefined): QualitySettings {
  if (name && name in QUALITY_PRESETS) return { ...QUALITY_PRESETS[name as QualityName] };
  return { ...QUALITY_PRESETS.high };
}
