---
name: ik
description: "Add a clinical fact to INFORMING-KNOWLEDGE.md. Takes a plain-English EEG statement and turns it into a reviewed, ID'd, verifiable IK- entry. Trigger: /ik <statement>, e.g. /ik eye blink artifacts deflect downward in bipolar montages."
---

# /ik — add clinical ground truth

Turn a one-line EEG statement into a properly formatted entry in
[INFORMING-KNOWLEDGE.md](../../../INFORMING-KNOWLEDGE.md).

```
/ik eye blink artifacts deflect downward in bipolar montages
/ik spindles are 11-16 Hz and maximal at the vertex in N2
/ik --verify IK-003        # check whether the simulator actually obeys an entry
```

**Your job is not transcription.** The user is supplying a fact from memory; memory is where
errors enter. Review it first, format it second. A wrong fact formatted beautifully is the
worst possible outcome for this file — everything downstream will be built to satisfy it.

---

## Step 1 — Review the claim before formatting it

Judge the statement on four axes. Do **not** proceed to Step 2 until this is settled.

| Problem | What to do |
|---|---|
| **Factually wrong** | Say so plainly, give the correct version, ask whether to enter the correction instead. Do not enter the original. |
| **Too vague to disprove** | "Alpha is posterior" — posterior *relative to what*, by what ratio? Ask for the missing quantity, or propose one and mark it for confirmation. |
| **True but over-general** | Scope it. See the worked example below — this is the most common case. |
| **Contradicts an existing entry** | Do not add it. Draft a §11 *Conflicts and open questions* item naming both IDs and stop. |
| **Mechanism stated as fact** | Split it. The **Claim** says what the display does; the **Mechanism** field says why it might. See Step 4. |

Read the existing entries before judging — a contradiction is only visible if you know what is
already in there.

If the claim is sound, say so in one line and move on. Don't manufacture doubt.

## Step 2 — Assign the ID

Scan `INFORMING-KNOWLEDGE.md` for `### IK-(\d+)`, take the highest, add one. First real entry is
`IK-001`. **Never reuse or renumber**, including for retired entries.

## Step 3 — Pick the section

One of the eleven existing headings. Don't create new ones without asking. If the fact spans
two, put it in the one where someone would look for it first and cross-reference the other.

## Step 4 — Write the entry

```markdown
### IK-NNN — Short title

**Claim.** The clinical fact, corrected and scoped per Step 1, in observation space.

**Observable.** What you would see in the simulator: montage, patient state, toggles,
display settings, which channels, and the amplitude / duration / direction / frequency
that would falsify it.

**Mechanism.** *(optional, non-binding)* Candidate explanations. More than one may be
listed. Nothing here is asserted, and no **Check** may depend on it.

**Check.** The automated assertion, or `—`.

**Status.** <status> · **Source.** user, <YYYY-MM-DD>
```

