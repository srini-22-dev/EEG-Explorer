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
2 (currently 8.08). Only that floor is asserted. The check also carries a ceiling, which is a
regression guard and **not** a clinical bound: the model is known to make frontal alpha far too
small, and the ceiling is currently set above the wrong value it produces rather than at the
right one — see the §11 note dated 2026-08-28.

Parietal must not be starved relative to posterior temporal: P3/T5 and P4/T6 8–12 Hz power each
sit between 0.5 and 3 (currently 0.77 and 0.76). This is the clause that fails if the posterior
field is shaped so that the parasagittal chain carries no rhythm until its last link.

Independently, C3's 8–12 Hz power exceeds F3's by at least 3× (currently 3.55), measured on a
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
(inter-quartile range). Relative to `awake`: `drowsy` sits at 0.6–1.0 (currently 0.807), `n1` at
0.5–1.0 (currently 0.755), and `n1` is no louder than `drowsy` (currently 0.935). Going the other
way, `n3` is 2–8× `n2` (currently 3.50). The N3/N1 contrast is asserted where AASM scores slow
waves — frontal, ear-referenced (mean IQR of F3-A1 and F4-A2, montage `reference-ipsi`): `n3` is
3–12× `n1` (currently 7.85). On the centro-posterior bipolar rows synchronized delta largely
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
in [[IK-034]] on the centro-posterior rows, sits at 0.4–1.0 of awake (currently 0.686). Isolating
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
and T3-T5 are inverted against each other (correlation ≤ −0.4; currently −0.921). On the common
average (`reference-car`), F7 and T5 carry the *same* polarity as T3 (correlation ≥ +0.6; currently
0.965 and 0.863), at 5–90% of T3's 3.5–6 Hz power (currently 0.141 and 0.112) — the outward decay.
This clause was not met from 2026-09-22 to 2026-10-13; see *Resolved 2026-10-13* below. Switching the onset side to right reproduces every
one of these on Fp2-F8 / F8-T4 / T4-T6 / T6-O2; nothing about the geometry is left-specific.

*Case (b)* — since 2026-10-13 the focal-spike toggles produce this geometry on request. Their
**Focus** option moves the source midway between the focus electrode and its neighbour up the
chain (`focal-spikes-lt`: F7 and T3; `-rt`: F8 and T4; `-lf`: F3 and C3). The link spanning the
pair then reads under a quarter of its larger flank (currently 0.020, 0.090 and 0.038; what is left
is the amplifiers' gain mismatch, not field), the two flanking links deflect in opposite senses,
and the next link down continues in its neighbour's direction, smaller. This is the picture a
reader calls an isopotential: both ends of the flat link see the same voltage.
The focal seizures have the same option (`focal-temporal-ictal`: F7 and T3; `focal-frontal-ictal`:
F3 and C3, or their mirrors by hemisphere), and hold the flat link for the whole discharge. For the
temporal seizure that placement is the early picture of learningeeg's own left temporal seizure,
and its rows are held to the figure's, each within 0.3: in step with Fp1-F7, T3-T5 carries −0.92
of it, T5-O1 −0.69, F3-C3 −0.30, C3-P3 −0.23 and Fp1-F3 +0.18.

It is also still asserted with a synthetic source placed
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
distance)', …)`. For the toggles' own between-electrodes focus: `check('focal-spikes-lt, focus
between: F7-T3 is near-isoelectric against its flanks', …)` and `check('focal-spikes-lt, focus
between: Fp1-F7 and T3-T5 deflect OPPOSITE ways', …)`, with their `-rt` and `-lf` counterparts. For the
seizures: `check('focal-temporal-ictal, focus between: F7-T3 stays near-isoelectric against its
flanks …', …)` and `check('focal-temporal-ictal, focus between: Fp1-F7 vs T3-T5 correlation (the
flanks oppose)', …)`, with their `focal-frontal-ictal` counterparts. Against the figure:
`check('focal-temporal-ictal, focus between: T3-T5 in step with Fp1-F7 …', …)` with its `T5-O1`,
`F3-C3`, `C3-P3` and `Fp1-F3` companions, and `check('focal-temporal-ictal, focus under: F7-T3 in
step with T3-T5 …', …)`.

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

**Resolved 2026-10-13.** That figure now exists. learningeeg's left temporal focal seizure
(*Seizures*, page 2 of its panorama) was traced row by row and read at the seizure's own frequency,
for amplitude and for the share in step with Fp1-F7 — signed, so that each chain's rows sum back
to potentials. Early in the seizure the maximum is a plateau across F7 and T3, with T5 at 0.42 and
Fp1 at 0.38 of it; the two chains give Fp1 the same value, which is the check that the reading
holds together. Later the maximum sits at T3, with F7 at 0.70 and T5 at 0.60. So the electrodes
beside the maximum carry 0.4–0.7 of its voltage — 16–49% of its power, inside this entry's 5–90% —
where the simulator's single patch gave them 0.24 and 0.17, or 6% and 3%. The seizure is now a
regional field fitted to that figure (`fields.ts`, `MID_TEMPORAL_REGIONAL` and
`ANTERIOR_TEMPORAL_REGIONAL`). Under T3, F7 and T5 carry 0.42 and 0.39 of T3's voltage: the low end
of the figure's range, kept there so that T3 stays the plain focus and the rows fall away from it
on both sides, as this entry requires. The between-two placement is the figure's early picture.
Two things the figure shows that one source cannot: the parasagittal rows lag the temporal ones,
and F7-T3 carries half of Fp1-F7's amplitude out of step with it. Read from one figure of one
seizure, with a tracer written for the purpose; its tolerance is not known.

**Status.** enforced (automated) · **Source.** user, 2026-08-14 — extended 2026-08-24 to cover the
interictal focal-spike toggles and a genuine display-space case-(b) check (assistant-drafted
extension, approved in the batch this session). Referential clause restated on `reference-car` and
the entry marked violated 2026-09-22, at the user's direction; resolved 2026-10-13 against a measured
figure.

