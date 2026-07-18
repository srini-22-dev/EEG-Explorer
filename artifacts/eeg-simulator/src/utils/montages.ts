export type Electrode =
  | 'Fp1' | 'Fp2'
  | 'F7' | 'F3' | 'Fz' | 'F4' | 'F8'
  | 'T3' | 'C3' | 'Cz' | 'C4' | 'T4'
  | 'T5' | 'P3' | 'Pz' | 'P4' | 'T6'
  | 'O1' | 'O2'
  | 'A1' | 'A2'; // Ear references

export type ChannelGroup =
  | 'left-paramedian'
  | 'right-paramedian'
  | 'left-temporal'
  | 'right-temporal'
  | 'central'
  | 'ecg';

export const ALL_ELECTRODES: Electrode[] = [
  'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
  'T3', 'C3', 'Cz', 'C4', 'T4', 'T5', 'P3',
  'Pz', 'P4', 'T6', 'O1', 'O2'
];

export type ChannelDef = {
  label: string;
  active: Electrode | 'ECG';
  reference?: Electrode | 'AVG' | 'CONTRA' | 'IPSI';
  group: ChannelGroup;
};

export type Montage = {
  id: string;
  name: string;
  channels: ChannelDef[];
};

/** Colour assigned to each chain group */
export const GROUP_COLORS: Record<ChannelGroup, string> = {
  'left-paramedian':  '#1a4fa0',  // dark blue
  'right-paramedian': '#8b1a1a',  // dark red
  'left-temporal':    '#1a4fa0',  // dark blue
  'right-temporal':   '#8b1a1a',  // dark red
  'central':          '#1a3a1a',  // very dark green/black
  'ecg':              '#1b6b1b',  // forest green
};

