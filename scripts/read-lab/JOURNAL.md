# Reading lab — journal

The lab exists to make the reader better, because the generator can only get better as fast as
its reader can. Every iteration is one loop of **research → reason → test → analyse → reason**,
and gets one dated entry here, written *before* the test (hypothesis, prediction, negative
control, what would falsify it) and completed after (numbers, verdict, what moved where).

Where things go:
- validated **rules** → `.claude/skills/read/SKILL.md`
- their **evidence and method tables** → `.claude/skills/read/comparing-to-a-reference.md`
- **generator findings** (the engine page does not read like the real thing) → reported to the
  user; never a silent engine fix, never an IK edit without `/ik` approval.

Layout:
- `py/` — extraction methods (numpy / PIL / scipy) and benches
- `corpus/truthpaths/` — engine renders saved with the EXACT y(x) of every row (tracked)
- `corpus/online/` — third-party reference figures (gitignored; see `corpus/online.json`)
- `corpus/engine/` — generated engine corpora with truth JSON (gitignored, reproducible)
- `corpus/archive-6a96b6eb/` — raw provenance from the session that built the first lab
- `../*.png` (in `scripts/`) — 30 legacy renders, the user's preliminary corpus; mostly from
  older engine versions, so unscored — see `corpus/legacy.json`

---

## 2026-09-10 — Iteration 0: rescue, and does the lab reproduce its own published numbers?

**Why.** Every table in the skill's reference-comparison section was measured with code that
lived only in session `6a96b6eb`'s temp scratchpad, and the skill's own Finishing rule deleted
probes each session. Copied here verbatim (`py/extract.py`, `trackers.py`, `fillers.py`,
`labels.py`, `shape.py`), with the 30 figures, the cached chapter HTML and the three truth-path
renders.

**Hypothesis.** Run unchanged against the truth-path renders, the methods reproduce the published
figures within a few percentage points. Falsified if any headline figure is off by more than ~2×.

**Test.** `python py/bench_truthpaths.py` — every tracker and gap-filler against exact per-row paths
at three crossing severities (sens 7 / 5 / 4 = shallow / medium / deep).

**A metric bug found first.** Scoring each path at its *own* extremum gave −180% for *every*
method on rows 2–3. There the blink is smaller than the background alpha in the event window, whose
positive and negative peaks are nearly equal, so truth and recovered picked opposite-signed peaks.
It was the metric, not the readers. Fixed: read the recovered path's same-signed extremum within
3 px of the *truth's* extremum column.

**Result — row 0 (the plunging Fp1-F3), trough error, shallow / medium / deep:**

| method | here | skill says | verdict |
|---|---|---|---|
| order-based | −20 / −62 / −46% | −18% to −62% | reproduces |
| nearest, tight limit | −57 / −71 / −71% | −54% to −69% | reproduces |
| velocity-only | RMS 24–65 px, swaps rows | catastrophic | reproduces |
| peel-and-eliminate | −4 / −3 / 0% | −2% to −3% | reproduces — **but row-0 RMS is 3.9 / 23.0 / 41.6 px**: right trough, wrong path elsewhere. Not in the skill. |
| segments + linear interp | −80 / −84 / −88% | −78 / −81 / −85% | reproduces |
| segments + bidirectional | −4 / −3 / −3% | −2 / −3% | reproduces |
| segments + DP, crossed row 1 | −6 / −9 / −10% | −6 / +5% | close |
| segment-first confident | 96 / 93 / 88% of columns (rows 0–3) | 93% | reproduces |
| median error, confident vs not | 1.1–1.9 px vs 1.6–4.2 px (**1.5–2.8×**) | 1.5 vs 8.5 px (**5.6×**) | **does NOT reproduce** under any slice tried (whole page, event window, rows 0–3, all rows) |

**New finding — a shared negative bias on small rows.** Rows 2–3 read −20 to −23% for *every*
method alike. A uniform error across all trackers means it is upstream of tracking: the ink-run
**centre** estimator. At a sharp turn the renderer draws a vertical run per column, and the run's
centre sits half a run inside the true extremum. The skill already notes "a consistent negative
bias"; this locates it. Candidate fix for a later iteration: at a local extremum, take the run's
far end, not its centre.

**Verdict.** Headline crossover claims hold. Three corrections for the skill: the 5.6× confidence
separation is unverified (measured 1.5–2.8×); peel-and-eliminate gets the trough right while the
rest of its path can be 40 px off, so it is a trough estimator, not a tracer; and the small-row
bias comes from the centre estimator.

---

## 2026-09-10 — Phase 1: the benchmark, and what its first run exposed

`scripts/src/readCorpus.ts` rendered **144 pages** (2 renderers × 2 montages [`bipolar-ap`,
`reference-ipsi`] × 3 states [awake, drowsy, n2] × 3 seeds [3, 42, 1234] × 2 moments [skip 0, 45] ×
2 sensitivities [7, 15]) in 39 s, each with a truth JSON taken from what the renderer drew
(`baselineY`, `labelStripPx`, `data` — new return fields on both renderers). `py/bench.py` scores
them in 12 s.

