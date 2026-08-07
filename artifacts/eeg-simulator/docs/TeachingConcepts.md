# Teaching Concepts

Part of the governing document set — see [`EEG_ARCHITECTURE.md`](./EEG_ARCHITECTURE.md) for the underlying principles and [`GeneratorCatalogue.md`](./GeneratorCatalogue.md) for the generators referenced below. This document defines the **clinical-terminology layer** and separates true generators from concepts that only look like generators.

## Clinical terminology first

The simulator teaches the language used in EEG practice. Any learner-facing text, label, or explanation must use the term a neurologist would teach a resident — e.g. **"Posterior Dominant Rhythm"**, not "Left Occipital Alpha Generator." Internal code names (`pdrLeft`, `emgGenerator`, etc., defined in `GeneratorCatalogue.md`) are implementation detail and must never leak into anything a student reads.

## Concept map: generator vs. not

Many EEG teaching concepts are **not** generators — they're montage mathematics, generator parameters, or non-physiological artifacts. Conflating these categories is exactly how physiology-free math ends up disguised as a feature, so every concept added to the simulator must be classified here before it's coded.

| Teaching concept | Classification | Explanation |
|---|---|---|
| Posterior Dominant Rhythm | **Generator** | `pdrLeft` + `pdrRight` (see `GeneratorCatalogue.md`) |
| Alpha blocking / fragmentation | **Modifier**, not a generator | Vigilance/arousal modulation acting on the PDR generators (below) |
| Phase reversal | **Montage mathematics**, not physiology | Bipolar subtraction sign-flip near a source — belongs entirely in `computeChannel.ts`, never in a generator (Principle 4) |
| Eye blink | **Generator** (existing) | Corneo-retinal dipole (`blinkArtifact`) |
| Electrode pop / movement artifact | **Technical artifact**, non-physiological | Recording/hardware phenomenon, not a biological source (Principle 6) |
| EMG | **Generator** | Myogenic (`emgGenerator`) |
| Normal L/R amplitude asymmetry | **Generator parameter**, not a mechanism | Fixed per-hemisphere gain/frequency offset on the PDR generators, not a separate source |
| Diffuse beta activity | **Not a dedicated generator** | A mix of `diffuseBackground` + `emgGenerator` — deliberately not modeled as its own source, to avoid double-counting the same physiology under two names |
| Alpha harmonics (slow/fast alpha variant) | **Generator characteristic**, not a separate generator | Weak sub-/supra-harmonic overtones of `pdrLeft`/`pdrRight`'s own carrier — the same nonlinear thalamocortical generator, not an independent rhythm |
| Posterior Slow Waves of Youth | **Generator** (toggleable normal-variant pattern) | `pswy` — same posterior source region as PDR, admixed with it intermittently, not continuous |
| Photic driving response | **Out of current scope** | Would be a real modifier (occipital generator entrainment to a flash stimulus) if a photic-stimulation control is ever added — noted here only for future extensibility |

## Vigilance/Arousal Modulation

Alpha waxing, waning, fragmentation, momentary dropout, and instantaneous-frequency drift are represented as stochastic modulating variables per hemisphere, acting on `pdrLeft`/`pdrRight`. Implemented as three timescales of the *same* idea, not three mechanisms: a slow random walk sets the macro run/pause/dropout structure, a faster random walk adds a "slightly weaken, recover" ripple within a run, and a third slow walk lets the instantaneous frequency drift a little as synchrony fluctuates ("shift frequency" during fragmentation).

**This is an explicit simulator-level simplification, and must always be presented as one.** Real alpha fragmentation arises from several interacting processes — attention, arousal, subcortical gating, corticocortical feedback — not one biological switch, and not a small fixed number of timescales either. Representing their combined net effect as a handful of stochastic modulating variables per hemisphere is a deliberate simplification made for maintainability. Never describe it to a learner as if a literal "vigilance nucleus" or single anatomical switch exists — if asked, the honest answer is that the simulator collapses several real, interacting mechanisms into a small number of variables for tractability.

This is also why the two hemispheres' vigilance modulation must be independently seeded rather than sharing one value (`GeneratorCatalogue.md`, `pdrLeft`/`pdrRight` modifiers): real vigilance is a somewhat global brain state, but the two hemispheres' thalamocortical loops are not so tightly coupled that they fragment in lockstep — independence here is what produces the normal "imperfect synchrony" a real reader expects to see between O1 and O2.

## How to classify a new concept

Before adding anything to the simulator, ask:

1. **Does it produce voltage on its own, from a named anatomical or technical source?** → It's a generator; add it to `GeneratorCatalogue.md` and `FieldMaps.md`.
2. **Does it only change how an existing generator behaves (amplitude, frequency, on/off state)?** → It's a modifier; document it under the generator(s) it modifies, and if it's a simplification of multiple real mechanisms, say so explicitly, as above.
3. **Does it only appear as a consequence of subtracting or averaging electrode potentials?** → It's montage mathematics; it belongs in `computeChannel.ts` and must never be given its own generator entry.
4. **Does it have no anatomical source at all (hardware/electrode/environment)?** → It's a technical artifact; its field map must be spatially discontinuous (Principle 6), never smoothed to look physiological.

If a concept doesn't clearly fit one category, it isn't ready to be coded yet — surface the ambiguity before writing any formulas.
