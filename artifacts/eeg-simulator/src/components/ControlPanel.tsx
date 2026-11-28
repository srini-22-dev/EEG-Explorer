import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Group, Row, IconTile, Caption, Segmented, Chip, Range, InfoButton } from '@/components/ui/ios';
import { ChevronRight, Download, MonitorPlay, Brain, GraduationCap, Search, XCircle } from 'lucide-react';
import { MONTAGES } from '../utils/montages';
import type { PatientState, IctalParams, IctalParamsMap, ArtifactParams, PatternOptions } from '../utils/simTypes';
import { POSTS_SMALLER_DEFAULT, POSTS_ONE_SIDE_DEFAULT } from '../utils/simTypes';
import { ICTAL_TOGGLE_IDS } from '../utils/simTypes';
import { PATTERN_CATEGORIES } from '../utils/patterns';
import { ArtifactControls, Slider } from './ArtifactControls';
import { isLiveOn } from '../utils/liveArtifacts';
import type { LiveArtifacts } from '../engine/engine';
import { EEGTheme } from '../utils/themes';
import { APPEARANCES, type Appearance } from '../utils/uiTheme';
import { exportCSV, exportScreenshot } from '../utils/exportUtils';
import { cn } from '@/lib/utils';

type Props = {
  /** A sidebar beside the trace (desktop), or the content of the phone's Patterns sheet. */
  variant: 'sidebar' | 'sheet';
  /** For the CSV export; the montage itself is chosen in the top bar. */
  montageId: string;
  activePatterns: Set<string>;
  togglePattern: (id: string) => void;
  ictalParams: IctalParamsMap;
  updateIctalParams: (toggleId: string, patch: Partial<IctalParams>) => void;
  artifactParams: ArtifactParams;
  updateArtifactParams: (patch: Partial<ArtifactParams>) => void;
  patternOptions: PatternOptions;
  updatePatternOptions: (patch: Partial<PatternOptions>) => void;
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
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  showAnnotations: boolean;
  showArtifactList: boolean; setShowArtifactList: (v: boolean) => void;
  /** What the artifacts are doing now (a recording level moves the controls with it), or null. */
  live: LiveArtifacts | null;
  setShowAnnotations: (b: boolean) => void;
  graphHover: boolean;
  setGraphHover: (b: boolean) => void;
  showSpectrum: boolean;
  setShowSpectrum: (b: boolean) => void;
  showRightSpectrum: boolean;
  setShowRightSpectrum: (b: boolean) => void;
  setQuizMode: (b: boolean) => void;
  setTutorialMode: (b: boolean) => void;
  setLessonsMode: (b: boolean) => void;
  dataBuffer: React.MutableRefObject<number[][]>;
  timeBuffer: React.MutableRefObject<number[]>;
  /** The toggle whose information panel is open, and how to open (or close) one. */
  infoId: string | null;
  onShowInfo: (id: string | null) => void;
};

const FOCAL_ICTAL_IDS = new Set<string>(['focal-temporal-ictal', 'focal-frontal-ictal']);
const ICTAL_ID_SET = new Set<string>(ICTAL_TOGGLE_IDS);

