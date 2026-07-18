import { Electrode, ChannelDef, ALL_ELECTRODES } from './montages';
import { SimSettings, getECGVoltage } from './eegGenerator';

// Calculate channel value (µV) for a single channel at time t
export function computeChannelVoltage(
  channel: ChannelDef,
  t: number,
  _settings: SimSettings,
  allVoltages: Record<string, number>
): number {
  // ECG is a special synthetic channel
  if (channel.active === 'ECG') {
    return getECGVoltage(t);
  }

  const vActive = allVoltages[channel.active] ?? 0;
  let vRef = 0;

  if (channel.reference === 'AVG') {
    let sum = 0;
    for (const el of ALL_ELECTRODES) sum += allVoltages[el] ?? 0;
    vRef = sum / ALL_ELECTRODES.length;
  } else if (channel.reference === 'IPSI' || channel.reference === 'CONTRA') {
    vRef = 0; // already resolved at montage definition
  } else if (channel.reference) {
    vRef = allVoltages[channel.reference] ?? 0;
  }

  return vActive - vRef;
}
