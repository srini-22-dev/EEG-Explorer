import React, { useState, useRef, useEffect, RefObject } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, ChevronDown, Download, MonitorPlay, Brain } from 'lucide-react';
import { MONTAGES, Montage } from '../utils/montages';
import type { PatientState, IctalParams, IctalParamsMap, ArtifactParams, Speed, Sensitivity } from '../utils/simTypes';
import { ICTAL_TOGGLE_IDS, SPEED_VALUES, SENSITIVITY_VALUES } from '../utils/simTypes';
import { PATTERN_CATEGORIES } from '../utils/patterns';
import { ArtifactControls } from './ArtifactControls';
import { EEGTheme } from '../utils/themes';
import { exportCSV, exportScreenshot } from '../utils/exportUtils';

/** Sensitivity picker: a native dropdown that also steps through the allowed
 *  values on mouse-wheel while hovered. The wheel listener is attached natively
 *  with { passive: false } so it can preventDefault the page scroll — React's
 *  synthetic onWheel is passive and cannot. Scrolling down moves to the next
 *  (higher) value, matching the top-to-bottom order of the ascending list. */
function SensitivitySelect({
  value, onChange,
}: { value: Sensitivity; onChange: (v: Sensitivity) => void }) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const i = SENSITIVITY_VALUES.indexOf(value);
      const next = i + (e.deltaY > 0 ? 1 : -1);
      if (next >= 0 && next < SENSITIVITY_VALUES.length) onChange(SENSITIVITY_VALUES[next]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [value, onChange]);
  return (
    <select
      ref={ref}
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as Sensitivity)}
      className="w-full py-1 px-2 rounded text-[11px] font-mono border border-slate-700 bg-slate-900 text-emerald-300 hover:bg-slate-800 focus:outline-none focus:border-emerald-600 cursor-pointer">
      {SENSITIVITY_VALUES.map(v => (
        <option key={v} value={v}>{v} µV/mm</option>
      ))}
    </select>
  );
}

type Props = {
  montageId: string;
  setMontageId: (id: string) => void;
  activePatterns: Set<string>;
  togglePattern: (id: string) => void;
  ictalParams: IctalParamsMap;
  updateIctalParams: (toggleId: string, patch: Partial<IctalParams>) => void;
  artifactParams: ArtifactParams;
  updateArtifactParams: (patch: Partial<ArtifactParams>) => void;
  speed: number;
  setSpeed: (v: Speed) => void;
  sensitivity: number;
  setSensitivity: (v: Sensitivity) => void;
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
  graphHover: boolean;
  setGraphHover: (b: boolean) => void;
  showSpectrum: boolean;
  setShowSpectrum: (b: boolean) => void;
  showRightSpectrum: boolean;
  setShowRightSpectrum: (b: boolean) => void;
  setQuizMode: (b: boolean) => void;
  setTutorialMode: (b: boolean) => void;
  dataBuffer: React.MutableRefObject<number[][]>;
  timeBuffer: React.MutableRefObject<number[]>;
};

const FOCAL_ICTAL_IDS = new Set<string>(['focal-temporal-ictal', 'focal-frontal-ictal']);
const ICTAL_ID_SET = new Set<string>(ICTAL_TOGGLE_IDS);

// The two montages a learner reaches for first — the double-banana bipolar chain
// and the common-average reference. The transverse and ear-referenced montages
// are kept one click away behind "More" rather than crowding the default view.
const PRIMARY_MONTAGE_IDS = new Set<string>(['bipolar-ap', 'reference-car']);

// Three vigilance levels for the learner, not the five polysomnographic stages.
// The engine still models N1/N2/N3 separately — the sleep graphoelement toggles
// (POSTS, vertex waves, K-complexes, spindles) each jump to the specific stage
// they define — so "Sleep" here is the representative NREM stage (N2), and its
// button stays lit for whichever specific sleep stage a graphoelement selected.
// `matches` is the set of engine states the button represents.
const PATIENT_STATES: { value: PatientState; label: string; desc: string; matches?: PatientState[] }[] = [
  { value: 'awake',  label: 'Awake',   desc: 'Posterior-predominant alpha PDR (9-11 Hz); frontal low-amplitude beta; AP gradient preserved.' },
  { value: 'drowsy', label: 'Drowsy',  desc: 'Posterior theta (5-6 Hz) replaces alpha; diffuse slowing; >50% of page shows theta posteriorly.' },
  { value: 'n2',     label: 'Sleep',   desc: 'NREM sleep: theta/delta background with the sleep graphoelements — vertex waves, K-complexes and sleep spindles (12-15 Hz) over central leads, and POSTS posteriorly. Selecting one of those patterns tunes the exact stage.', matches: ['n1', 'n2', 'n3'] },
];

