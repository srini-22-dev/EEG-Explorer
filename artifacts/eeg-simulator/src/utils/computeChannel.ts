import { ChannelDef, ALL_ELECTRODES } from './montages';
import { getECGVoltage } from './eegGenerator';

/**
 * Common average reference: the instantaneous mean over every scalp electrode.
 *
 * Every CAR channel in a montage subtracts the same value at a given sample, so
 * this is computed once per sample by the caller and passed in. Deriving it
 * inside computeChannelVoltage instead made the per-sample cost
 * O(channels x electrodes) where O(electrodes) is enough — at 21 channels
 * against 21 electrodes that is the same average recomputed 21 times.
 */
export function commonAverage(allVoltages: Record<string, number>): number {
  let sum = 0;
  for (const el of ALL_ELECTRODES) sum += allVoltages[el] ?? 0;
  return sum / ALL_ELECTRODES.length;
}

/**
 * One channel's displayed voltage: active input minus its reference.
 *
 * `avgRef` is the value from `commonAverage` for this same sample. It is only
 * read for AVG-referenced channels, but is required rather than optional so a
 * caller cannot silently fall back to a zero reference.
 */
export function computeChannelVoltage(
  channel: ChannelDef,
  t: number,
  allVoltages: Record<string, number>,
  avgRef: number,
): number {
  if (channel.active === 'ECG') return getECGVoltage(t);

  const vActive = allVoltages[channel.active] ?? 0;
  let vRef = 0;

  if (channel.reference === 'AVG') {
    vRef = avgRef;
  } else if (channel.reference === 'IPSI' || channel.reference === 'CONTRA') {
    vRef = 0;
  } else if (channel.reference) {
    vRef = allVoltages[channel.reference] ?? 0;
  }

  return vActive - vRef;
}
