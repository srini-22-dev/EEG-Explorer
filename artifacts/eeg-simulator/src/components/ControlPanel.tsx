import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { MONTAGES } from '../utils/montages';
import { PatientState } from '../utils/eegGenerator';

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
  patientState: PatientState;
  setPatientState: (s: PatientState) => void;
  clearAll: () => void;
};

const ARTIFACTS = [
  { id: 'electrode-pop', name: 'Electrode Pop',          desc: 'Single-channel transient with abrupt onset and ringing.' },
  { id: 'sweat',         name: 'Sweat Artifact',         desc: 'Large slow sinusoidal drift, predominantly frontal.' },
  { id: '50hz',          name: '50 Hz Mains',            desc: '50 Hz mains interference — trace appears fuzzy/thickened.' },
  { id: 'blink',         name: 'Eye Blink',              desc: 'Large positive deflection at Fp1/Fp2 from eyelid movement.' },
  { id: 'eye-movement',  name: 'Horizontal Eye Mvt',     desc: 'Lateral slow waves with opposite polarity at F7 vs F8.' },
];

const SLEEP = [
  { id: 'posts',     name: 'POSTS',              desc: 'Positive occipital sharp transients of sleep.' },
  { id: 'v-waves',   name: 'Vertex Sharp Waves', desc: 'Sharp biphasic transients maximal at Cz.' },
  { id: 'k-complex', name: 'K Complex',          desc: 'High-amplitude biphasic wave at Fz/Cz/Pz followed by slow wave.' },
  { id: 'spindles',  name: 'Sleep Spindles',     desc: '12-15 Hz waxing-waning bursts, central, stage 2 NREM.' },
];

const PATIENT_STATES: { value: PatientState; label: string; desc: string }[] = [
  {
    value: 'awake',
    label: 'Awake',
    desc: 'Posterior-predominant alpha (9-11 Hz), low-amplitude frontal beta.',
  },
  {
    value: 'drowsy',
    label: 'Drowsy',
    desc: 'Posterior theta replaces alpha (>50% of page); diffuse slowing.',
  },
  {
    value: 'sleep',
    label: 'Sleep',
    desc: 'Vertex waves, spindles and K-complexes in central leads; posterior delta/theta.',
  },
];

export function ControlPanel({
  montageId, setMontageId,
  artifacts, toggleArtifact,
  sleepStructures, toggleSleepStructure,
  speed, setSpeed,
  sensitivity, setSensitivity,
  patientState, setPatientState,
  clearAll,
}: ControlPanelProps) {
  return (
    <div className="w-72 h-full flex flex-col bg-[#1e2a1e] border-r border-[#2e4a2e] text-slate-200 overflow-y-auto flex-shrink-0">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-[#2e4a2e]">
        <h1 className="text-lg font-bold text-emerald-400 tracking-tight">EEG Simulator</h1>
        <p className="text-xs text-slate-400 mt-0.5">Clinical Teaching Workstation</p>
      </div>

      <div className="px-5 py-4 flex-1 space-y-5 overflow-y-auto">

        {/* Patient State */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Patient State</h2>
          <div className="flex flex-col gap-1.5">
            {PATIENT_STATES.map(ps => (
              <Tooltip key={ps.value}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setPatientState(ps.value)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors border ${
                      patientState === ps.value
                        ? 'bg-emerald-800/50 border-emerald-600 text-emerald-200'
                        : 'border-[#2e4a2e] text-slate-400 hover:bg-[#243424] hover:text-slate-200'
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      {ps.label}
                      <Info className="w-3 h-3 opacity-40" />
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-slate-800 text-slate-200 border-slate-700 max-w-[220px]">
                  <p className="text-xs">{ps.desc}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </section>

        <div className="border-t border-[#2e4a2e]" />

        {/* Montage */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Montage</h2>
          <RadioGroup value={montageId} onValueChange={setMontageId} className="flex flex-col space-y-1">
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

        <div className="border-t border-[#2e4a2e]" />

        {/* Artifacts */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Artifacts</h2>
          <div className="space-y-2">
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
                  <TooltipContent side="right" className="bg-slate-800 text-slate-200 border-slate-700 max-w-[210px]">
                    <p className="text-xs">{a.desc}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </section>

        <div className="border-t border-[#2e4a2e]" />

        {/* Sleep Structures (manual overrides; auto-active in Sleep state) */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Sleep Structures
            <span className="ml-1 text-[10px] normal-case text-slate-600">(auto in Sleep state)</span>
          </h2>
          <div className="space-y-2">
            {SLEEP.map(s => (
              <div key={s.id} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Switch
                    id={`sleep-${s.id}`}
                    checked={sleepStructures.has(s.id) || patientState === 'sleep'}
                    onCheckedChange={() => toggleSleepStructure(s.id)}
                    disabled={patientState === 'sleep'}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                  <Label htmlFor={`sleep-${s.id}`} className={`text-sm cursor-pointer ${patientState === 'sleep' ? 'text-slate-500' : ''}`}>
                    {s.name}
                  </Label>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-slate-600 hover:text-slate-300 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-slate-800 text-slate-200 border-slate-700 max-w-[210px]">
                    <p className="text-xs">{s.desc}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </section>

        <div className="border-t border-[#2e4a2e]" />

        {/* Display Settings */}
        <section className="space-y-4">
          {/* Paper Speed */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Paper Speed</Label>
              <span className="text-xs font-mono text-emerald-400">{speed} mm/s</span>
            </div>
            <div className="flex gap-1">
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
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Sensitivity</Label>
              <span className="text-xs font-mono text-emerald-400">{sensitivity} µV/mm</span>
            </div>
            <div className="flex gap-1">
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
            <p className="text-[10px] text-slate-600">Standard 7 · Low gain 10 µV/mm</p>
          </div>
        </section>

      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#2e4a2e]">
        <Button
          variant="outline"
          className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white text-sm"
          onClick={clearAll}
        >
          Clear Artifacts &amp; Effects
        </Button>
      </div>
    </div>
  );
}
