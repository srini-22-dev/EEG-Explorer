import React, { useState } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { EEGCanvas } from './components/EEGCanvas';
import { MONTAGES } from './utils/montages';
import { SimSettings, PatientState, resetGenerator } from './utils/eegGenerator';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  const [montageId,     setMontageId]     = useState<string>('bipolar-ap');
  const [artifacts,     setArtifacts]     = useState<Set<string>>(new Set());
  const [sleepStructures, setSleepStructures] = useState<Set<string>>(new Set());
  const [speed,         setSpeed]         = useState<15 | 30 | 60>(30);
  const [sensitivity,   setSensitivity]   = useState<5 | 7 | 10 | 15>(7);
  const [patientState,  setPatientState]  = useState<PatientState>('awake');

  const toggleSet = (
    set: Set<string>,
    setFn: React.Dispatch<React.SetStateAction<Set<string>>>,
    item: string,
  ) => setFn(prev => {
    const next = new Set(prev);
    if (next.has(item)) next.delete(item); else next.add(item);
    return next;
  });

  const clearAll = () => {
    setArtifacts(new Set());
    setSleepStructures(new Set());
    resetGenerator();
  };

  const settings: SimSettings = { speed, sensitivity, patientState, artifacts, sleepStructures };

  const activeEffects = [
    ...Array.from(artifacts).map(a => ({
      'electrode-pop': 'Electrode Pop',
      sweat:           'Sweat Drift',
      '50hz':          '50 Hz Mains',
      blink:           'Eye Blink',
      'eye-movement':  'Lateral Eye Mvt',
    }[a] ?? a)),
    ...Array.from(sleepStructures).map(s => ({
      posts:       'POSTS',
      'v-waves':   'V Waves',
      'k-complex': 'K Complex',
      spindles:    'Spindles',
    }[s] ?? s)),
  ];

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden font-sans bg-[#c8e6c0]">
        <ControlPanel
          montageId={montageId}       setMontageId={setMontageId}
          artifacts={artifacts}       toggleArtifact={(id) => toggleSet(artifacts, setArtifacts, id)}
          sleepStructures={sleepStructures}
          toggleSleepStructure={(id) => toggleSet(sleepStructures, setSleepStructures, id)}
          speed={speed}               setSpeed={setSpeed}
          sensitivity={sensitivity}   setSensitivity={setSensitivity}
          patientState={patientState} setPatientState={setPatientState}
          clearAll={clearAll}
        />
        <div className="flex-1 flex flex-col h-full">
          <EEGCanvas
            montage={MONTAGES[montageId]}
            settings={settings}
            activeEffects={activeEffects}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
