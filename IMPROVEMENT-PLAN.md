# Improvement plan — scientific accuracy, simulation realism, usability, performance

Scope: the whole simulator, prioritised by *how wrong a learner ends up* if the item is left alone.
Items marked **[done]** were executed in this pass; **[deferred]** items are blocked on a decision
that is not mine to make (almost all of them because they are signal changes, and CLAUDE.md §2/§4
require an `INFORMING-KNOWLEDGE.md` entry — written only on explicit request — before the code moves).

---

## Priority 0 — the display was contradicting the clinical convention

This outranks everything else on the list. Every other item is about a signal being *approximate*;
this one made correct signals read as their own mirror image.

### P0.1 Negative-up rendering **[done]**

Clinical EEG is displayed **negative-up**: a channel whose input 1 is more positive than input 2
deflects **downward**. The canvas was drawing positive-up, so a physiologically correct blink,
POSTS, lambda and the triphasic middle phase all rendered inverted. Nothing caught it, because the
only topographic assertions in the suite were power ratios, which are sign-blind.

- Canvas now maps `y = centerY + v`.
- `validateEngine.ts` §7c is a new 13-check block asserting rendered *sign* per pattern, on the
  bipolar row rather than the electrode — a bipolar derivation cannot establish an absolute
  single-electrode potential, so the check has to live in the same space as the claim.
- `IK-001` promoted to `enforced (automated)` (the only `INFORMING-KNOWLEDGE.md` edit this pass,
  under explicit approval).

### P0.2 The descriptions that caused the confusion **[done]**

Four pattern tooltips described surface-positive events as a "positive deflection", which a learner
reads as *upward*. That is the exact misreading that surfaced this bug. Fixed in
`utils/patterns.ts` for `blink`, `posts`, `lambda`, `triphasic` — each now states the scalp polarity
*and* the screen direction, and says why the two differ.

### P0.3 Polarity legend **[done]**

The convention is fixed app-wide, so it belongs on screen rather than in a tooltip. Added a small
non-interactive legend to the Display section of the control panel: up-arrow `= negative (−)`,
down-arrow `= positive (+)`, plus the one-line rule.

---

## Priority 1 — 3D head model performance

The panel lagged the browser. Root cause was **four compounding problems**, not just mesh size;
fixing only the mesh would have left most of the cost in place.

### P1.1 Duplicate, uncached mesh fetches **[done]**

`useMeshBin` was called four times with no cache, so `brain.bin` and `skin.bin` were each fetched
**twice** (~18 MB) and `computeVertexNormals()` ran **four** times over quarter-million-triangle
meshes — all on the main thread, at the moment the panel opens. Now a module-level
promise cache keyed by filename: one fetch, one normal pass per mesh, shared across consumers.

### P1.2 Per-frame label raycasting **[done]** — the dominant cost

21 drei `<Html occlude>` labels each raycast against two ~250k-triangle meshes **every frame**, with
no BVH. Replaced with an analytic facing test: for a closed surface enclosing the origin, an
electrode's outward normal *is* its own position vector, so it faces the camera when
`dot(p, camera − p) > 0`. One dot product per label per frame instead of a mesh traversal, and it
writes `style.opacity` directly rather than re-rendering React. Exact for a convex scalp; only
approximate at ears/nose, where labels are at grazing angles anyway.

### P1.3 Continuous render loop for a static panel **[done]**

The head is an anatomical reference that changes only on interaction, yet it ran a continuous
`frameloop` alongside the EEG canvas's own rAF loop. Switched to `frameloop="demand"` (R3F
invalidates on React commits; drei's OrbitControls self-sustains its own damping), and capped
`dpr={[1, 2]}` so a HiDPI display doesn't quietly quadruple the fill cost.

### P1.4 Geometry budget **[done]**

New `scripts/src/compressMeshes.ts` builds display-resolution LODs by QEM (quadric error metric)
edge collapse. QEM matters here specifically: grid vertex clustering welds the opposing banks of a
sulcus as soon as the cell exceeds the sulcal gap, whereas QEM collapses the cheapest edge first, so
flat gyral crowns melt while high-curvature sulcal walls survive.

| | triangles | bytes | |
|---|---|---|---|
| `brain.bin` → `brain_lod.bin` | 250 000 → 55 000 | 4.46 MB → 0.97 MB | 21.8 % |
| `skin.bin` → `skin_lod.bin` | 256 536 → 30 000 | 4.60 MB → 0.53 MB | 11.5 % |
| **fetched by the browser** | **507 k → 85 k** | **9.06 MB → 1.50 MB** | **16.6 %** |

