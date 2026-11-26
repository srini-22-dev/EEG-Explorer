import type { PatientState } from '../../../artifacts/eeg-simulator/src/utils/simTypes';
import { welch, spectralPeak } from '../dsp';
import { MONTAGES } from '../../../artifacts/eeg-simulator/src/utils/montages';
import { FS, check, corr, largestStep, runDisplay, section, step } from './harness';

// ---------------------------------------------------------------------------
step('\n=== Step 19b: sleep architecture against its sources (2026-09-11 rebuild) ===\n');
// Each bound below comes from a source, not from the model (SLEEP-ARCHITECTURE-AUDIT.md):
// learningeeg Normal Asleep (LE), AASM Scoring Manual v2.0 (AASM), StatPearls NBK539805 (SP),
// Neupsy Key on POSTS (NPK), Colrain 2005 Sleep 28:255 (COL), healthy-adult spindle norms
// PMC12172134 (SPN). Everything is display space. An "isolated" trace is the same seed with the
// toggle on minus off, on the montage-derived channel: the background cancels exactly, so a
// transient's size, width and field are read without the background's help or interference.
// Before the rebuild, none of this was asserted, and every one of these would have failed:
// vertex waves and spindles were invisible off the midline, the K-complex cancelled on Fz-Cz,
// POSTS never came in trains and spread to C3-P3, and N3's delta was a vertex focus.

const isolated = (montageId: string, toggle: string, secs: number, seed: number) => {
  const off = runDisplay(montageId, 'awake', [], secs, seed);
  const on = runDisplay(montageId, 'awake', [toggle], secs, seed);
  const out: Record<string, Float64Array> = {};
  on.montage.channels.forEach((c, k) => {
    const d = new Float64Array(on.data[k].length);
    for (let i = 0; i < d.length; i++) d[i] = on.data[k][i] - off.data[k][i];
    out[c.label] = d;
  });
  return out;
};
/** Index of the extreme (sign +1 max, -1 min, 0 |max|) of each excursion past `thr`; excursions closer than `gapS` merge. */
const peaksPast = (x: Float64Array, thr: number, gapS: number, sign: number): number[] => {
  const val = (i: number) => (sign === 0 ? Math.abs(x[i]) : sign * x[i]);
  const gap = Math.round(gapS * FS);
  const out: number[] = [];
  let i = 0;
  while (i < x.length) {
    if (val(i) < thr) { i++; continue; }
    let best = i, last = i, j = i;
    while (j < x.length && j - last <= gap) {
      if (val(j) >= thr) { last = j; if (val(j) > val(best)) best = j; }
      j++;
    }
    out.push(best);
    i = j;
  }
  return out;
};
const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
const peakAbs = (x: Float64Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const argAbsMax = (x: Float64Array) => { let b = 0; for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[b])) b = i; return b; };
const power = (x: Float64Array) => x.reduce((a, v) => a + v * v, 0);
/** Rolling max of |x| over +-40 ms: a burst envelope that spans a full 11-16 Hz cycle. */
const envelope = (x: Float64Array) => {
  const w = Math.round(0.04 * FS), e = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let m = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(x.length - 1, i + w); k++) m = Math.max(m, Math.abs(x[k]));
    e[i] = m;
  }
  return e;
};
const bandRms = (x: Float64Array, lo: number, hi: number) => {
  const p = welch(x, FS, 2048);
  let s = 0;
  for (let k = 0; k < p.freqs.length; k++) if (p.freqs[k] >= lo && p.freqs[k] < hi) s += p.power[k];
  return Math.sqrt(s);
};