export function ControlPanel({
  montageId, setMontageId,
  activePatterns, togglePattern,
  ictalParams, updateIctalParams,
  artifactParams, updateArtifactParams,
  speed, setSpeed,
  sensitivity, setSensitivity,
  patientState, setPatientState,
  clearAll,
  show3DPanel = false, setShow3DPanel,
  headOpacity = 0.3, setHeadOpacity,
  brainOpacity = 0.8, setBrainOpacity,
  theme, setTheme,
  showAnnotations, setShowAnnotations,
  graphHover, setGraphHover,
  showSpectrum, setShowSpectrum,
  showRightSpectrum, setShowRightSpectrum,
  setQuizMode, setTutorialMode,
  dataBuffer, timeBuffer
}: Props) {
  const [showAllMontages, setShowAllMontages] = useState(false);

  // Track which pattern categories are expanded
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(['artifacts']));
  const toggleCat = (id: string) =>
    setOpenCats(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const activeCount = activePatterns.size;

  // Pattern search. Forty-odd patterns behind six collapsed headings means the
  // only way to find one by name is to open every category and read. The query
  // matches the pattern name, its description and its category, so searching a
  // clinical term ("temporal", "delta", "sleep") finds the patterns that teach
  // it and not just the ones with the word in their title.
  const [patternQuery, setPatternQuery] = useState('');
  const q = patternQuery.trim().toLowerCase();
  const visibleCats = q
    ? PATTERN_CATEGORIES
        .map(cat => ({
          ...cat,
          patterns: cat.patterns.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.desc.toLowerCase().includes(q) ||
            cat.name.toLowerCase().includes(q)),
        }))
        .filter(cat => cat.patterns.length > 0)
    : PATTERN_CATEGORIES;

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
            {PATIENT_STATES.map(ps => {
              const selected = ps.matches
                ? ps.matches.includes(patientState)
                : patientState === ps.value;
              return (
              <Tooltip key={ps.value}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setPatientState(ps.value)}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-medium transition-colors border flex items-center justify-between ${
                      selected
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
              );
            })}
          </div>
        </div>

        {/* ── Montage ── */}
        <div className="px-4 py-3 border-b border-[#2e4a2e]">
          <h2 className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Montage</h2>
          {(() => {
            const all = Object.values(MONTAGES);
            const primary = all.filter(m => PRIMARY_MONTAGE_IDS.has(m.id));
            const more = all.filter(m => !PRIMARY_MONTAGE_IDS.has(m.id));
            // Keep the extra montages open whenever one of them is the active
            // choice, so the selection is never hidden behind a collapsed "More".
            const moreOpen = showAllMontages || more.some(m => m.id === montageId);
            const shown = moreOpen ? [...primary, ...more] : primary;
            const row = (m: Montage) => (
              <div className="flex items-center space-x-1.5" key={m.id}>
                <RadioGroupItem value={m.id} id={`m-${m.id}`} className="border-slate-600 text-emerald-500 w-3 h-3" />
                <Label htmlFor={`m-${m.id}`} className="text-xs cursor-pointer text-slate-300 leading-snug">
                  {m.name}
                </Label>
              </div>
            );
            return (
              <>
                <RadioGroup value={montageId} onValueChange={setMontageId} className="flex flex-col gap-1">
                  {shown.map(row)}
                </RadioGroup>
                <button
                  onClick={() => setShowAllMontages(v => !v)}
                  className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${moreOpen ? 'rotate-180' : ''}`} />
                  {moreOpen ? 'Fewer montages' : `More montages (${more.length})`}
                </button>
              </>
            );
          })()}
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

          <div className="px-4 pb-2 relative">
            <input
              type="text"
              value={patternQuery}
              onChange={e => setPatternQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setPatternQuery(''); }}
              placeholder="Search patterns…"
              className="w-full bg-[#192219] border border-[#2e4a2e] rounded px-2 py-1 pr-6 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-700"
            />
            {q && (
              <button
                onClick={() => setPatternQuery('')}
                aria-label="Clear pattern search"
                className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs leading-none"
              >
                ✕
              </button>
            )}
          </div>

          {q && visibleCats.length === 0 && (
            <p className="px-4 pb-3 text-[11px] text-slate-600">No patterns match “{patternQuery.trim()}”.</p>
          )}

          {visibleCats.map((cat, ci) => {
            // While searching, every surviving category is expanded — a hit
            // hidden behind a collapsed heading is the problem the search exists
            // to solve.
            const isOpen     = q !== '' || openCats.has(cat.id);
            // Counted against the whole category, not the filtered view, so the
            // badge keeps meaning "this many are on" while a search is active.
            const catActive  = PATTERN_CATEGORIES.find(c => c.id === cat.id)!
              .patterns.filter(p => activePatterns.has(p.id)).length;
            // A super-group heading is drawn once, above the first category that
            // carries a given `group` — so the three abnormality families read
            // as one clinical block rather than three unrelated headings.
            const showGroupHeader = !!cat.group && visibleCats[ci - 1]?.group !== cat.group;
            return (
              <React.Fragment key={cat.id}>
                {showGroupHeader && (
                  <div className="px-4 pt-3 pb-0.5 flex items-center gap-2">
                    <span className="h-px flex-1 bg-[#2e4a2e]" />
                    <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                      {cat.group}
                    </span>
                    <span className="h-px flex-1 bg-[#2e4a2e]" />
                  </div>
                )}
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
                      const isIctal = ICTAL_ID_SET.has(p.id);
                      const params = ictalParams[p.id];
                      return (
                        <div key={p.id}>
                          <div className="flex items-center justify-between">
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
                          {isIctal && on && params && (
                            <div className="pt-2 pb-1 pl-1 space-y-2">
                              {FOCAL_ICTAL_IDS.has(p.id) && (
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Hemisphere</Label>
                                  <div className="flex gap-1">
                                    {(['left', 'right'] as const).map(h => (
                                      <button key={h} onClick={() => updateIctalParams(p.id, { hemisphere: h })}
                                        className={`flex-1 py-1 rounded text-[11px] font-mono border transition-colors capitalize ${
                                          params.hemisphere === h
                                            ? 'bg-fuchsia-800/40 border-fuchsia-600 text-fuchsia-300'
                                            : 'border-slate-700 text-slate-500 hover:bg-slate-800'
                                        }`}>
                                        {h}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div className="space-y-1">
                                <div className="flex justify-between items-center">
                                  <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Intensity</Label>
                                  <span className="text-[10px] font-mono text-fuchsia-400">{Math.round(params.intensity * 100)}%</span>
                                </div>
                                <input
                                  type="range" min="0" max="3" step="0.05"
                                  value={params.intensity}
                                  onChange={e => updateIctalParams(p.id, { intensity: parseFloat(e.target.value) })}
                                  className="w-full accent-fuchsia-500"
                                />
                              </div>
                              {/* Discharge rate. Shown as a multiple of the textbook rate rather
                                  than in Hz, because every one of these patterns sweeps across a
                                  range during the event — there is no single frequency to label. */}
                              <div className="space-y-1">
                                <div className="flex justify-between items-center">
                                  <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Frequency</Label>
                                  <span className="text-[10px] font-mono text-fuchsia-400">{params.frequency.toFixed(2)}&times;</span>
                                </div>
                                <input
                                  type="range" min="0.5" max="2" step="0.05"
                                  value={params.frequency}
                                  onChange={e => updateIctalParams(p.id, { frequency: parseFloat(e.target.value) })}
                                  className="w-full accent-fuchsia-500"
                                />
                              </div>
                            </div>
                          )}
                          {on && (
                            <ArtifactControls
                              id={p.id}
                              params={artifactParams}
                              update={updateArtifactParams}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </React.Fragment>
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
            <Label className="text-xs text-slate-300">Graph Hover Highlight</Label>
            <Switch checked={graphHover} onCheckedChange={setGraphHover} className="scale-90 data-[state=checked]:bg-emerald-600" />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-300">FFT Spectrum</Label>
            <Switch checked={showSpectrum} onCheckedChange={setShowSpectrum} className="scale-90 data-[state=checked]:bg-emerald-600" />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs text-slate-300">Per-channel Bands</Label>
            <Switch checked={showRightSpectrum} onCheckedChange={setShowRightSpectrum} className="scale-90 data-[state=checked]:bg-emerald-600" />
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
              {SPEED_VALUES.map(s => (
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
            <SensitivitySelect value={sensitivity as Sensitivity} onChange={setSensitivity} />
            <p className="text-[10px] text-slate-700">Standard 7 · Low gain 10 µV/mm · scroll to adjust</p>
          </div>

          {/*
            The display convention, stated on screen.

            Negative-up is the single assumption a reader needs before any
            deflection on this display means anything, and it is the one thing
            the app had never said anywhere — which is exactly how a downward
            blink gets read as wrong. It is not a setting: it is fixed for the
            whole app (EEGCanvas draws y = centreY + v) and every pattern's
            polarity is asserted against it, so this is a legend, not a control.
          */}
          <div className="space-y-1 pt-1">
            <Label className="text-[10px] text-slate-500 uppercase tracking-wider">Polarity</Label>
            <div className="flex items-center gap-2 rounded border border-slate-700 px-2 py-1.5">
              <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" className="shrink-0">
                <line x1="3" y1="13" x2="23" y2="13" stroke="#475569" strokeWidth="1" strokeDasharray="2 2" />
                <path d="M13 13 L13 4 M13 4 L10 7.5 M13 4 L16 7.5" fill="none" stroke="#4ade80" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M13 13 L13 22 M13 22 L10 18.5 M13 22 L16 18.5" fill="none" stroke="#64748b" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <div className="text-[10px] leading-tight">
                <div className="text-emerald-400 font-mono">up = negative (−)</div>
                <div className="text-slate-500 font-mono">down = positive (+)</div>
              </div>
            </div>
            <p className="text-[10px] text-slate-700 leading-tight">
              Clinical convention: a channel whose input 1 is more positive than input 2 deflects downward.
            </p>
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