| component | result |
|---|---|
| grid period | 72/72 clinical pages give px/s exactly; 72/72 app pages give the 5 mm minor square (the app draws one) |
| pitch (comb fit) | error 0.02 ± 0.67% (app), 0.03 ± 0.76% (clinical) |
| row p2p, occupancy ≤0.5 / 0.5–0.8 / 0.8–1.1 / >1.1 | median error 2.5 / 2.3 / 2.5 / **12.6%**; worst 28 / 9 / 22 / **67%** — the skill's competence envelope, reproduced independently |
| A–P ratio posterior/frontopolar | true 3.94 ± 1.16, read 3.99 ± 1.21 awake; \|log2 err\| 0.03–0.05 in every state |

**Reader defect found — `load_ink` could not see the app's own page.** It drops saturated pixels
(for the red ECG rows and annotation boxes on published figures), and the app draws its chains in
blue and red. It saw 0.6% ink on an app page against 4.7% on a clinical one: 16 of 18 rows gone.
Fixed with an opt-in `keep_coloured=True`. App pages now score the same as clinical ones.

**Reader defect found — "alpha prominence" measured the 1/f slope, not a peak.** The negative
control failed: N2 posterior rows scored prominence 57 against 93 awake. But truth shows N2 draws
**no posterior alpha peak**: the 6–14 Hz maximum is the band's lower edge (6.1 Hz on 20 of 24
rows), and alpha share is 0.10 against 0.72 awake. The reader's frequency was right (72 of 88 N2
estimates at 6–7 Hz, i.e. at the edge). What misfired is the ratio of peak power to the median of
the 4–6 and 15–20 Hz flanks. On a 1/f spectrum that ratio is large whenever the slope is steep,
peak or no peak. This is the skill's "1/f trap", reproduced inside the lab's own code.

**Truth note — `iaf` is a parameter, not what is drawn.** Awake O1/O2 drawn peaks sit within about
0.4 Hz of `sampleSubject(seed).iaf` (10.01 → 9.8–10.0; 11.63 → 11.5–12.0), which is inside the
0.24 Hz truth bins. Score a reader against the **drawn** peak.

**Watch item, not yet a finding.** In N2, one subject/moment still draws a 9.5 Hz posterior peak
(4 of 24 rows). Real N2 has no PDR. One draw is not a finding (SKILL.md mistake 1), so the next
corpus should cover more N2 seeds before anything is said about the generator.

---

## 2026-09-10 — Iteration 1: is there a PDR, at what frequency, and where?

**Research.** learningeeg *Normal awake*: the PDR is a posterior, reactive, sinusoidal 8–13 Hz rhythm
in the adult, and it drops out with drowsiness and sleep. In N2 the posterior head carries theta and
spindles (11–16 Hz), and spindles are fronto-central, not occipital. A reader calls "PDR present"
from **(i)** a rhythm, **(ii)** in the alpha band, **(iii)** maximal posteriorly — not from any
power in 6–14 Hz.

**Hypothesis.** Replace prominence with an **aperiodic-corrected peak height**: fit a line to log
power against log frequency over 2–30 Hz, excluding 6–14 Hz; take the highest point of the residual
in 7–13.5 Hz; reject a peak sitting within 0.5 Hz of either edge. Call PDR present when the
posterior peak is ≥ 6 dB above the fit *and* ≥ 3 dB above the frontopolar peak of the same page
(topography, criterion iii).

**Prediction.** Awake: PDR called on ≥ 90% of pages. N2: ≤ 10%. Drowsy: in between (it is a
fragmenting PDR). Frequency within 0.5 Hz of the drawn peak on called pages.

**Negative controls.** Engine: N2 pages, and the frontopolar rows of awake pages. Online: `sws`
(slow-wave sleep) and `kc-spindles-posts` (N2 with spindles in the alpha-adjacent band) must NOT be
called PDR. `mu` must put its alpha-band maximum **centrally**, not posteriorly.

**Falsified if** the N2 false-positive rate is > 25%, awake detection < 75%, or either online
sleep figure is called PDR.

**Result (1a, as registered): FALSIFIED.** 144 engine pages, true geometry:

| state | called | posterior peak | frontopolar peak | \|f − drawn\| on calls |
|---|---|---|---|---|
| awake | 48/48 | 20.2 ± 1.4 dB | 10.8 dB | 0.26 ± 0.32 Hz |
| drowsy | 48/48 | 15.4 ± 1.6 dB | 5.0 dB | 0.89 ± 0.96 Hz |
| n2 | **16/48 (33%)** | 4.7 ± 2.7 dB | 1.9 dB | 2.18 ± 0.90 Hz |

