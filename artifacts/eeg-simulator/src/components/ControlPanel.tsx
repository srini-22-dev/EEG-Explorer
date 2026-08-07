import React, { useState, RefObject } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, ChevronDown, Download, MonitorPlay, Brain } from 'lucide-react';
import { MONTAGES, Montage } from '../utils/montages';
import { PatientState } from '../utils/eegGenerator';
import { PATTERN_CATEGORIES } from '../utils/patterns';
import { EEGTheme } from '../utils/themes';
import { exportCSV, exportScreenshot } from '../utils/exportUtils';

type Props = {
  montageId: string;
  setMontageId: (id: string) => void;
  activePatterns: Set<string>;
  togglePattern: (id: string) => void;
  speed: number;
  setSpeed: (v: 15 | 30 | 60) => void;
  sensitivity: number;
  setSensitivity: (v: 5 | 7 | 10 | 15) => void;
  patientState: PatientState;
  setPatientState: (s: PatientState) => void;
  clearAll: () => void;
  show3DPanel?: boolean;
  setShow3DPanel?: (v: boolean) => void;
  headOpacity?: number;
  setHeadOpacity?: (v: number) => void;
  brainOpacity?: number;
  setBrainOpacity?: (v: number) => void;
  theme: EEGTheme;
  setTheme: (t: EEGTheme) => void;
  showAnnotations: boolean;
  setShowAnnotations: (b: boolean) => void;
  showSpectrum: boolean;
  setShowSpectrum: (b: boolean) => void;
  setQuizMode: (b: boolean) => void;
  setTutorialMode: (b: boolean) => void;
  dataBuffer: React.MutableRefObject<number[][]>;
  timeBuffer: React.MutableRefObject<number[]>;
};

const PATIENT_STATES: { value: PatientState; label: string; desc: string }[] = [
  { value: 'awake',  label: 'Awake',         desc: 'Posterior-predominant alpha PDR (9-11 Hz); frontal low-amplitude beta; AP gradient preserved.' },
  { value: 'drowsy', label: 'Drowsy',         desc: 'Posterior theta (5-6 Hz) replaces alpha; diffuse slowing; >50% of page shows theta posteriorly.' },
  { value: 'n1',     label: 'N1 Sleep',       desc: 'Stage 1 NREM: theta background; vertex sharp waves; POSTS; no K-complexes or spindles yet.' },
  { value: 'n2',     label: 'N2 Sleep',       desc: 'Stage 2 NREM: K-complexes and sleep spindles (12-15 Hz) over central leads; theta/delta background.' },
  { value: 'n3',     label: 'N3 / SWS',       desc: 'Slow wave sleep: high-amplitude delta (>75 µV, 0.5-2 Hz) dominates >20% of epoch.' },
];