section('POSTS (NPK: surface-positive, 20-75 uV, 80-200 ms, singly more than 1 s apart; LE: on the occipital link):', () => {
  const ref = isolated('reference-ipsi', 'posts', 180, 20);
  const o1 = ref['O1-A1'];
  const pk = peaksPast(o1, 5, 0.03, +1);
  // One at a time since 2026-10-12 (owner's decision; sleep.ts). NPK gives singles
  // as "more than 1 s apart", which caps the count at one a second. Since 2026-11-16
  // 1-2 per 10 s page at 30 mm/s (owner): 18-36 in 180 s, with room for the jitter.
  check('POSTS: transients in 180 s (owner 2026-11-16: 1-2 per 10 s page)', pk.length, 15, 40);
  // Sides (owner 2026-11-16; sleep.ts): POSTS are "bilateral, but not necessarily
  // symmetric" (learningeeg; Rey et al. 2009, a consistent asymmetry in 38% of
  // recordings). Here, by the owner's choice for teaching, random per POSTS: the
  // smaller side of a bilateral one is down 40% on the page at the default slider,
  // and 5% are on one side only. Both occiputs fire together, so O1's peak
  // sample is O2's. The page drop is 1 - smaller/larger; one-sided POSTS (the absent
  // occiput showing only the ~19% that volume-conducts across) are drops past 0.7.
  // The instrument's own ~3.5% O1/O2 gain difference (chain.ts) rides on every one.
  const o2 = ref['O2-A2'];
  const drops = (a: Float64Array, b: Float64Array, at: number[]) =>
    at.map(i => ({ drop: 1 - Math.min(Math.abs(a[i]), Math.abs(b[i])) / Math.max(Math.abs(a[i]), Math.abs(b[i])), o1Low: Math.abs(a[i]) < Math.abs(b[i]) }));
  // Peaks on either occiput: a POSTS on the right alone barely shows at O1.
  const evAt = peaksPast(Float64Array.from(o1, (v, i) => Math.max(v, o2[i])), 5, 0.03, +1);
  const dr = drops(o1, o2, evAt), bil = dr.filter(e => e.drop < 0.7);
  check('POSTS sides: median page drop of the smaller side, bilateral ones (owner 2026-11-16: 40%)', median(bil.map(e => e.drop)), 0.34, 0.46);
  check('POSTS sides: smallest page drop of a bilateral one (a side labelled smaller looks it)', Math.min(...bil.map(e => e.drop)), 0.25, 0.7);
  check('POSTS sides: share with O1 the smaller side (either side, at random)', bil.filter(e => e.o1Low).length / bil.length, 0.2, 0.8);
  {
    // The one-side slider at 50%, so the mechanism has enough events to measure.
    const iso = (on: boolean) => runDisplay('reference-ipsi', 'awake', on ? ['posts'] : [], 300, 20, { postsOneSidePct: 50 });
    const a = iso(true), b = iso(false);
    const col = (r: ReturnType<typeof iso>, lab: string) => r.data[r.montage.channels.findIndex(c => c.label === lab)];
    const p1 = col(a, 'O1-A1').map((v, i) => v - col(b, 'O1-A1')[i]), p2 = col(a, 'O2-A2').map((v, i) => v - col(b, 'O2-A2')[i]);
    const d2 = drops(p1, p2, peaksPast(Float64Array.from(p1, (v, i) => Math.max(v, p2[i])), 5, 0.03, +1));
    const one = d2.filter(e => e.drop >= 0.7);
    check('POSTS sides: share on one side only, slider at 50%', one.length / d2.length, 0.3, 0.7);
    check('POSTS sides: absent occiput / present occiput, one-sided ones, median (volume conduction only)', median(one.map(e => 1 - e.drop)), 0, 0.25);
  }
  // A POSTS's size is that of its larger side: since 2026-11-16 one side is often
  // 40% smaller, so O1 alone read the smaller side half the time (median 21.9 uV
  // against NPK's floor of 20, from 30.8) — the estimator, not the model, at fault.
  const big = (i: number) => Math.max(o1[i], ref['O2-A2'][i]);
  check('POSTS larger occiput (O1-A1 / O2-A2) median peak (NPK: 20-75 uV)', median(pk.map(big)), 20, 75, ' uV');
  check('POSTS larger occiput (O1-A1 / O2-A2) largest peak (NPK: up to ~120 uV)', Math.max(...pk.map(big)), 20, 120, ' uV');
  const dur = pk.map(i => {
    const t = 0.05 * o1[i]; let a = i, b = i;
    while (a > 0 && o1[a] > t) a--;
    while (b < o1.length - 1 && o1[b] > t) b++;
    return (b - a) / FS;
  });
  check('POSTS O1-A1 median duration (NPK: 80-200 ms)', median(dur), 0.08, 0.2, ' s');
  // These two replaced `POSTS within-train rate` and `POSTS share of events that
  // are single`, which asserted the half-singles, half-trains mix the source drew
  // until 2026-10-12.
  const gaps = pk.slice(1).map((v, k) => (v - pk[k]) / FS);
  check('POSTS shortest interval between transients (NPK: singly, more than 1 s apart)', Math.min(...gaps), 1, Infinity, ' s');
  check('POSTS largest change between consecutive intervals (NPK: "without periodicity"; LEARNINGEEG: not periodic past 50%)',
    largestStep(gaps), 0.5, Infinity);
  const bip = isolated('bipolar-ap', 'posts', 120, 20);
  check('POSTS field C3-P3 / P3-O1 (LE: on the occipital link only)', peakAbs(bip['C3-P3']) / peakAbs(bip['P3-O1']), 0, 0.35);
  check('POSTS field T3-T5 / T5-O1 (LE: on the occipital link only)', peakAbs(bip['T3-T5']) / peakAbs(bip['T5-O1']), 0, 0.35);
  check('POSTS render UP on P3-O1, bipolar-ap (O1 positive is input 2)', Math.sign(bip['P3-O1'][argAbsMax(bip['P3-O1'])]), -1, -1);

  // The other form, chosen with the POSTS option (sleep.ts): the same elements,
  // in trains. NPK: "trains of up to 4-6 per second lasting about a second".
  const trainsRun = (on: boolean) =>
    runDisplay('reference-ipsi', 'awake', on ? ['posts'] : [], 180, 20, { postsForm: 'trains' });
  const trOn = trainsRun(true), trOff = trainsRun(false);
  const kO1 = trOn.montage.channels.findIndex(c => c.label === 'O1-A1');
  const tr = trOn.data[kO1].map((v, i) => v - trOff.data[kO1][i]);
  const kO2 = trOn.montage.channels.findIndex(c => c.label === 'O2-A2');
  const tr2 = trOn.data[kO2].map((v, i) => v - trOff.data[kO2][i]);
  const trPk = peaksPast(tr, 5, 0.03, +1);
  const trGaps = trPk.slice(1).map((v, k) => (v - trPk[k]) / FS);
  // Consecutive transients under 0.5 s apart belong to one train.
  const trSizes: number[] = [];
  let trSize = 1;
  for (const g of trGaps) { if (g < 0.5) trSize++; else { trSizes.push(trSize); trSize = 1; } }
  trSizes.push(trSize);
  check('POSTS trains: within-train rate (NPK: trains of 4-6 per second)', 1 / median(trGaps.filter(g => g < 0.5)), 4, 6.5, ' Hz');
  check('POSTS trains: elements per train, median (NPK: about a second at 4-6 per second)', median(trSizes), 2, 6);
  check('POSTS trains: larger occiput median peak (NPK: 20-75 uV)', median(trPk.map(i => Math.max(tr[i], tr2[i]))), 20, 75, ' uV');
});