### IK-004 — A localizing reversal holds at one electrode for the whole discharge

**Claim.** A phase reversal supports localisation only when it stays at the *same* electrode for
the duration of the epileptiform event. A reversal appearing in a single transient, or one that
migrates between electrodes over the course of a discharge, does not localise. [[IK-003]]
describes what a reversal looks like; this entry is about when to believe one.

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `focal-temporal-ictal`, onset side
left. Taking consecutive 2 s windows across the sustained discharge: *every* window shows F7-T3
and T3-T5 inverted against each other (worst window ≤ −0.4; currently −0.809), and *no* window
shows a second reversal one link higher — Fp1-F7 and F7-T3 stay in phase throughout (worst
window ≥ +0.4; currently +0.982). After the event ends the relationship is no longer asserted.

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
for `v-waves` at Cz, `k-complex` at Cz, `focal-spikes-lt` at T3, `bets` at T3; the sharpest point
of the trace — the spike, or the pointed side of an arch — is negative-going for `3hz-gsw` at Fz,
`polyspike-wave` at Fz, `6hz-sw` at O1 and `wicket` at T3 (the last two in state `drowsy`); the
largest excursion is negative-going for `gpeds` at Cz; and the leading phase is positive-going on
screen for `posts` at O1, `lambda` at O1, and `triphasic` at Fz. `blink` on the row Fp1-F3 deflects
downward — see [[IK-001]]. Only direction is asserted; amplitudes and durations are not.

A spike-and-wave run is read by its sharpest point rather than its largest excursion because, as
recorded, it swings about the baseline: troughs below it, spikes and slow waves above
([[IK-012]]). Which of those is the largest says nothing about the spike.

**Mechanism.** *(non-binding)* This is a display convention rather than a physiological fact,
conventionally traced to pen deflection on analogue machines. Nothing physiological follows
from it, and nothing about the underlying signal changes if it is reversed — which is exactly
what makes it dangerous: every power, correlation and topography assertion in the validation
battery is invariant to a global sign flip, so an inverted display passes all of them. This
entry exists because the simulator did in fact render every trace inverted for a period while
the whole battery was green.

**Check.** `validateEngine.ts` §7c — the thirteen
`check('<pattern> renders UP/DOWN (±1)', …)` assertions built from the `POLARITIES` table, plus
`check('blink Fp1-F3 peak (IK-001: Fp1 positive)', …)` and
`check('blink Fp1-F3 renders DOWN (+1)', …)`.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-17 — claim drafted by the
assistant at the user's request, recording a convention the code already enforces; wording not
yet independently confirmed by the user. Observable brought up to date 2026-10-13: it still named
`6hz-sw` at Cz (that pattern has been posterior and drowsy-only since 2026-10-12), counted eleven
checks where there were twelve, and read spike-wave runs by their largest excursion. `wicket` was
added on the IFCN glossary's "spike-like monophasic surface negative … waves".

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
toggle set, the peak-to-peak on Fp1-F7 is 1.8–20× its awake value (currently 4.69), because the
movements belong to the state rather than to the toggle.

That last clause describes the engine's default mode, which the gate and the renderers run. In
the **app**, since 2026-10-12, the state does the same thing by another route: entering `drowsy`
or `n1` switches the `roving-eyes` toggle **on**, so that what is on the page is what the toggles
say, and switching it off removes the movements (`utils/toggleRules.ts`). The same holds for the
other features a stage brings — vertex waves, POSTS, K-complexes, spindles, rapid eye movements.

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
C4-P4 is not appreciably negative (currently +0.182). Holding the subject fixed and introducing mu
makes that pair measurably more inverted (currently by 0.428). Mu is present in 4–22% of sampled
subjects (currently 16%). The `mu-rhythm` toggle summons mu deliberately in any subject regardless
of the draw. Absolute amplitudes are not asserted.

**In the app the subject's own mu is not drawn** (2026-10-13). There, nothing is on the page
unless its toggle is on, and a background rhythm that a third of sessions carried unasked broke
that: the owner, with nothing but Eyes Open switched on, had to ask what the left central rhythm
was. The app turns the trait off (`EegEngine.setBackgroundMu`); mu there is the `mu-rhythm`
toggle. The trait, and every check below, belongs to the engine's default mode, which the gate and
the renderers run.

**Corrected 2026-10-13 — prevalence.** The band was 20–50%, this entry's own number with no
source, and the draw sat at one subject in three. Niedermeyer has scalp mu in "a minority of
subjects"; a 100-subject series found it on visual review in 4%, and a sleep-EEG cohort in 22%.
The band is now those two figures and the draw about one in six. Which figure is right for a
routine adult record is not settled by these sources — visual review undercounts and a sleep
cohort is not a routine record — so the draw sits between them rather than on either.

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

**Claim.** Wicket spikes are a benign temporal variant seen **mostly in drowsiness, and also in
relaxed wakefulness and light sleep**: monomorphic arciform (mu-like) transients over the temporal
region, each arch pointed on its surface-**negative** side and rounded on the other, spanning
roughly the **6–11 Hz** band — not confined to the alpha range. The single feature that keeps
them benign is that a wicket spike is **not** followed by an after-going slow wave and does not
distort the background; a temporal sharp transient *with* a following slow wave is read as
epileptiform instead (contrast [[IK-012]]). Scope: benign morphology, polarity, band and the
states they occur in — this entry does not assert a discharge rate or amplitude.

**Observable.** Montage `bipolar-ap` / `reference-car`, toggle `wicket`, at the left-temporal
chain (T3/T5). Turning the toggle on in state `drowsy` raises both 7–11 Hz **and** 6–7.5 Hz power
at T3 above its toggle-off value (the band is wider than alpha alone). The same toggle in state
`awake` produces the same bursts (currently 100 µV at their largest at T3); it is available in
`awake`, `drowsy`, `n1` and `n2`, and selecting it from deeper sleep or REM moves the background
to `drowsy`. At T3 the sharpest point of a burst is negative-going. The wicket contribution at
T3-T5 carries no after-going slow wave: its delta-band power stays a small fraction of its
arciform-band power. Only the band width, the polarity of the sharp side, the absence of a slow
wave, and presence in wakefulness as well as drowsiness are asserted.

