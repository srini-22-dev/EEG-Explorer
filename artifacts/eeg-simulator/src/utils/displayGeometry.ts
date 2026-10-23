/**
 * Single source of truth for the EEG display's pixel geometry.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two renderers draw this signal: `EEGCanvas.tsx` (production, driven by the
 * live canvas element) and `scripts/src/renderTrace.ts` (headless, driven by
 * `validateEngine.ts` for display-space checks — see CLAUDE.md §4). They are
 * documented as sharing the same geometry, but before this module existed
 * that was true only by two files being hand-copied in sync: EEGCanvas
 * derived `pxPerMm` from the *live* canvas height every frame, renderTrace
 * hard-coded a constant, and the validator asserted calibration only against
 * renderTrace's copy while a comment claimed the two "agree today (checked by
 * inspection)" — an inspection that never actually compared `pxPerMm`, the
 * one quantity that sets the vertical scale. A sign flip in production code
 * could pass every check and still ship.
 *
 * Importing these functions instead of reimplementing them closes that gap:
 * a change to the real geometry — including a sign flip in `traceY` or
 * `ecgScale` — now shows up in renderTrace's output and therefore in
 * whatever the validator asserts against it, rather than only being caught
 * by someone re-reading both files side by side.
 *
 * This module intentionally does NOT change `pxPerMm`'s value or how canvas
 * height is used — it only extracts the existing formulas to one place.
 */

/** Horizontal: pixels per millimetre of paper travel (fixed, independent of
 *  paper speed — speed changes how much *time* a millimetre represents, not
 *  how many pixels it occupies). */
export const PX_PER_MM_X = 4;

/**
 * Minor time-grid spacing, in pixels.
 *
 * The paper grid is ruled in millimetres on BOTH axes: a minor line every 5 mm,
 * which is 167 ms at 30 mm/s and 500 ms at 10 mm/s. Real paper does not change
 * its rulings when the transport speeds up — the time a square represents is
 * what changes.
 *
 * Exported rather than written as a literal because the grid was the one piece
 * of geometry left out of this module when it was created, and the two
 * renderers diverged on it immediately: `EEGCanvas` was switched to the 5 mm
 * rule while `renderTrace` kept stepping the grid in 0.2 s, so the instrument
 * drew 24 px squares at 30 mm/s where the app drew 20 px, and 8 px against 20
 * at 10 mm/s. Measuring a transient by counting squares gave different answers
 * in a rendered PNG and on the page.
 */
export const MINOR_GRID_PX = 5 * PX_PER_MM_X;

/** Each EEG channel row is 10 mm tall on the paper. */
export const MM_PER_ROW = 10;

/**
 * Vertical px-per-mm implied by a canvas/raster of height `canvasH` split
 * across `totalRowUnits` row-units (channels plus fractional inter-group
 * gaps). This is the one formula that sets the amplitude grid spacing and
 * the µV-to-pixel scale; both renderers must derive `pxPerMm` through this
 * function so that a divergence between "live canvas height" and "target
 * raster height" is impossible by construction rather than by convention.
 */
export function pxPerMmFromHeight(canvasH: number, totalRowUnits: number): number {
  return canvasH / totalRowUnits / MM_PER_ROW;
}

/** Vertical px-per-µV for an EEG (scalp-derivation) channel at the given
 *  sensitivity (µV/mm). */
export function pxPerUV(pxPerMm: number, sensitivity: number): number {
  return pxPerMm / sensitivity;
}

/**
 * Vertical scale for the ECG row, in px per input unit (the ECG source is
 * supplied in mV: `pxPerMm` px/mm × 10 mm/cm-equivalent... concretely,
 * `pxPerMm * 10 / 1000` px per input unit, matching the pre-existing
 * production constant).
 *
 * NEGATED relative to the EEG scale. Negative-up (`traceY` below) is a
 * scalp-derivation convention: a surface-negative event deflects up because
 * that is how electroencephalographers are trained to read a montage. The
 * ECG row is a limb lead, not a scalp derivation — there is no negative-up
 * convention to honor there, and every clinician has the QRS complex
 * memorised with the R wave pointing up. Drawing the ECG row through the
 * EEG sign convention put its dominant, positive-going deflection (the R
 * wave: measured +494.8 µV vs. −102.9 µV over a 12 s window) below baseline
 * instead of above it.
 */
export function ecgScale(pxPerMm: number): number {
  return -(pxPerMm * 10 / 1000);
}

/**
 * The one definition of the y-coordinate a sample is drawn at.
 *
 * Canvas y grows downward, so negative-up is `centerY + v * scale`, not
 * `centerY - v * scale`: a channel whose active input is more positive than
 * its reference deflects DOWNWARD. `scale` carries whatever sign convention
 * applies to the row — positive for EEG channels (`pxPerUV`, negative-up),
 * negative for the ECG row (`ecgScale`, upright limb-lead convention).
 */
export function traceY(centerY: number, v: number, scale: number): number {
  return centerY + v * scale;
}
