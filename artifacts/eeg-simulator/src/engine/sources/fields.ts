/**
 * Scalp fields of GENERALIZED and REGIONAL generators — patch weights for
 * `synchronousPatches` (forward.ts).
 *
 * Why these exist. A single patch in this forward model is sharply peaked at the
 * electrode above it: at the shell depth under Fz or Cz the next electrode out
 * sees 20-35% of it, however wide its `extent`. Every pattern that used to be one
 * midline patch therefore drew as a MIDLINE FOCUS, whatever it was called.
 * Measured 2026-10-12, isolated (same-seed on minus off), as a share of each
 * pattern's largest double-banana row:
 *
 *   pattern (old source)          Fz-Cz  Fp1-F3  F3-C3  temporal chain  P3-O1
 *   3 Hz spike-wave (Fz, 0.7)      100     30      35        9-14          8
 *   absence seizure (Fz, 0.7)      100     30      35        9-14          8
 *   triphasic waves (Fz, 0.45)     100     17      20        6-11         10
 *   FIRDA (Fz+Fp1+Fp2, 0.5)        100     23      60       14-55          5
 *   GPEDs (Cz, 0.75)               100     21      21        1-2          19
 *
 * A learner asked to recognise a GENERALIZED discharge was being shown a vertex or
 * frontal-midline spike with a phase reversal on the midline chain and almost
 * nothing on the temporal chains. The sleep graphoelements had the same defect and
 * were rebuilt the same way on 2026-09-11 (sources/sleep.ts).
 *
 * How the weights were set. Each map is a least-squares fit of the nineteen patch
 * fields (one under each 10-20 site, all at `CORTEX_BELOW_SCALP`, extent 0.3,
 * mirrored left to right) to a target potential map, rounded to 0.05 —
 * `scripts/src/fitField.ts` holds the targets and reproduces every map here. The
 * targets come from what a reader sees on the page, stated at each map. A weight is NOT
 * the potential at that electrode: neighbouring patches overlap, and a field this
 * broad carries a large return term (`surfaceMean` in forward.ts), so the
 * strongest electrode sits near half the source's own amplitude.
 */

/**
 * Generalized, FRONTALLY PREDOMINANT — spike-and-wave (3 Hz, polyspike, absence,
 * the clonic phase of a tonic-clonic seizure), triphasic waves, hyperventilation.
 *
 * learningeeg (Epileptiform Discharges): generalized discharges "do not have to be
 * completely the same in every single lead; there is often an anterior
 * predominance", but the morphology "remains throughout all the leads" with the
 * same onset everywhere. Its two generalized spike-wave figures, read with
 * read-lab's rowtable.py, put the discharge on every one of the eighteen
 * double-banana rows — smallest row 0.35 and 0.27 of the largest, the temporal
 * chains about as large as the parasagittal ones (mean 0.88 and 1.07 of them).
 * ACNS 2021 §C.1.a calls a generalized pattern "frontally predominant" when
 * anterior voltage is at least 50% above posterior on an ear reference.
 *
 * Target: highest across the frontal row (Fz, F3/F4, F7/F8), about half of that
 * at the central row and at the frontal pole, a third at the parietal row, none
 * at the occiput. Result: every row carries it (smallest 0.43 of the
 * largest), temporal chains 0.73 of the parasagittal, anterior 1.85x posterior on
 * the ipsilateral ear, and a reversal at F3/F4 and F7/F8 — the frontal maximum a
 * reader points to.
 */
export const GENERALIZED_FRONTAL: Record<string, number> = {
  Fz: 1, F7: 0.85, F8: 0.85, F3: 0.75, F4: 0.75, Cz: 0.7, Fp1: 0.65, Fp2: 0.65,
  C3: 0.55, C4: 0.55, T3: 0.55, T4: 0.55, Pz: 0.55, T5: 0.5, T6: 0.5, P3: 0.45, P4: 0.45,
  O1: 0.35, O2: 0.35,
};

/**
 * BIFRONTAL, tapering to nothing posteriorly — frontal intermittent rhythmic delta
 * (FIRDA; "GRDA with frontal predominance" in ACNS 2021).
 *
 * learningeeg (Rhythmicity & Periodicity): "the bifrontal delta activity does not
 * travel back to the posterior regions". On its figure the rhythm is largest on
 * the frontopolar rows (Fp1-F7, Fp2-F8, Fp1-F3, Fp2-F4), still clear on F3-C3,
 * F4-C4 and Fz-Cz, and gone by the parietal and occipital rows.
 *
 * Target: highest at the frontal pole, about 60% along the frontal row, 20% at the
 * central row, none behind it. Result, as a share of the largest row: Fp1-F7 1.00,
 * Fp1-F3 0.88, F3-C3 0.64, Fz-Cz 0.64, F7-T3 0.55, C3-P3 0.20, P3-O1 and T5-O1
 * 0.05.
 */
