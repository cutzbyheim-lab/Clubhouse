import type { DistanceUnit, SpeedUnit } from '../schemas/player';

export const M_PER_YD = 0.9144;
const MPH_PER_MPS = 2.2369363;
const KMH_PER_MPS = 3.6;

export const toDistance = (m: number, unit: DistanceUnit): number => (unit === 'yards' ? m / M_PER_YD : m);
export const fromDistance = (v: number, unit: DistanceUnit): number => (unit === 'yards' ? v * M_PER_YD : v);
export const distanceSuffix = (unit: DistanceUnit): string => (unit === 'yards' ? 'yd' : 'm');

export const toSpeed = (mps: number, unit: SpeedUnit): number =>
  unit === 'mph' ? mps * MPH_PER_MPS : unit === 'kmh' ? mps * KMH_PER_MPS : mps;
export const speedSuffix = (unit: SpeedUnit): string => (unit === 'mph' ? 'mph' : unit === 'kmh' ? 'km/h' : 'm/s');
