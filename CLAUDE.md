# CLAUDE.md

Guidance for Claude Code working in this repository.

**How this file is meant to work:** it holds *rules and invariants*, not a tour of the code.
Rules survive refactors; file tours rot (this file's previous version did — it documented a
function that no longer has a single caller). For "where does X live" and "what calls Y",
query the graph (§6) instead of expecting this file to know.

---

## 1. What this is

`artifacts/eeg-simulator` is the product: a browser-based clinical EEG teaching simulator for
medical students and neurology residents. It renders a real-time scrolling waveform display
(green paper, mm/s and µV/mm calibration, standard 10-20 montages) with toggleable clinical
patterns — seizures, artifacts, sleep stages, epileptiform discharges.

Everything else in the workspace (`api-server`, `mockup-sandbox`, `lib/db`, `lib/api-spec`,
`lib/api-zod`, `lib/api-client-react`) is Replit scaffolding that has never been built out past
a health check. Treat it as available infrastructure, not as existing product surface.

---

## 2. Ground truth: `INFORMING-KNOWLEDGE.md`

Clinical facts that must stay true across code changes live in [INFORMING-KNOWLEDGE.md](INFORMING-KNOWLEDGE.md).

- **Read it before changing signal generation.**
- **Never edit it as a side effect of another task.** Edit only when explicitly asked, and
  propose the exact diff first.
- When a change touches something it asserts, verify against it and report which `IK-` IDs
  were exercised.
- **If code and an entry disagree, stop and surface it.** Do not silently adjust either side.
  A disagreement is a finding, not a merge conflict.

Use the **`/ik`** skill to add entries (`/ik <plain-english fact>`) or to check one against the
simulator (`/ik --verify IK-003`). It reviews the claim clinically before formatting, assigns
the ID, and proposes the diff for approval. Don't hand-write entries — the review step is the
point.

---

## 3. Clinical accuracy over code elegance

This is an educational neuroscience tool. An elegant implementation of an incorrect concept is
a worse outcome than an inelegant implementation of a correct one.

When implementing any new pattern, montage, artifact, or waveform behavior:

1. Explain the underlying neurological/EEG concept **before** writing code.
2. Explain how the code models it — which numbers, timings, frequencies, and amplitudes
   represent which physiological fact.
3. Prefer simple, maintainable code over clever code, even when clever would be shorter.
4. If uncertain about the physiology (frequency bands, amplitude conventions, phase-reversal
   behavior, timing), **ask rather than assume**.
5. Never simplify a concept in a way that makes it factually wrong. A simplification that
   misleads a learner defeats the tool.

> **Where this overrides §5.** "Minimum code that solves the problem" governs *software
> structure* — abstractions, configurability, speculative error handling. It does **not** govern
> physiological fidelity. Dropping a term from a signal model is not simplification, it is a
> correctness regression. When the two pull apart, accuracy wins; justify the extra code in a
> comment.

---

## 4. How to read this EEG — display space is authoritative

The simulator holds two views of its own signal, and they are not interchangeable:

- **Spectral / referential space** — the engine's per-electrode voltages reduced to scalars
  (band power, envelopes, correlations) in `scripts/src/validateEngine.ts`. Answers *quantity*:
  how much alpha, what peak frequency, is a rhythm reactive.
- **Display space** — the **montage-derived** channel actually drawn on the page:
  `computeChannelVoltage` + `commonAverage` (`utils/computeChannel.ts`), painted **negative-up**
  (`y = centerY + v·scale`, `EEGCanvas.tsx`), calibrated µV/mm and mm/s. This is *morphology,
  polarity and spatial gradient* — what an electroencephalographer actually reads.

A pattern can pass every spectral check and still be wrong in display space: wrong polarity, no
phase reversal, wrong field. **So every clinical claim is verified in display space — an image
plus a display-space `check()` — not a spectral scalar alone.**

Conventions the eye applies:

- **Negative-up.** A surface-**negative** event deflects **up**; surface-**positive** deflects
  **down** (`+v` renders downward — canvas y grows down). A blink (Fp1/Fp2 positive) goes **down**;
  POSTS/lambda (occipital positive) go **down**.
