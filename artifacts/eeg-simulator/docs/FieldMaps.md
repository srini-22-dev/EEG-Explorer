# Field Maps

Part of the governing document set — see [`EEG_ARCHITECTURE.md`](./EEG_ARCHITECTURE.md) for Principles 5 and 6, which this document implements, and [`GeneratorCatalogue.md`](./GeneratorCatalogue.md) for what each generator represents physiologically.

**As of the engine rewrite, the hand-authored per-electrode gain tables this document used to hold for the awake-state background (`pdrLeft`, `pdrRight`, `frontalBeta`, `anteriorTheta`, `diffuseBackground`, `emgGenerator`) are SUPERSEDED.** Those generators' spatial fields are now computed geometrically at runtime by the forward model in `forward.ts`, not looked up in a table — there is no table left to keep in sync with the code for them. What follows is the new model, then the legacy tables that are still authoritative for the pattern layer that remains hand-authored.

## The new model: geometric forward projection (`forward.ts`)

Briefing §7. Each engine-layer source — background patch or rhythm alike — is a **current dipole on a cortical shell**, and its scalp field is a **Gaussian function of distance** from the source's scalp projection:

- **Radial dipoles** (gyral crowns) produce a monopolar Gaussian blob, strongest directly over the source and falling off smoothly with distance.
- **Tangential dipoles** (sulcal walls, e.g. mu rhythm at C3/C4) produce a bipolar +/− pattern — a derivative-of-Gaussian along the tangential axis — which is the classic scalp signature of a sulcal source.
- The Gaussian width (`extent`, in scene units; `SMEARING_SIGMA ≈ 0.25` ~ 2.4 cm by default) stands in for skull smearing. Briefing §7 notes the historical 1:80 skull-to-brain conductivity ratio has been revised to roughly 1:15–1:25 — materially *less* smearing than older simulations assume — and the default extent is set for that modern range.
- Sources are anchored to real 10-20 electrode positions via `sourceUnder(id, electrodes, opts)`, which places the dipole on the cortical shell beneath the named electrode(s)' mean scalp position. This keeps the anatomy honest: a "left occipital" generator ends up genuinely under O1, not at a hand-picked coordinate that happens to look right on screen.
- Every source's leadfield column is normalised so its largest absolute gain is 1 (`buildLeadfield` in `forward.ts`), which is what lets a source's configured RMS mean "microvolts at the electrode where this generator is strongest" — the way amplitudes are quoted clinically.

**Why this replaces the hand-authored tables, not just supplements them:** the old rule (Principle 5) was "a field map should trace a plausible decay curve from the anatomical source outward — hand-check it." That check is now **structural** rather than a discipline someone has to remember to apply: a Gaussian-falloff-from-a-geometric-point *is* a smooth decay curve by construction, for every source, automatically, including any new one added later. There is no longer a table that could silently drift out of continuity, because there is no table.

### What determines each engine generator's field now

| Generator | Source position | Orientation | Notes |
|---|---|---|---|
| Aperiodic background patches | ~16 patches spread over the upper hemisphere via a Fibonacci-sphere distribution (`backgroundPatches()`) | Radial | Broad extent (default 0.42) — deliberately diffuse and overlapping, not focal |
| PDR (Left/Right) | Under O1+P3 / O2+P4 (`sourceUnder`) | Radial | Extent scaled from the per-subject `smearing` parameter |
| Mu (Left/Right) | Under C3 / C4 | Tangential | Sulcal/sensorimotor source — this is *why* mu is focal at C3/C4 rather than a broad central blob, unlike a radial source of the same size |
| Sensorimotor/Frontal Beta | Under C3 / C4 / (Fz+F3+F4) | Radial | Burst-process amplitude envelope, same geometric field |
| Frontal Midline Theta | Under Fz | Radial | |
| Diffuse Theta | Under Cz+Pz | Radial | Broad extent |
| Delta (Frontal/Central) | Under Fz+Fp1+Fp2 / Cz+C3+C4 | Radial | Widest extent of the rhythm generators — delta is frontally/centrally broad, per §4 |
| Artifact sources (blink, gaze, temporalis, frontalis, heart, sweat) | Own positions outside the cortical shell — eyes, jaw muscles, far below the head (`ARTIFACT_SOURCES` in `artifacts.ts`) | Mostly radial; lateral gaze is tangential (left-right dipole, so F7/F8 move in opposite directions) | Deliberately **not** placed on the cortical shell, and pushed through the same Gaussian projector — see "Artifacts have their own topography" below |

Electrode pop and mains/line noise are the exceptions: pop has no source at all and bypasses the leadfield entirely (see Principle 6, below); line noise is applied uniformly per channel in the recording chain (`chain.ts`), not projected through the leadfield.

