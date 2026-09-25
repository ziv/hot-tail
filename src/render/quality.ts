export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  level: QualityLevel;
  maxDpr: number;
  bloom: boolean;
  msaa: number;
  fxaa: boolean;
  particleDensity: number;
  waterDetail: boolean;
  clouds: boolean;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low',
    maxDpr: 1,
    bloom: false,
    msaa: 0,
    fxaa: true,
    particleDensity: 0.5,
    waterDetail: false,
    clouds: false,
  },
  medium: {
    level: 'medium',
    maxDpr: 1.5,
    bloom: true,
    msaa: 0,
    fxaa: true,
    particleDensity: 0.75,
    waterDetail: true,
    clouds: true,
  },
  high: {
    level: 'high',
    maxDpr: 2,
    bloom: true,
    msaa: 4,
    fxaa: false,
    particleDensity: 1,
    waterDetail: true,
    clouds: true,
  },
};

/** Coarse default until the M3 auto-benchmark (B15) exists. */
export function defaultQuality(): QualityLevel {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 'medium' : 'high';
}
