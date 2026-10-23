/**
 * Fit `synchronousPatches` weights to a target scalp map, and print the row table
 * the result gives.
 *
 * WHY THIS EXISTS
 * ---------------
 * `sources/fields.ts` holds the patch weights of every generalized or regional
 * field, and says each is "a least-squares fit to a target potential map". This is
 * that fit. A weight is not the potential at its electrode — neighbouring patches
 * overlap and the field's return term takes a share — so weights typed in by hand
 * do not give the map they appear to describe. Describe the MAP you want, fit, and
 * read the row table before adopting anything.
 *
 * A target is a relative potential (0-1) per 10-20 site, mirrored left to right;
 * its absolute level is free, because no montage shows it. Weights are constrained
 * to be non-negative and are reported rounded to 0.05, largest = 1.
 *
 * What it prints for each target: the fitted weights; the potentials they give;
 * every longitudinal row as a share of the largest (signed, so reversals show);
 * the transverse rows on the same scale; anterior/posterior voltage on the
 * ipsilateral ear and midline/parasagittal on the common average — the two
 * quantities ACNS 2021 uses to call a generalized pattern frontally or midline
 * predominant (50% either way).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx ./src/fitField.ts            # the targets in fields.ts
 *   ... --target '{"Cz":1,"C3/C4":0.9,"Fz":0.55,...}' --extent 0.3        # one of your own
 *
 * Keys: Fz Cz Pz Fp1/Fp2 F3/F4 C3/C4 P3/P4 O1/O2 F7/F8 T3/T4 T5/T6 (all eleven).
 *
 * A LATERALIZED target names single electrodes instead ("T3", not "T3/T4"): one
 * patch is fitted under each electrode named, every scalp site not named is held
 * to zero, and the rows of BOTH sides are printed, since what such a field puts
 * across the midline is half of what there is to check.
 */
import { buildLeadfield, synchronousPatches, type SourceSpec } from '../../artifacts/eeg-simulator/src/engine/forward';
import { electrodePositions3D } from '../../artifacts/eeg-simulator/src/utils/electrodePositions3D';

const NAMES = Object.keys(electrodePositions3D);
const SCALP = NAMES.filter(n => n !== 'A1' && n !== 'A2');
const MIRRORED_KEYS = ['Fz', 'Cz', 'Pz', 'Fp1/Fp2', 'F3/F4', 'C3/C4', 'P3/P4', 'O1/O2', 'F7/F8', 'T3/T4', 'T5/T6'];
const LONGITUDINAL: [string, string][] = [
  ['Fp1', 'F3'], ['F3', 'C3'], ['C3', 'P3'], ['P3', 'O1'],
  ['Fp1', 'F7'], ['F7', 'T3'], ['T3', 'T5'], ['T5', 'O1'], ['Fz', 'Cz'], ['Cz', 'Pz'],
];
const TRANSVERSE: [string, string][] = [['F7', 'F3'], ['F3', 'Fz'], ['T3', 'C3'], ['C3', 'Cz'], ['T5', 'P3'], ['P3', 'Pz']];

type Target = Record<string, number>;

/** Expand `{ 'C3/C4': x, Cz: y }` to one weight per electrode. */
function mirrored(w: Target): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(w)) for (const e of k.split('/')) out[e] = v;
  return out;
}

function describe(label: string, spec: SourceSpec, lateral = false) {
  const L = buildLeadfield([spec]);
  const g: Record<string, number> = {};
  NAMES.forEach((n, i) => { g[n] = L.gainAt(i, 0); });
  const avg = SCALP.reduce((a, n) => a + g[n], 0) / SCALP.length;
  const rows = LONGITUDINAL.map(([a, b]) => g[a] - g[b]);
  const largest = Math.max(...rows.map(Math.abs));
  const meanAbs = (els: string[], f: (e: string) => number) => els.reduce((a, e) => a + Math.abs(f(e)), 0) / els.length;
  const ear = (e: string) => g[e] - g[/[13579]$/.test(e) ? 'A1' : 'A2'];
  const car = (e: string) => g[e] - avg;
  console.log(`  ${label}`);
  console.log('    potential (of the source amplitude): ' +
    ['Fp1', 'F7', 'F3', 'Fz', 'T3', 'C3', 'Cz', 'T5', 'P3', 'Pz', 'O1', 'A1'].map(n => `${n} ${g[n].toFixed(2)}`).join('  '));
  console.log('    rows / largest row: ' + LONGITUDINAL.map(([a, b], i) => `${a}-${b} ${(rows[i] / largest).toFixed(2)}`).join('  '));
  console.log(`    smallest / largest row ${Math.min(...rows.map(r => Math.abs(r) / largest)).toFixed(2)}; ` +
    `largest row is ${largest.toFixed(3)} of the source amplitude`);
  console.log('    transverse / largest longitudinal row: ' +
    TRANSVERSE.map(([a, b]) => `${a}-${b} ${((g[a] - g[b]) / largest).toFixed(2)}`).join('  '));
  if (lateral) {
    const right = (e: string) => e.replace(/[1357]$/, d => String(Number(d) + 1));
    console.log('    right-side rows / largest row: ' + LONGITUDINAL.filter(([a]) => !a.endsWith('z'))
      .map(([a, b]) => `${right(a)}-${right(b)} ${((g[right(a)] - g[right(b)]) / largest).toFixed(2)}`).join('  '));
    return;
  }
  console.log(`    anterior / posterior on the ipsilateral ear ${(meanAbs(['Fp1', 'Fp2', 'F3', 'F4', 'F7', 'F8'], ear) / meanAbs(['P3', 'P4', 'O1', 'O2', 'T5', 'T6'], ear)).toFixed(2)}; ` +
    `midline / parasagittal on the common average ${(meanAbs(['Fz', 'Cz', 'Pz'], car) / meanAbs(['F3', 'F4', 'C3', 'C4', 'P3', 'P4'], car)).toFixed(2)}`);
}

