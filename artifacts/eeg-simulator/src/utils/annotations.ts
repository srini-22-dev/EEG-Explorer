import { ChannelGroup } from './montages';

export type AnnotationDef = {
  patternId: string;
  text: string;
  targetRegion: ChannelGroup | 'all';
  arrowDirection: 'up' | 'down' | 'left' | 'right';
};

export const EDUCATIONAL_ANNOTATIONS: Record<string, AnnotationDef> = {
  '3hz-gsw': {
    patternId: '3hz-gsw',
    text: 'Note: spike-wave complexes at 3 Hz with frontal predominance',
    targetRegion: 'all',
    arrowDirection: 'up',
  },
  'focal-spikes-lt': {
    patternId: 'focal-spikes-lt',
    text: 'Phase reversal at T3 — look at channels Fp1-F7/F7-T3 vs T3-T5',
    targetRegion: 'left-temporal',
    arrowDirection: 'right',
  },
  'blink': {
    patternId: 'blink',
    text: 'Corneoretinal dipole artifact — largest at Fp1/Fp2',
    targetRegion: 'all',
    arrowDirection: 'left',
  },
  'k-complex': {
    patternId: 'k-complex',
    text: 'K-complex: Sharp negative wave followed by slower positive wave',
    targetRegion: 'central',
    arrowDirection: 'down',
  },
  'spindles': {
    patternId: 'spindles',
    text: 'Sleep spindle: 12-14 Hz burst, central maximum',
    targetRegion: 'central',
    arrowDirection: 'down',
  }
};
