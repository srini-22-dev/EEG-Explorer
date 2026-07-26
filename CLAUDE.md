# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm workspace scaffolded by Replit's "PNPM_WORKSPACE" agent stack. The real, actively-developed product is **`artifacts/eeg-simulator`** — a browser-based clinical EEG teaching simulator that renders a real-time, scrolling polysomnograph-style waveform display (green paper, mm/s and µV/mm calibration, standard 10-20 montages) with toggleable clinical patterns (seizures, artifacts, sleep stages, epileptiform discharges) for teaching EEG interpretation. Everything else in the repo (`api-server`, `lib/db`, `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`, `mockup-sandbox`) is boilerplate scaffolding that has not yet been built out beyond a health check — treat it as available infrastructure, not as existing product surface.

## Commands

Run from the repo root unless noted. Packages are pnpm workspace members under `artifacts/*`, `lib/*`, `lib/integrations/*`, and `scripts`.

- `pnpm run typecheck` — full typecheck (builds `lib/*` project references, then typechecks `artifacts/*` and `scripts`)
- `pnpm run typecheck:libs` — `tsc --build` for just the `lib/*` project references
- `pnpm run build` — typecheck, then run each package's `build` script (if present)
- `pnpm --filter @workspace/eeg-simulator run dev` — run the EEG simulator (Vite dev server; requires `PORT` and `BASE_PATH` env vars, see below)
- `pnpm --filter @workspace/eeg-simulator run typecheck` — typecheck just that package
- `pnpm --filter @workspace/api-server run dev` — build + run the API server (requires `PORT`)
- `pnpm --filter @workspace/mockup-sandbox run dev` — run the Replit component/design preview sandbox
- `pnpm --filter @workspace/db run push` / `push-force` — push Drizzle schema changes to `DATABASE_URL` (dev only)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate `lib/api-zod` and `lib/api-client-react` from `lib/api-spec/openapi.yaml` via Orval, then typecheck libs
- `pnpm --filter @workspace/scripts run hello` — run a one-off script via `tsx`

There is no test runner configured in this repo (no test script in any `package.json`).

### Required environment variables

- `artifacts/eeg-simulator` and `artifacts/mockup-sandbox` (Vite): `PORT`, `BASE_PATH` — the vite config throws immediately if either is missing.
- `artifacts/api-server`: `PORT` — same fail-fast behavior in `src/index.ts`.
- `lib/db`: `DATABASE_URL` — thrown from `lib/db/src/index.ts` if unset.

## Architecture

### Workspace layout

- **`artifacts/*`** — deployable units. Each has a `.replit-artifact/artifact.toml` describing its Replit deployment kind (`web`, `api`, or `design`), preview path, and dev/production run commands. Don't remove or hand-edit these tomls casually — they're how Replit's infra wires up routing/build/serve for each artifact.
  - `eeg-simulator` — the product (Vite + React 19 + Tailwind v4 + shadcn/ui "new-york" style, radix primitives). Served at `/`.
  - `api-server` — Express 5 app (`src/app.ts` wires middleware + `/api` router; `src/index.ts` just boots it). Served at `/api`; only a `/api/healthz` route exists today.
  - `mockup-sandbox` — a separate Vite app used as a component/design preview surface (`/__mockup`), driven by `mockupPreviewPlugin.ts`. Not the main app; don't confuse its `src/` with `eeg-simulator`'s.
- **`lib/*`** — shared, non-deployable packages consumed via `workspace:*`.
  - `lib/db` — Drizzle ORM + `pg`, schema lives in `lib/db/src/schema/` (currently empty — see the commented example in `schema/index.ts` for the expected shape: a `pgTable`, a `createInsertSchema` from `drizzle-zod`, and inferred `Insert*`/row types, one model per file, re-exported from `schema/index.ts`).
  - `lib/api-spec` — the single source of truth API contract (`openapi.yaml`) plus `orval.config.ts`. Running its `codegen` script regenerates the *other two* api libs — never hand-edit generated files under `lib/api-zod/src/generated` or `lib/api-client-react/src/generated`; edit `openapi.yaml` and re-run codegen instead.
  - `lib/api-zod` — Zod schemas/types generated from the OpenAPI spec.
  - `lib/api-client-react` — React Query hooks generated from the spec, plus a hand-written `custom-fetch.ts` (the Orval-configured fetcher: handles base URL injection, bearer-token injection for non-web/Expo consumers, and JSON/text/blob response parsing with a typed `ApiError`).