End to end on clinical pages (grid px/s, comb-fit baselines): the same numbers to within 0.2 dB and
1 page. Geometry is not where this reader fails. N2's false-positive rate beat the 25% bar.

Drowsy at 100% does not falsify anything, but my prediction ("in between") was vague: the engine
really does draw posterior alpha in drowsiness (O1/O2 alpha share 0.17–0.51, drawn peaks 8.4–12
Hz), which is right for early drowsiness. Presence alone cannot separate awake from drowsy. A
continuity measure, the fraction of the page carrying alpha, is a separate reading skill, queued
as iteration 2.

**Analysis — why N2 was called.** On the same page read at two sensitivities, identical underlying
signal, the reader returned two different frequencies (10.65 vs 11.81 Hz; 11.39 vs 10.28 Hz). A
rhythm cannot do that, so the "peaks" are spectral noise. A 10 s page at a 4 s Welch segment gives
about 4 averages, so each bin's log power has an sd of about 2.2 dB, and the maximum over ~26 noise
bins in 7–13.5 Hz lands near +5.5 dB. The 6 dB threshold sat at the noise ceiling. The reader was
wrong (class a), not the generator.

## Iteration 1b — same question, thresholds from the noise model

**Changes, each from a reason, not from the scores:**
1. `min_db` 6 → **10 dB**: about 4.5 noise sd above the fit, from the estimate above.
2. **Bilateral agreement**: left and right posterior peaks must both exist and agree within 1 Hz. A
   PDR is bilateral with the same frequency on both sides (learningeeg: a >1 Hz asymmetry is itself
   abnormal), and noise peaks have no reason to agree.

**Prediction.** Awake ≥ 90% called, N2 ≤ 10%. **The independent test is the online corpus**, since
1a's engine scores are now in view: `ap-gradient` and `term-alpha` called, `sws` and
`kc-spindles-posts` not, `mu` with its alpha-band maximum central.

**Result (1b): holds on both corpora.**

Engine, 144 pages: awake **48/48** called (\|f − drawn\| 0.26 ± 0.32 Hz), N2 **0/48**, drowsy 48/48
(expected; see above). End to end on clinical pages: identical.

Online, the independent test. Each montage was read off the label strip, and each time base came
from the 1 s rules or the grid, cross-checked against the ECG heart rate:

| figure | expected | posterior dB | frontopolar dB | L/R gap | freq | verdict |
|---|---|---|---|---|---|---|
| `ap-gradient` | PDR | 31.4 | 0.0 | — (one chain) | 11.75 Hz | PASS |
| `term-alpha` | PDR | 19.1 | 4.5 | 0.06 Hz | 10.18 Hz | PASS |
| `mu` | alpha max **central** | 6.7 (central **12.6**) | 1.9 | 1.91 Hz | — | PASS, not called |
| `sws` | no PDR | 3.8 | 3.5 | 0.11 Hz | — | PASS |
| `kc-spindles-posts` | no PDR | 4.1 | 4.5 | 2.77 Hz | — | PASS |

Comb-fit pitch agreed with the label spacing I read on every figure (27.6 vs ~27.3; 21.6 vs ~21.6;
26.5 vs ~27; 21.9 vs ~21.6; 126 vs ~130 px).

**My eye was wrong once, and the method was right.** I read `ap-gradient`'s posterior row as "about
10 Hz" from the whole figure. The reader said 11.75 Hz. Counted on a 3× crop between the two 1 s
rules, with four dotted 0.2 s lines between them confirming 400 px/s: **12 peaks**. A glance at a
whole page compresses a fast alpha. Count cycles between two 1 s rules, magnified.

**Time base.** `grid_period` returns the finest regular rule, which is not always the second: it
gave 80 px on `ap-gradient` (the dotted 0.2 s lines) and 20 px on app pages (the 5 mm minor
square). Every frequency above depended on confirming px/s with a second clock — the solid 1 s
rules, or the ECG's heart rate landing in 60–100 bpm.

**Promoted.** To SKILL.md: the PDR reading rule (aperiodic-corrected peak, ≥10 dB at ~4 Welch
averages, bilateral within 1 Hz, posterior > frontopolar by ≥3 dB), "count, don't glance", and
"confirm px/s with a second clock". To the reference file: this evidence.

**Queued.**
- *Iteration 2 — alpha continuity.* Separate awake from drowsy by the fraction of the page carrying
  alpha, not by presence. Engine truth: the alpha envelope from `data`.
- *Watch* — the N2 9.5 Hz posterior peak on one subject/moment. Needs more N2 seeds.
- *Corpus* — the 10 dB threshold assumes about 4 Welch averages. A 3 s online figure like
  `ap-gradient` has one. It passed on a 31 dB peak, but a short page with a modest PDR could fail.
  Scale the threshold with the number of averages, and test it on short pages.

---

## 2026-09-10 — Blind visual read #1 (my eyes, no code)