**Mechanism.** *(non-binding)* Conventionally regarded as a benign sharply-contoured fragment of
the temporal drowsy rhythm rather than a cortical irritative discharge, which is why it lacks the
paroxysmal depolarising shift's after-going hyperpolarisation (the slow wave). Not asserted — the
observable distinguishes wicket from an epileptiform sharp wave by morphology alone.

**Check.** `validateEngine.ts` — `check('T3 7-11 Hz power, wicket on / off (drowsy)', …)`,
`check('T3 6-7.5 Hz power, wicket on / off (drowsy; widened range)', …)`, `check('T3 wicket burst
peak while awake (EEGPEDIA: present in relaxed wakefulness too)', …)`, `check('wicket T3 (sharp
side) renders UP (-1)', …)`, and `check('wicket T3-T5 has no after-going slow wave (delta/arciform
power ratio)', …)`.

**Corrected 2026-10-13 — state and shape.** This entry called wickets "a drowsy-state finding …
absent in relaxed wakefulness", and its check asserted that the toggle did nothing awake. The
sources do not say that: eegpedia has them "present in relaxed wakefulness, drowsiness, light
sleep", learningeeg says they "tend to be seen more in the drowsy state", and the IFCN glossary
places them "during drowsiness" without excluding the rest. The source is now available awake and
in light sleep. Two things came with it. The arches are now arches — pointed on the negative side
(IFCN: "spike-like monophasic surface negative … waves"); the shared arciform helper added its
second harmonic in a phase that tilts the wave rather than pointing it. That was put right in the
helper itself later the same day, so mu (pointed on the negative side, as wickets are) and the
14 & 6 bursts (pointed on the positive side, [[IK-016]]) are arches as well. And the band question parked in §11 since 2026-08-25 is closed: eegpedia gives
"short runs of 6–11 Hz", so 6–11 Hz stands beside learningeeg's "usually 7–11 Hz".

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

The slow wave has **the polarity of the transient it follows**. A surface-negative spike is
followed by a surface-negative slow wave, so on a referential montage both point up.

**Observable.** Montage `bipolar-ap` or `reference-car`, state `awake`, at the left-temporal (T3)
focus, one toggle at a time: `ied-spike`, `ied-sharp`, `ied-spike-wave`, `ied-sharp-wave`. The
surface-negative sharp component of `ied-spike` is about 20-70 ms wide at 10% of its peak; that of
`ied-sharp` is about 70-200 ms and visibly broader. `ied-spike` and `ied-sharp` are followed by no
slow wave; `ied-spike-wave` and `ied-sharp-wave` are each followed by an after-going slow wave
**of the same polarity** — surface-negative, pointing up at T3 as the sharp component does — a
slow lobe roughly 0.3-0.8× the sharp component's amplitude (currently 0.646 and
0.725), peaking 0.12 s after a spike and 0.16 s after a sharp wave and over within about a
quarter of a second. On `bipolar-ap` T3-T5, where T3 is input 1, spike and slow wave
likewise deflect the same way. The same holds for the wave of a rhythmic run: 110 ms after a
spike of `3hz-gsw` the trace at Fz is on the spike's side of the baseline, and on Fz-Cz the slow
wave peaks 100 ms after its spike, the same way up. Base width, presence/absence of the slow wave
and its polarity are asserted; absolute amplitude, discharge rate, and the localised phase
reversal (a separate teaching axis, see the `focal-spikes-*` foci) are not.

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
fraction of that peak, and asserts on that — the same observation space as the claim. For the
polarity: `check('ied-spike-wave: the after-going slow wave has the polarity of its spike (-1;
IK-012)', …)`, `check('ied-sharp-wave: the after-going slow wave has the polarity of its sharp
wave (-1; IK-012)', …)`, their display-space counterparts `check('ied-spike-wave T3-T5: the slow
wave deflects the same way as its spike (-1; IK-012)', …)` and `check('ied-sharp-wave T3-T5: the
slow wave deflects the same way as its sharp wave (-1; IK-012)', …)`, and for a rhythmic run
`check('3 Hz gen. spike-wave Fz: the wave after the spike renders UP too (-1; IK-012)', …)` and
`check('3hz-gsw Fz-Cz: spike and slow wave deflect the same way, both up …', …)`.

**Corrected 2026-10-13 — the slow wave's polarity was backwards.** From 2026-08-18 this entry said
the after-going slow wave was surface-**positive**, and the engine drew it so: a spike up, then a
long sag down. Two sources say otherwise. The IFCN glossary (Kane et al. 2017), under *Sharp wave*:
the main component "is generally negative relative to other areas, and may be followed by slow wave
of the same polarity". learningeeg's *Montages* chapter, of a referential figure: "this upward
going spike and wave at F3 is a negative F3 maximal discharge". The disagreement was found in the
2026-10-12 alignment audit and left standing because the code and this entry agreed with each
other; that agreement was one error written down twice, not evidence. Changed with the entry, in
`morphology.ts` and its callers: the isolated complexes (`focal-spikes-*`, the two `ied-*-wave`,
hypsarrhythmia's spikes), the rhythmic runs (`3hz-gsw`, `absence-ictal`, the clonic phase of
`gtc-ictal`, `polyspike-wave`), `lpeds` and `6hz-sw`. A rhythmic complex is now a trough, the
spike rising out of it, and the slow wave, swinging about the baseline as an AC-coupled record
does — which also removed most of the discharge's net offset, the thing [[IK-017]] has to
discount after an absence. `gpeds` keeps its small positive second phase: that is the second half
of a diphasic sharp wave, not an after-going slow wave.

