# INFORMING-KNOWLEDGE

Clinical ground truth for the EEG simulator: facts a neurologist could confirm by **looking at
the display**, recorded so they survive refactors, rewrites, and model changes.

This file is not documentation of how the code works — the engine source (`src/engine/`) is
that. This is a list of things that must remain **true of the output**, whatever the
implementation happens to be.

> **36 entries · highest ID `IK-036` · 35 enforced by an automated check, 1 `violated` (IK-003).**

---

## Edit protocol

This file is governed by a stricter rule than the rest of the repo.

1. **Claude never edits this file as a side effect of another task.** Not to "keep it in sync",
   not to fix a typo noticed in passing, not while implementing something it relates to.
2. **Claude edits it only when explicitly asked**, and proposes the exact diff for approval
   before writing.
3. **The user does not hand-edit it** — changes are always requested from Claude, so every
   change passes through review.
4. **Entries are append-only.** IDs are never reused and never renumbered. A fact that turns
   out to be wrong or superseded gets `Status: retired` plus a pointer to its replacement; it is
   not deleted. The history is the audit trail.

**If code and an entry disagree, that is a finding — stop and surface it.** Do not quietly
change the code to match the entry, or the entry to match the code. One of them is wrong, and
which one it is is a clinical question, not an implementation detail.

---

## Entry format

Every entry has an ID, a claim, an observable consequence, an optional mechanism, a check, and
a status.

```markdown
### IK-NNN — Short title

**Claim.** The clinical fact, stated plainly, in observation space.

**Observable.** What you would actually see in the simulator, concrete enough to be
disproved: which montage, patient state, and toggles; which channels; what
amplitude, duration, direction, or frequency.

**Mechanism.** *(optional, non-binding)* Candidate physiological explanations. More than
one may be listed. Nothing here is asserted by the entry, and no **Check** may depend on it.

**Check.** The automated assertion that enforces it, or `—` if none exists yet.

**Status.** <status> · **Source.** <who, when>
```

**Claim and Mechanism are separated deliberately.** A claim states what is true of the display;
a mechanism states why it might be. A wrong **Mechanism** leaves the entry intact — a wrong
**Claim** or **Observable** breaks it. Braiding them into one sentence hides that difference and
invites a generator author to read the mechanism as a specification. Several mechanisms can
produce the same observable, and the display often cannot tell them apart: a bipolar derivation
measures a *difference*, so it can never establish the absolute potential at either electrode.

**IDs** are `IK-001`, `IK-002`, … assigned in creation order, independent of section. Cite them
from code comments (`// IK-001`) and from validator labels so a failing check names the fact it
broke.

**Status vocabulary:**

| Status | Meaning |
|---|---|
| `proposed` | Stated, not yet agreed. |
| `unverified in code` | Agreed, but nobody has checked whether the simulator obeys it. |
| `verified (manual)` | Someone looked at the display and confirmed it. |
| `enforced (automated)` | A check asserts it; a regression fails the build. |
| `violated` | The simulator is known to contradict it. Open defect. |
| `retired` | Superseded — points to the entry that replaced it. |

For a filled-in example, see `IK-001` below.

---

## Enforcement

Entries whose **Check** field names an assertion are meant to be machine-verified alongside the
existing engine battery in `scripts/src/validateEngine.ts` (reuse its
`check(label, actual, lo, hi, unit)` helper and the DSP primitives in `scripts/src/dsp.ts`).

There is no separate `validate:knowledge` script. The entries that carry a **Check** name
assertions that already live inside the engine battery, so
`pnpm --filter @workspace/scripts run validate` is what enforces them; a regression fails there.
**Checks are cited by their `check(...)` label, not by line number** — labels survive edits to
the file, line numbers do not.

Entries whose **Check** is `—` are verified manually, via `/ik --verify IK-NNN`.

---

# Knowledge base

*Italic notes describe what belongs in each section. Sections without entries are still empty.*

## 1. Background rhythms by vigilance state

Which rhythm dominates in each state, its frequency range, amplitude, topography, and reactivity
(eye opening, attention). Covers awake, drowsy, N1, N2, N3.

### IK-006 — The awake posterior dominant rhythm is posterior, and central alpha-band activity is mu

**Claim.** With the eyes closed, the awake alpha-band background is maximal over the posterior
head: occipital greatest, with parietal and posterior-temporal both carrying it substantially.
Parietal is not a trough between them. Frontal alpha-band activity of comparable magnitude is
not a normal awake finding. (A minority of normal adults — up to ~5% — have no discernible PDR
at all; its absence is therefore not by itself abnormal.) Alpha-band activity that is maximal
*centrally* is a separate rhythm, mu, which belongs at C3/C4 and is distinguished from the
posterior rhythm by its reactivity — see [[IK-007]] and [[IK-033]].

This entry claims a **referential topography**, deliberately not a set of bipolar rows. Which
links of an antero-posterior chain show the rhythm most strongly follows from that topography by
subtraction — a bipolar link measures the field's *gradient*, not its height — and is therefore
not independently asserted here. An earlier version of this entry did assert it ("is read off the
posterior links of an antero-posterior chain — P3-O1 / P4-O2 and T5-O1 / T6-O2"); that clause was
not supported by the cited source, was arithmetically self-defeating, and drove a real defect. It
is **retracted** — see the §11 note dated 2026-08-28.

**Observable.** State `awake`, no toggles, 30 mm/s, 7 µV/mm. Referentially: mean 8–12 Hz power
across O1, O2, P3, P4 exceeds mean 8–12 Hz power across Fp1, Fp2, F7, F8 by a factor of at least
2 (currently 71.61). Only that floor is asserted. The check also carries a ceiling, which is a
regression guard and **not** a clinical bound: the model is known to make frontal alpha far too
small, and the ceiling is currently set above the wrong value it produces rather than at the
right one — see the §11 note dated 2026-08-28.

Parietal must not be starved relative to posterior temporal: P3/T5 and P4/T6 8–12 Hz power each
sit between 0.5 and 3 (currently 0.88 and 0.88). This is the clause that fails if the posterior
field is shaped so that the parasagittal chain carries no rhythm until its last link.

Independently, C3's 8–12 Hz power exceeds F3's by at least 3× (currently 10.78), measured on a
subject who **has** background mu — [[IK-033]] makes mu a per-subject trait, so the check pins it
present. Where mu is present it must peak at its own central anchor and must not deposit its
maximum in the frontal electrodes. Absolute amplitude in µV is not asserted by this entry; only
the ratios are.

**Mechanism.** *(non-binding)* The posterior rhythm is conventionally attributed to a
thalamo-occipital generator and mu to a sensorimotor one, which is why they coexist at
overlapping frequencies with different topographies. Not asserted. A power ratio is sign-blind
and says nothing about the orientation or depth of either generator.

**Check.** `validateEngine.ts` — `check('posterior / anterior alpha power', …)`,
`check('P3 / T5 alpha power (parietal is not starved vs posterior temporal)', …)` and its
`P4 / T6` counterpart, and `check('C3 / F3 alpha-band power (background mu is central, not
frontal)', …)`. The retracted clause's check, `check('P4-O2 / C4-P4 alpha power (PDR on the
posterior link, not central-parietal)', …)`, has been **retired**; the assertion that replaced it,
`check('C4-P4 and P4-O2 BOTH carry the PDR (neither link starved; ratio near 1)', …)`, states only
that neither posterior link is starved and does not rank them.

**Status.** enforced (automated) · **Source.** user, 2026-08-14 — the bipolar-derivation clause
retracted 2026-08-28 after re-reading the cited source; referential topography clauses added the
same day.

### IK-007 — Eye opening attenuates posterior alpha; mu does not react to it

**Claim.** Opening the eyes attenuates the posterior dominant rhythm markedly and frequently
abolishes it outright; closing them restores it — and restores it **prominently**. For a second or
two after closure the PDR overshoots its settled amplitude before easing back, and it may briefly
run faster ("alpha squeak", which learningeeg warns makes a PDR read faster than it is). The mu
rhythm does **not** react to eye
opening — it persists with the eyes open, and blocks instead with movement of the contralateral
limb, the intention to move, or tactile stimulation. Reactivity to eye opening is therefore one
of the features that separates the two rhythms of [[IK-006]], and a model that attenuates mu on
eye opening removes that discriminator.

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `eyes-open`, 30 mm/s, 7 µV/mm.
Turning the toggle on, 8–12 Hz power on the posterior links P3-O1, P4-O2, T5-O1, T6-O2 falls to
a small fraction of its eyes-closed value. Across the same transition, mu-band power at C3 and
C4 is **unchanged**. Turning on `blink` implies eyes open and produces the same posterior
attenuation. The size of the posterior attenuation is not asserted — only that it is large and
that the central change is nil.

The same holds for the **eye-opening maneuver** (toggle `eye-opening`, [[IK-011]]): between the
upward opening sweep and the downward closing sweep the eyes are open, and the PDR on P4-O2 falls to
**under half** its eyes-closed amplitude. After closure it **rebounds**: 0.75–2.0 s after closing it
is at least 1.2× the same subject at the same moments without the maneuver, and 4–5 s after it
is back within 0.8–1.3× of that. (Both real records are still raised at 2.5–3.5 s.) Only "attenuated while open, rebounding above resting after
closure, then settling" is asserted, not the exact latencies. The squeak is modelled but **not
asserted**. It is below cycle-counting resolution in 0.5 s windows, on the real record and the
engine alike.

Mu is a per-subject trait ([[IK-033]]) that most simulated subjects do not have, so the mu clause
is asserted **for a subject exhibiting mu**; the check pins `muFraction: 0.45, muLaterality: 0.5`.
The posterior-attenuation clause holds for every subject.

**Mechanism.** *(non-binding)* Conventionally the Berger effect: visual afferent input
desynchronises the occipital generator, while mu — driven by the sensorimotor system — is
indifferent to visual input and gated by somatosensory and motor activity instead. Not asserted.
The observable would follow equally from any account in which the two rhythms have separate
inputs.

**Check.** `validateEngine.ts` — `check('C3+C4 isolated mu power, eyes-open / eyes-closed (mu does
not block; IK-007)', …)` for the mu clause, and `check('P4-O2 alpha, eyes-open / eyes-closed (Berger
effect attenuation)', …)` for the posterior attenuation. For the maneuver:
`check('PDR amplitude while eyes held open / eyes closed, P4-O2 (IK-007: attenuates by at least half)', …)`,
`check('PDR amplitude 0.75-2.0 s after eye closure / same moments without the maneuver (IK-007: rebounds above resting)', …)`,
`check('PDR amplitude 4-5 s after eye closure / same moments without the maneuver (IK-007: settles back)', …)`,
`check('eye-opening maneuvers in the window (enough to measure)', …)` and `check('eye closures followed
by >= 5 s of closed eyes (enough to measure the rebound)', …)`, all on the PDR's own contribution
(same seed, `alphaRms` 12 minus 0).

**Status.** enforced (automated) · **Source.** user, 2026-08-14 — briefly `violated` on
2026-09-01, resolved the same day, and the reason is worth keeping. The check measured *total*
8–13 Hz power at C3/C4, which cannot separate "mu blocked" from "posterior alpha that reaches
C3/C4 collapsed". Once the forward model gained a realistic algebraic tail the posterior rhythm
genuinely does reach the central electrodes, so the composite ratio fell to 0.764 and reported a
violation of something this entry never claimed. Isolating mu's own contribution — same seed,
`muFraction` 0.45 minus 0, which leaves every other source bit-identical — gives **1.000**: mu is
exactly non-reactive, which is what the claim says. The old check was measuring the confound its
own comment had already identified. The mu/eyes-open contradiction
was resolved 2026-08-19 by removing the `mu` term from the `eyes-open` `bandGate` (see §11), so
the entry has moved off `proposed`.

**Violated by the maneuver until 2026-09-11, unnoticed.** The `eye-opening` maneuver drew its
opening and closing sweeps with the posterior alpha running straight through the 2.5–4.5 s the eyes
were held open. That is the one picture reactivity says cannot happen: learningeeg has the PDR
emerge "right after the patient closes their eyes". No check exercised the maneuver, so the entry
read `enforced` throughout. Fixed by driving one alpha-blocking state in `engine.ts` from both the
`eyes-open` toggle and the maneuver's open interval (`EYES_OPEN_ALPHA_GAIN` 0.35, blocking and
return time constants 0.15 s and 0.4 s). That also removed the toggle's one-sample step. Measured
over 4 seeds and 55 maneuvers: open/closed PDR power 0.17–0.28, and 0.64–0.74 of closed power
0.5–1.0 s after closure.

**Post-closure rebound added 2026-09-11, from a real record.** learningeeg's
`pdr-emerges-eye-closure` figure (Normal Awake chapter), traced by `scripts/read-lab/py/closure.py`
at 91 px/s (ECG 71 bpm, PDR 10.8 Hz by counting), shows the posterior 8–13 Hz envelope, relative to
the settled PDR at +3–5.5 s: 1.21 / 1.43 / **2.19** / 1.58 / 1.27 over +0–0.5 / 0.5–1 / 1–1.5 /
1.5–2.5 / 2.5–3.5 s after closure. The engine had none of this. It restored the PDR to wherever its
own envelope happened to be (0.90 / 0.98 / 1.00 of a no-maneuver control). Modelled in `engine.ts`
(`ALPHA_REBOUND_GAIN` 0.8). The squeak (`ALPHA_SQUEAK_HZ` +1.0 Hz decaying over 0.4 s) is bounded by
the same record, which shows no quickening of ≥1 Hz averaged over the first second.

**A second real record changed the shape.** learningeeg's `normal-alpha-eye-closure` (same chapter;
closure at its sharp frontal positive sweep, PDR 10.1 Hz by counting against the caption's "10")
reads 1.54 / 1.18 / 2.44 / 1.71 / 1.34. Two changes came from reading it. First, a better reader:
the eye closure is now the frontal downswing *after which the PDR emerges*, refined on the
unfiltered trace. The naive pick landed on an event with 2.2× more alpha before it than after.
Second, a better engine: the refined first record reads 0.99 / 1.41 / 1.77 / 1.94 / 1.62, and the
pair's mean, **1.27 / 1.30 / 2.10 / 1.83 / 1.48**, peaks 1–2 s after closure and is still raised at
3 s. The first engine shape (peak 1.25 s) rose too early and settled too soon. Now a cubic rise
peaking at 1.7 s, measured over 7 engine closures: **1.17 / 1.75 / 1.99 / 1.53 / 1.39**. It is
still a little early at 0.5–1 s. That is noted, not fitted.