`readCorpus.ts --blind 10 --blind-seed 20260910`: 10 pages drawn from a pool wider than the grid
(6 states, 3 montages, 12 pattern sets, 4 sensitivities, both renderers). Stdout printed only ids.
Answers went into `corpus/blind-answers-2026-09-10.json` before the truth directory was opened.
Scored by `py/score.py`.

| | score |
|---|---|
| montage | **10/10** |
| PDR present / absent (against what was drawn) | **10/10** |
| state | 6/10 exact, 8/10 within one stage |
| toggled patterns | 3 hit, **6 missed**, 3 false alarm |
| PDR frequency (n=2) | \|err\| **1.95 Hz** — glanced, didn't count |

**Every miss, classified.**
- **(a) Reader: never mapped row numbers to labels.** `dbd39be8`: opposite-polarity waves on rows
  8/9, which I called a focal temporal phase reversal. On `bipolar-transverse`, rows 8/9 are
  **C3-Cz / Cz-C4**, so it was a reversal at **Cz**: the page was N3 with gen-slowing. The app's
  label strip prints row numbers only, and I had named the montage correctly without ever looking
  up its row order.
- **(a) Reader: dismissed temporal fast activity as background.** On `da6e7c99` and `a3935998` I
  noted T3/T4 fast activity and moved on. Both had `muscle` on. Temporalis EMG is the classic
  place for it.
- **(a) Reader: FIRDA read as eye movement.** On `802970dd` I noted "slow frontal waves at the end"
  (several consecutive cycles, bilateral, same period) and attributed them to eyes. A train of
  same-period frontal delta is FIRDA. Eye movements are single, irregular, and mirror at F7/F8.
- **(a) Reader: one "false alarm" was real physiology.** `30f42a8f`: slow opposite-polarity F7/F8
  deflections. Truth had no eye-movement toggle, but the engine draws slow roving eye movements
  in drowsiness, and the state was drowsy (I said awake). SREMs are a hallmark of drowsiness. I saw
  the evidence and drew the wrong conclusion.
- **(a) Reader: glanced at frequency.** Said 10 Hz twice. Drawn 12.9 and 9.0 Hz. Same lesson as
  iteration 1 (count cycles between two 1 s rules), now on my own reads.
- **(b) Generator, candidate → measured below.** `9a1a2db1` (drowsy + gen-slowing, `bipolar-ap`):
  Fz-Cz and Cz-Pz dwarfed every parasagittal row. I read it as REM sawtooth.

**Generator finding — generalized slowing is vertex-focal and lateralized.**
`measureField.ts --toggle gen-slowing` (awake, 60 s, seeds 42/7/1234, same-seed on−off, raw
electrodes): maximum **Cz 173.5 µV**; Pz 63%, C3 60%, P3 49%, F3 43%; **Fp1/Fp2 26–27%**,
**T4/T5/T6/O1/O2 11–15%**. It is also asymmetric: C3 60% against C4 26%, F3 43% against F4 19%, and
P3 +49% against **P4 −20% (opposite sign)**. Generalized slowing should be diffuse and bilateral.
This field is a vertex focus leaning left.

**It disagrees with IK-024, which the gate reports as enforced.** IK-024's Observable says each
regional ratio (Fp1, O1, T3 delta+theta power over Cz) is "near unity". Its check accepts
0.05–0.4 and passes at 0.126 / 0.132 / 0.103, i.e. Cz carries about 8× the power of the other
regions. The check cannot see a vertex focus: it divides by Cz, so its spread test only asks
whether the *other* regions resemble each other. Per CLAUDE.md §2 this is raised with the user,
not fixed: neither the entry, the check, nor the generator is changed here.

**Promoted to SKILL.md:** map row numbers to labels before any localisation claim; temporal-only
fast activity is muscle until shown otherwise; a train of same-period frontal delta is FIRDA, not
eyes; slow roving lateral eye movements are evidence *for* drowsiness.

**Queued.**
- Iteration 2 — alpha continuity (awake vs drowsy).
- Iteration 3 — state from a page. 4/10 wrong here, and the biggest visual gap.
- More blind reads, **counting** frequencies, with the row→label map written down first.

---

## 2026-09-11 — Engine corrections from the loop's findings (user: "fix it based on your own research")

Written up in full in the IK entries they touch; the short version:

- **Eye opening (IK-007).** The `eye-opening` maneuver never blocked the PDR, so alpha ran straight
  through the 2.5–4.5 s the eyes were held open. The `eyes-open` toggle stepped alpha within one
  sample. Now one smoothed alpha-blocking state takes both inputs (`engine.ts`,
  `EYES_OPEN_ALPHA_GAIN` 0.35, time constants 0.15 s / 0.4 s) and is reported as
  `groundTruth.eyesOpen`. Gate: open/closed PDR amplitude 0.362, back to 0.837 of closed 0.5–1.0 s
  after closure. The warm-up now runs with the artifact gates off. Otherwise a maneuver fired during
  warm-up and every record, even with every toggle off, began with ~0.3 s of blocked alpha.