Measured surface deviation (true point-to-triangle distance, 20 000 samples): brain mean **0.10 mm**,
p95 0.23 mm, max 5.41 mm; skin mean **0.05 mm**, p95 0.13 mm, max 4.62 mm. Enclosed volume changes
by −0.13 % and −0.05 %.

Two safeguards are built into the script rather than left to inspection:

- **It writes new files instead of decimating in place.** `build1020.ts` ray-casts the 10-20
  positions onto `skin.bin`; shrinking that file would silently move every electrode on its next
  run. The masters stay untouched and authoritative.
- **It throws if any electrode sinks below the decimated scalp.** Currently the tightest is T5 at
  **+0.89 mm** proud.

---

## Priority 2 — scientific accuracy **[deferred]**

Each needs an `IK-` entry and a `validateEngine.ts` check before the code moves (CLAUDE.md §4).

- ~~**Sleep spindle band.**~~ **Withdrawn — this was my error, see Round 2 / corrections.**
- **`mu: 0.35` vs IK-007.** Logged in §11 of `INFORMING-KNOWLEDGE.md` as a live conflict. Per §2 a
  disagreement between code and an entry is a finding, so it stays surfaced rather than silently
  reconciled — the clinical call is yours.
- **An IK entry for the negative-up convention itself.** P0.1 is now guarded by 13 checks but has no
  entry of its own; it is currently only implied by IK-001. Worth `IK-008`.

## Priority 3 — realism **[deferred]**

- Electrode impedance mismatch as a per-channel noise-floor difference, rather than uniform noise.
- ~~Reference-electrode contamination in `reference-*` montages.~~ **Withdrawn — already modelled,
  see Round 2 / corrections.**
- State transitions that ramp rather than switch — arousals out of N2, drowsiness drifting into N1.

## Priority 4 — usability

- ~~The pattern list is long and flat within each category.~~ **[done in Round 2 — R4.1]**
- Several toggles silently force a background state (`posts` → N1, `spindles` → N2). The tooltips say
  so, but the state control changing under the user with no visible cause is startling.
  **[still deferred]** — note Round 2 added two more (`photic`, `hyperventilation` → Awake), so this
  is now slightly worse than when it was first logged.
- ~~No way to freeze the trace and inspect.~~ The freeze button and caliper existed but were
  undiscoverable. **[done in Round 2 — R4.2]**

---

# Round 2

New items, generated by surveying the code rather than by continuing the Round-1 list. Ranked by
(learner value × confidence) / risk.

## Two corrections to Round 1

Both were mine, and both would have produced a change that made the simulator *less* correct. They
are recorded rather than quietly dropped, because the reasoning is the point.

- **"Reference-electrode contamination is not modelled" — false.** `electrodePositions3D.ts` has 21
  entries, including `A1` and `A2`, and `buildLeadfield` defaults to every key in that table. The ear
  references therefore already carry volume-conducted signal, and the `reference-ipsi` /
  `reference-contra` montages already show the temporal contamination a real A1/A2 produces.
  Implementing this would have meant re-implementing it.
- **"The spindle tone set is too narrow" — wrong criticism.** The tones (12.3 / 13.5 / 14.8 Hz) sit
  in the upper half of the 11–16 Hz definition, and I read that as a gap. But this source is anchored
  at **Cz**, and the vertex/centroparietal spindle is precisely the **fast** subtype at 13–15 Hz; the
  slow 11–13 Hz subtype is **frontal** and would need its own source with its own topography.
  Widening the tones would have made a vertex spindle less accurate, not more. **The numbers are
  unchanged.**

  The defensible gap was elsewhere: *nothing asserted the spindle's frequency at all*. The only
  spindle check was a 12–15 Hz power ratio, which would pass just as happily with the tones at 20 Hz.
  Added `check('spindle peak frequency at Cz', …, 11, 16, ' Hz')`, which searches 6–25 Hz — wide
  enough that the answer is not assumed — on the source's own on-minus-off contribution spectrum so
  the posterior alpha rhythm cannot win the argmax. **Measured: 13.55 Hz.**

## R1 — Activation procedures **[done]**

The largest clinical content gap in the simulator. Photic stimulation and hyperventilation are
performed in essentially every routine EEG and have their own section in every EEG report; a learner
trained only on this tool had never seen either response. New `engine/sources/activation.ts`.

