/**
 * The text of the information panel (InfoPanel.tsx), one entry per toggle in
 * patterns.ts: what the pattern is, and where and when a reader meets it.
 *
 * Written 2026-11-16 to agree with the pattern descriptions in patterns.ts and the
 * entries of INFORMING-KNOWLEDGE.md; where a number is given it is the one those
 * already use. If a pattern's model changes, its text here is part of the change.
 * The gate checks only that every toggle has an entry.
 */
export type PatternInfo = {
  /** What it is: morphology, field, and what it means. */
  summary: string;
  /** Which states and circumstances it is seen in, and what it is mistaken for. */
  seenIn: string;
};

export const PATTERN_INFO: Record<string, PatternInfo> = {
  // ── Sleep architecture ─────────────────────────────────────────────────────
  'posts': {
    summary: 'Positive occipital sharp transients of sleep: small triangular, "sail-like" waves, 80-200 ms long, over both occiputs. They are surface-positive, so they point down in a referential montage and up on the double banana, where O1/O2 is the second input of the last link of each posterior chain. They are bilateral but need not be symmetric — one side is often smaller — and come singly at irregular intervals or in short trains.',
    seenIn: 'Light sleep: they appear in N1 and persist into N2, becoming less common in deeper sleep and rare in REM. Common in young adults. Their waking counterpart is the lambda wave, which needs open eyes and a patterned field; their sharp shape at the occiput is the trap — they are normal and should not be read as occipital spikes.',
  },
  'v-waves': {
    summary: 'Vertex sharp waves: surface-negative sharp waves of about 100 ms (under half a second in all) maximal at the vertex and over both central regions. On a bipolar chain they phase-reverse at Cz on the midline and at C3/C4 on the parasagittal chains. They come alone or in short runs, varying in size and shape.',
    seenIn: 'N1, where they are one of the signs of sleep onset, persisting into N2. Large and sharply contoured in children, where they are easily mistaken for central spikes; their symmetry and vertex maximum are what identify them.',
  },
  'k-complex': {
    summary: 'A high-amplitude, well-delineated surface-negative sharp wave immediately followed by a slower positive wave, at least half a second in all, often preceded by a small positivity and often followed by a sleep spindle. It is frontally maximal but seen on every chain.',
    seenIn: 'A defining graphoelement of N2, occurring spontaneously or evoked by a sound. It can persist into N3. A K-complex arising from N2 with an arousal is still normal; a sharp, focal or asymmetric one is not.',
  },
  'spindles': {
    summary: 'Waxing and waning bursts of 11-16 Hz activity lasting half a second to two seconds, symmetric between the hemispheres. Slower spindles (11-13 Hz) are frontal; faster ones (13-15 Hz) centro-parietal.',
    seenIn: 'A defining graphoelement of N2, persisting less prominently into N3. Asynchronous spindles are normal in infants; persistently asymmetric or absent spindles in an older child or adult point to a lesion on the quieter side.',
  },
  'slow-waves': {
    summary: 'Deep NREM sleep: high-amplitude (over 75 µV) delta at 0.5-2 Hz occupying at least a fifth of the page, synchronized and diffuse but frontally predominant. Spindles and K-complexes may persist or fade.',
    seenIn: 'N3, mostly in the first third of the night and most abundant in children. It is the background, not a transient, so the record is staged N3 by how much of the page it fills. In an awake patient, the same delta would be pathological slowing.',
  },
  'roving-eyes': {
    summary: 'Very slow (about 0.1-0.3 Hz) horizontal eye movements: smooth, opposing undulations at F7 and F8 from the swinging corneo-retinal dipole, with no blink and no sharp component.',
    seenIn: 'Drowsiness and N1, as one of the earliest signs of sleep onset; they disappear in deeper sleep. Their slowness and opposite polarity at F7 and F8 distinguish them from frontal slowing.',
  },
  'rem-eyes': {
    summary: 'Rapid eye movements: sharply contoured, opposing deflections at the lateral frontal leads (F7 against F8), with a faster upslope than downslope, arriving in bursts. Each is led by a lateral rectus spike at F7 or F8 on the side the eyes turn toward.',
    seenIn: 'REM sleep, together with a low-voltage mixed-frequency background and near-absent muscle tone. They identify REM, whose background alone resembles N1. Similar movements in an awake patient are ordinary saccades.',
  },

  // ── Benign variants ────────────────────────────────────────────────────────
  'mu-rhythm': {
    summary: 'An arch-shaped (comb-like) 8-12 Hz rhythm over the central regions (C3/C4), pointed on its negative side. It is blocked by movement, or the thought of movement, of the opposite hand, not by eye opening.',
    seenIn: 'Wakefulness, in a minority of people and often on one side or asymmetric. It persists with the eyes open, which is how it is told from the posterior alpha rhythm, and it is a normal finding, not a sign of epilepsy.',
  },
  'wicket': {
    summary: 'Arch-shaped (arciform) waves of 6-11 Hz over the temporal region, pointed on their surface-negative side, coming singly or in runs from a few waves to several seconds that wax and wane. The waves of a run vary a little in height and shape, and the neighbouring temporal links carry them at different sizes. There is no after-going slow wave and no disturbance of the background.',
    seenIn: 'Mostly drowsiness and light sleep, also relaxed wakefulness, in adults over about 30. A single wicket is the classic mimic of a temporal spike: the absence of a following slow wave, and its resemblance to the sharper waves of a run on the same record, mark it as benign.',
  },
  'rmtd': {
    summary: 'Rhythmic mid-temporal theta of drowsiness: trains of 5-7 Hz theta at one frequency, arch-shaped and often notched, lasting 2-10 s over T3/T4, on one side or on both out of step. It does not evolve in frequency, amplitude or field.',
    seenIn: 'Drowsiness and light sleep, occasionally relaxed wakefulness, in adolescents and adults. The lack of evolution is what separates it from a temporal lobe seizure; it is benign.',
  },
  'lambda': {
    summary: 'Occipital sharp transients, surface-positive like POSTS, time-locked to saccades while the eyes scan a patterned visual field. They point down on a referential row and up on the double banana, and are usually bilateral, often asymmetric.',
    seenIn: 'Wakefulness with the eyes open and looking at something with detail (reading, a busy scene); they vanish with the eyes closed or on a blank field. Most common in children and young adults; their sleep counterpart is POSTS.',
  },
  'pswy': {
    summary: 'Posterior slow waves of youth: isolated 2.5-4.5 Hz slow waves riding within the posterior alpha rhythm, which carries on around them. Often on both sides, sometimes one, and they attenuate with eye opening along with the alpha.',
    seenIn: 'Awake with the eyes closed, in children and young adults (about 4-25 years); they fade with age. Normal: they should not be read as posterior slowing, which disrupts the alpha rhythm rather than sitting within it.',
  },
  'slow-fused': {
    summary: 'A sharply contoured wave of the posterior alpha rhythm falls just before a posterior slow wave of youth, and the pair looks like a spike-and-slow-wave complex. It is not epileptiform: elsewhere on the same record the sharp wave and the slow wave occur apart.',
    seenIn: 'Young people awake with the eyes closed, alongside ordinary posterior slow waves of youth. Seeing the two parts separately on the page is how it is told from a real occipital discharge.',
  },
  '6hz-sw': {
    summary: 'Brief (1-2 s) bilateral, synchronous runs of 5-7 Hz spike-and-wave. In the FOLD form (female, occipital, low-amplitude, drowsy) the spike is tiny and easy to miss, hence "phantom". The WHAM form (waking, high-amplitude, anterior, male) has a larger anterior spike.',
    seenIn: 'FOLD in drowsiness, and benign. WHAM in relaxed wakefulness as well as drowsiness, and associated with epilepsy, so the form matters. Both disappear in deeper sleep.',
  },
  '14-6-pos': {
    summary: 'Arch-shaped bursts at 14 Hz and/or 6 Hz with pointed surface-positive peaks over the posterior temporal region, lasting about half a second to two seconds. The side can shift from burst to burst or be bilateral, depending on the source the toggle follows.',
    seenIn: 'Drowsiness and light sleep, mostly in adolescents. Benign; once linked to autonomic symptoms and behaviour problems, an association no longer accepted. Best seen on ear-referenced montages.',
  },
  'bets': {
    summary: 'Small sharp spikes (benign epileptiform transients of sleep): very brief (under 50 ms), low-amplitude (under 50 µV) temporal spikes, mono- or diphasic with a steep descending limb, sometimes followed by a small slow wave, leaving the background undisturbed.',
    seenIn: 'Drowsiness and light sleep in adults; they disappear in deeper sleep. Benign: their small size, brevity and lack of a disturbed background distinguish them from interictal spikes.',
  },
  'midline-theta': {
    summary: 'Trains of 4-7 Hz arch-shaped or sinusoidal theta over the vertex (Cz, with Fz), lasting from a moment to several seconds (Cigánek rhythm).',
    seenIn: 'Wakefulness and drowsiness, most often in drowsiness or during mental tasks. A normal variant; it does not evolve as a midline seizure would.',
  },
  'breach': {
    summary: 'Over a skull defect (craniotomy, burr hole, fracture) the bone no longer filters the brain\'s activity, so the electrode there records it larger (up to about three times the other side), faster and spikier — mostly beta with sharp alpha or mu. It stops at the edge of the defect, so on a bipolar montage only the two rows sharing that electrode change.',
    seenIn: 'Any state, in a patient with a skull defect; the history explains it. It is not epileptiform, though its sharp waves can look it; a real abnormality near a breach is judged against the breach, not the other side.',
  },
  'eyes-open': {
    summary: 'Opening the eyes blocks the posterior alpha rhythm (the Berger effect, "alpha blocking") and leaves a lower-amplitude, faster background. Central mu is not affected — it blocks with movement instead.',
    seenIn: 'Wakefulness. Reactivity to eye opening is part of describing every awake record: alpha that fails to attenuate, or attenuates on one side only, is a finding. The page is labelled "Eyes open" while it lasts.',
  },

  // ── Artifacts ──────────────────────────────────────────────────────────────
  'blink': {
    summary: 'A large downward deflection on every frontopolar row (Fp1-F3, Fp2-F4, Fp1-F7, Fp2-F8), decaying down each chain, 0.2-0.5 s long, followed by a smaller opposite recovery swing. The cornea is positive, so lid closure drives Fp1/Fp2 positive, which reads downward. Blinks vary in width, and each carries a little fast muscle activity from the orbicularis oculi contraction that closes the lid.',
    seenIn: 'Wakefulness with the eyes open; blinking slows in drowsiness and stops in sleep. Its bifrontal field with nothing behind it, and the absence of a spike, separate it from frontal slowing or discharges.',
  },
  'eye-flutter': {
    summary: 'Rapid repeated fluttering of the eyelids: a run of blink-like positive deflections, about 3-4 a second, down on the frontopolar rows and confined to the frontal leads, with no spike underneath.',
    seenIn: 'Wakefulness, often on eye closure or with anxiety. It mimics frontal rhythmic delta or frontal spike-and-wave; the lack of a spike and the purely frontopolar field identify it.',
  },
  'eye-movement': {
    summary: 'Horizontal gaze shifts: slow, opposite-polarity deflections at F7 and F8 (the cornea approaching one side and leaving the other), each led by a brief lateral rectus muscle spike at F7 or F8 on the side the eyes turn toward.',
    seenIn: 'Wakefulness, whenever the patient looks around. Drowsiness has its own slow roving movements and REM its own rapid ones. The opposing F7/F8 field is what distinguishes it from a temporal or frontal slow wave.',
  },
  'eye-opening': {
    summary: 'The slow ocular deflection of opening the eyes on command and closing them again. Opening sweeps the positive cornea away from Fp1/Fp2, so the frontopolar rows deflect upward — the mirror of a blink, and smaller; closing gives a smaller downward transient. The posterior alpha rhythm blocks while the eyes are open.',
    seenIn: 'Wakefulness, as the routine eye-opening manoeuvre that tests alpha reactivity. Transverse Fp1-Fp2 largely cancels it, as with a blink.',
  },
  'muscle': {
    summary: 'Electromyographic "fuzz": dense, very fast activity from contracting scalp muscles. Which muscle decides which channels are ruined: temporalis (jaw) at T3/T4 and F7/F8, frontalis (brow) at Fp1/Fp2, neck muscles at O1/O2 and T5/T6. Lowering the high cut makes it look smoother — and can make it look like beta or spikes.',
    seenIn: 'Wakefulness, especially in a tense or uncomfortable patient; it fades with relaxation and drowsiness and nearly disappears in REM sleep (atonia). It can bury the background, and its sharp single motor-unit potentials can mimic spikes.',
  },
  'chewing': {
    summary: 'Bursts of very fast muscle activity, one per jaw closure, repeating at about 1.5 per second in runs of a few chews, largest over both temporal regions with quiet background between bursts.',
    seenIn: 'Wakefulness, while eating or chewing gum, and as rhythmic jaw movements in some patients. Its regular rhythm can suggest a seizure; the very fast frequency and temporal muscle field identify it.',
  },
  'electrode-pop': {
    summary: 'A single-electrode transient: an abrupt step followed by an exponential decay, with no field spreading to the neighbouring electrodes. On a bipolar montage it appears on exactly the two rows sharing that electrode, in opposite directions.',
    seenIn: 'Any state, from a drying or loose electrode. The lack of a physiological field — nothing at the neighbours — is how it is told from a spike.',
  },
  'bad-electrodes': {
    summary: 'Pre-existing poor contact: one or more electrodes recording with several times the noise floor, occasionally one flat or drifting in and out. A noisy electrode spoils the two bipolar rows that share it.',
    seenIn: 'Any state, on any real record; localising the electrode (not the brain) from the pair of rows it spoils is the skill. Reapplying the electrode fixes it.',
  },
  'sweat': {
    summary: 'Very slow (under 0.5 Hz), low-amplitude rolling of the baseline, from sweat changing the skin\'s potential under the electrodes. Shown here over the forehead.',
    seenIn: 'Any state, in a warm room or a febrile or anxious patient. It can mimic frontal delta; its extreme slowness and lack of any sharp component identify it. A higher low-cut filter reduces it.',
  },
  'ecg-artifact': {
    summary: 'QRS complexes volume-conducted from the heart onto the scalp: sharp, strictly regular transients at the heart rate, largest on the low temporal and ear-referenced chains and slightly larger on the left.',
    seenIn: 'Any state, especially in short or obese necks and on ear references. Check that each transient lines up with an R wave on the ECG channel: that alone tells it from a periodic discharge.',
  },
  'movement': {
    summary: 'Rare, very large broadband transients from head or body movement, 0.2-1 s, frontally predominant, often driving several channels off-scale at once, with no consistent shape and no smooth field.',
    seenIn: 'Wakefulness and arousals from sleep. Its size, chaos and lack of a field mark it as artifact; a video or technologist note confirms it.',
  },
  '50hz': {
    summary: 'Mains (AC line) interference: very fast, monotonous activity at the mains frequency — 50 Hz in India, Britain and most of the world, 60 Hz in the Americas. It is uneven across the page and worst on the rows of a poorly connected electrode. The notch filter in the top bar removes it.',
    seenIn: 'Any state, near electrical equipment or with high electrode impedance. It is not biological. Re-gelling the electrode is the fix; the notch is kept off by default and used only when that fails, because it can distort or blunt spikes.',
  },

  // ── Non-epileptiform abnormalities ─────────────────────────────────────────
  'gen-slowing': {
    summary: 'Diffuse, symmetric theta with admixed delta replacing the normal background; the posterior rhythm slows to theta fragments and the antero-posterior gradient is lost.',
    seenIn: 'In wakefulness, a sign of encephalopathy (toxic, metabolic, medication) or diffuse cerebral dysfunction. The same slowing is normal in drowsiness and sleep, so it is judged only in a patient known to be awake.',
  },
  'focal-delta-temporal': {
    summary: 'Intermittent polymorphic (irregular) delta over the left temporal region, largest at T3 and reaching the left central rows, persisting through state changes.',
    seenIn: 'Any state, in a patient with a structural lesion (stroke, tumour, abscess, contusion) under that region until proven otherwise. Continuous polymorphic delta is more strongly associated with a lesion than intermittent.',
  },
  'firda': {
    summary: 'Frontal intermittent rhythmic delta activity: bursts of smooth, rhythmic 2-3 Hz delta on both sides at once, largest frontally and gone at the back of the head (in current ACNS terms, generalized rhythmic delta with frontal predominance).',
    seenIn: 'Wakefulness, in encephalopathy, raised intracranial pressure or deep midline lesions. It attenuates with alerting and must be told from normal drowsy slowing and eye-movement artifact.',
  },
  'triphasic': {
    summary: 'Periodic complexes a little over once a second, generalized and anteriorly predominant, with three phases (−/+/−). The dominant middle phase is positive, so the big excursion is downward, and each complex arrives slightly later at the back of the head than at the front.',
    seenIn: 'A reduced level of consciousness in metabolic encephalopathy, classically hepatic or uraemic, and some drug toxicities. They can resemble periodic epileptiform discharges; the clinical context decides.',
  },
  'gpeds': {
    summary: 'Generalized periodic discharges: the same spike or sharp wave on every chain, both sides at once, recurring at a near-constant interval (here about every 1.7 s).',
    seenIn: 'Severe diffuse brain injury: anoxia after cardiac arrest, Creutzfeldt-Jakob disease, severe encephalopathy, and some drug toxicities, usually in a comatose or obtunded patient. They lie on the ictal-interictal continuum.',
  },
  'lpeds': {
    summary: 'Lateralized periodic discharges: a sharp wave and its slow wave about once a second at a near-constant interval, largest over the left temporal region and reaching the left central rows, with nothing on the right.',
    seenIn: 'Acute or subacute focal brain injury: herpes simplex encephalitis, stroke, tumour, often with focal seizures. They carry a high risk of seizures and lie on the ictal-interictal continuum.',
  },

  // ── Interictal epileptiform ────────────────────────────────────────────────
  'focal-spikes-lt': {
    summary: 'Focal interictal spike-and-wave at T3/F7: a surface-negative spike with an after-going slow wave, phase-reversing at the focus on the left temporal chain. With the focus moved between F7 and T3, the link joining them goes flat (isopotential) while its neighbours deflect in opposite directions.',
    seenIn: 'Temporal lobe epilepsy, in wakefulness and more often in drowsiness and NREM sleep, which activate them. Location is read from the phase reversal (or the isopotential link).',
  },
  'focal-spikes-rt': {
    summary: 'Focal interictal spike-and-wave at T4/F8, phase-reversing at the focus on the right temporal chain — the mirror of the left temporal focus. With the focus between F8 and T4, F8-T4 goes flat while Fp2-F8 and T4-T6 oppose.',
    seenIn: 'Right temporal lobe epilepsy, activated by drowsiness and NREM sleep. Independent left and right temporal spikes together suggest bitemporal epilepsy.',
  },
  'focal-spikes-lf': {
    summary: 'Focal interictal spike-and-wave at F3, phase-reversing between Fp1-F3 and F3-C3. With the focus between F3 and C3, F3-C3 goes flat and Fp1-F3 and C3-P3 oppose.',
    seenIn: 'Frontal lobe epilepsy, often in sleep. Frontal discharges can spread quickly and look generalized (secondary bilateral synchrony).',
  },
  'ied-spike': {
    summary: 'A single pointed surface-negative transient 20-70 ms at its base, with no after-going slow wave. Its duration is what makes it a spike rather than a sharp wave. Shown at a left temporal focus.',
    seenIn: 'Interictal records of focal epilepsy, more often in drowsiness and sleep. A spike with no slow wave and no background disturbance should be weighed carefully against benign sharp transients.',
  },
  'ied-spike-wave': {
    summary: 'A spike (20-70 ms) immediately followed by an after-going slow wave of the same (negative) polarity, so both point up on a referential montage. The slow wave makes it a complex rather than a bare spike and strengthens its epileptiform reading.',
    seenIn: 'Interictal records of focal epilepsy, activated by drowsiness and NREM sleep. Shown at a left temporal focus.',
  },
  'ied-sharp': {
    summary: 'A single pointed surface-negative transient 70-200 ms at its base — broader than a spike but the same shape — with no after-going slow wave. Shown at a left temporal focus.',
    seenIn: 'Interictal records of focal epilepsy, in the same circumstances as spikes; the spike-versus-sharp distinction is one of duration, not of significance.',
  },
  'ied-sharp-wave': {
    summary: 'A sharp wave (70-200 ms) followed by an after-going slow wave of the same polarity: the longer counterpart of the spike-and-slow-wave complex. Shown at a left temporal focus.',
    seenIn: 'Interictal records of focal epilepsy, activated by drowsiness and NREM sleep.',
  },
  '3hz-gsw': {
    summary: 'Generalized 3 Hz spike-and-wave: regular, bilaterally synchronous complexes, frontally maximal, on every chain.',
    seenIn: 'Childhood and juvenile absence epilepsy. Brief bursts are interictal; runs of several seconds are absence seizures. Hyperventilation provokes it, and in sleep it fragments into shorter, less regular bursts.',
  },
  'polyspike-wave': {
    summary: 'Generalized bursts of several spikes (2-5) followed by a slow wave, bilaterally synchronous and frontally predominant.',
    seenIn: 'Generalized epilepsies with myoclonus, classically juvenile myoclonic epilepsy, often on awakening and with photic stimulation; enhanced by sleep deprivation.',
  },
  'burst-suppression': {
    summary: 'Alternating high-amplitude bursts of mixed activity and periods of near-flat suppression, recurring through the record.',
    seenIn: 'Deep anaesthesia, barbiturate or propofol coma, hypothermia, and severe anoxic brain injury. In a patient off sedation it carries a poor prognosis; in neonates a related pattern defines certain encephalopathies.',
  },
  'hypsarrhythmia': {
    summary: 'A chaotic, very high-amplitude background of multifocal spikes, sharp waves and slow waves, with no organized rhythm and no consistent field. It is too large to read at 7 µV/mm; lower the sensitivity to around 30 µV/mm.',
    seenIn: 'Infants with West syndrome (infantile spasms), typically 3-12 months. In sleep it often fragments into bursts separated by attenuation.',
  },

  // ── Ictal ──────────────────────────────────────────────────────────────────
  'absence-ictal': {
    summary: 'A run of regular 3 Hz generalized spike-and-wave on every chain, largest frontally, beginning and ending abruptly, lasting 5-15 s, with the background back at once afterwards (no post-ictal slowing).',
    seenIn: 'Absence epilepsy, with brief impairment of awareness; often provoked by hyperventilation. Unlike a focal seizure it has no evolution of field and no post-ictal change.',
  },
  'gtc-ictal': {
    summary: 'A generalized tonic-clonic seizure: a tonic phase of fast activity that builds, a clonic phase of spike-wave slowing from 3 to 1.5 Hz, then post-ictal suppression and gradual recovery. Muscle artifact covers the tonic phase and bursts with each clonic jerk.',
    seenIn: 'Generalized epilepsy, or a focal seizure that becomes bilateral. On real records muscle and movement often obscure the EEG; switching muscle artifact off under the toggle shows the rhythm itself.',
  },
  'focal-temporal-ictal': {
    summary: 'A focal temporal seizure: rhythmic theta arising in one temporal lobe that evolves in frequency, amplitude and field, with late spread to the other side. Evolution is the defining feature of a seizure.',
    seenIn: 'Temporal lobe epilepsy, from wakefulness or sleep, often with an aura and impaired awareness. Post-ictal slowing on the side of onset helps lateralize it.',
  },
  'focal-frontal-ictal': {
    summary: 'A focal frontal seizure: a low-voltage fast onset in one frontal lobe that evolves rapidly.',
    seenIn: 'Frontal lobe epilepsy, typically brief, often from sleep, and frequently obscured by muscle and movement artifact on a real record.',
  },

  // ── Activation ─────────────────────────────────────────────────────────────
  'photic': {
    summary: 'Intermittent photic stimulation: a strobe stepped through 1-30 Hz. The normal photic driving response is rhythmic activity over O1/O2 time-locked to the flashes, at the flash rate and its harmonics, best between 8 and 20 Hz.',
    seenIn: 'Wakefulness, during routine activation. A clearly asymmetric driving response, or a photoparoxysmal response (generalized spike-wave provoked by the flashes), is abnormal.',
  },
  'hyperventilation': {
    summary: 'Three minutes of overbreathing produce a build-up of generalized rhythmic slowing — theta deepening into delta, frontally predominant in adults — that resolves within about a minute of stopping.',
    seenIn: 'Wakefulness, during routine activation. A build-up is normal, more marked in children and young adults; persistence long after stopping, asymmetry, or provoked spike-and-wave (absence) is abnormal.',
  },
};