**Timing corrected the same day.** The isolated slow wave peaked 0.4 s after its spike and lasted
about 0.7 s, figures with no source. learningeeg's *Epileptiform* chapter shows one discharge with
its after-going slow wave boxed: the box, spike and wave together, is 0.345 s wide against the
figure's 1 s grid, and inside it the wave follows the spike at once. Where the wave peaks was read
twice and the readings differ — 0.09 s after the spike by eye, 0.16 s by a pixel trace of the F8-T4
row — so the engine puts it at 0.12 s with a 0.24 s base, which is a middle value and not a
measurement; the IFCN glossary asks of a slow wave only that it be longer than 1/8 s. The spike of
the `focal-spikes-*` foci was 94 ms at its base, a sharp wave by this entry's own rule, and is now
60 ms. Still without a source: the 0.3–0.8 size, beyond learningeeg's remark that the slow wave
"may be higher amplitude than the preceding sharp or spike".

**Status.** enforced (automated) · **Source.** Claude, 2026-08-18 — proposed by the assistant and
approved by the user that session. Polarity corrected 2026-10-13 from the IFCN glossary and
learningeeg, at the user's direction ("IK are not above mistakes, do research to fix them").

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
(currently 78×). Later in the same event, T4's 3.5–6 Hz power is at least 2× its own onset value
(currently 26×). Setting the onset side to right mirrors both. The entry asserts the ordering —
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
power is essentially nil (currently 0.003 µV², bounded below 2). A prior port added a ~2 s fading
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

**Observable.** State `awake`, toggle `absence-ictal`. Over the discharge, the Fz-AVG spike-wave
peak frequency lands in 2.5–3.5 Hz (currently 2.93; a rate does not depend on the montage). The
field is **generalised**: on `bipolar-ap` the smallest row of the double banana carries at least a
quarter of the largest (currently 0.38; learningeeg's two generalised spike-wave figures read 0.27
and 0.35), and O1 still carries real 2.5–3.5 Hz power. It is **frontally predominant**, read on
`reference-ipsi`: Fz-A1 carries at least 2.25× the 2.5–3.5 Hz power of O1-A1 (currently 7.79).
ACNS 2021 §C.1.a calls a generalised pattern frontally predominant from a 50% voltage excess,
which is 2.25× in power. Only rate, the generalised reach, and the frontal predominance are
asserted.

**Mechanism.** *(non-binding)* Conventionally a thalamocortical generalised oscillation with a
frontal-predominant scalp projection. Not asserted — the observable fixes rate and topography, not
the generator.

**Check.** `validateEngine.ts` — `check('absence Fz-AVG discharge peak frequency (typical: 2.5-3.5
Hz, not atypical)', …)`, `check('absence O1-AVG carries real 2.5-3.5 Hz power (generalised field
reaches occiput)', …)`, `check('absence Fz-A1 / O1-A1 2.5-3.5 Hz power, reference-ipsi (ACNS:
frontally predominant from 2.25)', …)`, and `check('absence-ictal smallest / largest row of the
double banana (LEARNINGEEG figures: 0.27, 0.35)', …)`.

**Corrected 2026-10-13 — the frontal predominance was being read on the wrong montage.** The
Observable asserted that "frontal predominance survives the common-average reference". For a
genuinely generalised discharge it does not, and should not be expected to: the average of a
generalised discharge is the discharge, so subtracting it hands the quietest electrodes an inverted
copy about as large as what is left at the loudest. The check passed only while the source was a
single patch under Fz — a frontal-midline focus too small to move the average, which is the defect
the 2026-10-12 audit found on the page (the discharge on Fz-Cz, a tenth of it on the temporal
chains). Once the field was made generalised the same ratio read 0.96. ACNS 2021 §C.1.a names the
montages on which predominance is judged; the ipsilateral ear is the one used here.

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

**Observable.** State `awake`, toggle `gtc-ictal`. Timing and suppression are read at Fz-AVG
(`reference-car`): the isolated recruiting contribution peaks in the beta range (~17 Hz) and is
on the page from the first second of the seizure; the clonic phase's peak frequency is higher
early than late (organised slowing toward ~1.5 Hz); and after the clonic phase the display-space
amplitude collapses relative to it — post-ictal suppression, visible as attenuation rather than
silence. The generalised reach is read on `reference-ipsi`, at Cz-A1, where the clonic discharge
is several times the pre-ictal trace (currently 8.27×), and on `bipolar-ap`, where the smallest row
carries at least a quarter of the largest (currently 0.38). Only the ordering (fast → slowing
spike-wave → suppression) and the generalised reach are asserted.

With the seizure's **muscle** option on — the app's default — the record carries what a real one
does. Muscle artifact overlies the whole tonic phase, on T3-T5 at least as large as the fast rhythm
under it, on most rows of the page and least at the vertex; in the clonic phase it comes as one
burst with each jerk, the muscle let go between bursts, at the discharge's own slowing rate; and
after the seizure there is none. Every clause above is read with the option off, where the
discharge stands alone.

**Mechanism.** *(non-binding)* Conventionally the recruiting rhythm is the electrographic
correlate of tonic stiffening, the slowing clonic spike-wave of the jerks spacing out, and the
suppression of post-ictal cortical depression. Not asserted — the observable fixes only the phase
sequence.

**Check.** `validateEngine.ts` — `check('GTC Fz-AVG recruiting contribution peak frequency (beta-
range, ~17 Hz)', …)`, `check('GTC Fz-AVG clonic peak frequency, early / late (organised slowing)',
…)`, `check('GTC Cz-A1 clonic / pre-ictal p2p, reference-ipsi (generalised field reaches Cz)',
…)`, `check('gtc-ictal smallest / largest row of the double banana (LEARNINGEEG figures: 0.27,
0.35)', …)`, and `check('GTC Fz-AVG post-ictal / clonic p2p (display-space suppression)', …)`,
with their supporting per-window peak-frequency and p2p checks. For the muscle:
`check('GTC muscle / seizure rhythm RMS on T3-T5, tonic phase …', …)`, `check('GTC muscle: rows
carrying at least a quarter of the largest row, tonic phase, of 18 …', …)`, `check('GTC muscle on
Cz-Pz / on T3-T5, tonic phase …', …)`, `check('GTC muscle: share of the clonic phase with the
muscle let go …', …)`, `check('GTC muscle bursts per second, early clonic …', …)`, `check('GTC
muscle bursts per second, late clonic …', …)` and `check('GTC muscle RMS on T3-T5 after the seizure
(flaccid: none)', …)`. Each reads the difference between the same seizure with its muscle and
without, so that only the muscle is measured.