export function ControlPanel({
  montageId, setMontageId,
  activePatterns, togglePattern,
  speed, setSpeed,
  sensitivity, setSensitivity,
  patientState, setPatientState,
  clearAll,
  show3DPanel = false, setShow3DPanel,
  headOpacity = 0.3, setHeadOpacity,
  brainOpacity = 0.8, setBrainOpacity,
  theme, setTheme,
  showAnnotations, setShowAnnotations,
  showSpectrum, setShowSpectrum,
  setQuizMode, setTutorialMode,
  dataBuffer, timeBuffer
}: Props) {
  // Track which pattern categories are expanded
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(['artifacts']));
  const toggleCat = (id: string) =>
    setOpenCats(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const activeCount = activePatterns.size;

  return (
    <div className="w-72 h-full flex flex-col bg-[#1e2a1e] border-r border-[#2e4a2e] text-slate-200 overflow-y-auto flex-shrink-0 text-sm">

      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 border-b border-[#2e4a2e]">
        <h1 className="text-base font-bold text-emerald-400 tracking-tight">EEG Simulator</h1>
        <p className="text-[11px] text-slate-500 mt-0.5">Clinical Teaching Workstation</p>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Patient State ── */}
        <div className="px-4 pt-4 pb-3 border-b border-[#2e4a2e]">
          <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
            Background State
          </h2>
          <div className="flex flex-col gap-1">
            {PATIENT_STATES.map(ps => (
              <Tooltip key={ps.value}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setPatientState(ps.value)}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-medium transition-colors border flex items-center justify-between ${
                      patientState === ps.value
                        ? 'bg-emerald-800/50 border-emerald-600 text-emerald-200'
                        : 'border-[#2e4a2e] text-slate-400 hover:bg-[#243424] hover:text-slate-200'
                    }`}
                  >
                    {ps.label}
                    <Info className="w-3 h-3 opacity-30 flex-shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="bg-slate-800 text-slate-200 border-slate-700 max-w-[230px]">
                  <p className="text-xs">{ps.desc}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* ── Montage ── */}
        <div className="px-4 py-3 border-b border-[#2e4a2e]">
          <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Montage</h2>
          <RadioGroup value={montageId} onValueChange={setMontageId} className="flex flex-col gap-1">
            {Object.values(MONTAGES).map(m => (
              <div className="flex items-center space-x-1.5" key={m.id}>
                <RadioGroupItem value={m.id} id={`m-${m.id}`} className="border-slate-600 text-emerald-500 w-3 h-3" />
                <Label htmlFor={`m-${m.id}`} className="text-xs cursor-pointer text-slate-300 leading-snug">
                  {m.name}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* ── Pattern Library ── */}
        <div className="border-b border-[#2e4a2e]">
          <div className="px-4 pt-3 pb-1 flex items-center justify-between">
            <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              Pattern Library
            </h2>
            {activeCount > 0 && (
              <span className="text-[10px] bg-emerald-800/60 text-emerald-300 px-1.5 py-0.5 rounded-full">
                {activeCount} on
              </span>
            )}
          </div>

          {PATTERN_CATEGORIES.map(cat => {
            const isOpen     = openCats.has(cat.id);
            const catActive  = cat.patterns.filter(p => activePatterns.has(p.id)).length;
            return (
              <div key={cat.id}>
                {/* Category header */}
                <button
                  onClick={() => toggleCat(cat.id)}
                  className="w-full px-4 py-2 flex items-center justify-between hover:bg-[#243424] transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-xs font-medium text-slate-300">{cat.name}</span>
                    {catActive > 0 && (
                      <span className="text-[10px] text-slate-400">({catActive})</span>
                    )}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* Patterns */}
                {isOpen && (
                  <div className="px-4 pb-2 space-y-1.5 bg-[#192219]">
                    {cat.patterns.map(p => {
                      const on = activePatterns.has(p.id);
                      return (
                        <div key={p.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <Switch
                              id={`pat-${p.id}`}
                              checked={on}
                              onCheckedChange={() => togglePattern(p.id)}
                              className="data-[state=checked]:bg-emerald-600 flex-shrink-0 scale-90"
                            />
                            <Label
                              htmlFor={`pat-${p.id}`}
                              className={`text-xs cursor-pointer leading-snug truncate ${on ? 'text-slate-200' : 'text-slate-500'}`}
                            >
                              {p.name}
                            </Label>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3 h-3 text-slate-700 hover:text-slate-400 cursor-help flex-shrink-0 ml-1" />
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              className="bg-slate-800 text-slate-200 border-slate-700 max-w-[240px]"
                            >
                              <p className="text-xs leading-snug">{p.desc}</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── 3D Head Model ── */}
        <div className="border-b border-[#2e4a2e]">
          <div className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                3D Head
              </h2>
              {setShow3DPanel && (
                <Switch
                  checked={show3DPanel}
                  onCheckedChange={setShow3DPanel}
                  className="data-[state=checked]:bg-emerald-600 scale-90"
                />
              )}
            </div>
            
            {show3DPanel && setHeadOpacity && setBrainOpacity && (
              <div className="space-y-3 mt-2 bg-[#192219] p-2 rounded">
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <Label className="text-[10px] text-slate-400">Skin Opacity</Label>
                    <span className="text-[10px] text-slate-500">{Math.round(headOpacity * 100)}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.05" 
                    value={headOpacity} 
                    onChange={e => setHeadOpacity(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <Label className="text-[10px] text-slate-400">Brain Opacity</Label>
                    <span className="text-[10px] text-slate-500">{Math.round(brainOpacity * 100)}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.05" 
                    value={brainOpacity} 
                    onChange={e => setBrainOpacity(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Tools & Export ── */}
        <div className="px-4 py-3 space-y-3 border-b border-[#2e4a2e]">
          <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Tools & Export</h2>
          
          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-300">Theme</Label>
            <select 
              value={theme} 
              onChange={(e) => setTheme(e.target.value as EEGTheme)}
              className="bg-slate-800 text-xs border border-slate-700 rounded p-1 text-slate-200"
            >
              <option value="green-paper">Green Paper</option>
              <option value="white-paper">White Paper</option>
              <option value="dark-mode">Dark Mode</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-300">Show Annotations</Label>
            <Switch checked={showAnnotations} onCheckedChange={setShowAnnotations} className="scale-90 data-[state=checked]:bg-emerald-600" />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-300">FFT Spectrum</Label>
            <Switch checked={showSpectrum} onCheckedChange={setShowSpectrum} className="scale-90 data-[state=checked]:bg-emerald-600" />
          </div>
          
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Button variant="outline" size="sm" className="h-8 text-[10px] border-slate-700 hover:bg-slate-800" onClick={() => exportCSV(dataBuffer.current, timeBuffer.current, MONTAGES[montageId])}>
              <Download className="w-3 h-3 mr-1" /> CSV
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[10px] border-slate-700 hover:bg-slate-800" onClick={() => {
              const canvas = document.querySelector('canvas');
              exportScreenshot(canvas);
            }}>
              <Download className="w-3 h-3 mr-1" /> Image
            </Button>
          </div>
          
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Button variant="outline" size="sm" className="h-8 text-[10px] border-slate-700 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/40" onClick={() => setTutorialMode(true)}>
              <MonitorPlay className="w-3 h-3 mr-1" /> Tutorial
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[10px] border-slate-700 bg-purple-900/30 text-purple-300 hover:bg-purple-800/40" onClick={() => setQuizMode(true)}>
              <Brain className="w-3 h-3 mr-1" /> Quiz
            </Button>
          </div>
        </div>

        {/* ── Display Settings ── */}
        <div className="px-4 py-3 space-y-3">
          <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Display</h2>

          {/* Paper speed */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Paper Speed</Label>
              <span className="text-[10px] font-mono text-emerald-400">{speed} mm/s</span>
            </div>
            <div className="flex gap-1">
              {([15, 30, 60] as const).map(s => (
                <button key={s} onClick={() => setSpeed(s)}
                  className={`flex-1 py-1 rounded text-[11px] font-mono border transition-colors ${
                    speed === s
                      ? 'bg-emerald-700/40 border-emerald-600 text-emerald-300'
                      : 'border-slate-700 text-slate-500 hover:bg-slate-800'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Sensitivity */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Sensitivity</Label>
              <span className="text-[10px] font-mono text-emerald-400">{sensitivity} µV/mm</span>
            </div>
            <div className="flex gap-1">
              {([5, 7, 10, 15] as const).map(v => (
                <button key={v} onClick={() => setSensitivity(v)}
                  className={`flex-1 py-1 rounded text-[11px] font-mono border transition-colors ${
                    sensitivity === v
                      ? 'bg-emerald-700/40 border-emerald-600 text-emerald-300'
                      : 'border-slate-700 text-slate-500 hover:bg-slate-800'
                  }`}>
                  {v}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-700">Standard 7 · Low gain 10 µV/mm</p>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="px-4 py-3 border-t border-[#2e4a2e]">
        <Button
          variant="outline"
          className="w-full border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white text-xs py-1.5 h-auto"
          onClick={clearAll}
        >
          Clear All Patterns
        </Button>
      </div>

    </div>
  );
}