Both are *procedures with a time course*, which is what makes them different from every other source
here: the teaching content is the evolution, not any single epoch. So each runs a scripted clock that
starts when the toggle goes on and resets when it goes off (the `if (!ctx.enabled) { reset(); … }`
idiom the ictal sources already use) — watching a procedure from the middle would teach nothing.

**Photic driving.** Occipital source spanning O1/O2. The stimulator steps 1 → 30 Hz; the response is
generated at the flash frequency plus a second harmonic, with phase accumulated per-sample so a step
change never produces a discontinuity. Amplitude follows a tuning curve peaking at 14 Hz and rolling
off below ~4 and above ~25 Hz, because a normal subject drives best near their own alpha frequency
and barely at all at the extremes of the series.

*One deliberate compression, stated because it is a deviation:* trains are 6 s with 3 s rests, against
a clinical ~10 s with ≥7 s between. At clinical timings a full series takes close to four minutes and
the informative part does not begin until a minute in. This shortens the **procedure**; the stepped
structure, flash-locking, harmonic content and tuning are unchanged.

**Hyperventilation build-up.** Broad frontal source. 180 s of build-up, 60 s of recovery, 30 s of
rest. The envelope is quadratic (a build-up is most marked in the last minute), the theta term scales
with it and the delta term with its square (build-up *evolves* from theta into delta as it deepens),
and `bandGate` attenuates alpha to a floor of 0.5 — attenuated, **not** abolished, because a normal
build-up is not an abnormality. Contrast `gen-slowing`, which takes the PDR to 0.15 because loss of
the PDR is the whole point there.

Not modelled, deliberately: the photoparoxysmal response and HV-induced absence seizures. Both are
separate findings, the existing generalised spike-wave toggles already show that morphology, and
coupling them would need cross-source signalling the registry contract does not have.

Registered in `registry.ts`, given an "Activation Procedures" category in `patterns.ts` (CLAUDE.md §7
— registering only one of the two yields a dead toggle), and locked to awake/drowsy in App's
`STATE_LOCKED_PATTERNS`: you cannot ask a sleeping patient to overbreathe.

Guarded by 11 new checks in `validateEngine.ts` Step 17 — occipital predominance, symmetry, tracking
of the flash rate, silence in the rest gaps, absence of driving at 2 Hz, build-up, resolution, frontal
predominance, theta→delta evolution, and alpha attenuation.

## R2 — Two artifact generators that were unreachable **[done]**

`EcgGenerator` and `MovementGenerator` were complete, forward-modelled, and wired into `engine.next()`
— but `adapter.ts` passed `ecgScalp: false, movement: false` unconditionally, because no toggle
existed. Two `patterns.ts` entries and two adapter lines. Cardiac scalp contamination is a
particularly cheap win: the ECG display channel at the bottom of the montage was already always on,
so the toggle creates the exact exercise a reader is trained to perform — line the suspect transient
up against the R wave.

## R3 — Caliper sign **[done]**

`handleCanvasClick` computed `clickV = (centerY - y) / pxPerUV`, still positive-up after the P0.1
change made the renderer `y = centerY + v`. The readout displays `|Δv|`, so no number on screen was
ever wrong — but the stored value carried the opposite sign to the trace it was placed on. Fixed.

## R4 — Usability

### R4.1 Pattern search **[done]**

Forty-one patterns behind seven collapsed headings, and no way to find one by name. Added a search box
that matches pattern name, description **and** category, so a clinical term ("temporal", "delta")
finds the patterns that teach it rather than only the ones with the word in the title. Categories with
no hit disappear; categories with a hit are force-expanded, since a match hidden behind a collapsed
heading is the problem the search exists to solve. The per-category "on" badge still counts the whole
category, not the filtered view.

### R4.2 Freeze and measure discoverability **[done]**

The single highest-value teaching affordance in the app was one small unlabelled pause button. Space
now freezes/resumes (guarded so it does not fire while typing in the new search box or on a focused
button/switch), Escape clears the calipers, and while frozen an on-canvas strip spells out the
workflow: *click two points to measure · Esc clears · Space resumes*.

---

## Verification status of Round 2

- `pnpm run typecheck` — green, all four projects.
- `pnpm --filter @workspace/scripts run validate` — **ALL CHECKS PASSED**, including 11 new activation
  checks and the new spindle peak-frequency check.
- In-browser: search filter verified (`"temporal"` → 12 patterns across 5 categories including
  description-only matches; `"photic"` → 1; `"zzzz"` → empty state; cleared → default view restored).
  Space verified to freeze/resume from the page and to be ignored inside the search box; frozen hint
  confirmed present. Enabling Photic from N2 jumps the state to Awake; selecting N2 again clears the
  toggle. No console errors.