section('\nVertex waves (SP: surface-negative, ~100 ms, reversing at the vertex; AASM: < 0.5 s; LE: parasagittal AND central chains):', () => {
  const ref = isolated('reference-ipsi', 'v-waves', 180, 20);
  const cz = ref['Cz-A1'], c3 = ref['C3-A1'];
  const pk = peaksPast(cz, 20, 0.2, -1);
  check('V-waves in 180 s', pk.length, 12, 60);
  // Was 70-200 against "adults usually 100-150 uV", a figure attributed to
  // Niedermeyer at second hand. Teaching references give 50-150 uV (sleep.ts), and
  // the source was brought down to the floor of that on 2026-10-12.
  check('V-wave Cz-A1 median negative peak (teaching references: 50-150 uV)', -median(pk.map(i => cz[i])), 50, 150, ' uV');
  const base = pk.map(i => {
    const t = 0.1 * cz[i]; let a = i, b = i;
    while (a > 0 && cz[a] < t) a--;
    while (b < cz.length - 1 && cz[b] < t) b++;
    return (b - a) / FS;
  });
  check('V-wave negative wave base width, Cz-A1 (SP: ~100 ms)', median(base), 0.07, 0.2, ' s');
  const whole = pk.map(i => {
    const t = 0.05 * Math.abs(cz[i]), w = Math.round(0.4 * FS); let a = i, b = i;
    for (let k = Math.max(0, i - w); k <= Math.min(cz.length - 1, i + w); k++) {
      if (Math.abs(cz[k]) > t) { a = Math.min(a, k); b = Math.max(b, k); }
    }
    return (b - a) / FS;
  });
  check('V-wave whole duration incl. positive phases, Cz-A1 (AASM: < 0.5 s)', median(whole), 0.15, 0.5, ' s');
  check('V-wave C3-A1 / Cz-A1 (bilateral central field, not a point at Cz)', median(pk.map(i => c3[i] / cz[i])), 0.4, 0.9);
  const bip = isolated('bipolar-ap', 'v-waves', 120, 20);
  check('V-wave F3-C3 / Fz-Cz (LE: over the parasagittal chains too)', peakAbs(bip['F3-C3']) / peakAbs(bip['Fz-Cz']), 0.4, 2);
  // The ceiling was 0.2, with no source. Since 2026-10-22 the temporal chains carry a small
  // wave on purpose (owner; learningeeg's figure shows a little there), which reads 0.2; the
  // field check above holds them under 0.6 of the parasagittal rows.
  check('V-wave T3-T5 / Fz-Cz (not a temporal field)', peakAbs(bip['T3-T5']) / peakAbs(bip['Fz-Cz']), 0, 0.35);
  const at = argAbsMax(bip['Fz-Cz']);
  check('V-wave reverses at C3 (sign of F3-C3 x C3-P3 at the peak)', Math.sign(bip['F3-C3'][at]) * Math.sign(bip['C3-P3'][at]), -1, -1);
});

