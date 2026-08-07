import React, { useState, useEffect } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { EEGCanvas } from './components/EEGCanvas';
import { MONTAGES } from './utils/montages';
import { SimSettings, PatientState, resetGenerator } from './utils/eegGenerator';
import { TooltipProvider } from '@/components/ui/tooltip';

// Patterns that are graphoelements of a specific sleep/drowsiness stage, not
// independent overlays — they cannot occur outside the state that defines them.
// `target` is the state selecting the pattern jumps Background State to;
// `compatible` is every state the pattern is allowed to keep rendering in.
const STATE_LOCKED_PATTERNS: Record<string, { target: PatientState; compatible: PatientState[] }> = {
  'posts':     { target: 'n1', compatible: ['drowsy', 'n1', 'n2'] },
  'v-waves':   { target: 'n2', compatible: ['n1', 'n2'] },
  'k-complex': { target: 'n2', compatible: ['n2'] },
  'spindles':  { target: 'n2', compatible: ['n2'] },
  'wicket':    { target: 'drowsy', compatible: ['drowsy'] },
  'rmtd':      { target: 'drowsy', compatible: ['drowsy'] },
};

export default function App() {
  const [montageId,    setMontageId]    = useState<string>('bipolar-ap');
  const [speed,        setSpeed]        = useState<15 | 30 | 60>(30);
  const [sensitivity,  setSensitivity]  = useState<5 | 7 | 10 | 15>(7);
  const [patientState, setPatientState] = useState<PatientState>('awake');
  const [activePatterns, setActivePatterns] = useState<Set<string>>(new Set());

  const togglePattern = (id: string) =>
    setActivePatterns(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        const lock = STATE_LOCKED_PATTERNS[id];
        if (lock) setPatientState(lock.target);
      }
      return next;
    });

  // A stage-locked pattern can't survive a manual state change that moves the
  // patient out of the stage it belongs to (e.g. K-complex switched on in N2,
  // then the user manually selects Awake) — clear it rather than leave the
  // toggle showing "on" while nothing physiologically compatible renders.
  useEffect(() => {
    setActivePatterns(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        const lock = STATE_LOCKED_PATTERNS[id];
        if (lock && !lock.compatible.includes(patientState)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientState]);

  const clearAll = () => {
    setActivePatterns(new Set());
    resetGenerator();
  };

  const settings: SimSettings = { speed, sensitivity, patientState, activePatterns };

  // Build active-effects label list for canvas overlay
  const activeEffects = Array.from(activePatterns).slice(0, 5).join(' · ');

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden font-sans bg-[#c8e6c0]">
        <ControlPanel
          montageId={montageId}         setMontageId={setMontageId}
          activePatterns={activePatterns} togglePattern={togglePattern}
          speed={speed}                 setSpeed={setSpeed}
          sensitivity={sensitivity}     setSensitivity={setSensitivity}
          patientState={patientState}   setPatientState={setPatientState}
          clearAll={clearAll}
        />
        <div className="flex-1 flex flex-col h-full">
          <EEGCanvas
            montage={MONTAGES[montageId]}
            settings={settings}
            activeEffectsLabel={activeEffects}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
