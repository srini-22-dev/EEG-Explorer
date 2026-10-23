# Sleep architecture audit — findings, plan, results

Started 2026-09-11. Scope (user request): check sleep architecture, POSTS, K-complexes, spindles
and related graphoelements against learningeeg.com and independent sources, verify on the rendered
record (`/read`), fix what is wrong, and reorder the double banana to match learningeeg.com.
Per the request, `INFORMING-KNOWLEDGE.md` was **not** used as authority; every target below comes
from the sources listed, and no IK entry is edited (CLAUDE.md §2) — any disagreement is reported in
the last section instead.

Sources are paraphrased (they are copyrighted); numbers are reproduced because they are facts.

## Sources

| id | source | what it contributes |
|---|---|---|
| LE-A | learningeeg.com, *Normal Asleep* chapter — https://www.learningeeg.com/normal-asleep | stage definitions; POSTS "sail-like", singles or runs, from N1 on; vertex waves bilateral, phase-reversing over the central regions, alone or in runs; spindles symmetric 11–16 Hz; K-complex high-amplitude, initial negative then slow positive, often followed by a spindle; SWS >75 µV synchronized delta, usually 0.5–2 Hz; figure captions (vertex wave maximal over parasagittal and central chains; K-complex diffuse and biphasic, followed by a diffuse spindle) |
| LE-M | learningeeg.com, *10-20 & Montages* chapter | double banana structure; adult defaults 30 mm/s, 7 µV/mm, LFF 0.5–1 Hz, HFF 70 Hz |
| LE-F | learningeeg.com figures, viewed directly: `POSTs`, `Spindles`, `K Complex, Spindles, POSTs`, `POSTs and K Complex`, `Slow Wave Sleep I`, `Multiple vertex waves`, `Vertex wave`, `Drowsy state` | montage order as printed; topography and morphology of each element |
| AASM | AASM Manual for the Scoring of Sleep v2.0 (2012), https://www.neumosur.net/files/grupos-trabajo/suenio/AASM-Manual-2012.pdf | K-complex: negative sharp wave immediately followed by a positive component, total ≥0.5 s, usually maximal frontally. Spindle: 11–16 Hz (most commonly 12–14), ≥0.5 s, usually maximal centrally. Slow-wave activity: 0.5–2 Hz, >75 µV peak-to-peak, measured frontally; N3 when ≥20% of the epoch. V waves: sharply contoured, <0.5 s, maximal centrally. N1: alpha replaced by low-amplitude mixed-frequency (mainly 4–7 Hz) activity for >50% of the epoch |
| SP | StatPearls, *Normal EEG Waveforms*, https://www.ncbi.nlm.nih.gov/books/NBK539805/ | vertex transients surface-negative, phase-reversing at/near the vertex, ~100 ms; K-complexes >0.5 s |
| NPK | Neupsy Key, *Positive Occipital Sharp Transients of Sleep*, https://neupsykey.com/positive-occipital-sharp-transients-of-sleep/ | POSTS: surface-positive, phase reversal at O1/O2, triangular, mono- or diphasic; 20–75 µV (up to 120); 80–200 ms; singles >1 s apart or trains of 4–6/s lasting ~1 s (rarely >2 s); field across both occiputs, amplitude asymmetry up to 60% common; from late N1, may persist into SWS, rare in REM |
| COL | Colrain 2005, *The K-complex: a 7-decade history*, Sleep 28:255 (PubMed 16171251) | evoked KC negative peak (N550) at 500–650 ms; frontal maximum; persists into SWS, absent in REM |
| SPN | Healthy-adult spindle norms (n=80), https://pmc.ncbi.nlm.nih.gov/articles/PMC12172134/ | central fast spindles 0.80–1.11 s, 13.4–14.3 Hz, 5.2–15.2 µV peak (C3-A2), 1.0–5.8/min; frontal slow 0.79–1.17 s, 12.3–12.9 Hz, 4.1–13.2 µV |
| ACNS3 | ACNS Guideline 3 (2016), https://www.acns.org/UserFiles/file/EEGGuideline3Montage_final20160323revclean_v1.pdf | the three longitudinal layouts LB-18.1/.2/.3 |