// POSTS a quarter smaller (owner, 2026-11-16: "reduce the amplitude of POSTS by 20
// to 30%"). Read where the owner reads it, on the double banana: each event's largest
// row, POSTS on the occipital links and vertex waves on the central and midline ones.
// Before the cut POSTS were 0.80 of a vertex wave there (23.1 against 29.1 uV); the
// 25% cut puts them near 0.6.

section('\nPOSTS against vertex waves on the double banana (owner 2026-11-16):', () => {
  const eventPeaks = (rows: Record<string, Float64Array>, labs: string[], gapS: number) => {
    const n = rows[labs[0]].length, env = new Float64Array(n);
    for (let i = 0; i < n; i++) env[i] = Math.max(...labs.map(l => Math.abs(rows[l][i])));
    const top = Math.max(...env), gap = Math.round(gapS * FS), out: number[] = [];
    for (let i = 0; i < n;) {
      if (env[i] > 0.25 * top) {
        let b = i;
        for (let k = i; k < Math.min(n, i + gap); k++) if (env[k] > env[b]) b = k;
        out.push(env[b]); i = b + gap;
      } else i++;
    }
    return out;
  };
  const pp = eventPeaks(isolated('bipolar-ap', 'posts', 240, 20), ['P3-O1', 'T5-O1', 'P4-O2', 'T6-O2'], 1);
  const vp = eventPeaks(isolated('bipolar-ap', 'v-waves', 240, 20), ['Fz-Cz', 'Cz-Pz', 'F3-C3', 'C3-P3', 'F4-C4', 'C4-P4'], 0.5);
  check('POSTS / vertex wave, median of each event largest bipolar-ap row (owner 2026-11-16: POSTS cut 25%, from 0.80)',
    median(pp) / median(vp), 0.5, 0.72);
});

section('\nK-complexes (AASM: negative sharp wave then positive component, >= 0.5 s, frontal max; COL; LE: diffuse, often followed by a spindle):', () => {
  const ref = isolated('reference-ipsi', 'k-complex', 240, 20);
  const fz = ref['Fz-A1'], cz = ref['Cz-A1'], pz = ref['Pz-A1'];
  const pk = peaksPast(fz, 30, 1.5, -1);
  check('K-complexes in 240 s (spontaneous ~1-3/min)', pk.length, 6, 20);
  check('KC frontal maximum: Fz-A1 / Cz-A1 negative peak (AASM, COL)', median(pk.map(i => fz[i] / cz[i])), 1.0, 3);
  check('KC Fz-A1 / Pz-A1 negative peak (frontal, not parietal)', median(pk.map(i => fz[i] / pz[i])), 1.5, 10);
  const posPk = pk.map(i => { let m = i; for (let k = i; k < Math.min(fz.length, i + FS); k++) if (fz[k] > fz[m]) m = k; return m; });
  check('KC Fz-A1 peak-to-peak (stands out from the background, >75 uV)', median(pk.map((i, n) => fz[posPk[n]] - fz[i])), 75, 400, ' uV');
  check('KC positive / negative component (negative dominant, COL)', median(pk.map((i, n) => fz[posPk[n]] / -fz[i])), 0.3, 0.9);
  const dur = pk.map((i, n) => {
    const tn = 0.1 * fz[i]; let a = i;
    while (a > 0 && fz[a] < tn) a--;
    const tp = 0.1 * fz[posPk[n]]; let b = posPk[n];
    while (b < fz.length - 1 && fz[b] > tp) b++;
    return (b - a) / FS;
  });
  check('KC total duration, Fz-A1 (AASM: >= 0.5 s)', median(dur), 0.5, 1.6, ' s');
  // A spindle after the complex survives a 100 ms moving-average subtraction; the
  // complex's own smooth positive wave leaves under ~1 uV of residual.
  const followed = pk.filter(i => {
    const a = i + Math.round(0.3 * FS), b = Math.min(fz.length, i + Math.round(2.2 * FS));
    let s = 0;
    for (let k = a; k < b; k++) {
      let m = 0;
      for (let j = -12; j <= 12; j++) m += fz[Math.min(fz.length - 1, Math.max(0, k + j))];
      s += (fz[k] - m / 25) ** 2;
    }
    return Math.sqrt(s / Math.max(1, b - a)) > 3;
  }).length;
  check('KCs followed by a spindle (LE: often but not always)', followed / pk.length, 0.3, 0.9);
  const bip = isolated('bipolar-ap', 'k-complex', 180, 20);
  const rows = MONTAGES['bipolar-ap'].channels.filter(c => c.label !== 'ECG').map(c => c.label);
  const big = Math.max(...rows.map(l => peakAbs(bip[l])));
  check('KC diffuse: F7-T3 / largest row (LE: on every chain)', peakAbs(bip['F7-T3']) / big, 0.2, 1);
  check('KC diffuse: P3-O1 / largest row', peakAbs(bip['P3-O1']) / big, 0.1, 1);
  check('KC not cancelled on the midline: Fz-Cz / largest row', peakAbs(bip['Fz-Cz']) / big, 0.35, 1);
});