export const BIFRONTAL: Record<string, number> = {
  Fp1: 1, Fp2: 1, Fz: 0.5, F7: 0.4, F8: 0.4, F3: 0.35, F4: 0.35, Cz: 0.3, O1: 0.3, O2: 0.3,
  C3: 0.25, C4: 0.25, T3: 0.25, T4: 0.25, T5: 0.25, T6: 0.25, Pz: 0.25, P3: 0.2, P4: 0.2,
};

/**
 * Generalized, POSTERIORLY PREDOMINANT — the lagging half of a triphasic wave, and
 * the benign 6 Hz "phantom" spike-and-wave in its classic FOLD form (posterior
 * maximum).
 *
 * Target: highest at the occiput, 85% at the parietal row, half at the central
 * row, a quarter frontally. Result, as a share of the largest row: T5-O1 1.00,
 * C3-P3 0.85, Cz-Pz 0.81, T3-T5 0.68, P3-O1 0.66, F3-C3 0.50, Fp1-F3 0.15.
 */
export const GENERALIZED_POSTERIOR: Record<string, number> = {
  O1: 1, O2: 1, Pz: 0.65, P3: 0.65, P4: 0.65, T5: 0.6, T6: 0.6, Cz: 0.45, C3: 0.45, C4: 0.45,
  T3: 0.45, T4: 0.45, Fp1: 0.4, Fp2: 0.4, Fz: 0.35, F7: 0.35, F8: 0.35, F3: 0.25, F4: 0.25,
};

/**
 * Mu, per side: the sensorimotor strip — the central electrode, with a share at
 * the parietal one behind it and at the vertex. learningeeg (Normal Variants): mu
 * runs "over the centroparietal (central) regions along the parasagittal chains".
 * Used by the background mu every mu subject carries (engine.ts) and by the
 * `mu-rhythm` toggle (variants.ts), which must be the same rhythm in the same place.
 */
export const MU_FIELD = {
  left: { C3: 1, P3: 0.3, Cz: 0.35 },
  right: { C4: 1, P4: 0.3, Cz: 0.35 },
};

/**
 * POSTERIOR TEMPORAL, bilateral — 14 & 6 Hz positive bursts. "More common in the
 * posterior quadrants" (learningeeg, Normal Variants); over the posterior temporal
 * head regions (StatPearls, Normal EEG Variants, NBK555899).
 */
export const POSTERIOR_TEMPORAL: Record<string, number> = {
  T5: 1, T6: 1, O1: 0.5, O2: 0.5, P3: 0.4, P4: 0.4, T3: 0.4, T4: 0.4,
};

/**
 * OCCIPITAL, bilateral — lambda waves and posterior slow waves of youth. Lambda is
 * "very occipitally focused" and looks "almost identical to POSTS" (learningeeg
 * atlas), so it takes the field POSTS were given on 2026-09-11 (sleep.ts).
 */
export const OCCIPITAL: Record<string, number> = { O1: 1, O2: 1 };

/**
 * A left temporal focus with its regional spread — lateralized periodic
 * discharges. learningeeg (Rhythmic & Periodic Patterns): LPDs are "over one
 * hemisphere or region". The target is its figure "Left temporal LPDs at 1 Hz",
 * measured row by row (median peak-to-peak per 1 s window, each left row less
 * its right-side twin, as a share of T3-T5's): F7-T3 0.84, T3-T5 1, T5-O1 0.23,
 * Fp1-F7 0.18, Fp1-F3 0.23, F3-C3 0.68, C3-P3 0.27, P3-O1 0.18 — the
 * parasagittal chain carries it too, most between F3 and C3, and the right side
 * nothing. A figure gives row sizes without their signs, so the map behind them
 * is a reading: a maximum at T3 and a lower one at C3. Fitted to that with
 * fitField.ts, these weights give F7-T3 0.91, T3-T5 1, T5-O1 0.22, Fp1-F7 0.31,
 * Fp1-F3 0.16, F3-C3 0.50, C3-P3 0.40, P3-O1 0.26, and under 0.02 on every
 * right-side row. No smooth field gives the figure's F3-C3 and its C3-P3 at
 * once; this one misses the two by about the same amount in opposite directions.
 *
 * It was one patch under T3. That already gave the temporal rows (0.90, 1, 0.29)
 * but left F3-C3 at 0.09 of T3-T5: a discharge on one chain only.
 */
export const LEFT_TEMPORAL_REGIONAL: Record<string, number> = {
  T3: 1, C3: 0.45, P3: 0.15, Cz: 0.15, F7: 0.1, T5: 0.05,
};

/** A left-sided field's twin on the right: T3 <-> T4, F7 <-> F8, the midline unchanged. */
export function mirrored(field: Record<string, number>): Record<string, number> {
  const twin = (e: string) => e.replace(/\d+$/, (d) => String(Number(d) % 2 ? Number(d) + 1 : Number(d) - 1));
  return Object.fromEntries(Object.entries(field).map(([e, w]) => [twin(e), w]));
}