## Findings on the engine as it stood (measured 2026-09-11)

All in display space unless stated. `probe` = same seed, one background source muted at a time,
4 subjects × 60 s, bipolar-ap. `field` = `measureField --toggle`, isolated same-seed on−off.

1. **A continuous midline theta rhythm in drowsiness and N1** (high severity: teaches a rhythm that
   is not there). Fz-Cz RMS 18–22 µV in N1 against 6.5–11 on every other row, peak 5.1–5.9 Hz. The
   `thetaDiffuse` source — one patch anchored midway between Cz and Pz — supplies 14.6 µV of it.
   Every learningeeg drowsy/N1/N2 figure shows quiet midline rows. *Model wrong.*
2. **N3 delta is a vertex focus, not diffuse synchronized delta** (high). Fz-Cz 110–118 µV RMS,
   Cz-Pz 83–94, T5-O1 7–10. Two independent point generators near Fz and Cz (`deltaF`, `deltaC`)
   carry it; being independent, the link between them is the largest on the page. LE-F's
   slow-wave figure has large delta on every chain, posterior included. *Model wrong.*
3. **Vertex wave invisible off the midline** (high). Field: Fz-Cz +48 / Cz-Pz −49 µV, F3-C3 and
   C3-P3 ~1 µV, temporal 0. LE-A's figure caption puts it over the parasagittal AND central
   chains. Its negative phase is also a 250-ms rounded half-sine, not a ~100 ms sharp wave (SP).
4. **Spindles invisible off the midline** (high). Field: Fz-Cz / Cz-Pz 70 µV, parasagittal <2 µV.
   LE-F shows spindles on every chain. Their carrier is three incoherent tones, which beat inside a
   single spindle.
5. **K-complex silent on Fz-Cz and maximal parietally in bipolar** (high). Field: Cz-Pz −215 µV,
   Fz-Cz 4.7 µV — the source sits midway between Fz and Cz, so the link spanning it cancels. AASM
   and COL: frontally maximal; LE-F: diffuse, on every chain.
6. **POSTS are metronomic, isolated and far too broad** (medium-high). One transient every ~2 s,
   never in trains; field C3-P3 = 67% of P3-O1, T3-T5 = 51% of T5-O1, and on Cz-Pz. LE-F's POSTS
   figure: frequent runs, confined to the P-O and T-O links; NPK: trains of 4–6/s.
7. **Slow-wave sleep is unreachable from the UI** (medium). The state buttons are Awake / Drowsy /
   Sleep (=N2) / REM, and no toggle selects N3 — one of LE-A's four phases of sleep.
8. **Drowsy tooltip describes N1, not drowsiness** (low). It says theta replaces alpha on >50% of the
   page; LE-A keeps a clear PDR in drowsiness, and >50% alpha loss is AASM's N1 rule.
9. **Montage order** (user request). bipolar-ap ran LB-18.3 (temporal first); learningeeg prints
   parasagittal first (LE-F, 5 of 6 figures read).

Baseline gate: **373 ok, 0 failed; 36 IK entries audited, 0 status mismatches.** It passed with
every defect above in place: nothing asserted a graphoelement's field off the midline, POSTS train
structure, N3 posterior delta, or midline dominance.

## Plan

1. Montage: bipolar-ap → L parasagittal, R parasagittal, L temporal, R temporal, midline.
2. Forward model: `synchronousPatches` — a generator made of several co-active cortical patches,
   one leadfield column by superposition (a single patch cannot give a regional field here).
