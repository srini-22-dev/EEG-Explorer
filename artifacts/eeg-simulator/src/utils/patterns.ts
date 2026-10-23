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
      { id: 'posts',      name: 'POSTS',            desc: 'Positive occipital sharp transients of sleep: triangular, "sail-like" sharp waves, 80-200 ms and 20-75 µV, one at a time at irregular intervals more than a second apart, or in trains of 4-6 per second lasting about a second — choose the form under the toggle. Surface-POSITIVE at O1/O2 — so DOWN in a referential montage, but UP on the double banana, where O1/O2 is the second input of P3-O1, T5-O1, P4-O2 and T6-O2, the rows they sit on. Begin in N1 and persist into N2 — selecting this switches Background State to N1.' },
      { id: 'v-waves',    name: 'Vertex Waves',      desc: 'Vertex sharp waves: surface-negative sharp waves (~100 ms, under 0.5 s in all) maximal at the vertex and over both central regions, so they phase-reverse at Cz on the midline chain and at C3/C4 on the parasagittal chains. Alone or in short runs of varying amplitude. Appear in N1 and persist into N2 — selecting this switches Background State to N1.' },
      { id: 'k-complex',  name: 'K-Complex',         desc: 'Defining graphoelement of N2: a high-amplitude, well-delineated surface-negative sharp wave immediately followed by a slower positive wave, at least 0.5 s in all, frontally maximal but seen on every chain; often followed by a spindle. Selecting this switches Background State to N2.' },
      { id: 'spindles',   name: 'Sleep Spindles',    desc: 'Defining graphoelement of N2: symmetric 11-16 Hz waxing-waning bursts lasting 0.5-2 s — faster (13-15 Hz) spindles maximal centro-parietally, slower (11-13 Hz) ones frontally. Selecting this switches Background State to N2.' },
      { id: 'slow-waves', name: 'Slow-Wave Sleep (N3)', desc: 'Deep NREM sleep: high-amplitude (>75 µV) delta at 0.5-2 Hz filling at least a fifth of the page, synchronized and diffuse but frontally predominant. Spindles and K-complexes may persist or fade. N3 is its background rather than a transient, so this toggle simply moves Background State to N3 (the Sleep button stays lit).' },
      { id: 'roving-eyes', name: 'Roving Eye Movements', desc: 'Very slow (~0.3 Hz) opposing undulations of the lateral frontal regions (F7 against F8), from the horizontal corneo-retinal dipole; a marker of drowsiness and N1 — selecting this switches Background State to Drowsy.' },
      { id: 'rem-eyes',   name: 'Rapid Eye Movements', desc: 'REM sleep: sharply contoured opposing deflections at the lateral frontal leads, with a faster upslope than downslope, arriving in bursts — selecting this switches Background State to REM.' },
    ],
  },
  {
    id: 'variants',
    name: 'Benign Variants',
    color: '#4ade80',     // green
    patterns: [
      { id: 'mu-rhythm',    name: 'Mu Rhythm',            desc: 'Arch-shaped 8-12 Hz rhythm over central (C3/C4); normal; attenuated by contralateral hand movement.' },
      { id: 'wicket',       name: 'Wicket Spikes',         desc: 'Temporal 6-11 Hz arch-shaped bursts; benign; NO following slow wave. Seen mostly in drowsiness, also in relaxed wakefulness and light sleep — selecting this from deeper sleep or REM switches Background State to Drowsy.' },
      { id: 'rmtd',         name: 'RMTD',                  desc: 'Rhythmic mid-temporal theta of drowsiness (4-7 Hz); normal variant in T3/T4 — selecting this switches Background State to Drowsy.' },
      { id: 'lambda',       name: 'Lambda Waves',           desc: 'Occipital sharp transients during visual scanning of a patterned field; surface-positive like POSTS, so they render DOWNWARD. Awake analogue of POSTS: it needs open eyes — selecting this switches Background State to Awake and Eyes Open on.' },
      { id: 'pswy',         name: 'Posterior Slow Waves of Youth', desc: 'Intermittent high-amplitude 2.5-4.5 Hz waves admixed with the posterior alpha rhythm; benign normal variant, most common in children/young adults. They sit within the posterior rhythm, so they need an awake patient with the eyes closed — selecting this switches Background State to Awake and Eyes Open off.' },
      { id: '6hz-sw',       name: '6 Hz Phantom Spike-Wave', desc: 'Brief (1-2 s) runs of low-amplitude 6 Hz spike-and-wave, bilateral and synchronous, in which the spike is smaller than the wave and easy to miss — hence "phantom". Shown in its classic benign form (FOLD): maximal posteriorly, in drowsiness. Selecting this switches Background State to Drowsy.' },
      { id: '14-6-pos',     name: '14 & 6 Hz Pos. Bursts',  desc: 'Arch-shaped positive bursts at 14 Hz and/or 6 Hz in posterior temporal leads during light sleep; benign — selecting this switches Background State to Drowsy.' },
      { id: 'bets',         name: 'BETS / Small Sharp Spikes', desc: 'Benign epileptiform transients of sleep; very brief (<50 ms), low-amplitude (<50 µV) temporal spikes without slow wave — selecting this switches Background State to Drowsy.' },
      { id: 'midline-theta', name: 'Midline Theta (Cigánek)', desc: 'Trains of 4-7 Hz arch-shaped or sinusoidal theta over the vertex (Cz, with Fz), lasting from a moment to several seconds; a normal variant of wakefulness and drowsiness, most common in drowsiness or during mental tasks. Selecting this from sleep switches Background State to Drowsy.' },
      { id: 'eyes-open',    name: 'Eyes Open',              desc: 'Attenuates the posterior alpha PDR — the Berger effect / "alpha blocking". Central mu is left alone: it blocks with movement, not with eye opening, which is one way to tell the two apart. Turning this off also turns off Eye Blink and Lambda Waves. Awake only — selecting this switches Background State to Awake.' },
    ],
  },
  {
    id: 'artifacts',
    name: 'Artifacts',
    color: '#fb923c',     // orange
    patterns: [
      { id: 'blink',        name: 'Eye Blink',             desc: 'Large DOWNWARD deflection in every frontopolar row (Fp1-F3, Fp2-F4, Fp1-F7, Fp2-F8); rapid onset, ~200 ms. The eye is a dipole with a positive cornea, so lid closure drives Fp1/Fp2 positive — and because EEG is displayed negative-up, positive reads downward. Blinking needs an awake patient with the eyes open — selecting this switches Background State to Awake and Eyes Open on.' },
      { id: 'eye-movement', name: 'Lateral Eye Movement',  desc: 'Slow opposite-polarity deflections at F7 vs F8 from horizontal gaze shift. These are the gaze shifts of an awake patient — drowsiness and REM have their own eye-movement toggles — so selecting this switches Background State to Awake.' },
      { id: 'eye-opening',  name: 'Eye Opening / Closing',  desc: 'The slow ocular deflection of opening the eyes on command and closing them again. Opening sweeps the positive cornea downward away from Fp1/Fp2, so the frontopolar rows deflect UPWARD — the mirror of a blink, and smaller. Closing gives a smaller downward transient a few seconds later. Transverse Fp1-Fp2 largely cancels it, as with a blink. Done on command by an awake patient whose eyes start closed — selecting this switches Background State to Awake and Eyes Open (with Eye Blink) off.' },
      { id: 'muscle',       name: 'Muscle (EMG)',           desc: 'Real scalp EMG is broadband, roughly 20-300 Hz "fuzz" from contracting muscle. What reaches this display is narrower on two counts: the engine samples at 250 Hz, so nothing above 125 Hz can exist at all, and the 100 Hz amplifier low-pass then rolls off most of what is left above it — so read this as roughly 20-100 Hz. Which muscle decides which channels are ruined: temporalis (jaw) at T3/T4 and F7/F8, and it can be one-sided; frontalis (brow) at Fp1/Fp2; nuchal (neck) at O1/O2 and T5/T6, where it buries the posterior rhythm and can mimic posterior sharp waves. Select the muscle group and severity once the toggle is on. Near-absent in REM sleep (atonia): selecting this in REM switches Background State to Awake.' },
      { id: 'chewing',      name: 'Chewing Artifact',       desc: 'Bursts of very fast muscle (EMG) activity, one per jaw closure, repeating at the chewing rate (~1.5 per second) in runs of a few chews. Both temporal regions burst together (largest at T3/T4 and F7/F8, smaller on every other chain), with quiet background between bursts. Told from generalized paroxysmal fast activity by being faster and larger. It is not a slow wave: the synchronous delta that often accompanies chewing is a separate artifact, from tongue movement (glossokinetic). A waking behaviour — selecting this switches Background State to Awake.' },
      { id: 'electrode-pop',name: 'Electrode Pop',          desc: 'Single-electrode transient: an abrupt step followed by exponential RC decay, with no smooth field to its neighbours — that spatial discontinuity is how a bad electrode is told from a real generator. Choose which electrode pops, or detach it: contact fails with a pop and the electrode then stays isoelectric until you reattach it.' },
      { id: 'bad-electrodes',name: 'Bad Electrodes',       desc: 'Pre-existing poor contact, drawn per subject: one or more electrodes recording with 3-9x the noise floor, occasionally one flat (no contact) or intermittent (drifting in and out). A noisy electrode ruins the TWO bipolar rows that share it, which is how you localise the electrode rather than the brain. Off by default so the normal record is clean; the same subject always draws the same bad electrodes.' },
      { id: 'sweat',        name: 'Sweat Artifact',         desc: 'Very slow (under 0.5 Hz), low-amplitude rolling of the baseline, from sweat on the skin under the electrodes. Drawn here over the forehead; on a real record it can be bilateral, one-sided or confined to a few electrodes.' },
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
      { id: 'gen-slowing',         name: 'Generalised Slowing',        desc: 'Moderate grade: diffuse, symmetric theta with admixed delta replacing the normal background; the PDR slows to theta fragments and the A–P gradient is lost. Seen with encephalopathy, medications.' },
      { id: 'focal-delta-temporal',name: 'Focal Δ (L. Temporal)',      desc: 'Intermittent polymorphic delta activity over the left temporal region, largest at T3 and reaching the left central rows; structural lesion until proven otherwise.' },
      { id: 'firda',               name: 'FIRDA',                       desc: 'Frontal intermittent rhythmic delta activity (2-3 Hz) — in current ACNS terms, generalized rhythmic delta activity with frontal predominance. Bursts of smooth rhythmic delta on both sides at once, largest on the frontopolar rows and gone by the back of the head; associated with encephalopathy and raised ICP.' },
      { id: 'triphasic',           name: 'Triphasic Waves',            desc: 'Periodic triphasic complexes a little over once a second, generalised and anteriorly predominant, each arriving about a tenth of a second later at the back of the head than at the front; metabolic encephalopathy (hepatic, uraemic). Phases are −/+/− by scalp potential, and the dominant middle phase is the positive one — so on screen the big excursion is DOWNWARD, between two smaller upward phases.' },
      { id: 'gpeds',               name: 'GPEDs',                      desc: 'Generalised periodic epileptiform discharges (GPDs): the same spike/sharp wave on every chain, both sides at once, about every 1.5 s at a near-constant interval; CJD, anoxia, severe encephalopathy.' },
      { id: 'lpeds',               name: 'LPEDs (L. Temporal)',        desc: 'Lateralised periodic epileptiform discharges (LPDs): a sharp wave and its slow wave about once a second at a near-constant interval, largest over the left temporal region and reaching the left central rows, with nothing on the right; herpes encephalitis, stroke.' },
    ],
  },
  {
    id: 'epileptiform',
    name: 'Interictal Epileptiform',
    color: '#f87171',     // red
    group: 'Abnormal / Epileptiform',
    patterns: [
      { id: 'focal-spikes-lt',   name: 'L. Temporal Spike-Wave', desc: 'Focal interictal discharge at T3/F7 with negative phase reversal and obligatory following slow wave; temporal lobe epilepsy. This one teaches localisation (where the phase reversal sits); for the spike-vs-sharp morphology distinction see the four patterns below. Focus moves the source midway between F7 and T3 instead: the F7-T3 link then goes flat (an isopotential — both ends see the same voltage) while Fp1-F7 and T3-T5 deflect in opposite directions, the other way a bipolar chain localises a focus.' },
      { id: 'focal-spikes-rt',   name: 'R. Temporal Spike-Wave', desc: 'Focal interictal discharge at T4/F8 with negative phase reversal and following slow wave; the mirror of the left temporal focus. Focus moves the source midway between F8 and T4: F8-T4 goes flat (isopotential) and Fp2-F8 and T4-T6 oppose.' },
      { id: 'focal-spikes-lf',   name: 'L. Frontal Spike-Wave',  desc: 'Focal interictal discharge at F3/Fp1 with following slow wave; frontal lobe epilepsy. Focus moves the source midway between F3 and C3: F3-C3 goes flat (isopotential) and Fp1-F3 and C3-P3 oppose.' },
      // Morphology set (IK-012): the four waveforms told apart by duration and by
      // whether an after-going slow wave follows. All at a left-temporal focus.
      { id: 'ied-spike',         name: 'Spike (20-70 ms)',       desc: 'A single pointed transient, 20-70 ms at its base, surface-negative (renders UPWARD), with NO after-going slow wave. Duration is what separates it from a sharp wave. At the T3 focus.' },
      { id: 'ied-spike-wave',    name: 'Spike-and-Slow-Wave',    desc: 'A spike (20-70 ms) immediately followed by an after-going slow wave of the same polarity — surface-negative, so spike and wave both point UP on a referential montage; the wave follows at once, peaks about a tenth of a second after the spike and is over within about 0.3 s. The slow wave is what makes it a complex rather than a bare spike. At the T3 focus.' },
      { id: 'ied-sharp',         name: 'Sharp Wave (70-200 ms)', desc: 'A single pointed transient, 70-200 ms at its base — broader than a spike but the same surface-negative pointed shape — with NO after-going slow wave. At the T3 focus.' },
      { id: 'ied-sharp-wave',    name: 'Sharp-and-Slow-Wave',    desc: 'A sharp wave (70-200 ms) followed by an after-going slow wave of the same polarity, the longer-duration counterpart of the spike-and-slow-wave complex. At the T3 focus.' },
      { id: '3hz-gsw',           name: '3 Hz Gen. Spike-Wave', desc: 'Generalised 3 Hz spike-wave; pathognomonic of absence epilepsy when continuous; also seen as interictal burst.' },
      { id: 'polyspike-wave',    name: 'Polyspike-Wave',       desc: 'Multiple spikes (3-5) followed by slow wave; generalised; juvenile myoclonic epilepsy pattern.' },
      { id: 'burst-suppression', name: 'Burst Suppression',    desc: 'Alternating high-amplitude bursts and near-flat suppression; deep anaesthesia or severe anoxic brain injury.' },
      { id: 'hypsarrhythmia',    name: 'Hypsarrhythmia',       desc: 'Chaotic, very high-amplitude multifocal spikes/sharp waves and slow waves; no organised background; West syndrome. Too large to read at 7 µV/mm — lower the sensitivity to 30 µV/mm or so, as a real record of it is read.' },
    ],
  },
  {
    id: 'ictal',
    name: 'Ictal / Seizures',
    color: '#e879f9',     // purple
    group: 'Abnormal / Epileptiform',
    patterns: [
      { id: 'absence-ictal',       name: 'Absence Seizure',       desc: '3 Hz generalised spike-wave on every chain, largest frontally: sudden onset and abrupt offset; 5-15 s; no post-ictal slowing — the background is back at once; consciousness impaired.' },
      { id: 'gtc-ictal',           name: 'Gen. Tonic-Clonic',     desc: 'Tonic phase: about 10 s of fast activity that builds → clonic phase: about 45 s of spike-wave slowing from 3 to 1.5 Hz → about 35 s of post-ictal suppression, then recovery. It runs two minutes, about as long as a real one. Muscle artifact covers the tonic phase and comes as a burst with each clonic jerk, as on a real record; switch Muscle artifact off under the toggle to see the rhythm of the seizure itself.' },
      { id: 'focal-temporal-ictal',name: 'Focal Temporal Sz.',    desc: 'Rhythmic theta onset in the selected temporal lobe (see Hemisphere), evolving in frequency and amplitude; late contralateral spread. With Focus under the electrode it holds a phase reversal at T3 (or T4) throughout; with Focus between two, the onset sits midway between F7 and T3 (F8 and T4) and that link stays flat — an isopotential — while the links either side oppose.' },
      { id: 'focal-frontal-ictal', name: 'Focal Frontal Sz.',     desc: 'Low-voltage fast onset in the selected frontal lobe (see Hemisphere), rapidly evolving; often nocturnal, short, multiple daily. Focus between two puts the onset midway between F3 and C3 (F4 and C4): that link stays flat (isopotential) and its neighbours oppose.' },
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