- **Still not measured: live frame rate.** The Browser pane reports `visibilityState: hidden`, so
  `requestAnimationFrame` never fires — the DOM is inspectable but the canvas does not advance. Any
  FPS number would be fabricated.

## Open — needs your decision (CLAUDE.md §2, §3.4)

No `INFORMING-KNOWLEDGE.md` entry may be written without explicit per-entry approval, so these are
proposed, not drafted:

- `IK-008` — the negative-up display convention itself (currently only implied by IK-001, though
  guarded by 13 checks).
- An entry for the photic driving response (occipital, symmetric, at the flash frequency, tuned to
  8–20 Hz) — the code and its checks exist; the ground truth does not.
- An entry for the HV build-up (builds, frontally predominant in adults, resolves within ~60 s,
  attenuates rather than abolishes the PDR).
- **`mu: 0.35` vs IK-007** remains logged in §11 and unresolved. It is a clinical call.

## Verification status of Round 1

- `pnpm run typecheck` — green, all four projects.
- `pnpm --filter @workspace/scripts run validate` — `ALL CHECKS PASSED`, including the 13 new
  polarity checks.
- LOD assets confirmed served (HTTP 200; 971 996 and 529 436 bytes), no console errors.
- **Not measured: live frame rate.** The Browser pane reports `visibilityState: hidden`, so
  `requestAnimationFrame` never fires and any FPS number would be fabricated. The improvements above
  are stated as what they provably remove — bytes, triangles, fetches, per-frame raycasts — and the
  subjective smoothness check is yours to make.

---

# Round 3 — dynamic (contextual) UI for artifacts

**Request.** Artifacts should reveal their own controls when switched on, the way the ictal
toggles already reveal Hemisphere / Intensity / Frequency. Named explicitly: an electrode-pop
dropdown choosing *which* electrode pops, with **pop → flat → until reattach**; muscle artifact
options; plus anything else worth adding.

## Concept first (CLAUDE.md §3)

**Electrode pop and lead-off.** A pop is the electrical signature of the electrode–gel–skin
junction breaking down: the half-cell potential steps and then relaxes back through the
amplifier's input RC, which is why it looks like a step with an exponential tail. It has no
anatomical generator, so it is confined to **one electrode** and does not decay smoothly to
neighbours — that spatial discontinuity is how a reader tells a bad electrode from a real
cortical source, and it is why the generator bypasses the leadfield.

If contact is not restored, the junction stays broken and the electrode stops reporting brain:
the amplifier sees a floating input clamped near zero, so the channel carries only the noise
floor and whatever mains it still picks up. That is the "flat" appearance. **Where it shows as
flat depends on the montage, and this matters clinically:** in a referential montage the dead
electrode's own channel is isoelectric; in a bipolar chain the two derivations containing it
show the *neighbour's* activity unopposed (Fp1-F3 becomes Fp1, F3-C3 becomes −C3), which is the
classic "one bad electrode, two abnormal-looking derivations" trap. The simulator therefore
flattens the **electrode**, not the row, and the UI says so. Flattening both rows would be the
factually wrong simplification §3.5 forbids.

The engine already models this defect: `ChannelDefect { kind: 'flat' }` in `chain.ts` —
"Disconnected lead: flat but for a tiny noise floor" (`v = 0`, noise ×0.25, line ×0.2). Detaching
an electrode reuses it at runtime instead of inventing a second mechanism.

**Muscle (EMG).** Scalp EMG is not one thing; it is whichever muscle is contracting, and each has
its own territory:
- **Temporalis** (T3/T4, F7/F8) — jaw clench, and it can be genuinely unilateral.
- **Frontalis** (Fp1/Fp2, F7/F8) — brow tension, the "worried patient" record.
- **Nuchal / posterior cervical** (O1/O2, T5/T6) — neck tone from head position, the classic
  obscurer of the posterior dominant rhythm and a mimic of posterior sharp transients.

The engine had only temporalis L/R and frontalis, so a learner could never produce the posterior
case. Round 3 adds a nuchal source (posterior-inferior, behind and below the occipital
electrodes) and makes all four independently selectable, with a severity multiplier for the
difference between a tense patient and a clenched jaw.

## Plan