3. Graphoelements (`sources/sleep.ts`), each from the sources above:
   POSTS (bilateral occipital narrow field; singles and 4–6 Hz trains; triangular 80–200 ms;
   20–75 µV); vertex wave (bilateral central field; ~100 ms sharp negative with small positive
   phases; <0.5 s); K-complex (diffuse, frontal maximum; sharp negative then slow positive, ≥0.5 s;
   followed by a spindle in most); spindles (fast centroparietal + slow frontal populations; one
   carrier per event; waxing-waning 0.5–2 s; symmetric).
4. Background (`engine.ts`): distributed theta patches replace `thetaDiffuse`; N3 delta becomes a
   synchronized frontally-predominant component plus local independent delta, replacing
   `deltaF`/`deltaC`. N3 reachable through a "Slow-Wave Sleep (N3)" toggle.
5. Checks (display space) for each claim, then `/read` against the learningeeg figures, then the
   gate and typecheck.

## Results

Measured means display space unless stated; "isolated" means the same seed with the toggle on
minus off, so the background cancels. Gate figures are from the final gate run.

### What changed, and what it measures now

| # | change (file) | before | after |
|---|---|---|---|
| 1 | midline theta in drowsy/N1 → 19 independent theta patches (`engine.ts`) | N1 Fz-Cz 18–22 µV RMS vs 6.5–11 elsewhere | midline / median row: drowsy 1.03, N1 1.08 |
| 2 | N3 delta → one synchronized frontally weighted slow oscillation + 19 local patches, local ones tilted frontally (`engine.ts`) | Fz-Cz 110–118 µV RMS, T5-O1 7–10; Cz-AVG 450 µV beside C3-AVG 97 | every chain carries delta (T5-O1/Fp1-F7 ≥0.59 on every gate subject, 0.75 mean over 4); midline / parasagittal 1.15; F3-A1/O1-A1 ≥1.39 (1.71 mean); AASM slow-wave activity 0.49 in the least slow 30 s epoch; ear-referenced p2p 79–121 µV at all 7 sites tested; F3/F4 slow-wave correlation 0.57 |
| 3 | slow-wave generators low-passed at 4 Hz (`oscillator.ts`) | N3 20–45 Hz RMS above awake (F3-C3 2.49 vs 1.94 µV) | delta's share of 20–45 Hz removed (F3-C3 2.49 → ~1.3 µV, now below awake) |
| 4 | vertex wave: bilateral central multi-patch field; ~100 ms sharp negative with small positive phases; runs (`sleep.ts`) | F3-C3 / Fz-Cz 0.02; 250 ms rounded negative half-sine | F3-C3 / Fz-Cz 0.83, reverses at C3; negative base 104 ms; whole wave 0.33 s; Cz-A1 100 µV |
| 5 | K-complex: frontal-maximal diffuse field; sharp negative then slow positive; spindle after 60% (`sleep.ts`) | Fz-Cz 4.7 µV vs Cz-Pz 215 (cancelled on Fz-Cz); maximum parietal in bipolar | Fz-A1/Cz-A1 1.56, Fz/Pz 3.3; p2p 148 µV; duration 0.87 s; on every chain (F7-T3 0.39, P3-O1 0.42 of the largest row); 50% followed by a spindle |
| 6 | spindles: fast centroparietal + slow frontal populations; one carrier per burst (`sleep.ts`) | parasagittal <2 µV; three beating tones | F3-C3 / Fz-Cz 0.83; slow 12.3 Hz at Fz, fast 13.8 Hz at Pz; visible 1.0 s (shortest 0.62); C3-A1 8.5 µV peak; L/R 1.05 |
| 7 | POSTS: bilateral occipital field; singles and 4–6/s trains; triangular 80–200 ms (`sleep.ts`) | one 75 µV transient every ~2 s; C3-P3 = 67% of P3-O1 | O1-A1 median 33 µV (max 54); 100 ms; trains at 4.8/s; 46% singles; C3-P3/P3-O1 0.19, T3-T5/T5-O1 0.21; UP on P3-O1 |
| 8 | sleep sources placed at one depth below the scalp (`forward.ts` `CORTEX_BELOW_SCALP`, `synchronousPatches`) | shell depth 0.5 cm under Cz, 4 cm under O1 | 1.9 cm everywhere for these sources |
| 9 | N3 reachable: "Slow-Wave Sleep (N3)" toggle (`patterns.ts`, `sleep.ts`, `App.tsx`) | unreachable | toggle → Background State N3, Sleep button stays lit (checked in the running app) |
| 10 | double banana order (`montages.ts`) | L/R temporal, L/R parasagittal, midline | L/R parasagittal, L/R temporal, midline — learningeeg's layout. **Swapped back 2026-09-14 at the user's request: L/R temporal, L/R parasagittal, midline (ACNS LB-18.3).** |
| 11 | teaching text: POSTS/vertex/K-complex/spindle tooltips and cues, drowsy tooltip, tutorial (`patterns.ts`, `annotations.ts`, `ControlPanel.tsx`, `TutorialMode.tsx`) | POSTS described as DOWNWARD with no montage — wrong on the default double banana; drowsy tooltip described N1 | polarity stated with its montage; drowsy keeps its PDR |
| 12 | quiz applies stage locks (`App.tsx`) | quiz on wicket/RMTD/14&6/BETS rendered nothing on an awake record; would have shown N3 as awake | stage-bound patterns shown in their stage |