**Added 2026-10-13 — the muscle.** The seizure had none. learningeeg's *Seizures* chapter makes it
the mark of the tonic phase — "an initial period of continuous, tonic motor activity that clinically
appears as stiffening and on EEG appears as significant and usually diffuse myogenic artifact" —
and of the clonic: "intermittent bursts of spike / polyspike and slow waves, with each spike burst
corresponding to the clonic jerks". It is built from the four muscle sources the Muscle toggle
uses, on the seizure's own timeline, and offered as an option under the toggle because it buries
the rhythm this entry is about: on in the app, off for anything that measures the discharge. Its
size (35 µV RMS at each muscle, the figure a chew uses) has no source.

**Corrected 2026-10-13.** The generalised-reach clause was read at Cz-AVG, on the common average,
which nearly nulls Cz for a generalised field (see the note under [[IK-018]] and [[IK-029]]'s
montage caveat): it measured 1.5× where the ear reference reads many times that. The history in
the Status line below — a source "re-anchored across Fz and Cz" — is superseded: since 2026-10-12
the seizure is a generalised, frontally predominant field (`fields.ts`), on every chain. A timing
audit on 2026-10-13 found the recruiting rhythm grew from nothing and reached 10 µV on no row
until 3.2 s into its 4 s, so the seizure had no onset a reader could point to; it now begins at a
third of its size. The phases were also compressed: a 4 s fast phase, 14 s of clonic activity and then 17 s of a
fading delta "decrescendo" that no source describes. Later the same day the seizure was given
about its real length — 10 s tonic, 45 s clonic, 35 s of suppression, 30 s of recovery — against
10.5 ± 3.6 s, 49 ± 27 s and 39 ± 24 s for the first three in an adult video-EEG series
(PMC3799796; read from search excerpts, the page itself could not be opened). Recovery, about two
minutes in that series, is the one phase still shortened. Durations stay outside what this entry
asserts.

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
slightly longer than the one before. They are **generalised** — on every chain — and
**anterior-predominant** in amplitude, repeat at about **1–2 per second**, and carry a
characteristic **anterior-to-posterior time lag**: the frontal channels lead, and the posterior
channels reproduce the same waveform later, by **more than 100 ms** from the first row of a
longitudinal chain to the last. That lag and the anterior amplitude maximum together distinguish
triphasics from a synchronous generalised discharge. Scope: morphology, distribution, the
amplitude gradient, the rate and the AP lag; this entry does not assert an aetiology.

**Observable.** Toggle `triphasic`, state `awake`. On `bipolar-ap`, Fp1-F3 **leads** P3-O1 by
0.1–0.2 s (currently 0.124 s) — the lag from the first row of the chain to the last, which is how
ACNS defines it. On `reference-ipsi` (ear reference, avoiding common-average self-subtraction)
Fz-A1 leads Pz-A1 and O1-A1 by a positive lag (currently 0.052 and 0.068 s) with a real, positive
lagged correlation; those lags are shorter than the chain's because the ear itself carries some
of the anterior field. Fp1-A1's peak-to-peak is at least 1.5× O1-A1's (currently 2.31). The waves
are on every row of the double banana — the median row is at least 0.3 of the largest (currently
0.47) — and repeat at 1–3 per second (currently 1.14). Only the lead direction, a chain lag
over 100 ms, the anterior amplitude maximum, the generalised distribution and the rate are
asserted.

**Mechanism.** *(non-binding)* Conventionally attributed to a fronto-central generator whose field
propagates postero-temporally, and clinically associated with metabolic/toxic encephalopathy — but
neither the generator nor the aetiology is asserted here. The observable fixes only the amplitude
gradient and the lag.

**Check.** `validateEngine.ts` — `check('triphasic Fp1-F3 leads P3-O1, bipolar-ap (ACNS: an A-P
lag is > 100 ms)', …)`, `check('triphasic Fz-A1 leads Pz-A1 (positive lag = posterior follows
anterior)', …)`, `check('triphasic Fz-A1 leads O1-A1 …', …)`, their two lagged-correlation checks,
`check('triphasic Fp1-A1 p2p / O1-A1 p2p, reference-ipsi (ACNS: frontally predominant from 1.5)',
…)`, `check('triphasic median / largest row of the double banana …', …)`, and `check('triphasic
repetition rate (LEARNINGEEG: 1-3 Hz)', …)`.

**Corrected 2026-10-13 — "a small positive lag (~8–200 ms)" was not a lag.** ACNS 2021 §C.4.c: an
anterior-posterior lag is "a consistent measurable delay of >100 ms from the most anterior to the
most posterior derivation in which it is seen". This entry accepted anything from 8 ms, and the
engine supplied 60 ms between its two halves (36 ms measured on the chain) — by the definition,
no lag at all. Worse, the posterior half fell a further 0.11 s behind on every complex, so the
lagged correlations sat on their floors (0.19 and 0.13). Both were fixed on 2026-10-12; the entry
is brought into line here. Added from the same sources: that the waves are generalised
(learningeeg: "most often generalized") rather than a frontal-midline focus, and their rate (IFCN
glossary: "about 1 to 2 per second"; learningeeg: 1–3 Hz), where the engine had run at 0.65 per
second. The amplitude clause moved from Fz to the frontal pole, where the field is largest.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

### IK-022 — FIRDA is frontally-maximal, ~1.5–3 Hz, and rhythmic

