# Study report — learningeeg.com

A deep read of **learningeeg.com** (David Valentine MD, 2020–2026), a free EEG curriculum
"for everyone." Terminology and criteria follow **ACNS**, **ILAE**, and **IFCN**; 7 peer‑reviewed
references (2013–2021). This is my distillation of the teaching content, organised the way the
site is, with the concrete numbers preserved. A closing section maps it onto our simulator.

> Scope note: these are *my study notes from a third‑party site*, not vetted ground truth. Nothing
> here has been added to [INFORMING-KNOWLEDGE.md](INFORMING-KNOWLEDGE.md) — where a fact looks
> worth promoting to an `IK-` entry, I flag it in §14 for a later `/ik` pass.

---

## Site structure

Three learning surfaces, all built on the same 12 topics:

1. **Chapters** — sequential prose with annotated waveform images and embedded self‑assessment.
2. **Quiz** — multiple‑choice with immediate feedback.
3. **Atlas** — a searchable *visual index* of every waveform, browsable across chapters rather than
   linearly. Categories mirror the chapters (Foundations → Seizures).

Audience is explicitly broad: hobbyists, technicians, students, residents, fellows, attendings.

The 12 chapters: Physiology & Terminology · 10‑20 & Montages · Normal Awake · Normal Asleep ·
Artifacts · Normal Variants · Neonatal · Pediatric · Non‑Epileptiform Abnormalities ·
Epileptiform Discharges · Rhythmicity/Periodicity & the IIC · Seizures.

---

## 1. Physiology & terminology

- **Detectability floor:** scalp EEG needs **≥ 6 cm²** of synchronously active cortex. This is why
  we localise to *regions*, not lobes.
- **Cellular basis:** resting potential **−70 mV**, held by the 3 Na⁺‑out / 2 K⁺‑in pump.
  Depolarisation (Na⁺ in, driven by glutamate EPSPs) vs. hyperpolarisation (K⁺ out, GABA IPSPs).
- **The depth/polarity trap:** *surface* depolarisation → **negative** scalp signal; *deep*
  depolarisation → **positive**. So "surface EPSP" and "deep IPSP" look identical, as do "deep EPSP"
  and "surface IPSP." Polarity alone can't tell you the physiology.
- **Display convention:** **negative = up, positive = down.**
- **Dipoles:** only dipoles **perpendicular to cortex** are seen well; tangential/parallel ones are
  attenuated or missed. Dipole orientation can *falsely localise* (classically interhemispheric
  discharges appearing contralateral).
- **Frequency bands:** delta 0–4 Hz · theta 4–8 · alpha 8–13 · beta 13–30 · gamma 30+ (gamma not
  reliably physiologic on scalp). **Amplitude is inversely related to frequency.** Normal adult
  scalp amplitude **10–100 µV** (mostly 10–50).
- **Morphology:** mono‑/bi‑/tri‑/polyphasic (baseline crossings). **Polymorphic** (varying) vs.
  **monomorphic** (uniform). Focal polymorphic slowing = structural.
- **Rhythmicity vs. periodicity:** both need **≥ 6 continuous cycles**. *Periodic* = discrete
  discharges with gaps; *rhythmic* = continuous. Interval variance 25–50% → "quasi‑"; > 50% → neither.

## 2. The 10‑20 system & montages

- **10‑20** = proportional placement (10% / 20% of nasion–inion & other landmarks), scaling to head
  size. Letters = region (F/T/C/P/O), **odd = left, even = right, z = midline**.
- **Gotcha:** **F7/F8**, though "frontal," actually overlie the **anterior temporal** region.
  T1/T2 = subtemporal; A1/A2 = ear (reference). 10‑10 system adds density.
- **Bipolar montage:** chain of adjacent pairs (input1 − input2). **Input1 more positive → down;
  input2 more positive → up.**
  - **Phase reversal:** adjacent traces **point toward** the electrode of maximal voltage →
    localises it. Negative PR = traces point *toward*; positive PR = point *away*.
  - **Double banana** (standard): temporal chain Fp2‑F8‑T4‑T6‑O2 (outer) + parasagittal
    Fp2‑F4‑C4‑P4‑O2 (inner) + midline Fz‑Cz‑Pz.
  - **End‑of‑chain problem:** Fp1/Fp2/O1/O2 lack a neighbour on one side → only half a phase
    reversal; occipital discharges especially suffer.
  - Variants: circumferential, T1‑T2, **transverse** (left↔right; good for lateralising).
