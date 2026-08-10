# Teaching Concepts

Part of the governing document set — see [`EEG_ARCHITECTURE.md`](./EEG_ARCHITECTURE.md) for the underlying principles and [`GeneratorCatalogue.md`](./GeneratorCatalogue.md) for the generators referenced below. This document defines the **clinical-terminology layer** and separates true generators from concepts that only look like generators.

**Note on the engine rewrite:** the mechanisms behind several rows below changed with the move to the streaming engine (`src/engine/`, see `EEG_ARCHITECTURE.md`). The *clinical classification* of each concept (generator / modifier / montage math / technical artifact) is unaffected — only the internal mechanism producing it changed. This revision updates the mechanism descriptions; nothing here reclassifies a concept.

## Clinical terminology first

The simulator teaches the language used in EEG practice. Any learner-facing text, label, or explanation must use the term a neurologist would teach a resident — e.g. **"Posterior Dominant Rhythm"**, not "Left Occipital Alpha Generator." Internal code names (`pdrLeft`, `emgGenerator`, etc.) are implementation detail and must never leak into anything a student reads. Some of these internal names are themselves now legacy — the engine (`src/engine/oscillator.ts`, `artifacts.ts`) refers to the same clinical concepts by different internal identifiers (e.g. `pdrL`/`pdrR`, `EmgGenerator`) — but the clinical name a student sees is unchanged either way.

## Concept map: generator vs. not

Many EEG teaching concepts are **not** generators — they're montage mathematics, generator parameters, or non-physiological artifacts. Conflating these categories is exactly how physiology-free math ends up disguised as a feature, so every concept added to the simulator must be classified here before it's coded.

| Teaching concept | Classification | Explanation |
|---|---|---|
| Posterior Dominant Rhythm | **Generator** | Noise-driven Hopf oscillator, `oscillator.ts` (engine); see `GeneratorCatalogue.md` |
| Alpha blocking / fragmentation | **Modifier**, not a generator | Global vigilance-state modulation (`state.ts`) acting on every rhythm's gain, PDR included — see "Vigilance/Arousal Modulation" below |
| Phase reversal | **Montage mathematics**, not physiology | Bipolar subtraction sign-flip near a source — belongs entirely in `computeChannel.ts`, never in a generator (Principle 4). Unchanged by the engine rewrite — see `FieldMaps.md` |
| Eye blink | **Generator** | Corneo-retinal dipole; engine's always-on `BlinkGenerator` (`artifacts.ts`) plus a separate on-demand legacy toggle in `eegGenerator.ts` (`GeneratorCatalogue.md`) |
| Electrode pop / movement artifact | **Technical artifact**, non-physiological | Recording/hardware phenomenon, not a biological source (Principle 6). Bypasses the leadfield entirely in the engine (`ElectrodePopGenerator`) |
| EMG | **Generator** | Shot noise from summed motor-unit action potentials (`EmgGenerator`, `artifacts.ts`) — deliberately non-Gaussian, not scaled noise (see `GeneratorCatalogue.md`) |
| Normal L/R amplitude asymmetry | **Generator parameter**, not a mechanism | A fixed per-hemisphere frequency offset (`hemisphereOffset`, a 0.25 Hz constant) and a fixed 0.92 gain ratio applied to the right-hemisphere oscillator, layered on top of the subject's individually-sampled alpha frequency and amplitude (`sampleSubject`) — not re-rolled moment to moment |
| Diffuse beta activity | **Not a dedicated generator** | A mix of the aperiodic background and the muscle (EMG) generator — deliberately not modeled as its own source, to avoid double-counting the same physiology under two names |
| Instrument (sensor) noise | **Not a generator; recording-chain artifact** | Per-channel amplifier/electrode-interface noise floor (`RecordingChain`, `chain.ts`) — the one place per-electrode independence is physiologically correct, precisely *because* it has no shared anatomical source (see `GeneratorCatalogue.md`, "A note on `diffuseBackground`") |
| Bad channels (noisy / flat / intermittent) | **Technical artifact** | Per-channel defect sampled once per subject (`sampleDefects`, `chain.ts`) — teaches that real datasets always contain a few imperfect channels |
| Waveform shape / harmonics | **Generator characteristic**, not a separate generator | Produced by phase-warping the oscillator's output (`oscillator.ts`, §5), not by summing extra tones. Currently applied to mu rhythm (arciform, `MU_WARP`) and slow-wave/delta (steep DOWN-state descent, `SLOW_WAVE_WARP`); the posterior alpha (PDR) oscillators currently run unwarped. A prior claim that PDR itself carries built-in sub-/supra-harmonic "slow/fast alpha variant" overtones described the old sum-of-tones implementation and is no longer how the engine produces alpha — treat sub-/fast alpha variant as a real clinical concept worth teaching, but not, currently, an engine-generated characteristic of the PDR generator |
| Posterior Slow Waves of Youth | **Generator** (toggleable normal-variant pattern, legacy layer) | `pswy` in `eegGenerator.ts` — same posterior source region as PDR, admixed with it intermittently, not continuous. Unaffected by the engine rewrite (`GeneratorCatalogue.md`) |
| Photic driving response | **Out of current scope** | Would be a real modifier (occipital generator entrainment to a flash stimulus) if a photic-stimulation control is ever added — noted here only for future extensibility |

