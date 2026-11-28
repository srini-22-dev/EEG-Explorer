import React, { useState, useMemo, useRef, useCallback, Suspense, lazy } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { TopBar, RecordingList } from './components/TopBar';
import { InfoPanel } from './components/InfoPanel';
import { EEGCanvas } from './components/EEGCanvas';
import { MONTAGES, withResp } from './utils/montages';
import {
  type ToggleState, initialToggles, effective, toggle, enterState, clearToggles, setPage, quizPage,
} from './utils/toggleRules';
import type {
  SimSettings, PatientState, IctalParams, IctalParamsMap, ArtifactParams, PatternOptions, Speed, Sensitivity, FilterSettings,
  ConditionLevel,
} from './utils/simTypes';
import { applyLevel, isEdited, type AppliedLevel } from './utils/recordingConditions';
import { useLiveArtifacts } from './utils/liveArtifacts';
import { defaultIctalParamsMap, defaultArtifactParams, POSTS_SMALLER_DEFAULT, POSTS_ONE_SIDE_DEFAULT, DEFAULT_FILTERS } from './utils/simTypes';
import { EEGTheme } from './utils/themes';
import { QuizMode } from './components/QuizMode';
import { TutorialMode } from './components/TutorialMode';
import { LessonsMode } from './components/LessonsMode';
import type { LessonView } from './utils/lessons';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Activity, Brain, ChevronRight, GraduationCap, MonitorPlay, SlidersHorizontal, Smartphone, Tag } from 'lucide-react';
import { Sheet, Group, Row, IconTile, CloseButton } from '@/components/ui/ios';
import { useAppearance, useLayoutMode } from './utils/uiTheme';
import { PX_PER_MM_X } from './utils/displayGeometry';

// Both panels are optional and both drag in a large dependency that the trace
// display itself never touches — three/fiber/drei for the head, recharts for the
// spectrum. Loading them lazily keeps them out of the initial bundle, so the EEG
// display is interactive without paying for either.
const HeadModel3D = lazy(() =>
  import('./components/HeadModel3D').then(m => ({ default: m.HeadModel3D })));
const SpectrumPanel = lazy(() =>
  import('./components/SpectrumPanel').then(m => ({ default: m.SpectrumPanel })));
const RightSpectrumPanel = lazy(() =>
  import('./components/RightSpectrumPanel').then(m => ({ default: m.RightSpectrumPanel })));

