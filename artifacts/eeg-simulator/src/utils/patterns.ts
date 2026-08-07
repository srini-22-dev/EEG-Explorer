/** Clinical EEG pattern registry — categories, IDs, names, and tooltip descriptions */

export type PatternDef = {
  id: string;
  name: string;
  desc: string;
};

export type PatternCategory = {
  id: string;
  name: string;
  color: string;          // accent colour for the category header
  patterns: PatternDef[];
};

export const PATTERN_CATEGORIES: PatternCategory[] = [
  {
    id: 'sleep-architecture',
    name: 'Sleep Architecture',
    color: '#38bdf8',     // sky blue
    patterns: [
      { id: 'posts',      name: 'POSTS',            desc: 'Positive occipital sharp transients of sleep; drowsiness/N1 sleep only — selecting this switches Background State to N1.' },
      { id: 'v-waves',    name: 'Vertex Waves',      desc: 'Sharp, Cz-maximal transients of NREM sleep; shown here in N2 — selecting this switches Background State to N2.' },
      { id: 'k-complex',  name: 'K-Complex',         desc: 'Defining graphoelement of N2 sleep: sharp component + slow after-wave, Fz/Cz/Pz maximal — selecting this switches Background State to N2.' },
      { id: 'spindles',   name: 'Sleep Spindles',    desc: '12-15 Hz waxing-waning bursts, central-maximal, defining N2 sleep — selecting this switches Background State to N2.' },
    ],
  },
  {
    id: 'variants',
    name: 'Normal Variants',
    color: '#4ade80',     // green
    patterns: [
      { id: 'mu-rhythm',    name: 'Mu Rhythm',            desc: 'Arch-shaped 8-12 Hz rhythm over central (C3/C4); normal; attenuated by contralateral hand movement.' },
      { id: 'wicket',       name: 'Wicket Spikes',         desc: 'Temporal 6-11 Hz arch-shaped bursts; benign; NO following slow wave — drowsiness only; selecting this switches Background State to Drowsy.' },
      { id: 'rmtd',         name: 'RMTD',                  desc: 'Rhythmic mid-temporal theta of drowsiness (4-7 Hz); normal variant in T3/T4 — selecting this switches Background State to Drowsy.' },
      { id: 'lambda',       name: 'Lambda Waves',           desc: 'Positive occipital sharp transients occurring during visual scanning of a patterned field.' },
      { id: 'pswy',         name: 'Posterior Slow Waves of Youth', desc: 'Intermittent high-amplitude 2.5-4.5 Hz waves admixed with the posterior alpha rhythm; benign normal variant, most common in children/young adults — awake state only.' },
      { id: '6hz-sw',       name: '6 Hz Phantom Spike-Wave', desc: 'Brief, low-amplitude generalised 6 Hz spike-wave during drowsiness/light sleep; benign.' },
      { id: '14-6-pos',     name: '14 & 6 Hz Pos. Bursts',  desc: 'Arch-shaped positive bursts at 14 Hz and/or 6 Hz in posterior temporal leads during light sleep; benign.' },
      { id: 'bets',         name: 'BETS / Small Sharp Spikes', desc: 'Benign epileptiform transients of sleep; very brief (<50 ms), low-amplitude (<50 µV) temporal spikes without slow wave.' },
    ],
  },
  {
    id: 'artifacts',
    name: 'Artifacts',
    color: '#fb923c',     // orange
    patterns: [
      { id: 'blink',        name: 'Eye Blink',             desc: 'Large positive deflection (corneoretinal potential) at Fp1/Fp2; rapid onset, ~200 ms.' },
      { id: 'eye-movement', name: 'Lateral Eye Movement',  desc: 'Slow opposite-polarity deflections at F7 vs F8 from horizontal gaze shift.' },
      { id: 'muscle',       name: 'Muscle (EMG)',           desc: 'High-frequency (20-300 Hz) noise from scalp or temporal muscles; "fuzz" on traces.' },
      { id: 'chewing',      name: 'Chewing Artifact',       desc: 'Rhythmic 1-2 Hz large-amplitude bursts in temporal leads from masseter movement.' },
      { id: 'electrode-pop',name: 'Electrode Pop',          desc: 'Single-channel transient: abrupt spike followed by exponential RC decay and ringing.' },
      { id: 'sweat',        name: 'Sweat Artifact',         desc: 'Very slow (<0.5 Hz) sinusoidal drift predominantly in frontal leads from sweat gland activation.' },
      { id: '50hz',         name: '50 Hz Mains',            desc: '50 Hz AC line noise causes uniform thickening of traces; not biologically meaningful.' },
    ],
  },
  {
    id: 'non-epileptiform',
    name: 'Non-Epileptiform Abnl.',
    color: '#facc15',     // yellow
    patterns: [
      { id: 'gen-slowing',         name: 'Generalised Slowing',        desc: 'Diffuse theta/delta replacing normal background; no PDR; seen with encephalopathy, medications.' },
      { id: 'focal-delta-temporal',name: 'Focal Δ (L. Temporal)',      desc: 'Intermittent polymorphic delta activity in left temporal leads; structural lesion until proven otherwise.' },
      { id: 'firda',               name: 'FIRDA',                       desc: 'Frontal intermittent rhythmic delta activity (2-3 Hz); associated with encephalopathy and raised ICP.' },
      { id: 'triphasic',           name: 'Triphasic Waves',            desc: 'Periodic (~1.5 Hz) triphasic complexes (−/+/−), anteriorly predominant; metabolic encephalopathy (hepatic, uraemic).' },
      { id: 'gpeds',               name: 'GPEDs',                      desc: 'Generalised periodic epileptiform discharges: generalised spike/sharp every 0.5-2 s; CJD, anoxia, severe encephalopathy.' },
      { id: 'lpeds',               name: 'LPEDs (L. Temporal)',        desc: 'Lateralised periodic epileptiform discharges: sharp+slow every 1-2 s in left temporal; herpes encephalitis, stroke.' },
    ],
  },
  {
    id: 'epileptiform',
    name: 'Interictal Epileptiform',
    color: '#f87171',     // red
    patterns: [
      { id: 'focal-spikes-lt',   name: 'L. Temporal Spikes',  desc: 'Interictal spikes at T3/F7 with negative phase reversal and obligatory following slow wave; temporal lobe epilepsy.' },
      { id: 'focal-spikes-rt',   name: 'R. Temporal Spikes',  desc: 'Interictal spikes at T4/F8 with negative phase reversal and following slow wave.' },
      { id: 'focal-spikes-lf',   name: 'L. Frontal Spikes',   desc: 'Interictal spikes at F3/Fp1 with following slow wave; frontal lobe epilepsy.' },
      { id: '3hz-gsw',           name: '3 Hz Gen. Spike-Wave', desc: 'Generalised 3 Hz spike-wave; pathognomonic of absence epilepsy when continuous; also seen as interictal burst.' },
      { id: 'polyspike-wave',    name: 'Polyspike-Wave',       desc: 'Multiple spikes (3-5) followed by slow wave; generalised; juvenile myoclonic epilepsy pattern.' },
      { id: 'burst-suppression', name: 'Burst Suppression',    desc: 'Alternating high-amplitude bursts and near-flat suppression; deep anaesthesia or severe anoxic brain injury.' },
      { id: 'hypsarrhythmia',    name: 'Hypsarrhythmia',       desc: 'Chaotic high-amplitude multifocal spikes/sharp waves and slow waves; no organised background; West syndrome.' },
    ],
  },
  {
    id: 'ictal',
    name: 'Ictal / Seizures',
    color: '#e879f9',     // purple
    patterns: [
      { id: 'absence-ictal',       name: 'Absence Seizure',       desc: '3 Hz generalised spike-wave: sudden onset and abrupt offset; 5-15 s; brief post-ictal pause; consciousness impaired.' },
      { id: 'gtc-ictal',           name: 'Gen. Tonic-Clonic',     desc: 'Recruiting fast → polyspike-wave evolving → slowing → post-ictal suppression; >10 s to qualify as seizure.' },
      { id: 'focal-temporal-ictal',name: 'Focal Temporal Sz.',    desc: 'Rhythmic theta onset in left temporal evolving in frequency and amplitude; may generalise.' },
      { id: 'focal-frontal-ictal', name: 'Focal Frontal Sz.',     desc: 'Low-voltage fast onset in frontal region rapidly evolving; often nocturnal, short, multiple daily.' },
    ],
  },
];

/** Flat lookup map: id → PatternDef */
export const PATTERN_BY_ID: Record<string, PatternDef> =
  Object.fromEntries(
    PATTERN_CATEGORIES.flatMap(c => c.patterns).map(p => [p.id, p])
  );