// Three vigilance levels for the learner, not the five polysomnographic stages.
// The engine still models N1/N2/N3 separately — the sleep graphoelement toggles
// (POSTS, vertex waves, K-complexes, spindles) each jump to the specific stage
// they define — so "Sleep" here is the representative NREM stage (N2), and its
// button stays lit for whichever specific sleep stage a graphoelement selected.
// `matches` is the set of engine states the button represents.
const PATIENT_STATES: { value: PatientState; label: string; desc: string; matches?: PatientState[] }[] = [
  { value: 'awake',  label: 'Awake',   desc: 'Posterior-predominant alpha PDR (9-11 Hz); frontal low-amplitude beta; AP gradient preserved.' },
  { value: 'drowsy', label: 'Drowsy',  desc: 'Drowsiness: diffuse attenuation and perhaps mild slowing of the background; the PDR is still there but comes and goes; fewer blinks; slow roving lateral eye movements at F7/F8. When theta replaces the PDR for most of the page, that is N1.' },
  { value: 'n2',     label: 'Sleep',   desc: 'NREM sleep, shown as N2: a low-amplitude theta background with sleep spindles and K-complexes, plus the vertex waves and POSTS that began in N1. The Sleep Architecture toggles move between the stages — POSTS or vertex waves to N1, spindles or K-complexes to N2, Slow-Wave Sleep to N3.', matches: ['n1', 'n2', 'n3'] },
  { value: 'rem',    label: 'REM',     desc: 'Paradoxical sleep: diffusely attenuated, low-voltage mixed-frequency background that resembles N1 — the background alone does not identify it. What does: rapid eye movements (sharply contoured, opposing at the lateral frontal leads, faster upslope than downslope) and near-absent muscle tone.' },
];

// Sidebar order of the pattern groups, in the order a learner meets them: the
// normal record first, then what is abnormal, then the procedures that provoke
// it, then the artifacts that imitate it. Categories keep their registry order
// within a group (Array.sort is stable); the registry order itself is untouched.
const GROUP_ORDER = ['Normal Background & Variants', 'Abnormal / Epileptiform', 'Activation Procedures', 'Artifacts'];
const ORDERED_CATEGORIES = [...PATTERN_CATEGORIES].sort(
  (a, b) => GROUP_ORDER.indexOf(a.group ?? '') - GROUP_ORDER.indexOf(b.group ?? ''));

const PAPERS: { value: EEGTheme; label: string }[] = [
  { value: 'green-paper', label: 'Green' },
  { value: 'white-paper', label: 'White' },
  { value: 'dark-mode', label: 'Dark' },
];

/** The options a switched-on pattern reveals under its row. */
const optionBox = 'pl-[34px] pointer-coarse:pl-[38px] pr-3 pb-3 pt-0.5 space-y-3';

