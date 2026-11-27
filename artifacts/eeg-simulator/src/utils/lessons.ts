/**
 * The Lessons section: how to read an EEG (polarity, subtraction, reversal, field,
 * calibration), each lesson taught on a live page of the simulator.
 *
 * Owner's inbox, 2026-11-27: "a teaching section ... that teaches the logic of EEG
 * such as negativity, phase reversal, etc", separate from the tutorial and quiz.
 *
 * Every sentence a lesson says about the trace is either a convention quoted from
 * learningeeg.com (Montages & Technical Components; Physiology & Terminology) or an
 * IK entry, and every direction or size it names on a row is listed in that view's
 * `claims`. Gate Step 30 builds each view's page exactly as the app does
 * (quizPage), isolates the `event` toggle's contribution in display space and
 * asserts every claim — so a change to the engine that makes a lesson wrong turns
 * the gate red instead of leaving the lesson to lie.
 */
import type { Sensitivity, Speed } from './simTypes';

/**
 * A claim about one row, read from the `event` toggle's own contribution (on minus
 * off, same seed). Directions are read at one instant: the largest excursion of the
 * view's `anchor` row, so rows said to "point toward each other" do so at once.
 */
export type LessonClaim =
  /** The row deflects down (input 1 more positive) or up (more negative). */
  | { kind: 'down' | 'up'; row: string }
  /** The row's excursion is larger than another row's. */
  | { kind: 'larger'; row: string; than: string }
  /** The row's excursion is the largest on the page. */
  | { kind: 'largest'; row: string }
  /** The row is under a quarter of the larger of its two flanks (IK-003 case b). */
  | { kind: 'flat'; row: string; flanks: [string, string] }
  /** The two rows move against each other through every event (correlation ≤ −0.4). */
  | { kind: 'opposite'; row: string; to: string };

export type LessonView = {
  /** Button text for switching to this view. */
  label: string;
  montage: string;
  /** Toggles on the page; the stage and anything they require come from quizPage. */
  patterns: string[];
  focalPlacement?: 'under' | 'between';
  /** Defaults 7 µV/mm and 30 mm/s; a view that does not name them restores those. */
  sensitivity?: Sensitivity;
  speed?: Speed;
  /** Rows highlighted on the trace while the view is open. */
  look: string[];
  /** What to see on this page. */
  text: string;
  /** The toggle the claims are about, and the row whose peak fixes the instant. */
  event?: string;
  anchor?: string;
  claims?: LessonClaim[];
};

export type Lesson = {
  id: string;
  title: string;
  /** The idea, before the page. */
  concept: string;
  views: LessonView[];
  /** Where the lesson's facts come from. */
  basis: string;
};

const LE_MONTAGES = 'learningeeg.com, Montages & Technical Components';

