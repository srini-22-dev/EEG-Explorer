# EEG Architecture

**This document, together with `GeneratorCatalogue.md`, `FieldMaps.md`, and `TeachingConcepts.md` in this same folder, is the governing document set for the EEG Explorer signal-generation engine. Every change to `eegGenerator.ts`, `computeChannel.ts`, or any montage/field/generator logic must follow them. No exceptions.**

If a proposed change can't be justified against these four documents, it doesn't belong in the simulator, no matter how good it looks on screen.

## Why this exists

This project has already fallen into the same failure mode more than once: writing math that makes the trace *look* more realistic, then retrofitting a physiological explanation for it afterward. That order is backwards and produces a simulator that teaches nothing, or teaches something wrong. This document set fixes the order: physiology first, mathematics as its consequence.

## The governing document set

| Document | Governs |
|---|---|
| **EEG_ARCHITECTURE.md** (this file) | The seven architectural principles and the generator→display pipeline. Read this first. |
| [`GeneratorCatalogue.md`](./GeneratorCatalogue.md) | The authoritative list of every voltage-producing generator in the simulator — clinical name, anatomical source, frequency, active state, Source/Propagation/Modifiers — and the minimum-physiology-model scope. |
| [`FieldMaps.md`](./FieldMaps.md) | The authoritative numeric spatial field (per-electrode gain) for every generator, and the rules for constructing a new one. |
| [`TeachingConcepts.md`](./TeachingConcepts.md) | The clinical-terminology layer and the concept map separating true generators from montage math, modifiers, and technical artifacts. |

## The pipeline

```
Generator (cortical / muscular / ocular / technical source)
        ↓
Volume conduction (spatial field)
        ↓
Electrode potentials (Fp1, F3, C3, P3, O1, ...)
        ↓
Montage computation (bipolar / referential)
        ↓
Displayed EEG
```

Electrode potentials and montage computation are separate, ordered stages in the codebase — `getElectrodeVoltage()` computes each electrode individually; `computeChannel.ts` performs bipolar subtraction or referential averaging strictly afterward. The montage layer is purely mathematical and must never contain physiology; all physiology lives in the generator layer.

## The Seven Principles

### Principle 1
**EEG records voltage differences, not neuronal firing.**

The simulator never models "neurons firing." It models continuous voltage-generating processes (thalamocortical synchrony, muscle tone, ocular dipoles, technical artifacts) whose *summed field* is what an electrode sees. Even patterns that look like discrete events on the trace — spikes, K-complexes, sharp transients — are modeled as voltage waveforms produced by a named generator, never as a simulated action potential or a bare random event with no physiological identity. "Add a random blip for realism" is rejected on sight: a blip needs a generator (see `GeneratorCatalogue.md`), not just a justification.

### Principle 2
**Electrodes record mixtures of generators.**

`getElectrodeVoltage(electrode, t, settings)` must be a **sum of contributions from every named generator that physically reaches that electrode** — never a special-cased formula keyed off the electrode's identity or region (e.g. "if this electrode is frontal, add a small sine"). Region-specific behavior must emerge from a generator's spatial field (`FieldMaps.md`) being evaluated at that electrode's position, not from hand-branching on the electrode's name.

### Principle 3
**Changing montage never changes brain activity. Only the mathematical comparison changes.**

Electrode potentials and montage computation are strictly separate stages, and information must never flow backward from the second into the first. Switching from bipolar to common-average reference must never alter a single generator's amplitude, timing, or behavior — it only changes which subtraction or averaging is applied to the same underlying electrode potentials. If a montage switch ever appears to need different generator behavior, that's a bug in the generator layer, not a case to special-case in the montage layer.

### Principle 4
**Phase reversal is produced by bipolar subtraction.**

Phase reversal is never hand-scripted ("flip the sign for this channel because it's near the focus"). It is the automatic, inevitable mathematical consequence of subtracting two electrode potentials that sample a spatially-decaying field on opposite sides of its peak. If a focal generator's spatial field is defined correctly (Principle 5, `FieldMaps.md`), the montage math in `computeChannel.ts` produces correct phase reversal on its own — this is what the existing `LT_FIELD` / `RT_FIELD` / `LF_FIELD` spike field maps already do correctly, and any new focal generator must be built the same way.

### Principle 5
**A physiological field has spatial continuity.**

A real generator's contribution changes smoothly across neighboring electrodes — an electrode's gain from a given generator should sit between its anatomical neighbors' gains, not jump arbitrarily. This is what makes a spatial field map *physiological* rather than an arbitrary per-electrode lookup table: the numbers should trace a plausible decay curve from the anatomical source outward. See `FieldMaps.md` for the concrete rule and values.

### Principle 6
**Technical artifacts do not obey physiological fields.**

The inverse of Principle 5 is equally load-bearing and is itself a teaching point: a single popped electrode, a loose lead, or 50/60 Hz mains pickup shows up sharply confined to one electrode/channel, spatially discontinuous from its neighbors — because it has no anatomical source to decay smoothly from. This discontinuity is precisely how a real reader tells "artifact" from "genuine generator" at a glance, and the simulator's technical-artifact generators must preserve that discontinuity rather than smoothing it away for the sake of a cleaner-looking field.

### Principle 7
**Every waveform shown in the simulator must be explainable from Generator → Volume conduction → Electrode potentials → Montage → Displayed trace.**

This is the audit test for any change to the signal engine. Before writing or approving code: name the generator (`GeneratorCatalogue.md`), state its physiological or technical basis, describe its spatial field (`FieldMaps.md`), and confirm the montage math is applied only after electrode potentials are assembled. If any link in that chain can't be named, the code doesn't ship.

## Governance checklist

Before writing or modifying anything in the signal-generation layer:

1. Identify which generator(s) in `GeneratorCatalogue.md` the change belongs to, or define a new catalogue entry with all its required fields.
2. State the physiological or technical basis in plain clinical language, before writing formulas.
3. Add or update the generator's entry in `FieldMaps.md`, confirming the field decays continuously (Principle 5) unless it is explicitly a technical artifact (Principle 6).
4. Confirm the change lives entirely in the generator layer — never in `computeChannel.ts`'s montage math (Principle 3).
5. Check `TeachingConcepts.md` — if the thing being added is actually a modifier, a montage-math effect, or an artifact rather than a generator, it belongs there, not in the catalogue.
6. Run the Principle 7 audit: Generator → Volume conduction → Electrode potentials → Montage → Displayed trace. If any link is missing, the change isn't ready.