- **Generalized slowing (IK-024).** Rebuilt from one Cz patch to independent theta+delta patches
  under all 19 sites, plus ~5 Hz posterior fragments for the slowed PDR (the moderate grade).
  Isolated amplitude 0.91–1.20× the median electrode (Cz was 3.49×). **Correction:** the
  "leans left" report in iteration 1 was wrong. It came from `measureField`'s signed single-sample
  peak, and the RMS field was symmetric to within 1%. A signed single-sample peak is not a field
  estimate for ongoing activity; use RMS.
- **IK-030.** Measured with one image reader on real records, the 2–30 Hz centroid gave 1.16 and
  **0.79** on two normal learningeeg figures (the second has frontal blinks), so its 1.1 floor
  would fail a real normal record. Replaced by beta/alpha front vs back: 7.5 and 25.3 on the real
  figures, 7.8 ± 1.7 on 12 engine pages. It moves the right way under perturbation.
  (`py/apfreq.py`.)
- **IK-029.** P ≥ C now holds in 8/8 subjects (1.05–1.62), lowest in subjects with mu, and is
  asserted.

## 2026-09-11 — Iteration 2: reading reactivity (eyes open → PDR attenuates)

**Research.** learningeeg: the PDR is the eyes-closed resting rhythm. It "emerges right after the
patient closes their eyes", and the reader is told to "wait till the eyes are closed and then
count". Reactivity is one of the five background elements. Iteration 1's PDR reader ignored eye
state entirely: it would grade a PDR from an eyes-open stretch, and it could not say whether a PDR
reacts.

**Hypothesis.** The page itself says when the eyes are open. The opening sweep is an upward
frontopolar deflection (IK-011), and the closing sweep a smaller downward one 2.5–4.5 s later.
Pair them on the low-passed Fp1-F3/Fp2-F4 traces, then compare the posterior 8–13 Hz envelope
inside the open windows against the rest of the page. Reactive if open/closed ≤ 0.6.

**Prediction.** On 12 maneuver pages (6 subjects × 2 renderers): openings detected within 0.6 s of
the true start on ≥ 80% of maneuvers, and every page called reactive. On 12 control pages, the
same subjects with no maneuver: ≤ 1 false opening in total. The read index within 0.15 of the
index computed from the drawn samples over the true intervals.

**Negative controls.** The control pages. Blinks are downward and fast, so they must not pair as
openings.

**Falsified if** detection < 60%, or > 2 false openings on controls, or any maneuver page is called
unreactive.

**Result (2a, as registered): FALSIFIED on reactivity calls, 4/12.** Openings were found 36/42
(86%) with 0 false openings on the 12 controls, but 6 false windows on maneuver pages inflated the
index (read vs drawn \|err\| 0.20). **Analysis (reader wrong):** the closing sweep's own recovery
swing. The amplifier's low-frequency filter makes every slow ocular transient biphasic (IK-001),
so the downward closing sweep is followed by an upward overshoot that looks exactly like an
opening. 2a took it for one and paired it with the *next* closing, counting ~5 s of eyes-closed
alpha as "open". Separately, a background slow wave inside a window was taken for the closing,
cutting a 3.4 s window short.

## Iteration 2b — reason out the two failure modes

Changes: an upswing within 1.2 s of a closing is that closing's recovery swing, not an opening;
the closing is the *most prominent* downswing 1.5–6 s after the opening, not the first. And a
negative control for the index, which 2a lacked: the same subject with no maneuver, read through
the maneuver page's true windows.

**Result (2b).** Openings **40/42 (95%)**, false openings **0** on maneuver pages and **0** on
controls, read index within **0.010 ± 0.007** of the index on the drawn samples. Drawn-sample index
with true windows: maneuver **0.45 ± 0.10 (max 0.66)**; no-maneuver control **0.98 ± 0.13 (min
0.80)**. The 0.6 threshold sat inside the maneuver distribution (both `s777` pages read 0.66, a
real but modest attenuation in a subject with a small PDR). **Recalibrated to 0.75**, between the
two distributions, giving 12/12 — which is calibration, not an independent test. The independent
test needs a real record with an eye opening. learningeeg's Normal Awake chapter has one, but it
is not in the corpus and downloading it needs the user's go-ahead.

