export type Electrode =
  | 'Fp1' | 'Fp2'
  | 'F7' | 'F3' | 'Fz' | 'F4' | 'F8'
  | 'T3' | 'C3' | 'Cz' | 'C4' | 'T4'
  | 'T5' | 'P3' | 'Pz' | 'P4' | 'T6'
  | 'O1' | 'O2'
  | 'A1' | 'A2';

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
  'Pz', 'P4', 'T6', 'O1', 'O2',
];

// Ordered electrode lists for referential montages
const LEFT_ELECTRODES:    Electrode[] = ['Fp1','F7','F3','T3','C3','T5','P3','O1'];
const RIGHT_ELECTRODES:   Electrode[] = ['Fp2','F8','F4','T4','C4','T6','P4','O2'];
const CENTRAL_ELECTRODES: Electrode[] = ['Fz','Cz','Pz'];

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

export const GROUP_COLORS: Record<ChannelGroup, string> = {
  'left-paramedian':  '#1a4fa0',
  'right-paramedian': '#8b1a1a',
  'left-temporal':    '#1a4fa0',
  'right-temporal':   '#8b1a1a',
  'central':          '#1a3a1a',
  'ecg':              '#1b6b1b',
};

// ─── Helper: build a referential channel list in canonical order ──────────────
function refChannels(
  refEl: Electrode | 'AVG',
  label: (el: Electrode, ref: Electrode | 'AVG') => string,
): ChannelDef[] {
  const ch: ChannelDef[] = [];

  LEFT_ELECTRODES.forEach(el => {
    ch.push({ label: label(el, refEl), active: el, reference: refEl, group: 'left-paramedian' });
  });
  RIGHT_ELECTRODES.forEach(el => {
    ch.push({ label: label(el, refEl), active: el, reference: refEl, group: 'right-paramedian' });
  });
  CENTRAL_ELECTRODES.forEach(el => {
    ch.push({ label: label(el, refEl), active: el, reference: refEl, group: 'central' });
  });
  ch.push({ label: 'ECG', active: 'ECG', group: 'ecg' });
  return ch;
}

