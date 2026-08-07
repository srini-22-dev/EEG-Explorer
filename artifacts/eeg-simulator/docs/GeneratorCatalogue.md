# Generator Catalogue

Part of the governing document set — see [`EEG_ARCHITECTURE.md`](./EEG_ARCHITECTURE.md) for the principles this catalogue implements. **No signal-generation code may exist without a corresponding entry here.** Spatial field numbers are not duplicated in this file — see [`FieldMaps.md`](./FieldMaps.md) for the authoritative gain values referenced below. Whether a listed concept is a true generator, a modifier, a montage-math effect, or a technical artifact is defined in [`TeachingConcepts.md`](./TeachingConcepts.md); this file only lists entries already classified as generators.

Every entry in this catalogue must be a **sum-of-generators** contributor to `getElectrodeVoltage()` (Principle 2) — never a per-electrode-class special case.

## Awake-state generators (current scope)

| Clinical name | Internal code name | Anatomical source | Frequency | Spatial field | Active state | Educational relevance |
|---|---|---|---|---|---|---|
| Posterior Dominant Rhythm (Left) | `pdrLeft` | Left occipital cortex / thalamocortical loop | 8–12 Hz | See `FieldMaps.md`: PDR-Left | Relaxed wakefulness | The single most important normal awake finding |
| Posterior Dominant Rhythm (Right) | `pdrRight` | Right occipital cortex / thalamocortical loop | 8–12 Hz | See `FieldMaps.md`: PDR-Right | Relaxed wakefulness | Normal symmetry range; independent hemispheres, not mirror images |
| Diffuse Cortical Background | `diffuseBackground` | Ongoing, unsynchronized firing under every electrode | Broadband, low amplitude | See `FieldMaps.md`: Diffuse Background (uniform, independent per electrode) | Always | No channel is ever truly flat |
| Myogenic (EMG) | `emgGenerator` | Frontalis / temporalis muscle tone | 20–70+ Hz | See `FieldMaps.md`: EMG | Awake, not fully relaxed | Distinguishing real cortical signal from muscle contamination |
| Posterior Slow Waves of Youth | `pswy` (toggleable pattern) | Same posterior generator region as PDR — thought to reflect immature/less-differentiated thalamocortical circuitry | 2.5–4.5 Hz | See `FieldMaps.md`: PSWY (same as PDR) | Awake, admixed with PDR — most common in children/young adults | Recognizing a benign, intermittent high-amplitude posterior slow-wave admixture as normal, not pathological slowing |
| *(existing)* Corneo-retinal / Eye Blink | `blinkArtifact` | Corneal(+)–retinal(−) dipole | Transient | Frontal-dominant | On blink (toggle) | Artifact recognition |
| *(existing)* Electrode/technical artifacts | `electrodeArtifact`, `muscleArtifact`, `powerlineArtifact`, etc. | None — recording/hardware phenomena | Varies | Localized, spatially discontinuous (Principle 6) | Toggled | "Not everything on the screen is the brain" |

`emgGenerator` and `pswy` are now implemented (as of the EMG/fragmentation-refinement stage). Rows for eye blink/technical artifacts already exist in the pattern library; listed here only so the catalogue is complete — no changes proposed to them by this document.

## Full definitions

Each generator's definition has three required parts:

- **Source** — where it is generated anatomically.
- **Propagation** — how it spreads by volume conduction; which electrodes receive the strongest signal; how amplitude decays spatially (exact numbers live in `FieldMaps.md`).
- **Modifiers** — what changes it physiologically (vigilance, sleep stage, muscle tension, eye movement, etc.). Modifiers are never generators themselves — see `TeachingConcepts.md`.

### Posterior Dominant Rhythm (Left) — `pdrLeft`
- **Source**: the left hemisphere's thalamocortical loop — anatomically distinct from the right hemisphere's loop, weakly coupled via the corpus callosum. Carries weak sub-/supra-harmonic overtones (the "slow alpha variant" ~half frequency and "fast alpha variant" ~double frequency described in `TeachingConcepts.md`) — a characteristic of this one generator, not a separate rhythm.
- **Propagation**: volume-conducted with distance-dependent attenuation along the parieto-occipital scalp — strongest at O1, attenuating through P3, weaker still at T5, negligible frontally. Exact gains: `FieldMaps.md`.
- **Modifiers**: vigilance/arousal modulation (see "Vigilance/Arousal Modulation" in `TeachingConcepts.md`) — implemented as two stochastic timescales of the same idea (a slow walk for the macro run/pause/dropout structure, a faster walk for "slightly weaken, recover" texture within a run) plus a slow instantaneous-frequency drift, not three separate mechanisms; a small **fixed**, session-persistent resonant-frequency and gain offset (stable individual/anatomical asymmetry, assigned once, not re-rolled moment to moment).

