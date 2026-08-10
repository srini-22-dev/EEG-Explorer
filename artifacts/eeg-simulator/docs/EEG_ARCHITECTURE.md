# EEG Architecture

**This document, together with `GeneratorCatalogue.md`, `FieldMaps.md`, and `TeachingConcepts.md` in this same folder, is the governing document set for the EEG Explorer signal-generation engine. Every change to `src/engine/*.ts`, `eegGenerator.ts`, `computeChannel.ts`, or any montage/field/generator logic must follow them. No exceptions.**

If a proposed change can't be justified against these four documents, it doesn't belong in the simulator, no matter how good it looks on screen.

## The engine rewrite, and where it takes precedence

The signal engine has been rewritten from a sum-of-sinusoids model to a stochastic, forward-modelled one, following an external briefing document, *"Generating Realistic Synthetic EEG"* (cited throughout `src/engine/*.ts` as `§1`–`§14`). **Where that briefing conflicts with older material in this document set, the briefing governs** — this is a project-owner ruling, not a suggestion. This revision of the four documents brings them into agreement with the briefing and the code that implements it. Read `src/engine/*.ts` — every file opens with a header comment explaining what it implements and why — before touching signal-generation code; those headers are the primary source of truth, and this document set is the secondary, human-readable one.

## Why this exists

This project has already fallen into the same failure mode more than once: writing math that makes the trace *look* more realistic, then retrofitting a physiological explanation for it afterward. That order is backwards and produces a simulator that teaches nothing, or teaches something wrong. This document set fixes the order: physiology first, mathematics as its consequence.

## The governing document set

| Document | Governs |
|---|---|
| **EEG_ARCHITECTURE.md** (this file) | The seven architectural principles and the generator→display pipeline. Read this first. |
| [`GeneratorCatalogue.md`](./GeneratorCatalogue.md) | The authoritative list of every voltage-producing generator in the simulator — clinical name, anatomical source, frequency, active state — for both the new stochastic engine (`src/engine`) and the legacy toggleable pattern layer (`eegGenerator.ts`). |
| [`FieldMaps.md`](./FieldMaps.md) | How each generator's spatial field is produced: geometrically, from the forward model (`forward.ts`), for the new engine's neural and artifact sources; by hand-authored per-electrode gain table for the legacy focal-spike pattern layer. |
| [`TeachingConcepts.md`](./TeachingConcepts.md) | The clinical-terminology layer and the concept map separating true generators from montage math, modifiers, and technical artifacts. |

## Two generator layers

There are now two generator layers, composed additively, not one:

1. **The streaming engine (`src/engine/`).** Produces the aperiodic background, the oscillatory rhythms (alpha, mu, beta, theta, delta), vigilance-state drift, artifacts with their own topographies (ocular, muscular, cardiac, electrode/technical), and the recording chain (amplifier filter, sensor noise, bad channels). Stateful and stochastic: it is advanced one sample at a time (`EegEngine.next(out)`), not evaluated as a pure function of `t` — see `engine.ts`'s header comment for why a pure-function-of-t interface was rejected (a frequency-wander term multiplied by absolute elapsed time drifted the posterior rhythm into the theta band after ten minutes).
2. **The legacy pattern layer (`eegGenerator.ts`).** The toggleable clinical graphoelements — sleep architecture (K-complexes, spindles, vertex waves, POSTS), normal variants (mu rhythm, wicket spikes, lambda waves, PSWY, etc.), artifacts, non-epileptiform abnormalities (FIRDA, triphasic waves, GPEDs/LPEDs), interictal epileptiform spikes, and ictal/seizure patterns. These are **event-based**, not sustained rhythms, so the rewrite did not invalidate them: `getPatternVoltage(electrode, t, settings)` still sums exactly the contributions this document set always required, and rides on top of the engine's output additively via `engine/adapter.ts`. The old `getElectrodeVoltage(electrode, t, settings)` — which used to also synthesize the *sustained background* (PDR, frontal beta, anterior theta, diffuse background, EMG) as sums of fixed tones — is superseded and unused; that sustained-background role now belongs entirely to the engine.

## The pipeline

