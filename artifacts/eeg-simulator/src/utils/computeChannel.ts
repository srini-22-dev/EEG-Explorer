import { Electrode, ChannelDef, ALL_ELECTRODES } from './montages';
import { getElectrodeVoltage, SimSettings } from './eegGenerator';

export type EEGDataPoint = {
  t: number;
  values: number[]; // One value per channel
  popElectrode?: Electrode | null;
};

// Calculate channel value based on active/reference
export function computeChannelVoltage(
  channel: ChannelDef,
  t: number,
  settings: SimSettings,
  allVoltages: Record<string, number>
): number {
  const vActive = allVoltages[channel.active];
  let vRef = 0;

  if (channel.reference === 'AVG') {
    let sum = 0;
    for (const el of ALL_ELECTRODES) {
      sum += allVoltages[el];
    }
    vRef = sum / ALL_ELECTRODES.length;
  } else if (channel.reference === 'IPSI' || channel.reference === 'CONTRA') {
    // Should be resolved in the montage definition already, so this case shouldn't hit
    vRef = 0; 
  } else if (channel.reference) {
    vRef = allVoltages[channel.reference];
  }

  return vActive - vRef;
}