### IK-013 — The posterior dominant rhythm is near-symmetric between the hemispheres

**Claim.** In a normal awake record the posterior dominant rhythm is closely symmetric
side-to-side: the peak alpha frequency differs between hemispheres by less than 1 Hz, and the
alpha amplitude differs by less than 50% of the larger side. A modestly higher amplitude over the
right (non-dominant) hemisphere is normal; a sustained frequency or amplitude asymmetry beyond
these limits is not. Scope: normal awake, eyes-closed background — not asserted during
drowsiness, under eye opening ([[IK-007]]), or with a lateralising pattern active.

**Observable.** Referential occipital electrodes O1 and O2 (montage `reference-car`), state
`awake`, no lateralising toggle. The alpha spectral-peak frequencies at O1 and O2 lie within 1 Hz
of one another, and the alpha amplitudes (√ 8–12 Hz band power) at O1 and O2 are within 50% of
the larger. Either bound exceeded marks a lateralised abnormality rather than normal variation.

**Mechanism.** *(non-binding)* Homologous occipital generators entrained by a shared
thalamocortical alpha network; a gross, sustained asymmetry implies a structural or functional
disturbance on the lower-amplitude or slower side. Not asserted — the observable bounds the
asymmetry without attributing a cause.

**Check.** `validateEngine.ts` — `check('O1 / O2 alpha peak frequency asymmetry (<1 Hz)', …)` and
`check('O1 / O2 alpha amplitude asymmetry (<50%)', …)`.

**Status.** enforced (automated) · **Source.** user, 2026-08-19

### IK-034 — The descent into sleep attenuates before it builds

**Claim.** Going from wakefulness into sleep does **not** make the record steadily bigger. As the
posterior dominant rhythm drops out, the tracing *attenuates*: drowsiness and N1 are low-amplitude
states, and N1 is the quietest of them. Amplitude only rises again in N2, and it is N3 — slow-wave
sleep — that is the genuinely high-amplitude stage, on the strength of its delta. Scope: the
**background**, not the discrete graphoelements that ride on it; POSTS, vertex waves and
K-complexes are high-amplitude events that legitimately appear in exactly the stages whose
background is quiet, and they are not counted against this claim.

A second clause, about *which band* carries each stage: drowsiness and N1 slow into **theta**, not
delta. Delta at any appreciable amplitude belongs to N3 (the >75 µV picture its own checks guard), and a model
that puts substantial delta into drowsiness or N1 has mislabelled the stage.

**Observable.** Montage `bipolar-ap`, no toggles, 30 mm/s, 7 µV/mm, measured on the
centro-posterior rows C3-P3, P3-O1, C4-P4, P4-O2 with a transient-robust statistic
(inter-quartile range). Relative to `awake`: `drowsy` sits at 0.6–1.0 (currently 0.803), `n1` at
0.5–1.0 (currently 0.790), and `n1` is no louder than `drowsy` (currently 0.984). Going the other
way, `n3` is 2–8× `n2` (currently 3.36). The N3/N1 contrast is asserted where AASM scores slow
waves — frontal, ear-referenced (mean IQR of F3-A1 and F4-A2, montage `reference-ipsi`): `n3` is
3–12× `n1` (currently 7.71). On the centro-posterior bipolar rows synchronized delta largely
cancels, so the ratio there (2.35 on the same record) is not a measure of N3's amplitude.

The frontopolar rows are deliberately excluded from the measurement: drowsiness and N1 bring slow
roving eye movements with them ([[IK-036]]), which are an ocular phenomenon riding on the
background rather than the background itself — including those rows measured drowsiness at 1.20×
awake when its cerebral background had in fact fallen to 0.86×.

**Mechanism.** *(non-binding)* Conventionally, the waking record's amplitude is dominated by the
PDR, so losing it lowers the trace before the synchronised thalamocortical delta of slow-wave
sleep raises it again. Not asserted — the observable fixes only the ordering.