1. **`ArtifactParams` channel.** New type in `utils/simTypes.ts`, state + `updateArtifactParams`
   in `App.tsx` (mirroring `ictalParams`), a `SimSettings` field, and `engine.setArtifactParams()`
   called from `adapter.ts` next to `setArtifactGates`. Every engine-side default means
   "unchanged", so `validateEngine.ts` — which never calls the setter — sees today's behaviour.
2. **Electrode pop.** `ElectrodePopGenerator` gains a target electrode, a settable rate and
   `trigger()`. `RecordingChain` gains `setDefect()`. Detaching an electrode fires the pop and
   then, once the transient has decayed, switches that channel to the existing `flat` defect;
   reattaching restores the subject's original defect.
3. **Muscle.** Nuchal source + generator; per-region gating; severity multiplier. Nuchal is
   **off by default** so no existing check moves.
4. **Everything else that had a hidden knob.** Blink rate, saccade rate, sweat severity, movement
   rate + severity, ECG heart rate, and mains frequency (50/60) + amplitude.
5. **UI.** `components/ArtifactControls.tsx`, rendered under an enabled artifact toggle exactly
   where the ictal block renders.
6. **Checks.** A new step in `validateEngine.ts` asserting the detach/reattach behaviour, that a
   detached electrode does not disturb its neighbour, that pops respect the chosen target, that
   nuchal EMG is posterior, that severity scales power, and that 60 Hz mains lands at 60 Hz.

## Findings surfaced on the way (not silently fixed)

- **The mains toggle does nothing for half of subjects.** `sampleSubject` draws
  `lineAmp = uniform() < 0.5 ? 0 : range(1, 8)`, and the toggle only gates the waveform, not its
  amplitude — so with p ≈ 0.5 switching "50 Hz Mains" on produces exactly zero change. The new
  amplitude control overrides the sampled value when the UI supplies one; the subject draw still
  governs any caller that does not (validation included).
- **The scalp cardiac artifact did not line up with the ECG display channel.** They were two
  independently seeded `EcgGenerator`s, so the R waves did not coincide — while the pattern
  description tells the learner to confirm ECG artifact by checking that every transient lines up
  with an R wave on the ECG trace. One heart now drives both, at the same rate.
- **Chewing is out of scope this round.** It is a pattern source, not an engine artifact
  generator, so a chew-rate control would have to extend `SampleContext` rather than
  `ArtifactParams`. Flagged, not attempted.

## Verification status of Round 3

- `pnpm run typecheck` — green, all four projects.
- `pnpm --filter @workspace/scripts run validate` — **ALL CHECKS PASSED**. Step 18 is new and adds
  15 checks; no pre-existing check moved, including the Step 7 artifact block that now runs against
  the unified single-heart ECG.
  - Detachment: T4 RMS while detached / before = **0.095**; after reattaching = **0.886**;
    neighbour T6 while T4 is detached = **1.031** (a lead coming off is one electrode, not a row);
    T4 peak in the 1 s after detaching = **275 µV** (the pop announcing the contact failing).
  - Pop targeting: contribution at the chosen electrode **40.8 µV RMS**, largest contribution
    anywhere else **0.000 µV** — exactly zero, because the pop bypasses the leadfield.
  - Muscle territories: nuchal O1/Fz 20-70 Hz power **2.4e4**; frontalis Fp1/O1 **7.3e6**; left-only
    temporalis T3/T4 **1.6e6**; severity 2× scales RMS by **2.000**; no region selected → **0.000 µV**.
  - Mains: peak lands at **49.93 Hz** and **59.94 Hz** as selected; 50 Hz prominence against the
    neighbouring 38-42 Hz band goes **0.82 → 18.2** when the amplitude control is raised from 0 to
    6 µV on a subject whose own sampled `lineAmp` is 0.
  - Cardiac: R-R interval at `ecgBpm` 120 = **0.499 s**; scalp T3 excursion at the R wave / its own
    RMS = **6.08**, i.e. the scalp artifact and the ECG trace are now the same heartbeat.
- In-browser: enabling Muscle (EMG) reveals the four territory chips and the severity slider;
  enabling Electrode Pop reveals the electrode dropdown (all 21 electrodes plus "Any electrode
  (random)"), the pop-rate slider and a detach button disabled until an electrode is chosen.
  Selecting T4 and clicking through: the button becomes "Reattach T4", a "T4 ×" chip appears under
  DETACHED, and the montage-dependence hint renders. Reattaching clears both. No console errors.
- **Still not measured: live frame rate**, for the same reason as Round 2 — the Browser pane is not
  compositing, so `requestAnimationFrame` never fires and the canvas does not advance. The controls
  were verified through the DOM; the rendered trace was not.
