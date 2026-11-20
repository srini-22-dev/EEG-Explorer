/**
 * Validation battery for the EEG engine (briefing §11).
 *
 * Run: pnpm --filter @workspace/scripts run validate
 *      ... run validate -- --only <regex>   just the sections whose step or title matches
 *      ... run validate -- --list           the steps and sections, without running them
 *
 * The checks live in gate/stepNN-*.ts, one file per step, in the order below; shared
 * helpers in gate/harness.ts. This file runs them, then audits the knowledge base.
 *
 * Grows one section per §14 build step. The rule from §11 that shapes this file:
 * never validate using the statistic you fitted. The aperiodic exponent is set as
 * a target in the time domain (a weighted sum of OU relaxation times) and checked
 * in the frequency domain by an independent specparam-style spectral fit, so
 * agreement is evidence rather than tautology.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NEAR_BOUND_FRACTION, nearBound, results, sections, tally } from './gate/harness';

import './gate/step01-aperiodic-background';
import './gate/step02-oscillations';
import './gate/step03-waveform-shape';
import './gate/step04-09-full-engine';
import './gate/step11-sleep-grapho-elements';
import './gate/step12-non-epileptiform-abnormalities';
import './gate/step13-normal-variants';
import './gate/step14-chewing-artifact';
import './gate/step15-interictal-epileptiform';
import './gate/step16-ictal-seizure-sources';
import './gate/step17-activation-procedures';
import './gate/step18-contextual-artifact-controls';
import './gate/step19-sleep-grapho-elements-in';
import './gate/step19b-sleep-architecture-against-its';
import './gate/step20-normal-variants-in-display';
import './gate/step22-ictal-in-display-space';
import './gate/step23-calibration-and-amplitude-invariants';
import './gate/step21-epileptiform-in-display-space';
import './gate/step24-non-epileptiform-in-display';
import './gate/step25-fields-and-timing-against';
import './gate/step26-toggle-rules-no-contradictory';
import './gate/step27-annotation-arrows-every-artifact';
import './gate/step28-normal-variants-and-artifacts';

const onlyAt = process.argv.indexOf('--only');
const only = onlyAt >= 0 ? new RegExp(process.argv[onlyAt + 1] ?? '', 'i') : null;
if (process.argv.includes('--list')) {
  let last = '';
  for (const s of sections) {
    if (s.step !== last) { console.log(s.step.trim()); last = s.step; }
    console.log('  ' + (s.name || '(untitled)').trim());
  }
  process.exit(0);
}

let lastStep = '';
let ran = 0;
for (const s of sections) {
  if (only && !only.test(`${s.step} ${s.name}`)) continue;
  if (s.step !== lastStep) { console.log(s.step); lastStep = s.step; }
  if (s.title !== null) console.log(s.title);
  s.run();
  ran++;
}

if (only) {
  // A partial run cannot audit the knowledge base (its citations name checks that did not run),
  // and is not a verification: CLAUDE.md §7 still needs the full gate before a change is reported.
  console.log('\n' + '='.repeat(60));
  console.log(`PARTIAL RUN (--only ${only.source}): ${ran} of ${sections.length} sections, ${results.length} checks.`);
  console.log('Knowledge-base audit skipped. Run the full gate before reporting a change.');
  for (const n of nearBound) console.log(`  near bound: ${n}`);
  console.log(tally.failures === 0 ? 'ALL SELECTED CHECKS PASSED' : `${tally.failures} CHECK(S) FAILED`);
  process.exit(tally.failures === 0 ? 0 : 1);
}


console.log('\n' + '='.repeat(60));
// ---------------------------------------------------------------------------
// Knowledge-base status audit — make INFORMING-KNOWLEDGE.md's status field
// load-bearing instead of decorative.
//
// Every entry in that file names the check(s) that enforce it and carries a
// status. Until 2026-09-01 nothing connected the two, and the result was exactly
// what you would predict: all 36 entries read `enforced (automated)`, four of
// their checks were red, and one of those entries also quoted a passing figure it
// had long since stopped producing. The file defines `violated` and had never
// used it, so a red check could sit indefinitely behind a green-looking entry.
//
// This closes the loop in both directions:
//   - an entry claiming `enforced` whose named check is FAILING is a lie, and
//   - an entry marked `violated` whose named checks all PASS is a stale defect
//     report that should be promoted back.
// Either fails the gate, so the status has to be maintained to stay green.
//
// Matching note: the markdown wraps long labels across lines and abbreviates the
// tail with an ellipsis, so a citation is normalised (whitespace collapsed, cut
// at the ellipsis) and matched as a PREFIX of the real labels. Citations matching
// nothing are reported but do not fail — some are deliberate (a retired check an
// entry documents as retired) and some are placeholders standing for a family of
// generated labels. They are listed so an entry that guards nothing stays visible.
console.log('Knowledge-base status audit (INFORMING-KNOWLEDGE.md):');
{
  const ikPath = fileURLToPath(new URL('../../INFORMING-KNOWLEDGE.md', import.meta.url));
  const ik = readFileSync(ikPath, 'utf8');

  const parts = ik.split(/^### (IK-\d+)[^\n]*$/m);
  const entries: { id: string; status: string; cited: string[] }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    // An entry's body ends at the next entry OR the next section heading. Without
    // the second boundary the trailing section 11 "Conflicts and open questions"
    // prose -- which names retired and violated checks -- was folded into whichever
    // entry came last, and would have blamed it for a failure it does not claim.
    const id = parts[i];
    const body = (parts[i + 1] ?? '').split(/^## /m)[0];
    const status = (body.match(/\*\*Status\.\*\*\s*([a-z ()]+)/) ?? [, '?'])[1].trim();
    const cited = [...body.matchAll(/check\('([^']+)'/g)]
      .map((m) => m[1].split('…')[0].replace(/\s+/g, ' ').trim())
      .filter((l) => l.length >= 12);
    entries.push({ id, status, cited });
  }

  // Compare on alphanumerics only. The markdown hard-wraps inside a quoted label,
  // and a wrap landing mid-word survives whitespace collapsing as "beta- range",
  // which no real label contains -- so a purely textual prefix match reports a live
  // check as unguarded. Stripping punctuation and case makes the comparison
  // indifferent to where the line happened to break.
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

  const unmatched: string[] = [];
  let bad = 0;
  for (const e of entries) {
    const matched = e.cited.flatMap((c) => {
      const hits = results.filter((r) => key(r.label).startsWith(key(c)));
      if (hits.length === 0) unmatched.push(`${e.id}: ${c}`);
      return hits;
    });
    const red = matched.filter((r) => !r.ok);
    if (e.status.startsWith('enforced') && red.length > 0) {
      bad++; tally.failures++;
      console.log(`  FAIL ${e.id} says "${e.status}" but ${red.length} of its check(s) are RED:`);
      for (const r of red) console.log(`         - ${r.label}`);
    }
    // An entry claiming automated enforcement whose citations resolve to NO real
    // check is guarded by nothing, however green the gate looks. Nothing trips this
    // today; it exists so a typo in a Check field, or a check renamed out from under
    // an entry, is caught at the moment it happens rather than years later by an
    // audit. Entries with no Check at all carry a status other than `enforced`.
    if (e.status.startsWith('enforced') && e.cited.length > 0 && matched.length === 0) {
      bad++; tally.failures++;
      console.log(`  FAIL ${e.id} says "${e.status}" but none of its ${e.cited.length} cited check(s) exist`);
    }
    if (e.status === 'violated' && matched.length > 0 && red.length === 0) {
      bad++; tally.failures++;
      console.log(`  FAIL ${e.id} says "violated" but all ${matched.length} of its checks now PASS`);
      console.log('         - promote it back to enforced (automated), or narrow the claim');
    }
  }
  console.log(`  ${entries.length} entries audited; ${bad} status mismatch(es).`);
  if (unmatched.length) {
    console.log(`  note: ${unmatched.length} cited label(s) matched no check (retired, or a`);
    console.log('        placeholder for generated labels) - not a failure:');
    for (const u of unmatched) console.log(`         - ${u}`);
  }
}

console.log(`
Near-bound review: ${nearBound.length} passing check(s) within ${NEAR_BOUND_FRACTION * 100}% of a bound.`);
console.log('  Each needs a stated reason in the report: is the MODEL wrong (the bound let it through), or');
console.log('  the BOUND (then say where its number comes from)? "It passes" is not a reason. CLAUDE.md §7.');
for (const n of nearBound) console.log(`  - ${n}`);
console.log(tally.failures === 0 ? 'ALL CHECKS PASSED' : `${tally.failures} CHECK(S) FAILED`);
process.exit(tally.failures === 0 ? 0 : 1);
