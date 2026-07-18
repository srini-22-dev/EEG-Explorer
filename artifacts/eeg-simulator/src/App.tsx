import React, { useState } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { EEGCanvas } from './components/EEGCanvas';
import { MONTAGES } from './utils/montages';
import { resetGenerator } from './utils/eegGenerator';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  const [montageId, setMontageId] = useState<string>('bipolar-ap');
  const [artifacts, setArtifacts] = useState<Set<string>>(new Set());
  const [sleepStructures, setSleepStructures] = useState<Set<string>>(new Set());
  
  const [speed, setSpeed] = useState<number>(30);
  const [gain, setGain] = useState<number>(1);

  const toggleSet = (set: Set<string>, setFunction: React.Dispatch<React.SetStateAction<Set<string>>>, item: string) => {
    setFunction(prev => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  };

  const clearAll = () => {
    setArtifacts(new Set());
    setSleepStructures(new Set());
    resetGenerator();
  };

  const currentMontage = MONTAGES[montageId];
  
  const settings = {
    speed: speed as 15 | 30 | 60,
    gain: gain as 0.5 | 1 | 2,
    artifacts,
    sleepStructures
  };

  // Compile active effects for overlay
  const activeEffects = [
    ...Array.from(artifacts).map(a => {
      if(a === 'electrode-pop') return 'Electrode Pop';
      if(a === 'sweat') return 'Sweat Drift';
      if(a === '50hz') return '50Hz Mains';
      if(a === 'blink') return 'Eye Blink';
      if(a === 'eye-movement') return 'Lateral Eye Mvt';
      return a;
    }),
    ...Array.from(sleepStructures).map(s => {
      if(s === 'posts') return 'POSTS';
      if(s === 'v-waves') return 'V Waves';
      if(s === 'k-complex') return 'K Complex';
      if(s === 'spindles') return 'Spindles';
      return s;
    })
  ];

  return (
    <TooltipProvider>
      <div className="flex h-screen w-full bg-slate-950 overflow-hidden font-sans">
        <ControlPanel 
          montageId={montageId}
          setMontageId={setMontageId}
          artifacts={artifacts}
          toggleArtifact={(id) => toggleSet(artifacts, setArtifacts, id)}
          sleepStructures={sleepStructures}
          toggleSleepStructure={(id) => toggleSet(sleepStructures, setSleepStructures, id)}
          speed={speed}
          setSpeed={setSpeed}
          gain={gain}
          setGain={setGain}
          clearAll={clearAll}
        />
        <div className="flex-1 flex flex-col h-full bg-black">
          <EEGCanvas 
            montage={currentMontage}
            settings={settings}
            activeEffects={activeEffects}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