### Checks

- **Added:** Step 19b, 43 checks, each bound from a named source (POSTS 9, vertex 8, K-complex 10,
  spindles 8, background 8). All pass. None would have passed on the old model.
- **Replaced (uncited by any IK entry), with the reason recorded at the check:** five Step 11
  checks that compared a transient's 1st–99th percentile p2p with an awake background whose O1
  is mostly alpha — they measured duty cycle and the PDR, and passed only with the defects in
  place (75 µV POSTS at the top of NPK's range; a Cz-anchored K-complex; a 250 ms vertex wave).
  Now isolated measurements at the right electrode.
- **Moved to the ear reference:** the spindle "central not occipital" ratio and the N3 per-site
  p2p. The common average removes a regional field's own mean, and it removes exactly the
  synchronized part of slow waves (CAR is already ruled out for amplitude topography in the
  read skill).
- **Gate (final run):** 413 ok (was 373). One check fails — IK-034's `N3 background / N1`, 2.346
  against 3–12 — and the knowledge-base audit reports the matching status mismatch, so the gate
  prints "2 CHECK(S) FAILED". Nothing else is red, including every awake, artifact, epileptiform
  and ictal check. `pnpm run typecheck` is clean on all four projects.

### Disagreement with INFORMING-KNOWLEDGE.md (not edited — CLAUDE.md §2)

**IK-034, clause "`n3` is 3–12× `n1`" — the bound is wrong, not the model.** Measured on the
entry's own metric (bipolar centro-posterior IQR) N3/N1 is 2.3–2.4. The same records measured
where AASM scores slow waves (frontal, referential F3-A1/F4-A2) give **N3/N1 4.28 and N3/N2
3.57** (4 subjects × 120 s), and N3 meets AASM with slow-wave activity in 49–84% of every 30 s
epoch. The centro-posterior bipolar rows are the place synchronized, diffuse delta cancels
most. The entry's 3.46 came from the old vertex-focal delta, whose steep gradient around Cz
loaded C3-P3 and C4-P4 — the defect this work removed. The 3–12 bound has no cited source (the
entry was drafted from the model of its day). Proposed diff, for approval:

```diff
-0.5–1.0 (currently 0.790), and `n1` is no louder than `drowsy` (currently 0.921). Going the other
-way, `n3` is 3–12× `n1` (currently 3.46) and 2–8× `n2` (currently 2.90).
+0.5–1.0 (currently 0.936), and `n1` is no louder than `drowsy` (currently 0.999). Going the other
+way, `n3` is 2–8× `n2` (currently 2.2). The N3/N1 contrast is asserted where AASM scores slow
+waves — frontal, ear-referenced (F3-A1/F4-A2 IQR): `n3` is ≥3× `n1` (currently 4.28). On the
+centro-posterior bipolar rows synchronized delta largely cancels, so the ratio there (2.3–2.4)
+is not a measure of N3's amplitude.
```
plus the matching check (`check('N3 background / N1, frontal ear-referenced (AASM derivation)',
…, 3, 12)`) replacing the bipolar one, and the `drowsy`/`n1` "currently" figures refreshed
(0.857 → 0.937, 0.790 → 0.936, 0.921 → 0.999).

**Applied 2026-09-14 on the user's approval.** The check measures N3/N1 = **4.39** frontally
(seed 5, 120 s; the probe's 4.28 was a 4-subject mean). Gate: **414 ok, 0 failed, 36 entries
audited, 0 status mismatches — ALL CHECKS PASSED.**

**IK-034, clause "`n1` at 0.5–1.0 of awake":** still holds (0.936) but N1's attenuation is weaker
than the entry's 0.790, because the old figure was measured with the midline theta source that
this work removed, and because POSTS now occur in trains on two of the four rows it averages.
Not a violation; noted because the "currently" figure is stale.

### What I measured vs what I believe

- **Measured:** every number in this section; the fields (`measureField`); the pages (renders in
  the session scratchpad — N1/N2/N3 before and after, same seed and moment; N2 over 3 subjects ×
  2 moments; N3 ear-referenced); the running app (montage order, the N3 toggle, no console
  errors after reload).
- **Checked and not acted on:** on one N1 page the T5-O1 theta looked monorhythmic (a learner
  could mistake it for RMTD). Over 4 subjects × 120 s the N1 theta peak is broad — FWHM 2.3–3.1 Hz
  on every row, i.e. spanning ~4–7 Hz — and 22–41% of 1 s windows are theta-dominated (awake:
  0–0.2%), which is what AASM's "predominantly 4–7 Hz" N1 looks like. A broader generator
  (damping −4.5, wander 1 Hz) only lowered theta dominance to 14–20%. One page was one draw.
- **Believed, not measured:** that learningeeg's POSTS are confined to the occipital link and its
  K-complex is diffuse — read by eye from magnified figures, multi-row patterns only. An
  image reader could not isolate the reference's POSTS (see `scripts/read-lab/JOURNAL.md`,
  iteration 4), so no per-row reference number is claimed.
- **Modelling choices inside a sourced range:** POSTS and K-complex rates, the 25% share of
  vertex-wave runs, the 60% spindle-after-K-complex share, the local slow-wave frontal tilt, the
  N1/N2 theta and slow-wave RMS values. Each is stated as a choice where it is set.

### Not reached — where the next pass should start

1. **The shell depth for every other source.** Only the sleep sources use `CORTEX_BELOW_SCALP`.
   Alpha, mu, beta, spikes, artifacts and every other pattern still sit on a sphere that is
   0.5 cm under Cz and 4 cm under O1/Fp1, which makes vertex sources too focal and
   frontopolar/occipital ones too broad. Moving them re-fits every extent.
2. **Recording conditions.** LFF is 0.25 Hz where learningeeg and ACNS give 0.5–1 Hz; HFF 100 Hz
   against a 70 Hz standard; no notch; no filter controls. Slow-wave amplitude and K-complex
   morphology depend on the LFF (the 0.25 Hz corner passes 0.5 Hz delta at 0.89; a 1 Hz corner
   would pass it at 0.45), and none of the sleep checks names a filter.
3. **POSTS asymmetry.** NPK: asymmetric in about a third of records, up to 60%. The POSTS field
   is symmetric by construction.
4. **Sawtooth waves of REM** and **hypnagogic hypersynchrony** are not modelled.
5. **Arousals and stage transitions:** states still switch rather than drift, and no
   K-complex–arousal pairing (AASM's rule) exists.