function fit(label: string, target: Target, extent: number) {
  // One column per patch group — mirrored pairs, or the single electrodes of a
  // lateralized target. Every patch sits at the same depth with the same extent,
  // so their columns share a peak and add linearly.
  const lateral = !Object.keys(target).some(k => k.includes('/'));
  const KEYS = lateral ? Object.keys(target) : MIRRORED_KEYS;
  const cols = KEYS.map(k => {
    const L = buildLeadfield([synchronousPatches('x', mirrored({ [k]: 1 }), { extent })]);
    return SCALP.map(n => L.gainAt(NAMES.indexOf(n), 0));
  });
  const want = SCALP.map(n => target[KEYS.find(k => k.split('/').includes(n)) ?? ''] ?? 0);
  // Projected gradient descent: weights >= 0, plus a free offset.
  let w = KEYS.map(() => 0.5), offset = 0;
  const rate = 0.02;
  for (let it = 0; it < 40000; it++) {
    const err = SCALP.map((_, e) => cols.reduce((a, c, i) => a + w[i] * c[e], 0) + offset - want[e]);
    const grad = cols.map(c => c.reduce((a, v, e) => a + v * err[e], 0));
    w = w.map((v, i) => Math.max(0, v - rate * grad[i]));
    offset -= rate * err.reduce((a, v) => a + v, 0) / SCALP.length;
  }
  const top = Math.max(...w);
  const rounded: Target = {};
  KEYS.forEach((k, i) => { rounded[k] = Math.round((w[i] / top) * 20) / 20; });
  console.log(`\n${label}  (extent ${extent})`);
  console.log('  target:  ' + JSON.stringify(target));
  console.log('  weights: ' + JSON.stringify(rounded));
  describe('fitted field', synchronousPatches('fit', mirrored(rounded), { extent }), lateral);
}

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const extent = Number(arg('--extent') ?? 0.3);
const custom = arg('--target');

if (custom) {
  fit('custom target', JSON.parse(custom), extent);
} else {
  // The targets behind sources/fields.ts and the GPEDs dome (nonEpileptiform.ts).
  fit('GPEDs — vertex-high dome, not midline predominant',
    { Fz: 0.55, Cz: 1, Pz: 0.55, 'F3/F4': 0.5, 'C3/C4': 0.9, 'P3/P4': 0.5, 'F7/F8': 0.33, 'T3/T4': 0.65, 'T5/T6': 0.33, 'Fp1/Fp2': 0.05, 'O1/O2': 0.05 }, extent);
  fit('GENERALIZED_FRONTAL — spike-and-wave, triphasic, hyperventilation',
    { Fz: 1, 'F3/F4': 0.9, 'F7/F8': 0.75, 'Fp1/Fp2': 0.45, Cz: 0.65, 'C3/C4': 0.55, 'T3/T4': 0.45, Pz: 0.35, 'P3/P4': 0.3, 'T5/T6': 0.25, 'O1/O2': 0.05 }, extent);
  fit('BIFRONTAL — FIRDA',
    { 'Fp1/Fp2': 1, Fz: 0.65, 'F3/F4': 0.6, 'F7/F8': 0.5, Cz: 0.2, 'C3/C4': 0.2, 'T3/T4': 0.15, Pz: 0.05, 'P3/P4': 0.05, 'T5/T6': 0.05, 'O1/O2': 0 }, extent);
  fit('GENERALIZED_POSTERIOR — triphasic (lagging half), 6 Hz phantom spike-wave (FOLD)',
    { 'O1/O2': 1, 'P3/P4': 0.85, Pz: 0.85, 'T5/T6': 0.7, Cz: 0.5, 'C3/C4': 0.5, 'T3/T4': 0.4, Fz: 0.25, 'F3/F4': 0.25, 'F7/F8': 0.2, 'Fp1/Fp2': 0.1 }, extent);
}