**Claim** must be stated in **observation space** — what the display does, not why. Anything
about *why* belongs in **Mechanism**. This is the single most common thing to get wrong, because
plain-English statements of EEG facts almost always braid the two together ("a blink drives Fp1
positive, so the frontopolar rows deflect down" is two claims wearing one coat). Separate them: a
wrong **Mechanism** leaves the entry standing, a wrong **Claim** does not.

**Mechanism** binds nothing. List more than one candidate where more than one is plausible, and
name what the observable cannot distinguish. Remember that a bipolar derivation measures a
*difference* — it can never establish the absolute potential at either electrode, so any entry
whose Observable is bipolar cannot assert a single-electrode sign.

Consequently, **a Check lives in the same space as its Claim.** If the claim is about montage
rows, the assertion is about rendered channel values (sign of `Fp1-F3`), never about the
underlying electrode.

**Observable** is the field that does the work — it is what makes the fact testable. Ground it
in ids that actually exist:

- **Montages:** `bipolar-ap` · `bipolar-transverse` · `reference-car` · `reference-ipsi` · `reference-contra`
- **Patient states:** `awake` · `drowsy` · `n1` · `n2` · `n3`
- **Toggles:** `posts` `v-waves` `k-complex` `spindles` · `mu-rhythm` `wicket` `rmtd` `lambda` `pswy` `6hz-sw` `14-6-pos` `bets` · `blink` `eye-movement` `muscle` `chewing` `electrode-pop` `sweat` `50hz` · `gen-slowing` `focal-delta-temporal` `firda` `triphasic` `gpeds` `lpeds` · `focal-spikes-lt` `focal-spikes-rt` `focal-spikes-lf` `3hz-gsw` `polyspike-wave` `burst-suppression` `hypsarrhythmia` · `absence-ictal` `gtc-ictal` `focal-temporal-ictal` `focal-frontal-ictal`

> This list is a convenience copy and can go stale. If the id you need isn't here, check
> `artifacts/eeg-simulator/src/utils/patterns.ts` — that file is the registry.

**Check** is `—` unless an assertion in `scripts/src/validateEngine.ts` already covers it. If one
does, name it. Never invent a check that doesn't exist.

**Status:**
- `proposed` — any residual clinical doubt, or a number you supplied rather than the user.
- `unverified in code` — claim is solid, nobody has checked the simulator against it. **Default.**
- Never write `verified (manual)` or `enforced (automated)` at creation. Those are earned.

## Step 5 — Propose, then write

Show the entry and the section it lands in. **Wait for approval.** Then write.

This is required by `CLAUDE.md` §2 and is not a formality: invoking `/ik` authorizes *this one
edit to this one file*, and the diff is the last point at which a wrong fact can be caught. Never
write first and show after.

**Housekeeping on the first real entry only:** delete the `<details>` "Worked example — EXAMPLE
ONLY" block, and replace the `> **Status: scaffold...**` banner with a live entry count. Both are
placeholders that become misleading once real content exists. Mention this in the proposed diff.

---

## `--verify` mode

`/ik --verify IK-003` checks whether the simulator actually obeys an entry, rather than adding one.

1. Read its **Observable** and reproduce those exact conditions.
2. Prefer an assertion in `scripts/src/validateEngine.ts` using the existing
   `check(label, actual, lo, hi, unit)` helper and the DSP primitives in `scripts/src/dsp.ts`
   (`welch`, `fitAperiodic`, `hilbertEnvelope`, `dfa`, `spectralPeak`, `autocorr`). Don't write
   new analysis code.
3. Report the number, then propose the status change: `enforced (automated)` if a check now
   guards it, `verified (manual)` if you confirmed it by inspection only, `violated` if the
   simulator contradicts it.

**A `violated` result is a finding, not a bug to quietly fix.** Report it and stop. Whether the
code or the entry is wrong is a clinical question for the user.

---

## Worked example

**Input:** `/ik eye blink artifacts deflect downward in bipolar montages`

**Review.** The claim is sound as an observation. But it needs work on two axes.

*Over-general.* "Bipolar montages" is false for one montage in this repo: `bipolar-transverse`
opens with the symmetric derivation Fp1-Fp2, where a bilateral blink largely **cancels** rather
than deflecting down. Scope it to antero-posterior chains and state the transverse behaviour, or
the entry licenses a wrong rendering. Check `montages.ts` for the actual channel list rather than
assuming — that file also shows there are **four** frontopolar rows in `bipolar-ap`, not two.

*Mechanism braided into the claim.* The usual explanation — Bell's phenomenon rolling the
positive cornea toward Fp1/Fp2 — is an inference, not the observation. It goes in **Mechanism**,
and it is explicitly not asserted: the bipolar rows show only that Fp1 exceeds F3 and F7, which
would follow just as well from the frontal electrodes going negative.

Lateral eye movement is a neighbouring fact, not this one — flag it as a separate entry.

**Proposed — §4 Artifacts:**

```markdown
### IK-001 — Eye-blink deflection polarity

**Claim.** A blink produces a downward deflection wherever Fp1/Fp2 is input 1 of a bipolar
pair. Scope: antero-posterior bipolar chains only. In a transverse montage the symmetric
derivation Fp1-Fp2 largely cancels the blink instead.

**Observable.** Montage `bipolar-ap`, state `awake`, toggle `blink`, 30 mm/s, 7 µV/mm.
All four frontopolar rows — Fp1-F3, Fp2-F4, Fp1-F7, Fp2-F8 — deflect downward
simultaneously, decaying posteriorly down each chain. Switching to `bipolar-transverse`
with the same toggle, the Fp1-Fp2 row shows a markedly smaller excursion than any
bipolar-ap frontopolar row. Amplitude and duration are not asserted by this entry.

**Mechanism.** *(non-binding)* Conventionally attributed to Bell's phenomenon: the globe
rolls upward on lid closure, rotating the positive cornea toward Fp1/Fp2. Not asserted
here — the same observable follows from the frontal electrodes going negative.

**Check.** —

**Status.** unverified in code · **Source.** user, 2026-08-10
```

Then: *"Also proposing to delete the EXAMPLE-ONLY block and update the scaffold banner, since
this is the first real entry. Lateral eye movement looks like a natural `IK-002` — want to add
it?"*
