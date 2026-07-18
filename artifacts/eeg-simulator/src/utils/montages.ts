export type Electrode =
  | 'Fp1' | 'Fp2'
  | 'F7' | 'F3' | 'Fz' | 'F4' | 'F8'
  | 'T3' | 'C3' | 'Cz' | 'C4' | 'T4'
  | 'T5' | 'P3' | 'Pz' | 'P4' | 'T6'
  | 'O1' | 'O2'
  | 'A1' | 'A2'; // Ear references

export const ALL_ELECTRODES: Electrode[] = [
  'Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8',
  'T3', 'C3', 'Cz', 'C4', 'T4', 'T5', 'P3',
  'Pz', 'P4', 'T6', 'O1', 'O2'
];

export type ChannelDef = {
  label: string;
  active: Electrode;
  reference?: Electrode | 'AVG' | 'CONTRA' | 'IPSI';
};

export type Montage = {
  id: string;
  name: string;
  channels: ChannelDef[];
};

export const MONTAGES: Record<string, Montage> = {
  'bipolar-ap': {
    id: 'bipolar-ap',
    name: 'Bipolar – Antero-posterior',
    channels: [
      { label: 'Fp1-F7', active: 'Fp1', reference: 'F7' },
      { label: 'F7-T3', active: 'F7', reference: 'T3' },
      { label: 'T3-T5', active: 'T3', reference: 'T5' },
      { label: 'T5-O1', active: 'T5', reference: 'O1' },
      { label: 'Fp2-F8', active: 'Fp2', reference: 'F8' },
      { label: 'F8-T4', active: 'F8', reference: 'T4' },
      { label: 'T4-T6', active: 'T4', reference: 'T6' },
      { label: 'T6-O2', active: 'T6', reference: 'O2' },
      { label: 'Fp1-F3', active: 'Fp1', reference: 'F3' },
      { label: 'F3-C3', active: 'F3', reference: 'C3' },
      { label: 'C3-P3', active: 'C3', reference: 'P3' },
      { label: 'P3-O1', active: 'P3', reference: 'O1' },
      { label: 'Fp2-F4', active: 'Fp2', reference: 'F4' },
      { label: 'F4-C4', active: 'F4', reference: 'C4' },
      { label: 'C4-P4', active: 'C4', reference: 'P4' },
      { label: 'P4-O2', active: 'P4', reference: 'O2' },
      { label: 'Fz-Cz', active: 'Fz', reference: 'Cz' },
      { label: 'Cz-Pz', active: 'Cz', reference: 'Pz' },
    ]
  },
  'bipolar-transverse': {
    id: 'bipolar-transverse',
    name: 'Bipolar – Transverse',
    channels: [
      { label: 'Fp1-Fp2', active: 'Fp1', reference: 'Fp2' },
      { label: 'F7-F3', active: 'F7', reference: 'F3' },
      { label: 'F3-Fz', active: 'F3', reference: 'Fz' },
      { label: 'Fz-F4', active: 'Fz', reference: 'F4' },
      { label: 'F4-F8', active: 'F4', reference: 'F8' },
      { label: 'T3-C3', active: 'T3', reference: 'C3' },
      { label: 'C3-Cz', active: 'C3', reference: 'Cz' },
      { label: 'Cz-C4', active: 'Cz', reference: 'C4' },
      { label: 'C4-T4', active: 'C4', reference: 'T4' },
      { label: 'T5-P3', active: 'T5', reference: 'P3' },
      { label: 'P3-Pz', active: 'P3', reference: 'Pz' },
      { label: 'Pz-P4', active: 'Pz', reference: 'P4' },
      { label: 'P4-T6', active: 'P4', reference: 'T6' },
      { label: 'O1-O2', active: 'O1', reference: 'O2' },
    ]
  },
  'reference-car': {
    id: 'reference-car',
    name: 'Reference – Common Average',
    channels: ALL_ELECTRODES.map(el => ({ label: `${el}-AVG`, active: el, reference: 'AVG' }))
  },
  'reference-ipsi': {
    id: 'reference-ipsi',
    name: 'Reference – Ipsilateral Ear (A1/A2)',
    channels: ALL_ELECTRODES.map(el => {
      const isLeft = ['Fp1', 'F7', 'F3', 'T3', 'C3', 'T5', 'P3', 'O1'].includes(el);
      const isRight = ['Fp2', 'F8', 'F4', 'T4', 'C4', 'T6', 'P4', 'O2'].includes(el);
      const ref = isLeft ? 'A1' : isRight ? 'A2' : 'A1'; // Midline default to A1
      return { label: `${el}-${ref}`, active: el, reference: ref as Electrode };
    })
  },
  'reference-contra': {
    id: 'reference-contra',
    name: 'Reference – Contralateral Ear',
    channels: ALL_ELECTRODES.map(el => {
      const isLeft = ['Fp1', 'F7', 'F3', 'T3', 'C3', 'T5', 'P3', 'O1'].includes(el);
      const isRight = ['Fp2', 'F8', 'F4', 'T4', 'C4', 'T6', 'P4', 'O2'].includes(el);
      const ref = isLeft ? 'A2' : isRight ? 'A1' : 'A2'; 
      return { label: `${el}-${ref}`, active: el, reference: ref as Electrode };
    })
  }
};