**Recovery, measured against the same-seed control:** 0.90 of control 0.25–0.75 s after closure,
0.98 by 0.75–1.5 s, 1.00 after. On one rendered page the alpha looked absent for 5 s after closure.
The control showed that to be the subject's own PDR waning at that moment: one draw, not a
defect, and exactly SKILL.md mistake 1. **Queued, generator realism:** real records usually show a
*prominent* PDR right after eye closure, often faster at first (learningeeg's "alpha squeak"). The
engine restores the PDR to wherever its own envelope happens to be, with no rebound and no squeak.

## 2026-09-11 — A–P magnitude: my own montage mismatch

The warm-up fix removed a start-up transient that had inflated every frontal row: artifacts fired
during warm-up and stepped off on the first displayed sample, ringing the amplifier high-pass
through the first second. Two IK-029 bounds then went red, and both were mine. **Front-to-back ≤
5 on the ear-referenced ratio** came from eyeballing learningeeg's *bipolar* figure, the symmetry
rule broken. Traced with the same estimator, that figure reads **3.75** back/front on its bipolar
chain, and the engine **3.06 ± 0.39**. The engine's gradient is, if anything, slightly shallower
than the reference, so reducing `AP_AMPLITUDE_TILT` (the tempting fix) would have moved it the
wrong way. **Quietest channel ≥ 10 µV** was failing on F7-A1 (9.9 µV), a row beside its own
reference, which measures proximity, not scalp amplitude. Fixes: magnitude asserted on the bipolar
chain (2–6), the ear-referenced ratio keeps a floor, and the envelope excludes the six
near-reference channels.

---

## 2026-09-11 — Iteration 3: what the PDR does after the eyes close (a real record as the target)

User: "If it's in real records it should be there, and you can download the figure from learning
eeg." Downloaded from learningeeg.com's Normal Awake chapter:
`images/normal-awake/clean/pdr-emerges-eye-closure.webp` (245,680 B) and its annotated twin
`annotated/pdr-emerges-eye-closure-3.webp` (281,122 B), saved as `corpus/online/eye-closure*.{webp,png}`
(gitignored). The chapter holds a second eye-closure figure (`normal-alpha-eye-closure`), not
downloaded.

**Reading the record** (`py/closure.py`). Montage read off the labels, [4,4,4,4,2,2,2] + ECG. Time
base 91 px/s: the grid, cross-checked by the ECG (71 bpm) and the PDR (10.8 Hz by counting; half
that speed would mean 142 bpm and a 5.4 Hz "normal" PDR). Closure found at 5.48 s as the most
prominent downward frontopolar excursion, which matches the eye. Posterior 8–13 Hz envelope
relative to the settled PDR (+3–5.5 s):

| window after closure | real | engine before | engine after (7 closures, same tracer + windows) |
|---|---|---|---|
| +0.0–0.5 s | 1.21 | ≈1 (0.90 of control) | 1.42 ± 0.66 |
| +0.5–1.0 s | 1.43 | ≈1 | 2.07 ± 0.98 |
| **+1.0–1.5 s** | **2.19** | ≈1 | **2.15 ± 0.80** |
| +1.5–2.5 s | 1.58 | 1.00 | 1.45 ± 0.38 |
| +2.5–3.5 s | 1.27 | 1.00 | 1.27 ± 0.45 |

**Rebound:** present in the record, absent from the engine. Added (`engine.ts`
`ALPHA_REBOUND_GAIN` 0.8, peak 1.25 s, scaled by the block depth at closure). It matches from 1 s on;
the engine rises a little earlier, within its spread against one draw, so not fitted.
**Squeak:** the record shows no quickening of ≥ 1 Hz averaged over the first second (counted in
0.5 s windows at ±1 Hz resolution). Added small (+1.0 Hz decaying over 0.4 s, ≈ +0.4 Hz averaged
over that second) and **not asserted**, since it sits below counting resolution on both sides.

**Gate:** 0.75–2.0 s after closure, PDR at 1.665× the same moments without the maneuver; 3–5 s after,
1.033×. Three subjects in a probe: 1.65–1.68 (per closure 1.56–1.81), settled 1.03–1.04.

**The independent test of the reactivity reader.** The real record reads a reactivity index of
**0.59**, and is called reactive at the 0.75 threshold. That is the first test of the threshold on
data it was not calibrated on. Note what it implies: the real attenuation (0.59) sits at the mild
end of the engine's (0.38 ± 0.11 drawn). `EYES_OPEN_ALPHA_GAIN` 0.35 may block a little deeper
than typical. One draw, so recorded, not tuned.

**Found while gating: this morning's fix had mis-scoped every standalone resting run.**
`EegEngine`'s default gates switched the eye-opening maneuver on. That was harmless while the
maneuver never touched alpha; once it blocked the PDR, a default "resting" run held its eyes open
**45%** of the time. `O1 peak-to-peak` read 97.6 µV this morning because the alpha was blocked half
the time: it passed for the wrong reason. With the rebound it went to 130.9 (ceiling 130). Truly
eyes-closed, it reads 110.4. Fixed at the source: the `eyeOpening` default gate is now off, since a
command maneuver is not background. The app is unaffected, because `SimulationSource` sets every
gate from the toggles on every sample. **Lesson:** when a change gives an existing input a new
consequence, audit every *default* that turns the input on.

**Queued.**
- *Rebound shape vs envelope phase.* The rebound multiplies whatever the PDR envelope is doing. In
  the real record the post-closure burst is the tallest alpha on the page; in the engine, a
  closure that lands in a waning phase gives a modest one. An envelope reset at closure may be
  more faithful. Needs more real closures before changing anything.
- *More real closures.* The chapter's second eye-closure figure (`normal-alpha-eye-closure`) would
  make n = 2. Needs the user's go-ahead to download.

## 2026-09-11 — Iteration 3b: a second real closure

User: "sure". Downloaded `images/normal-awake/clean/normal-alpha-eye-closure.webp` (55,498 B) as
`corpus/online/eye-closure-2.{webp,png}` (gitignored). Montage [4,4,4,4,2,2,2] + ECG. Time base
111 px/s from the grid, cross-checked by the ECG (60 bpm) and the PDR, which reads 10.08 Hz by
counting against the caption's "The PDR is 10".

**Reader defect 1 — the closure rule was too naive.** "Most prominent frontal downswing" picked
x = 1088, where the posterior alpha *before* the event was 2.2× the alpha after. That is not an
eyes-open → closed transition. What makes a downswing a closure rather than a blink is that
**the PDR emerges after it**, which is how learningeeg tells a reader to find it. New rule: among
prominent downswings, the one with the largest posterior-envelope rise (+0.5..+2.5 s over
−2.5..−0.5 s).

**Reader defect 2 — low-passing moved a fast event.** Figure 2's closure is a sharp,
blink-fast Bell's sweep riding a slower wave. The 1.5 Hz low-pass centred on the slow wave, 0.58 s
early (x 605 against the visible 670). Now refined to the unfiltered extremum within ±0.6 s. That
also moved figure 1's closure from x 557 to x 526, which is where I had first placed it by eye.

**Result.** Post-closure envelope / settled PDR, same tracer and windows on every side:

| window | real 1 | real 2 | real mean | engine, peak 1.25 s | engine, now (cubic, peak 1.7 s) |
|---|---|---|---|---|---|
| +0–0.5 s | 0.99 | 1.54 | 1.27 | 1.42 | 1.17 |
| +0.5–1 s | 1.41 | 1.18 | 1.30 | 2.07 | 1.75 |
| +1–1.5 s | 1.77 | 2.44 | 2.10 | 2.15 | 1.99 |
| +1.5–2.5 s | 1.94 | 1.71 | 1.83 | 1.45 | 1.53 |
| +2.5–3.5 s | 1.62 | 1.34 | 1.48 | 1.27 | 1.39 |

Both real records say the rebound peaks later (1–2 s) and lasts longer (still ~1.5× at 3 s) than
the first engine shape, which was matched to one record. With two draws agreeing it is a pattern,
so the shape was changed: `ALPHA_REBOUND_PEAK_S` 1.25 → 1.7. A quadratic at 1.5 s was tried first
(total \|error\| 1.18); the cubic at 1.7 s gives 1.05. Stopped there. The engine is still early at
0.5–1 s, possibly because its eyes-closed return (τ 0.4 s) is faster than real; two records cannot
separate the two explanations. The gate's "settles back" window moved from 3–5 s to 4–5 s, because
both real records are still raised at 2.5–3.5 s. Gate: rebound 1.736, settled 1.080.

**For the user, not decided here — eyes-open attenuation depth.** Through the reactivity reader,
both real records are called reactive (index **0.59** and **0.69**, threshold 0.75). Both are milder
than every engine page (0.35 ± 0.11, max 0.58, same reader and index). `EYES_OPEN_ALPHA_GAIN` 0.35
may block deeper than typical. Softening it would also mean softening IK-007's clinical wording
("markedly and frequently abolishes it") and its "at least half" bound, on the evidence of two
teaching figures. That is a clinical judgment, so it is raised rather than made.

---

## 2026-09-11 — Iteration 4: the sleep graphoelements against learningeeg

User: fix the sleep architecture (POSTS, K-complexes, spindles, …) against learningeeg, do your own
research, verify with /read. Full write-up, sources and numbers: `SLEEP-ARCHITECTURE-AUDIT.md` at
the repo root. What belongs here is what the reader learned.

**Reading the figures, by eye, magnified.** learningeeg's Normal Asleep figures (viewed in the
browser pane, not downloaded: `POSTs`, `Spindles`, `K Complex, Spindles, POSTs`, `POSTs and K
Complex`, `Multiple vertex waves`, `Drowsy state`, plus the corpus's `kc-spindles-posts`, `sws`,
`vertex-wave`). Label strips read: five of six run parasagittal chains first, then temporal, then
T1/T2, then midline; `vertex-wave` alone runs temporal first. Multi-row patterns only (occupancy
rules, SKILL.md): POSTS sit on P3-O1/P4-O2/T5-O1/T6-O2, UP on those rows, singly and in 4-5/s
runs, barely on C3-P3/T3-T5; vertex waves reverse at C3/C4 as well as Cz; the K-complex is on
every chain, anterior rows most, then a diffuse spindle; drowsy and N2 midline rows are quiet;
slow-wave sleep crosses traces on every chain, posterior ones included.

