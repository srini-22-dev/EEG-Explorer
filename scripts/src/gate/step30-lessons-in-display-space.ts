import { LESSONS, type LessonClaim, type LessonView } from '../../../artifacts/eeg-simulator/src/utils/lessons';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { effective, quizPage } from '../../../artifacts/eeg-simulator/src/utils/toggleRules';
import { SimulationSource } from '../../../artifacts/eeg-simulator/src/engine/adapter';
import { commonAverage, computeChannelVoltage } from '../../../artifacts/eeg-simulator/src/utils/computeChannel';
import { DEFAULT_FILTERS, defaultArtifactParams, defaultIctalParamsMap, type PatientState, type SimSettings } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { FS, check, corr, section, step } from './harness';

// ---------------------------------------------------------------------------
// Step 30 — the Lessons section says what the page shows (2026-11-27)
//
// Each lesson names directions and sizes on rows ("F7-T3 points DOWN and T3-T5
// UP"). Those sentences are only as true as the engine they describe, and the
// tutorial's text has drifted from the page before. So every view's claims are
// asserted here on the page the app builds for it — the same quizPage, montage
// and focus option — with the view's `event` toggle isolated (same seed, on minus
// off) after the real montage transform.
// ---------------------------------------------------------------------------
step('\n=== Step 30: Lessons — every claim a lesson makes holds on its page ===\n');

const SECS = 30;
const SEED = 30;

/**
 * One page as the app runs it. Not `runDisplay`: that leaves the engine in script
 * mode, where a sleep stage switches its own graphoelements on whatever the
 * toggles say, so N1 with vertex waves off still had them and the lesson's event
 * cancelled to nothing. The app calls `useAppMode()` (EEGCanvas), where the toggles
 * alone decide, and opens at DEFAULT_FILTERS.
 */
function appPage(montageId: string, state: PatientState, patterns: string[], secs: number,
  focalPlacement?: 'under' | 'between') {
  const montage = MONTAGES[montageId];
  const settings: SimSettings = {
    speed: 30, sensitivity: 7, patientState: state, activePatterns: new Set(patterns),
    ictalParams: defaultIctalParamsMap(), artifactParams: defaultArtifactParams(),
    patternOptions: focalPlacement ? { focalPlacement } : undefined, filters: DEFAULT_FILTERS,
  };
  const src = new SimulationSource(SEED, FS);
  src.useAppMode();
  const n = Math.floor(secs * FS);
  const data = montage.channels.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const allV = src.next(settings);
    const avg = commonAverage(allV);
    for (let c = 0; c < montage.channels.length; c++) data[c][i] = computeChannelVoltage(montage.channels[c], src.t, allV, avg);
  }
  return { montage, data };
}

function contribution(view: LessonView): Record<string, Float64Array> {
  const page = quizPage(view.patterns);
  const on = [...effective(page)];
  const off = on.filter(id => id !== view.event);
  const a = appPage(view.montage, page.patientState, on, SECS, view.focalPlacement);
  const b = appPage(view.montage, page.patientState, off, SECS, view.focalPlacement);
  const out: Record<string, Float64Array> = {};
  a.montage.channels.forEach((ch, c) => {
    if (ch.group === 'ecg') return;
    out[ch.label] = a.data[c].map((v, k) => v - b.data[c][k]);
  });
  return out;
}

for (const lesson of LESSONS) {
  lesson.views.forEach((view, vi) => {
    const name = `lesson ${lesson.id} / ${vi + 1}`;
    section(null, () => {
      // Every row a view highlights must exist on its montage, or the highlight is silent.
      const labels = MONTAGES[view.montage].channels.map(c => c.label);
      check(`${name}: highlighted rows missing from ${view.montage}`,
        view.look.filter(r => !labels.includes(r)).length, 0, 0);
      if (!view.claims?.length) return;

      const rows = contribution(view);
      const anchor = rows[view.anchor!];
      let at = 0;
      for (let k = 1; k < anchor.length; k++) if (Math.abs(anchor[k]) > Math.abs(anchor[at])) at = k;
      const peak = Math.abs(anchor[at]);
      const v = (r: string) => {
        if (!rows[r]) throw new Error(`${name}: no row ${r}`);
        return rows[r][at];
      };

      for (const c of view.claims as LessonClaim[]) {
        switch (c.kind) {
          // Signed value at the anchor's peak, as a fraction of it: + is down on the page.
          case 'down': check(`${name}: ${c.row} deflects DOWN (signed / anchor peak)`, v(c.row) / peak, 0.05, 1e6); break;
          case 'up':   check(`${name}: ${c.row} deflects UP (signed / anchor peak)`, v(c.row) / peak, -1e6, -0.05); break;
          case 'larger':
            check(`${name}: ${c.row} larger than ${c.than} (ratio)`, Math.abs(v(c.row)) / Math.abs(v(c.than)), 1, 1e6); break;
          case 'largest': {
            const next = Math.max(...Object.keys(rows).filter(r => r !== c.row).map(r => Math.abs(v(r))));
            check(`${name}: ${c.row} is the largest row (ratio to the next)`, Math.abs(v(c.row)) / next, 1, 1e6); break;
          }
          case 'flat': {
            const flank = Math.max(Math.abs(v(c.flanks[0])), Math.abs(v(c.flanks[1])));
            check(`${name}: ${c.row} flat against its flanks (ratio to the larger)`, Math.abs(v(c.row)) / flank, 0, 0.25); break;
          }
          case 'opposite':
            check(`${name}: ${c.row} vs ${c.to} correlation (opposite)`, corr(rows[c.row], rows[c.to]), -1.001, -0.4); break;
        }
      }
    }, `${name}: ${lesson.title}`);
  });
}

// The bipolar-difference lesson says Fp1-F3 is exactly Fp1-A1 minus F3-A1. True by
// construction of computeChannelVoltage; asserted because the lesson rests on it.
section(null, () => {
  const page = quizPage(['blink']);
  const on = [...effective(page)];
  const ear = appPage('reference-ipsi', page.patientState, on, 6);
  const bip = appPage('bipolar-ap', page.patientState, on, 6);
  const row = (r: ReturnType<typeof appPage>, l: string) => r.data[r.montage.channels.findIndex(c => c.label === l)];
  const fp1 = row(ear, 'Fp1-A1'), f3 = row(ear, 'F3-A1'), d = row(bip, 'Fp1-F3');
  let err = 0, size = 0;
  for (let k = 0; k < d.length; k++) {
    err = Math.max(err, Math.abs(d[k] - (fp1[k] - f3[k])));
    size = Math.max(size, Math.abs(d[k]));
  }
  check('lesson bipolar-difference: Fp1-F3 - (Fp1-A1 - F3-A1), as a fraction of Fp1-F3', err / size, 0, 0.001);
}, 'lesson bipolar-difference: the subtraction is exact');
