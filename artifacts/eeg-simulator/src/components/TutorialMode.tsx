import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { PatientState } from '../utils/simTypes';

type TutorialStep = {
  title: string;
  desc: string;
  state?: PatientState;
  patterns?: string[];
  montage?: string;
};

const STEPS: TutorialStep[] = [
  {
    title: "Welcome to EEG Reading",
    desc: "This is a standard 10-20 EEG recording. Let's start with a normal awake patient.",
    state: 'awake',
    patterns: [],
    montage: 'bipolar-ap'
  },
  {
    // Distinct from step 1 on two counts: an ear-referenced montage, so O1/O2 each
    // have a row of their own and the posterior maximum is read directly, and the
    // eye-opening manoeuvre, whose open interval blocks the PDR (IK-007) — so the
    // page shows reactivity, the property that makes a posterior rhythm the PDR.
    // The manoeuvre's first opening comes ~0.3 s after it is switched on
    // (OCULAR_FIRST_EVENT_LEAD_SEC), then about every 12 s.
    title: "The Alpha Rhythm",
    desc: "In an awake, relaxed patient with the eyes closed, the Posterior Dominant Rhythm (alpha, 8-13 Hz) is largest over the occipital leads: O1-A1 and O2-A2 in this ear-referenced montage. Watch the eyes open on command (an upward sweep on the frontopolar rows): the alpha attenuates while they are open and returns once they close (a smaller downward sweep). That reactivity is what identifies it as the PDR.",
    state: 'awake',
    patterns: ['eye-opening'],
    montage: 'reference-ipsi'
  },
  {
    title: "Recognizing Artifacts",
    desc: "Eye blinks create large slow deflections in the frontal leads (Fp1/Fp2) due to the corneoretinal dipole.",
    state: 'awake',
    patterns: ['blink'],
    montage: 'bipolar-ap'
  },
  {
    title: "Sleep Stages: N2",
    desc: "As the patient falls deeper into sleep, N2 brings K-complexes — large, frontally maximal waves seen on every chain — and sleep spindles, 11-16 Hz bursts maximal over the central regions.",
    state: 'n2',
    patterns: ['k-complex', 'spindles'],
    montage: 'bipolar-ap'
  },
  {
    title: "Abnormal Patterns",
    desc: "Notice the phase reversal at T3. In a bipolar montage, spikes pointing at each other indicate the source of the electrical discharge.",
    state: 'awake',
    patterns: ['focal-spikes-lt'],
    montage: 'bipolar-ap'
  }
];

type TutorialModeProps = {
  onClose: () => void;
  setPatientState: (s: PatientState) => void;
  setActivePatterns: (p: Set<string>) => void;
  setMontageId: (m: string) => void;
};

export function TutorialMode({ onClose, setPatientState, setActivePatterns, setMontageId }: TutorialModeProps) {
  const [stepIndex, setStepIndex] = useState(0);
  
  useEffect(() => {
    const step = STEPS[stepIndex];
    if (step.state) setPatientState(step.state);
    if (step.patterns) setActivePatterns(new Set(step.patterns));
    if (step.montage) setMontageId(step.montage);
  }, [stepIndex]);
  
  const step = STEPS[stepIndex];
  
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 pointer-events-none flex justify-center px-3 pb-[max(12px,env(safe-area-inset-bottom))] [@media(min-width:768px)_and_(min-height:521px)]:pb-24">
      <div role="dialog" aria-label={step.title}
        className="ui-material pointer-events-auto w-full max-w-[520px] rounded-[18px] border border-ui-sep shadow-[var(--ui-shadow)] p-5 text-ui-text animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] font-semibold text-ui-accent tabular-nums">Step {stepIndex + 1} of {STEPS.length}</div>
          <div className="flex gap-1" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 rounded-full transition-all ${i === stepIndex ? 'w-4 bg-ui-accent' : 'w-1.5 bg-ui-fill-2'}`} />
            ))}
          </div>
        </div>
        <h2 className="text-[20px] font-bold leading-tight mt-1.5">{step.title}</h2>
        <p className="text-[14px] pointer-coarse:text-[15px] leading-relaxed text-ui-text-2 mt-2 mb-4">{step.desc}</p>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Skip
          </Button>
          <div className="flex-1" />
          <Button
            variant="outline"
            onClick={() => setStepIndex(s => Math.max(0, s - 1))}
            disabled={stepIndex === 0}
          >
            Previous
          </Button>
          {stepIndex < STEPS.length - 1 ? (
            <Button onClick={() => setStepIndex(s => s + 1)}>
              Next
            </Button>
          ) : (
            <Button onClick={onClose}>
              Finish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