**A reader that failed, recorded rather than dropped.** An event-averaged signed field
(`shape.event_average` over `track_segments`, triggered on the four occipital rows, UP) run on
`kc-spindles-posts`' POSTS-rich first half returned a 25 ms half-width and P3-O1 −0.09 row-heights
against C4-P4 −0.35 — i.e. it averaged background waves, not POSTS: at occupancy ~0.3 the POSTS
are about background-sized and the strongest-excursion trigger cannot tell them apart. On engine
pages it likewise mixed POSTS with background (P3-O1 −0.27 for POSTS that are ~1 row tall).
First attempt also passed `track_segments`' second output (`conf`, True = confident) as an
ambiguity mask; note the inversion for anyone reusing it. Conclusion: **no per-row POSTS number
from a reference figure**; targets came from published values instead. A POSTS reader would need
a morphology template (sharp, positive, 80-200 ms) rather than an excursion trigger.

**Forward-model finding (engine, not reader).** The cortical shell is a sphere of radius 0.62
about HEAD_CENTRE, but electrode distance from that centre runs 0.67 (Cz) to 1.05 (O1, Fp1):
a shell source sits 0.05 units (~0.5 cm) under Cz and 0.43 (~4 cm) under O1. So every vertex
source is hyper-focal (Cz patch: C3 4%) and every occipital/frontopolar one hyper-broad (O1 patch:
P3 40-48%, whatever the extent). The rebuilt sleep sources sit at one depth below the scalp
(`forward.ts` CORTEX_BELOW_SCALP, 0.2 ≈ 1.9 cm; MRI scalp-to-cortex over M1 14.3 ± 2.5 mm, Lu et
al. 2019); every other source is still on the shell. **Queued:** moving the rest re-fits every
extent in the model — a separate, large piece of work.

