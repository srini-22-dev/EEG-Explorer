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
    <div className="absolute inset-0 z-40 pointer-events-none flex items-end justify-center pb-24">
      <div className="bg-slate-900/95 border border-slate-700 p-6 rounded-lg shadow-2xl w-[500px] text-slate-200 pointer-events-auto backdrop-blur">
        <h2 className="text-xl font-bold mb-2 text-emerald-400">{step.title}</h2>
        <p className="text-sm text-slate-300 mb-6">{step.desc}</p>
        
        <div className="flex justify-between items-center">
          <div className="text-xs text-slate-500">
            Step {stepIndex + 1} of {STEPS.length}
          </div>
          <div className="space-x-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setStepIndex(s => Math.max(0, s - 1))}
              disabled={stepIndex === 0}
              className="border-slate-700 text-slate-300"
            >
              Previous
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button size="sm" onClick={() => setStepIndex(s => s + 1)} className="text-slate-900">
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={onClose} className="bg-emerald-600 text-white">
                Finish
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400">
              Skip
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