export const MONTAGES: Record<string, Montage> = {
  // The double banana: left parasagittal, right parasagittal, left temporal, right
  // temporal, then the midline Fz-Cz-Pz chain, with Fp1-F3 on the top row.
  //
  // Order history, because it has moved three times: LB-18.3 until 2026-09-11; then
  // parasagittal-first, matching five of six learningeeg Normal Asleep figures
  // read that day (its single vertex-wave figure is temporal-first); then back
  // to temporal-first on 2026-09-14 at the user's request; then parasagittal-first
  // again on 2026-09-22 at the user's request ("Fp1-F3 should be at the top"),
  // which is also learningeeg's usual print order. ACNS's other
  // longitudinal layouts: LB-18.1 runs L temporal, L parasagittal, midline,
  // R parasagittal, R temporal; LB-18.2 puts the midline first, then L/R
  // parasagittal, L/R temporal. Chain order changes no derivation, so no
  // polarity, phase-reversal or localisation property changes — only where a
  // chain sits on the page.
  'bipolar-ap': {
    id: 'bipolar-ap',
    name: 'Bipolar – Antero-posterior',
    channels: [
      // Left paramedian
      { label: 'Fp1-F3', active: 'Fp1', reference: 'F3', group: 'left-paramedian' },
      { label: 'F3-C3',  active: 'F3',  reference: 'C3', group: 'left-paramedian' },
      { label: 'C3-P3',  active: 'C3',  reference: 'P3', group: 'left-paramedian' },
      { label: 'P3-O1',  active: 'P3',  reference: 'O1', group: 'left-paramedian' },
      // Right paramedian
      { label: 'Fp2-F4', active: 'Fp2', reference: 'F4', group: 'right-paramedian' },
      { label: 'F4-C4',  active: 'F4',  reference: 'C4', group: 'right-paramedian' },
      { label: 'C4-P4',  active: 'C4',  reference: 'P4', group: 'right-paramedian' },
      { label: 'P4-O2',  active: 'P4',  reference: 'O2', group: 'right-paramedian' },
      // Left temporal
      { label: 'Fp1-F7', active: 'Fp1', reference: 'F7', group: 'left-temporal' },
      { label: 'F7-T3',  active: 'F7',  reference: 'T3', group: 'left-temporal' },
      { label: 'T3-T5',  active: 'T3',  reference: 'T5', group: 'left-temporal' },
      { label: 'T5-O1',  active: 'T5',  reference: 'O1', group: 'left-temporal' },
      // Right temporal
      { label: 'Fp2-F8', active: 'Fp2', reference: 'F8', group: 'right-temporal' },
      { label: 'F8-T4',  active: 'F8',  reference: 'T4', group: 'right-temporal' },
      { label: 'T4-T6',  active: 'T4',  reference: 'T6', group: 'right-temporal' },
      { label: 'T6-O2',  active: 'T6',  reference: 'O2', group: 'right-temporal' },
      // Central
      { label: 'Fz-Cz', active: 'Fz', reference: 'Cz', group: 'central' },
      { label: 'Cz-Pz', active: 'Cz', reference: 'Pz', group: 'central' },
      // ECG
      { label: 'ECG', active: 'ECG', group: 'ecg' },
    ],
  },

  // ACNS Guideline 3, "Standard Transverse Bipolar Montage" TB-18.1, in full
  // (18 EEG derivations). A transverse montage exists to let a reader
  // localise, across the head, a focus that a longitudinal (bipolar-ap)
  // montage phase-reversed at — but that only works if every electrode
  // in the chain has TWO neighbouring derivations to reverse between. The
  // previous version omitted the four chain-end derivations (F7-Fp1,
  // Fp2-F8, T5-O1, O2-T6), which left Fp1, Fp2, F7, F8, T3, T4, T5, T6, O1
  // and O2 appearing in only one row each — a focus at any of them produced
  // one large deflection with no flanking row to confirm it against.
  // T3 and T4 still only appear once even with all four rows added; closing
  // that needs the A1-T3 / T4-A2 ear links from ACNS TB-18.2, which is a
  // distinct montage and is intentionally not added here.
  'bipolar-transverse': {
    id: 'bipolar-transverse',
    name: 'Bipolar – Transverse',
    channels: [
      { label: 'F7-Fp1',  active: 'F7',  reference: 'Fp1', group: 'left-temporal' },
      { label: 'Fp1-Fp2', active: 'Fp1', reference: 'Fp2', group: 'central' },
      { label: 'Fp2-F8',  active: 'Fp2', reference: 'F8',  group: 'right-temporal' },
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
      { label: 'T5-O1',   active: 'T5',  reference: 'O1',  group: 'left-temporal' },
      { label: 'O1-O2',   active: 'O1',  reference: 'O2',  group: 'central' },
      { label: 'O2-T6',   active: 'O2',  reference: 'T6',  group: 'right-temporal' },
      { label: 'ECG',     active: 'ECG', group: 'ecg' },
    ],
  },

  // ACNS Guideline 3, Standard Transverse Bipolar Montage TB-18.2.
  //
  // This exists because TB-18.1 above cannot localise a mid-temporal focus. In
  // that montage T3 and T4 are the only electrodes appearing in a single
  // derivation, so a T3-maximal spike produces one large row (T3-C3) with no
  // neighbour to oppose it — measured: T3-C3 -171.6 uV against C3-Cz -30.3 and
  // T5-O1 -31.3, all the same sign, no reversal. An F3 focus reverses cleanly
  // there (F7-F3 +165.0 against F3-Fz -167.6); the temporal one does not. Since
  // anterior and mid-temporal is where most focal epileptiform activity lives,
  // that gap was the clinically important one.
  //
  // TB-18.2 closes it by running the central chain ear-to-ear: A1-T3 ... T4-A2.
  // T3 then sits in A1-T3 and T3-C3, and T4 in C4-T4 and T4-A2.
  //
  // This is a TRADE, not a strict improvement, and it is the trade ACNS designed
  // ("the alternative montages in the TB series depend, in part, on the extent of
  // polar coverage"). TB-18.2 buys the mid-temporal pair by giving up polar
  // coverage: Fp1, Fp2, F7, F8, A1, A2, T5, T6, O1 and O2 each appear only ONCE
  // here and cannot phase-reverse in this montage -- they reverse in TB-18.1
  // above, where T3 and T4 are the two that cannot. Neither transverse montage
  // localises everything; a reader uses both, which is why both ship.
  //
  // The ears are real electrodes here (A1/A2 carry
  // their own 3D positions and genuinely differ, which is what makes
  // reference-ipsi and reference-contra distinct montages), so these are true
  // derivations rather than a cosmetic addition.
  'bipolar-transverse-ears': {
    id: 'bipolar-transverse-ears',
    name: 'Bipolar – Transverse (ear-linked)',
    channels: [
      { label: 'Fp1-Fp2', active: 'Fp1', reference: 'Fp2', group: 'central' },
      { label: 'F7-F3',   active: 'F7',  reference: 'F3',  group: 'left-temporal' },
      { label: 'F3-Fz',   active: 'F3',  reference: 'Fz',  group: 'left-paramedian' },
      { label: 'Fz-F4',   active: 'Fz',  reference: 'F4',  group: 'right-paramedian' },
      { label: 'F4-F8',   active: 'F4',  reference: 'F8',  group: 'right-temporal' },
      // The ear-to-ear central chain: this is what TB-18.2 adds over TB-18.1.
      { label: 'A1-T3',   active: 'A1',  reference: 'T3',  group: 'left-temporal' },
      { label: 'T3-C3',   active: 'T3',  reference: 'C3',  group: 'left-temporal' },
      { label: 'C3-Cz',   active: 'C3',  reference: 'Cz',  group: 'left-paramedian' },
      { label: 'Cz-C4',   active: 'Cz',  reference: 'C4',  group: 'central' },
      { label: 'C4-T4',   active: 'C4',  reference: 'T4',  group: 'right-temporal' },
      { label: 'T4-A2',   active: 'T4',  reference: 'A2',  group: 'right-temporal' },
      { label: 'T5-P3',   active: 'T5',  reference: 'P3',  group: 'left-temporal' },
      { label: 'P3-Pz',   active: 'P3',  reference: 'Pz',  group: 'left-paramedian' },
      { label: 'Pz-P4',   active: 'Pz',  reference: 'P4',  group: 'right-paramedian' },
      { label: 'P4-T6',   active: 'P4',  reference: 'T6',  group: 'right-temporal' },
      { label: 'O1-O2',   active: 'O1',  reference: 'O2',  group: 'central' },
      { label: 'Fz-Cz',   active: 'Fz',  reference: 'Cz',  group: 'central' },
      { label: 'Cz-Pz',   active: 'Cz',  reference: 'Pz',  group: 'central' },
      { label: 'ECG',     active: 'ECG', group: 'ecg' },
    ],
  },

  'reference-car': {
    id: 'reference-car',
    name: 'Reference – Common Average',
    channels: refChannels('AVG', (el) => `${el}-AVG`),
  },

  'reference-ipsi': {
    id: 'reference-ipsi',
    name: 'Reference – Ipsilateral Ear (A1/A2)',
    channels: (() => {
      const ch: ChannelDef[] = [];
      LEFT_ELECTRODES.forEach(el => {
        ch.push({ label: `${el}-A1`, active: el, reference: 'A1', group: 'left-paramedian' });
      });
      RIGHT_ELECTRODES.forEach(el => {
        ch.push({ label: `${el}-A2`, active: el, reference: 'A2', group: 'right-paramedian' });
      });
      CENTRAL_ELECTRODES.forEach(el => {
        ch.push({ label: `${el}-A1`, active: el, reference: 'A1', group: 'central' });
      });
      ch.push({ label: 'ECG', active: 'ECG', group: 'ecg' });
      return ch;
    })(),
  },

  'reference-contra': {
    id: 'reference-contra',
    name: 'Reference – Contralateral Ear',
    channels: (() => {
      const ch: ChannelDef[] = [];
      LEFT_ELECTRODES.forEach(el => {
        ch.push({ label: `${el}-A2`, active: el, reference: 'A2', group: 'left-paramedian' });
      });
      RIGHT_ELECTRODES.forEach(el => {
        ch.push({ label: `${el}-A1`, active: el, reference: 'A1', group: 'right-paramedian' });
      });
      CENTRAL_ELECTRODES.forEach(el => {
        ch.push({ label: `${el}-A2`, active: el, reference: 'A2', group: 'central' });
      });
      ch.push({ label: 'ECG', active: 'ECG', group: 'ecg' });
      return ch;
    })(),
  },
};