export const MONTAGES: Record<string, Montage> = {
  'bipolar-ap': {
    id: 'bipolar-ap',
    name: 'Bipolar – Antero-posterior',
    channels: [
      // Left paramedian chain
      { label: 'Fp1-F3', active: 'Fp1', reference: 'F3', group: 'left-paramedian' },
      { label: 'F3-C3',  active: 'F3',  reference: 'C3', group: 'left-paramedian' },
      { label: 'C3-P3',  active: 'C3',  reference: 'P3', group: 'left-paramedian' },
      { label: 'P3-O1',  active: 'P3',  reference: 'O1', group: 'left-paramedian' },
      // Right paramedian chain
      { label: 'Fp2-F4', active: 'Fp2', reference: 'F4', group: 'right-paramedian' },
      { label: 'F4-C4',  active: 'F4',  reference: 'C4', group: 'right-paramedian' },
      { label: 'C4-P4',  active: 'C4',  reference: 'P4', group: 'right-paramedian' },
      { label: 'P4-O2',  active: 'P4',  reference: 'O2', group: 'right-paramedian' },
      // Left temporal chain
      { label: 'Fp1-F7', active: 'Fp1', reference: 'F7', group: 'left-temporal' },
      { label: 'F7-T3',  active: 'F7',  reference: 'T3', group: 'left-temporal' },
      { label: 'T3-T5',  active: 'T3',  reference: 'T5', group: 'left-temporal' },
      { label: 'T5-O1',  active: 'T5',  reference: 'O1', group: 'left-temporal' },
      // Right temporal chain
      { label: 'Fp2-F8', active: 'Fp2', reference: 'F8', group: 'right-temporal' },
      { label: 'F8-T4',  active: 'F8',  reference: 'T4', group: 'right-temporal' },
      { label: 'T4-T6',  active: 'T4',  reference: 'T6', group: 'right-temporal' },
      { label: 'T6-O2',  active: 'T6',  reference: 'O2', group: 'right-temporal' },
      // Central chain
      { label: 'Fz-Cz',  active: 'Fz',  reference: 'Cz', group: 'central' },
      { label: 'Cz-Pz',  active: 'Cz',  reference: 'Pz', group: 'central' },
      // ECG
      { label: 'ECG',    active: 'ECG', group: 'ecg' },
    ]
  },
  'bipolar-transverse': {
    id: 'bipolar-transverse',
    name: 'Bipolar – Transverse',
    channels: [
      { label: 'Fp1-Fp2', active: 'Fp1', reference: 'Fp2', group: 'central' },
      { label: 'F7-F3',   active: 'F7',  reference: 'F3',  group: 'left-temporal' },
      { label: 'F3-Fz',   active: 'F3',  reference: 'Fz',  group: 'left-paramedian' },
      { label: 'Fz-F4',   active: 'Fz',  reference: 'F4',  group: 'right-paramedian' },
      { label: 'F4-F8',   active: 'F4',  reference: 'F8',  group: 'right-temporal' },
      { label: 'T3-C3',   active: 'T3',  reference: 'C3',  group: 'left-temporal' },
      { label: 'C3-Cz',   active: 'C3',  reference: 'Cz',  group: 'left-paramedian' },
      { label: 'Cz-C4',   active: 'Cz',  reference: 'C4',  group: 'central' },
      { label: 'C4-T4',   active: 'C4',  reference: 'T4',  group: 'right-temporal' },
      { label: 'T5-P3',   active: 'T5',  reference: 'P3',  group: 'left-temporal' },
      { label: 'P3-Pz',   active: 'P3',  reference: 'Pz',  group: 'left-paramedian' },
      { label: 'Pz-P4',   active: 'Pz',  reference: 'P4',  group: 'right-paramedian' },
      { label: 'P4-T6',   active: 'P4',  reference: 'T6',  group: 'right-temporal' },
      { label: 'O1-O2',   active: 'O1',  reference: 'O2',  group: 'central' },
      { label: 'ECG',     active: 'ECG', group: 'ecg' },
    ]
  },
  'reference-car': {
    id: 'reference-car',
    name: 'Reference – Common Average',
    channels: [
      ...ALL_ELECTRODES.map(el => {
        const isLeft = ['Fp1','F7','F3','T3','C3','T5','P3','O1'].includes(el);
        const isRight = ['Fp2','F8','F4','T4','C4','T6','P4','O2'].includes(el);
        const group: ChannelGroup = isLeft ? 'left-paramedian' : isRight ? 'right-paramedian' : 'central';
        return { label: `${el}-AVG`, active: el as Electrode, reference: 'AVG' as const, group };
      }),
      { label: 'ECG', active: 'ECG' as const, group: 'ecg' as const }
    ]
  },
  'reference-ipsi': {
    id: 'reference-ipsi',
    name: 'Reference – Ipsilateral Ear (A1/A2)',
    channels: [
      ...ALL_ELECTRODES.map(el => {
        const isLeft = ['Fp1','F7','F3','T3','C3','T5','P3','O1'].includes(el);
        const isRight = ['Fp2','F8','F4','T4','C4','T6','P4','O2'].includes(el);
        const ref = isLeft ? 'A1' : isRight ? 'A2' : 'A1';
        const group: ChannelGroup = isLeft ? 'left-paramedian' : isRight ? 'right-paramedian' : 'central';
        return { label: `${el}-${ref}`, active: el as Electrode, reference: ref as Electrode, group };
      }),
      { label: 'ECG', active: 'ECG' as const, group: 'ecg' as const }
    ]
  },
  'reference-contra': {
    id: 'reference-contra',
    name: 'Reference – Contralateral Ear',
    channels: [
      ...ALL_ELECTRODES.map(el => {
        const isLeft = ['Fp1','F7','F3','T3','C3','T5','P3','O1'].includes(el);
        const isRight = ['Fp2','F8','F4','T4','C4','T6','P4','O2'].includes(el);
        const ref = isLeft ? 'A2' : isRight ? 'A1' : 'A2';
        const group: ChannelGroup = isLeft ? 'left-paramedian' : isRight ? 'right-paramedian' : 'central';
        return { label: `${el}-${ref}`, active: el as Electrode, reference: ref as Electrode, group };
      }),
      { label: 'ECG', active: 'ECG' as const, group: 'ecg' as const }
    ]
  }
};