/**
 * The field of a temporal lobe seizure on the scalp — a region, not an electrode.
 *
 * Source: learningeeg, Seizures, the left temporal focal seizure (panorama
 * `l-temporal-focal-seizure-tabs`, page 2). Every row was traced and read at the
 * seizure's own frequency, for amplitude and for the share that is in step with
 * Fp1-F7 — signed, so that the rows of a chain can be summed back into potentials.
 * Early, at 2.7 Hz: Fp1-F7 +1, F7-T3 -0.03, T3-T5 -0.92, T5-O1 -0.69, Fp1-F3 +0.18,
 * F3-C3 -0.30, C3-P3 -0.23, P3-O1 -0.25. Summed from O1 those put F7 at the peak,
 * T3 at 0.98 of it, F3 0.48, T5 0.42, Fp1 0.38, C3 0.29, P3 0.15 — and Fp1 comes
 * out the same up either chain (0.39 and 0.37), which is the check that the
 * reading holds together. Later in the same seizure, at 2.35 Hz, the maximum has
 * moved back to T3, with F7 at 0.70 and T5 at 0.60 of it.
 *
 * ANTERIOR is the early picture, fitted (fitField.ts). It gives rows of -0.03,
 * -0.95, -0.56, +0.18, -0.32, -0.25 and -0.15 of Fp1-F7, each within 0.13 of the
 * figure. F7 and T3 see the same voltage, so the link between them is flat: this is
 * the seizure's between-two-electrodes placement.
 *
 * MID is the same spread about T3, for the under-the-electrode placement: T3 at
 * the peak, F7 at 0.42 of it, T5 at 0.39, C3 at 0.38. That is the low end of what
 * the figure shows for the electrodes beside the maximum (0.42 early, 0.60-0.70
 * late), taken so that T3 stays the unmistakable focus with the rows falling away
 * on both sides of it (IK-003). The single patch it replaces had them at 0.24 and
 * 0.17 — under the 5%-of-power floor IK-003 sets, which is why that entry stood
 * violated from 2026-09-22 until this.
 *
 * What one source cannot give: in the figure the parasagittal rows are as large as
 * these weights make them but lag the temporal ones, and F7-T3 carries half of
 * Fp1-F7's amplitude out of step with it. A real seizure travels; this field does
 * not.
 */
export const MID_TEMPORAL_REGIONAL: Record<string, number> = { T3: 1, F7: 0.35, T5: 0.35, C3: 0.35, Cz: 0.1 };
export const ANTERIOR_TEMPORAL_REGIONAL: Record<string, number> = {
  F7: 1, T3: 0.95, T5: 0.35, Fp1: 0.3, F3: 0.2, C3: 0.15, P3: 0.05, Fz: 0.05, Cz: 0.05,
};

/**
 * The vertex wave: maximal at the vertex and spread over both parasagittal chains.
 *
 * IFCN glossary: "maximal at the vertex, negative relative to other areas".
 * learningeeg's vertex-wave figure: "symmetric discharge maximal over the
 * parasagittal and central chains", the wave on all four rows of each
 * parasagittal chain and little on the temporal ones. That figure's rows are 30 px
 * apart under a busy background and could not be read row by row reliably (two
 * readings disagreed), so this is a DESIGN target set to give its picture, not a
 * measurement: Cz 1, C3/C4 0.7, Fz/Pz 0.45, F3/F4 and P3/P4 0.3, T3/T4 0.12, the
 * frontopolar, occipital, F7/F8 and T5/T6 electrodes 0 — fitted with fitField.ts.
 * On the double banana it gives, as a share of the largest row: Fz-Cz/Cz-Pz 0.96
 * and 1, F-C 0.68, C-P 0.74, Fp-F 0.48 and P-O 0.48 (each the same way as its
 * neighbour: the reversal at C3/C4, the wave carrying on down the chain, smaller,
 * as the owner described it on 2026-10-22), and on the temporal chains F7-T3 0.21,
 * T3-T5 0.19. The patch set it replaces (Cz, C3/C4, Fz/Pz only) left F3/F4 and
 * P3/P4 at 0.02 and 0.00 of the peak: Fp-F and P-O moved only because the
 * frontopolar and occipital electrodes swung slightly the other way.
 */
export const VERTEX_FIELD: Record<string, number> = {
  Cz: 1, C3: 0.75, C4: 0.75, Fz: 0.55, Pz: 0.55, P3: 0.4, P4: 0.4, F3: 0.35, F4: 0.35,
  Fp1: 0.35, Fp2: 0.35, T3: 0.35, T4: 0.35, O1: 0.3, O2: 0.3, T5: 0.25, T6: 0.25, F7: 0.2, F8: 0.2,
};