const PanelLoading = ({ label }: { label: string }) => (
  <div className="w-full h-full min-h-48 flex items-center justify-center bg-ui-root text-[12px] text-ui-text-2">
    Loading {label}…
  </div>
);
export default function App() {
  const [montageId,    setMontageId]    = useState<string>('bipolar-ap');
  const [speed,        setSpeed]        = useState<Speed>(30);
  const [sensitivity,  setSensitivity]  = useState<Sensitivity>(7);
  // One object, replaced whole on each change: the engine short-circuits on an
  // unchanged reference (Engine.setFilters).
  const [filters,      setFilters]      = useState<FilterSettings>(DEFAULT_FILTERS);
  // The background state and the toggles are one value, changed only through the
  // rule functions in utils/toggleRules.ts. That is what keeps a contradictory page
  // (a blink in REM, lambda waves with the eyes closed) from being reachable.
  const [toggles, setToggles] = useState<ToggleState>(() => initialToggles('awake'));
  const patientState = toggles.patientState;
  const effectivePatterns = useMemo(() => effective(toggles), [toggles]);
  const setPatientState = (state: PatientState) => setToggles(prev => enterState(prev, state));
  const togglePattern = (id: string) => setToggles(prev => toggle(prev, id));
  // The streaming engine quiesces each source the moment its enabled flag drops, so
  // clearing the toggles is all a reset needs.
  const clearAll = () => setToggles(prev => clearToggles(prev));
  // The tutorial composes a page in the current state; the quiz shows one pattern in
  // the stage it belongs to. Both go through the same rules as a click does.
  const setTutorialPatterns = (p: Set<string>) => setToggles(prev => setPage(prev.patientState, p));
  const selectQuizPatterns = (p: Set<string>) => setToggles(() => quizPage(p));
  const [ictalParams, setIctalParams] = useState<IctalParamsMap>(defaultIctalParamsMap());
  const updateIctalParams = (toggleId: string, patch: Partial<IctalParams>) =>
    setIctalParams(prev => ({ ...prev, [toggleId]: { ...prev[toggleId], ...patch } }));

  // One object for the whole artifact layer rather than one per toggle: unlike
  // seizures, which run independently and simultaneously, there is only ever one
  // patient's jaw, heart and mains supply.
  const [artifactParams, setArtifactParams] = useState<ArtifactParams>(defaultArtifactParams());
  const updateArtifactParams = (patch: Partial<ArtifactParams>) =>
    setArtifactParams(prev => ({ ...prev, ...patch }));

  // Recording conditions (top bar). Choosing a level sets the artifact toggles and
  // settings from its recipe; what was applied is kept so a later edit by hand shows
  // as "(edited)". The level itself stays, and with it the patient's behaviour over
  // time (engine/conditions.ts).
  const [conditions, setConditionsLevel] = useState<ConditionLevel>('none');
  // The respiration row under the ECG (IK-049): off unless asked for, or a level brings it.
  const [showResp, setShowResp] = useState(false);
  const montage = useMemo(() => (showResp ? withResp(MONTAGES[montageId]) : MONTAGES[montageId]), [montageId, showResp]);
  const [appliedLevel, setAppliedLevel] = useState<AppliedLevel>({ level: 'none', on: [], params: {} });
  const setConditions = (level: ConditionLevel) => {
    const r = applyLevel(level, toggles, artifactParams);
    setToggles(r.toggles);
    setArtifactParams(r.params);
    setAppliedLevel(r.applied);
    setConditionsLevel(level);
    if (r.showResp != null) setShowResp(r.showResp);
  };
  const conditionsEdited = isEdited(appliedLevel, toggles, artifactParams);
  // The controls follow what the level is doing (and the tubing's water after a suction).
  // Also while Electrode Pop is on: its controls offer to disconnect the electrode that popped last.
  const live = useLiveArtifacts(conditions !== 'none' || effectivePatterns.has('ventilator') || effectivePatterns.has('electrode-pop'));

  const [patternOptions, setPatternOptions] = useState<PatternOptions>({ postsForm: 'singles', focalPlacement: 'under', seizureMuscle: true, kcSpindle: 'sometimes', sixHzForm: 'fold', breachSite: 'C4', breachSites: ['C4'], pos146Sides: 'shifting', postsSmallerPct: POSTS_SMALLER_DEFAULT, postsOneSidePct: POSTS_ONE_SIDE_DEFAULT });
  const updatePatternOptions = (patch: Partial<PatternOptions>) =>
    setPatternOptions(prev => ({ ...prev, ...patch }));

  // A lesson view puts its page on screen: only its own toggles, in their stage
  // (quizPage, which is what gate Step 30 checks the lesson's claims against), and
  // the standard 7 µV/mm and 30 mm/s unless the view is about changing them. The
  // filters, artifact settings and recording level go back to the app's defaults,
  // as Step 30 runs them: a detached electrode or a noisy level left on from before
  // would put something on the page the lesson does not describe.
  const showLessonView = (view: LessonView) => {
    setConditionsLevel('none');
    setAppliedLevel({ level: 'none', on: [], params: {} });
    setArtifactParams(prev => ({ ...defaultArtifactParams(), manualPopNonce: prev.manualPopNonce, suctionNonce: prev.suctionNonce }));
    setFilters(DEFAULT_FILTERS);
    setToggles(() => quizPage(view.patterns));
    setMontageId(view.montage);
    if (view.focalPlacement) updatePatternOptions({ focalPlacement: view.focalPlacement });
    setSensitivity(view.sensitivity ?? 7);
    setSpeed(view.speed ?? 30);
  };

  const [theme, setTheme] = useState<EEGTheme>('green-paper');
  const [showAnnotations, setShowAnnotations] = useState(true);
  // The artifact list at the canvas's top right, on its own switch (owner, 2026-11-25:
  // "separate annotation for on signals and separate for the top right").
  const [showArtifactList, setShowArtifactList] = useState(true);
  const [graphHover, setGraphHover] = useState(false);
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [showRightSpectrum, setShowRightSpectrum] = useState(false);
  const [freezeYAxis, setFreezeYAxis] = useState(false);
  const [quizMode, setQuizMode] = useState(false);
  // Each quiz question gets a fresh page (EEGCanvas freshPageKey), and its annotations
  // once answered (owner's inbox, 2026-11-27).
  const [quizPageKey, setQuizPageKey] = useState(0);
  const [quizPageSec, setQuizPageSec] = useState(10);
  const [quizPageFullKey, setQuizPageFullKey] = useState(-1);
  const [quizReveal, setQuizReveal] = useState(false);
  const [quizTarget, setQuizTarget] = useState<string | undefined>(undefined);
  const [tutorialMode, setTutorialMode] = useState(false);
  const [lessonsMode, setLessonsMode] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);

  const dataBuffer = useRef<number[][]>([]);
  const timeBuffer = useRef<number[]>([]);

  const [show3DPanel, setShow3DPanel] = useState(false);
  // The toggle whose information panel is open, if any.
  const [infoId, setInfoId] = useState<string | null>(null);
  const closeInfo = useCallback(() => setInfoId(null), []);
  const [headOpacity, setHeadOpacity] = useState(0.3);
  const [brainOpacity, setBrainOpacity] = useState(0.8);

  const settings: SimSettings = {
    speed, sensitivity, patientState, activePatterns: effectivePatterns, ictalParams, artifactParams,
    patternOptions, filters, conditions,
  };

  // ── Layout ────────────────────────────────────────────────────────────────────
  // A phone (narrow, or on its side) gets the trace to itself: the controls move
  // into sheets opened from a toolbar, at the bottom held upright and down the right
  // side held sideways, where height is what is short (owner, 2026-11-28).
  const { compact, portrait } = useLayoutMode();
  const [appearance, setAppearance] = useAppearance();
  const [sheet, setSheet] = useState<null | 'patterns' | 'recording' | 'learn'>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  // Starting the tutorial, quiz or lessons from a sheet closes it, so the page is in view.
  const startMode = (set: (b: boolean) => void) => (b: boolean) => { setSheet(null); set(b); };
  const docked = quizMode || lessonsMode;
  const dockAtBottom = compact && portrait;
  // A phone held upright shows only a few seconds of true 30 mm/s paper: said on the
  // page rather than squeezed to fit, which would make the calibration a lie.
  const [rotateHintClosed, setRotateHintClosed] = useState(false);
  const showRotateHint = compact && portrait && !rotateHintClosed && !docked && !tutorialMode;
  const pageSecShown = typeof window !== 'undefined' ? window.innerWidth / (speed * PX_PER_MM_X) : 0;
  const paperBg = theme === 'dark-mode' ? 'bg-[#121212]' : theme === 'white-paper' ? 'bg-white' : 'bg-[#c8e6c0]';

  const controlPanelProps = {
    montageId,
    activePatterns: effectivePatterns, togglePattern,
    ictalParams, updateIctalParams,
    artifactParams, updateArtifactParams,
    patternOptions, updatePatternOptions,
    patientState, setPatientState,
    clearAll,
    theme, setTheme, appearance, setAppearance,
    showAnnotations, setShowAnnotations,
    showArtifactList, setShowArtifactList,
    live,
    graphHover, setGraphHover,
    showSpectrum, setShowSpectrum,
    showRightSpectrum, setShowRightSpectrum,
    setQuizMode: startMode(setQuizMode), setTutorialMode: startMode(setTutorialMode), setLessonsMode: startMode(setLessonsMode),
    dataBuffer, timeBuffer,
    show3DPanel, setShow3DPanel,
    headOpacity, setHeadOpacity,
    brainOpacity, setBrainOpacity,
    infoId, onShowInfo: setInfoId,
  };
  const readingProps = {
    montageId, setMontageId,
    sensitivity, setSensitivity,
    speed, setSpeed,
    filters, setFilters,
    conditions, setConditions, conditionsEdited,
    infoId, onShowInfo: setInfoId,
    showResp, setShowResp,
  };

  // The quiz or the lessons, docked where the sidebar was (beside the trace), or under
  // the trace on a phone held upright: never over the page they are about.
  const dock = lessonsMode ? (
    <LessonsMode onClose={() => setLessonsMode(false)} showView={showLessonView} montage={montage} />
  ) : quizMode ? (
    <QuizMode
      onClose={() => setQuizMode(false)}
      setActivePatterns={selectQuizPatterns}
      setFreeze={setIsFrozen}
      newPage={(target: string) => { setQuizTarget(target); setQuizPageKey(k => k + 1); }}
      pageFull={quizPageFullKey === quizPageKey}
      pageSec={quizPageSec}
      setReveal={setQuizReveal}
    />
  ) : null;

  const resizeHandle = (
    <PanelResizeHandle className="w-1.5 bg-ui-sep/70 hover:bg-ui-accent/40 cursor-col-resize transition-colors flex items-center justify-center">
      <div className="w-1 h-8 rounded-full bg-ui-text-3" />
    </PanelResizeHandle>
  );

  const toolItems: { id: string; label: string; icon: React.ReactNode; on?: boolean; onClick: () => void }[] = [
    { id: 'patterns', label: 'Patterns', icon: <SlidersHorizontal />, on: sheet === 'patterns', onClick: () => setSheet('patterns') },
    { id: 'recording', label: 'Recording', icon: <Activity />, on: sheet === 'recording', onClick: () => setSheet('recording') },
    { id: 'learn', label: 'Learn', icon: <GraduationCap />, on: sheet === 'learn', onClick: () => setSheet('learn') },
    { id: 'marks', label: showAnnotations ? 'Marks on' : 'Marks off', icon: <Tag />, on: showAnnotations, onClick: () => setShowAnnotations(!showAnnotations) },
  ];
  const showToolbar = compact && !docked && !tutorialMode;
  const toolButton = (t: typeof toolItems[number], vertical: boolean) => (
    <button key={t.id} type="button" onClick={t.onClick} aria-pressed={t.on}
      className={`flex flex-col items-center justify-center gap-0.5 rounded-[10px] transition-colors ${vertical ? 'w-14 h-12' : 'flex-1 h-[49px]'} ${
        t.on ? 'text-ui-accent' : 'text-ui-text-2 active:text-ui-text'}`}>
      <span className="[&_svg]:w-[22px] [&_svg]:h-[22px]">{t.icon}</span>
      <span className="text-[10px] font-medium leading-none">{t.label}</span>
    </button>
  );

  return (
      <div className={`flex h-[100dvh] w-full overflow-hidden font-sans bg-ui-root text-ui-text ${compact ? 'pl-safe' : ''} ${compact && !portrait && !showToolbar ? 'pr-safe' : ''}`}>
        {/* Hidden, not removed, during the quiz: its switches name the answer, and
            keeping it mounted keeps its open categories and search. The dock takes
            its place, so the trace keeps its full width and nothing covers it. */}
        {!compact && (
          <div className={docked ? 'hidden' : 'contents'}>
            <ControlPanel variant="sidebar" {...controlPanelProps} />
          </div>
        )}
        {docked && !dockAtBottom && (
          <div className={`${compact ? 'w-[280px]' : 'w-[300px]'} h-full flex-shrink-0 border-r border-ui-sep`}>{dock}</div>
        )}
        <div className="flex-1 flex flex-col h-full relative min-w-0">
          {!compact && <TopBar {...readingProps} />}
          {/*
            The PanelGroup is unconditional and EEGCanvas is written exactly once.
            It used to appear twice — inside the group and again as a bare sibling —
            so toggling the 3D panel moved it to a different position in the element
            tree. React read that as an unmount plus a mount, which built a fresh
            SimulationSource on a new random seed, reset the elapsed clock and wiped
            both buffers: the record did not merely lose its history, it became a
            different patient. Holding the position fixed means the toggle only
            changes the canvas width, which the ResizeObserver handles. The phone
            layout keeps the same tree for the same reason: its panels are sheets
            outside the group, never a different place for the canvas.

            `order` is required on conditionally-rendered panels so the group can
            place the 3D panel consistently when it reappears.
          */}
          <div className={`flex-1 min-h-0 relative ${paperBg}`}>
            <PanelGroup direction="horizontal">
              <Panel id="eeg" order={1} minSize={30}>
                <EEGCanvas
                  montage={montage}
                  settings={settings}
                  theme={theme}
                  showAnnotations={quizMode ? quizReveal : showAnnotations}
                  showArtifactList={showArtifactList && !quizMode}
                  showStateLabel={!quizMode}
                  isFrozen={isFrozen}
                  setIsFrozen={setIsFrozen}
                  dataBuffer={dataBuffer}
                  timeBuffer={timeBuffer}
                  graphHover={graphHover}
                  freshPageKey={quizMode ? quizPageKey : undefined}
                  onFreshPage={setQuizPageSec}
                  onPageFull={() => setQuizPageFullKey(quizPageKey)}
                  pageInterest={quizMode ? quizTarget : undefined}
                />
              </Panel>
              {show3DPanel && !compact && (
                <>
                  {resizeHandle}
                  <Panel id="head3d" order={2} defaultSize={30} minSize={20}>
                    <Suspense fallback={<PanelLoading label="3D head model" />}>
                      <HeadModel3D
                        montage={montage}
                        headOpacity={headOpacity}
                        brainOpacity={brainOpacity}
                      />
                    </Suspense>
                  </Panel>
                </>
              )}
              {showRightSpectrum && (
                <>
                  {resizeHandle}
                  <Panel id="rightSpectrum" order={3} defaultSize={compact ? 30 : 22} minSize={12}>
                    <Suspense fallback={<PanelLoading label="band panel" />}>
                      <RightSpectrumPanel
                        dataBuffer={dataBuffer}
                        montage={montage}
                      />
                    </Suspense>
                  </Panel>
                </>
              )}
              {infoId && !quizMode && !compact && (
                <>
                  {resizeHandle}
                  <Panel id="info" order={4} defaultSize={30} minSize={20}>
                    <InfoPanel id={infoId} onClose={closeInfo} conditions={conditions} />
                  </Panel>
                </>
              )}
            </PanelGroup>
            {showRotateHint && (
              <div className="absolute left-[64px] right-2 bottom-16 z-20 flex justify-center pointer-events-none">
                <div className="ui-material pointer-events-auto flex items-center gap-2.5 rounded-[14px] border border-ui-sep shadow-[var(--ui-shadow)] pl-3 pr-1 py-1.5 max-w-[340px]">
                  <Smartphone className="w-5 h-5 shrink-0 rotate-90 text-ui-accent" />
                  <p className="text-[12px] leading-snug text-ui-text">
                    {pageSecShown.toFixed(1)} s shown at a true {speed} mm/s. Turn your phone sideways for a longer page.
                  </p>
                  <CloseButton onClick={() => setRotateHintClosed(true)} label="Dismiss" />
                </div>
              </div>
            )}
          </div>
          {showSpectrum && !compact && (
            <Suspense fallback={<div className="h-48 bg-ui-root border-t border-ui-sep" />}>
              <SpectrumPanel
                dataBuffer={dataBuffer}
                montage={montage}
                freezeYAxis={freezeYAxis}
                setFreezeYAxis={setFreezeYAxis}
              />
            </Suspense>
          )}
          {docked && dockAtBottom && (
            <div className="h-[48%] flex-shrink-0 border-t border-ui-sep">{dock}</div>
          )}
          {showToolbar && portrait && (
            <nav aria-label="Controls" className="ui-material flex-shrink-0 flex items-stretch border-t border-ui-sep pb-safe px-2">
              {toolItems.map(t => toolButton(t, false))}
            </nav>
          )}
        </div>
        {showToolbar && !portrait && (
          <nav aria-label="Controls" className="ui-material flex-shrink-0 flex flex-col items-center justify-center gap-1 border-l border-ui-sep pr-safe px-1.5">
            {toolItems.map(t => toolButton(t, true))}
          </nav>
        )}

        {/* ── Phone sheets ── */}
        {compact && (
          <>
            <Sheet open={sheet === 'patterns'} onClose={closeSheet} title="Patterns" tall fill>
              <ControlPanel variant="sheet" {...controlPanelProps} />
            </Sheet>
            <Sheet open={sheet === 'recording'} onClose={closeSheet} title="Recording">
              <RecordingList {...readingProps} />
            </Sheet>
            <Sheet open={sheet === 'learn'} onClose={closeSheet} title="Learn">
              <Group footer="Each one drives the live page: the tutorial walks through a normal record, the quiz asks what a fresh page shows, and the lessons teach how to read one.">
                <Row icon={<IconTile color="var(--ui-green)"><MonitorPlay /></IconTile>} label="Tutorial" onClick={() => startMode(setTutorialMode)(true)}>
                  <ChevronRight className="w-4 h-4 text-ui-text-3" />
                </Row>
                <Row icon={<IconTile color="var(--ui-purple)"><Brain /></IconTile>} label="Quiz" onClick={() => startMode(setQuizMode)(true)}>
                  <ChevronRight className="w-4 h-4 text-ui-text-3" />
                </Row>
                <Row icon={<IconTile color="var(--ui-blue)"><GraduationCap /></IconTile>} label="Lessons: how to read EEG" onClick={() => startMode(setLessonsMode)(true)}>
                  <ChevronRight className="w-4 h-4 text-ui-text-3" />
                </Row>
              </Group>
            </Sheet>
            <Sheet open={showSpectrum} onClose={() => setShowSpectrum(false)} title="FFT spectrum">
              <Suspense fallback={<PanelLoading label="spectrum" />}>
                <SpectrumPanel
                  dataBuffer={dataBuffer}
                  montage={montage}
                  freezeYAxis={freezeYAxis}
                  setFreezeYAxis={setFreezeYAxis}
                />
              </Suspense>
            </Sheet>
            <Sheet open={show3DPanel} onClose={() => setShow3DPanel(false)} title="3D head" tall fill>
              <div className="flex-1 min-h-0">
                <Suspense fallback={<PanelLoading label="3D head model" />}>
                  <HeadModel3D montage={montage} headOpacity={headOpacity} brainOpacity={brainOpacity} />
                </Suspense>
              </div>
            </Sheet>
            {infoId && !quizMode && (
              <InfoPanel id={infoId} onClose={closeInfo} conditions={conditions} sheet />
            )}
          </>
        )}

        {tutorialMode && (
          <TutorialMode
            onClose={() => setTutorialMode(false)}
            setPatientState={setPatientState}
            setActivePatterns={setTutorialPatterns}
            setMontageId={setMontageId}
          />
        )}
      </div>
  );
}