## Phase reversal still emerges from bipolar subtraction — unchanged

This principle survives the rewrite intact and is not up for revision. **Phase reversal is never scripted anywhere in either generator layer.** It still emerges purely from `computeChannel.ts` subtracting two electrode potentials that sample a spatially-decaying field on opposite sides of its peak — true of the new geometric fields exactly as it was of the old hand-authored ones. Nothing in `forward.ts` or `engine.ts` computes or special-cases a sign flip for any channel.

## Artifacts have their own topography (§8)

A field map for an artifact must **not** look like a neural field map, and now this is enforced by giving artifacts real source positions distinct from the cortical shell — eyeballs, temporalis muscle, the heart — rather than by routing artifact amplitude through the neural leadfield or (worse) adding it per-channel independently. That distinctness is exactly what ICA-based artifact rejection exploits in real data; a simulator that blurs it makes artifact cleaning look trivially easy. See `GeneratorCatalogue.md` for the artifact list and `artifacts.ts` for source positions.

## Legacy field maps — still authoritative for the pattern layer

The tables below remain in force for the **legacy pattern layer** (`eegGenerator.ts`) — patterns that are hand-authored, event-based graphoelements rather than engine sources. **Code must match these numbers exactly** for the entries that remain live; if `eegGenerator.ts` and this file disagree on one of them, the code is wrong. The rule for building or reviewing one of these by hand is unchanged:

- **Physiological generators must decay continuously with anatomical distance from the source (Principle 5).** An electrode's gain should sit between its neighbors' gains — no arbitrary jumps.
- **Technical artifacts must NOT decay continuously (Principle 6).** A field map for a popped electrode or a loose lead should be confined to essentially one electrode.

### Posterior Slow Waves of Youth (`pswy`) — legacy, live

| Electrode | Gain | Basis |
|---|---|---|
| O1, O2 | 1.00 | Posterior source region |
| P3, P4 | 0.67 | Adjacent parietal, attenuated |
| All others | 0 | PSWY does not spread beyond the posterior region it's admixed with |

Still hand-authored (`PSWY_FIELD` in `eegGenerator.ts`) because PSWY is a discrete, toggleable normal-variant graphoelement in the legacy layer, not an engine source — it is not automatically produced by the engine's PDR generator's field, even though the two occupy the same anatomical region.

### Interictal spike foci (`LT_FIELD`, `RT_FIELD`, `LF_FIELD`) — legacy, live

| Field | Strongest at | Basis |
|---|---|---|
| `LT_FIELD` | T3 (1.0), F7 (0.5), T5 (0.42), Fp1 (0.15), C3 (0.1), O1/P3 (~0.05-0.07) | Left temporal lobe epilepsy focus |
| `RT_FIELD` | T4 (1.0), F8 (0.5), T6 (0.42), Fp2 (0.15), C4 (0.1), O2/P4 (~0.05-0.07) | Right temporal lobe epilepsy focus |
| `LF_FIELD` | F3 (1.0), Fp1 (0.58), Fz (0.32), C3 (0.22), F7 (0.18), Cz (0.1), Fp2/F4 (~0.08-0.12) | Left frontal lobe epilepsy focus |

These are still hand-tuned per-electrode gains that decay smoothly from a focus (Principle 5) so that bipolar montages show correct phase reversal (Principle 4) as a natural consequence of the montage math in `computeChannel.ts`, exactly as before the rewrite. Any *new* focal generator added to the legacy pattern layer must still be built the same way and added to this document before being coded. A new focal generator being added to the *engine* layer instead should use `sourceUnder()` (`forward.ts`) and does not get a hand-authored table at all.

### Eye Blink (`blinkArtifact`), legacy toggle — existing, unchanged

| Electrode | Gain | Basis |
|---|---|---|
| Fp1, Fp2 | Highest | Nearest the corneo-retinal dipole |
| F3, F4, F7, F8 | Reduced | Volume-conducted spread from the frontal pole |
| Posterior electrodes | ~0 | Beyond the dipole's physiological reach |

Distinct from the engine's own always-on `BlinkGenerator` (`artifacts.ts`), which uses the geometric artifact source instead of this table — see `GeneratorCatalogue.md`.

### Technical artifacts (`electrodeArtifact`, `powerlineArtifact`, etc.) — existing, unchanged

Confined to the single affected electrode/channel by design (Principle 6) — no decay table applies, because there is no anatomical source to decay from. The engine's own `ElectrodePopGenerator` follows the identical rule by bypassing the leadfield entirely rather than using a near-zero-everywhere-else table.
