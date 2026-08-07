import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { PatientState } from '../utils/eegGenerator';

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
    patterns: []
  },
  {
    title: "The Alpha Rhythm",
    desc: "In an awake, relaxed patient with eyes closed, you'll see the Posterior Dominant Rhythm (Alpha, 8-13 Hz) prominently in the occipital channels (O1/O2).",
    state: 'awake',
    patterns: []
  },
  {
    title: "Recognizing Artifacts",
    desc: "Eye blinks create large slow deflections in the frontal leads (Fp1/Fp2) due to the corneoretinal dipole.",
    state: 'awake',
    patterns: ['blink']
  },
  {
    title: "Sleep Stages: N2",
    desc: "As the patient falls deeper into sleep, you'll see K-complexes and Sleep Spindles in the central leads.",
    state: 'n2',
    patterns: ['k-complex', 'spindles']
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
              className="text-slate-900"
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