**Claim.** Frontal intermittent rhythmic delta activity (FIRDA) — in current ACNS terms,
**generalized rhythmic delta activity (GRDA) with frontal predominance** — is **bilateral and
frontally maximal**, **rhythmic** (monomorphic, sinusoidal-ish) delta, conventionally at
**1.5–3 Hz** — distinct from the polymorphic, arrhythmic delta of focal structural slowing
([[IK-023]]). Its rhythmicity and frontal maximum are the defining features. Scope: topography,
band, and rhythmicity; amplitude and intermittency rate are not asserted.

**Observable.** Toggle `firda`, state `awake`. Topography is read on `reference-ipsi`: Fp1-A1
peak-to-peak is at least 1.5× O1-A1's and exceeds T3-A1's (currently 3.32 and 2.91). On
`bipolar-ap` the frontopolar rows are the largest and the posterior rows carry under a fifth of
them — the bursts do not travel back. Band and rhythmicity are read at Fz-AVG (they do not depend
on the montage): the discharge frequency lands in 1.5–3 Hz (currently 2.44) with a tight spectral
peak, and its autocorrelation shows a strong secondary peak at a lag within one cycle. Only
topography, band, and rhythmicity are asserted.

**Mechanism.** *(non-binding)* Conventionally a non-specific marker of deep midline/diencephalic
dysfunction or raised intracranial pressure in adults; not asserted. The observable fixes only
where the rhythm is maximal, its band, and that it is rhythmic.

**Check.** `validateEngine.ts` — `check('firda Fp1-A1 p2p / O1-A1 p2p, reference-ipsi (ACNS:
frontally predominant from 1.5)', …)`, `check('firda Fp1-A1 p2p / T3-A1 p2p, reference-ipsi
(frontal, not temporal)', …)`, `check('firda frontopolar rows / Fz-Cz …', …)`, `check('firda
posterior rows / frontopolar rows …', …)`, `check('firda Fz-AVG discharge frequency (delta;
conventionally 1.5-3 Hz, learningeeg example 1.5 Hz)', …)`, `check('firda Fz-AVG spectral peak is
tight (rhythmic, not polymorphic)', …)`, and the two autocorrelation-rhythmicity checks.

**Corrected 2026-10-13.** Three things. The topography was asserted on the common average, as
"Fz-AVG exceeds O1-AVG and T3-AVG" — which a bilateral frontal field fails, for the reason given
under [[IK-018]], and a frontal-midline focus passes. It is now read against the ear, and at the
frontal pole, where learningeeg's figure has it largest. The check's label credited learningeeg
with "~1.5–3 Hz": learningeeg says only "delta" and shows one example at 1.5 Hz, so the label now
says the figure is the conventional one. And the modern name is recorded. This closes the item
parked in §11 since 2026-08-25.

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

**Corrected 2026-10-13 — the field.** The slowing was one patch under T3, with F7 and T5 at 0.28
and 0.20 of T3's voltage. It now takes the regional field fitted to learningeeg's temporal seizure
([[IK-003]]): F7 0.42, T5 0.39, C3 0.38. learningeeg's own slowing figure ("Continuous left
hemispheric polymorphic delta slowing, maximal temporally") is too coarse to fit a field to, but
traced, its four left temporal rows carry 1–4 Hz activity at 0.63, 1, 0.65 and 0.85 of the largest,
which a maximum at T3 would make F7 0.40 and T5 0.54 of it. That agreement is noted, not asserted:
no check holds the slowing to a figure.

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
**≤ 2** (currently 1.19, against 5.26 without slowing). The O1/O2 spectral peak in 3–14 Hz sits at **3–7 Hz**. Not
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
nearly regular** interval — the low variability of the inter-discharge interval is what makes
them *periodic* rather than random: learningeeg draws the line at an interval varying by under
25%, ACNS 2021 at most cycle pairs varying by under 50%. They are **generalized**: bilaterally
synchronous and symmetric, on every chain (contrast the lateralized LPEDs, [[IK-026]]). The
simulator's run about every 1.5 s (0.67 Hz), slower than the 1 Hz at which GPDs begin to count
toward the ictal-interictal continuum. Scope: periodicity and generalized distribution; amplitude
and aetiology are not asserted.

