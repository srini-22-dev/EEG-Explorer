# EEG Knowledge Base: Source Localization, Polarity & Recording Principles

**Purpose of this document:** a conceptual/clinical reference distilled from four source materials the project owner provided:

1. A 47-slide deck ("Source localisation", 09-05-2023).
2. A worked clinical figure (Radhakrishnan et al., *EEG in Clinical Practice*, Fig. 1.15) comparing common-average vs. ipsilateral-ear referential montages on a real seizure recording.
3. **Kurupath Radhakrishnan, Jagarlapudi M K Murthy, Chaturbhuj Rathore (eds.), *EEG in Clinical Practice*, Manipal Universal Press, 2018** — specifically Chapter 1 ("Fundamentals of EEG Recording," Rathore & Bansal) and Chapter 9 ("Focal Epileptiform Patterns: Principles of Polarity," Rathore & Wattamwar).
4. **Niedermeyer's Electroencephalography: Basic Principles, Clinical Applications, and Related Fields** — specifically the "Recording Principles: Analog and Digital Principles; Polarity and Field Determinations" chapter (§3.4–3.8) and the Benign Epilepsy with Centrotemporal Spikes (BECTS) section.

This is a **concepts document only**. It does not change any code, and nothing here should be read as a mandate to alter the simulator's current visual style, color coding, or layout — those stay exactly as they are. Its purpose is to be the accuracy reference the project points to when new patterns, montages, or field maps are designed later, per the "concept before code" working principle in `CLAUDE.md`.

---

## 1. Where the EEG signal actually comes from

- **Action potentials are not the source.** APs are large intracellularly but last only ~1 ms — too brief and too small extracellularly to summate into a scalp-recordable signal.
- **Postsynaptic potentials (PSPs) are the source.** EPSPs and IPSPs at the synapses of cortical pyramidal neurons last tens of milliseconds — long enough for summation across a large number of near-simultaneous synapses (spatial summation) to produce a signal large enough to reach the scalp.
- **Anatomy of the dipole:** Pyramidal neurons are arranged in parallel functional vertical columns, each with a single large apical dendrite directed toward the cortical surface. Excitatory synapses are located predominantly toward the surface of the cortex; inhibitory synapses are located predominantly toward the deeper end, near the cell body. EPSPs at the apical dendrite cause an inward flow of positive ions, producing a **local negative extracellular potential near the surface**; at the proximal (deep) part of the dendrite there is a passive outward flow of positive ions, producing a **positive extracellular potential deep in the cortex**. Each synapse therefore acts like a small battery, and the whole cell forms a **dipole: negative pole toward the cortical surface, positive pole toward the deeper cortex**.
- **Sign convention this produces:** EPSPs with a resultant negative extracellular field near the surface cause an **upward** deflection in the EEG; IPSPs near the surface cause a **downward** deflection (the minority of inhibitory synapses located near the surface produce the opposite-oriented loop).
- **Spatial resolution floor:** a minimum of roughly **6 cm² of contiguous, synchronously-active cortex** is required to produce a signal detectable on the scalp. A prominent waveform confined to a single electrode is, by this logic, presumed to be an artifact unless proven otherwise — genuine cortical generators are never that spatially confined.
- **Volume conduction, not focused projection:** the brain's electrical activity does not project to the scalp in a focused beam; it spreads out as it traverses brain and skull by volume conduction. A large potential therefore has a *more* widespread field, involving multiple electrodes — this is the physiological reason a genuinely large-amplitude source looks spatially broad on the scalp, not narrow.

## 2. The dipole model: vertical, horizontal, and oblique sources

EEG is fundamentally a **two-dimensional view of a three-dimensional electrical process**, and determining the generator from the scalp pattern is a genuine "inverse problem": given a waveform's morphology, amplitude, and distribution, there is in principle an infinite number of possible internal generators that could produce it. Source localization is the practice of finding the most clinically plausible answer, not the only mathematically possible one.