export function ControlPanel({
  variant,
  montageId,
  activePatterns, togglePattern,
  ictalParams, updateIctalParams,
  artifactParams, updateArtifactParams,
  patternOptions, updatePatternOptions,
  patientState, setPatientState,
  clearAll,
  show3DPanel = false, setShow3DPanel,
  headOpacity = 0.3, setHeadOpacity,
  brainOpacity = 0.8, setBrainOpacity,
  theme, setTheme, appearance, setAppearance,
  showAnnotations, setShowAnnotations, showArtifactList, setShowArtifactList, live,
  graphHover, setGraphHover,
  showSpectrum, setShowSpectrum,
  showRightSpectrum, setShowRightSpectrum,
  setQuizMode, setTutorialMode, setLessonsMode,
  dataBuffer, timeBuffer,
  infoId, onShowInfo,
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

  // Pattern search. Forty-odd patterns behind six collapsed headings means the
  // only way to find one by name is to open every category and read. The query
  // matches the pattern name, its description and its category, so searching a
  // clinical term ("temporal", "delta", "sleep") finds the patterns that teach
  // it and not just the ones with the word in their title.
  const [patternQuery, setPatternQuery] = useState('');
  const q = patternQuery.trim().toLowerCase();
  const visibleCats = q
    ? ORDERED_CATEGORIES
        .map(cat => ({
          ...cat,
          patterns: cat.patterns.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.desc.toLowerCase().includes(q) ||
            cat.name.toLowerCase().includes(q)),
        }))
        .filter(cat => cat.patterns.length > 0)
    : ORDERED_CATEGORIES;
  // The library's groups in order, each with its categories (a group is one card).
  const groups = GROUP_ORDER
    .map(g => ({ name: g, cats: visibleCats.filter(c => c.group === g) }))
    .filter(g => g.cats.length > 0);

  const stateNow = PATIENT_STATES.find(ps => ps.matches ? ps.matches.includes(patientState) : patientState === ps.value);

  const sidebar = variant === 'sidebar';

  return (
    // One scroll container: the middle section. Header (with the polarity key)
    // and footer stay pinned.
    <div className={cn(
      'h-full flex flex-col bg-ui-root text-ui-text overflow-hidden',
      sidebar && 'w-[300px] flex-shrink-0 border-r border-ui-sep',
    )}>

      {/* ── Header ── */}
      <div className={cn('px-4 pb-2 border-b border-ui-sep', sidebar ? 'pt-4' : 'pt-1')}>
        {sidebar && (
          <div className="px-1 pb-3">
            <h1 className="text-[22px] font-bold tracking-tight text-ui-text leading-none">EEG Simulator</h1>
            <p className="text-[12px] text-ui-text-2 mt-1">Clinical teaching workstation</p>
          </div>
        )}

        {/*
          The display convention, stated on screen — pinned in the header so it
          is in view whatever else is scrolled.

          Negative-up is the single assumption a reader needs before any
          deflection on this display means anything, and it is the one thing
          the app had never said anywhere — which is exactly how a downward
          blink gets read as wrong. It is not a setting: it is fixed for the
          whole app (EEGCanvas draws y = centreY + v) and every pattern's
          polarity is asserted against it, so this is a legend, not a control.
        */}
        <div className="flex items-center gap-3 rounded-[10px] bg-ui-card px-3 py-2"
          title="Clinical convention: a channel whose input 1 is more positive than input 2 deflects downward.">
          <svg width="28" height="28" viewBox="0 0 26 26" aria-hidden="true" className="shrink-0">
            <line x1="3" y1="13" x2="23" y2="13" stroke="var(--ui-text-3)" strokeWidth="1" strokeDasharray="2 2" />
            <path d="M13 13 L13 4 M13 4 L10 7.5 M13 4 L16 7.5" fill="none" stroke="var(--ui-accent)" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M13 13 L13 22 M13 22 L10 18.5 M13 22 L16 18.5" fill="none" stroke="var(--ui-text-2)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <div className="min-w-0 leading-tight">
            <div className="text-[13px] pointer-coarse:text-[15px] font-semibold"><span className="text-ui-accent">Up</span> is negative (−)</div>
            <div className="text-[13px] pointer-coarse:text-[15px] text-ui-text-2">Down is positive (+)</div>
          </div>
        </div>
        <p className="px-3 pt-1.5 text-[11px] pointer-coarse:text-[12px] text-ui-text-2 leading-snug">
          Clinical convention: a channel whose input 1 is more positive than input 2 deflects downward.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto ui-scroll pb-4">

        {/* ── Learn ── */}
        <Group title="Learn">
          <Row icon={<IconTile color="var(--ui-green)"><MonitorPlay /></IconTile>} label="Tutorial" onClick={() => setTutorialMode(true)}>
            <ChevronRight className="w-4 h-4 text-ui-text-3" />
          </Row>
          <Row icon={<IconTile color="var(--ui-purple)"><Brain /></IconTile>} label="Quiz" onClick={() => setQuizMode(true)}>
            <ChevronRight className="w-4 h-4 text-ui-text-3" />
          </Row>
          <Row icon={<IconTile color="var(--ui-blue)"><GraduationCap /></IconTile>} label="Lessons: how to read EEG" onClick={() => setLessonsMode(true)}>
            <ChevronRight className="w-4 h-4 text-ui-text-3" />
          </Row>
        </Group>

        {/* ── Patient State ── */}
        <Group title="Background state" footer={stateNow?.desc} plain>
          <Segmented
            ariaLabel="Background state"
            value={stateNow?.value ?? 'awake'}
            options={PATIENT_STATES.map(ps => ({ value: ps.value, label: ps.label }))}
            onChange={v => setPatientState(v)}
          />
          {/* The patient's heart rate, here as well as under ECG Artifact (owner's inbox,
              2026-11-27: "too important to only be there"). One setting, so the two
              sliders move together; it sets the ECG row and the pulse artifact too. */}
          <div className="mt-3">
            <Slider
              label="Heart rate" value={artifactParams.ecgBpm} min={40} max={140} step={1} unit=" bpm"
              live={live?.level ? live.heartRate : undefined}
              onChange={v => updateArtifactParams({ ecgBpm: v })}
            />
          </div>
        </Group>

        {/* ── Pattern Library ── */}
        <div className="px-4 pt-5">
          <div className="flex items-center justify-between px-3 pb-1.5">
            <h2 className="text-[12px] pointer-coarse:text-[13px] font-semibold text-ui-text-2">Pattern library</h2>
            {activeCount > 0 && (
              <span className="text-[11px] pointer-coarse:text-[12px] font-semibold text-ui-accent bg-ui-accent/12 px-2 py-0.5 rounded-full tabular-nums">
                {activeCount} on
              </span>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ui-text-2 pointer-events-none" />
            <input
              type="search"
              value={patternQuery}
              onChange={e => setPatternQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setPatternQuery(''); }}
              placeholder="Search patterns"
              aria-label="Search patterns"
              className="w-full rounded-[10px] bg-ui-fill pl-8 pr-8 h-8 pointer-coarse:h-10 text-[13px] pointer-coarse:text-[16px] text-ui-text placeholder:text-ui-text-2 focus:outline-none focus:ring-2 focus:ring-ui-accent/40 [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button
                onClick={() => setPatternQuery('')}
                aria-label="Clear pattern search"
                className="absolute right-1 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 pointer-coarse:w-9 pointer-coarse:h-9 text-ui-text-3 hover:text-ui-text-2"
              >
                <XCircle className="w-4 h-4 fill-current stroke-ui-root" />
              </button>
            )}
          </div>
          {q && visibleCats.length === 0 && (
            <p className="px-3 pt-3 text-[12px] text-ui-text-2">No patterns match “{patternQuery.trim()}”.</p>
          )}
        </div>

        {groups.map(g => (
          <Group key={g.name} title={g.name} className="pt-4">
            {g.cats.map(cat => {
              // While searching, every surviving category is expanded — a hit
              // hidden behind a collapsed heading is the problem the search exists
              // to solve.
              const isOpen = q !== '' || openCats.has(cat.id);
              // Counted against the whole category, not the filtered view, so the
              // badge keeps meaning "this many are on" while a search is active.
              const catActive = PATTERN_CATEGORIES.find(c => c.id === cat.id)!
                .patterns.filter(p => activePatterns.has(p.id)).length;
              return (
                <React.Fragment key={cat.id}>
                  {/* Category header */}
                  <Row
                    onClick={() => toggleCat(cat.id)}
                    icon={<span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />}
                    label={<span className="font-medium">{cat.name}</span>}
                  >
                    {catActive > 0 && (
                      <span className="text-[12px] pointer-coarse:text-[14px] text-ui-text-2 tabular-nums">{catActive} on</span>
                    )}
                    <ChevronRight
                      aria-hidden="true"
                      className={`w-4 h-4 text-ui-text-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                    />
                  </Row>

                  {/* Patterns */}
                  {isOpen && cat.patterns.map(p => {
                    const on = activePatterns.has(p.id);
                    const isIctal = ICTAL_ID_SET.has(p.id);
                    const params = ictalParams[p.id];
                    const resting = on && !isLiveOn(p.id, live);
                    return (
                      <div key={p.id} className="group/row bg-ui-card-2/60">
                        <div className="flex items-center gap-1 pl-[34px] pointer-coarse:pl-[38px] pr-3 min-h-9 pointer-coarse:min-h-11 py-1 border-t border-ui-sep">
                          <label
                            htmlFor={`pat-${p.id}`}
                            className={`flex-1 min-w-0 text-[13px] pointer-coarse:text-[16px] leading-snug cursor-pointer ${on ? 'text-ui-text' : 'text-ui-text-2'}`}
                          >
                            {p.name}
                          </label>
                          <InfoButton about={p.name} active={infoId === p.id} onClick={() => onShowInfo(infoId === p.id ? null : p.id)} />
                          <Switch
                            id={`pat-${p.id}`}
                            checked={on && isLiveOn(p.id, live)}
                            onCheckedChange={() => togglePattern(p.id)}
                            title={resting ? 'On, resting now: the recording level brings it back' : undefined}
                            className={resting ? 'ring-2 ring-ui-switch/70' : ''}
                          />
                        </div>
                        {(p.id.startsWith('focal-spikes-') || FOCAL_ICTAL_IDS.has(p.id)) && on && (
                          <div className={optionBox}>
                            <div className="space-y-1">
                              <Caption>Focus</Caption>
                              <Segmented ariaLabel="Focus" value={patternOptions.focalPlacement ?? 'under'}
                                options={[{ value: 'under', label: 'Under electrode' }, { value: 'between', label: 'Between two' }] as const}
                                onChange={f => updatePatternOptions({ focalPlacement: f })} />
                            </div>
                          </div>
                        )}
                        {p.id === 'k-complex' && on && (
                          <div className={optionBox}>
                            <div className="space-y-1">
                              <Caption>Spindle after</Caption>
                              <Segmented ariaLabel="Spindle after" value={patternOptions.kcSpindle ?? 'sometimes'}
                                options={[{ value: 'none', label: 'None' }, { value: 'sometimes', label: 'Sometimes' }, { value: 'always', label: 'Always' }] as const}
                                onChange={k => updatePatternOptions({ kcSpindle: k })} />
                            </div>
                          </div>
                        )}
                        {p.id === '6hz-sw' && on && (
                          <div className={optionBox}>
                            <div className="space-y-1">
                              <Caption>Form</Caption>
                              <Segmented ariaLabel="Form" value={patternOptions.sixHzForm ?? 'fold'}
                                options={[{ value: 'fold', label: 'FOLD' }, { value: 'wham', label: 'WHAM' }] as const}
                                onChange={f => updatePatternOptions({ sixHzForm: f })} />
                            </div>
                          </div>
                        )}
                        {p.id === '14-6-pos' && on && (
                          <div className={optionBox}>
                            <div className="space-y-1">
                              <Caption>Sides</Caption>
                              <Segmented ariaLabel="Sides" value={patternOptions.pos146Sides ?? 'shifting'}
                                options={[{ value: 'shifting', label: 'Shifting · 0.5-1 s' }, { value: 'bilateral', label: 'Bilateral · 1-2 s' }] as const}
                                onChange={f => updatePatternOptions({ pos146Sides: f })} />
                            </div>
                          </div>
                        )}
                        {p.id === 'breach' && on && (
                          <div className={optionBox}>
                            <div className="space-y-1">
                              <Caption>Defects over (one or more)</Caption>
                              <div className="flex gap-1.5 pt-1">
                                {(['C4', 'C3', 'F8', 'F7'] as const).map(e => {
                                  const sites = patternOptions.breachSites ?? [patternOptions.breachSite ?? 'C4'];
                                  const siteOn = sites.includes(e);
                                  return (
                                    <Chip key={e} on={siteOn}
                                      // Several can be chosen; the last one stays, since a breach rhythm needs a defect.
                                      onClick={() => {
                                        const next = siteOn ? sites.filter(x => x !== e) : [...sites, e];
                                        if (next.length) updatePatternOptions({ breachSites: next });
                                      }}>
                                      {e}
                                    </Chip>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                        {p.id === 'gtc-ictal' && on && (
                          <div className={optionBox}>
                            <div className="space-y-1">
                              <Caption>Muscle artifact</Caption>
                              <Segmented ariaLabel="Muscle artifact" value={patternOptions.seizureMuscle ?? false}
                                options={[{ value: true, label: 'On' }, { value: false, label: 'Off' }] as const}
                                onChange={m => updatePatternOptions({ seizureMuscle: m })} />
                            </div>
                          </div>
                        )}
                        {p.id === 'posts' && on && (
                          <div className={optionBox}>
                            <div className="space-y-1">
                              <Caption>Form</Caption>
                              <Segmented ariaLabel="Form" value={patternOptions.postsForm ?? 'singles'}
                                options={[{ value: 'singles', label: 'Singles' }, { value: 'trains', label: 'Trains' }] as const}
                                onChange={f => updatePatternOptions({ postsForm: f })} />
                            </div>
                            {/* Sides (owner, 2026-11-16): random per POSTS, a teaching
                                idealisation (sleep.ts). Smaller: how far a bilateral one's
                                smaller side is down on the page; One side only: the share
                                drawn on one side alone. */}
                            {([
                              ['postsSmallerPct', 'Smaller side', 80, 5, POSTS_SMALLER_DEFAULT],
                              ['postsOneSidePct', 'One side only', 50, 1, POSTS_ONE_SIDE_DEFAULT],
                            ] as const).map(([key, label, max, step, def]) => (
                              <div key={key}>
                                <Caption trailing={<span className="text-[12px] pointer-coarse:text-[14px] font-medium tabular-nums">{patternOptions[key] ?? def}%</span>}>{label}</Caption>
                                <Range ariaLabel={label} min={0} max={max} step={step}
                                  value={patternOptions[key] ?? def}
                                  onChange={v => updatePatternOptions({ [key]: v })} />
                              </div>
                            ))}
                            <Button variant="outline" size="sm" className="w-full"
                              onClick={() => updatePatternOptions({ postsSmallerPct: POSTS_SMALLER_DEFAULT, postsOneSidePct: POSTS_ONE_SIDE_DEFAULT })}>
                              Reset to default
                            </Button>
                          </div>
                        )}
                        {isIctal && on && params && (
                          <div className={optionBox}>
                            {FOCAL_ICTAL_IDS.has(p.id) && (
                              <div className="space-y-1">
                                <Caption>Hemisphere</Caption>
                                <Segmented ariaLabel="Hemisphere" value={params.hemisphere}
                                  options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] as const}
                                  onChange={h => updateIctalParams(p.id, { hemisphere: h })} />
                              </div>
                            )}
                            <div>
                              <Caption trailing={<span className="text-[12px] pointer-coarse:text-[14px] font-medium tabular-nums">{Math.round(params.intensity * 100)}%</span>}>Intensity</Caption>
                              <Range ariaLabel="Intensity" min={0} max={3} step={0.05} value={params.intensity} color="var(--ui-purple)"
                                onChange={v => updateIctalParams(p.id, { intensity: v })} />
                            </div>
                            {/* Discharge rate. Shown as a multiple of the textbook rate rather
                                than in Hz, because every one of these patterns sweeps across a
                                range during the event — there is no single frequency to label. */}
                            <div>
                              <Caption trailing={<span className="text-[12px] pointer-coarse:text-[14px] font-medium tabular-nums">{params.frequency.toFixed(2)}&times;</span>}>Frequency</Caption>
                              <Range ariaLabel="Frequency" min={0.5} max={2} step={0.05} value={params.frequency} color="var(--ui-purple)"
                                onChange={v => updateIctalParams(p.id, { frequency: v })} />
                            </div>
                          </div>
                        )}
                        {on && (
                          <div className="pl-[34px] pointer-coarse:pl-[38px] pr-3 empty:hidden">
                            <ArtifactControls
                              id={p.id}
                              params={artifactParams}
                              update={updateArtifactParams}
                              live={live}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </Group>
        ))}

        {/* ── Display ── */}
        <Group title="Display">
          {setShow3DPanel && (
            <Row label="3D head" htmlFor="opt-3d">
              <Switch id="opt-3d" checked={show3DPanel} onCheckedChange={setShow3DPanel} />
            </Row>
          )}
          {show3DPanel && setHeadOpacity && setBrainOpacity && (
            <div className="group/row pl-3 pr-3 pb-3 space-y-2">
              <div>
                <Caption trailing={<span className="text-[12px] tabular-nums">{Math.round(headOpacity * 100)}%</span>}>Skin opacity</Caption>
                <Range ariaLabel="Skin opacity" min={0} max={1} step={0.05} value={headOpacity} onChange={setHeadOpacity} />
              </div>
              <div>
                <Caption trailing={<span className="text-[12px] tabular-nums">{Math.round(brainOpacity * 100)}%</span>}>Brain opacity</Caption>
                <Range ariaLabel="Brain opacity" min={0} max={1} step={0.05} value={brainOpacity} onChange={setBrainOpacity} />
              </div>
            </div>
          )}
          <Row label="FFT spectrum" htmlFor="opt-fft">
            <Switch id="opt-fft" checked={showSpectrum} onCheckedChange={setShowSpectrum} />
          </Row>
          <Row label="Per-channel bands" htmlFor="opt-bands">
            <Switch id="opt-bands" checked={showRightSpectrum} onCheckedChange={setShowRightSpectrum} />
          </Row>
          <Row label="Highlight the row under the pointer" htmlFor="opt-hover">
            <Switch id="opt-hover" checked={graphHover} onCheckedChange={setGraphHover} />
          </Row>
        </Group>

        <Group title="Appearance" plain
          footer="Paper is what the trace is drawn on. Interface is the look of the controls; Auto follows the device's light or dark setting.">
          <div className="space-y-3">
            <div className="space-y-1">
              <Caption>Paper</Caption>
              <Segmented ariaLabel="Paper" value={theme} options={PAPERS} onChange={setTheme} />
            </div>
            <div className="space-y-1">
              <Caption>Interface</Caption>
              <Segmented ariaLabel="Interface" value={appearance}
                options={APPEARANCES.map(a => ({ value: a.id, label: a.label }))} onChange={setAppearance} />
            </div>
          </div>
        </Group>

        {/* ── Export ── */}
        <Group title="Export" plain>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="tinted" size="sm" onClick={() => exportCSV(dataBuffer.current, timeBuffer.current, MONTAGES[montageId])}>
              <Download /> CSV
            </Button>
            <Button variant="tinted" size="sm" onClick={() => {
              const canvas = document.querySelector('canvas');
              exportScreenshot(canvas);
            }}>
              <Download /> Image
            </Button>
          </div>
        </Group>
      </div>

      {/* ── Footer ── */}
      <div className={cn('ui-material px-4 pt-2 pb-3 border-t border-ui-sep space-y-0.5', !sidebar && 'pb-safe')}>
        {/* Docked with Clear All so the marks can be switched without scrolling. */}
        <div className="flex items-center justify-between min-h-8 pointer-coarse:min-h-11 px-1">
          <label htmlFor="opt-annot" className="text-[13px] pointer-coarse:text-[16px] cursor-pointer">Annotations on the trace</label>
          <Switch id="opt-annot" aria-label="Annotations on the trace" checked={showAnnotations} onCheckedChange={setShowAnnotations} />
        </div>
        <div className="flex items-center justify-between min-h-8 pointer-coarse:min-h-11 px-1">
          <label htmlFor="opt-list" className="text-[13px] pointer-coarse:text-[16px] cursor-pointer">Artifact list (top right)</label>
          <Switch id="opt-list" aria-label="Artifact list (top right)" checked={showArtifactList} onCheckedChange={setShowArtifactList} />
        </div>
        <Button variant="destructive" className="w-full mt-1.5" onClick={clearAll}>
          Clear All Patterns
        </Button>
      </div>

    </div>
  );
}
