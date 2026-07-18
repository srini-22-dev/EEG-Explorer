import React, { useState } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { EEGCanvas } from './components/EEGCanvas';
import { MONTAGES } from './utils/montages';
import { SimSettings, PatientState, resetGenerator } from './utils/eegGenerator';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  const [montageId,    setMontageId]    = useState<string>('bipolar-ap');
  const [speed,        setSpeed]        = useState<15 | 30 | 60>(30);
  const [sensitivity,  setSensitivity]  = useState<5 | 7 | 10 | 15>(7);
  const [patientState, setPatientState] = useState<PatientState>('awake');
  const [activePatterns, setActivePatterns] = useState<Set<string>>(new Set());

  const togglePattern = (id: string) =>
    setActivePatterns(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

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
