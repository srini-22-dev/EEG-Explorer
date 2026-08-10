# Generator Catalogue

Part of the governing document set — see [`EEG_ARCHITECTURE.md`](./EEG_ARCHITECTURE.md) for the principles this catalogue implements. **No signal-generation code may exist without a corresponding entry here.** Spatial field details are not duplicated in this file — see [`FieldMaps.md`](./FieldMaps.md) for how each generator's field is produced. Whether a listed concept is a true generator, a modifier, a montage-math effect, or a technical artifact is defined in [`TeachingConcepts.md`](./TeachingConcepts.md); this file only lists entries already classified as generators.

As of the engine rewrite (see `EEG_ARCHITECTURE.md`, "Two generator layers"), entries below are split into the **streaming engine** (`src/engine/`) — the sustained background and rhythms — and the **legacy pattern layer** (`eegGenerator.ts`) — event-based toggleable graphoelements. Every entry in both layers must still be a **sum-of-generators** contributor to the electrode potential (Principle 2), never a per-electrode-class special case.

## Streaming engine generators (current scope)

These generators supersede the old sinusoid-based awake-state background entries further below. Frequencies quoted are centre frequencies of noise-driven processes, not fixed tones — see `EEG_ARCHITECTURE.md` Principle 1 and the source files for the underlying stochastic model.