- **Bipolar is a difference.** A bipolar row is `input1 − input2` and can never fix the absolute
  sign at either electrode. A focal source peaking *under* an electrode gives a **phase reversal**
  there (the two links sharing that electrode deflect toward each other); a source *midway* between
  two electrodes makes the link spanning them near-isoelectric while its flanks deflect oppositely.
- **Polarity is montage-dependent.** POSTS render clearly **down** in a referential montage
  (`reference-car`: O1/O2-AVG) but the sign is muddied where O1/O2 sit as *input 2* of a bipolar
  pair. Always state a polarity claim *with its montage*.
- **Calibration.** 30 mm/s sweep, µV/mm sensitivity, exactly `EEGCanvas` geometry
  (`PX_PER_MM_X = 4`, `MM_PER_ROW = 10`).

### The instrument: `scripts/src/renderTrace.ts`

Drives the **real** engine through the **real** display transform and rasterises the exact trace
`EEGCanvas` draws to a PNG you can open — zero new dependencies. Use it to *look*, not only measure.

```bash
pnpm --filter @workspace/scripts exec tsx ./src/renderTrace.ts \
  --state awake --patterns blink --montage bipolar-ap --seconds 6 --out blink.png
```

Flags: `--montage` (default `bipolar-ap`), `--state` (`awake|drowsy|n1|n2|n3`), `--patterns`
(comma-separated toggle ids), `--seconds`, `--seed`, `--sensitivity` (µV/mm), `--speed` (mm/s),
`--out`. It prints a per-row table of **signed peak (+ = down)** and RMS so the picture and the
numbers agree, and is importable as `renderTrace(opts)` for the same data programmatically.

---

## 5. How to work

**Think before coding.** State assumptions explicitly. If multiple readings exist, present them
rather than silently picking. If something is unclear, name what's confusing and ask.

**Simplicity first.** Minimum code that solves the problem — no speculative features,
no abstractions for single-use code, no error handling for impossible states. Scoped by §3.

**Surgical changes.** Every changed line should trace to the request. Don't improve adjacent
code, don't refactor what isn't broken, don't reformat. Remove orphans *your* change created;
mention pre-existing dead code rather than deleting it.

**Goal-driven execution.** Turn tasks into verifiable goals and loop until they pass. For a
signal change that means, in order:

1. Write the `IK-` entry stating the observable consequence (§2).
2. Add a `check()` to `scripts/src/validateEngine.ts` asserting it.
3. Make it pass.

Reuse `check(label, actual, lo, hi, unit)` in `validateEngine.ts` and the DSP primitives in
`scripts/src/dsp.ts` (`welch`, `fitAperiodic`, `hilbertEnvelope`, `dfa`, `spectralPeak`,
`autocorr`) rather than writing new analysis code.

**Verification discipline — rules written because each was broken.** These are not suggestions;
a report that skips one is not a verification.

1. **Never say "matches the reference" from a glance.** A match claim needs a table: every row of
   every chain the feature reaches, measured on the reference AND the engine with the same
   estimator, in the same units (row-heights on an uncalibrated figure). An image plus an adjective
   is not a comparison. (2026-09-14: a blink page was called a match while F7-T3 dipped 0.95 as
   deep as Fp1-F7 against 0.14 on the reference — visible in the very render being described.)
2. **Verify the whole page, not the thing you changed.** After any signal change, read the page
   against the reference in the read skill's order (§2 of `/read`) — every row — before reporting.
   Defects next to the change are the ones that survive.
3. **A passing check at its bound is a finding.** The gate prints a *near-bound review*; every
   entry on it that your change touches (and any new one) gets a stated verdict in your report —
   model wrong, or bound wrong and where the bound's number comes from.