export const LESSONS: Lesson[] = [
  {
    id: 'negative-up',
    title: 'Negative is up',
    concept:
      'By convention a channel deflects UP when its first electrode is more negative than its second, and DOWN when it is more positive. ' +
      'The direction of a wave tells you a sign. It is the first thing to read and the easiest to get backwards.',
    views: [
      {
        label: 'A positive event: the blink',
        montage: 'reference-ipsi',
        patterns: ['blink'],
        look: ['Fp1-A1', 'Fp2-A2'],
        text:
          'The cornea is positive, and a blink rolls it up toward the forehead, so Fp1 and Fp2 go positive. ' +
          'Against the ear, Fp1-A1 and Fp2-A2 deflect DOWN at every blink, and the rows behind them much less. ' +
          'The smaller, slower swing back up that follows is the recording\'s low-frequency filter, not the eyes; the blink is the downward part.',
        event: 'blink', anchor: 'Fp1-A1',
        claims: [
          { kind: 'down', row: 'Fp1-A1' }, { kind: 'down', row: 'Fp2-A2' },
          { kind: 'larger', row: 'Fp1-A1', than: 'C3-A1' },
        ],
      },
      {
        label: 'A negative event: the vertex wave',
        montage: 'reference-car',
        patterns: ['v-waves'],
        look: ['Cz-AVG', 'C3-AVG', 'C4-AVG'],
        text:
          'Vertex waves of light sleep are surface-negative at the vertex. On the average reference Cz-AVG deflects UP, ' +
          'larger than any other row, with C3 and C4 beside it going up too, smaller.',
        event: 'v-waves', anchor: 'Cz-AVG',
        claims: [
          { kind: 'up', row: 'Cz-AVG' }, { kind: 'largest', row: 'Cz-AVG' },
          { kind: 'up', row: 'C3-AVG' }, { kind: 'up', row: 'C4-AVG' },
        ],
      },
    ],
    basis:
      `"negative potentials are upgoing waves, and positive potentials are downgoing waves" (learningeeg.com, Physiology & Terminology). ` +
      'IK-008 (the display is negative-up), IK-001 (blink polarity), IK-037 (vertex wave field).',
  },
  {
    id: 'bipolar-difference',
    title: 'A bipolar row is a difference',
    concept:
      'Each row of a bipolar montage is its first electrode minus its second. Fp1-F3 says which of Fp1 and F3 is the more negative and by how much. ' +
      'It never says what either electrode is on its own.',
    views: [
      {
        label: 'Each electrode against the ear',
        montage: 'reference-ipsi',
        patterns: ['blink'],
        look: ['Fp1-A1', 'F3-A1'],
        text:
          'Against the ear, a blink takes Fp1 far more positive than F3: Fp1-A1 swings DOWN a long way, F3-A1 down a little. ' +
          'Hold those two in mind, then look at the double banana.',
        event: 'blink', anchor: 'Fp1-A1',
        claims: [
          { kind: 'down', row: 'Fp1-A1' }, { kind: 'down', row: 'F3-A1' },
          { kind: 'larger', row: 'Fp1-A1', than: 'F3-A1' },
        ],
      },
      {
        label: 'The same blink, subtracted',
        montage: 'bipolar-ap',
        patterns: ['blink'],
        look: ['Fp1-F3', 'F3-C3'],
        text:
          'Fp1-F3 is exactly Fp1-A1 minus F3-A1 (the ear cancels): DOWN, because Fp1 is the more positive of the pair. ' +
          'F3-C3 is down too but smaller. The blink fades from front to back, so each link further back sees a smaller difference.',
        event: 'blink', anchor: 'Fp1-F3',
        claims: [
          { kind: 'down', row: 'Fp1-F3' }, { kind: 'down', row: 'F3-C3' },
          { kind: 'larger', row: 'Fp1-F3', than: 'F3-C3' },
        ],
      },
    ],
    basis:
      `"the voltage of the second electrode is subtracted from the voltage of the first" (${LE_MONTAGES}). ` +
      'IK-008, IK-001 (a bipolar row shows only that Fp1 exceeds F3).',
  },
  {
    id: 'phase-reversal',
    title: 'Phase reversal under an electrode',
    concept:
      'When one electrode sits over the peak of a discharge, the two links that share it carry the same wave in opposite directions. ' +
      'For a negative discharge they point TOWARD each other, and the electrode they point at is the focus.',
    views: [
      {
        label: 'Left temporal spikes, focus at T3',
        montage: 'bipolar-ap',
        patterns: ['focal-spikes-lt'],
        focalPlacement: 'under',
        look: ['F7-T3', 'T3-T5'],
        text:
          'At each spike F7-T3 points DOWN and T3-T5 points UP: toward each other, at T3. T3 is the most negative electrode. ' +
          'The reversal stays at T3 for every spike, which is what lets it localise. The spike also reaches Fp1-F7 and T5-O1, smaller.',
        event: 'focal-spikes-lt', anchor: 'T3-T5',
        claims: [
          { kind: 'down', row: 'F7-T3' }, { kind: 'up', row: 'T3-T5' },
          { kind: 'opposite', row: 'F7-T3', to: 'T3-T5' },
          { kind: 'larger', row: 'F7-T3', than: 'Fp1-F7' }, { kind: 'larger', row: 'T3-T5', than: 'T5-O1' },
        ],
      },
    ],
    basis:
      `"Negative discharges cause the surrounding tracings to point toward the electrode of maximal voltage" (${LE_MONTAGES}). ` +
      'IK-003 case (a), IK-004 (a reversal localises when it holds at one electrode).',
  },
  {
    id: 'isopotential',
    title: 'A source between two electrodes',
    concept:
      'If the peak sits midway between two electrodes, both see the same voltage and the link joining them is flat. ' +
      'The links on either side deflect in opposite directions. The focus is at the flat link, and there is no reversal to find.',
    views: [
      {
        label: 'Focus between F7 and T3',
        montage: 'bipolar-ap',
        patterns: ['focal-spikes-lt'],
        focalPlacement: 'between',
        look: ['Fp1-F7', 'F7-T3', 'T3-T5'],
        text:
          'F7-T3 barely moves at each spike, while Fp1-F7 points DOWN and T3-T5 points UP. ' +
          'A flat link with opposite flanks puts the focus between its two electrodes, F7 and T3.',
        event: 'focal-spikes-lt', anchor: 'T3-T5',
        claims: [
          { kind: 'flat', row: 'F7-T3', flanks: ['Fp1-F7', 'T3-T5'] },
          { kind: 'down', row: 'Fp1-F7' }, { kind: 'up', row: 'T3-T5' },
        ],
      },
      {
        label: 'Compare: focus at T3',
        montage: 'bipolar-ap',
        patterns: ['focal-spikes-lt'],
        focalPlacement: 'under',
        look: ['Fp1-F7', 'F7-T3', 'T3-T5'],
        text:
          'Move the focus under T3 and the picture changes: F7-T3 is no longer flat, and it reverses against T3-T5 instead.',
        event: 'focal-spikes-lt', anchor: 'T3-T5',
        claims: [{ kind: 'down', row: 'F7-T3' }, { kind: 'up', row: 'T3-T5' }],
      },
    ],
    basis: 'IK-003 case (b): the link spanning the pair reads under a quarter of its larger flank, and the flanks deflect in opposite senses.',
  },
  {
    id: 'referential',
    title: 'Referential montages localise by amplitude',
    concept:
      'In a referential montage every row shares one reference, so there are no phase reversals. ' +
      'The focus is the row with the largest deflection, and its direction is that electrode\'s sign, as long as the reference itself is quiet.',
    views: [
      {
        label: 'Left temporal spikes on the average',
        montage: 'reference-car',
        patterns: ['focal-spikes-lt'],
        focalPlacement: 'under',
        look: ['T3-AVG'],
        text:
          'T3-AVG deflects UP at each spike, far larger than any other row: T3 is the focus, and it is negative. ' +
          'Same discharge as the phase-reversal lesson, read a different way.',
        event: 'focal-spikes-lt', anchor: 'T3-AVG',
        claims: [{ kind: 'up', row: 'T3-AVG' }, { kind: 'largest', row: 'T3-AVG' }],
      },
      {
        label: 'Compare: the double banana',
        montage: 'bipolar-ap',
        patterns: ['focal-spikes-lt'],
        focalPlacement: 'under',
        look: ['F7-T3', 'T3-T5'],
        text: 'On the double banana the same spikes are found by their reversal at T3, not by size.',
        event: 'focal-spikes-lt', anchor: 'T3-T5',
        claims: [{ kind: 'down', row: 'F7-T3' }, { kind: 'up', row: 'T3-T5' }],
      },
    ],
    basis:
      `"the highest amplitude waveform is the one with the greatest voltage" (${LE_MONTAGES}). ` +
      'IK-003 case (a), referential clause.',
  },
  {
    id: 'montage-polarity',
    title: 'Polarity depends on the montage',
    concept:
      'A row\'s direction depends on whether the electrode is its first input or its second. ' +
      'The same event can point down on one montage and up on another, so a polarity is always stated with its montage.',
    views: [
      {
        label: 'POSTS on the average',
        montage: 'reference-car',
        patterns: ['posts'],
        look: ['O1-AVG', 'O2-AVG'],
        text:
          'POSTS are surface-positive at the occipital electrodes. O1 is the first input of O1-AVG, so they point DOWN there.',
        event: 'posts', anchor: 'O1-AVG',
        claims: [{ kind: 'down', row: 'O1-AVG' }],
      },
      {
        label: 'The same POSTS on the double banana',
        montage: 'bipolar-ap',
        patterns: ['posts'],
        look: ['P3-O1', 'T5-O1', 'P4-O2', 'T6-O2'],
        text:
          'On the double banana O1 and O2 are the SECOND input of P3-O1, T5-O1, P4-O2 and T6-O2, so the same positive POSTS point UP there. ' +
          'The occipital electrodes sit at the end of their chains, so there is no link below them to reverse against.',
        event: 'posts', anchor: 'P3-O1',
        claims: [{ kind: 'up', row: 'P3-O1' }, { kind: 'up', row: 'T5-O1' }],
      },
    ],
    basis:
      `"The occipital electrodes are hindered by the end of chain effect" (${LE_MONTAGES}). ` +
      'IK-008 (POSTS down on O1-AVG, up on the double banana).',
  },
  {
    id: 'mirrored-reversals',
    title: 'Two reversals that mirror each other',
    concept:
      'A positive maximum also reverses, but its two links point AWAY from each other. ' +
      'Lateral gaze swings the positive cornea toward one side, so one lateral frontal electrode goes positive while the other goes negative.',
    views: [
      {
        label: 'Lateral eye movements',
        montage: 'bipolar-ap',
        patterns: ['eye-movement'],
        // These movements are about 20 µV on the F7/F8 links (Step 30's page, any low
        // cut), 3 mm at 7 µV/mm and hidden under their own labels; 3 µV/mm makes them
        // about 7 mm. Said on the page, so the change of scale is not a silent one.
        sensitivity: 3,
        look: ['Fp1-F7', 'F7-T3', 'Fp2-F8', 'F8-T4'],
        text:
          'Drawn at 3 µV/mm (more sensitive than usual) because these movements are small; lesson 8 is about that setting. ' +
          'At each eye movement the two links at F7 deflect in opposite directions, and so do the two at F8, but as mirror images: ' +
          'where one pair points apart (positive), the other points together (negative), and they swap when the gaze turns back. ' +
          'A blink is different: it sends all four frontopolar rows down together.',
        event: 'eye-movement', anchor: 'F7-T3',
        claims: [
          { kind: 'opposite', row: 'Fp1-F7', to: 'F7-T3' },
          { kind: 'opposite', row: 'Fp2-F8', to: 'F8-T4' },
          { kind: 'opposite', row: 'Fp1-F7', to: 'Fp2-F8' },
        ],
      },
    ],
    basis:
      `Positive phase reversals: "more commonly seen with various artifacts" (${LE_MONTAGES}). ` +
      'IK-002 (lateral eye movement is out of phase at F7 and F8).',
  },
  {
    id: 'calibration',
    title: 'Calibration: µV/mm and mm/s',
    concept:
      'Sensitivity is how many microvolts move the trace one millimetre: a higher number draws the same signal smaller. ' +
      'Paper speed is how many millimetres one second takes. Change either and the waves look different while the brain has not changed.',
    views: [
      {
        label: 'Standard: 7 µV/mm, 30 mm/s',
        montage: 'bipolar-ap',
        patterns: [],
        look: ['P3-O1', 'P4-O2'],
        text:
          'An awake adult with the eyes closed, alpha largest on the back rows. Judge amplitude from the 100 µV calibration bar at the bottom right, ' +
          'not from the grid: on a screen the vertical millimetre depends on the window size, and the bar is what stays true.',
      },
      {
        label: 'Sensitivity 15 µV/mm',
        montage: 'bipolar-ap',
        patterns: [],
        sensitivity: 15,
        look: ['P3-O1', 'P4-O2'],
        text:
          'Same signal at 15 µV/mm: drawn at 7/15, a little under half the height. The calibration bar shrinks with it, because it still marks 100 µV.',
      },
      {
        label: 'Paper speed 15 mm/s',
        montage: 'bipolar-ap',
        patterns: [],
        speed: 15,
        look: ['P3-O1', 'P4-O2'],
        text:
          'Back to 7 µV/mm at half the paper speed: each second takes half the width, twice as many seconds fit on the screen, ' +
          'and the alpha waves look crowded. Standard adult reading is 30 mm/s; 15 mm/s is the neonatal standard.',
      },
    ],
    basis:
      `At 5 µV/mm "it takes 5 microvolts to move the pen 1 millimeter"; 30 mm/s is the adult reading standard and 15 mm/s the neonatal (${LE_MONTAGES}). ` +
      'IK-027 (calibration is internally consistent and marked), IK-006 (the alpha rhythm is posterior).',
  },
];