**Check.** `validateEngine.ts` — `check('drowsy background / awake (drowsiness attenuates, not
amplifies)', …)`, `check('N1 background / awake (diffuse attenuation of the tracing)', …)`,
`check('N1 background / drowsy (N1 is the quietest state, not louder)', …)`, `check('N3 background
/ N2 (N3 clearly exceeds N2)', …)` and `check('N3 background / N1, frontal ear-referenced (AASM
derivation)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-28 — drafted by the assistant from
learningeeg.com's *Normal Asleep* chapter ("gradual loss of the PDR with coinciding diffuse
attenuation of the tracing") and approved by the user. Written because `STATE_GAINS` ran the
opposite way: background 1.00 → 1.10 → 1.20 → 1.35 → 1.60 with delta climbing alongside, which took
display-space row RMS from 8.3 µV awake to 15.7 in N1 — the tracing nearly doubling across the one
transition the course calls an attenuation. Clinical wording not independently confirmed.
**Revised** 2026-09-14 (approved by the user): the N3/N1 clause moved from the centro-posterior
bipolar rows to the frontal ear-referenced derivation AASM scores slow waves on (AASM Manual v2.0).
Its old bound, 3–12× on the bipolar rows (then 3.46), had no cited source and was met only by a
vertex-focal N3 delta that the sleep rebuild removed; with diffuse, synchronized slow waves the
bipolar ratio read 2.35. See SLEEP-ARCHITECTURE-AUDIT.md.

## 2. Sleep architecture and graphoelements

Defining features of each sleep stage and the graphoelements that mark them — vertex waves,
K-complexes, spindles, POSTS, sawtooth waves — including rate, duration, and where they are
maximal.

### IK-035 — REM is identified by its eye movements and atonia, not by its background

**Claim.** The REM background does not identify the stage. It is diffusely attenuated,
low-voltage and mixed-frequency — close enough to N1 that reading the background alone cannot
separate them, and that is a property of REM rather than a modelling shortcut. Two features do
identify it, and both are non-cerebral:

*(a) Rapid eye movements.* Sharply contoured deflections at the lateral frontal electrodes,
**opposing** across the midline, with a **faster upslope than downslope** — the temporal asymmetry
is part of the claim, and is what separates a REM from the slow, smooth roving movement of
drowsiness ([[IK-036]]) and from a saccade.

*(b) Muscle atonia.* Muscle activity is near-absent throughout the stage. This is the one state
where an arousal-like background and near-total loss of muscle tone coexist, so muscle tone here
cannot be inferred from how alert the background looks.

**Observable.** Montage `bipolar-ap`, state `rem`, 30 mm/s, 7 µV/mm. The background, measured as
in [[IK-034]] on the centro-posterior rows, sits at 0.4–1.0 of awake (currently 0.688). Isolating
the `rem-eyes` contribution by same-seed differencing: Fp1-F7 and Fp2-F8 are anti-correlated
(≤ −0.5; currently −1.000), and on the largest excursion the fall from peak back to 10% takes
1.5–8× as long as the rise from 10% to peak (currently 2.71). Muscle-attributable 20–70 Hz power at
T3 — the same-seed difference between muscle gated on and off — is under 25% of the same quantity
in `n2` (currently 0.006). Absolute amplitudes and the rate of the movements are not asserted.

Measuring the muscle term by differencing is part of the observable, not a convenience: total
20–70 Hz power at T3 reads 0.81 of N2 in REM because the aperiodic background occupies that band
too and swamps the effect.

**Mechanism.** *(non-binding)* Conventionally, REM combines cortical activation with brainstem-
mediated inhibition of spinal motor neurons, which is why the EEG looks awake while the muscles are
silent; the eye movements escape that inhibition. Not asserted — the observable fixes the
background level, the movement morphology and the muscle level, not their causes.

**Check.** `validateEngine.ts` — `check('REM background / awake (diffuse attenuation)', …)`,
`check('rem-eyes: Fp1-F7 vs Fp2-F8 correlation (opposing across the midline)', …)`,
`check('rem-eyes fall / rise duration (faster upslope than downslope)', …)`, and
`check('REM muscle / N2 muscle at T3 (REM atonia: near-absent muscle)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-28 — drafted by the assistant from
learningeeg.com's *Normal Asleep* chapter and approved by the user. Written when the audit found
the simulator had no REM state at all: `PatientState` ran `awake | drowsy | n1 | n2 | n3`. Atonia
required a state-specific term (`STATE_EMG_SCALE`) because muscle had been derived from vigilance,
which structurally cannot express this stage — raising vigilance to produce the wake-like
background would have raised the muscle with it. Clinical wording not independently confirmed.

## 3. Montage, polarity, and localization conventions

Display polarity convention, how bipolar subtraction behaves at a focus, how referential
montages behave, and what each montage can and cannot localize.

### IK-003 — Two bipolar localizing signatures: reversal under an electrode, cancellation between two

**Claim.** A focal source's field falls off with distance in every direction, so where its peak
sits relative to the electrodes decides which of two pictures a bipolar chain shows.

*(a) Peak under an electrode — phase reversal.* A source small enough that one electrode clearly
overlies its maximum makes the links immediately above and below that electrode carry the same
waveform inverted against each other. The reversal names the peak electrode.

*(b) Peak between two electrodes, or a broad field covering both — phase cancellation.* When two
adjacent electrodes sit on the field near-equally, the link spanning them is near-isoelectric
while the links flanking it deflect in opposite senses. Here the focus is localised to the
**flat** channel; there is no reversal to find.

In both cases the waveform continues down the chain past the focus with falling amplitude rather
than stopping at it.

**Observable.** Montage `bipolar-ap`, state `awake`, 30 mm/s, 7 µV/mm.

*Case (a)* — toggle `focal-temporal-ictal`, onset side left: over the sustained discharge, F7-T3
and T3-T5 are inverted against each other (correlation ≤ −0.4; currently −0.947). On the common
average (`reference-car`), F7 and T5 carry the *same* polarity as T3 (correlation ≥ +0.6; currently
0.894 and 0.559), at 5–90% of T3's 3.5–6 Hz power (currently 0.042 and 0.018) — the outward decay.
**This clause is not met**; see *Violated 2026-09-22* below. Switching the onset side to right reproduces every
one of these on Fp2-F8 / F8-T4 / T4-T6 / T6-O2; nothing about the geometry is left-specific.

*Case (b)* — no toggle produces this geometry, so it is asserted with a synthetic source placed
midway between F8 and T4. This is driven as a genuine time series (`spikeSlowWave`) through the
real `computeChannelVoltage` on the actual bipolar-ap channels — a true display-space check, not a
bare leadfield-gain comparison. F8-T4 then measures under 10% of the larger flanking link
(currently 0.000 — it cancels essentially completely), Fp2-F8 and T4-T6 deflect in opposite senses, and T6-O2 continues in T4-T6's
direction at under 50% of its size, decaying with distance.

*Case (a), interictal spike morphology* — the same phase-reversal signature holds for the
**interictal focal-spike** toggles, not only the ictal source above. With `focal-spikes-lt`
(peaking at T3), F7-T3 and T3-T5 are inverted against each other (correlation ≤ −0.4) and their
peaks deflect in opposite senses; `focal-spikes-rt` (T4) reproduces it on F8-T4 / T4-T6 and
`focal-spikes-lf` (F3) on Fp1-F3 / F3-C3. The reversal names the peak electrode regardless of
whether the generator is a rhythmic seizure or a single interictal spike.

Not asserted: absolute amplitudes, and whether the outward decay is *visible* at a given
sensitivity — at low signal amplitude it is correspondingly harder to see, which is a property of
the display, not of the signal.

**Mechanism.** *(non-binding)* Conventionally volume conduction through a resistive head, with a
bipolar derivation subtracting the shared electrode from each of its two links, so a single
generator produces two opposed traces. Not asserted. Neither a reversal nor a flat link
establishes the absolute sign at any electrode — a bipolar derivation measures only a difference —
and case (b)'s flat channel is equally consistent with a broad field and with a source midway
between the pair.

**Check.** `validateEngine.ts` — case (a): `check('bipolar F7-T3 vs T3-T5 correlation (phase
reversal)', …)`, its `F8-T4 vs T4-T6` mirror, `check('referential corr T3-F7 (shared source, same
polarity)', …)`, `check('referential corr T3-T5 (shared source, same polarity)', …)`,
`check('F7 theta / T3 theta (ripples out, but attenuated)', …)` and `check('T5 theta / T3 theta
(ripples out, but attenuated)', …)`, with their F8/T4/T6 mirrors. Case (b): the four checks under
*Localisation: source BETWEEN two electrodes*. Additionally, the display-space audit (Step 21)
verifies both signatures on rendered channels: case (a) for the interictal spike toggles —
`check('focal-spikes-lt: F7-T3 vs T3-T5 correlation (phase reversal at T3)', …)` with its peak-
sign-product check and the `focal-spikes-rt`/`focal-spikes-lf` mirrors — and case (b) —
`check('F8-T4 (spans the midway source) is near-isoelectric vs its flanks', …)`, `check('Fp2-F8
and T4-T6 (the flanking links) deflect OPPOSITE ways', …)`, `check('T4-T6 and T6-O2 continue in
the SAME direction past the source', …)`, and `check('T6-O2 decays relative to T4-T6 (falloff with
distance)', …)`.

**Violated 2026-09-22 — the outward-decay clause of case (a).** The referential clause named no
montage, and its checks read the engine's raw potentials, i.e. against infinity. That view carried
a spurious same-sign far field: the forward model gave every source a positive field everywhere and
no return current, so a focal source lifted every distant electrode a little (forward.ts,
`surfaceMean`, which now removes it). On raw potentials F7 and T5 read 0.104 and 0.069 of T3's
power and passed. No montage ever showed that. Any referenced display cancels the offset, and on
`reference-car` the page carried F7 at ~0.04 and T5 at ~0.02 of T3 throughout, which is below this
entry's 5% floor. The same holds on the mirror side (F8 0.042, T6 0.016). T3-T5's same-polarity
correlation also reads 0.559 against 0.6 there. Widening the seizure source was tried and not taken:
at nearly double the extent (0.65) T5 reached only 4.8% on an ear reference, whose ipsilateral ear
picks up the seizure itself, and the T3 reversal began to flatten. The source stays as it is until
there is a sourced figure for how regional a temporal seizure's field should be. The reversal
clauses (case (a) bipolar, case (b), and the interictal spikes) are unaffected and pass.

**Status.** violated · **Source.** user, 2026-08-14 — extended 2026-08-24 to cover the
interictal focal-spike toggles and a genuine display-space case-(b) check (assistant-drafted
extension, approved in the batch this session). Referential clause restated on `reference-car` and
the entry marked violated 2026-09-22, at the user's direction.

### IK-004 — A localizing reversal holds at one electrode for the whole discharge

**Claim.** A phase reversal supports localisation only when it stays at the *same* electrode for
the duration of the epileptiform event. A reversal appearing in a single transient, or one that
migrates between electrodes over the course of a discharge, does not localise. [[IK-003]]
describes what a reversal looks like; this entry is about when to believe one.

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `focal-temporal-ictal`, onset side
left. Taking consecutive 2 s windows across the sustained discharge: *every* window shows F7-T3
and T3-T5 inverted against each other (worst window ≤ −0.4; currently −0.874), and *no* window
shows a second reversal one link higher — Fp1-F7 and F7-T3 stay in phase throughout (worst
window ≥ +0.4; currently +0.988). After the event ends the relationship is no longer asserted.

**Mechanism.** *(non-binding)* Candidate: a single generator whose position does not move gives a
reversal at a fixed electrode, whereas chance cancellations and the sharp normal variants
(wicket, BETS, small sharp spikes) produce isolated reversals that do not repeat at the same
site. Not asserted — the observable shows only that the reversal is stable, not why.

**Check.** `validateEngine.ts` — `check('worst 2 s window, F7-T3 vs T3-T5 (reversal never
lapses)', …)` and `check('worst 2 s window, Fp1-F7 vs F7-T3 (reversal never migrates)', …)`.

**Status.** enforced (automated) · **Source.** user, 2026-08-14

### IK-008 — The display is negative-up

**Claim.** The display draws a channel **downward** when its input 1 is more positive than its
input 2, and **upward** when input 1 is more negative. This holds in every montage, at every
paper speed and sensitivity, and for neural signal and artifact alike.

Consequently a transient named for its surface polarity renders in the direction its name
implies. Surface-**negative** transients — the vertex wave, the sharp component of the
K-complex, focal spikes and sharp waves, generalised spike-wave and polyspike-wave, GPEDs, the
6 Hz phantom spike-wave, and BETS — point **up**. Surface-**positive** transients — POSTS,
lambda waves, and the dominant middle phase of a triphasic wave — point **down**, which is why
POSTS and lambda look like inverted checkmarks rather than ordinary sharp waves.

**Observable.** Any montage, 30 mm/s, 7 µV/mm. The polarity legend in the Display panel reads
*up = negative (−) · down = positive (+)*. Isolating each pattern's own contribution — a
same-seed run with the toggle off, subtracted — the leading phase is negative-going on screen
for `v-waves` at Cz, `k-complex` at Cz, `focal-spikes-lt` at T3, `bets` at T3, and the largest
excursion is negative-going for `3hz-gsw` at Fz, `polyspike-wave` at Fz, `gpeds` at Cz,
`6hz-sw` at Cz; and positive-going on screen for `posts` at O1, `lambda` at O1, and `triphasic`
at Fz. `blink` on the row Fp1-F3 deflects downward — see [[IK-001]]. Only direction is asserted;
amplitudes and durations are not.

**Mechanism.** *(non-binding)* This is a display convention rather than a physiological fact,
conventionally traced to pen deflection on analogue machines. Nothing physiological follows
from it, and nothing about the underlying signal changes if it is reversed — which is exactly
what makes it dangerous: every power, correlation and topography assertion in the validation
battery is invariant to a global sign flip, so an inverted display passes all of them. This
entry exists because the simulator did in fact render every trace inverted for a period while
the whole battery was green.

**Check.** `validateEngine.ts` §7c — the eleven
`check('<pattern> renders UP/DOWN (±1)', …)` assertions built from the `POLARITIES` table, plus
`check('blink Fp1-F3 peak (IK-001: Fp1 positive)', …)` and
`check('blink Fp1-F3 renders DOWN (+1)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-17 — claim drafted by the
assistant at the user's request, recording a convention the code already enforces; wording not
yet independently confirmed by the user.

## 4. Artifacts

*Non-cerebral signals and their signatures: ocular (blink, lateral gaze), muscle, ECG, electrode
pop, sweat, movement, mains. Deflection direction, topography, frequency content, and which
montage best exposes each.*

### IK-036 — Slow roving eye movements mark drowsiness and N1

**Claim.** As a subject becomes drowsy the eyes begin to rove: very slow, smooth, side-to-side
movements that appear on the EEG as **opposing undulations of the lateral frontal regions** — when
one side deflects up the other deflects down. They are a marker of drowsiness and N1 and are absent
in relaxed wakefulness, so their appearance is one of the signs that a record has left the awake
state. Two things distinguish them from the other ocular events already recorded here: they are far
**slower** than a blink ([[IK-001]]) or a lateral saccade ([[IK-002]]), and they are **smooth**
rather than sharply contoured, which is what separates them from the rapid eye movements of REM
([[IK-035]]). Scope: the opposition across the midline, the slowness, and the state gating.
Amplitude and rate are not asserted.

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `roving-eyes`, 30 mm/s, 7 µV/mm.
Isolating the source's contribution by same-seed differencing, Fp1-F7 and Fp2-F8 are anti-correlated
(≤ −0.5; currently −1.000), and the spectral peak of that contribution lies between 0.12 and 0.6 Hz
(currently 0.244). State gating is separately observable: switching to state `drowsy` with **no**
toggle set, the peak-to-peak on Fp1-F7 is 1.8–20× its awake value (currently 4.85), because the
movements belong to the state rather than to the toggle.

**Mechanism.** *(non-binding)* Conventionally the same horizontal corneo-retinal dipole that
produces lateral gaze artifact — the eye is an electrical dipole with the cornea positive, so
rotating it toward one lateral frontal electrode and away from the other drives the two in opposite
directions. Not asserted; a bipolar derivation shows only that the two sides oppose, not which
electrode carries which sign.

**Check.** `validateEngine.ts` — `check('roving-eyes: Fp1-F7 vs Fp2-F8 correlation (opposing across
the midline)', …)`, `check('roving-eyes peak frequency (very slow roving, not a saccade)', …)`, and
`check('roving-eyes appear in drowsy with no toggle (state-intrinsic), vs awake', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-28 — drafted by the assistant from
learningeeg.com, which names them in both the *Normal Awake* chapter ("decreased eye blinks and
roving eye movements … very slow opposing undulations of the bilateral frontal regions") and the
*Normal Asleep* chapter ("slow roving eye movements"), and approved by the user. Written because
the simulator had no source for them at all. Clinical wording not independently confirmed.

### IK-001 — Eye-blink deflection polarity

**Claim.** A blink produces a downward deflection wherever Fp1/Fp2 is input 1 of a bipolar pair.
Scope: antero-posterior bipolar chains only. In a transverse montage the symmetric derivation
Fp1-Fp2 largely cancels the blink instead. Lateral eye movement presents differently — see
[[IK-002]]. The downward deflection is followed by a smaller opposite-going (upward) excursion
that returns the trace to baseline within about a second. This overshoot is produced by the
recording chain's low-frequency filter rather than by lid movement, so **its size is a property of
the LFF and not of the blink**. It grows monotonically with the LFF corner — measured on this
simulator's own chain with a canonical 300 ms, 100 µV blink: 4.6% at 0.05 Hz, 21.0% at the 0.25 Hz
this simulator runs, 39.7% at 0.53 Hz, and 63.6% at 1 Hz — and disappears on a DC-coupled or
very-long-time-constant recording.

Two things this entry previously got wrong. First, 0.25 Hz is **not** "the routine clinical
low-frequency setting", as this claim asserted from 2026-08-10 until 2026-09-01: `chain.ts`'s own
comment is candid that it "sits deliberately below" routine, and ACNS Guideline 1 §3.5 requires
only that the LFF be *no higher than* 1 Hz — compliant with a ceiling is not the same as usual, and
0.25 Hz (TC 0.64 s) is not a detent a clinical amplifier offers. Second, the 10–50% figure in the
Observable is therefore **scoped to a 0.25 Hz LFF and is not a clinical constant**: at the routine
1 Hz the same blink overshoots 63.6%, outside this entry's own asserted range. Were the LFF ever
exposed as a user control, that bound would break immediately — which is the tell that it was never
a clinical bound.

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `blink`, 30 mm/s, 7 µV/mm.
All four frontopolar rows — Fp1-F3, Fp2-F4, Fp1-F7, Fp2-F8 — deflect downward simultaneously,
decaying posteriorly down each chain. Switching to `bipolar-transverse` with the same toggle, the
Fp1-Fp2 row shows a markedly smaller excursion than any bipolar-ap frontopolar row. On Fp1-F3 each
blink shows the downward peak followed, within ~1 s, by an upward excursion of roughly 10-50% of
the downward peak, after which the row returns to its pre-blink baseline. Absolute amplitude and
duration are not asserted by this entry — only that relative morphology.

**Mechanism.** *(non-binding)* Conventionally attributed to Bell's phenomenon: the globe rolls
upward on lid closure, rotating the positive cornea toward Fp1/Fp2, so the frontopolar electrodes
go positive relative to the rest of the chain. Not asserted by this entry. A bipolar derivation
shows only that Fp1 exceeds F3 and F7, which would follow equally from the frontal electrodes
going negative; the claim stands either way.

**Check.** `validateEngine.ts` §7c — `check('blink Fp1-F3 peak (IK-001: Fp1 positive)', …)`,
`check('blink Fp1-F3 renders DOWN (+1)', …)`, and for the recovery swing
`check('blink Fp1-F3 recovery swing runs UP (-1; IK-001, opposite the main deflection)', …)`,
`check('blink Fp1-F3 recovery swing / downward peak (IK-001: a smaller opposite swing)', …)` and
`check('blink Fp1-F3 back at baseline 1.5-3 s after the peak (IK-001), as a fraction of peak', …)`.
The three swing checks are the only ones in §7c built with `recordingChain: true`, because the
chain is what makes the swing. All five assert on the rendered bipolar row, the same
space as the claim: the blink's contribution is isolated by subtracting a same-seed run with the
gate off, and its sign is asserted positive — which the canvas draws downward, since clinical EEG
is negative-up. The earlier topography check at `validateEngine.ts:320` remains, but it is a power
ratio and therefore sign-blind; it cannot test direction.

**Status.** enforced (automated) · **Source.** user, 2026-08-10 — direction verified 2026-08-17,
after a display-convention fix: the canvas had been drawing positive-up, so this entry was
violated on screen while every existing check passed. Morphology added at user's request,
2026-08-25: the blink was monophasic on the page because `AmplifierHighPass` ran a 0.05 Hz corner
(TC 3.2 s), a DC-coupled research-amplifier setting; at `CLINICAL_LFF_HZ` = 0.25 Hz the swing
measures 0.226 of the downward peak, with 0.031 of it left 1.5-3 s later.

### IK-002 — Lateral eye movement is out of phase at F7 and F8

**Claim.** In an antero-posterior bipolar montage, a lateral eye movement produces a phase
reversal at F7 and a phase reversal at F8 that are mirror images of each other: when the F7
reversal deflects one way, the F8 reversal deflects the other. This left-right opposition is what
distinguishes lateral gaze from a blink, which is symmetric and frontopolar-maximal — see
[[IK-001]].

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `eye-movement`, 30 mm/s, 7 µV/mm.
At each eye movement, Fp1-F7 and F7-T3 deflect in opposite directions (phase reversal at F7), and
Fp2-F8 and F8-T4 likewise (phase reversal at F8) — with the F7 pair opposite in sense to the F8
pair. The simultaneous all-four-rows-downward frontopolar pattern of [[IK-001]] is absent. The
entry asserts the polarity *relationship*, not which way the simulated eyes look at a given
moment.

**Mechanism.** *(non-binding)* Conventionally attributed to the horizontal component of the
corneo-retinal dipole: on lateral gaze both globes rotate together, carrying the positive cornea
toward one lateral frontal electrode and the negative retina toward the other — looking left
putting F7 positive and F8 negative, and the reverse looking right. Not asserted by this entry.
The montage shows only that the two reversals oppose each other, not which electrode carries
which sign.

**Check.** In `scripts/src/validateEngine.ts`: `eye-movement: Fp1-F7 vs F7-T3 correlation
(IK-002: phase reversal at F7)`, `eye-movement: Fp2-F8 vs F8-T4 correlation (IK-002: phase
reversal at F8)`, and `eye-movement: Fp1-F7 vs Fp2-F8 correlation (IK-002: out of phase across
the midline)` — the isolated `saccade` contribution on each bipolar-ap link (on−off, same seed),
asserting both frontotemporal links anti-correlated at their shared electrode and the two
reversals mirror-opposed across the midline. All three land at −1.000.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-10; clinical claim confirmed against
learningeeg.com (artifacts chapter: F8 is the point of maximal positivity on rightward gaze, a
positive phase reversal at F8 with the mirror-image negative phase reversal at F7), 2026-08-25;
verified in display space via renderTrace (bipolar-ap, eye-movement) — mirror-image phase
reversals at F7 and F8, opposite in sense, 2026-08-25; automated display-space check added
2026-08-25.

### IK-011 — Eye opening deflects the frontopolar rows upward, opposite a blink and smaller

**Claim.** Opening the eyes produces an **upward** deflection wherever Fp1/Fp2 is input 1 of an
antero-posterior bipolar pair — the opposite direction to a blink ([[IK-001]]) — and of **smaller
amplitude** than a blink. As with a blink, the symmetric transverse derivation Fp1-Fp2 largely
cancels it. Closing the eyes again a few seconds later gives a smaller downward transient. This is
the deflection artifact of the eye-opening maneuver; it is distinct from the alpha attenuation
that accompanies eye opening ([[IK-007]]), which is a change in the ongoing rhythm, not a
transient.

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `eye-opening`, 30 mm/s, 7 µV/mm. On
each opening, the frontopolar rows — Fp1-F3, Fp2-F4, Fp1-F7, Fp2-F8 — deflect upward
simultaneously, decaying posteriorly down each chain; the peak excursion on Fp1-F3 is opposite in
sign to the same row's blink deflection and smaller in magnitude (currently the opening peak is
about 0.36× the blink peak). A smaller downward transient follows at closing. Switching to
`bipolar-transverse`, the Fp1-Fp2 row shows a markedly smaller excursion than any bipolar-ap
frontopolar row. Only direction and the smaller-than-blink relationship are asserted; absolute
amplitude and duration are not.

**Mechanism.** *(non-binding)* Conventionally, on eye opening the lids retract and the globe
settles from its resting/Bell's-elevated position toward primary gaze, sweeping the electropositive
cornea inferiorly — away from Fp1/Fp2, which therefore go negative relative to the rest of the
chain (upward on a negative-up display). Not asserted by this entry. A bipolar derivation shows
only that Fp1 falls below F3 and F7, which would follow equally from the frontal electrodes going
positive; the claim stands either way. That the opening deflection is smaller than a blink is an
observation, not a consequence of this mechanism.

**Check.** `validateEngine.ts` — `check('eye-opening Fp1-F3 renders UP (-1; IK-011, opposite a
blink)', …)`, `check('eye-opening Fp1-F3 peak (sanity floor)', …)`, and `check('eye-opening /
blink Fp1-F3 peak magnitude (IK-011: smaller than a blink)', …)`. Each isolates the generator's
contribution by subtracting a same-seed run with the gate off, and asserts on the rendered
bipolar row — the same space as the claim.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-18 — proposed by the assistant and
approved by the user this session; clinical wording not yet independently confirmed.

### IK-032 — The blink field is bifrontal: the second row of each chain deflects too

**Claim.** In an antero-posterior bipolar montage a blink is not confined to the frontopolar
rows. The second row of each frontal chain — F3-C3, F4-C4, F7-T3, F8-T4 — carries its own
downward deflection, in the same direction as the frontopolar row above it and smaller than
it. The decay continues posteriorly: by the occipital row of each chain the blink is
effectively absent. Direction and morphology of the frontopolar rows themselves are
[[IK-001]]; this entry adds only the spatial extent. Lateral eye movement has a different
field — see [[IK-002]].

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `blink`, 30 mm/s, 7 uV/mm.
Isolating the blink by differencing a same-seed run with the gate off, and reading every
channel at the instant the blink peaks: F3-C3 and F7-T3 both deflect downward, each between
0.15 and 0.95 of the Fp1-F3 and Fp1-F7 deflection respectively — non-zero, and smaller than
the row above. P3-O1 shows under 10% of Fp1-F3. The same holds mirrored on the right. This
entry does not assert absolute amplitude, nor the exact ratio between rows.

**Mechanism.** *(non-binding)* Two accounts are consistent with this field: a lid sweeping
across the cornea, whose scalp field is strongest above the orbit and reverses below it, or
Bell's phenomenon rotating the globe (see [[IK-001]]). Modelled here as a vertical dipole
plus a monopole at the orbit; the fit is shallow between roughly 70 and 90 degrees of dipole
tilt, so this observable cannot distinguish a vertical lid sweep from a tilted Bell's
rotation. Neither is asserted.

**Check.** `validateEngine.ts` §7c — `check('blink F3-C3 renders DOWN (+1; IK-032, the row
that went flat)', …)`, `check('blink F7-T3 renders DOWN (+1; IK-032)', …)`, `check('blink
F3-C3 / Fp1-F3 (IK-032: present but decaying)', …)`, `check('blink F7-T3 / Fp1-F7 (IK-032:
present but decaying)', …)`, `check('blink P3-O1 / Fp1-F3 (IK-032: no posterior field)', …)`.
All five assert on rendered bipolar rows, the same space as the claim, with the blink
isolated by same-seed differencing and read at a single instant — a field is a snapshot, not
a power ratio.

**Status.** enforced (automated) · **Source.** user, 2026-08-27 — written to close an
enforcement gap: [[IK-001]] already asserted in prose that the blink decays "posteriorly down
each chain", but no check tested it, so an electrode-geometry change collapsed F3-C3 to 0.7 mm
on the page while all five IK-001 checks stayed green.

## 5. Normal variants

Benign patterns mistakable for pathology — mu rhythm, wicket spikes, lambda waves, RMTD, 14&6
positive spikes, SREDA, benign epileptiform transients of sleep — with the features that
distinguish them from abnormalities.

### IK-033 — Mu is a benign variant, present in a minority and often lateralized

**Claim.** Mu is a **benign variant**, not a component of the normal awake background. It is
present in a minority of normal adults, and when present is often predominant over one hemisphere
rather than exactly symmetric. Two consequences follow for the display. In a subject **without**
mu, the awake antero-posterior bipolar chain shows **no phase reversal at C3/C4**, because nothing
in a normal awake background is focal there. In a subject **with** mu, a central phase reversal is
expected and correct — it is how the rhythm is recognised ([[IK-003]]), not a defect to suppress.

Scope: the prevalence, the laterality tendency, and the presence/absence of the central reversal.
Mu's frequency band, arciform morphology, and its blocking with movement are not asserted here;
its non-reactivity to eye opening is [[IK-007]]. This entry is the reason [[IK-006]]'s central
clause is scoped to subjects who have mu.

**Observable.** Montage `bipolar-ap`, state `awake`, no toggles, 30 mm/s, 7 µV/mm. Across subjects
that `sampleSubject` gives no background mu, the mean correlation of F3-C3 vs C3-P3 and F4-C4 vs
C4-P4 is not appreciably negative (currently +0.217). Holding the subject fixed and introducing mu
makes that pair measurably more inverted (currently by 0.428). Mu is present in 20–50% of sampled
subjects (currently 36%). The `mu-rhythm` toggle summons mu deliberately in any subject regardless
of the draw. Absolute amplitudes are not asserted.

**Mechanism.** *(non-binding)* Conventionally the idling rhythm of sensorimotor cortex, focal at
the hand area and therefore a genuinely local generator — which is why it produces a real, correct
phase reversal on a bipolar chain when it is there at all. Not asserted; the observable fixes only
prevalence, laterality and the reversal's dependence on mu being present.

**Check.** `validateEngine.ts` §6g — `check('subjects with background mu (benign variant, minority
finding)', …)`, `check('no-mu subjects: mean F3-C3 vs C3-P3 and F4-C4 vs C4-P4 correlation (no
central reversal)', …)`, and `check('same subject, mu present makes the central pair MORE inverted
(reversal tracks mu)', …)`. The third is paired on one subject rather than compared across
subjects: between-subject spread is large (sd ~0.19 on a 120 s record), and an unpaired
six-subject comparison measured a 0.009 difference against a true ~0.13.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-28 — drafted by the assistant and
approved by the user. Written after a reported bilateral central phase reversal in the default
awake record turned out to be partly caused by every simulated subject carrying an always-on,
symmetric mu. [[IK-029]] had already recorded, three days earlier, that real mu "is present in a
minority of adults and is not a universal background component"; nothing acted on it until the
defect was reported. Clinical wording not independently confirmed by the user.

### IK-015 — Wicket spikes span 6–11 Hz and carry no after-going slow wave

**Claim.** Wicket spikes are a benign temporal variant of drowsiness: monomorphic arciform
(mu-like) sharp transients over the temporal region, spanning roughly the **6–11 Hz** band — not
confined to the alpha range. The single feature that keeps them benign is that a wicket spike is
**not** followed by an after-going slow wave and does not distort the background; a temporal sharp
transient *with* a following slow wave is read as epileptiform instead (contrast [[IK-012]]). They
are a drowsy-state finding and are absent in relaxed wakefulness. Scope: benign morphology and
band only — this entry does not assert a discharge rate or amplitude.

**Observable.** Montage `bipolar-ap` / `reference-car`, toggle `wicket`, at the left-temporal
chain (T3/T5). Turning the toggle on in state `drowsy` raises both 7–11 Hz **and** 6–7.5 Hz power
at T3 above its toggle-off value (the band is wider than alpha alone). The same toggle in state
`awake` produces no change — it is state-gated to drowsiness. The wicket contribution at T3-T5
carries no after-going slow wave: its delta-band power stays a small fraction of its arciform-band
power. Only the band width, the absence of a slow wave, and the drowsy-state gating are asserted.

**Mechanism.** *(non-binding)* Conventionally regarded as a benign sharply-contoured fragment of
the temporal drowsy rhythm rather than a cortical irritative discharge, which is why it lacks the
paroxysmal depolarising shift's after-going hyperpolarisation (the slow wave). Not asserted — the
observable distinguishes wicket from an epileptiform sharp wave by morphology alone.

**Check.** `validateEngine.ts` — `check('T3 7-11 Hz power, wicket on / off (drowsy)', …)`,
`check('T3 6-7.5 Hz power, wicket on / off (drowsy; widened range)', …)`, `check('T3 p2p, wicket
toggle while awake (state-gated off)', …)`, and `check('wicket T3-T5 has no after-going slow wave
(delta/arciform power ratio)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

### IK-016 — 14 & 6 positive bursts are posterior-temporal, ~14/6 Hz, and surface-positive

**Claim.** The 14-and-6-per-second positive burst is a benign variant of light sleep/drowsiness:
brief arciform bursts over the posterior-temporal region with a **~14 Hz** (and a slower ~6 Hz)
comb, **positive at the surface** — so, on a negative-up display, they deflect **down** where the
posterior-temporal electrode is the reference input, and invert on a bipolar link where that
electrode is input 2 (compare the montage-dependence of [[IK-008]]). They are a drowsy/light-sleep
finding, absent in relaxed wakefulness. Scope: band, topography, surface polarity, and state
gating; amplitude and burst rate are not asserted.

**Observable.** Toggle `14-6-pos`, posterior-temporal electrodes T5/T6. In state `drowsy`, 13.5–
15.5 Hz power at T5/T6 rises above its toggle-off value; in state `awake` the same toggle produces
no change (state-gated). In `reference-contra` the burst renders **downward** at T6-A1 (surface-
positive → down). On `bipolar-ap` link T4-T6, where T6 is input 2, the same burst **inverts** and
deflects upward — the sign is a property of the montage, not of the source.

**Mechanism.** *(non-binding)* Conventionally a benign posterior-temporal sleep variant of no
pathological significance; the two combs (~14 and ~6 Hz) are the usual descriptive labels, not
asserted generators. Not asserted — the observable fixes only band, topography, surface polarity,
and state.

**Check.** `validateEngine.ts` — `check('T5/T6 13.5-15.5 Hz power, 14-6-pos on / off (drowsy)',
…)`, `check('T6 13.5-15.5 Hz power, 14-6-pos while awake (state-gated off)', …)`, `check('14-6-pos
renders DOWN at T6-A1, reference-contra (surface-positive)', …)`, and `check('14-6-pos polarity
inverts at T4-T6, bipolar-ap (T6 is input2)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

## 6. Interictal epileptiform activity

Spikes, sharp waves, and spike-wave complexes: duration criteria, morphology, after-going slow
wave, field distribution, and state-dependence.

### IK-012 — Spike vs sharp wave is duration; "-and-slow-wave" is the after-going slow wave

**Claim.** An epileptiform **spike** is a pointed transient roughly **20-70 ms** wide at its base;
a **sharp wave** is the same pointed shape but broader, roughly **70-200 ms**. Duration is the
only thing that separates the two. Either becomes a **spike-and-slow-wave** or
**sharp-and-slow-wave** complex only when it is followed by an after-going slow wave; a bare spike
or sharp wave has no such slow wave. So there are four distinct morphologies, told apart by two
independent axes — base width (spike vs sharp) and presence of the after-going slow wave (bare vs
complex.)

**Observable.** Montage `bipolar-ap` or `reference-car`, state `awake`, at the left-temporal (T3)
focus, one toggle at a time: `ied-spike`, `ied-sharp`, `ied-spike-wave`, `ied-sharp-wave`. The
surface-negative sharp component of `ied-spike` is about 20-70 ms wide at 10% of its peak; that of
`ied-sharp` is about 70-200 ms and visibly broader. `ied-spike` and `ied-sharp` are followed by no
slow wave; `ied-spike-wave` and `ied-sharp-wave` are each followed by a surface-positive
after-going slow wave (the same sharp component plus a slow lobe roughly 0.3-0.8× its amplitude).
Only base width and presence/absence of the slow wave are asserted; absolute amplitude, discharge
rate, and the localised phase reversal (a separate teaching axis, see the `focal-spikes-*` foci)
are not.

**Mechanism.** *(non-binding)* Conventionally the spike/sharp width reflects how synchronously and
over how large a cortical patch the paroxysmal depolarising shift discharges, and the after-going
slow wave reflects the following prolonged hyperpolarisation that terminates it. Not asserted here;
the entry is about what the display shows, not why.

**Check.** `validateEngine.ts` — `check('ied-spike base width (IK-012: spike 20-70 ms)', …)`,
`check('ied-sharp base width (IK-012: sharp wave 70-200 ms)', …)`, `check('ied-sharp broader than
ied-spike (IK-012: duration separates them)', …)`, `check('ied-spike has no after-going slow wave
(IK-012)', …)`, `check('ied-sharp has no after-going slow wave (IK-012)', …)`, `check('ied-spike-wave
carries an after-going slow wave (IK-012)', …)`, and `check('ied-sharp-wave carries an after-going
slow wave (IK-012)', …)`. Each isolates the toggle's contribution at T3 by subtracting a same-seed
run with it off, measures the sharp lobe's base width at 10% of peak and the slow lobe as a
fraction of that peak, and asserts on that — the same observation space as the claim.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-18 — proposed by the assistant and
approved by the user this session; clinical wording not yet independently confirmed.

## 7. Ictal patterns

Electrographic seizure evolution — onset, buildup, spread, offset, post-ictal state — for
absence, focal, and generalized tonic-clonic seizures.

### IK-005 — A lateral focal onset stays on its own chain; the other side comes later

**Claim.** At the onset of a focal seizure arising laterally, the discharge appears on the
bipolar chain over the involved side and is at most marginal on the mirror chain. Contralateral
involvement, when it occurs, appears **later in the event**, not at onset — it is evolution in
time, not the instantaneous outward decay of [[IK-003]].

**Scope.** Lateral sources — temporal, and by extension the lateral frontal chain. The entry does
**not** claim that a field stops at the midline, and does **not** extend to midline or
parasagittal sources.

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `focal-temporal-ictal`, onset side
left. In the first seconds of the event, T3 carries at least 2× the 3.5–6 Hz power of T4
(currently 217×). Later in the same event, T4's 3.5–6 Hz power is at least 2× its own onset value
(currently 186×). Setting the onset side to right mirrors both. The entry asserts the ordering —
ipsilateral first, contralateral later — not the ratios.

**Mechanism.** *(non-binding)* Candidate: distance decay alone. A temporal generator is far
enough from the opposite temporal chain that a smoothly falling field is already small there,
without any barrier being invoked.

The proposition that the field stops at the midline *because the brain is divided into two
hemispheres* is explicitly **not** asserted and is not what the simulator models: the forward
model's falloff is a function of inter-electrode distance only and contains no hemisphere term,
and clinically the midline is crossed routinely — bifrontal discharges arise from unilateral
generators by volume conduction, and parasagittal lesions project to the opposite hemisphere. The
correct reading of the observable is *"a lateral source is far from the other side"*, not
*"a source cannot cross the midline"*. Contralateral appearance in this engine is separately
timed propagation, not field spread.

**Check.** `validateEngine.ts` — `check('T3 / T4 theta, focal-temporal early (onset
lateralised)', …)` and `check('T4 theta late / early (contralateral spread appears)', …)`, plus
their right-onset mirrors.

**Status.** enforced (automated) · **Source.** user, 2026-08-14 — observation accepted; the
mechanism as originally stated is corrected above and not asserted.

### IK-017 — Absence returns instantly to baseline: no post-ictal slowing

**Claim.** A typical absence seizure **stops dead** at offset — the 3 Hz spike-wave discharge ends
abruptly and the background resumes at once, with **no post-ictal slowing** and no decrescendo.
That instant recovery is itself diagnostic: it separates absence from focal and generalised
tonic-clonic seizures, which **do** leave post-ictal attenuation/slowing ([[IK-019]]). Scope:
the offset transition — this entry asserts that nothing oscillatory outlives the discharge, not
the discharge's own morphology ([[IK-018]]).

**Observable.** Montage `reference-car`, state `awake`, toggle `absence-ictal`, at Fz-AVG.
Isolating the discharge's own contribution (same-seed run with the toggle off, subtracted) and
reading the 2.6 s window just past the first discharge's offset, the **oscillatory** 1–2.5 Hz band
power is essentially nil (currently 0.017 µV², bounded below 2). A prior port added a ~2 s fading
0.8–2.1 Hz delta burst after each discharge; that oscillatory tail would drive this band well above
the bound (it measured ≥3.6 µV² with the fade present) and is a clinical error — real absence has
no such tail. **Not** counted against this claim: the smooth *monotonic* baseline-recovery decay
left by the amplifier high-pass after the discharge's net-DC offset — that is a universal display-
chain artifact, not post-ictal slowing, and the Welch estimate rejects it as per-segment DC.

**Mechanism.** *(non-binding)* Conventionally, the thalamocortical 3 Hz oscillation of absence
terminates synchronously without the sustained cortical depression that follows a convulsive
seizure, so the record normalises immediately. Not asserted — the observable fixes only that no
oscillatory delta survives offset.

**Check.** `validateEngine.ts` — `check('absence has NO post-ictal oscillatory delta (instant
recovery, IK-017)', …)`, which bounds isolated 1–2.5 Hz band power in the post-offset window below
2 µV².

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — the fade was removed and this
check added this session, at the user's request. Clinical wording not yet independently confirmed
by the user.

### IK-018 — Typical absence is a ~3 Hz generalised, frontally-maximal spike-wave discharge

**Claim.** A typical absence discharge is **generalised** 3 Hz spike-and-slow-wave: bilateral and
synchronous, present across the head, but **frontally maximal**. The ~3 Hz rate (typically 2.5–3.5
Hz) is what separates typical absence from the ≤2.5 Hz *atypical* spike-wave of the epileptic
encephalopathies. Scope: the discharge itself (rate, generalised distribution, frontal maximum) —
its abrupt offset is [[IK-017]].

**Observable.** Montage `reference-car`, state `awake`, toggle `absence-ictal`. Over the discharge,
the Fz-AVG spike-wave peak frequency lands in 2.5–3.5 Hz (currently ~3). O1-AVG still carries real
2.5–3.5 Hz power — the field is generalised, reaching the occiput, not an isolated frontal focus —
while Fz-AVG carries more of it than O1-AVG (frontal predominance survives the common-average
reference). Only rate, the generalised reach, and the frontal-maximum ratio are asserted.

**Mechanism.** *(non-binding)* Conventionally a thalamocortical generalised oscillation with a
frontal-predominant scalp projection. Not asserted — the observable fixes rate and topography, not
the generator.

**Check.** `validateEngine.ts` — `check('absence Fz-AVG discharge peak frequency (typical: 2.5-3.5
Hz, not atypical)', …)`, `check('absence O1-AVG carries real 2.5-3.5 Hz power (generalised field
reaches occiput)', …)`, and `check('absence Fz-AVG / O1-AVG 2.5-3.5 Hz power (frontal-max survives
CAR)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

### IK-019 — A generalised tonic-clonic seizure evolves: recruiting → clonic slowing → post-ictal suppression

**Claim.** A GTC seizure is defined by its **evolution in time**, and that evolution is what the
display must show: (1) a **recruiting** low-voltage fast (beta-range) rhythm as the seizure
generalises; (2) a **clonic** phase of rhythmic spike-wave that **slows** as the jerks space out
(≈3 Hz down toward 1.5 Hz); and (3) **post-ictal suppression** — the background is *attenuated*,
not instantly normal (contrast absence, [[IK-017]]). A static rhythm at a fixed frequency is not a
GTC. Scope: the ordered frequency/amplitude evolution; absolute durations are not asserted.

**Observable.** Montage `reference-car`, state `awake`, toggle `gtc-ictal`, at Fz-AVG/Cz-AVG. The
isolated recruiting contribution peaks in the beta range (~17 Hz). The clonic phase's peak
frequency is higher early than late (organised slowing toward ~1.5 Hz), and its field reaches Cz
(generalised). After the clonic phase the display-space amplitude collapses relative to the clonic
phase — post-ictal suppression, visible as attenuation rather than silence. Only the ordering
(fast → slowing spike-wave → suppression) and the generalised reach are asserted.

**Mechanism.** *(non-binding)* Conventionally the recruiting rhythm is the electrographic
correlate of tonic stiffening, the slowing clonic spike-wave of the jerks spacing out, and the
suppression of post-ictal cortical depression. Not asserted — the observable fixes only the phase
sequence.

**Check.** `validateEngine.ts` — `check('GTC Fz-AVG recruiting contribution peak frequency (beta-
range, ~17 Hz)', …)`, `check('GTC Fz-AVG clonic peak frequency, early / late (organised slowing)',
…)`, `check('GTC Cz-AVG clonic / pre-ictal p2p (generalised field reaches Cz)', …)`, and
`check('GTC Fz-AVG post-ictal / clonic p2p (display-space suppression)', …)`, with their
supporting per-window peak-frequency and p2p checks.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user. The
generalised-reach clause was briefly `violated` on 2026-09-01 at 1.457 against a 1.5 floor, and
resolved the same day. Widening the source could not fix it — 0.7 → 0.95 gained 0.17 on the Cz
ratio and 0.95 → 1.10 a further 0.007, because Cz/Fz asymptotes as the field broadens — which was
the clue that the problem was the anchor, not the width: the source sat on Fz alone, and a
generalised seizure is by definition not a focal frontal event. Re-anchoring it across Fz **and**
Cz took the ratio to **3.782**, and is the more faithful geometry besides.

### IK-020 — A focal seizure evolves in frequency over its course; it is not a fixed rhythm

**Claim.** A focal (temporal or frontal) electrographic seizure **evolves in frequency** across
the event rather than holding a single rate — this evolution, not any one frequency, is what marks
it as ictal. A temporal-onset discharge's power shifts from a higher band at onset toward a lower
band later; a frontal-onset discharge begins as low-voltage **fast** and evolves **downward** in
frequency (the frontal-lobe-epilepsy hallmark). Scope: the fact of directional frequency evolution
on the involved chain; contralateral timing is [[IK-005]].

**Observable.** Montage `reference-car`, state `awake`. Toggle `focal-temporal-ictal`: at T3-AVG
the high/low band ratio (4.8–8 vs 2.5–4 Hz) sits high near onset (power near 6 Hz) and shifts low
later (toward 3.5 Hz), so onset/late band-ratio differs — an evolution, not a static rhythm.
Toggle `focal-frontal-ictal`: F3-AVG's peak frequency is high at onset (low-voltage fast, ~18 Hz)
and evolves down toward ~3 Hz late, so onset/late peak-frequency falls. Only the direction and the
fact of change are asserted, not the exact bands.

**Mechanism.** *(non-binding)* Conventionally a seizure recruits progressively larger, less
synchronous cortical territory, lowering the dominant rhythm as it evolves. Not asserted — the
observable fixes only that the frequency moves and in which direction.

**Check.** `validateEngine.ts` — `check('focal-temporal T3-AVG onset / late band-ratio (evolution,
not a static rhythm)', …)` with its onset and late band-ratio checks, and `check('focal-frontal
F3-AVG onset / late peak frequency (evolves DOWN, the FLE hallmark)', …)` with its onset and late
peak-frequency checks.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

## 8. Non-epileptiform abnormalities

Focal and generalized slowing, FIRDA, triphasic waves, PLEDs/GPEDs, burst-suppression,
electrocerebral inactivity, and what each implies clinically.

### IK-021 — Triphasic waves are anterior-predominant with an anterior→posterior time lag

**Claim.** Triphasic waves show a **three-phase** morphology (the tall middle phase surface-
positive, so it renders **down** on a negative-up display — see [[IK-008]]), each successive phase
slightly longer than the one before, that is **anterior-predominant** in amplitude and carries a
characteristic **anterior-to-posterior time lag**: the
frontal channels lead, and the posterior channels reproduce the same waveform a short time later.
That lag and the anterior amplitude maximum together distinguish triphasics from a synchronous
generalised discharge. Scope: the amplitude gradient and the AP lag; this entry does not assert a
discharge rate or an aetiology.

**Observable.** Montage `reference-ipsi` (A1 mastoid reference, avoiding common-average self-
subtraction), toggle `triphasic`. Fz-A1 **leads** Pz-A1 and O1-A1 by a small positive lag (~8–200
ms), and the lagged Fz-vs-posterior correlation is real and positive at that lag. Fz-A1's peak-to-
peak amplitude exceeds O1-A1's (anterior-predominant gradient preserved). Only the lead direction,
the lag being non-zero and bounded, and the anterior amplitude maximum are asserted.

**Mechanism.** *(non-binding)* Conventionally attributed to a fronto-central generator whose field
propagates postero-temporally, and clinically associated with metabolic/toxic encephalopathy — but
neither the generator nor the aetiology is asserted here. The observable fixes only the amplitude
gradient and the lag.

**Check.** `validateEngine.ts` — `check('triphasic Fz-A1 leads Pz-A1 (positive lag = posterior
follows anterior)', …)`, `check('triphasic Fz-A1 leads O1-A1 …', …)`, their two lagged-correlation
checks, and `check('triphasic Fz-A1 p2p > O1-A1 p2p (anterior-predominant amplitude gradient
preserved)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

### IK-022 — FIRDA is frontally-maximal, ~1.5–3 Hz, and rhythmic

**Claim.** Frontal intermittent rhythmic delta activity (FIRDA) is **frontally maximal**,
**rhythmic** (monomorphic, sinusoidal-ish) delta at roughly **1.5–3 Hz** — distinct from the
polymorphic, arrhythmic delta of focal structural slowing ([[IK-023]]). Its rhythmicity and
frontal maximum are the defining features. Scope: topography, band, and rhythmicity; amplitude and
intermittency rate are not asserted.

**Observable.** Montage `reference-car`, toggle `firda`. Fz-AVG peak-to-peak exceeds both O1-AVG
and T3-AVG (frontal-maximal). The Fz-AVG discharge frequency lands ~1.5–3 Hz with a tight spectral
peak (rhythmic, not broadband polymorphic), and its autocorrelation shows a strong secondary peak
at a lag within one ~1.5–3 Hz cycle (rhythmicity). Only topography, band, and rhythmicity are
asserted.

**Mechanism.** *(non-binding)* Conventionally a non-specific marker of deep midline/diencephalic
dysfunction or raised intracranial pressure in adults; not asserted. The observable fixes only
where the rhythm is maximal, its band, and that it is rhythmic.

**Check.** `validateEngine.ts` — `check('firda Fz-AVG p2p > O1-AVG p2p (frontal-maximal)', …)`,
`check('firda Fz-AVG p2p > T3-AVG p2p (frontal-maximal)', …)`, `check('firda Fz-AVG discharge
frequency (LEARNINGEEG: ~1.5-3 Hz)', …)`, `check('firda Fz-AVG spectral peak is tight (rhythmic,
not polymorphic)', …)`, and the two autocorrelation-rhythmicity checks.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

### IK-023 — Focal temporal slowing is lateralized delta/theta over one temporal chain

**Claim.** Focal (temporal) slowing is **lateralized**: delta/theta activity concentrated over one
temporal region, markedly larger there than over the homologous contralateral chain. The lateral
asymmetry is the finding — a focal structural or functional disturbance under the slow chain —
distinct from the symmetric, generalised slowing of [[IK-024]] and from the rhythmic frontal delta
of [[IK-022]]. Scope: lateralization and the delta/theta band; amplitude and aetiology are not
asserted.

**Observable.** Montage `bipolar-ap`, toggle `focal-delta-temporal`, left-temporal onset. T3-T5
peak-to-peak greatly exceeds the homologous T4-T6 (lateralized), and the T3-T5 discharge frequency
sits in the delta/theta range. Only the lateralization and the band are asserted.

**Mechanism.** *(non-binding)* Conventionally focal slowing overlies a regional cortical/white-
matter disturbance; not asserted. The observable fixes only the side and the band.

**Check.** `validateEngine.ts` — `check('focal-delta-temporal T3-T5 p2p >> T4-T6 p2p (lateralized,
LEARNINGEEG: unilateral)', …)` and `check('focal-delta-temporal T3-T5 discharge frequency is
delta/theta range', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

### IK-024 — Generalized slowing is diffuse, with no focal outlier

**Claim.** Generalized slowing is a change of the **whole background**, not a source at a point.
Theta and then delta build up across **every region**, the page stays **symmetric** between the
hemispheres, the **A–P gradient is lost**, and the **PDR slows**: to 6–7 Hz in mild slowing, to
fragments no faster than ~5 Hz in moderate, with delta, reduced reactivity and discontinuity
marking severe. Regional evenness is what separates it from focal slowing ([[IK-023]]), where one
region stands out. The `gen-slowing` toggle models the **moderate** grade: mostly theta with admixed
delta, and the PDR reduced to posterior theta fragments. Scope: the distribution, symmetry, lost
gradient and slowed PDR; absolute amplitude and the degree of encephalopathy are not asserted.

**Observable.** Montage `reference-ipsi`, state `awake`, toggle `gen-slowing`, averaged over 3
seeds. Across all nineteen channels, 1–8 Hz amplitude stays within **0.6–1.6×** of the median
channel: no region spared, no focal maximum. Every homologous pair (Fp1/Fp2 … O1/O2) agrees within
**50%**, the amplitude-asymmetry limit learningeeg calls abnormal. (O1+O2)/(Fp1+Fp2) p2p falls to
**≤ 2** (currently 1.21, against 5.26 without slowing). The O1/O2 spectral peak in 3–14 Hz sits at **3–7 Hz**. Not
`reference-car`: a common average subtracts whatever every electrode shares, and a diffuse field
is exactly that.

**Mechanism.** *(non-binding)* Conventionally a marker of diffuse cerebral dysfunction —
encephalopathy of many causes, or medication. In the simulator: independent polymorphic theta+delta
patches under all nineteen 10-20 sites, the normal PDR and mu gated down, and bursty ~5 Hz
posterior fragments standing in for the slowed PDR. Not asserted.

**Check.** `validateEngine.ts` — `check('gen-slowing quietest region / median, 1-8 Hz amplitude
(diffuse: no region spared)', …)`, `check('gen-slowing loudest region / median, 1-8 Hz amplitude
(diffuse: no focal maximum)', …)`, `check('gen-slowing O1/O2 1-8 Hz amplitude (symmetric: within
50%)', …)` and its seven homologous-pair counterparts (Fp1/Fp2 … P3/P4), `check('gen-slowing (O1+O2)/(Fp1+Fp2) p2p (A-P gradient lost;
~5 without slowing)', …)` and `check('gen-slowing O1/O2 spectral peak, 3-14 Hz (PDR slowed to
theta fragments)', …)`.

**Rewritten 2026-09-11 — the old entry was enforced and wrong.** It asserted that Fp1, O1 and T3
each carried delta+theta power "comparable to Cz (each regional ratio near unity)", but its checks
accepted 0.05–0.4 and passed at 0.126 / 0.132 / 0.103: **Cz carried about 8× the power of every
other region.** A check that divides by Cz cannot see a peak at Cz, and its spread test only asked
whether the *other* regions resembled each other. The generator behind it was a single radial
patch under Cz, whose isolated 1–8 Hz amplitude was **3.5× the median electrode** (2.1× along the
midline, 0.9–1.0 at the periphery). A blind read of an engine page mistook it for REM sawtooth
waves, because the midline rows dwarfed everything else (`scripts/read-lab/JOURNAL.md`). The claim
was rewritten from learningeeg's Non-Epileptiform chapter. After the rebuild, the isolated
amplitude is **0.91–1.20×** the median everywhere, with L/R pairs 0.93–1.07. The earlier report
that the old field "leaned left" is withdrawn: it came from `measureField`'s signed single-sample
peak, and the field's RMS was symmetric to within 1%.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24; rewritten 2026-09-11 at the
user's request ("fix it based on your own research only … if IK is wrong, fix it"), from
learningeeg.com's *Non-Epileptiform* chapter. Clinical wording not independently confirmed.

### IK-025 — GPEDs are periodic, roughly regular, and generalized

**Claim.** Generalized periodic epileptiform discharges (GPEDs / GPDs) recur at a **periodic,
roughly regular** interval (order ~1–2.5 s) — the low variability of the inter-discharge interval
is what makes them *periodic* rather than random — and are **generalized**, present bilaterally
rather than confined to one side (contrast the lateralized LPEDs, [[IK-026]]). Scope: periodicity
and generalized distribution; amplitude and aetiology are not asserted.

**Observable.** Montage `reference-car`, toggle `gpeds`. The Cz-AVG mean inter-discharge interval
is ~1–2.5 s with a low coefficient of variation (periodic, not random). Discharges are present at
O1-AVG as well (generalized), and the Cz-AVG/O1-AVG peak-to-peak ratio stays within a generalized
(not sharply focal) range. Only the periodicity and the generalized reach are asserted.

**Mechanism.** *(non-binding)* Conventionally associated with severe diffuse encephalopathy
(e.g. anoxic); not asserted. The observable fixes only the timing regularity and the distribution.

**Check.** `validateEngine.ts` — `check('gpeds Cz-AVG mean inter-discharge interval (LEARNINGEEG:
periodic, roughly 1-2.5 s)', …)`, `check('gpeds Cz-AVG interval coefficient of variation stays low
(periodic, not random)', …)`, `check('gpeds present at O1-AVG too (generalized, not focal)', …)`,
and `check('gpeds Cz-AVG / O1-AVG p2p ratio stays within a generalized (not sharply focal)
range', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

### IK-026 — LPEDs are periodic like GPEDs but lateralized to one side

**Claim.** Lateralized periodic epileptiform discharges (LPEDs / PLEDs / LPDs) share the
**periodic, roughly regular** timing of GPEDs ([[IK-025]]) but are **lateralized** — confined to,
or markedly larger over, one hemisphere. The lateralization is the distinguishing feature; the
periodicity is common to both. Scope: periodicity and lateralization; amplitude and aetiology are
not asserted.

**Observable.** Montage `bipolar-ap`, toggle `lpeds`, left onset. The T3-T5 mean inter-discharge
interval is ~0.8–2 s with a low coefficient of variation (periodic), and T3-T5 peak-to-peak
greatly exceeds the homologous T4-T6 (lateralized, unlike GPEDs). Only the periodicity and the
lateralization are asserted.

**Mechanism.** *(non-binding)* Conventionally associated with an acute or subacute focal
destructive lesion (e.g. herpes encephalitis, stroke) and often a marker of an irritable,
potentially ictal focus; not asserted. The observable fixes only the timing regularity and the
side.

**Check.** `validateEngine.ts` — `check('lpeds T3-T5 mean inter-discharge interval (LEARNINGEEG:
periodic, roughly 0.8-2 s)', …)`, `check('lpeds T3-T5 interval coefficient of variation stays low
(periodic, not random)', …)`, and `check('lpeds T3-T5 p2p >> T4-T6 p2p (lateralized, unlike
GPEDs)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

## 9. Amplitude, frequency, and calibration conventions

Normal amplitude ranges by rhythm and region, standard display settings (paper speed,
sensitivity, filters), and the calibration relationship between µV and screen millimetres.

### IK-014 — Sensorimotor beta is a low, even admixture, not spiky transients

**Claim.** In the awake background, sensorimotor beta is a low-amplitude, relatively even central
admixture. Beta is genuinely bursty, but no individual burst towers over the background enough to
read as a discrete sharp transient — a reader should not mistake a beta burst for muscle or an
epileptiform discharge.

Second, and separately from burst shape: beta is a **minority of the row it sits on**. A central
derivation in an awake eyes-closed record is not mostly beta, and beta does not out-amplitude the
posterior rhythm. This is the "low-amplitude" half of the word *admixture*, and it is asserted
because leaving it unasserted is what allowed beta to reach 17 µV and 70% of the 2–45 Hz power on
F3-C3 and F4-C4 while both of this entry's checks stayed green.

Scope: awake central beta, in relative terms. Absolute µV and discharge rate are still not
asserted — per-subject amplitude varies legitimately — only the bounded prominence of the tallest
burst and beta's bounded share of its own row.

**Observable.** Montage `bipolar-ap`, state `awake`, no toggles. On F3-C3/C3-P3/F4-C4/C4-P4 the
~20 Hz packets ride within the background envelope rather than projecting above it. Falsified by
beta bursts several times taller than the typical excursion.

Independently, in display space and averaged over ≥5 seeds: the 13–30 Hz share of the 2–45 Hz
power on F3-C3 and F4-C4 sits between 0.30 and 0.60 (currently 0.512), and **exceeds by no more
than 0.25 the same share on rows carrying no beta source** — T3-T5 and P3-O1 (currently 0.332).

The excess form is the load-bearing one, and the floor is part of the observable rather than an
implementation detail: the aperiodic background carries its own 13–30 Hz content worth ~33–36% of
any row, so no setting of the beta generators drives the raw share toward zero. What can be
asserted is what beta *adds* over a row that has none. Equally, beta/alpha on a central row stays
above 1 however far beta is reduced, because those rows carry little alpha by design — so
beta/alpha is **not** a usable test here, and the share is.

**Check.** `validateEngine.ts` — `check('beta burst crest factor (peak/RMS; tamed amplitude
tail)', …)`, which bounds the seed-averaged crest factor below 9, for the burst-shape clause; and
`check('beta share of a central row (F3-C3, F4-C4) in display space', …)` with
`check('central beta share MINUS a row with no beta source (the excess beta adds)', …)` for the
admixture clause. The crest check measures the generator in isolation and the two share checks
measure the rendered row, which is why both are needed: the crest factor read 7.937 against its 9
ceiling throughout the period when beta was 70% of the row.

**Status.** enforced (automated) · **Source.** user, 2026-08-19 — admixture clause added
2026-09-02 after a user reported the default record looking "really bad", with the central and
midline rows reading as serrated against clean temporal ones. Measured across ten seeds, beta was
17 µV and 67–70% of F3-C3/F4-C4 against 33–36% on rows with no beta source, and louder than alpha
there (beta/alpha 1.7–1.8). Corrected by taking `betaRms` from 2.5–6.0 to 1.25–3.0 µV (≈7–18 µV
peak-to-peak, the textbook awake range) and widening `betaL`/`betaR` to 1.6×, which is also one of
only two sources never re-derived after the forward model's falloff was replaced.

**Rescaled 2026-09-22.** `betaRms` taken to 0.875–2.1 µV (0.7×, ≈5–12 µV p-p) when the aperiodic
floor was halved (`backgroundRms` 6–14 → 3–7 µV). Beta is an absolute amplitude, so the quieter floor
raised its share of the central rows to this entry's ceiling (excess 0.248 against 0.25). At 0.7× the
excess reads 0.180. learningeeg's clean eyes-closed pages put F3-C3's 0.5–30 Hz beta share at 0.03–0.09
against the engine's ~0.23, so this moves toward the reference and does not reach it. The share floor
of 0.30 was derived from the old floor's own 13–30 Hz content and is now worth re-deriving.

### IK-027 — The display calibration is internally consistent and marked, not literal

**Claim.** The trace is drawn to an **internally consistent** calibration, and the reader scales
from the calibration bar rather than from the grid. Three things hold. Horizontal time obeys the
paper speed: a fixed 4 px per claimed millimetre, so 30 mm/s is 120 px/s at any window size.
Vertical deflection is proportional to voltage at the stated µV/mm **in the display's own
millimetre**. And the sign obeys **negative-up** ([[IK-008]]) — a channel whose input 1 is more
positive than input 2 (`computeChannelVoltage` = input1 − input2 > 0) deflects **down** (canvas y
increases), a more-negative input 1 deflects **up**.

**The vertical millimetre is not a physical millimetre, and this entry previously claimed it was.**
It is `canvasHeight / totalRowUnits / 10`, so it changes with window size while the horizontal
millimetre is fixed. Measured at the 96 dpi CSS reference, the label "7 µV/mm" covers a real
sensitivity from about **4.5 to 10.9 µV per millimetre** across a plausible range of canvas
heights, and the grid squares are square at exactly one height. ACNS Guideline 1 §3.4 anticipates
precisely this — "because the dimensions of computer monitors will vary, clear scale markers must
be available as part of the display" — and the app implements that mitigation: the 100 µV
calibration bar scales correctly with the display and is what the reader must judge amplitude
from. So the display is not uninterpretable; it is self-consistent and marked. The word *literal*,
which this entry asserted from 2026-08-24 until 2026-09-01, was false.

Scope: the calibration relationships and the sign convention, which every other display-space claim
depends on. Absolute physical size is explicitly **not** asserted.

**Observable.** The rendered trace (`renderTrace`, the same geometry `EEGCanvas` draws). At 30 mm/s
the width difference between an 11 s and a 1 s span is 10 s × 120 px/s. At 7 µV/mm a 50 µV
calibration input produces the expected millimetre deflection. `computeChannelVoltage(Fp1=+50,
F3=0)` is surface-positive and deflects **down** (rendered y − centerY > 0); `computeChannelVoltage
(Fp1=−50, F3=0)` is surface-negative and deflects **up** (y − centerY < 0). Only the calibration
proportions and the sign convention are asserted.

**Mechanism.** *(non-binding)* These are display conventions, not physiological facts — inherited
from paper-and-pen electroencephalography. Nothing about the underlying signal changes if any of
them is altered, which is exactly why they are pinned: a global sign flip or a mis-scaled axis
passes every power/correlation assertion in the battery (compare [[IK-008]]'s note).

**Check.** `validateEngine.ts` — the same labels as before, but the two polarity assertions,
`check('surface-positive (+50 µV) deflects DOWN (y - centerY > 0)', …)` and its surface-negative
counterpart, now call the **production** `traceY()` from `utils/displayGeometry.ts` rather than
recomputing `v * pxPerUV` locally. That distinction is the entry's whole enforcement value. Until
2026-09-01 all six checks were tautologies — `pxPerUV * sensitivity == pxPerMm` reduces to
`(pxPerMm/s · s)/pxPerMm ≡ 1`, and the polarity pair multiplied a voltage by a positive number and
asserted the product was positive — so **not one of them could fail**, and none touched
`EEGCanvas` at all. A global sign flip in the renderer, exactly the regression the Mechanism
paragraph below says this entry exists to catch, would have passed all six. Both renderers now draw
through one shared `traceY()`, and the fix was mutation-tested: flipping its sign turns the gate
red on these checks (and on `check('ECG R wave (+1 mV) renders UP …', …)`), where previously it
turned nothing red.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording invariants the validation
battery guards. Claim corrected 2026-09-01 after an adversarial audit found the entry overclaimed
(*literal*), its checks were circular with it and unfalsifiable, and the code had a real
window-dependence the entry denied. Clinical wording not independently confirmed.

### IK-028 — Adult scalp amplitudes are ~10–100 µV, and amplitude falls along the AP gradient

**Claim.** In a normal awake adult record, scalp EEG amplitudes sit in roughly the **10–100 µV**
range, and amplitude follows the **antero-posterior gradient**: the posterior background is
**higher-amplitude** than the frontopolar region (mirroring the posterior-dominant-rhythm topography
of [[IK-006]] and the frequency/amplitude gradient of the plan's AP-gradient claim). An occipital
channel that renders larger than the frontopolar channel in the eyes-closed awake state is the
normal picture; the reverse would be abnormal. Scope: the amplitude band and the posterior >
frontopolar ordering; exact per-region microvolt values are not asserted.

**Observable.** Montage `reference-car`, state `awake`, eyes closed, no toggles. O1-AVG peak-to-
peak amplitude lands within the adult scalp range (~10–100 µV), and O1-AVG peak-to-peak exceeds
Fp1-AVG peak-to-peak (posterior > frontopolar, the AP amplitude gradient). Only the amplitude band
and the ordering are asserted.

**Mechanism.** *(non-binding)* Conventionally the posterior maximum reflects the alpha generator's
occipital projection; the overall amplitude band is a scalp-recording convention. Not asserted —
the observable fixes only the range and the gradient direction.

**Check.** `validateEngine.ts` — `check('O1-AVG p2p amplitude, awake eyes-closed (LEARNINGEEG §1:
adult scalp 10-100 µV)', …)` and `check('O1-AVG p2p > Fp1-AVG p2p (AP gradient in amplitude space,
LEARNINGEEG §3)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

### IK-029 — Amplitude rises front-to-back along the antero-posterior gradient

**Claim.** In a normal awake adult, background amplitude increases monotonically from frontopolar
to occipital along each parasagittal chain and along the midline, with occipital roughly **2–5×**
frontopolar. This is a claim about the **background**, distinct from the posterior alpha rhythm
that rides on it ([[IK-006]]); it is the amplitude half of the gradient whose coarse form
[[IK-028]] states, restated link by link rather than only at the two ends of the chain.

**Observable.** Montage `reference-ipsi`, state `awake`, eyes closed, no toggles, peak-to-peak per
channel averaged over ≥3 seeds. Amplitude rises Fp1 < F3 < C3 < O1 and Fp2 < F4 < C4 < O2; O1 > P3
and O2 > P4; the midline runs Fz < Cz < Pz. (P3+P4)/(F3+F4) ≥ 1.15 and (P3+P4)/(Fp1+Fp2) ≥ 1.5, so
parietal is not the floor of the head. (O1+O2)/(Fp1+Fp2) ≥ 1.8, gradient present. The **magnitude**
is asserted on the bipolar chain, where a real figure anchors it: (P3-O1+P4-O2)/(Fp1-F3+Fp2-F4)
p2p in 2–6, against **3.75** on learningeeg's `ap-gradient` figure traced with the same estimator
(the engine reads ~4.1). The 10–100 µV envelope applies to channels that do not sit beside their
own ear reference. F7/T3/T5 and F8/T4/T6 read a short-distance difference, and F7-A1 is the page's
quietest row (9.9 µV) for that reason alone. Averaging over seeds is
part of the observable, not a convenience: normal hemispheric asymmetry runs to 50%, and a single
seed's asymmetry must not be what decides an ordering. **(P3+P4)/(C3+C4) ≥ 1.0**, parietal at or
above central. The margin legitimately narrows in subjects who carry mu ([[IK-033]]), since a
central rhythm raises the central rows. Over 8 subjects (2026-09-11) it read 1.05–1.10 in the
three with mu and 1.26–1.62 in the five without.

**Mechanism.** *(non-binding)* In the simulator this is carried by a mean-preserving antero-
posterior tilt of the aperiodic background (`engine.ts`, `AP_AMPLITUDE_TILT`), not by the alpha
sources: a spatially flat 1/f floor leaves nothing for the gradient to act on, because that floor
carries most of the variance. Not asserted — the observable fixes only the orderings.

**Montage caveat.** Deliberately **not** `reference-car`, unlike [[IK-028]]. With only 19
electrodes the common average is a poor stand-in for infinity: it subtracts a posteriorly-weighted
mean from every channel and nearly nulls Cz, which sits close to the array's electrical centroid.
On the same signal and seeds it therefore measures this gradient *backwards* — Fp1 above F3, and
Fz > Cz > Pz — and reads front-to-back as 2.49 where the ear reference reads 4.41. A polarity or
topography claim is only meaningful with its montage named (`CLAUDE.md` §4), and for amplitude
topography the ear reference is the one a reader judges on.

**Check.** `validateEngine.ts` — the amplitude assertions labelled `LEARNINGEEG §3` in the
`reference-ipsi` AP-gradient block, including `check('(P3+P4) / (C3+C4) p2p (parietal at or above
central, LEARNINGEEG §3)', …)` (added 2026-09-11) and `check('(P3-O1+P4-O2) / (Fp1-F3+Fp2-F4) p2p
(front-to-back magnitude, bipolar; learningeeg figure 3.75)', …)`, plus `check('quietest channel p2p,
…')` and `check('loudest channel p2p, …')` for the 10–100 µV envelope across the thirteen channels
not adjacent to their reference.

**Resolved 2026-08-28 — the parietal exception is gone.** This entry previously carried a known
exception: (P3+P4)/(C3+C4) measured **0.949**, central outranking parietal, attributed to
`STATE_GAINS.awake.mu = 1.00` giving every subject an always-on mu worth ~5.5 µV RMS at C3. It now
measures **1.183** and the whole ordering holds.

The recorded diagnosis was only half right, and the wrong half mattered. Mu was a contributor, and
that has been fixed as this entry anticipated — mu is now a per-subject benign variant ([[IK-033]])
rather than a universal background component, which is exactly what the old note said real mu is.
But the **dominant** cause was the posterior field itself: the PDR source carried a -0.4 inferior
offset that left P3 at 20% of O1 while posterior-temporal T5 sat at 69%, so parietal was starved at
the source rather than merely out-shouted by mu. Correcting that geometry is what moved the ratio.
[[IK-006]] now asserts the parietal / posterior-temporal balance directly so the same defect cannot
recur unnoticed.

Until 2026-09-11 the Observable above still read "Parietal > central is **not** claimed — see the
known exception", pointing at an exception this section had already retired, and the gate never
gained the check. Both now say what is true.

**Corrected 2026-09-11 — two bounds carried a precision the source does not have.** A warm-up fix
(artifact gates off during `SimulationSource`'s warm-up) removed a start-up transient that had been
inflating every frontal row. With the frontal rows honest, two checks went red:
- **Front-to-back ≤ 5** on the ear-referenced ratio (read 5.26). That ceiling came from an eyeball
  read of learningeeg's *bipolar* figure, applied to an *ear-referenced* ratio. Measured properly
  on the bipolar chain, the real figure reads 3.75 and the engine 3.06 ± 0.39, so the engine's
  gradient is, if anything, slightly shallower than the reference. The ear-referenced ratio keeps
  a floor, and the magnitude moved to the bipolar check.
- **Quietest channel ≥ 10 µV** (read 9.92, F7-A1). A channel beside its own reference measures
  proximity, not scalp amplitude, so the envelope now excludes those six channels.
Neither change relaxes the claim. Both remove a number that was never the source's.

**Status.** enforced (automated) · **Source.** user, 2026-08-25 — proposed by the assistant from
learningeeg.com's *Normal Awake* chapter ("slower, higher amplitude frequencies … in the back") and
approved by the user. Clinical wording not independently confirmed.

### IK-030 — Frequency content is faster anteriorly than posteriorly

**Claim.** In a normal awake adult the background is **faster at the front and slower at the back**
— the frequency half of the antero-posterior gradient, and the half that neither [[IK-028]] nor
[[IK-029]] covers. learningeeg's own reference figure labels the two ends: **low-amplitude beta**
over the frontal rows, **moderate-amplitude alpha** over the posterior ones. Scope: the relative
balance of fast to alpha-band activity, front against back.

**Observable.** Montage `bipolar-ap`, state `awake`, eyes closed, no toggles, 3 seeds. The ratio of
beta (13–30 Hz) to alpha (8–13 Hz) power on Fp1-F3 and Fp2-F4, divided by the same ratio on P3-O1
and P4-O2, is **≥ 2**. Read with the same image reader on real records it gave **7.5** on
learningeeg's `ap-gradient` figure and **25.3** on its `term-alpha` figure. On 12 engine pages it
gave 7.8 ± 1.7.

**Mechanism.** *(non-binding)* Frontal beta is weighted frontally (`engine.ts`, `BETA_FRONTAL_GAIN`),
and the PDR is posterior ([[IK-006]]). Not asserted.

**Check.** `validateEngine.ts` — `check('beta/alpha, Fp1-F3+Fp2-F4 vs P3-O1+P4-O2 (AP gradient in
FREQUENCY: faster in front, LEARNINGEEG §3)', …)`. It responds to what it claims: 3× beta raised it
1.5–2.5×, and posterior alpha at 0.3× lowered it 30–40%.

**Rewritten 2026-09-11 — the claim's mechanism and its metric were both wrong.** The original Claim
added that the gradient "is a spectral-slope difference and not merely an alpha effect". The
source never says that. It attributes the gradient to frontal beta and posterior alpha, and the
engine's own measurements (below) showed the aperiodic slope cannot carry it anyway. The original
Observable, a 2–30 Hz spectral centroid ≥ 1.1 on Fp vs O, measured the wrong thing. Read on real
records with one image reader, it gave **1.16** on `ap-gradient` but **0.79** on `term-alpha`, a
normal record with obvious frontal fast activity whose frontal rows also carry blinks. A centroid
is pulled down by any low-frequency power, ocular or 1/f, so its floor would have failed a real
normal record. The engine read 0.93–0.97 on it. That was the metric, not the engine: on beta/alpha
the engine sits inside the real range. The history below is the centroid's, kept because every
attempt to satisfy it is a recorded negative result.

**History of the retired centroid check.**

It read 1.010 until 2026-09-02, when pre-existing bad electrodes were gated behind a toggle
and stopped running by default. That they moved this figure at all is worth recording: a
noisy electrode adds broadband high-frequency noise, so 84% of subjects were carrying
electrode noise that inflated the frontopolar centroid. Part of what this check was reading
as "faster anteriorly" was bad contact, not brain.

It read 1.066 against the 1.1 floor for part of 2026-09-01. The bound was never relaxed — the bound
*is* the claim — and two candidate fixes were ruled out by measurement before the third worked.

*The aperiodic exponent tilt cannot supply it.* Raising `AP_EXPONENT_TILT` from 0.20 to 0.35 **and**
its clamp from 1.85 to 2.0 moved the ratio by −0.006. The forward model's algebraic tail makes every
electrode average all sixteen background patches, so per-patch exponent differences wash out however
large they are made. Both edits were reverted rather than left in place.

*Frontal beta cannot buy it either.* Beta is genuinely frontally predominant in the awake adult, and
weighting it so does raise the frontopolar centroid — but amplifying beta at Fz raises Fz's
peak-to-peak along with it, and [[IK-029]] requires Fz < Cz. Measured across three seeds:
gain 1.00 → centroid 1.066, Cz/Fz 1.114; gain 1.20 → 1.095, 0.978; gain 1.35 → 1.117, 0.886. Cz/Fz
falls below 1.0 before the centroid reaches 1.1, so **no value satisfies both**. The seam is kept,
inert at 1.0, with the numbers recorded in `engine.ts`.

*A third attempt passed every check and was reverted anyway.* The two failures
above share a cause: both tried to buy the gradient with amplitude at Fz, which IK-029 has already
spent. But the centroid is measured at **Fp1/Fp2**, not Fz — a different electrode with a different
and looser constraint (Fp1 < F3). Re-anchoring the frontal beta source to reach the frontopolar
electrodes, weighted `Fz, Fz, Fz, F3, F4, Fp1, Fp2`, puts fast content where the measurement is and
leaves Fz's amplitude untouched. Sweeping that weighting:

| anchor | centroid | F3/Fp1 |
|---|---|---|
| `Fz, F3, F4, Fp1, Fp2` | 1.383 | 0.959 — Fp1 too loud |
| `Fz, Fz, F3, F4, Fp1, Fp2` | 1.278 | 1.015 — 1.5% margin |
| `Fz, Fz, Fz, F3, F4, Fp1, Fp2` | **1.204** | **1.031** — taken |

with every other bound satisfied and the gate fully green. It was still wrong. Concentrating beta
into a frontal-midline focus made its bursts stand proud of the background as discrete
high-amplitude packets on Fz-Cz and Cz-Pz — precisely what [[IK-014]] forbids — and a reader opening
the default record saw it immediately. The beta crest-factor check reads one seed-averaged number
(7.94 against a 9 ceiling) and did not catch it. Reverted; see engine.ts's betaF comment.

The lesson belongs to this entry, not just the code: this check can be satisfied by changes that
make the display worse, so a green figure here is necessary and not sufficient.

This entry previously listed **distinct anterior and posterior aperiodic generators** as still open.
Under the corrected claim this entry no longer needs them: the source attributes the gradient to
beta and alpha, not to the aperiodic slope.

**Status.** enforced (automated) · **Source.** user, 2026-08-25; claim and observable rewritten
2026-09-11 at the user's request ("fix them if wrong") — proposed by the assistant from
learningeeg.com's *Normal Awake* chapter ("faster, lower amplitude frequencies … towards the
front") and approved by the user. Clinical wording not independently confirmed. Spent part of
2026-09-01 as `violated`, correctly: the entry had read `enforced (automated)` while its own check
was red, which is the state that status exists to describe. Resolved the same day.

### IK-031 — The awake PDR waxes and wanes without towering into a transient

**Claim.** In the awake posterior background, the posterior-dominant rhythm waxes and wanes
continuously — that spindling morphology is normal and expected. But no individual waxing packet
towers over the running background enough to read as a discrete sharp transient: a reader should
not mistake the crest of a waxing alpha run for an epileptiform discharge. Scope: awake posterior
alpha; the absolute amplitude band is not asserted here (that is [[IK-028]]'s ~10–100 µV ceiling
and [[IK-029]]'s front-to-back gradient), only the bounded prominence of the tallest burst relative
to the background. The alpha counterpart of [[IK-014]].

**Observable.** Montage `reference-car`, state `awake`, eyes closed, no toggles. On O1-AVG/O2-AVG
the ~10 Hz packets wax and wane within the background envelope; the tallest burst stays within a
bounded multiple of the channel's own RMS rather than projecting far above it, and stays under the
~100 µV p2p posterior ceiling of [[IK-028]]. Falsified by an alpha burst several times taller than
the typical excursion, or one whose peak-to-peak breaks the [[IK-028]] ceiling.

**Mechanism.** *(non-binding)* The generator is a noise-driven damped oscillator whose waxing/waning
comes from a log-normal envelope multiplier (`engine.ts`, `PDR_ENVELOPE_DEPTH`); the width of that
multiplier's tail sets how far the tallest burst overshoots the mean. Narrowing it lowers the crest
without changing mean alpha power (the oscillator recalibrates its RMS). Not asserted — the
observable fixes only the bounded prominence, not the mechanism.

**Check.** `validateEngine.ts` — `check('PDR alpha crest factor (peak/RMS; tamed waxing tail)', …)`,
which bounds the seed-averaged crest factor of the production PDR oscillator below 5.4. The absolute
amplitude ceiling is guarded separately by [[IK-028]]'s O1-AVG p2p check.

**Status.** enforced (automated) · **Source.** user, 2026-08-25 — proposed by the assistant and
approved by the user. Clinical wording not independently confirmed.

## 10. Age and state modifiers

How the above shifts with age (neonatal through elderly) and with medication, anaesthesia,
hyperventilation, and photic stimulation.

### IK-009 — Photic driving is occipital, flash-locked, frequency-tuned, and symmetric

**Claim.** During intermittent photic stimulation a normal subject shows a **photic driving
response**: rhythmic activity over the occipital electrodes, time-locked to the strobe, at the
flash rate (and its harmonics). It is best elicited when the flash rate is **near the subject's
own alpha**, roughly **8–20 Hz**, and is minimal at very low rates (1–2 Hz) and above ~30 Hz. It
must be **symmetric** — a persistently one-sided driving response is the abnormality, not the
driving itself. The response is **intermittent**, present only while the lamp flashes. The
*absence* of driving is not by itself abnormal.

**Observable.** State `awake`, toggle `photic`, occipital channels `O1`/`O2`. The series steps
through flash rates in 6 s trains separated by 3 s rests (clinically the trains are ~10 s with
≥7 s between; the simulator compresses them so the whole sweep fits in ~2 minutes). During the
14 Hz train, 13–15 Hz power at O1 rises far above the same window with the lamp off, and above
Cz in the same window; O1 and O2 stay within a small factor of each other. During the 18 Hz
train the peak moves to 17–19 Hz — it follows the lamp, not a fixed band. In the rest gap after
a train, and during the 2 Hz train, O1 is no different from baseline. Direction and absolute
amplitude are not asserted.

**Mechanism.** *(non-binding)* Driving is conventionally read as entrainment of occipital
cortex by the visual input; the frequency tuning near alpha and the occipital maximum follow
from the visual system's own resonances. Nothing here is asserted — the observable establishes
only *where*, *when*, and *at what rate* the rhythm appears.

**Check.** `validateEngine.ts`, "Photic driving" block — the six checks:
`O1 13-15 Hz during 14 Hz train, on / off` (45.2), `O1 / Cz 13-15 Hz during 14 Hz train
(occipital)` (50.6), `O1 / O2 driving power (symmetry)` (1.00), `O1 17-19 / 13-15 Hz during
18 Hz train (tracks flash rate)` (59.0), `O1 13-15 Hz in the rest gap, on / off` (1.00), and
`O1 1.5-2.5 Hz during 2 Hz train, on / off` (1.24).

**Status.** enforced (automated) · **Source.** Claude, 2026-08-17 — drafted by the assistant at
the user's request, recording behaviour the validation battery already guards; the check figures
above were measured this session. Clinical wording not yet independently confirmed by the user.

### IK-010 — The hyperventilation build-up grows, is frontal in adults, and resolves

**Claim.** Hyperventilation produces a **build-up**: generalised rhythmic slowing that *grows*
through the procedure rather than switching on at fixed size, begins as theta and *deepens into
delta* as it develops, is **frontally predominant in adults**, and **resolves** within about a
minute of stopping. The posterior alpha rhythm is **attenuated, not abolished** — loss of the
PDR is a different finding. A build-up is a **normal** response, more marked in children and
young adults, so its presence is not by itself abnormal; persistence well beyond ~1 minute after
stopping is.

**Observable.** State `awake`, toggle `hyperventilation` (~3 min of overbreathing, then
recovery). Measured on Fz, 2–7 Hz slowing in the last minute of the procedure far exceeds the
first minute; a minute after stopping it is back to baseline. At full build-up Fz carries more
2–7 Hz slowing than O1 (frontal predominance). The delta-to-theta balance shifts through the
procedure — theta leads, delta follows — measured on the source's own contribution
(on − off, same seed), since a 1/f background already carries more delta than theta and swamps
the effect otherwise. O1 alpha is reduced but well clear of zero at full build-up. Absolute
amplitudes are not asserted; frontal predominance is scoped to adults.

**Mechanism.** *(non-binding)* Conventionally attributed to hypocapnic cerebral
vasoconstriction from blowing off CO₂; the greater response in the young and the frontal maximum
are the usual clinical correlates. Not asserted — the observable establishes only the time
course, the topography, and the theta-then-delta ordering.

**Check.** `validateEngine.ts`, "Hyperventilation build-up" block — the five checks:
`Fz 2-7 Hz late / early in the procedure (build-up)` (26.5), `Fz 2-7 Hz after recovery, on / off`
(1.00), `Fz / O1 2-7 Hz at full build-up (frontal)` (17.4), `Fz delta/theta contribution, full /
mid build-up (theta first, then delta)` (3.14), and `O1 alpha power at full build-up, on / off`
(0.45).

**Status.** enforced (automated) · **Source.** Claude, 2026-08-17 — drafted by the assistant at
the user's request, recording behaviour the validation battery already guards; the check figures
above were measured this session. Clinical wording not yet independently confirmed by the user.

## 11. Conflicts and open questions

Facts that contradict the engine's behaviour, contradict each other, or are unresolved.
Parked here deliberately rather than silently resolved — a conflict recorded is safer than a
conflict guessed.

### Resolved 2026-08-19 — the `eyes-open` toggle gated mu as well as alpha (contradicted [[IK-007]])

`eyesOpen` in `variants.ts` returned `bandGate: () => ({ alpha: 0.35, mu: 0.35 })`; the `mu` term
attenuated the central rhythm on eye opening, erasing the differential reactivity that separates
mu from posterior alpha. The clinical question was settled in favour of [[IK-007]] (mu does not
react to eye opening) and resolved by deleting the `mu` term, so eye opening now attenuates only
alpha. [[IK-007]] is now enforced by a check — mu-band power at C3/C4 is unchanged across the
eyes-open transition while posterior alpha collapses — and has moved off `proposed`.

### Open 2026-08-25 — wicket band: [[IK-015]] asserts 6–11 Hz, learningeeg.com says 7–11 Hz

[[IK-015]] claims wicket spikes span roughly **6–11 Hz** ("not confined to the alpha range"), and
that claim is *enforced*: `check('T3 6-7.5 Hz power, wicket on / off (drowsy; widened range)', …)`
asserts a power rise in the 6–7.5 Hz sub-band, and the engine is tuned to produce it. learningeeg.com
(normal-variants chapter) instead calls wickets an "alpha range (usually **7–11 Hz**)" rhythm — its
lower bound is 7 Hz, and it does not describe sub-alpha wicket power.

Both are defensible: some references extend wickets down to ~6 Hz (the mu-like arciform fragment
they resemble runs 7–11 Hz per the same chapter), so 6–11 Hz is a wider-but-not-wrong reading, while
7–11 Hz is what learningeeg teaches. This is **parked, not resolved** — settling it toward 7–11 Hz
would mean changing the entry, retiring/adjusting the 6–7.5 Hz check, and re-tuning the engine's
wicket band, so it is a clinical decision to make deliberately rather than silently. Until then
[[IK-015]] stands as written and stays enforced at 6–11 Hz.

### Open 2026-08-25 — FIRDA frequency and terminology: [[IK-022]]'s "~1.5–3 Hz" is not a learningeeg figure

[[IK-022]]'s check `check('firda Fz-AVG discharge frequency (LEARNINGEEG: ~1.5-3 Hz)', …)` credits
learningeeg.com for the ~1.5–3 Hz band, but learningeeg's nonepileptiform/rhythmicity chapters give
**no precise FIRDA frequency** — they state only delta (≤4 Hz), and they treat "FIRDA" as *older
terminology*, now "**GRDA with frontal predominance**." The ~1.5–3 Hz figure is clinically standard
(FIRDA is conventionally ~2–3 Hz) but is not sourced from learningeeg, so the label's `LEARNINGEEG:`
attribution overstates the source.

The *clinical claim* of [[IK-022]] (frontally-maximal, rhythmic delta) is confirmed by learningeeg
and is not in question; only the attribution of the specific number, and whether to record the modern
GRDA nomenclature as a synonym, are open. **Parked, not resolved** — fixing it would re-word the
enforced check's label (and optionally the entry's title/claim to note the GRDA synonym), which is an
edit to make deliberately. Until then [[IK-022]] stands as written and stays enforced.

### Retracted 2026-08-28 — [[IK-006]] asserted a bipolar derivation the source does not name

[[IK-006]] read, from 2026-08-14 until today, that the awake alpha background "is read off the
posterior links of an antero-posterior chain — P3-O1 / P4-O2 and T5-O1 / T6-O2". That clause is
**withdrawn**. Two independent reasons, either sufficient:

1. **Not in the source.** learningeeg.com's *Normal Awake* chapter says only that the PDR is "the
   resting frequency of the occipital region when eyes are closed", and that "slower, higher
   amplitude frequencies are found in the back". Its *Montages* chapter names no derivation for
   the PDR. The clause was an assistant-authored specific that was never in the cited material.
2. **Self-defeating arithmetic.** A bipolar link measures the field's *gradient*, not its height.
   With a realistic referential topography (O 100%, P 75%, C 40%) the parietal link carries
   C-P = 35 against the posterior link's P-O = 25 — so the clause asserts the opposite of what a
   correct topography produces.

It was enforced by `check('P4-O2 / C4-P4 alpha power (PDR on the posterior link, not
central-parietal)', …)`, floor 1.2, and satisfying that bound required holding parietal
artificially low. The engine duly did so: a `-0.4` inferior offset on the PDR source (3.8 cm below
O1, off the cortex) left P3 at **20%** of O1 while posterior-temporal T5 sat at **69%**. The
visible consequence was a parasagittal chain carrying no discernible rhythm until its final link,
against a temporal chain that showed it on two — reported by the user across several sessions
before the cause was found. A code comment recorded that widening the field had been "tried and
reverted" because it broke the check, which kept the wrong geometry in place.

Resolved by: retracting the clause; retiring that check; correcting the PDR source to
`extent: S.smearing * 1.5, offset: [0, -0.1, 0]`; and asserting the *referential* topography
directly instead (`P3 / T5` and `P4 / T6` alpha power in 0.5–3), which is the claim the source
actually supports and the one that fails loudly if parietal is starved again.

### Resolved 2026-08-28 — the Gaussian falloff was replaced with an algebraic one

`forward.ts` modelled every source's scalp field as `exp(-d²/2σ²)`. A Gaussian has no algebraic
tail, and at the distances of a real 10-20 array that is not a small error: at the PDR's width
(σ ≈ 4.1 cm) the gain 19 cm away at Fp1 was `exp(-19²/(2·4.1²))` ≈ **2 × 10⁻⁵**. The posterior
rhythm did not reach the front weakly — it did not reach it at all, and every distant field in the
model was carried by whatever source happened to be anchored nearby.

Replaced by `(1 + (r/σ)²)^(-3/2)`: the same peak and near-field width, with a power-law tail going
as `(σ/r)³` — the decay of a dipole's lateral field. The same 19 cm now gives **5.2 × 10⁻²**.

**Measured effect.** `check('posterior / anterior alpha power', …)` went **520 → 68**, and the
check's ceiling came down from the placeholder 600 to **150**. `P3 / T5` alpha reads 0.82 and
`P4 / T6` 0.86, and the two posterior links of the parasagittal chain now carry the rhythm
equally (`C4-P4` vs `P4-O2` = 1.001) instead of the chain showing nothing until its last link.

**A correction to this note's earlier wording.** It previously said real records put frontal alpha
at 15–20% of occipital, "a power ratio near 33", and called the model 16× too steep. That
comparison was not sound: the check measures **raw electrode potentials**, whereas the clinical
figure describes **referenced** recordings, where the reference itself injects a copy of the
occipital signal into every channel. The two are not the same quantity, and no target for the raw
ratio was ever established. The Gaussian's 2 × 10⁻⁵ was indefensible on its own terms — it is not
a physical falloff at any distance — so the change stands, but it should not be read as having
hit a clinical number, and the ceiling of 150 remains a regression guard rather than a claim.

**Two alternatives were tried and rejected**, both recorded in `forward.ts` so they are not
retried. (1) The exact infinite-medium point dipole, `V ∝ (p·d)/|d|³`. It is the more faithful
formula for an unbounded medium and it unifies the radial and tangential cases, but an unbounded
medium gives it a negative return lobe comparable to its own peak spread across the whole head,
which a bounded head does not have. It failed 50 checks — blinks and K-complexes rendered with
inverted polarity, because the far lobe became the column's maximum, and diffuse generators
cancelled against their own return field (GPEDs at O1 fell to 2.5 µV against a 15 µV floor).
(2) A single global conversion of every `extent` from Gaussian σ. The two profiles differ in
*shape*, not merely width — the algebraic one is the tighter out to r ≈ 2.2σ and only fatter
beyond — so no one factor transfers them: ×1.537 (half-width matched) left focal sources too
broad, ×1.0 left diffuse ones too focal, ×1.25 failed in both directions at once. Each source
family's extent was re-derived against its own clinical target instead.

**Still open after this change**, and not resolved by it:

- `C3+C4 mu-band, eyes-open / eyes-closed` reads **0.764** against a floor of 0.8. The algebraic
  tail means posterior alpha genuinely reaches C3/C4, so its collapse on eye opening now drags the
  central 8–13 Hz band with it. [[IK-007]]'s check already described this spill; it is larger now.
  How much posterior field *should* reach central is a clinical question, not a parameter.
- `frontopolar / occipital spectral centroid` reads **1.063** against a floor of 1.1 ([[IK-030]]).
  This is structural: raising `AP_EXPONENT_TILT` from 0.20 to 0.35 *and* its clamp from 1.85 to
  2.0 moved it by −0.006, because with the broader tail every electrode averages all sixteen
  background patches and per-patch exponent differences wash out however large they are. Restoring
  a frequency gradient needs a different mechanism — distinct anterior and posterior aperiodic
  generators rather than a per-patch tilt — not a bigger tilt. Both ineffective edits were
  reverted rather than left in place.
- `GTC Cz-AVG clonic / pre-ictal p2p` reads **1.473** against 1.5, and is saturated: widening the
  source 0.7 → 0.95 gained 0.17, and 0.95 → 1.10 gained 0.007.
