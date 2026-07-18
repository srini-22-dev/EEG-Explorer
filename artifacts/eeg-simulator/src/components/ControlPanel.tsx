import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { MONTAGES, Montage } from '../utils/montages';

type ControlPanelProps = {
  montageId: string;
  setMontageId: (id: string) => void;
  artifacts: Set<string>;
  toggleArtifact: (id: string) => void;
  sleepStructures: Set<string>;
  toggleSleepStructure: (id: string) => void;
  speed: number;
  setSpeed: (v: number) => void;
  gain: number;
  setGain: (v: number) => void;
  clearAll: () => void;
};

const ARTIFACTS = [
  { id: 'electrode-pop', name: 'Electrode Pop', desc: 'Single-channel transient with abrupt onset and ringing.' },
  { id: 'sweat', name: 'Sweat Artifact', desc: 'Large slow sinusoidal drift, predominantly frontal.' },
  { id: '50hz', name: '50Hz Mains', desc: 'High-frequency interference making the trace look fuzzy.' },
  { id: 'blink', name: 'Eye Blink', desc: 'Large frontal downward/upward deflection.' },
  { id: 'eye-movement', name: 'Horizontal Eye Movement', desc: 'Lateral slow waves with opposite polarity at F7/F8.' }
];

const SLEEP = [
  { id: 'posts', name: 'POSTS', desc: 'Positive occipital sharp transients of sleep.' },
  { id: 'v-waves', name: 'Vertex Sharp Waves', desc: 'Sharp biphasic transients at the vertex.' },
  { id: 'k-complex', name: 'K Complex', desc: 'High-amplitude biphasic wave followed by slow wave.' },
  { id: 'spindles', name: 'Sleep Spindles', desc: '11-16 Hz waxing-waning bursts, stage 2 NREM.' }
];

export function ControlPanel({
  montageId, setMontageId,
  artifacts, toggleArtifact,
  sleepStructures, toggleSleepStructure,
  speed, setSpeed,
  gain, setGain,
  clearAll
}: ControlPanelProps) {
  
  return (
    <div className="w-80 h-full flex flex-col bg-slate-900 border-r border-slate-800 text-slate-200 overflow-y-auto">
      <div className="p-6 border-b border-slate-800">
        <h1 className="text-xl font-bold text-sky-400">EEG Simulator</h1>
        <p className="text-xs text-slate-400 mt-1">Clinical Teaching Workstation</p>
      </div>

      <div className="p-6 flex-1 space-y-8">
        
        {/* Montage */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Montage</h2>
          <RadioGroup value={montageId} onValueChange={setMontageId} className="flex flex-col space-y-2">
            {Object.values(MONTAGES).map(m => (
              <div className="flex items-center space-x-2" key={m.id}>
                <RadioGroupItem value={m.id} id={`m-${m.id}`} className="border-slate-500 text-sky-500" />
                <Label htmlFor={`m-${m.id}`} className="text-sm font-medium leading-none cursor-pointer text-slate-300">
                  {m.name}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Artifacts */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex justify-between">
            Artifacts
          </h2>
          <div className="space-y-3">
            {ARTIFACTS.map(a => (
              <div key={a.id} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Switch 
                    id={`art-${a.id}`} 
                    checked={artifacts.has(a.id)}
                    onCheckedChange={() => toggleArtifact(a.id)}
                    className="data-[state=checked]:bg-sky-500"
                  />
                  <Label htmlFor={`art-${a.id}`} className="text-sm cursor-pointer">{a.name}</Label>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-slate-500 hover:text-slate-300 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-slate-800 text-slate-200 border-slate-700 max-w-[200px]">
                    <p>{a.desc}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>

        {/* Sleep */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Sleep Structures</h2>
          <div className="space-y-3">
            {SLEEP.map(s => (
              <div key={s.id} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Switch 
                    id={`sleep-${s.id}`} 
                    checked={sleepStructures.has(s.id)}
                    onCheckedChange={() => toggleSleepStructure(s.id)}
                    className="data-[state=checked]:bg-sky-500"
                  />
                  <Label htmlFor={`sleep-${s.id}`} className="text-sm cursor-pointer">{s.name}</Label>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-slate-500 hover:text-slate-300 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-slate-800 text-slate-200 border-slate-700 max-w-[200px]">
                    <p>{s.desc}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </div>

        {/* Display Settings */}
        <div className="space-y-6 pt-4 border-t border-slate-800">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Paper Speed</Label>
              <span className="text-xs font-mono text-sky-400">{speed} mm/s</span>
            </div>
            <RadioGroup 
              value={speed.toString()} 
              onValueChange={(v) => setSpeed(Number(v))} 
              className="flex space-x-2"
            >
              {[15, 30, 60].map(s => (
                <div key={s} className="flex items-center space-x-1">
                  <RadioGroupItem value={s.toString()} id={`speed-${s}`} className="sr-only" />
                  <Label 
                    htmlFor={`speed-${s}`}
                    className={`px-3 py-1 rounded text-xs cursor-pointer border transition-colors ${speed === s ? 'bg-sky-500/20 border-sky-500 text-sky-400' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}
                  >
                    {s}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Sensitivity</Label>
              <span className="text-xs font-mono text-sky-400">{gain}x</span>
            </div>
            <Slider 
              value={[gain]} 
              min={0.5} max={2} step={0.5}
              onValueChange={([v]) => setGain(v)}
            />
          </div>
        </div>
      </div>

      <div className="p-6 border-t border-slate-800">
        <Button variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={clearAll}>
          Clear All Effects
        </Button>
      </div>
    </div>
  );
}