For a dipole to be visible on the scalp at all, part of it must lie roughly parallel to the recording electrode:

- **Vertical dipoles** (generated at the crown of a gyrus, directly beneath an electrode) lie parallel to that electrode. They produce a **surface-negative potential only** — they effectively behave like *monopoles*, because the positive pole is deep inside the brain and is never detected on the surface.
- **Horizontal dipoles** (generated within a sulcus, oriented tangentially to the electrode) and **oblique dipoles** show **both the negative and the positive pole on the scalp**, sometimes with the negative pole detected at an electrode located away from the true anatomical source.

### The dipole model's five assumptions (and why they routinely fail)
The simplistic single-dipole model assumes: (1) the source dipole is near the surface; (2) the source dipole is parallel to the electrode; (3) at least one recording electrode is over the source; (4) the reference electrode is outside the active region; and (5) the head is a uniform volume conductor. In practice: the skull's resistance to electrical current is roughly **80× that of scalp or brain**, so current preferentially takes the path of least resistance — through natural skull foramina or defects — meaning an electrode over a skull defect can show a spuriously *higher*-amplitude spike even though the true source lies elsewhere. Because the head is a passive volume conductor, all electrodes pick up a generator's potential essentially simultaneously (at the speed of light), but **amplitude falls and field area grows with increasing distance from the source** — deeper generators are therefore lower-amplitude and more diffuse on the scalp, and referential montages (not bipolar) are the better tool for demonstrating this kind of widespread, low-amplitude far-field potential, since bipolar derivations largely cancel it out (§8).

### Other known pitfalls in scalp-based localization
- Multiple different cortical generators can produce a similar scalp potential (spike or sharp wave) — scalp morphology alone cannot uniquely specify the anatomical source.
- A spike may be detected at an electrode away from the true source, especially if the source is deep or within a sulcus.
- Multiple simultaneous dipoles can either **reinforce** each other (if similarly oriented) or **cancel** each other out (if randomly oriented, as can happen with hippocampal/mesial temporal generators) — this is why mesial temporal seizure onsets are frequently invisible or minimal on scalp EEG despite clear intracranial activity.
- A superficial source can overshadow and obscure the field of a genuinely deeper, clinically significant source.

## 3. The universal rule: the differential amplifier and "negative-up"

Every EEG channel — bipolar or referential — is built from a differential amplifier with two inputs, **Input 1** and **Input 2**. The channel output is Input 1 minus Input 2. By international convention for all bioelectrical recording (EEG, EMG, evoked potentials):

> **If Input 1 is more negative than Input 2 (equivalently, the difference Input1 − Input2 is negative), the trace deflects UP. If Input 1 is more positive than Input 2, the trace deflects DOWN. If the two inputs are equal — which happens whenever a broad field potential affects both electrodes equally — the trace is a flat, isoelectric line.**

It is the **relative** difference between the two inputs that determines deflection — never the absolute potential at either electrode alone. This is worth stating explicitly because it is the single most common point of confusion for trainees: *a single channel deflecting upward tells you nothing about whether Input 1 is negative or Input 2 is positive* — polarity can only be assigned once a source location has been inferred from a broader montage, not from one channel in isolation.

Both source books give the same worked truth-table, using electrodes Fp2 (Input 1) and F4 (Input 2):

| Input 1 (Fp2) | Input 2 (F4) | Difference | Deflection |
|---|---|---|---|
| −10 µV | 0 µV | −10 µV | Upward |
| −10 µV | −10 µV | 0 µV | Isoelectric (flat) |
| −10 µV | +10 µV | −20 µV | Upward, and *larger* than the −10 µV case — because subtracting a positive value from a negative one increases the magnitude of the difference |
| +10 µV | 0 µV | +10 µV | Downward |

The middle row is worth internalizing on its own: **opposite-polarity potentials at the two inputs produce a larger-amplitude output than either input alone** — this is the mechanism behind the unusually large deflections sometimes seen when a true tangential dipole's two opposite poles both fall within one bipolar derivation (§7).

