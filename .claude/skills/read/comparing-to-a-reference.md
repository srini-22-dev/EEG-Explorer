# Comparing against a real clinical record — methods and evidence

Companion to [SKILL.md](SKILL.md). The rules live there; this file holds the method tables, the
measured evidence behind them and the failure log. **Read it before extracting anything from an
image** — a reference figure, a pasted record, or an engine render read back as pixels.

The code these tables were measured with is in `scripts/read-lab/py/` (`extract.py`, `trackers.py`,
`fillers.py`, `labels.py`, `shape.py`). Re-run the crossover tables with
`python scripts/read-lab/py/bench_truthpaths.py`, which scores every tracker and gap-filler against
engine renders saved with the exact y(x) of every row (`scripts/read-lab/corpus/truthpaths/`). The
reference figures are in `scripts/read-lab/corpus/online/` (gitignored; `corpus/online.json` says
where each came from), and the iteration history is `scripts/read-lab/JOURNAL.md`.

**Numbers here are dated evidence, not thresholds.** They were measured on the engine and figures of
their day. Before relying on one, re-run the bench that produced it.

> **Corrections from the 2026-09-10 reproduction** (`JOURNAL.md`, iteration 0). The crossover
> headline figures reproduce within a few points. Three do not stand as originally written:
> - The segment-first confidence map separates error **1.5–2.8×** (median 1.1–1.9 px confident
>   against 1.6–4.2 px not), not the 5.6× (1.5 vs 8.5 px) quoted below. The 93% confident figure
>   holds.
> - Peel-and-eliminate recovers the **trough** (−4 / −3 / 0%) but its path elsewhere can sit 40 px
>   off (row-0 RMS 41.6 px at the deep severity). Treat it as a trough estimator, not a tracer.
> - The small-row negative bias (−20 to −23% on rows 2–3 for *every* method alike) comes from the
>   ink-run **centre** estimator, not from tracking. At a sharp turn the run's centre sits half a
>   run inside the true extremum.

### Recovering conditions from an image — methods that actually work

Measured against ground truth (pages rendered at known settings, then read back blind):

| quantity | method | result |
|---|---|---|
| px/second | **autocorrelation** of the column profile of grid-coloured pixels; first peak above lag 8 | **6/6 exact**, and 7/7 across a density ladder to 5.1 row-heights |
| px/second | median of gaps between detected rules | **fails** — one missed rule corrupts the median. Gave 22.5 mm/s for a 15 mm/s page |
| row pitch | **parametric comb fit** — fit `(y0, pitch, gap)` against the known group structure, maximising ink at predicted baselines | exact (40.00 px, gap 0.45) on own renders; consistent 27–30 px on reference figures |
| row pitch | autocorrelation of the row ink profile | works on own renders (40 px exact), **does not transfer** to real figures with unequal group gaps — gave 90/83/29/108 px on four figures |
| row baselines | comb fit output | robust at occupancy 1.8 row-heights |

Read the montage off the figure's own labels and feed the group structure to the comb fit; do not
try to detect rows from the label strip, which fails as soon as traces overlap it.

### What is NOT recoverable, and why it is a proof

**Sensitivity cannot be recovered from an uncalibrated page. Ever.** Page amplitude = signal ×
sensitivity, and with no calibration marker the two are not separable. Confirmed twice:

- Reading blind, I identified speed and page duration 5/6 but sensitivity only **3/6**, and every
  miss was exactly one rung of the ladder — a ~1.45× amplitude error.
- The learningeeg figures are cropped flush to the trace field with **no calibration marker of any
  kind**. This is precisely the failure ACNS Guideline 1 §3.3 legislates against: "clear scale
  markers must be available as part of the display."

A further trap: those figures are **digital screenshots, not paper**. Their identifiability
triangle does not close — at 111 px/s and 30 px row pitch, either the speed is 30 mm/s and rows
are 8.1 mm, or rows are 10 mm and the speed is 37 mm/s. Neither is standard, because there is no
physical millimetre. **Do not ask a screenshot for its mm/s or µV/mm.**