```
Cortical sources (aperiodic background patches, Hopf/burst rhythms)   [src/engine]
        ↓
Forward model / leadfield  (geometric dipole projection, forward.ts)
        ↓
Artifact sources (ocular, muscular, cardiac, electrode)  [own topographies, artifacts.ts]
        ↓
Raw electrode potentials
        ↓
Recording chain (amplifier filter, sensor/reference noise, bad channels)  [chain.ts]
        ↓
+ Legacy graphoelements (spikes, K-complexes, seizures, ...)  [eegGenerator.ts, additive]
        ↓
Electrode potentials (Fp1, F3, C3, P3, O1, ...)
        ↓
Montage computation (bipolar / referential)  [computeChannel.ts, unchanged]
        ↓
Displayed EEG
```

Electrode potentials and montage computation remain separate, ordered stages in the codebase, exactly as before: the engine (plus the legacy pattern layer riding on top of it) computes each electrode's potential; `computeChannel.ts` performs bipolar subtraction or referential averaging strictly afterward. The montage layer is purely mathematical and must never contain physiology; all physiology lives in the generator layers above it. `chain.ts`'s recording-chain stage (amplifier filter, sensor/reference noise, bad channels) sits *before* montage computation too — it models what happens to a signal before it is even referenced, not a montage effect, and per §7 (cited in `chain.ts`) potentials are generated with respect to infinity, with any reference operator applied as an explicit later stage so source-localisation ground truth stays uncorrupted.

## The Seven Principles

### Principle 1
**EEG records voltage differences, not neuronal firing.**

The simulator never models "neurons firing." It models continuous voltage-generating processes whose *summed field* is what an electrode sees. In the new engine those processes are explicitly stochastic dynamical systems with a physiological story attached — a bank of Ornstein-Uhlenbeck relaxation processes for the aperiodic background (`aperiodic.ts`, standing in for a distribution of synaptic/membrane relaxation times), noise-driven Stuart-Landau oscillators for rhythms (`oscillator.ts`), gamma-renewal burst trains for beta and frontal-midline theta (`bursts.ts`), and shot-noise motor-unit summation for EMG (`artifacts.ts`) — never a bare random event with no physiological identity. Even patterns that look like discrete events on the trace — spikes, K-complexes, sharp transients, still generated by the legacy pattern layer — are modeled as voltage waveforms produced by a named generator, never as a simulated action potential. "Add a random blip for realism" is rejected on sight: a blip needs a generator (see `GeneratorCatalogue.md`), not just a justification.

### Principle 2
**Electrodes record mixtures of generators.**

This is now satisfied two different ways, by the two generator layers:

- **Engine layer.** Every source — background patches and rhythms alike — is projected to every electrode through the shared leadfield matrix `G` (`forward.ts`, `buildLeadfield`): `out[e] = Σ_s G[e][s] · V[s]`. This *is* "a sum of contributions from every generator that physically reaches that electrode," enforced by construction (matrix multiplication) rather than by convention, which is a stronger guarantee than the old per-electrode function ever gave. There is no per-electrode special case anywhere in the engine — region-specific behaviour comes entirely from where a source sits and how far its field reaches (§7, `forward.ts`), never from branching on an electrode's name.
- **Legacy pattern layer.** `getPatternVoltage(electrode, t, settings)` is still, as before, a literal sum of every active named graphoelement's contribution evaluated at that electrode — unchanged in spirit from the original principle, and still forbidden from special-casing on electrode identity outside of a generator's own field map.

### Principle 3
**Changing montage never changes brain activity. Only the mathematical comparison changes.**

Electrode potentials and montage computation are strictly separate stages, and information must never flow backward from the second into the first. This is unchanged by the rewrite — if anything it is now enforced more explicitly: `chain.ts`'s header comment calls out the same division of labour from the briefing's §7 (potentials generated with respect to infinity; reference/montage applied strictly afterward), and `computeChannel.ts` is untouched by the engine rewrite. Switching from bipolar to common-average reference must never alter a single generator's amplitude, timing, or behavior — it only changes which subtraction or averaging is applied to the same underlying electrode potentials. If a montage switch ever appears to need different generator behavior, that's a bug in the generator layer, not a case to special-case in the montage layer.

### Principle 4
**Phase reversal is produced by bipolar subtraction.**