## Vigilance/Arousal Modulation

**This section describes the current, post-rewrite mechanism.** Alpha waxing, waning, fragmentation, momentary dropout, and drift are still represented as stochastic modulation, but the architecture is now two layered pieces instead of one PDR-specific one:

1. **A single global latent vigilance state** (`VigilanceState`, `state.ts`, briefing §6): one variable in [0,1] (0 = drowsy, 1 = alert), driven by a slow long-memory drift process, that sets the gain on *every* band together — alpha, beta, theta, delta, EMG, and ocular-artifact rate — so the whole recording drifts coherently, rather than each component wandering on its own unrelated timescale. This is deliberately shared across both hemispheres: vigilance is a global brain state, and §6 is explicit that non-stationarity over the whole record — not just within one rhythm — is what "alone makes long records look far more authentic."
2. **Per-instance envelope and frequency modulation**, independent for every oscillator instance (including `pdrL` vs `pdrR` separately): each `HopfOscillator` carries its own long-range-correlated envelope modulator and its own OU frequency-wander process, seeded independently. This is what still produces the finer "slightly weaken, recover" texture and the imperfect run-to-run synchrony between O1 and O2 — the two hemispheres share the coarse vigilance-driven gain (piece 1) but never share the fine-grained noise realization that shapes any single waxing-waning cycle (piece 2).

**This is still an explicit simulator-level simplification, and must always be presented as one.** Real alpha fragmentation arises from several interacting processes — attention, arousal, subcortical gating, corticocortical feedback — not one biological switch, and not a small fixed number of variables either. Collapsing their combined net effect into one global latent state plus per-oscillator noise is a deliberate simplification made for tractability and for coherent-looking long recordings. Never describe it to a learner as if a literal "vigilance nucleus" or single anatomical switch exists — if asked, the honest answer is that the simulator collapses several real, interacting mechanisms into a small number of variables.

This replaces the earlier architecture, in which vigilance modulation was implemented as three timescales acting only on the PDR generators specifically, independently seeded per hemisphere. That mechanism is gone; the *reason* hemispheric independence still matters (real O1/O2 asynchrony) is unchanged, and is now supplied by piece 2 above rather than by a PDR-specific modulator.

## How to classify a new concept

Before adding anything to the simulator, ask:

1. **Does it produce voltage on its own, from a named anatomical or technical source?** → It's a generator; add it to `GeneratorCatalogue.md` and, if it needs a hand-authored field (legacy pattern layer only), `FieldMaps.md`. If it belongs in the streaming engine, give it a position/orientation/extent in `forward.ts` instead of a table.
2. **Does it only change how an existing generator behaves (amplitude, frequency, on/off state)?** → It's a modifier; document it under the generator(s) it modifies, and if it's a simplification of multiple real mechanisms, say so explicitly, as above.
3. **Does it only appear as a consequence of subtracting or averaging electrode potentials?** → It's montage mathematics; it belongs in `computeChannel.ts` and must never be given its own generator entry.
4. **Does it have no anatomical source at all (hardware/electrode/environment)?** → It's a technical artifact; its field must be spatially discontinuous (Principle 6) — either a near-single-electrode legacy table, or (engine layer) bypass the leadfield projection entirely, as electrode pop does.

If a concept doesn't clearly fit one category, it isn't ready to be coded yet — surface the ambiguity before writing any formulas.