| Clinical name | Internal code / file | Anatomical source | Frequency | Spatial field | Active state | Educational relevance |
|---|---|---|---|---|---|---|
| Aperiodic (1/f) Background | `AperiodicSource`, `aperiodic.ts`, ~16 patches via `backgroundPatches()` | Distributed cortical patches (superposed OU processes), not one shared generator | Broadband, 1/f^χ, χ ≈1.0–1.8 awake, 2–3 NREM/anaesthesia | See `FieldMaps.md`: geometric, forward model | Always | The dominant component of scalp EEG variance — not filler under the rhythms |
| Posterior Dominant Rhythm (Left/Right) | `HopfOscillator` seeded `pdrL`/`pdrR`, `oscillator.ts` | Left/right occipito-parietal cortex, independent hemispheres | ~8–12 Hz (subject's IAF ± hemisphere offset) | See `FieldMaps.md`: geometric, radial dipole under O1/P3 (O2/P4) | Relaxed wakefulness (vigilance-gated) | The single most important normal awake finding; noise-sustained damped oscillator, not a metronome |
| Mu Rhythm (Left/Right) | `HopfOscillator` seeded `muL`/`muR`, `MU_WARP` | Sensorimotor cortex, sulcal (tangential dipole) | ~IAF + 0.4 Hz | See `FieldMaps.md`: geometric, tangential dipole under C3/C4 | Relaxed wakefulness | Arciform shape from phase-warping; distinguishing mu from posterior alpha |
| Sensorimotor / Frontal Beta | `BurstyOscillator` seeded `betaL`/`betaR`/`betaF`, `bursts.ts` | Bilateral sensorimotor and frontal cortex | ~20 Hz centre, burst process | See `FieldMaps.md`: geometric, radial dipole under C3/C4/Fz+F3+F4 | Always (burst renewal, not sustained) | Beta is a train of transients, not a continuous rhythm — averaging bursts is what makes "sustained beta power" an analysis artifact |
| Frontal Midline Theta | `BurstyOscillator` seeded `thetaFm`, `bursts.ts` | Anterior midline/frontal cortex | ~6 Hz centre, burst process | See `FieldMaps.md`: geometric, radial dipole under Fz | Task-locked, bursty | Same burst-process reasoning as beta; frontal theta is not a sustained rhythm either |
| Diffuse Theta | `HopfOscillator` seeded `thetaDiffuse`, `oscillator.ts` | Broad central/parietal cortex | ~5.4 Hz | See `FieldMaps.md`: geometric, radial dipole under Cz/Pz | Drowsy and sleep states (state-gated) | Background theta contribution distinct from the bursty frontal-midline generator |
| Delta (Frontal / Central) | `HopfOscillator` seeded `deltaF`/`deltaC`, `SLOW_WAVE_WARP` | Frontal pole and central cortex — UP/DOWN state alternation, not a sinusoidal oscillation | ~1.1 Hz | See `FieldMaps.md`: geometric, radial dipole under Fz+Fp1+Fp2 / Cz+C3+C4 | N2/N3 sleep (state-gated; near-zero awake) | Non-sinusoidal shape (steep descent into DOWN state) via phase warping is deliberate, not a simplification left for later |
| Ocular (blink, saccade) | `BlinkGenerator`, `SaccadeGenerator`, `artifacts.ts` | Corneo-retinal dipole (blink), lateral gaze dipole (saccade) — own topography, not cortical | Transient (~0.2–0.4 s blink), broadband spike at saccade onset | See `FieldMaps.md`: geometric, own artifact source position | Vigilance-gated rate | Artifact recognition; the saccade's ~20 ms onset spike is a major contaminant of apparent scalp gamma |
| Myogenic (EMG) | `EmgGenerator`, `artifacts.ts` | Frontalis / temporalis muscle tone — own topography | Shot noise, broadband, heavy-tailed | See `FieldMaps.md`: geometric, own artifact source position | Vigilance-gated | Distinguishing real cortical signal from muscle contamination; modeled as summed motor-unit action potentials (non-Gaussian), not scaled noise |
| Cardiac (ECG) | `EcgGenerator`, `artifacts.ts` | Heart, far outside the head — own broad, shallow topography | ~68 bpm, heart-rate-variable | See `FieldMaps.md`: geometric, own artifact source position | Always | ECG contamination recognition |
| Electrode pop | `ElectrodePopGenerator`, `artifacts.ts` | None — hardware phenomenon | Step + exponential decay | Confined to one channel; leadfield bypassed entirely (Principle 6) | Occasional (renewal process) | "Not everything on the screen is the brain" |
| Sweat | `SweatGenerator`, `artifacts.ts` | Frontal sweat gland activity — own topography | <0.5 Hz random walk | See `FieldMaps.md`: geometric, own artifact source position | Always | Very-low-frequency drift recognition |
| Mains (line noise) | `LineNoiseGenerator`, `artifacts.ts` | None — environmental/hardware | ~50/60 Hz, wandering, harmonic | Uniform per channel via recording chain gain (`chain.ts`) | Toggled / subject-sampled | Not a perfect sinusoid — wandering frequency and amplitude are the realistic tell |
| Movement | `MovementGenerator`, `artifacts.ts` | None — mechanical | Broadband transient | Applied at eye-region sources; large, rare | Occasional (renewal process) | Rare, very large, multi-channel transients |
| Instrument (sensor) noise | `RecordingChain`, `chain.ts` | None — amplifier/electrode-interface noise floor | Broadband, white | **Independent per channel** — the one place per-electrode independence is correct (see "A note on `diffuseBackground`" below) | Always | The noise floor every real recording has, that the neural background is not |

## A note on `diffuseBackground` (superseded — read before touching background code)

Earlier versions of this catalogue modeled the background as `diffuseBackground`: a single low-amplitude generator computed **independently per electrode**, and this document called that "physiologically correct rather than a modeling shortcut." **That claim is rejected and reversed.** Neural background is cortical activity seen through volume conduction like every other generator in this catalogue — it is not exempt from Principle 2. Generating it independently per electrode destroys the near-zero-lag correlation volume conduction creates between neighbouring electrodes, and makes downstream analyses that rely on that correlation (ICA, source localisation) look implausibly good, which is a teaching liability, not a simplification.

The background is now generated as **~16 broad, independent cortical patches** (`backgroundPatches()` in `forward.ts`) spread over the upper hemisphere, each driven by its own `AperiodicSource` instance, and projected through the shared leadfield with every other source. Neighbouring electrodes see genuinely overlapping mixtures of the same patches, exactly as real volume conduction produces — the correlation structure is now a *consequence* of shared geometry, not asserted away.

**Per-electrode independence is correct for exactly one thing in this catalogue: instrument (sensor) noise**, listed in the table above. Sensor/amplifier noise genuinely originates at each electrode's own hardware interface, with no shared anatomical source and no volume conduction between channels — that is precisely why it is generated as `nChannels` independent `Gaussian` instances in `RecordingChain` (`chain.ts`), *after* the leadfield projection, not as a cortical source going through it. The two are easy to conflate because both are broadband and low-amplitude; the test for which category something belongs in is whether it has a shared anatomical source that volume conduction would smear across neighbours (neural → correlated) or not (instrument → independent).

## Legacy pattern-layer generators (event-based, unaffected by the rewrite)

These live in `eegGenerator.ts`, are exposed via `getPatternVoltage()`, and are toggled through the `activePatterns` set defined in `patterns.ts`. They are event-triggered graphoelements — spikes, complexes, bursts, transients — not sustained rhythms, so the background rewrite does not touch their reasoning; they simply now ride on top of the engine's output additively (`engine/adapter.ts`) instead of on top of the old sinusoidal background.

| Category (`patterns.ts`) | Examples | Notes |
|---|---|---|
| Sleep Architecture | POSTS, Vertex Waves, K-Complex, Spindles | Event-triggered graphoelements, state-gated |
| Normal Variants | Mu Rhythm (legacy toggle), Wicket Spikes, RMTD, Lambda Waves, PSWY, 6 Hz Phantom Spike-Wave, 14 & 6 Hz Positive Bursts, BETS | `pswy` retains its own hand-authored field map, `PSWY_FIELD` — see `FieldMaps.md` |
| Artifacts (legacy toggles) | Eye Blink, Lateral Eye Movement, Muscle (EMG), Chewing, Electrode Pop, Sweat, 50 Hz Mains | Distinct from, and layered on top of, the engine's own continuous artifact generators in the table above — these are the discrete, user-toggleable versions used for teaching artifact recognition on demand |
| Non-Epileptiform Abnormalities | Generalised Slowing, Focal Delta, FIRDA, Triphasic Waves, GPEDs, LPEDs | Unaffected |
| Interictal Epileptiform | L/R Temporal Spikes, L Frontal Spikes, 3 Hz Gen. Spike-Wave, Polyspike-Wave, Burst Suppression, Hypsarrhythmia | Use the hand-authored `LT_FIELD`/`RT_FIELD`/`LF_FIELD` spike field maps — see `FieldMaps.md` |
| Ictal / Seizures | Absence, GTC, Focal Temporal, Focal Frontal | Unaffected |

**Note:** the mu rhythm, PDR, and beta *toggle patterns* in the legacy layer are distinct from the engine's own sustained mu/alpha/beta generators in the table above — the legacy toggles exist for on-demand teaching emphasis (e.g. "show mu rhythm attenuation on command"), layered additively on top of the engine's always-on stochastic version of the same rhythm, not a replacement for it.

## Full definitions — streaming engine

- **Source** — where the generator sits: a dipole position, orientation, and extent on the cortical shell (`forward.ts`), or an artifact source position (`artifacts.ts`).
- **Propagation** — the Gaussian scalp-falloff projection through the shared leadfield (`FieldMaps.md`).
- **Modifiers** — vigilance state (`state.ts`) and clinical/patient state (`STATE_GAINS` in `engine.ts`), which jointly gate each band's amplitude; per-subject sampled parameters (`sampleSubject` in `engine.ts`) set individual alpha frequency, aperiodic exponent, RMS levels, smearing, and artifact burden once per simulated subject.

See `aperiodic.ts`, `oscillator.ts`, `bursts.ts`, `forward.ts`, `artifacts.ts`, `state.ts`, `chain.ts`, and `engine.ts` for the full implementation — each file's header comment is the authoritative explanation of its generator's physiological rationale.

## Full definitions — legacy pattern layer

Unchanged from before the rewrite: each pattern's definition still has **Source**, **Propagation** (via its hand-authored field map, `FieldMaps.md`), and **Modifiers** (patient state, active-pattern toggles). See `eegGenerator.ts` for the per-pattern implementation.

## Minimum physiology model

The goal is not mathematical realism for its own sake — it's the smallest set of generators and mechanisms that produces a trace an experienced EEG reader immediately recognizes as physiologically believable, while remaining maintainable and explainable. That minimum is now the streaming engine's source set (aperiodic background, alpha/mu/beta/theta/delta rhythms, vigilance gating, artifacts with their own topographies, and the recording chain) plus the legacy event-based graphoelements layered on top for clinical teaching scenarios.

New engine-layer generators must justify their source geometry (position, orientation, extent) against `forward.ts`'s model rather than hand-authoring a field map; new legacy-layer patterns must still justify themselves against this minimum-model discipline, not just against "would this look more realistic."
