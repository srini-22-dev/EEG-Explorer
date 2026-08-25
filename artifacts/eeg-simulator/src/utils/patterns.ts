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
  /**
   * Optional super-group label. Consecutive categories sharing a `group` are
   * rendered under one shared heading in the control panel — the three
   * abnormality families (non-epileptiform, interictal, ictal) read as one
   * clinical block rather than three unrelated headings.
   */
  group?: string;
  patterns: PatternDef[];
};

export const PATTERN_CATEGORIES: PatternCategory[] = [
  {
    id: 'sleep-architecture',
    name: 'Sleep Architecture',
    color: '#38bdf8',     // sky blue
    patterns: [
      { id: 'posts',      name: 'POSTS',            desc: 'Positive occipital sharp transients of sleep: surface-positive at O1/O2, so they render as DOWNWARD checkmark-shaped transients; drowsiness/N1 sleep only — selecting this switches Background State to N1.' },
      { id: 'v-waves',    name: 'Vertex Waves',      desc: 'Sharp, Cz-maximal transients of NREM sleep; shown here in N2 — selecting this switches Background State to N2.' },
      { id: 'k-complex',  name: 'K-Complex',         desc: 'Defining graphoelement of N2 sleep: sharp component + slow after-wave, Fz/Cz/Pz maximal — selecting this switches Background State to N2.' },
      { id: 'spindles',   name: 'Sleep Spindles',    desc: '12-15 Hz waxing-waning bursts, central-maximal, defining N2 sleep — selecting this switches Background State to N2.' },
    ],
  },
  {
    id: 'variants',
    name: 'Benign Variants',
    color: '#4ade80',     // green
    patterns: [
      { id: 'mu-rhythm',    name: 'Mu Rhythm',            desc: 'Arch-shaped 8-12 Hz rhythm over central (C3/C4); normal; attenuated by contralateral hand movement.' },
      { id: 'wicket',       name: 'Wicket Spikes',         desc: 'Temporal 6-11 Hz arch-shaped bursts; benign; NO following slow wave — drowsiness only; selecting this switches Background State to Drowsy.' },
      { id: 'rmtd',         name: 'RMTD',                  desc: 'Rhythmic mid-temporal theta of drowsiness (4-7 Hz); normal variant in T3/T4 — selecting this switches Background State to Drowsy.' },
      { id: 'lambda',       name: 'Lambda Waves',           desc: 'Occipital sharp transients during visual scanning of a patterned field; surface-positive like POSTS, so they render DOWNWARD. Awake analogue of POSTS.' },
      { id: 'pswy',         name: 'Posterior Slow Waves of Youth', desc: 'Intermittent high-amplitude 2.5-4.5 Hz waves admixed with the posterior alpha rhythm; benign normal variant, most common in children/young adults — awake state only.' },
      { id: '6hz-sw',       name: '6 Hz Phantom Spike-Wave', desc: 'Brief, low-amplitude generalised 6 Hz spike-wave during drowsiness/light sleep; benign.' },
      { id: '14-6-pos',     name: '14 & 6 Hz Pos. Bursts',  desc: 'Arch-shaped positive bursts at 14 Hz and/or 6 Hz in posterior temporal leads during light sleep; benign — selecting this switches Background State to Drowsy.' },
      { id: 'bets',         name: 'BETS / Small Sharp Spikes', desc: 'Benign epileptiform transients of sleep; very brief (<50 ms), low-amplitude (<50 µV) temporal spikes without slow wave — selecting this switches Background State to Drowsy.' },
      { id: 'eyes-open',    name: 'Eyes Open',              desc: 'Attenuates the posterior alpha PDR (and central mu) — the Berger effect / "alpha blocking". Turning this off also turns off Eye Blink.' },
    ],
  },
  {
    id: 'artifacts',
    name: 'Artifacts',
    color: '#fb923c',     // orange
    patterns: [
      { id: 'blink',        name: 'Eye Blink',             desc: 'Large DOWNWARD deflection in every frontopolar row (Fp1-F3, Fp2-F4, Fp1-F7, Fp2-F8); rapid onset, ~200 ms. The eye is a dipole with a positive cornea, so lid closure drives Fp1/Fp2 positive — and because EEG is displayed negative-up, positive reads downward.' },
      { id: 'eye-movement', name: 'Lateral Eye Movement',  desc: 'Slow opposite-polarity deflections at F7 vs F8 from horizontal gaze shift.' },
      { id: 'eye-opening',  name: 'Eye Opening / Closing',  desc: 'The slow ocular deflection of opening the eyes on command and closing them again. Opening sweeps the positive cornea downward away from Fp1/Fp2, so the frontopolar rows deflect UPWARD — the mirror of a blink, and smaller. Closing gives a smaller downward transient a few seconds later. Transverse Fp1-Fp2 largely cancels it, as with a blink.' },
      { id: 'muscle',       name: 'Muscle (EMG)',           desc: 'High-frequency (20-300 Hz) "fuzz" from contracting scalp muscles. Which muscle decides which channels are ruined: temporalis (jaw) at T3/T4 and F7/F8, and it can be one-sided; frontalis (brow) at Fp1/Fp2; nuchal (neck) at O1/O2 and T5/T6, where it buries the posterior rhythm and can mimic posterior sharp waves. Select the muscle group and severity once the toggle is on.' },
      { id: 'chewing',      name: 'Chewing Artifact',       desc: 'Rhythmic 1-2 Hz large-amplitude bursts in temporal leads from masseter movement.' },
      { id: 'electrode-pop',name: 'Electrode Pop',          desc: 'Single-electrode transient: an abrupt step followed by exponential RC decay, with no smooth field to its neighbours — that spatial discontinuity is how a bad electrode is told from a real generator. Choose which electrode pops, or detach it: contact fails with a pop and the electrode then stays isoelectric until you reattach it.' },
      { id: 'sweat',        name: 'Sweat Artifact',         desc: 'Very slow (<0.5 Hz) sinusoidal drift predominantly in frontal leads from sweat gland activation.' },
      { id: 'ecg-artifact', name: 'ECG (Cardiac)',          desc: 'QRS complexes volume-conducted from the heart onto the scalp: sharp, strictly regular transients at the heart rate (~1 Hz). Largest in the low temporal and ear-referenced chains, and slightly larger on the left because the heart sits left of midline. Confirm it by checking that every transient lines up with an R wave on the ECG trace at the bottom.' },
      { id: 'movement',     name: 'Movement Artifact',      desc: 'Rare, very large broadband transients from head or body movement; 0.2-1 s, frontally predominant, often driving several channels off-scale at once. No consistent morphology and no field that decays smoothly from a generator — that is what marks it as artifact.' },
      { id: '50hz',         name: 'Mains Interference',     desc: 'AC line noise: uniform thickening of every trace, worst on high-impedance electrodes. 50 Hz across most of the world and 60 Hz in the Americas — both are selectable, because which one you see depends on where the record was made, not on the patient. Not biologically meaningful.' },
    ],
  },
  {
    id: 'non-epileptiform',
    name: 'Non-Epileptiform Abnl.',
    color: '#facc15',     // yellow
    group: 'Abnormal / Epileptiform',
    patterns: [
      { id: 'gen-slowing',         name: 'Generalised Slowing',        desc: 'Diffuse theta/delta replacing normal background; no PDR; seen with encephalopathy, medications.' },
      { id: 'focal-delta-temporal',name: 'Focal Δ (L. Temporal)',      desc: 'Intermittent polymorphic delta activity in left temporal leads; structural lesion until proven otherwise.' },
      { id: 'firda',               name: 'FIRDA',                       desc: 'Frontal intermittent rhythmic delta activity (2-3 Hz); associated with encephalopathy and raised ICP.' },
      { id: 'triphasic',           name: 'Triphasic Waves',            desc: 'Periodic (~1.5 Hz) triphasic complexes, anteriorly predominant; metabolic encephalopathy (hepatic, uraemic). Phases are −/+/− by scalp potential, and the dominant middle phase is the positive one — so on screen the big excursion is DOWNWARD, between two smaller upward phases.' },
      { id: 'gpeds',               name: 'GPEDs',                      desc: 'Generalised periodic epileptiform discharges: generalised spike/sharp every 0.5-2 s; CJD, anoxia, severe encephalopathy.' },
      { id: 'lpeds',               name: 'LPEDs (L. Temporal)',        desc: 'Lateralised periodic epileptiform discharges: sharp+slow every 1-2 s in left temporal; herpes encephalitis, stroke.' },
    ],
  },
  {
    id: 'epileptiform',
    name: 'Interictal Epileptiform',
    color: '#f87171',     // red
    group: 'Abnormal / Epileptiform',
    patterns: [
      { id: 'focal-spikes-lt',   name: 'L. Temporal Spike-Wave', desc: 'Focal interictal discharge at T3/F7 with negative phase reversal and obligatory following slow wave; temporal lobe epilepsy. This one teaches localisation (where the phase reversal sits); for the spike-vs-sharp morphology distinction see the four patterns below.' },
      { id: 'focal-spikes-rt',   name: 'R. Temporal Spike-Wave', desc: 'Focal interictal discharge at T4/F8 with negative phase reversal and following slow wave; the mirror of the left temporal focus.' },
      { id: 'focal-spikes-lf',   name: 'L. Frontal Spike-Wave',  desc: 'Focal interictal discharge at F3/Fp1 with following slow wave; frontal lobe epilepsy.' },
      // Morphology set (IK-012): the four waveforms told apart by duration and by
      // whether an after-going slow wave follows. All at a left-temporal focus.
      { id: 'ied-spike',         name: 'Spike (20-70 ms)',       desc: 'A single pointed transient, 20-70 ms at its base, surface-negative (renders UPWARD), with NO after-going slow wave. Duration is what separates it from a sharp wave. At the T3 focus.' },
      { id: 'ied-spike-wave',    name: 'Spike-and-Slow-Wave',    desc: 'A spike (20-70 ms) immediately followed by an obligatory surface-positive after-going slow wave (~450 ms). The slow wave is what makes it a complex rather than a bare spike. At the T3 focus.' },
      { id: 'ied-sharp',         name: 'Sharp Wave (70-200 ms)', desc: 'A single pointed transient, 70-200 ms at its base — broader than a spike but the same surface-negative pointed shape — with NO after-going slow wave. At the T3 focus.' },
      { id: 'ied-sharp-wave',    name: 'Sharp-and-Slow-Wave',    desc: 'A sharp wave (70-200 ms) followed by an obligatory after-going slow wave, the longer-duration counterpart of the spike-and-slow-wave complex. At the T3 focus.' },
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
    group: 'Abnormal / Epileptiform',
    patterns: [
      { id: 'absence-ictal',       name: 'Absence Seizure',       desc: '3 Hz generalised spike-wave: sudden onset and abrupt offset; 5-15 s; brief post-ictal pause; consciousness impaired.' },
      { id: 'gtc-ictal',           name: 'Gen. Tonic-Clonic',     desc: 'Recruiting fast → polyspike-wave evolving → slowing → post-ictal suppression; >10 s to qualify as seizure.' },
      { id: 'focal-temporal-ictal',name: 'Focal Temporal Sz.',    desc: 'Rhythmic theta onset in the selected temporal lobe (see Hemisphere), evolving in frequency and amplitude; late contralateral spread.' },
      { id: 'focal-frontal-ictal', name: 'Focal Frontal Sz.',     desc: 'Low-voltage fast onset in the selected frontal lobe (see Hemisphere), rapidly evolving; often nocturnal, short, multiple daily.' },
    ],
  },
  {
    id: 'activation',
    name: 'Activation Procedures',
    color: '#a78bfa',     // violet
    patterns: [
      { id: 'photic',            name: 'Photic Stimulation',  desc: 'Intermittent photic stimulation: a strobe stepped through 1-30 Hz. The normal finding is the photic driving response — rhythmic activity over O1/O2, time-locked to the flashes, at the flash rate and its harmonics. Best elicited between 8 and 20 Hz, near the subject\'s own alpha frequency; little or no driving at 1-2 Hz or above 30. It must be symmetric — a persistently one-sided driving response is the abnormality. Trains here are 6 s with 3 s rests so the whole series fits in about two minutes; clinically they are ~10 s with at least 7 s between.' },
      { id: 'hyperventilation',  name: 'Hyperventilation',     desc: 'Three minutes of overbreathing, producing the HV "build-up": generalised rhythmic slowing that grows through the procedure, starts as theta and deepens into delta, and is frontally predominant in adults. It resolves within about a minute of stopping — persistence well beyond that is itself a finding. A build-up is a normal response, more marked in children and young adults, so it is not by itself an abnormality. Watch it grow, then watch it go: the toggle restarts the procedure from the beginning each time it is switched on.' },
    ],
  },
];

/** Flat lookup map: id → PatternDef */
export const PATTERN_BY_ID: Record<string, PatternDef> =
  Object.fromEntries(
    PATTERN_CATEGORIES.flatMap(c => c.patterns).map(p => [p.id, p])
  );