**Observable.** Toggle `gpeds`, state `awake`. Timing, read at Cz-AVG: the mean inter-discharge
interval is 1–2.5 s (currently 1.69 s) with a low coefficient of variation, and the largest change
from one interval to the next is under 25% (currently 0.125). Distribution, read on `bipolar-ap`:
the smallest row of the double banana carries at least a third of the largest (currently 0.45,
against 0.42 and 0.53 on learningeeg's two GPD figures), no homologous pair of rows differs by
more than half, and F3-C3 and F4-C4 move together (correlation ≥ 0.9). The field is neither a
midline focus nor frontally or occipitally predominant: midline/parasagittal voltage on
`reference-car` and anterior/posterior voltage on `reference-ipsi` both stay inside 1/1.5–1.5.
Only the periodicity and the generalized distribution are asserted.

**Mechanism.** *(non-binding)* Conventionally associated with severe diffuse encephalopathy
(e.g. anoxic); not asserted. The observable fixes only the timing regularity and the distribution.

**Check.** `validateEngine.ts` — `check('gpeds Cz-AVG mean inter-discharge interval (no faster
than 1 Hz: below the ictal-interictal continuum)', …)`, `check('gpeds Cz-AVG interval coefficient
of variation stays low (periodic, not random)', …)`, `check('gpeds largest change between
consecutive intervals (LEARNINGEEG: periodic < 25%)', …)`, `check('gpeds cycle pairs varying < 50%
…', …)`, `check('gpeds smallest / largest row of the double banana (LEARNINGEEG figures: 0.42,
0.53)', …)`, `check('gpeds largest left/right difference between homologous rows …', …)`,
`check('gpeds F3-C3 vs F4-C4 correlation (ACNS: bilaterally synchronous)', …)`, `check('gpeds
midline / parasagittal voltage, reference-car …', …)`, `check('gpeds anterior / posterior voltage,
reference-ipsi …', …)`, and the two older ones, `check('gpeds present at O1-AVG too (generalized,
not focal)', …)` and `check('gpeds Cz-AVG / O1-AVG p2p ratio stays within a generalized (not
sharply focal) range', …)`.

**Corrected 2026-10-13 — "generalized" was being tested through two electrodes, and the interval
was a misreading.** This entry's whole evidence for a generalized field was a ratio between Cz
and O1 on the common average, with a ceiling of 6; the engine read 6.04, and the discharge was a
spike at the vertex — 123 µV on Fz-Cz, 1–2 µV on the temporal chains (2026-10-12 audit). A check
that reads two electrodes cannot tell a generalized field from a midline one; smallest row over
largest row can, and is now asserted. Second, the interval "of order ~1–2.5 s", which the check's
label credited to learningeeg: learningeeg's "1–2.5" is in **hertz**, and is where GPDs meet the
ictal-interictal continuum ("when they trend >1–2.5 Hz"). The bounds are kept — read as an
interval they say *slower than 1 Hz*, which is where the simulator's GPDs are meant to sit — and
the label now says what they mean.

**Status.** enforced (automated) · **Source.** Claude, 2026-08-24 — drafted by the assistant at
the user's request and approved in the batch this session; recording behaviour the validation
battery guards. Clinical wording not yet independently confirmed by the user.

### IK-026 — LPEDs are periodic like GPEDs but lateralized to one side

**Claim.** Lateralized periodic epileptiform discharges (LPEDs / PLEDs / LPDs) share the
**periodic, roughly regular** timing of GPEDs ([[IK-025]]) but are **lateralized** — confined to,
or markedly larger over, one hemisphere. The lateralization is the distinguishing feature; the
periodicity is common to both. Within its hemisphere the discharge is **regional**, not confined
to one electrode. Scope: periodicity, lateralization and regional spread; amplitude and aetiology
are not asserted.

**Observable.** Montage `bipolar-ap`, toggle `lpeds`, left onset. The T3-T5 mean inter-discharge
interval is about one second (0.67–1.5 s; currently 1.05 s) with a low coefficient of variation
and no interval differing from the last by 25% (periodic), and T3-T5 peak-to-peak greatly exceeds
the homologous T4-T6 (lateralized, unlike GPEDs). Each discharge is a sharp wave and the slow wave
that follows it, of the same polarity ([[IK-012]]), with a clear interval before the next. The
left parasagittal chain carries it too: F3-C3, less its right-side twin F4-C4, has 0.38–0.98 of
what T3-T5 has less T4-T6 (currently 0.49; learningeeg's "Left temporal LPDs at 1 Hz" reads 0.68),
and F7-T3 and C3-P3 are held to the same figure's shares (0.84 and 0.27; currently 0.97 and 0.35).
Periodicity, lateralization and that regional spread are asserted.

**Mechanism.** *(non-binding)* Conventionally associated with an acute or subacute focal
destructive lesion (e.g. herpes encephalitis, stroke) and often a marker of an irritable,
potentially ictal focus; not asserted. The observable fixes only the timing regularity and the
side.

**Check.** `validateEngine.ts` — `check('lpeds T3-T5 mean inter-discharge interval (LEARNINGEEG:
"roughly once per second")', …)`, `check('lpeds T3-T5 interval coefficient of variation stays low
(periodic, not random)', …)`, `check('lpeds largest change between consecutive intervals
(LEARNINGEEG: periodic < 25%)', …)`, `check('lpeds T3-T5 p2p >> T4-T6 p2p (lateralized, unlike
GPEDs)', …)`, and for the regional spread `check('lpeds F7-T3 less F8-T4, as a share of T3-T5 less
T4-T6 (LEARNINGEEG figure: 0.84)', …)`, `check('lpeds F3-C3 less F4-C4, as a share of T3-T5 less
T4-T6 (LEARNINGEEG figure: 0.68)', …)` and `check('lpeds C3-P3 less C4-P4, as a share of T3-T5 less
T4-T6 (LEARNINGEEG figure: 0.27)', …)`. Those three use one estimator on the figure and on the
engine: the median peak-to-peak per 1 s window of the page as drawn, each left row less its
right-side twin, as a share of T3-T5's. Their bounds are the figure's value ±0.3, which is how far
that estimate moved on the figure between the median window and the 80th-percentile one.

**Corrected 2026-10-13.** The interval "~0.8–2 s" was credited to learningeeg, which says
"recurring roughly once per second" and shows an example at 1–1.5 Hz; the engine ran one every
1.4 s. It now runs one every ~1.05 s, and the bound is the source's. The discharge itself was the
shared spike-and-slow-wave shape cut off a quarter of a second in, before its slow wave had
arrived, which left a 60 µV step at the end of every complex; it is now a whole sharp-and-slow
complex. The field was a single patch under T3, where learningeeg's LPDs are spread "over one hemisphere or
region". Later the same day it was fitted to learningeeg's figure "Left temporal LPDs at 1 Hz",
measured row by row (`fields.ts`, `LEFT_TEMPORAL_REGIONAL`): a maximum at T3 and a lower one at
C3, nothing across the midline. The single patch already gave the temporal rows; what it left out
was the parasagittal chain — F3-C3 at 0.09 of T3-T5 by its leadfield, where the figure has 0.68 and
the engine now 0.49. No smooth field gives the figure's F3-C3 and its C3-P3 (0.27) at once, and the
fit splits the difference. It is one figure of one patient; learningeeg's "Right hemispheric LPDs"
is broader and frontal, and was looked at but not measured.

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
power on F3-C3 and F4-C4 sits between 0.30 and 0.60 (currently 0.515), and **exceeds by no more
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
(the engine reads ~3.9). The 10–100 µV envelope applies to channels that do not sit beside their
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
`O1 13-15 Hz during 14 Hz train, on / off` (29.4), `O1 / Cz 13-15 Hz during 14 Hz train
(occipital)` (66.7), `O1 / O2 driving power (symmetry)` (1.00), `O1 17-19 / 13-15 Hz during
18 Hz train (tracks flash rate)` (36.8), `O1 13-15 Hz in the rest gap, on / off` (1.00), and
`O1 1.5-2.5 Hz during 2 Hz train, on / off` (1.09).

**Status.** enforced (automated) · **Source.** Claude, 2026-08-17 — drafted by the assistant at
the user's request, recording behaviour the validation battery already guards; the check figures
above were measured that session and refreshed 2026-10-13. Clinical wording not yet independently
confirmed by the user.

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
`Fz 2-7 Hz late / early in the procedure (build-up)` (133.7), `Fz 2-7 Hz after recovery, on / off`
(1.00), `Fz / O1 2-7 Hz at full build-up (frontal)` (38.2), `Fz delta/theta contribution, full /
mid build-up (theta first, then delta)` (2.97), and `O1 alpha power at full build-up, on / off`
(0.44).

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

### Resolved 2026-10-13 (open since 2026-08-25) — wicket band: [[IK-015]] asserts 6–11 Hz, learningeeg.com says 7–11 Hz

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

**Resolved 2026-10-13.** eegpedia.org, the owner's second reference, gives "short runs of 6–11 Hz
spikes … usually within alpha frequency range". The two sources bracket the band the same way —
6–11 Hz at its widest, usually 7–11 — so [[IK-015]] stands at 6–11 Hz and the 6–7.5 Hz check stays.

### Resolved 2026-10-13 (open since 2026-08-25) — FIRDA frequency and terminology: [[IK-022]]'s "~1.5–3 Hz" is not a learningeeg figure

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

**Resolved 2026-10-13.** The check's label now reads "delta; conventionally 1.5-3 Hz, learningeeg
example 1.5 Hz", and [[IK-022]]'s claim records the GRDA name.

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

**Still open after this change**, and not resolved by it. (All three have since been closed: the
mu spill by isolating mu's own contribution, [[IK-007]]; the centroid by replacing the metric,
[[IK-030]]; the GTC figure by reading it against the ear instead of the common average,
[[IK-019]].)

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

### Corrected 2026-10-13 — a source audit of every entry

At the user's direction ("IK are not above mistakes, do research to fix them"), every entry was
read against learningeeg.com, eegpedia.org, ACNS 2021 (Hirsch et al., *J Clin Neurophysiol* 38:1)
and the IFCN glossary of EEG terms (Kane et al. 2017, *Clin Neurophysiol Pract* 2:170). Entries are
corrected in place, each with a dated note saying what it got wrong, as [[IK-024]] and [[IK-030]]
were before.

| Entry | What was wrong | Source |
|---|---|---|
| [[IK-012]] | The slow wave after a spike was surface-positive. It has the spike's polarity | IFCN glossary; learningeeg, *Montages* |
| [[IK-015]] | Wickets "absent in relaxed wakefulness"; arches not pointed on the negative side | eegpedia; learningeeg; IFCN glossary |
| [[IK-018]], [[IK-019]], [[IK-022]] | A generalised field's topography asserted on the common average | ACNS 2021 §C.1.a |
| [[IK-021]] | An "8–200 ms" lag; nothing on distribution or rate | ACNS 2021 §C.4.c; learningeeg; IFCN glossary |
| [[IK-022]] | "~1.5–3 Hz" credited to learningeeg; no GRDA name | learningeeg |
| [[IK-025]] | "Generalized" tested between two electrodes; "1–2.5 s" was learningeeg's 1–2.5 **Hz** | learningeeg; ACNS 2021 |
| [[IK-026]] | "0.8–2 s" credited to learningeeg, which says about once a second | learningeeg |
| [[IK-008]] | Observable out of date (the 6 Hz site, the count, how a spike-wave run is read) | — |
| [[IK-003]], [[IK-033]], [[IK-036]] | Observables that no longer described the app | — |

**Read and found sound against the same sources:** [[IK-001]], [[IK-002]], [[IK-004]] to
[[IK-007]], [[IK-009]] to [[IK-011]], [[IK-013]], [[IK-014]], [[IK-016]], [[IK-017]], [[IK-020]],
[[IK-023]], [[IK-024]], [[IK-027]] to [[IK-032]], [[IK-034]], [[IK-035]].

**Found by the same audit, left open, and closed later the same day** at the user's direction
("fix the ones found and not changed"). Each entry named carries the detail:

- The isolated slow wave's timing: 0.4 s after the spike and ~0.7 s long, with no source. Now
  0.12 s after and 0.24 s long, from learningeeg's boxed spike-and-wave figure. The two readings of
  that figure differ, so the number is a middle value; and the slow wave's 0.3–0.8 size is still
  unsourced ([[IK-012]]).
- LPEDs were a single patch under T3. Now a regional field fitted to learningeeg's "Left temporal
  LPDs at 1 Hz", with three checks on the parasagittal chain ([[IK-026]]).
- The tonic-clonic seizure was 4 s + 14 s + a 17 s decrescendo. Now 10 s tonic, 45 s clonic, 35 s
  suppressed, 30 s recovering ([[IK-019]]).
- Mu's prevalence band was 20–50% with the draw at 36%. Now 4–22% and 16% ([[IK-033]]).
- The shared arciform shape tilted its wave. It is an arch now, for mu, wickets and the 14 & 6
  bursts alike ([[IK-015]]).

Found while checking the annotation arrows, and fixed with them: roving eye movements switched on
at full size in mid-swing, a step of up to 40 µV at the source (71 µV on F8-T4 in one record) —
faster than any roving movement ([[IK-036]]). They now ease in over a second.

**Noted, with nothing to change:**

- [[IK-017]] and [[IK-020]] read their rates at `Fz-AVG`, `T3-AVG` and `F3-AVG`. A rate does not
  depend on the montage, so nothing is wrong there; it is noted so that no topography clause is
  added to them on the common average.