- **Referential montage:** all electrodes vs. one reference (average, or quiet ear A1/A2).
  **Every up wave is negative, every down wave is positive — no phase reversals.** Best for reading
  amplitude/where voltage is maximal; worse for screening detection.
- **Technical defaults (adult):** page speed **30 mm/s** (neonatal 15), sensitivity **7 µV/mm**
  ("higher number = lower sensitivity"), LFF/high‑pass **0.5–1 Hz**, HFF/low‑pass **70 Hz**, notch
  **60 Hz** (US) / **50 Hz** (EU). Over‑filtering LFF kills delta; over‑filtering HFF kills beta and
  worsens muscle artifact.

## 3. Normal awake

- **Posterior dominant rhythm (PDR):** adult **8.5–12 Hz** (down to 8 in the elderly). Appears on
  **eye closure**, attenuates on **eye opening** (Berger effect / alpha reactivity). Up to **5%** of
  normals have no visible PDR.
  - **Symmetry rule:** abnormal if **> 50%** amplitude asymmetry **or > 1 Hz** frequency asymmetry.
    (A mild *left* amplitude reduction can be normal — skull thickness.)
  - Pitfalls: don't measure during the **"alpha squeak"** (brief speed‑up right after eye closure)
    or during drowsiness.
- **Background is judged on:** organisation + AP gradient, PDR, variability/reactivity, state.
  **AP gradient** = faster/lower‑amplitude anteriorly, slower/higher‑amplitude posteriorly.
  Healthy adult background has **no delta**.
- **Drowsiness:** mild diffuse slowing, fewer blinks, **roving eye movements**, emerging theta.
- **Activation:** **photic** → photic driving (background time‑locks to flash; harmonic driving to
  multiples); rare **photoparoxysmal response**. **Hyperventilation** → diffuse slowing; classically
  provokes **3 Hz spike‑wave absence**. HV contraindicated: age > 65, chronic lung disease, recent
  stroke/MI.

## 4. Normal asleep

- **N1:** loss of PDR, diffuse attenuation, theta. **POSTS** (Positive Occipital Sharp Transients of
  Sleep) — positive, "sail‑like," occipital; start in N1, persist later. **Vertex waves** — bilateral,
  phase‑reversing, central (Cz).
- **N2:** **sleep spindles 11–16 Hz** (thalamic reticular nucleus, central‑max; asymmetry/absence is
  abnormal). **K‑complexes** — high‑amplitude, initial negative then slow positive; often precede
  spindles; stimulus‑evocable.
- **N3 (slow‑wave):** **> 75 µV delta at 0.5–2 Hz**, synchronised; can be very high voltage in the
  young. Benzodiazepines/barbiturates reduce N3 proportion.
- **REM:** diffuse attenuation, mixed frequency resembling wake; **rapid, opposing frontal eye
  deflections** (faster upslope), muscle atonia, autonomic variability.

## 5. Artifacts (everything but the brain)

| Artifact | Look / location | Key discriminator |
|---|---|---|
| **Eye blink** | High‑amplitude **positive** bifrontal (Fp1/Fp2) — Bell's phenomenon | Frontal only, **no posterior field**, no preceding spike |
| **Lateral eye movement** | Opposite polarity **F7 vs F8**; "look toward the positive side" | Cornea +, retina −; phase reversal at F7/F8 |
| **Muscle / EMG** | High‑freq, low‑amplitude over frontalis/temporalis | Faster than cortex; **minimal at vertex** |
| **Chewing** | Bursts of very fast generalised activity (temporalis) | Don't confuse with paroxysmal fast; video helps |
| **Glossokinetic (tongue)** | **Delta**, diffuse, synchronised | **Reproducible** — trigger with "la‑la‑la" |
| **ECG** | Waveforms **time‑locked to QRS**, more on the left | Line up against the ECG channel |
| **Cardioballistic / pulse** | Rhythmic at heart rate (electrode over an artery) | Pulse‑synchronous |
| **Electrode pop** | **Very steep up, slow down, NO field**, one electrode | Single channel, no spread |
| **Mains** | Monotonous **60 Hz** (US) / 50 Hz (EU) | Notch filter; notch can distort sharp transients |
| **Sweat** | Very slow **< 0.5 Hz** undulations (NaCl charge) | No localisation rule |
| **Movement** | Chaotic high‑amplitude; head‑shaking is posterior | Lacks cortical evolution/field |