- **`scripts`** — misc one-off/maintenance TypeScript scripts run via `tsx`.
- **Root `tsconfig.json`** — a composite-build root referencing only the three `lib/*` packages (`db`, `api-client-react`, `api-zod`); `artifacts/*` packages typecheck independently via their own `tsc -p ... --noEmit`, not through project references.
- **`pnpm-workspace.yaml`** — also holds the dependency **catalog** (shared pinned versions like `react`, `vite`, `zod`, `tailwindcss`); prefer `"catalog:"` over a hardcoded version when adding a dependency already in the catalog. It also sets `minimumReleaseAge: 1440` (packages must be published ≥1 day before pnpm will install them) as a supply-chain defense — don't disable this or add exclusions beyond the existing `@replit/*` / `stripe-replit-sync` allowlist without being asked.

### EEG simulator internals (`artifacts/eeg-simulator/src`)

The simulator is a layered signal-synthesis + canvas-rendering pipeline, not a component-heavy UI app:

1. **`utils/montages.ts`** — defines electrodes (standard 10-20 system) and montages (bipolar antero-posterior, bipolar transverse, referential common-average/ipsilateral/contralateral). Each montage is a list of `ChannelDef` (active + optional reference electrode, a display group used for color-coding/layout).
2. **`utils/eegGenerator.ts`** — the signal model. `getElectrodeVoltage(electrode, t, settings)` composes a per-electrode voltage as a sum of independently-toggleable layers evaluated in a fixed order: background rhythm (patient-state dependent: awake/drowsy/N1/N2/N3) → burst-suppression voltage gate → sleep structural patterns (K-complexes, spindles, vertex waves, POSTS) → normal variants (mu rhythm, wicket spikes, lambda waves, etc.) → artifacts (blink, muscle, 50 Hz, etc.) → non-epileptiform abnormalities (FIRDA, triphasic waves, GPEDs/LPEDs) → interictal epileptiform spikes (with hand-tuned per-electrode spatial "field maps" like `LT_FIELD`/`RT_FIELD`/`LF_FIELD` so bipolar montages show correct phase reversal at the focus) → ictal/seizure patterns (absence, GTC, focal). Each pattern is gated by an id in the `activePatterns: Set<string>` from `utils/patterns.ts`; timing state for randomly-triggered events (spikes, blinks, bursts) is tracked in a module-level `T` map keyed by pattern name and reset via `resetGenerator()`.
3. **`utils/patterns.ts`** — the pattern registry: categories (Normal Variants, Artifacts, Non-Epileptiform Abnl., Interictal Epileptiform, Ictal/Seizures) each listing `{ id, name, desc }`; this is the source of truth for both the `ControlPanel` toggle UI and the ids checked in `eegGenerator.ts` — adding a new pattern means adding it here *and* handling its id in the generator.
4. **`utils/computeChannel.ts`** — turns per-electrode voltages into per-channel trace values: bipolar channels subtract active − reference electrode voltage; `AVG` reference averages all electrodes; ECG is synthesized independently via `getECGVoltage`.
5. **`components/EEGCanvas.tsx`** — the render loop. Runs its own fixed-rate sample generation (250 Hz) into rolling per-channel buffers driven off a `requestAnimationFrame` loop (not React state), and hand-draws the paper-strip background, amplitude/time grids, per-channel traces, channel labels, calibration bar, and active-pattern overlay directly on a `<canvas>`. Layout math (`buildLayout`) turns a flat channel list into row positions with spacer gaps between montage chain groups.
6. **`components/ControlPanel.tsx`** + **`App.tsx`** — plain React state (montage id, speed, sensitivity, patient state, active pattern set) passed down as props; no global state library.

When changing the signal model, keep amplitude/frequency choices consistent with the montage-correctness comments already in `eegGenerator.ts` (e.g. phase reversal at a bipolar focus) — they encode real EEG-reading conventions the simulator is teaching, not arbitrary tuning.