4. **Every fitted number names its source.** A target in a comment with no citation ("roughly
   40-50% of Fp1") is a finding to test, never a constraint to fit. When you replace one, record
   what the source actually says.
5. **When the user points at a defect, find the class, not the instance.** Ask what check, rule or
   habit let it through, fix that too, and say so.

---

## 6. Codebase questions: query the graph first

`graphify-out/graph.json` is a current knowledge graph of this repo. For "where does X live",
"what calls Y", "how does Z connect", run:

```bash
graphify query "your question"
```

**before** grepping or reading source files. It is far cheaper than opening several large
modules, and unlike this file it is regenerated from the code and cannot drift.

After code changes, rebuild with `graphify update .` (no API cost). Check freshness by
comparing `git rev-parse HEAD` against the "Built from commit" line in
`graphify-out/GRAPH_REPORT.md`.

Do **not** run `graphify claude install` — it appends its own section to this file and would
conflict with §6.

---

## 7. Verification gates

| Command | Purpose |
|---|---|
| `pnpm --filter @workspace/scripts run validate` | **The regression gate.** Signal-model changes must leave it green. Also audits `INFORMING-KNOWLEDGE.md`'s statuses — see below. |
| `pnpm run typecheck` | Full workspace typecheck (builds `lib/*` refs, then `artifacts/*` + `scripts`). |
| `pnpm run dev` | Runs the simulator from the repo root; sets `PORT`/`BASE_PATH` itself via `cross-env`. |
| `pnpm run build` | Typecheck, then each package's `build`. |

There is no unit-test runner. `scripts/src/validateEngine.ts` is the de facto test suite — a
battery asserting spectral, temporal, and topographic properties of the generated signal. Never
claim a signal change works without running it and reporting the output.

**The gate also enforces §2's knowledge base against itself.** After the checks run, it reads
`INFORMING-KNOWLEDGE.md`, resolves the `check(...)` labels each entry cites against the results
just produced, and fails on three things:

- an entry marked **`enforced (automated)`** whose named check is **failing**;
- an entry marked **`violated`** whose named checks now **all pass** — a stale defect report that
  should be promoted back;
- an entry marked **`enforced`** whose citations resolve to **no check at all** — it claims
  automated enforcement and has none.

This exists because none of it used to be true. Every entry read `enforced (automated)`, four of
their checks were red, and the file's `violated` status had never once been used — so a red check
could sit indefinitely behind a green-looking entry, and one entry also quoted a passing figure it
had long since stopped producing. The status field is now load-bearing: you cannot leave an entry
lying about its own enforcement and still get a green gate.

Two consequences for how you work. **A red check is now a decision, not just a number** — either
fix the model, or move the entry to `violated` and say why in the entry itself. And **when you
change a signal, the `currently N` figures in the entries it touches go stale**; they are not
asserted, so nothing fails, but they are the entry's evidence and refreshing them is part of the
change. Citations that resolve to nothing are reported but do not fail, since some are deliberate
(a retired check an entry documents as retired) or placeholders standing for generated labels.

**Near-bound review.** The gate also lists passing checks within 10% of a real bound (see `NEAR_BOUND_FRACTION`). It never
fails on them, and it is not optional reading — see §5 *Verification discipline*, rule 3.

**Env vars** are only your problem when invoking a package directly rather than through the
root scripts: `PORT` + `BASE_PATH` for the Vite apps, `PORT` for `api-server`, `DATABASE_URL`
for `lib/db`. Each fails fast if unset.

Other useful commands:
- `pnpm --filter @workspace/eeg-simulator run typecheck` — just the simulator
- `pnpm --filter @workspace/api-spec run codegen` — regenerate the API libs from `openapi.yaml`

---

## 8. Invariants that are easy to break

- **Adding a pattern requires two edits**: register it in `utils/patterns.ts` (which drives the
  toggle UI) *and* add a matching `PatternSourceDescriptor` in the relevant
  `src/engine/sources/*.ts` family (concatenated into `registry.ts`). Registering alone yields a
  dead toggle.
- **`pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`** as a supply-chain defense. Don't
  disable it or extend `minimumReleaseAgeExclude` beyond the existing allowlist unasked. Prefer
  `"catalog:"` over a pinned version for deps already in the catalog.
- **Never hand-edit** `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/` —
  edit `lib/api-spec/openapi.yaml` and re-run codegen.
- **Don't casually edit `.replit-artifact/artifact.toml`** files; they wire up Replit's
  routing, build, and serve.
