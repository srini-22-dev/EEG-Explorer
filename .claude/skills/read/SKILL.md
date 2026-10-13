---
name: read
description: "Verify a signal or display change the way an electroencephalographer would — render the trace across several subjects, moments, montages, states and sensitivities; read the page in the order a reader does (continuity, symmetry, AP gradient, PDR); back the eye with band-resolved spectra; and, when comparing against a real clinical record, measure BOTH sides in the same units before claiming a match. Trigger: /read <what changed>, e.g. /read beta amplitude. Use after any change to the engine, forward model, montages, computeChannel or the display, whenever a record is reported to look wrong, and whenever the simulator is being compared against a reference figure."
---

# /read — verify by reading the record, not the scalar

The validation battery answers "did a number stay inside a bound". This answers the
question a reader actually asks: **does the record look right?** Those are not the
same question, and this repo has a history of the first passing while the second
failed.

Use it after any change to `engine/`, `forward.ts`, `montages.ts`, `computeChannel.ts`
or the display, and whenever someone says the trace looks wrong. `CLAUDE.md` §4 —
display space is authoritative.

**Instruments.** All of them drive the production engine through the production display transform,
so reach for them before writing a probe:

| instrument | answers |
|---|---|
| `scripts/src/renderTrace.ts` | did my change do what I meant **on the page the user sees** (app paper, app montages) |
| `scripts/src/renderClinicalPage.ts` | does it look like a **real record**: white paper, square millimetres, any channel order. The engine side of every comparison against a reference figure |
| `scripts/src/measureField.ts --toggle <id>` | one source's **isolated field** (same-seed on−off, raw electrodes) and its bipolar-chain decay |
| `scripts/src/auditToggles.ts` | **every toggle at once**: isolated field, every row as a share of the largest, smallest/largest row, interval CV, and a flag on any toggle that stays under 1 mm of pen. The wide pass that finds a defect several patterns share — run it after any change to `forward.ts`, and before trusting that a class of patterns is right |
| `scripts/src/fitField.ts` | the **patch weights** of a generalized or regional field (`sources/fields.ts`), fitted to a target map, with the row table they give. Name single electrodes (`"T3"`, not `"T3/T4"`) for a lateralized field; it then prints both sides |
| `scripts/read-lab/` | reading **images**: extraction methods, benches, the reference corpus, the journal |

**Numbers quoted in this file are evidence, not thresholds.** Each shows what a failure looked like
on the engine of its day (this file reflects the engine as of its 2026-09-10 revision or
earlier). Never use one as a floor or a target — measure the reference in the same run.

---

## The seven mistakes this exists to prevent

**1. Judging from one draw.** The record varies enormously between subjects and
between moments. A burst, a waxing alpha run, a bad channel or a quiet stretch can
each own an eight-second window. Measured on this engine: the central bipolar
correlation has sd ≈ 0.19 across seeds, and the alpha on F3-C3 has sd ≈ half its
mean. A single window of a single seed tells you almost nothing, and acting on one
has already caused a correct change to be reverted here.

**2. Trusting a scalar that passes.** Real examples from this repo, all green at the
time the display was wrong:

| what was wrong | the scalar that said fine | why it missed |
|---|---|---|
| beta was 70% of the central rows | beta crest factor 7.94 / 9 | measures the generator in isolation, not the rendered row |
| every calibration check was a tautology | six IK-027 checks | they recomputed `v * pxPerUV` instead of calling the renderer |
| transverse montage could not localise | all of them | nothing asserted montage coverage |
| ECG rendered upside down | all of them | no check covered ECG polarity |

If a change is "verified" only by the gate going green, it is not verified.

**3. Comparing a measured number against an impression.** When the other side of the comparison is
a real clinical page — a reference figure, a record someone pastes in — it is not enough to measure
the engine carefully and *look* at the reference. That asymmetry is what produced a string of false
"it matches" reports here, and it has its own protocol below (**Comparing against a real clinical
record**). The tell is a sentence with a number on one side of it and an adjective on the other.

**4. Reading only the feature you changed.** Attention goes to the thing under repair, and the
defect beside it goes unseen — even when it is in the picture being examined. 2026-09-14: blinks
were enlarged, a page was rendered, and it was reported as matching learningeeg because "Fp1-F3
plunges through three rows, as on the figure". On that same page F7-T3 dipped nearly as deep as
Fp1-F7 (0.95 of it; the reference gives 0.07–0.32), and the gate had printed 0.948 against a
0.95 ceiling. The user found it. The cure is procedural: after any change, the whole-page read
(§2) comes before the look at the changed feature, and every row the feature reaches is measured
on both sides (**Comparing against a real clinical record** → *The row table*).