Unchanged, and explicitly preserved by design through the rewrite. Phase reversal is never hand-scripted ("flip the sign for this channel because it's near the focus"). It is the automatic, inevitable mathematical consequence of subtracting two electrode potentials that sample a spatially-decaying field on opposite sides of its peak — this is exactly as true of the engine's geometrically-derived fields (`forward.ts`) as it was of the legacy hand-authored `LT_FIELD` / `RT_FIELD` / `LF_FIELD` spike field maps, which still produce phase reversal in `computeChannel.ts` the same way they always did. Any new focal generator, in either layer, must be built the same way: name its spatial field, let `computeChannel.ts` do the subtraction, never touch the sign by hand.

### Principle 5
**A physiological field has spatial continuity.**

Still the rule, but the *mechanism* that guarantees it has changed for the engine layer. Previously this was enforced by hand-checking that a per-electrode gain table traced a plausible decay curve. Now, for every engine-layer source, spatial continuity is guaranteed **by construction**: each source is a dipole on a cortical shell with a Gaussian scalp falloff (`forward.ts`), so gain is a smooth, continuous function of electrode-to-source distance by definition — there is no table to get wrong. See `FieldMaps.md` for the model and how it supersedes the old hand-built tables. The legacy pattern layer's hand-authored focal-spike tables (`LT_FIELD`, `RT_FIELD`, `LF_FIELD`, `PSWY_FIELD`) still exist, are still governed by this principle, and must still be hand-checked for continuity the old way.

### Principle 6
**Technical artifacts do not obey physiological fields.**

The inverse of Principle 5, and equally load-bearing. Now enforced two ways. First, per §8 (`artifacts.ts`), most artifacts (blink, saccade, EMG, ECG, sweat, line noise, movement) are given genuine anatomical source *positions* of their own — eyeballs, temporalis, the heart — placed outside the cortical shell so their scalp fields are shaped like real artifact topographies, not the neural leadfield, while still decaying smoothly from their own source (they have a real physical origin, just not a cortical one). Second, electrode pop (`ElectrodePopGenerator`) has no anatomical source at all and is therefore the one generator that bypasses the leadfield projection entirely, confined to a single channel — the sharp spatial discontinuity is the point, and is exactly how a real reader tells "artifact" from "genuine generator" at a glance. The legacy technical-artifact patterns in `eegGenerator.ts` (50 Hz mains, electrode pop, etc.) are unchanged and must preserve the same discontinuity.

### Principle 7
**Every waveform shown in the simulator must be explainable from Generator → Volume conduction → Electrode potentials → Montage → Displayed trace.**

This is the audit test for any change to the signal engine, and it now covers both layers. Before writing or approving code: name the generator (`GeneratorCatalogue.md`), state its physiological or technical basis, describe how its spatial field is produced — geometrically via the forward model, or by hand-authored table for the legacy focal layer (`FieldMaps.md`) — and confirm the montage math is applied only after electrode potentials (engine output plus any legacy graphoelements) are fully assembled. If any link in that chain can't be named, the code doesn't ship.

## Governance checklist

Before writing or modifying anything in the signal-generation layer:

1. Identify which generator(s) in `GeneratorCatalogue.md` the change belongs to, or define a new catalogue entry with all its required fields. Decide up front which layer it belongs in: a sustained/stochastic background or rhythm belongs in `src/engine`; an event-based clinical graphoelement belongs in `eegGenerator.ts`.
2. State the physiological or technical basis in plain clinical language, before writing formulas. If the briefing document conflicts with a claim already in this document set, the briefing wins — update the docs, don't route around them.
3. If the change is engine-layer: give the source a position, orientation, and extent (`forward.ts`) and let the Gaussian projector produce its field — do not hand-author a gain table for it. If the change is legacy-pattern-layer: add or update its entry in `FieldMaps.md`, confirming the field decays continuously (Principle 5) unless it is explicitly a technical artifact (Principle 6).
4. Confirm the change lives entirely in the generator layer — never in `computeChannel.ts`'s montage math (Principle 3).
5. Check `TeachingConcepts.md` — if the thing being added is actually a modifier, a montage-math effect, or an artifact rather than a generator, it belongs there, not in the catalogue.
6. Run the Principle 7 audit: Generator → Volume conduction → Electrode potentials → Montage → Displayed trace. If any link is missing, the change isn't ready.