### Posterior Dominant Rhythm (Right) — `pdrRight`
- **Source**: the right hemisphere's thalamocortical loop, independent of `pdrLeft`. Same sub-/supra-harmonic characteristic as `pdrLeft`.
- **Propagation**: mirror of `pdrLeft` — strongest at O2, attenuating through P4, weaker at T6, negligible frontally.
- **Modifiers**: same categories as `pdrLeft`, with its own independent vigilance-modulation trajectories (both timescales) and its own fixed frequency/gain offset — the two hemispheres must never share a single underlying generator instance.

### Diffuse Cortical Background — `diffuseBackground`
- **Source**: many small, spatially unsynchronized cortical populations — not one shared generator.
- **Propagation**: negligible spread between electrodes; modeled independently per electrode. This is the one generator in the catalogue where per-electrode independence is physiologically correct rather than a modeling shortcut, because there is no single shared source to volume-conduct from.
- **Modifiers**: none significant at the awake-background level — patient-state changes (drowsy, N1, N2, N3) are handled by their own existing branches in `eegGenerator.ts`, untouched by this catalogue entry.

### Myogenic (EMG) — `emgGenerator`
- **Source**: frontalis and temporalis muscle tone.
- **Propagation**: falls off sharply with distance from those muscles — strong frontal/temporal, weaker central, negligible occipital (muscle-to-electrode distance governs this, not cortical distance).
- **Modifiers**: degree of relaxation/tension — currently represented as a fixed low-level baseline (an awake-but-resting patient), not a separate user-facing control. Deliberately modeled as unsmoothed per-sample noise rather than a leaky-integrator process, because real EMG's genuinely broadband, high-frequency character is the simpler and more correct match — smoothing it would make it *less* physiologically accurate, not more.

### Posterior Slow Waves of Youth — `pswy` (toggleable pattern)
- **Source**: the same posterior region as PDR; the mechanism is thought to relate to less mature thalamocortical circuitry rather than a distinct generator.
- **Propagation**: same posterior field as PDR (`FieldMaps.md`) — occipital/parietal, bilateral.
- **Modifiers**: only appears intermixed with PDR in the awake state, as intermittent brief high-amplitude bursts, not as its own sustained rhythm — implemented as a normal-variant toggle (like mu rhythm, wicket spikes) rather than an always-on background generator, since real PSWY is occasional, not continuous.

## Minimum physiology model

The goal is not mathematical realism for its own sake — it's the smallest set of generators and mechanisms that produces a trace an experienced EEG reader immediately recognizes as physiologically believable, while remaining maintainable and explainable. For the awake background, that minimum is the **five generators above plus PDR's vigilance/arousal modifier** (defined in `TeachingConcepts.md`).

Candidates considered and deliberately excluded from the minimum model:

- **Ocular microtremor / microsaccade micro-transients** — physiologically real, but too subtle to justify inclusion in a *minimum* teaching model; the closest candidate to "inventing a mechanism to justify randomness," so left out.
- **Cascaded multi-timescale noise for `diffuseBackground`** — collapsed into a single leaky-integrator process. One noise process is enough to stop a channel from looking flat; multiple noise timescales there was solving a spectral-realism problem nobody asked to see modeled. (This is distinct from PDR's two-timescale vigilance modifier below — that addition targets a specific, named, requested refinement of an already-approved modifier, not a reintroduction of the excluded cascade idea.)
- **Eyes-open/closed reactivity toggle** — a genuinely important teaching concept (PDR attenuation on eye opening), but requires a new UI control/patient-state concept that is out of scope for the current catalogue. A good candidate for its own future catalogue entry, not bundled in here.
- **Persistent asymmetry as its own generator** — folded into `pdrLeft`/`pdrRight`'s fixed parameters rather than kept as a separate mechanism, since it isn't a source of voltage by itself, just a property of an existing one.

New generators may be proposed later, but each addition must justify itself against this minimum-model discipline, not just against "would this look more realistic."