## 4. Recording fundamentals (signal chain, montages, standard settings)

*(This section is general recording-technology background — not something the simulator needs to model at the hardware level, since it doesn't simulate electrode impedance or ADC sampling. It's included because it defines terms — LFF/HFF/sensitivity/derivation — that the simulator's canvas already surfaces to the user, and because "montage" and "derivation" are formally defined here.)*

**Signal chain:** electrodes → differential amplifier → analog filters (HFF, LFF, notch) → main amplifier → analog-to-digital converter → display/storage. A **derivation** is the electrode pair feeding one channel, written Input1-Input2 (e.g. `Fp1-F3`); a **montage** is an ordered collection of derivations. A derivation between adjacent electrodes is called **bipolar**; one using a long inter-electrode distance (e.g. to an ear or average reference) is called **referential**.

**Standard filter settings** (routine adult scalp EEG): low-frequency filter (LFF, a.k.a. high-pass) **0.5–1.0 Hz**; high-frequency filter (HFF, a.k.a. low-pass) **70 Hz**; notch (50/60 Hz line-noise) filter **off** during routine recording/review, and used only as a last resort — because it can mask a genuine high-impedance electrode problem and can distort the sharpness of true epileptiform discharges. The **time constant** is an equivalent way of expressing the LFF: the time for a square calibration pulse to decay 63% from peak; a higher time constant lets lower frequencies through (0.3 sec time constant ≈ 0.53 Hz LFF; 1.0 sec time constant ≈ 0.16 Hz LFF). Using too high an LFF can abolish genuine pathological slow waves; using too low an HFF (or the notch filter indiscriminately) can attenuate or distort sharp waves and spikes — filter choice is not neutral, it can manufacture or erase apparent pathology.

**Sensitivity** (a.k.a. gain) is the ratio of input voltage to pen/trace deflection, in µV per mm. Routine adult sensitivity is **7 or 10 µV/mm**; children, who have higher-amplitude EEG, often need a *less sensitive* setting of 15–20 µV/mm for a legible trace. Note the inverse relationship: a *higher* sensitivity number means a *lower*-gain (smaller-looking) trace.

**Calibration:** *instrumental calibration* passes an identical known square-wave voltage through every channel — the amplitude and shape of the resulting waveform should be identical across channels, verifying amplifier/filter integrity. *Bio-calibration* connects a single fronto-occipital derivation (Fp2-O2, which naturally captures both eye-blink slow waves and posterior alpha) to all channels simultaneously, as a whole-system sanity check before recording begins.

### Montage types and their "spatial filtering" behavior
A useful mental model (used explicitly in both source texts): **every montage type is a spatial filter**, and different montages are not competing for the title of "more correct" — they trade off sensitivity to localized vs. widespread fields:

| Montage | Input 2 (reference) | Filters out widespread fields... | Best for |
|---|---|---|---|
| Longitudinal / transverse bipolar | The adjacent electrode in the chain | Most aggressively — a field that equally affects two neighboring electrodes cancels to a flat line | Small, highly localized fields (e.g. an epileptiform spike) |
| Laplacian / weighted average reference (WAR) | A local, distance-weighted combination of the surrounding electrodes | Strongly, but less than bipolar | Very localized low-amplitude fields, e.g. a focal seizure *onset* |
| Common average reference | The mean of all (or most) scalp electrodes | Moderately | Medium-to-high-amplitude localized fields *and* some regional fields |
| Common reference (single or paired electrode, e.g. ear, Cz, or a noncephalic neck/chest pair) | One fixed electrode (or pair) for every channel | Least — best preserves genuinely widespread fields | Confirming a widespread field's true extent; brain-death (electrocerebral inactivity) recordings, which deliberately use long inter-electrode distances |

Because each montage emphasizes a different spatial scale, **it is standard practice to review any doubtful finding in at least two different montages** (e.g. longitudinal bipolar *and* average reference, or longitudinal *and* transverse bipolar) before concluding it is or isn't real — a genuinely widespread seizure can be essentially invisible in a longitudinal bipolar montage while being obvious in a transverse bipolar or referential montage, purely because of this filtering effect, with no difference in the underlying EEG.

**Montage reformatting** (digital EEG only): since every recorded channel is mathematically a subtraction, any montage can be algebraically re-derived from any other *as long as both derivations share a common recorded reference*. E.g. if the raw digital recording is stored referenced to Cz: `(Fp1-Cz) - (F3-Cz) = Fp1 - F3`, letting a reader reconstruct a bipolar derivation after the fact from referential source data — but only for electrodes that were actually part of the original recording.

### Spike / sharp-wave definitions (IFSECN criteria)
The International Federation of Societies for Electroencephalography and Clinical Neurophysiology (IFSECN) defines a spike or sharp wave as: (1) a transient (paroxysmal) abnormality; (2) standing out clearly from the background; (3) having a duration of 20–200 ms overall, conventionally split into **spike: 20–70 ms** and **sharp wave: 70–200 ms**; (4) having a physiological field on the scalp (i.e., detectable at more than one electrode, consistent with §1's ≥6 cm² rule); (5) usually followed by an after-coming slow wave; and (6) with its main component **generally negative** in polarity — a purely positive epileptiform-looking transient confined to one electrode is a hallmark of artifact, not epileptiform activity (see §5 on positive phase reversal).

## 5. Bipolar montage: rules of localization

A bipolar montage chains electrodes so each channel's Input 2 becomes the next channel's Input 1 (e.g. `Fp1-F3`, `F3-C3`, `C3-P3`, `P3-O1`). Two source texts converge on the same underlying logic, expressed at two levels of granularity — a five-case taxonomy (Niedermeyer) and a two-principle summary (Radhakrishnan) — both are given here because the five-case version is the more complete teaching tool and the two-principle version is the faster working rule.

### The five localizing patterns (Niedermeyer, "Box 5.1: Rules of Localization: Bipolar Montages")
The electrode with the true maximum negative potential is found by one of:
1. **Instrumental phase reversal** — the ordinary, common case (below).
2. **Instrumental phase reversal with cancellation in an intervening derivation** — see the worked example below; the flat/cancelled channel itself marks the field maximum (a "zone of isopotentiality").
3. **End-of-chain phenomenon** (absence of phase reversal) — see §5.3.
4. **End-of-chain phenomenon with cancellation** — the end channel goes flat because both its electrodes see equal voltage, still localizing to that chain end.
5. **True phase reversal (double phase reversal)** — signals a genuine tangential/horizontal dipole, not a chain artifact (§7).

### 5.1 Instrumental phase reversal — the ordinary localizing case
Worked example (Radhakrishnan Fig. 9.4, C4 focus): a spike with a negative potential of **−70 µV confined to C4** is read in the chain `F4-C4-P4`. By the universal rule (§3): `F4-C4` deflects **downward** (F4, at 0 µV, is Input 1 and is relatively more positive than C4's −70 µV at Input 2). `C4-P4` deflects **upward** (C4 at −70 µV is Input 1, more negative than P4 at 0 µV). The two channels' deflections point *toward* each other at their shared electrode, C4 — this convergence is the **phase reversal**, and **the electrode common to the two reversing channels is read as the location of maximum negativity**, i.e., the presumed focus.

If the field is broader (Radhakrishnan Fig. 9.6: F4 = −50 µV, C4 = −70 µV, P4 = −30 µV, all part of one spreading field), the reversal still centers on C4 (still the true maximum), but the amplitude of the deflection differs between `Fp2-F4` and `F4-C4` because of the different potential differences involved — a **wider field still produces a phase reversal, just with different amplitudes flanking it**, not a qualitatively different pattern.

**Positive phase reversal** — the mirror case, where two adjacent channels' deflections point *away* from each other — in most cases represents an **artifact**, and true epileptiform abnormalities essentially never produce it. (It can occasionally reflect disturbed cortical anatomy such as focal cortical dysplasia or postoperative gliosis where pyramidal cell orientation itself is deranged, but this is the rare exception, not something to model as a routine variant.)

### 5.2 Instrumental phase reversal with cancellation ("zone of isopotentiality")
If the field maximum falls *between* two electrodes rather than under one of them, the derivation connecting those two electrodes goes flat (both inputs see equal voltage → isoelectric line per §3), while the channels flanking it on either side deflect in opposite directions. Example (Niedermeyer Fig. 5.35): `Fp1-F3` deflects down, `F3-C3` is flat, `C3-P3` deflects up — the flat channel `F3-C3` itself localizes the field maximum to the zone *between* F3 and C3, not to either electrode individually (Radhakrishnan Fig. 9.7 shows the same phenomenon: F4 = C4 = −70 µV exactly, so `F4-C4` reads zero).

### 5.3 End-of-chain phenomenon (absence of phase reversal)
If the true field maximum sits at the very first or very last electrode in a chain (e.g. O1/O2 at a chain's posterior end, or Fp1/Fp2 at its anterior end), **there is no adjacent electrode on the far side within that chain to reverse against, so a phase reversal cannot be produced** — even though the discharge is genuinely maximal there (Radhakrishnan Figs. 9.8–9.10; Niedermeyer Figs. 5.31/5.36 make the identical point). This is a pure artifact of chain geometry, **not** evidence the source is deep or absent, and it does **not** mean the phase-reversal rule has failed — it means a different montage is needed. Practical fix: either switch to a referential or transverse bipolar montage that crosses the affected electrode from a different direction, or (with digital reformatting) construct a new bipolar chain that places the end electrode *in the middle*, e.g. linking O1 to O2, or Fp1 to Fp2, directly.

**Two governing principles for bipolar localization** (Radhakrishnan Table 9.3, restating §5.1 and §5.3 together): (1) *when phase reversal is present*, the electrode where it occurs has the maximum negative potential; (2) *when there is no phase reversal*, the maximum potential is located under the first or the last electrode of the chain.

## 6. Referential montage: rules of localization

In a referential montage, Input 2 is the same reference electrode (or combination) in every channel, so Input 1's own potential — relative to that shared reference — is read directly. Because there's no chain-adjacency geometry, referential localization does not use phase reversal in the ordinary case; it uses **amplitude**:

> **The channel showing the single largest-amplitude deflection identifies the electrode closest to the true field maximum.** Amplitude falls off smoothly at neighboring electrodes as you move away from the focus — a spatial gradient, not a reversal (Radhakrishnan Figs. 9.11–9.13).

### Reference choices and their trade-offs (Radhakrishnan Table 1.2)
| Reference | Notes |
|---|---|
| Ipsilateral/contralateral ear (A1/A2) | Not suitable for **temporal lobe epilepsy** — the ear sits close enough to temporal generators to be drawn into the field itself. |
| Cz | Good during wakefulness (largely free of movement/myogenic artifact); becomes actively contaminated during sleep and in patients with **central** spikes. |
| Common average reference | Near-ideal — as inert as practically achievable, since it's diluted across all electrodes — but a single electrode with a very large potential still contributes `1/n` of its voltage to the average, which can distort every channel it touches. |

### The critical caveat: reference contamination
Localization by amplitude is only valid **if the reference electrode itself is outside the field of interest**. If it is not, the reference's own activity leaks into every channel that uses it, producing one of two recognizable signatures:

- **Uniform contamination:** if the reference is inside the field and *no other electrode is*, every channel referenced to it shows the *same* deflection — because the signal is coming from the shared Input 2 (the reference), not from the varying Input 1 electrodes (Niedermeyer Fig. 5.39). *If all channels sharing a reference show identical output, the activity is coming from the reference, not from Input 1.*
- **A confusing phase reversal *can* appear in a referential montage** — and when it does, it means one of exactly two things: either (a) it is a **genuine true phase reversal**, indicating a real horizontal/tangential dipole (§7), or (b) it is **reference contamination**, where the reference electrode is itself partly inside the field while other electrodes are outside it, producing internally inconsistent deflections across the montage (Radhakrishnan Fig. 9.14, worked with a T4 focus contaminating an A2 ear reference; Niedermeyer Fig. 5.40 shows the identical mechanism). **The clinical example that motivated this document** (Radhakrishnan Fig. 1.15) is exactly this failure mode: a right anterior temporal periodic spike-wave discharge is localized correctly in a common-average montage, but re-referencing to the ipsilateral ear (A2) makes sharp waves appear to contaminate *every other channel*, because the ear reference is not electrically silent in temporal lobe epilepsy.

**Two governing principles for referential localization** (Radhakrishnan Table 9.3): (1) the maximum electrical field is under the electrode showing the maximum amplitude; (2) if a phase reversal is seen, it indicates either a true phase reversal or reference contamination — never assume the montage's ordinary "amplitude wins" rule without first ruling out a contaminated reference.

## 7. Tangential (horizontal) dipoles: the montage-dependent double-reversal case

A tangential/sulcal-wall source has both a negative and a positive pole present simultaneously on the scalp (§2), so it behaves differently in each montage:

- **Bipolar montage:** produces **two separate instrumental phase reversals** — one at the negative pole, one at the positive pole — which, read naively, can look like two unrelated foci.
- **Referential montage:** produces only **one true phase reversal** — the single crossing point between the genuinely negative and genuinely positive scalp regions — a more faithful single representation of the underlying dipole.

**Benign Rolandic Epilepsy / BECTS is the canonical clinical example**, and both books converge on the identical topography: a **maximum negative pole over the central/centrotemporal region (classically C3/C4, or the closely-spaced C5/C6), with a positive pole located bifrontally (classically Fp1/Fp2)**. Radhakrishnan's worked case (Fig. 9.2) shows a left-hemisphere version directly: the longitudinal bipolar montage shows phase reversals at **C3 and T3** independently (the double-reversal signature), while the common-average montage on the *same* discharge shows a single dipole with negative maximum at C3/T3 and a positive pole at Fp1. Niedermeyer's account adds the generator anatomy: the discharge arises from a generator oriented **tangentially to the cortical surface in the lower rolandic region, in the anterior bank of the central sulcus** — i.e., genuinely sulcal, genuinely tangential, not a montage artifact. Clinically, the anterior (positive) pole is typically *lower amplitude* than the posterior (negative) pole and may need increased gain or a distant/noncephalic reference to see clearly — so a simulator implementing this pattern should not give the two poles equal amplitude.

## 8. Bipolar vs. referential — practical comparison

| | Bipolar montage | Referential montage |
|---|---|---|
| Localizes via | Phase reversal at the shared electrode | Amplitude (largest deflection wins) |
| Best for | Small, highly localized fields — cancels widespread background via the "spatial filter" effect (§4) | Confirming true amplitude/extent of a field, including wide or deep (low-amplitude) fields that bipolar cancels out |
| Failure mode | End-of-chain phenomenon (§5.3); broad fields can show cancellation zones (§5.2) that are easy to misread if the reader doesn't know to look for them | Reference contamination (§6) — corrupts every channel sharing that reference simultaneously |
| Tangential dipole | Two instrumental phase reversals (can look like two separate foci) | One true phase reversal (faithful) |
| Rule of thumb | Read any suspected focus in **at least two montages** — e.g. longitudinal *and* transverse bipolar, or bipolar *and* referential — because each montage's blind spot is different | Confirm the reference itself is not inside the field before trusting the amplitude-based localization, especially with ear references and temporal foci |

Neither montage type is "more correct" in isolation (§4) — routine clinical protocol (per ACNS-style guidelines cited in Niedermeyer) calls for **both bipolar and referential montages, at minimum 16 simultaneous channels covering all 21 standard 10-20 electrodes**, specifically because each montage's spatial-filtering trade-off makes it blind to different things.

## 9. How this maps onto the simulator's existing architecture (reference only — no code changes made)

For whoever next implements a pattern or field map, here's how the concepts above already map onto the current code, so new work stays consistent with it rather than duplicating or contradicting it:

- `utils/montages.ts` already encodes the chain adjacency (`ChannelDef` active/reference pairs) that phase reversal (§5) and end-of-chain (§5.3) depend on — the *order* of electrodes within a chain is what determines whether a given focus sits mid-chain (reversal possible) or at an edge (reversal not possible, by physiology, not by omission).
- `utils/computeChannel.ts`'s `computeChannelVoltage` already implements the universal Input1 − Input2 rule from §3 for both bipolar (`channel.reference` = an electrode) and common-average (`channel.reference === 'AVG'`) channels. `IPSI`/`CONTRA` reference channels currently resolve `vRef = 0` — i.e., the simulator does not yet model reference contamination (§6, the Fig. 1.15/Fig. 9.14 pitfall) for ear references; that would be a natural, clinically-grounded future feature (a genuinely "active" ear reference could optionally leak signal into `vRef` instead of assuming a silent reference), but implementing it is a separate decision, not something this document is proposing to change now.
- `utils/eegGenerator.ts`'s hand-tuned per-electrode field maps (e.g. `LT_FIELD`, `RT_FIELD`, `LF_FIELD`) are exactly the mechanism for encoding §2's position/orientation-dependent scalp topography and §7's tangential double-pole fields — any new focal pattern (a new epileptiform focus, a new BECTS-style tangential spike, etc.) should get its own field map built the same way: sized/shaped according to the vertical-vs-tangential distinction in §2, and if tangential, given genuinely opposite-signed attenuation at the two poles (with the anterior/positive pole set to lower amplitude than the negative pole, per §7) so §7's dual-reversal behavior falls out of the existing bipolar/referential math automatically rather than being special-cased.
- The simulator's existing `sensitivity` and `speed` controls already correspond directly to §4's µV/mm sensitivity and mm/sec paper speed conventions — routine adult defaults of 7–10 µV/mm sensitivity and standard LFF/HFF values (1 Hz / 70 Hz) from §4 are a reasonable reference point if those defaults are ever revisited, though this document takes no position on whether they should be.

## 10. Sources

- Source localisation slide deck (09-05-2023), citing Kirschstein & Köhling (2009), Niedermeyer's Electroencephalography, and K. Radhakrishnan's *EEG in Clinical Practice*.
- Kurupath Radhakrishnan, Jagarlapudi M K Murthy, Chaturbhuj Rathore (eds.), *EEG in Clinical Practice*, Manipal Universal Press, 1st ed., 2018:
  - Chapter 1, "Fundamentals of EEG Recording" (Chaturbhuj Rathore & Atma Ram Bansal), pp. 1–27, including Figure 1.15 (common-average vs. ipsilateral-ear referential montage comparison).
  - Chapter 9, "Focal Epileptiform Patterns: Principles of Polarity" (Chaturbhuj Rathore & Pandurang R Wattamwar), pp. 212–224.
  - Chapter 10, "Focal Epileptiform Patterns in Childhood Epilepsies" (Vrajesh Udani, Neelu Desai & Sonu Ravindran), pp. 225–226, for BECTS EEG features.
- *Niedermeyer's Electroencephalography: Basic Principles, Clinical Applications, and Related Fields* — "Recording Principles: Analog and Digital Principles; Polarity and Field Determinations" chapter (§3.4–3.8, including Box 5.1 and Figures 5.26–5.40), and the Benign Epilepsy with Centrotemporal Spikes section (Fig. 18.29).