section('\nSpindles (AASM: 11-16 Hz, >= 0.5 s, central max; LE: symmetric; SPN: fast central 13.4-14.3 Hz, slow frontal 12.3-12.9 Hz, 5-15 uV):', () => {
  const ref = isolated('reference-ipsi', 'spindles', 300, 20);
  const ec = envelope(ref['Cz-A1']), ef = envelope(ref['Fz-A1']);
  const comb = ec.map((v, i) => Math.max(v, ef[i]));
  const pk = peaksPast(comb, 3, 0.3, +1);
  check('spindles in 300 s (SPN: ~1-6/min per population)', pk.length, 10, 45);
  const dur = pk.map(i => {
    const t = 0.2 * comb[i]; let a = i, b = i;
    while (a > 0 && comb[a] > t) a--;
    while (b < comb.length - 1 && comb[b] > t) b++;
    return (b - a) / FS;
  });
  check('spindle median visible duration (AASM >= 0.5 s; SPN 0.8-1.1 s)', median(dur), 0.5, 2.0, ' s');
  check('spindle shortest visible duration (AASM floor 0.5 s)', Math.min(...dur), 0.4, 2.0, ' s');
  check('slow spindles: Fz-A1 peak frequency (SPN 12.3-12.9; slow ~11-13 Hz)', spectralPeak(welch(ref['Fz-A1'], FS, 2048), 9, 18).freq, 11, 13.2, ' Hz');
  check('fast spindles: Pz-A1 peak frequency (SPN 13.4-14.3; fast ~13-15 Hz)', spectralPeak(welch(ref['Pz-A1'], FS, 2048), 9, 18).freq, 13, 15, ' Hz');
  const c3e = envelope(ref['C3-A1']);
  check('spindle C3-A1 median peak (SPN: 5.2-15.2 uV)', median(peaksPast(c3e, 2, 0.3, +1).map(i => c3e[i])), 5, 16, ' uV');
  check('spindle symmetry C3-A1 / C4-A2 power (LE: symmetric)', power(ref['C3-A1']) / power(ref['C4-A2']), 0.8, 1.25);
  const bip = isolated('bipolar-ap', 'spindles', 180, 20);
  check('spindles on the parasagittal chain: F3-C3 / Fz-Cz RMS', Math.sqrt(power(bip['F3-C3']) / power(bip['Fz-Cz'])), 0.4, 3);
});