Overarching rule: artifacts lack **organised evolution, a broad field, and spike‑wave morphology**;
**video + reproducibility** settle most.

## 6. Normal (benign) variants — the epileptiform mimics

- **Mu:** **7–11 Hz** arciform, centroparietal; **blocks with movement/motor planning**.
- **Wicket:** 7–11 Hz temporal arches (drowsy); **no aftergoing slow wave**, non‑evolving, doesn't
  disturb background.
- **RMTD** (rhythmic mid‑temporal theta of drowsiness): sharply contoured **4–7 Hz** temporal runs;
  **constant frequency, no evolution** (vs. seizure).
- **Lambda:** positive occipital "sail" sharps during **visual scanning while awake**; positive
  polarity + wake markers distinguish from epileptiform.
- **BETS / small sharp spikes:** **< 50 µV**, brief, temporal, **drowsy/asleep**, **no aftergoing
  slow wave**.
- **14 & 6 positive spikes:** comb‑like positive bursts (**14 Hz** or **6 Hz**), posterior‑quadrant,
  adolescents/young adults, drowsy; **no epilepsy‑risk association**.
- **6 Hz phantom spike‑wave (5–7 Hz):** tiny spike + tiny slow wave. Two flavours — **WHAM**
  (Waking, High‑Amplitude, Anterior, Male; slight risk) vs. **FOLD** (Female, Occipital, Low‑amplitude,
  Drowsy; benign).
- (The site also references SREDA/wicket‑family patterns in the atlas.) Common thread: they **look**
  epileptiform but lack **evolution, aftergoing slow wave, background disruption**, or the right
  **state/anatomy**.

## 7. Neonatal

