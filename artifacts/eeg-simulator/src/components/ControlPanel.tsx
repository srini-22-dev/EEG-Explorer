import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { MONTAGES } from '../utils/montages';

type ControlPanelProps = {
  montageId: string;
  setMontageId: (id: string) => void;
  artifacts: Set<string>;
  toggleArtifact: (id: string) => void;
  sleepStructures: Set<string>;
  toggleSleepStructure: (id: string) => void;
  speed: number;
  setSpeed: (v: 15 | 30 | 60) => void;
  sensitivity: number;
  setSensitivity: (v: 5 | 7 | 10 | 15) => void;
  clearAll: () => void;
};

const ARTIFACTS = [
  { id: 'electrode-pop', name: 'Electrode Pop',          desc: 'Single-channel transient with abrupt onset and ringing.' },
  { id: 'sweat',         name: 'Sweat Artifact',         desc: 'Large slow sinusoidal drift, predominantly frontal.' },
  { id: '50hz',          name: '50 Hz Mains',            desc: 'High-frequency interference making the trace look fuzzy.' },
  { id: 'blink',         name: 'Eye Blink',              desc: 'Large frontal downward/upward deflection at Fp1/Fp2.' },
  { id: 'eye-movement',  name: 'Horizontal Eye Movement', desc: 'Lateral slow waves with opposite polarity at F7 vs F8.' },
];

const SLEEP = [
  { id: 'posts',     name: 'POSTS',              desc: 'Positive occipital sharp transients of sleep.' },
  { id: 'v-waves',   name: 'Vertex Sharp Waves', desc: 'Sharp biphasic transients at the vertex (Cz).' },
  { id: 'k-complex', name: 'K Complex',          desc: 'High-amplitude biphasic wave followed by slow wave.' },
  { id: 'spindles',  name: 'Sleep Spindles',     desc: '11-16 Hz waxing-waning bursts, stage 2 NREM.' },
];

/** Small colour legend dot for a chain group */
function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 flex-shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

export function ControlPanel({
  montageId, setMontageId,
  artifacts, toggleArtifact,
  sleepStructures, toggleSleepStructure,
  speed, setSpeed,
  sensitivity, setSensitivity,
  clearAll,
}: ControlPanelProps) {
  return (
    <div className="w-72 h-full flex flex-col bg-[#1e2a1e] border-r border-[#2e4a2e] text-slate-200 overflow-y-auto flex-shrink-0">
      {/* Header */}
      <div className="p-5 border-b border-[#2e4a2e]">
        <h1 className="text-lg font-bold text-emerald-400 tracking-tight">EEG Simulator</h1>
        <p className="text-xs text-slate-400 mt-0.5">Clinical Teaching Workstation</p>
      </div>

      <div className="p-5 flex-1 space-y-6">

        {/* Montage */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Montage</h2>
          <RadioGroup value={montageId} onValueChange={setMontageId} className="flex flex-col space-y-1.5">
            {Object.values(MONTAGES).map(m => (
              <div className="flex items-center space-x-2" key={m.id}>
                <RadioGroupItem value={m.id} id={`m-${m.id}`} className="border-slate-500 text-emerald-500" />
                <Label htmlFor={`m-${m.id}`} className="text-sm cursor-pointer text-slate-300 leading-snug">
                  {m.name}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </section>

        {/* Chain colour legend */}
        <section className="space-y-2 border border-[#2e4a2e] rounded-md p-3 bg-[#162016]">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Chain Colours</h2>
          <div className="space-y-1 text-xs text-slate-300">
            <div className="flex items-center"><Dot color="#1a4fa0" />Left paramedian / temporal</div>
            <div className="flex items-center"><Dot color="#8b1a1a" />Right paramedian / temporal</div>
            <div className="flex items-center"><Dot color="#1a3a1a" />Central (Fz-Cz, Cz-Pz)</div>
            <div className="flex items-center"><Dot color="#1b6b1b" />ECG</div>
          </div>
        </section>

        {/* Artifacts */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Artifacts</h2>
          <div className="space-y-2.5">
            {ARTIFACTS.map(a => (
              <div key={a.id} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Switch
                    id={`art-${a.id}`}
                    checked={artifacts.has(a.id)}
                    onCheckedChange={() => toggleArtifact(a.id)}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                  <Label htmlFor={`art-${a.id}`} className="text-sm cursor-pointer">{a.name}</Label>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-slate-600 hover:text-slate-300 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-slate-800 text-slate-200 border-slate-700 max-w-[200px]">
                    <p className="text-xs">{a.desc}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </section>

        {/* Sleep Structures */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Sleep Structures</h2>
          <div className="space-y-2.5">
            {SLEEP.map(s => (
              <div key={s.id} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Switch
                    id={`sleep-${s.id}`}
                    checked={sleepStructures.has(s.id)}
                    onCheckedChange={() => toggleSleepStructure(s.id)}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                  <Label htmlFor={`sleep-${s.id}`} className="text-sm cursor-pointer">{s.name}</Label>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-slate-600 hover:text-slate-300 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-slate-800 text-slate-200 border-slate-700 max-w-[200px]">
                    <p className="text-xs">{s.desc}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </section>

        {/* Display Settings */}
        <section className="space-y-5 pt-4 border-t border-[#2e4a2e]">
          {/* Paper Speed */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Paper Speed</Label>
              <span className="text-xs font-mono text-emerald-400">{speed} mm/s</span>
            </div>
            <div className="flex space-x-1">
              {([15, 30, 60] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`flex-1 py-1 rounded text-xs font-mono transition-colors border ${
                    speed === s
                      ? 'bg-emerald-700/40 border-emerald-600 text-emerald-300'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Sensitivity */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Sensitivity</Label>
              <span className="text-xs font-mono text-emerald-400">{sensitivity} µV/mm</span>
            </div>
            <div className="flex space-x-1">
              {([5, 7, 10, 15] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setSensitivity(v)}
                  className={`flex-1 py-1 rounded text-xs font-mono transition-colors border ${
                    sensitivity === v
                      ? 'bg-emerald-700/40 border-emerald-600 text-emerald-300'
                      : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-600 leading-tight">
              Standard: 7 µV/mm · Low gain: 10 µV/mm
            </p>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="p-5 border-t border-[#2e4a2e]">
        <Button
          variant="outline"
          className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white text-sm"
          onClick={clearAll}
        >
          Clear All Effects
        </Button>
      </div>
    </div>
  );
}