section('\nSleep background: N3 slow waves (AASM, LE) and quiet midline rows in drowsiness and N1:', () => {
  // AASM slow-wave activity: time inside full waves of 0.5-2 Hz with >75 uV peak-to-peak.
  // Waves are cut at upward zero crossings of a zero-phase 0.3-2 Hz band-limited copy.
  const lowpass = (x: Float64Array, fc: number) => {
    const a = Math.exp(-2 * Math.PI * fc / FS), y = new Float64Array(x.length);
    let s = x[0];
    for (let i = 0; i < x.length; i++) { s = a * s + (1 - a) * x[i]; y[i] = s; }
    return y;
  };
  const zeroPhase = (x: Float64Array, fc: number) => lowpass(lowpass(x, fc).reverse(), fc).reverse();
  const swaFraction = (x: Float64Array) => {
    const lo = zeroPhase(zeroPhase(x, 2), 2), slow = zeroPhase(lo, 0.3);
    const y = lo.map((v, i) => v - slow[i]);
    let prev = -1, qual = 0;
    for (let i = 1; i < y.length; i++) {
      if (!(y[i - 1] < 0 && y[i] >= 0)) continue;
      if (prev >= 0) {
        const d = (i - prev) / FS;
        if (d >= 0.5 && d <= 2) {
          let mx = -Infinity, mn = Infinity;
          for (let k = prev; k < i; k++) { mx = Math.max(mx, x[k]); mn = Math.min(mn, x[k]); }
          if (mx - mn > 75) qual += i - prev;
        }
      }
      prev = i;
    }
    return qual / y.length;
  };
  const epochs = (x: Float64Array) => [x.subarray(0, 30 * FS), x.subarray(30 * FS, 60 * FS)];
  const n3Min: number[] = [], n2Max: number[] = [];
  const post: number[] = [], mid: number[] = [], frontOcc: number[] = [], sync: number[] = [];
  for (const seed of [5, 42, 777]) {
    const c3 = runDisplay('reference-contra', 'n3', [], 60, seed);
    const c2 = runDisplay('reference-contra', 'n2', [], 60, seed);
    const ch = (r: typeof c3, l: string) => r.data[r.montage.channels.findIndex(c => c.label === l)];
    const f = (r: typeof c3) => [...epochs(ch(r, 'F4-A1')), ...epochs(ch(r, 'F3-A2'))].map(swaFraction);
    n3Min.push(Math.min(...f(c3)));
    n2Max.push(Math.max(...f(c2)));
    const b = runDisplay('bipolar-ap', 'n3', [], 60, seed);
    const bd = (l: string) => bandRms(ch(b, l), 0.5, 2);
    post.push(Math.min(bd('T5-O1') / bd('Fp1-F7'), bd('T6-O2') / bd('Fp2-F8')));
    mid.push(bd('Fz-Cz') / median(['Fp1-F3', 'F3-C3', 'C3-P3', 'P3-O1', 'Fp2-F4', 'F4-C4', 'C4-P4', 'P4-O2'].map(bd)));
    const r = runDisplay('reference-ipsi', 'n3', [], 60, seed);
    frontOcc.push(bandRms(ch(r, 'F3-A1'), 0.5, 2) / bandRms(ch(r, 'O1-A1'), 0.5, 2));
    sync.push(corr(zeroPhase(ch(r, 'F3-A1'), 2), zeroPhase(ch(r, 'F4-A2'), 2)));
  }
  check('N3: AASM slow-wave activity in the least slow 30 s epoch, F4-A1/F3-A2 (N3 needs >= 20%)', Math.min(...n3Min), 0.2, 1);
  check('N2: AASM slow-wave activity in the slowest 30 s epoch (N2 stays under 20%)', Math.max(...n2Max), 0, 0.2);
  check('N3 delta reaches the posterior chains: T5-O1/Fp1-F7 and T6-O2/Fp2-F8 (LE figure)', Math.min(...post), 0.5, 2);
  check('N3 midline not dominant: Fz-Cz / median parasagittal delta', Math.max(...mid), 0, 1.5);
  check('N3 frontally predominant: F3-A1 / O1-A1 delta (AASM: measured frontally)', Math.min(...frontOcc), 1.15, 5);
  check('N3 synchronized: F3-A1 vs F4-A2 slow-wave correlation (LE: synchronized)', Math.min(...sync), 0.5, 1);
  for (const st of ['drowsy', 'n1'] as PatientState[]) {
    const dom: number[] = [];
    for (const seed of [5, 42, 777]) {
      const b = runDisplay('bipolar-ap', st, [], 60, seed);
      const rms = (x: Float64Array) => Math.sqrt(power(x) / x.length);
      const others = b.montage.channels.filter(c => !['ECG', 'Fz-Cz', 'Cz-Pz'].includes(c.label)).map((c) => rms(b.data[b.montage.channels.indexOf(c)]));
      const midRms = Math.max(...['Fz-Cz', 'Cz-Pz'].map(l => rms(b.data[b.montage.channels.findIndex(c => c.label === l)])));
      dom.push(midRms / median(others));
    }
    check(`${st}: midline rows no louder than the rest (max midline RMS / median row)`, Math.max(...dom), 0, 1.4);
  }
});