**Queued.**
- A POSTS/spindle reader built on a morphology template, tested on engine truth first.
- Spindle visibility: engine spindles match the healthy-adult norm (C3-A1 median 8.5 µV peak,
  PMC12172134's 5.2-15.2) and are therefore subtle on a 10 s page, where learningeeg's chosen
  examples are prominent. One is a population, the other a teaching selection; not changed.

---

## 2026-09-14 — Iteration 5: blinks and mu, read against learningeeg (user-reported)

User compared an app page (awake, eyes open, blink) with learningeeg's "Eye Blinks and Chewing and
Tongue artifact" figure and marked two things: the second temporal row dipping as deep as the first
at each blink, and a large central alpha-band run.

**Reading a blink field through crossings, by eye at 4x.** Every row under the frontopolar one has
its OWN shallow V at the blink; the deep stroke that crosses them is the frontopolar row. Reading
each row's trough against its own baseline, then summing each chain back from O1 (taken as ~0),
gives a referential field — and the two chains must agree on Fp1, which is the check on the read:
6.1 row-heights (parasagittal) vs 6.2 (temporal) on the blinks figure. Field relative to Fp1, two
records, 5 blinks: F7 0.10–0.31, F3 0.25–0.33, T3 0.04–0.09, C3 0.06–0.10, P3 ~0.04; bipolar
F7-T3 / Fp1-F7 0.07–0.32 (median 0.14). Engine was F7 0.57 and 0.95. **The IK-032 ceiling of 0.95
passed that value**; it is an entrenched-bug bound.

**Blink size needs a background to mean anything.** Uncalibrated page, so blink trough over the
same page's P3-O1 1st–99th percentile p2p (tracker, low occupancy only; the eye-closure figure's
tracker read >1 row on quiet rows and was excluded): ~13 eyes open (blinks figure), 2.9–4.2 over
eyes-closed alpha (term-alpha). Engine 2.8 / 2.2 → drive doubled (engine.ts BLINK_DRIVE_UV).

**Mu field from a figure.** Tracked the learningeeg Mu Rhythm III marked run, 8–13 Hz RMS per row:
C3-P3 / F3-C3 0.66, C4-P4 / F4-C4 0.76, Fz-Cz / F3-C3 0.61. Engine's point source gave 1.03 and
0.09. One figure; Mu Rhythm II agrees by eye (anterior link larger), not measured.

**Negative result worth keeping.** Mu burst tails (95th-percentile cycle up to 80 µV) did not
respond to envelope depth (0.55 → 0.3 moved it to 72); per-subject RMS is the lever (MU_MAX_RMS).
Blinks do not trigger mu bursts — same seed, blink on/off, central 8–13 Hz identical — although
two separate pages showed a burst starting at a blink. One more instance of SKILL.md mistake 1.
