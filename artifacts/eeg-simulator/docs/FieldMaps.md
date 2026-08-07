# Field Maps

Part of the governing document set — see [`EEG_ARCHITECTURE.md`](./EEG_ARCHITECTURE.md) for Principles 5 and 6, which this document implements, and [`GeneratorCatalogue.md`](./GeneratorCatalogue.md) for what each generator represents physiologically. **This file is the single authoritative source for every generator's spatial field (per-electrode gain). Code must match these numbers exactly — if `eegGenerator.ts` and this file ever disagree, the code is wrong and must be fixed to match this document, not the other way around.**

## The rule for building a field map

A field map is a table of gain multipliers (0 to 1) describing how strongly a generator's signal reaches each electrode. Two opposite rules apply depending on what's being modeled:

- **Physiological generators must decay continuously with anatomical distance from the source (Principle 5).** An electrode's gain should sit between its neighbors' gains — no arbitrary jumps. If you can't draw a smooth decay curve from the anatomical source outward through the field-map numbers, the numbers are wrong.
- **Technical artifacts must NOT decay continuously (Principle 6).** A field map for a popped electrode or a loose lead should be confined to essentially one electrode, with near-zero gain immediately outside it — the sharp discontinuity is the point, not a flaw.

Field maps for hemispheric generators (like the two PDR generators) must never be shared between electrodes belonging to opposite hemispheres — each hemisphere's field map only touches its own ipsilateral electrodes plus, at most, negligible midline spread.

## Awake-state field maps

### PDR-Left (`pdrLeft`)

| Electrode | Gain | Basis |
|---|---|---|
| O1 | 1.00 | Source electrode — directly over the left occipital generator |
| P3 | 0.67 | Adjacent parietal electrode, attenuated by volume conduction |
| T5 | 0.31 | Posterior-temporal, further from source, further attenuated |
| All others | 0 | Beyond the left occipital generator's physiological reach |

### PDR-Right (`pdrRight`)

| Electrode | Gain | Basis |
|---|---|---|
| O2 | 1.00 | Source electrode |
| P4 | 0.67 | Adjacent parietal |
| T6 | 0.31 | Posterior-temporal |
| All others | 0 | Beyond reach |

Note the mirrored decay curve (1.00 → 0.67 → 0.31) is intentional and must stay identical in shape between the two hemispheres — only the *fixed persistent offset* (see `GeneratorCatalogue.md`) should differ between them, not the underlying spatial decay.

### Diffuse Cortical Background (`diffuseBackground`)

| Electrode | Gain | Basis |
|---|---|---|
| All electrodes | 1.00, computed independently per electrode | No shared source to volume-conduct from — see `GeneratorCatalogue.md` for why per-electrode independence is correct here specifically |

### EMG (`emgGenerator`)

| Electrode group | Gain | Basis |
|---|---|---|
| Frontal (Fp1, Fp2, F3, F4, F7, F8, Fz) | 1.00 | Nearest frontalis muscle |
| Temporal (T3, T4, T5, T6) | 0.75 | Nearest temporalis muscle |
| Central / midline (C3, C4, Cz, Pz) | 0.50 | Intermediate distance from both muscle groups |
| Occipital (O1, O2) | ~0 | Far from both cranial muscle groups |

### Posterior Slow Waves of Youth (`pswy`)

| Electrode | Gain | Basis |
|---|---|---|
| O1, O2 | 1.00 | Same posterior source region as PDR |
| P3, P4 | 0.67 | Same decay as PDR-Left/PDR-Right |
| All others | 0 | PSWY does not spread beyond the posterior region it's admixed with |

Reuses the PDR decay curve exactly, since PSWY is described (`GeneratorCatalogue.md`) as arising from the same posterior region PDR does, not an anatomically distinct source.

### Eye Blink (`blinkArtifact`) — existing, unchanged

| Electrode | Gain | Basis |
|---|---|---|
| Fp1, Fp2 | Highest | Nearest the corneo-retinal dipole |
| F3, F4, F7, F8 | Reduced | Volume-conducted spread from the frontal pole |
| Posterior electrodes | ~0 | Beyond the dipole's physiological reach |

### Technical artifacts (`electrodeArtifact`, `powerlineArtifact`, etc.) — existing, unchanged

Confined to the single affected electrode/channel by design (Principle 6) — no decay table applies, because there is no anatomical source to decay from.

## Precedent already in code

The existing interictal spike generators' spatial fields (`LT_FIELD`, `RT_FIELD`, `LF_FIELD` in `eegGenerator.ts`) already follow the continuity rule above — hand-tuned per-electrode gains that decay smoothly from a focus so that bipolar montages show correct phase reversal (Principle 4) as a natural consequence of the montage math, not a scripted flip. Any new focal generator's field map must be built the same way and added to this document before being coded.