### Competence envelope — when to decline

Trace extraction validated against known truth, as page occupancy rises:

| mean occupancy | median p2p error | worst single-row error |
|---|---|---|
| ≤0.5 row-heights | ~4% | ~15% |
| 0.8 | ~5% | **38%** |
| 1.1 | ~6% | **56%** |
| 1.8 | ~1% | **68%** |

So: **below ~0.5 occupancy, per-row claims are admissible. Above it, only aggregate and
multi-row-pattern claims are** — a conclusion resting on one row is not safe. Extraction carries a
consistent negative bias (the tracker's jump limit clips fast peaks), so treat recovered
amplitudes as slight underestimates. Above ~5 row-heights nothing works, including the grid
detector.

### Any limit narrower than the feature becomes the measurement

The trace tracker had `lim = pitch * 0.95` — a row could not stray more than one row-height from
its baseline. Reference eye blinks run **1.3–1.8 row-heights** and vertex waves more. Every large
deflection was therefore silently truncated to ~1.0, and two clipped values were then compared and
reported as agreement ("reference 0.97 vs engine 0.92" — both were just the clip).

Widening it is not a fix either: at `lim = 4.0` the tracker wanders onto neighbouring traces and
worst-case error goes from 38% to **161%**. **Continuity tracking cannot resolve a crossover at
all.** Check every clamp, window and percentile against the size of the thing being measured, and
state the clip value alongside any result that approaches it.

### When traces cross, order-based assignment silently swaps rows

Matching ink runs to rows top-to-bottom is only valid while no trace overtakes another. It stops
being valid exactly where the interesting morphology is. Worked example: at 5 µV/mm the engine's
blink puts row 1 at 1.77 row-heights and row 2 at 0.36, so row 1's trace ends up **below** row 2's
and the two are swapped by any order-based reader — which is why image extraction of the engine
returned 0.94 for a row whose true value was 0.22.

Two consequences. **Use only events where all traces resolve separately, and report how many
qualified** (9/10 on one reference figure, 2/10 on an engine render). And note that **whether the
traces cross is itself a measurement**: the reference's blink never crosses row 1 into row 2, the
engine's does, and that alone says the engine's decay down the chain is too steep.

### Pitch is an assumption, and getting it wrong invalidates everything

**Pitch** is the vertical distance in pixels between adjacent channel baselines — one row's height
on the page. Every downstream quantity is scaled by it: the tracking limit (`k × pitch`), amplitude
reported in row-heights (`px / pitch`), and the resolvability band. It is *estimated*, not given,
and the estimates disagree badly:

| figure | from label spacing | from comb fit | truth |
|---|---|---|---|
| engine render | 40.1 | 41.0 | **40.0** |
| learningeeg vertex-wave | 29.5 | 30.0 | — |
| learningeeg sws | **15.4** | **27.0** | — |
| AES f10 | **36.8** | **19.2** | — |

Up to **1.91× disagreement**. And this is not academic: a resolvability verdict of "sws NOT
READABLE, 2.3%" was produced with the label-derived 15.4. Recomputed with the comb-fit 27.0 the
same figure reads **69.3%, READABLE** — the page was fine all along and the pitch was wrong.
Several earlier failures on that figure trace to the same number.

**Take pitch from the comb fit constrained by the group spec you READ**, and use label spacing only
as a cross-check. When the two disagree by more than ~15%, stop and resolve it before measuring
anything, because a wrong pitch silently rescales every amplitude you go on to report.

### You do not have to read left to right

Sequential tracking propagates a single bad pick forever. It is also unnecessary: away from
crossings, attribution is certain, so those columns can be fixed **independently and out of
order**, and the ambiguous spans then sit *between* two known anchors rather than being
extrapolated from one side.

Mark a row confident at a column when exactly one ink run lies within ~0.6 × pitch of its baseline
*and* that row is the nearest row to that run. Measured on a page with a known answer: confident on
**93%** of columns, and the map predicts error — median **1.5 px where confident against 8.5 px
where not**, a 5.6× separation, with the blink trough correctly flagged unsafe on every row.
Segment-first also gave the best overall fidelity (lowest RMS on three of four rows).

### Do not interpolate across a gap — RECONSTRUCT it

The ambiguous span still contains ink. The traces are drawn there; they are merged, not missing.
Linear interpolation is the only gap-filler that throws that ink away, and it is the worst
performer of every method tried — it cuts the corner and reads a 2.65 row-height trough as 0.50.

Four reconstructors, compared on *identical* anchors from the segment pass:

| gap reconstructor | RMS, plunging row | trough error, 4 rows |
|---|---|---|
| linear interpolation | 14.0 | −81, −23, −15, −11% |
| **bidirectional ink continuation** | **6.9** | **−2, +3**, −234, −1% |
| **DP min-cost path on ink** | 7.5 | −35, **−6, +5, −1%** |
| connected-component geodesic | 9.9 | **+1**, +11, −248, −1% |

- **Bidirectional continuation** — march inward from *both* anchors, each step taking the ink
  nearest a velocity prediction, and keep the more displaced of the two reconstructions. Best on
  the row making the excursion.
- **DP min-cost path on ink** — the minimum (off-ink penalty + curvature) path between the anchors.
  It cannot cut a corner because the corner is not ink. Best on the rows being crossed.
- They fail on *different* rows, so select per row by entry speed into the gap: steep rows get
  bidirectional, everything else gets DP.

Validated at three crossing severities, against interpolation:

| severity | interpolation | segments + bidir/DP |
|---|---|---|
| shallow | −78, +3, −41, −17% | **−3, +3, +7, −17%** |
| medium | −81, −23, −15, −11% | **−2, −6, +5, −1%** |
| deep | −85, −46, −23, +26% | **−3, −2, +11, +26%** |

Row-1 error falls from ~−80% to ~−3% and RMS roughly halves at every level. The remaining
weakness is the *smallest* deflections (row 4, 2-3 px), which sit at the resolution limit and are
not improved by any reconstructor.

**The recipe:** segment-first for anchors and the confidence map; bidirectional-or-DP to
reconstruct the gaps; peel-and-eliminate as a cross-check on the extremum. Report trust from the
confidence map — it separates median error 1.5 px from 8.5 px.

### Reading a crossover: peel and eliminate

When a transient is large enough that its row's trace runs through its neighbours, no single-pass
tracker recovers it. The reader's own procedure does, and it scores far better than the
alternatives. Validated against exact per-row pixel paths generated from the engine, at three
crossing severities:

| method | row-1 error |
|---|---|
| order-based (match runs top-to-bottom) | −18% to −62% |
| nearest-to-previous with a tight limit | −54% to −69% |
| velocity-only (extrapolate through) | catastrophic — rows 2-3 RMS 75 px, it swaps rows |
| **peel-and-eliminate** | **−2% to −3%** |

**Peel-and-eliminate.** Track every row with a *tight* limit first. Rows that never press against
it are trustworthy — this was measured, and the quiet rows come back to ~0.02 row-heights. Rows
that *do* press against it are the ones the limit is clipping, i.e. the plungers. Erase the
trusted rows' ink, then re-track only the plungers on the residual with a generous limit and
velocity prediction. With the quiet traces removed, the steep stroke is the only thing left to
follow. Recovered ratios [1.00, 0.27, 0.11, 0.02] against true [1.00, 0.25, 0.10, 0.02].

**But first decide whether a crossing happened at all — peeling over-reaches if it did not.**
Applied blind to a reference figure whose blink does *not* cross, peeling followed the deepest
residual ink and returned a row-1 deflection of 3.09 row-heights against a true ~1.8, changing the
conclusion by 4×. Two cheap tests, and they agree with each other:

- **Run count.** Count distinct ink runs through the event. Four rows and four runs throughout
  means nothing merged, order is preserved, and plain order-based matching is correct.
- **Velocity continuation.** Follow the steep stroke's own slope through the merge and see where it
  lands. On the engine it continues past two rows; on the reference it decelerates and settles
  above row 2. That single test decided the attribution.

**Whether the traces cross is itself a measurement, needing no calibration at all.** A transient
that crosses its neighbour in one record and not the other is a difference in how sharply the
field decays down the chain — often the fastest honest comparison available.

### Measure the engine from the engine

The reference can only be read from pixels; the engine cannot only be read from pixels. Take the
engine's numbers **from the engine** (exact, multi-seed), take the reference's from the image, and
**validate the image method by running it on the engine's own render and comparing against the
engine's exact values.** Where those two disagree, the image method is wrong and any reference
number it produced is suspect. That check is what exposed the row-swap above.

### Validate the reader on MORE THAN ONE source

An extraction pipeline tuned on one lab's figures is tuned to one viewer, one montage convention,
one line weight and one compression. Tested against a corpus spanning seven learningeeg chapters
plus the American Epilepsy Society atlas (NCBI Bookshelf NBK390343, CC BY-NC-SA — a different lab
entirely), the following broke, none of which is visible from a single source:

- **No time grid at all.** The AES figures have none — just cursor lines. Everything downstream of
  "px per second from the grid" simply has no input.
- **10-10 labels, not 10-20.** T7/P7/T8/P8/Oz where the simulator uses T3/T5/T4/T6. Map before
  matching, or every montage lookup silently misses.
- **Different chain structure.** Five groups of four including a *four-row* midline chain
  (Fpz-Fz-Cz-Pz-Oz), where learningeeg uses a two-row midline. A comb fit given the wrong group
  spec converges confidently on the wrong answer.
- **Non-EEG rows.** ECG, SpO2 and heart-rate rows, timestamps and copyright lines all sit inside
  the image and get counted as trace ink.
- **JPEG/scanned sources.** Background is not pure white (median 653-765 rather than 765) and the
  near-binary ink threshold picks up compression noise — one figure reported 16.9% ink.

### Read the montage off the labels. Never assume it.

The channel names are printed at every row. Typing them from memory, or reusing the spec from the
last figure, is an assumption that fails silently — the comb fit converges *confidently* on the
wrong structure. Measured across one corpus: `ped-8mo` is parasagittal-first `[4,4,4,4,2]`,
`blinks` carries extra T1/T2 rows `[4,4,4,4,2,2,2]`, and the AES figures are `[4,4,4,4,4]` with a
**four-row** midline chain (Fpz-Fz-Cz-Pz-Oz) in 10-10 nomenclature. No single spec fits.

So: **crop the left label strip, magnify it, read it, and write the montage down** as part of the
measurement. Automatic detection — connected components on the whole image, rejecting anything
wider than ~6% of the image (traces are single long curves; glyphs are tiny isolated blobs), then
clustering by y and splitting groups on gaps >1.45× the median — is a *cross-check*, not a
replacement. It got `aes-f11` and `aes-f12` exactly right and over-counted `blinks` (25 vs 22) and
`sws` (37 vs 22). Where it disagrees with what you read, trust what you read and record both.

### Gate on resolvability before extracting anything

Whether traces can be separated at all is one measurable number: the fraction of columns where the
count of distinct ink runs reaches the number of rows. Compute it first, with the row count you
**read**, and refuse below threshold.

| figure | width | pitch | resolved | verdict |
|---|---|---|---|---|
| engine render | 1742 | 40.1 px | 91% | readable |
| learningeeg vertex-wave | 1696 | 29.5 px | 98% | readable |
| learningeeg blinks | 1696 | 30.0 px | 88% | readable |
| AES f10 | 800 | 19.2 px | 98% | readable |
| AES f11 | 800 | 20.8 px | 47% | marginal |
| learningeeg sws | 1696 | 15.4 px | 2% | not readable |

Above ~60% per-row extraction is sound; below ~25% nothing is. And note the row count must be the
read one — using an auto-detected count that is 3 too high drove `blinks` to a spurious 1.9%.

### Tracking tolerances scale with PITCH, not with pixels

A limit of `0.95 × pitch` reaches the neighbouring row's baseline. On 30-40 px figures that is
survivable; at the AES 20.8 px pitch it guarantees the tracker grabs the wrong trace — three rows
came back with byte-identical statistics, having locked onto one trace. Sweeping the limit at that
pitch: 0.95 gave a nonsensical 1.47 row-heights mean p2p, 0.50-0.70 gave a plausible 0.71-0.97.
**Use ~0.5 × pitch for the tight pass**, and check for duplicate per-row statistics as a
lock-on alarm.

### Read the CAPTION before asserting what a figure should show

Extraction from AES figure 11 returned no posterior alpha, which looked like a failure. The
caption reads "Lambda waves ... elicited by complex pattern viewing" — eyes open, so alpha is
blocked and its absence is *correct*. The validation criterion was wrong, not the measurement.

Where a caption makes a specific claim it becomes a genuine end-to-end test on a source with no
ground truth. AES figure 10 states "a drowsy burst of frontally dominant theta activity in the
third and fourth seconds". Reading its montage off the labels, taking time from the ECG clock
(100.0 px/s, an 8.0 s page) and extracting: frontal theta **52.2% inside the window against 23.6%
posterior**, and **+88% above its own out-of-window baseline**. Both halves of the caption
recovered, on a different lab, viewer and nomenclature.

### When there is no grid: the ECG is a clock

If the figure carries an ECG row *and* prints a heart rate, the R-R interval calibrates time.
Take the R-R period by **autocorrelation of the ECG row's ink profile**, not by peak-threshold
detection — thresholding gave 180 px/beat on a figure whose true period was 75.

Validated in both directions: on a grid-less AES figure with a printed 64 bpm it gives 80.0 px/s
and a **10.0 s page**, the standard duration; and run backwards on two figures that *do* have
grids it returns 60 and 61 bpm, both physiological. Where no HR is printed, the same measurement
still bounds the clock, since the implied HR must land in a physiological range.

### Take the FUNDAMENTAL period, not the strongest peak

Row-pitch autocorrelation returns the chain-**group** period, because that peak is stronger than
the row period. Reported 135 px where the true row pitch was 27, 149 where it was 30, 178 where it
was exactly 40. Fix: take the smallest lag whose autocorrelation is within ~75% of the best peak.
That corrects most figures; dense pages still fail, which is the already-documented limit.

### Absolute amplitude is recoverable when the figure states its sensitivity

Some figures carry the sensitivity in the filename or caption (`...-15uV`, `read-at-7uV-mm`). For
those, sensitivity plus a measured row pitch plus the clinical 10 mm row gives microvolts. Tested
on a neonatal quiet-sleep figure at 15 µV/mm: **132 µV median burst amplitude**, squarely inside
the expected 50-150 µV — so the 10 mm row assumption survives its one clean test. Treat this as
one data point, not a settled constant, and prefer dimensionless comparison whenever the
sensitivity is not stated.

### Reading the PDR from an image (iteration 1, 2026-09-10)

`scripts/read-lab/py/pdr.py`, scored by `iter1_pdr.py` (engine) and `iter1_online.py` (figures).

| version | awake called | N2 called | why |
|---|---|---|---|
| peak / median(4–6, 15–20 Hz flanks) | — | prominence 57 vs awake 93 | the ratio measures the 1/f slope; N2's 6–14 Hz maximum sat on the 6 Hz edge |
| 1a: height above aperiodic fit ≥ 6 dB, posterior > frontal by 3 dB | 48/48 | **16/48** | 6 dB is the noise ceiling at ~4 Welch averages; the same page at two sensitivities gave two "frequencies" |
| **1b: ≥ 10 dB, plus L/R agreement within 1 Hz** | **48/48** | **0/48** | — |

Online, 1b: `ap-gradient` called (31.4 dB, 11.75 Hz), `term-alpha` called (19.1 dB, 10.18 Hz,
L/R gap 0.06 Hz), `mu` not called with its alpha maximum central (12.6 dB central vs 6.7 posterior),
`sws` and `kc-spindles-posts` not called. Frequency against the drawn posterior peak on engine
pages: 0.26 ± 0.32 Hz awake. Score against the **drawn** peak, not `sampleSubject(seed).iaf`:
the two differ by up to ~0.4 Hz.

End to end (grid px/s, comb-fit baselines, no truth) matched true geometry within 0.2 dB and one
page, so geometry is not where this reader fails.

### Reading reactivity from an image (iteration 2, 2026-09-11)

`scripts/read-lab/py/reactivity.py`, scored by `iter2_reactivity.py` on `corpus/reactivity/`: 6
subjects × 2 renderers, 30 s pages with the eye-opening maneuver, and the same subjects without it
as controls. Truth comes from `groundTruth.eyesOpen`.

| version | openings found | false openings (maneuver / control) | read vs drawn index |
|---|---|---|---|
| 2a: first upswing, first downswing 1.5–6 s later | 36/42 | 6 / 0 | 0.20 ± 0.21 |
| **2b: skip upswings < 1.2 s after a closing; most prominent downswing** | **40/42** | **0 / 0** | **0.010 ± 0.007** |

Drawn-sample index over true windows: maneuver 0.45 ± 0.10 (max 0.66); same subject, no maneuver,
same windows 0.98 ± 0.13 (min 0.80). Threshold 0.75 sits between them. That is calibration on this
corpus, not an independent test: no real record with an eye opening has been read yet.

### The frequency half of the A–P gradient (2026-09-11)

`scripts/read-lab/py/apfreq.py`, one image reader for both sides:

| page | 2–30 Hz centroid front/back | beta/alpha front vs back | back/front p2p (bipolar) |
|---|---|---|---|
| learningeeg `ap-gradient` | 1.159 | 7.50 | 3.75 |
| learningeeg `term-alpha` | **0.791** | 25.32 | 0.46 (blinks dominate its frontal rows) |
| engine, awake | 0.931 ± 0.049 | 7.83 ± 1.67 | 3.06 ± 0.39 |

The centroid calls a normal record "slower in front" whenever the frontal rows carry
low-frequency power, which is why it was retired (IK-030). A figure with blinks on its frontal rows
cannot anchor an amplitude ratio.

### Failure log — methods that were tried and are wrong

- **Ink-density profile** to test whether amplitude is "diffuse": returned 1.83 for the engine
  against 2.74 for a reference page, i.e. called the engine *more* uniform when per-channel numbers
  said the opposite. Overlapping traces spread a tall channel's ink into neighbouring bands. The
  measure does not discriminate; do not revive it. A method that disagrees with the eye must be
  fixed or explained, never quietly dropped.
- **Median-of-gaps grid detection** and **autocorrelation row-pitch on real figures**: see the
  table above.
- **Alpha "prominence" as peak over flank median** (2026-09-10): measured the 1/f slope, and
  scored N2 at 57 against awake 93. Replaced by height above the aperiodic fit.
- **`load_ink` on app renders** (2026-09-10): it drops saturated pixels, which removes the app's
  blue and red chains — 16 of 18 rows. Use `load_ink(path, keep_coloured=True)` for app pages.
- **2–30 Hz spectral centroid for "faster in front"** (retired 2026-09-11): 0.79 on a normal real
  record. See the table above.
- **Eyeballing a bipolar figure's gradient and bounding a referential ratio with it** (2026-09-11):
  gave IK-029 a front-to-back ceiling of 5 the source never had.