- **Postmenstrual age (PMA) = gestational + chronological age** drives every norm ("normal this week
  may be abnormal next week").
- **Interburst interval (IBI)** ceiling shortens with maturity: 60 s @24 wk → 20 s @28 → 10 s @34–36
  → 6 s @37–40 → **fully continuous by 46 wk**.
- **Continuity / synchrony / reactivity:** reactivity emerges ~30 wk (full 32–40); synchrony ~80% by
  30 wk, complete by 38 wk.
- **Quiet‑sleep discontinuity patterns:** **tracé discontinu** (30–34 wk, IBI **< 25 µV**) →
  **tracé alternant** (34+ wk, IBI **≥ 25 µV**) — *distinguished by IBI amplitude*.
- **Graphoelements:** temporal sawtooth theta & monomorphic occipital delta (24–30/32 wk);
  **delta brush** (28 wk → 40–42; 8–20 Hz fast riding on delta — *also seen in adult anti‑NMDA‑R
  encephalitis*); **encoches frontales** (34–46 wk; **must be synchronous** — asynchrony suggests
  epileptiform).
- **Localisation of sharps:** frontal/centrotemporal ≈ benign; **midline/occipital ≈ epileptiform.**
  Many neonatal seizures are **clinically silent**; still must **evolve**.
- **Technique:** reduced montage, 15 mm/s, LFF 0.01–0.5 Hz, plus EOG/EMG/pneumograph.

## 8. Pediatric

- **PDR maturation:** ~**4–5 Hz @ 6 mo → 6 Hz @ 1 y → 7 Hz @ 2 y → 8 Hz @ 3 y → 9 Hz @ 8 y →
  ~10 Hz @ 10 y.**
- Infant background is delta‑heavy; theta predominates by ~6 mo. Spindles appear ~2 mo, initially
  **very long (up to 15 s)** and **asynchronous through age ~2**. Vertex waves are sharp/abundant.
- **Posterior slow waves of youth** (ages 3–6): high‑amplitude spike‑like waves fused into the PDR,
  **attenuate with eye opening** (don't call them epileptiform). **Slow alpha variant** = notched
  (two PDR waves merged). **Hypnagogic/hypnopompic hypersynchrony:** high‑amplitude synchronised slow
  waves at sleep‑wake transitions.

## 9. Non‑epileptiform abnormalities

- **Generalised slowing = diffuse encephalopathy.** Graded **mild** (PDR 6–7 Hz, reduced AP gradient,
  excess theta, reactivity preserved) → **moderate** (theta‑delta, PDR fragmented) → **severe**
  (delta, disorganised, ± discontinuous, no reactivity/state).
- **Focal slowing = structural** (esp. if delta). **Polymorphic** = subcortical white‑matter
  disconnection (reliable but nonspecific). **Monomorphic/rhythmic** → cortical hyperexcitability /
  seizure risk. Continuous → bigger lesion; intermittent → smaller. "The less reactive/variable a
  slowed region, the worse the dysfunction."
- **TIRDA** (temporal intermittent rhythmic delta, 2–3 Hz waxing/waning) → **mesial temporal
  epilepsy** association. **GRDA** (~3 Hz generalised) → nonspecific diffuse dysfunction.
- **Breach rhythm:** higher‑amplitude, spiky, irregular activity over a **skull defect** — not
  epileptiform (though real spikes can coexist).
- **Attenuation** (mass/stroke) & **discontinuity/suppression** (outside neonatal, **always highly
  abnormal**). **Burst‑suppression** requires **≥ 50%** suppression.
- **Excess beta** = usually **benzodiazepine/barbiturate** effect (benign‑but‑abnormal).
- **Triphasic waves:** three components each progressively longer, generalised with subtle
  anterior→posterior lag; classic for **metabolic (hepatic) encephalopathy**.

## 10. Epileptiform discharges

- **Spike = 20–70 ms; sharp = 70–200 ms** — both with a **genuinely pointed peak**.
  Polyspikes = contiguous multiphasic spikes.
- **Six IFCN criteria** (**≥ 5 → > 95% specificity**): (1) sharp/spiky; (2) **upslope steeper than
  downslope**; (3) **aftergoing slow wave**; (4) **disrupts background**; (5) duration differs from
  surroundings; (6) **anatomically coherent field**. Most reliable trio: **pointed morphology +
  aftergoing slow wave + a clear field.**
- **Aftergoing slow wave** = active inhibition of the irritable population; the single most reliable
  sign of a true discharge.
- **Localisation caveats:** deep‑frontal discharges may be invisible; mesial‑frontal can *falsely
  localise contralateral*; occipital hit the **end‑of‑chain** problem; focal‑with‑rapid‑bisynchrony
  can masquerade as generalised.
- **Paroxysmal fast activity (pFA):** beta‑or‑faster bursts — generalised epilepsy, **Lennox‑Gastaut**,
  tonic seizures (distinguish from med‑effect beta and muscle).
- Epileptiform activity = **cortical hyperexcitability / raised seizure risk**, but **needs clinical
  correlation** — a discharge alone doesn't diagnose epilepsy.

## 11. Rhythmicity, periodicity & the ictal‑interictal continuum (IIC)

**ACNS Standardised Critical Care terminology.** Name a pattern by **Main Term 1** (laterality:
Generalised / Lateralised / Bilateral‑Independent / Multifocal) + **Main Term 2** (**PDs** periodic
discharges, **RDA** rhythmic delta, **SW** spike‑and‑wave). **Plus modifiers** raise ictal
suspicion: **+F** (fast), **+R** (rhythmic), **+S** (sharp), **+FR**, etc.

| Pattern | Frequency / feature | Seizure risk |
|---|---|---|
| **GRDA** | ~1–2 Hz undulating delta, generalised | Low (excluded from IIC unless it evolves); encephalopathy |
| **GPDs** | Discrete bilateral, often triphasic | Toxic/metabolic, anoxia, **CJD**; **≥ 2.5 Hz for ≥ 10 s = seizure** |
| **LRDA** | Unilateral rhythmic delta, > 1 Hz | Focal lesion; **temporal LRDA → mesial temporal epilepsy**; route to seizure is **evolution** |
| **LPDs** | Unilateral periodic, ~1–1.5 Hz | High baseline risk; **HSV encephalitis**, stroke, abscess |
| **BIPDs** | Two independent asynchronous foci | **Higher** than unilateral LPDs |
| **BIRDs** | **> 4 Hz**, **< 10 s** | Closest to seizure; **> 50%** go on to true seizures |
| **SIRPIDs** | Any RPP/seizure **stimulus‑induced** | Depends on the underlying pattern |

**Seizure thresholds:** periodic (GPD/LPD) **≥ 2.5 Hz for ≥ 10 s**; rhythmic (LRDA) via **evolution**,
not a frequency cut‑off. Spike‑wave ≤ 4 Hz is *not* a BIRD regardless of length. Risk rises with
frequency, prevalence, sharper morphology, plus‑modifiers, lateralisation, duration, and **evolution**.
The **IIC** is the deliberately fuzzy middle ground between clearly interictal and clearly ictal.

## 12. Seizures

- **Electrographic seizure = organised, evolving cortical activity** — must **evolve** in frequency,
  morphology, or location (mere fluctuation ≠ evolution). Standard duration **> 10 s** (briefer allowed
  with a clear clinical correlate).
- **Special cases:** periodic ≥ 2.5 Hz for ≥ 10 s counts; **absence** may lack evolution;
  **myoclonic** = a single time‑locked jerk+discharge qualifies (exception to evolution/duration).
- **Focal vs generalised:** generalised = non‑localisable onset, impaired awareness. Focal =
  preserved / impaired consciousness / focal‑to‑bilateral tonic‑clonic.
- **Type signatures:**
  - **Absence:** **3 Hz generalised spike‑wave**, abrupt on/off, minimal evolution, no postictal
    slowing (atypical ≤ 2.5 Hz).
  - **GTC:** tonic fast/myogenic → polyspike‑and‑slow‑wave bursts → **postictal attenuation**.
  - **Tonic:** slow wave → electrodecrement + fast → low‑amplitude diffuse fast.
  - **Spasms:** high‑amplitude slow wave → diffuse electrodecrement (± fast).
- **Status epilepticus (ILAE t1/t2):** convulsive **t1 = 5 min, t2 = 30 min**; focal‑impaired
  **t1 = 10, t2 > 60**; absence **t1 = 10–15**. **NCSE** ≈ seizure ≥ 10 min or **≥ 20% of any hour**.

---

## 13. How this maps onto our simulator

Strong corroboration of choices already in the engine and [INFORMING-KNOWLEDGE.md](INFORMING-KNOWLEDGE.md):

- **Polarity/display** (negative‑up; input1 more positive → down) matches §1/§2 here exactly —
  consistent with our IK‑001/IK‑008 convention.
- **Alpha reactivity** (PDR on eye‑closure, attenuates on eye‑opening; SMALL‑FIXES #4) is the site's
  central awake teaching point — our fix is on solid ground.
- **Eye‑opening artifact** as a mirror of the blink (SMALL‑FIXES #5) fits the Bell's‑phenomenon /
  frontal‑positive story.
- **Spike (20–70 ms) vs sharp (70–200 ms), ± aftergoing slow wave** (SMALL‑FIXES #15) matches the
  chapter‑10 definitions precisely.
- **Electrode pop** = steep up / slow down / **no field**, single electrode (SMALL‑FIXES #11) is
  verbatim the site's description.
- Our pattern families (sleep architecture, benign variants, artifacts, non‑epileptiform, interictal,
  ictal, activation) line up with the site's chapter taxonomy — good validation of the side‑panel
  clubbing (SMALL‑FIXES #10).

Content the simulator does **not** yet model (candidate future patterns, if we ever want them):
neonatal/pediatric maturation, triphasic AP lag, the full **ACNS IIC** family (LPDs/GPDs/LRDA/GRDA/
BIRDs/SIRPIDs), TIRDA, breach rhythm, glossokinetic/cardioballistic artifacts, status epilepticus
timing.

## 14. Numbers worth considering for future `IK-` entries

Flagged only — **not** promoted; each needs a clinical review + a `check()` before it becomes ground
truth (run `/ik` per CLAUDE.md §2). Verify our engine actually obeys each before asserting it.

1. **PDR symmetry limits:** abnormal if > 50% amplitude or > 1 Hz frequency asymmetry between
   hemispheres.
2. **Sleep spindles 11–16 Hz, central‑maximal, N2** (we already check a spindle peak — this pins the
   band and topography).
3. **N3 delta: > 75 µV at 0.5–2 Hz.**
4. **BETS < 50 µV, no aftergoing slow wave** (separates our benign spikes from epileptiform ones).
5. **Absence = 3 Hz generalised spike‑wave; atypical ≤ 2.5 Hz.**
6. **Periodic‑pattern seizure threshold ≥ 2.5 Hz for ≥ 10 s** (if we ever model the IIC).
7. **Detectability floor ≥ 6 cm²** — conceptual, hard to check, but underpins our leadfield spread.

---

*Sources: learningeeg.com chapters 1–12, Atlas, and About (David Valentine MD). Criteria per ACNS,
ILAE, IFCN. Notes compiled 2026‑08‑18.*