**5. Testing a field through two electrodes.** A pattern's name is a claim about ALL the rows:
"generalized" says every chain, "bifrontal" says the front of every chain and none of the back,
"focal" says one electrode and its neighbours. A check that reads Cz and O1, or Fz and T3, cannot
tell those apart. 2026-10-12: nine patterns taught as generalized — 3 Hz spike-wave, polyspike-wave,
the absence and tonic-clonic seizures, triphasic waves, FIRDA, GPEDs, the 6 Hz phantom spike-wave,
the hyperventilation build-up — were each one patch under Fz or Cz, and each drew as a midline
focus: the discharge on Fz-Cz, a third of it on the parasagittal rows, a tenth or less on the
temporal chains. Every one of their checks was green (GPEDs' sat at 6.04 against a ceiling of 6).
The measure that separates them is **smallest row / largest row** over the whole double banana,
taken in isolation — `auditToggles.ts` prints it for every toggle; the gate's `displayContribAll`
gives it to a check. On learningeeg's generalized figures it is 0.27–0.53; the midline-patch
versions measured 0.00–0.08.

**6. Assuming a toggle draws something.** Three artifact toggles drew nothing and nobody had
looked: sweat (0.4 µV — a scaling slip in its generator), mains (identical on every electrode, so
0.0 µV on every bipolar, average and ear-referenced row), and ECG on the double banana (1 µV). A
raw-electrode check passed for mains throughout, because against infinity it was there. After any
change to an artifact, and for any toggle you have not personally seen, confirm its isolated
contribution clears a millimetre of pen (7 µV at 7 µV/mm) on at least one row of the montage the
user is looking at. `auditToggles.ts` flags the ones that do not.

**7. Taking the code and the knowledge base agreeing as evidence.** They were usually written
together, by the same hand, on the same day. IK-012 said the slow wave after a spike was
surface-positive and the engine drew it so; an audit that found learningeeg showing the opposite
left both standing "because they agree" — one error, written down twice. When a reference
contradicts both, the reference is the finding. Quote it, get a second source, and fix the code,
its checks and the entry together, leaving a dated note in the entry saying what it got wrong
(2026-10-13: twelve entries corrected that way; the user's words were "IK are not above mistakes,
do research to fix them"). A related trap in the same audit: a check label that credits a source
with a number the source does not give — "LEARNINGEEG: roughly 1-2.5 s" for a figure learningeeg
states in hertz. Read the sentence the label claims to quote.

---

## Protocol

### 1. Sample — at least 3 subjects × 2 moments

```bash
pnpm --filter @workspace/scripts exec tsx ./src/renderTrace.ts \
  --state awake --montage bipolar-ap --seconds 10 --seed 42 --skip 45 --out "$SCRATCH/s42-t45.png"
```

`$SCRATCH` is this session's scratchpad directory — set it yourself at the top of the work
(`SCRATCH=<the scratchpad path this session was given>`); nothing defines it for you, and a path
copied from an earlier session will not exist. (The gate keeps its own evidence PNGs under the OS
temp dir, in `eeg-explorer-validate/`. It used to hard-code one session's scratchpad and crashed
with ENOENT at Step 23 in every session after it.)

Write renders to the session scratchpad (`$SCRATCH` above), or to `scripts/read-lab/corpus/engine/`
when they join the corpus — never loose into `scripts/`. The 30 PNGs already there are the user's
preliminary method-comparison corpus (catalogued in `scripts/read-lab/corpus/legacy.json`); leave
them where they are.

`--seed` changes the **subject** (different `sampleSubject` draw). `--skip` advances
the engine that many seconds and discards them, changing the **moment** within the
same subject. Vary both. Two seeds at two moments is the floor; four seeds is better
for anything subtle.

Render the same set before and after a change, with the same seeds and skips, or the
comparison is not a comparison. Keep both sets — "it looks better" is not a finding
until two pictures are side by side.

**Vary the conditions the change can reach, not just the seed.**

| axis | when it matters | cheap coverage |
|---|---|---|
| montage | any polarity, field or localisation claim — CLAUDE.md §4 says a polarity claim is meaningless without its montage | one bipolar (`bipolar-ap`) **and** one referential (`reference-ipsi`); add `bipolar-transverse` for anything about a focus |
| state | anything touching the background, band gains or a state-intrinsic source | `awake` plus the states the change can reach (`drowsy`, `n2`, `n3`, `rem`) |
| sensitivity | anything about amplitude or how prominent something looks | `--sensitivity 3` and `30`, the ends of the ladder — a change can look fine at 7 µV/mm and absurd at 30 |
| speed | morphology claims (a sharp transient at 30 mm/s is a blip at 10) | `--speed 10` and `30` |

**Not `reference-car` for amplitude topography.** With 19 electrodes the common average is a
poor stand-in for infinity: it nearly nulls Cz, which sits close to the array's electrical
centroid, and lifts the frontal rows. On the same signal and seeds (2026-08-25) it put Fp1 above
F3, ran the midline Fz > Cz > Pz, and read front-to-back 2.48 against 3.86 ear-referenced — the A–P
gradient backwards. Judge amplitude topography on `reference-ipsi`.

It is worst for exactly the patterns a learner most needs it for. The average of a GENERALIZED
discharge is the discharge, so subtracting it hands the quietest electrodes an inverted copy about
as large as what is left at the loudest: once the absence seizure was genuinely generalized, its
`Fz-AVG / O1-AVG` power ratio read 0.96 — "no frontal predominance" — while `Fz-A1 / O1-A1` read
several-fold, and the tonic-clonic discharge at `Cz-AVG` was 1.5× background while `Cz-A1` was
many times it. A "frontal-max survives CAR" check passes only for a field too focal to move the
average, which is how it kept three midline foci green. ACNS 2021 §C.1.a names the montages for
calling a generalized pattern frontally, occipitally or midline predominant (a 50% difference):
ipsilateral ear, transverse bipolar, common average, or a non-cephalic reference. Use the ear.

A change that only looks right in one montage, at one sensitivity, in one state has
not been verified — it has been framed.

### 2. Look at the images — in the order a reader would

Actually open them. **First write down which label each row carries.** The app's label
strip prints row *numbers* only, so look the order up in `utils/montages.ts` — `bipolar-ap` is
parasagittal-first (Fp1-F3 on the top row; left and right parasagittal, left and right temporal,
midline), `reference-ipsi` is Fp1, F7, F3, T3, C3, T5, P3, O1 | Fp2 … O2 | Fz, Cz, Pz,
`reference-car` follows the double banana instead (Fp1, F3, C3, P3, O1 | Fp2 … O2 | F7, T3, T5 |
F8, T4, T6 | Fz, Cz, Pz), and `bipolar-transverse` runs
F7-Fp1 … O2-T6 front to back. Naming the montage correctly is not the same as knowing where
row 8 is: a blind read put a Cz phase reversal in the left temporal lobe that way.

Then work the page the way the reference course teaches, because a defect usually breaks one of
these and leaves the rest intact:

1. **Continuity** — is the tracing unbroken? Gaps, flat runs or dropouts that are not
   a modelled bad electrode are a bug.
2. **Symmetry** — homologous rows (F3-C3 vs F4-C4, T5-O1 vs T6-O2) should look like
   the same record. Real asymmetry exists but is modest; a gross one is a finding.
3. **Antero-posterior gradient** — going down each chain, amplitude should rise and
   the rhythm should slow. Frontopolar rows quiet and fast, occipital rows tall and
   alpha. This is the single most informative glance on the page.
4. **Posterior dominant rhythm** — present, posterior, and *reactive* if you toggle
   `eyes-open`. Check it is on the posterior rows and not one link forward.
5. **State plausibility** — does the page look like the state it claims? Awake needs a
   PDR; N1 should be the quietest; N3 should be obviously high-amplitude slow.
6. **Only then, the thing you changed.**

Readings a blind test showed are easy to get wrong (2026-09-10, `scripts/read-lab/JOURNAL.md`):

- **Fast activity confined to T3/T4 rows is muscle until shown otherwise.** The temporalis is
  the classic EMG source. It was dismissed as background twice, and both times `muscle` was on.
- **A train of same-period frontal delta is FIRDA, not eyes.** Eye movements are single and
  irregular, and a lateral one mirrors at F7/F8. Several consecutive bilateral cycles at one
  period are a rhythm.
- **Slow roving lateral eye movements are evidence *for* drowsiness,** not a nuisance to set
  aside. The engine draws them in `drowsy`, as a real record would.
- **Count frequency; don't glance.** Two glanced PDR frequencies were off by 1–4 Hz.
- **A quiet stretch after an event is not the event's doing until a same-seed control says so.**
  After an eye closure the PDR looked absent for 5 s. The same subject at the same moment without
  the maneuver was just as quiet: the PDR was waning on its own.

Doing this in order catches collateral damage. A change aimed at beta that quietly
broke the AP gradient is invisible if you go straight to the beta rows.

The most useful comparison is not before/after — it is
**one row against another in the same picture**:

- a row carrying the source you changed, against a row that carries none
- homologous rows across the midline (F3-C3 vs F4-C4)
- the same chain's rows top to bottom (the antero-posterior gradient)

Rows that should differ and don't, or match and shouldn't, are the finding.

**Distractors that are not bugs.** Both move between rows when the seed changes,
which is itself the tell:
- bad electrodes (`sampleDefects`) put dense fuzz on one or two rows — but only when the
  `bad-electrodes` toggle is on. Since 2026-09-02 they are gated like every other artifact, so
  fuzz on an all-toggles-off page is a finding, not a distractor
- mu is a per-subject trait present in ~16% of subjects (and never in the app, where it is the
  `mu-rhythm` toggle only), so central rows legitimately
  carry alpha-band activity and a phase reversal in some subjects and not others

### 3. Back the eye with band-resolved spectra

Then measure what you saw, per row, across the same seeds. Bands as the app defines
them (`utils/fftBands.ts`): δ 0.5–4, θ 4–8, α 8–13, β 13–30, γ 30–50.

**The 1/f trap — read this before interpreting any band number.** EEG spectra follow
1/f, so the delta band collects the most raw power on essentially every channel. That
is true of real EEG too. Verified here by setting the awake delta gain to zero: the
delta band barely moved (Fz-Cz 21.1 → 20.2), because ~96% of it is aperiodic
background, not the delta source. So:

- **Never conclude "delta dominant" from raw band power.** It always is.
- **Compare against a reference row**, not against zero: the honest quantity is a
  band's share on a row carrying the source *minus* its share on a row carrying none.
  For beta, T3-T5 and P3-O1 are the reference rows. Measure their share **in the same
  run**: they sat at 33–36% by background alone when this was written, before the
  2026-08-25 A–P background tilt changed exactly those rows, so a remembered figure is
  not a floor.
- **Do not use band/band ratios on a row that lacks one of the bands.** beta/alpha on
  central rows stays above 1 however far beta is reduced, because those rows carry
  little alpha by design. That ratio is unusable there; the share is not.

**Look at the spectrum's shape, not only its band sums.** Band sums throw away the
thing that makes an EEG spectrum readable. On log-log axes a healthy channel is a
**straight 1/f line with bumps on it** — the line is the aperiodic background, the
bumps are the rhythms, and almost every question here is about one or the other:

- Is the line straight? A kink or shelf means a generator is misbehaving across a
  band edge, or a filter is doing something it shouldn't. `fitAperiodic(psd, 1, 45)`
  from `scripts/src/dsp.ts` returns the slope; compare it against the subject's own
  `sampleSubject(seed).exponent`, since that is the value the engine was asked for.
- Is the alpha bump where it should be? `spectralPeak(psd, 6, 14).freq` should land
  on that subject's `iaf`, within a few tenths. A peak in the wrong place, or no peak
  at all posteriorly, is a real defect that band power can hide.
- **Beware fitting the slope through a big peak.** Measured here: O1's fitted exponent
  came out 1.255 against P3's 1.661 — not because O1 is shallower but because its 28 µV
  alpha peak flattens the fit. Fit outside the rhythm, or subtract it, before believing
  a slope from an occipital channel.

Print the spectrum rather than only tabulating it — the shape is the point, and a
terminal histogram is enough to see it:

```ts
const psd = welch(row, FS, 4096);
for (let f = 1; f <= 40; f++) {
  const k = psd.freqs.findIndex(v => v >= f);
  const db = 10 * Math.log10(psd.power[k] + 1e-12);
  console.log(`${String(f).padStart(2)} Hz ${'#'.repeat(Math.max(0, Math.round(db + 40)))}`);
}
```

A straight taper with a bulge at the subject's alpha is right. A flat wall, a second
bulge you did not put there, or a peak at the wrong frequency is the finding.

**Is there a PDR? Measure the peak above the 1/f line, never above its neighbours.** A reader
calls a posterior dominant rhythm from three things together — a rhythm, in the alpha band,
maximal posteriorly — and each needs its own test (`scripts/read-lab/py/pdr.py`):

- **Height above the aperiodic fit.** Fit log power against log frequency over 2–30 Hz with 6–14
  Hz left out, and read the residual's highest point in 7–13.5 Hz. A "peak" within 0.5 Hz of
  either edge is the slope, not a rhythm. Peak-over-flanks ratios measure the slope instead: one
  called N2 a PDR on a third of pages, where N2 draws no posterior alpha at all.
- **Above the noise.** A 10 s page at 4 s Welch segments averages about 4 spectra, and noise
  alone then reaches ~5.5 dB somewhere in the band. Require **≥10 dB**, and raise it for shorter
  pages, which have fewer averages.
- **Bilateral**: left and right posterior peaks agree within 1 Hz. Noise peaks don't.
- **Posterior**: at least 3 dB above the frontopolar rows of the same page. Mu fails this
  honestly — its maximum is central.

Validated 2026-09-10 on 144 engine pages (awake 48/48 called, N2 0/48) and on five learningeeg
figures whose captions say what they show (5/5). Presence does **not** separate awake from
drowsy, because early drowsiness keeps a PDR; that needs a continuity measure.

**Grade the PDR with the eyes closed, and read its reactivity from the page.** The PDR is the
eyes-closed resting rhythm. learningeeg: wait until the eyes are closed, then count. The page
shows when they open: an **upward** frontopolar sweep (IK-011), and a smaller **downward** one when
they close a few seconds later. Between the two the posterior 8–13 Hz envelope should drop, and it
should be back within about a second of closing (IK-007).
`scripts/read-lab/py/reactivity.py` pairs the sweeps and compares the envelopes: 40/42 openings
found, 0 false ones, index within 0.01 of the drawn samples. **The trap:** the amplifier's
low-frequency filter makes every slow ocular sweep biphasic (IK-001). The closing sweep's recovery
overshoot is an upswing that looks exactly like an opening, so an upswing within ~1 s of a closing
is not an opening.

**After closure, expect a rebound.** In two real records (learningeeg's two Normal Awake
eye-closure figures, `scripts/read-lab/py/closure.py`) the PDR overshoots to ~2× its settled
amplitude 1–2 s after the eyes close, and is still raised at ~3 s. **Find the closure by what
follows it:** it is the frontal downswing *after which the PDR emerges*. The most prominent
downswing on a page can be a blink with more alpha before it than after. Low-passing can move a
fast Bell's sweep by half a second, so place it on the unfiltered trace. Grade the PDR's *amplitude* from the settled stretch,
not the rebound. Grade its *frequency* away from the first second too, because squeak can quicken
it there (learningeeg's own warning).

### 4. Choose a metric that can move

Before trusting a number, ask what would change it. Three that could not, discovered
the expensive way:

- **2–30 Hz spectral centroid** for the antero-posterior frequency gradient: the band
  is owned by the oscillators, so changing the aperiodic exponent underneath them does
  nothing (tilt 0.20 → 0.55 with the clamp lifted moved it 0.002). `beta/alpha power,
  frontopolar vs occipital` measures the same claim and reads 3.70. **The gate has not
  caught up:** `validateEngine.ts` still asserts the 2–30 Hz centroid and IK-030 still cites
  it (marked VIOLATED). That disagreement is the user's to settle (CLAUDE.md §2) — raise it,
  don't edit either side from inside a `/read`.
- **Generator-level statistics** for anything about a rendered row.
- **Anything asserting on `renderTrace` alone** for a claim about `EEGCanvas` — assert
  on the shared `displayGeometry.ts` helpers, which both renderers call.

**Confirm the metric responds before you trust it.** Perturb the parameter the metric
claims to measure — hard, well past anything you would ship — and check the number
moves. If it doesn't, the metric is not measuring that thing and no amount of tuning
will make it. This takes ten minutes and would have retired the spectral-centroid
check years before it cost several sessions.

**Always have a negative control.** Identify, in advance, the row or channel that
should *not* show the effect, and measure it too. "Beta share is 51%" means nothing;
"51% against a 36% floor on rows with no beta source" is a result. Most existing
checks lack this, and it is the cheapest single upgrade to any measurement here.

### 5. Report what varied, not just the mean

Give mean ± sd across seeds, say how many subjects and moments, and attach at least
one image. A number without its spread is a claim about one draw.

Report in this shape, so reports from different sessions can be laid side by side:

- **question / change** — one line
- **conditions** — montage(s), state(s), sensitivity, speed; seeds × skips (n subjects × moments)
- **per row, by label** — mean ± sd, with the **negative-control row** measured the same way
- **images** — at least one path, and which rows you looked at
- **IK entries exercised** — IDs, and whether each still holds
- **verdict** — and what measurement would change it

---

## Comparing against a real clinical record

Everything above verifies the engine **against itself**. Comparing it against a real page —
a figure from learningeeg.com, a record someone pastes in — is a different job with its own
failure mode, and the protocol above will not save you from it.

**The failure this exists to prevent.** Measuring the engine to three decimals and reading the
reference with your eyes, then reporting a "match". Every claim below was made that way and every
one was wrong or unfounded: that a blink recreation matched, that slow-wave sleep was too big,
that the vertex wave was midline-only. An impression compared against a number is not a
comparison.

**Where the references are.** The user verifies against **learningeeg.com** (twelve chapters and an
atlas) and **eegpedia.org**. Both can be read as text, and should be: fetch a chapter's HTML, strip
it to text in the scratchpad and grep it — a claim checked against a sentence you can quote beats one
checked against a memory of the site. learningeeg's figures are at `/images/<chapter>/<name>.webp`
(convert to PNG before `rowtable.py`). eegpedia answers on **http only** (https fails the handshake)
and rate-limits after about forty-five pages. ncbi.nlm.nih.gov — StatPearls and the AES atlas — puts
a CAPTCHA in front of automated fetches; do not work round it. Use search excerpts, and say in the
code comment and the report that an excerpt is what the number came from. For terminology and
polarity the **IFCN glossary of EEG terms** (Kane et al. 2017) is open access and can be read whole
through Europe PMC's API (`…/europepmc/webservices/rest/PMC6123891/fullTextXML`, in two halves):
it defines spike, sharp wave, triphasic wave, wicket spikes, mu, lambda, POSTS and the rest, and
is what settled the slow wave's polarity.

**Before extracting anything from an image, read [comparing-to-a-reference.md](comparing-to-a-reference.md)**
— the method tables (grid, pitch, trace tracking, crossover reconstruction, label reading, ECG
clock), the evidence behind them and the failure log. The code is in `scripts/read-lab/py/`; do
not rebuild it from the prose. The rules that govern every comparison:

- **Render the engine side with `renderClinicalPage.ts`**, in the reference's own channel order
  as read off its labels. `renderTrace`'s app paper and non-square millimetre confound every
  morphology comparison.
- **Read the montage off the figure's labels, and read the caption** before asserting what the
  figure should show. Never type a montage from memory.
- **Sensitivity cannot be recovered from an uncalibrated page, and a screenshot has no mm/s or
  µV/mm.** Work in row-heights (below).
- **Per-row claims are admissible only below ~0.5 mean occupancy.** Above it, only aggregate and
  multi-row-pattern claims, because trace extraction's worst single-row error climbs past 38%.
- **Gate on resolvability first** — the fraction of columns where the ink-run count reaches the
  row count you read. Below ~25%, nothing is extractable.
- **Validate the reader on the engine's own render** against the engine's exact values before
  trusting any number it produces from a reference.
- **Confirm px/s with a second clock** before quoting any frequency. The grid's first period is
  the finest regular rule, which is not always the second: 0.2 s dotted lines on one learningeeg
  figure (80 px, true 400 px/s), the 5 mm minor square on the app page. Check against the solid
  1 s rules, or against an ECG heart rate landing in 60–100 bpm.
- **Count, don't glance.** To check a frequency by eye, count cycles between two 1 s rules on a
  magnified crop. Judged from the whole figure, a 12 Hz alpha read as "about 10".

### The row table — the only admissible form of "it matches"

Before writing that the engine matches a reference, fill in this table and put it in the report:
one line per row of **every chain the feature reaches** (for a frontal transient: all four chains
and the midline, not just the row that carries it), reference and engine, same estimator, same
units, with the number of events on each side.

| row | reference (row-heights or ratio) | engine (same measure) | n ref / n engine | agree? |
|---|---|---|---|---|

For a transient, the natural measure is each row's own excursion relative to the largest row of
its chain — it needs no calibration. A row the reader cannot resolve is written as *unreadable*,
not skipped. If you cannot fill the table, the claim is "not compared", and you say so.

### Rule 0 — conditions before content

**A morphology or amplitude claim without the display conditions of BOTH pages is void.** Same
force as CLAUDE.md §4's rule that a polarity claim needs its montage. Establish, for each page:
seconds per page, px per second, row pitch, and page occupancy. If they cannot be matched, say so
and restrict the claim; do not proceed and hope.

### Therefore: row-heights, and match occupancy

The unit that survives is the **row-height** — dimensionless, measurable on both sides via the
comb-fit pitch, and exactly what a reader uses when they say a wave "fills the channel".

1. Measure the reference's **page occupancy** (mean per-row p2p in row-heights).
2. Render the engine and tune sensitivity until its occupancy matches. This substitutes for the
   unknowable sensitivity and is the only honest way to equalise gain.
3. Compare **ratios** — between rows, down a chain, transient against that row's own background.
   Never absolute microvolts.

### Average over events — one transient is one draw

The skill's own warning about single draws applies to the reference too, and harder. Measuring
vertex-wave spread on a single event gave reference 0.59 / engine 0.30; on five events, 0.77 /
0.32; converged by eight. **Averaging one event flipped the conclusion twice.** Use ≥5 well-separated
events per side, and report how many.

### The symmetry rule

**Both sides measured the same way, in the same units, with the same estimator.** If the engine
number comes from an on/off isolation and the reference number from an excursion-at-event, they
are not comparable — that mismatch alone made a real defect look like agreement. When the engine
side can be measured two ways, use the one the reference side also permits, even if it is the
weaker measurement.

### Measure SHAPE, not size — `max |deviation|` is blind

A single magnitude per event throws away the waveform. It cannot distinguish a sharp downstroke
from a downstroke followed by an overshoot, so it is structurally incapable of seeing the feature a
reader names first about an eye blink: **the upward swing after it**. Reported "matches" that were
built on `max |deviation|` were meaningless about morphology.

Use an **event-averaged signed waveform** instead: align every event on its own peak (refine the
alignment on the row with the largest deflection — a few px of jitter smears a 120 ms feature
badly), average the signed, baseline-corrected trace, and **plot it**. Then read off downstroke,
overshoot, their ratio, their timings and the half-width. Measured this way on eye blinks:
reference overshoot **+0.45 row-heights and sustained past 0.9 s**, engine **+0.28 decaying back to
+0.1 by 0.5 s**. Neither number is visible to a magnitude estimator.

Know which stage makes the feature before measuring it. The blink's overshoot is not in the
blink generator — `BlinkGenerator` is monophasic — it is made by the recording chain's
low-frequency filter (`chain.ts`, `CLINICAL_LFF_HZ`; IK-001). An isolation run with
`recordingChain: false` shows no overshoot at all, however the waveform is averaged.

## Probe skeleton

Reach for the instruments first (top of this file); write a probe only for what they don't
answer. A throwaway probe goes in `scripts/src/_probe.ts` and is **deleted before finishing**
(`git status` must be clean of it). A method you have **validated against truth** is not a
probe: it goes in `scripts/read-lab/py/` with a bench and a `JOURNAL.md` entry, so the next
session starts from the code rather than from prose. The first reading lab was lost to exactly
that, and every table in the reference file had to be re-derived before it could be trusted.

The skeleton drives the production engine through the production display transform, which is
the only measurement that counts.

```ts
import { MONTAGES } from '../../artifacts/eeg-simulator/src/utils/montages';
import { SimulationSource } from '../../artifacts/eeg-simulator/src/engine/adapter';
import { commonAverage, computeChannelVoltage } from '../../artifacts/eeg-simulator/src/utils/computeChannel';
import { defaultArtifactParams, defaultIctalParamsMap, type SimSettings } from '../../artifacts/eeg-simulator/src/utils/simTypes';
import { welch } from './dsp';

const FS = 250, SECS = 60, SEEDS = [3, 42, 777, 1234];
const m = MONTAGES['bipolar-ap'];

for (const seed of SEEDS) {
  const s: SimSettings = {
    speed: 30, sensitivity: 7, patientState: 'awake',
    activePatterns: new Set<string>(), ictalParams: defaultIctalParamsMap(),
    artifactParams: { ...defaultArtifactParams() },
  };
  const src = new SimulationSource(seed, FS);
  const n = SECS * FS;
  const d = m.channels.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    const v = src.next(s); const a = commonAverage(v);
    for (let c = 0; c < m.channels.length; c++) {
      d[c][i] = computeChannelVoltage(m.channels[c], src.t, v, a);
    }
  }
  // …measure per row here; accumulate across seeds and report mean ± sd…
}
```

For isolating one source's own contribution, difference two runs at the **same seed**
with the source on and off — via a `subject` override (e.g. `muFraction: 0`) or a
pattern toggle. Same seed means every other source is bit-identical, so the difference
is exactly that source.

---

## Known instrument gotchas

- **`--skip` and the time origin.** `renderTrace` draws x from `times[j] * pxPerSec`.
  Times are stored relative to the first *captured* sample precisely so `--skip` moves
  the window through the record; storing absolute time renders an empty grid. If a
  render comes back blank, suspect the time origin before suspecting the signal.
- **Row indices are not stable.** `renderTrace` prints row *numbers*, and those shift
  whenever a montage's channel list changes (`bipolar-ap` has been temporal-first, then
  parasagittal-first on 2026-09-11, temporal-first again on 2026-09-14, and parasagittal-first
  since 2026-09-22 at the user's request — do not move it again unasked; `bipolar-transverse`
  gained four rows; `reference-car` was regrouped by chain on 2026-10-12). Note that learningeeg
  calls the temporal-first layout the "double banana" and the parasagittal-first one the "bipolar
  T1-T2 montage": read a reference figure's order off its own labels. Refer to rows by **label** in
  anything you write down, and never compare row numbers across a montage change.
- **The seed does more than you think.** `SimulationSource(seed)` draws the whole
  subject — IAF, alpha amplitude, smearing, artifact burden, mu presence, bad
  electrodes, mains amplitude. Two seeds differ in all of it at once, which is why a
  single-seed comparison of one parameter is not a controlled experiment. To isolate
  one factor, hold the seed and override that field via `subject:`.
- **The app picks a random seed per load.** `SimulationSource` defaults to
  `Math.floor(Math.random() * 1e9)`, so what a user reports is one draw you cannot
  reproduce directly. Ask what it looked like, then sample broadly rather than hunting
  for their exact record.

- **Artifacts follow `activePatterns`, not `artifactParams`.** `SimulationSource` sets every
  artifact gate from the active toggle set (`adapter.ts`); `artifactParams` only tunes rates and
  severities for gates that are already on. An empty pattern set is already artifact-free —
  silencing `artifactParams` changes nothing, byte for byte.
- **An isolation without the recording chain cannot see what the chain makes.** `EegEngine`
  with `recordingChain: false` (most of `validateEngine.ts` §7c) bypasses the amplifier filters,
  gain mismatch, sensor noise and bad electrodes. Filter overshoot is the one that matters most
  on the page. `SimulationSource`, `renderTrace` and `renderClinicalPage` all keep the chain.
- **The app and the scripts switch a stage's features on differently.** In the app, what a stage
  brings (vertex waves, POSTS, spindles, K-complexes, slow waves, roving and REM eye movements) are
  toggles the app sets ON when the stage is entered, and the engine runs toggles-only
  (`SimulationSource.useAppMode()`), so a user can switch one off and it leaves the page.
  `renderTrace`, `auditToggles` and the gate never call that: there the STATE brings those features
  with no toggle set. A render with `--state n2` and no `--patterns` is therefore the app's N2 page
  with its defaults on, not the app with everything switched off. POSTS come one at a time unless
  the trains form is chosen: `renderTrace --posts trains`, or the control under the POSTS toggle.
- **Where the annotation arrows go is decided in `utils/markRows.ts`**, which the canvas and gate
  Step 27 both call: every row carrying at least 35% of the artifact's largest row, the ten largest
  at most, from the artifact's own field put through the montage. The arrows are a claim about
  where an artifact is, so check them like one: Step 27 compares them with the artifact's
  on-minus-off contribution, event by event and row by row. Independent sources (the two kinds of
  spindle, the two jaw muscles) are marked separately; a field summed across them puts arrows on
  rows the event is not on.
- **Which toggles can be on together is decided in `utils/toggleRules.ts`**, not in the engine: a
  table of states, requirements and exclusions (a blink needs Awake and open eyes; muscle is not
  available in REM; lambda needs open eyes), applied by pure functions the app makes every change
  through. Gate Step 26 walks 20,000 random actions through them. A script can still ask the
  engine for a page the app cannot reach (`--state rem --patterns blink`) — check a combination
  against `violations()` before treating a render of it as something a learner can see.
- **Two localising pictures, two ways to make them.** A focal spike under an electrode gives a
  phase reversal there; one midway between two electrodes makes the link spanning them go flat (an
  isopotential) with its flanks opposed. The focal-spike toggles do both: `renderTrace --focus
  between`, or the Focus control under the toggle. `sourceBetween()` in `forward.ts` is the
  geometry (a true equidistant point, which `sourceUnder([a, b])` is not).
- **The gate prints ~750 lines and takes 20–30 minutes.** Piping it through `tail` hides the
  checks you changed. Redirect it to a file, run it in the background, and grep. Run nothing else
  heavy beside it: an audit or a batch of renders alongside doubles its time, and theirs. Batch
  your model changes so one run covers them; measure a candidate bound with `auditToggles.ts`
  (seconds) before asking the gate (half an hour) whether it holds.
- **A field is an RMS map, not a signed-peak map.** `measureField` reports each electrode's
  largest single sample with its sign. For a transient that is the field; for ongoing activity it
  is noise. It made a perfectly symmetric generalized-slowing field "lean left" (P3 +49% vs P4
  −20%) when its RMS matched to within 1%.
- **A new consequence for an old input: audit the defaults that switch it on.** Once eye opening
  blocked the PDR, `EegEngine`'s default gates (eye-opening maneuver on) held every standalone
  "resting" run's eyes open 45% of the time. A resting-amplitude check passed for the wrong reason
  until the rebound pushed it over its ceiling.
- **Warm-up state leaks into the record.** `SimulationSource` runs 2 s of warm-up. Anything that
  fires there carries into the first displayed second, and the amplifier high-pass rings when it
  stops. Until 2026-09-11 that inflated every frontal row's p2p by ~40%, and several IK-029 bounds
  had been tuned against it. If the first second of a page differs from the rest, suspect warm-up.

## Finishing

- Delete every throwaway probe; `ls scripts/src/_*.ts` must come back empty. A method
  validated against truth goes to `scripts/read-lab/py/` with a bench and a `JOURNAL.md` entry.
- Renders live in the scratchpad, or in `scripts/read-lab/corpus/engine/` if they join the
  corpus. Nothing new loose in `scripts/`.
- Run the gate to a file, then grep what you touched and the verdict line:
  `pnpm --filter @workspace/scripts run validate > "$SCRATCH/validate.txt" 2>&1`, then
  `grep -n "<your labels>\|ALL CHECKS PASSED\|FAILED" "$SCRATCH/validate.txt"`. Report the real output.
- Read the gate's **near-bound review** (it prints above the verdict line). For every entry your
  change touches or created, state in the report whether the model or the bound is wrong, and
  where the bound's number comes from. A value parked on its bound passed because of the bound,
  not because the model is right — until shown otherwise.
- Name the IK entries the change exercised. If it moved a figure an entry quotes as
  `currently N`, refresh it (CLAUDE.md §7). If what you see contradicts an entry, **stop and
  raise it** — do not edit the entry or the code to make them agree (CLAUDE.md §2).
- If the eye and the gate disagree, **the eye wins** and the check is the thing to fix
  — write the check that would have caught what you saw, in display space.
- If a change made the record worse, revert it and record the negative result where
  the next person will hit it, rather than leaving a comment saying it was tried.
