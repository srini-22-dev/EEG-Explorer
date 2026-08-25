import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { EEGCanvas } from './components/EEGCanvas';
import { MONTAGES } from './utils/montages';
import type {
  SimSettings, PatientState, IctalParams, IctalParamsMap, ArtifactParams, Speed, Sensitivity,
} from './utils/simTypes';
import { defaultIctalParamsMap, defaultArtifactParams } from './utils/simTypes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EEGTheme } from './utils/themes';
import { QuizMode } from './components/QuizMode';
import { TutorialMode } from './components/TutorialMode';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';

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
  <div className="w-full h-full flex items-center justify-center bg-[#1e2a1e] text-xs text-slate-500">
    Loading {label}…
  </div>
);
// Patterns that are graphoelements of a specific sleep/drowsiness stage, not
// independent overlays — they cannot occur outside the state that defines them.
// `target` is the state selecting the pattern jumps Background State to;
// `compatible` is every state the pattern is allowed to keep rendering in.
const STATE_LOCKED_PATTERNS: Record<string, { target: PatientState; compatible: PatientState[] }> = {
  'posts':     { target: 'n1', compatible: ['drowsy', 'n1', 'n2'] },
  'v-waves':   { target: 'n2', compatible: ['n1', 'n2'] },
  'k-complex': { target: 'n2', compatible: ['n2'] },
  'spindles':  { target: 'n2', compatible: ['n2'] },
  'wicket':    { target: 'drowsy', compatible: ['drowsy'] },
  'rmtd':      { target: 'drowsy', compatible: ['drowsy'] },
  '14-6-pos':  { target: 'drowsy', compatible: ['drowsy', 'n1', 'n2'] },
  'bets':      { target: 'drowsy', compatible: ['drowsy', 'n1', 'n2'] },
  // Activation procedures need an awake, cooperative patient: you cannot ask a
  // sleeping one to overbreathe, and a driving response is judged on an awake
  // background. Drowsiness is tolerated because patients do drift during a
  // three-minute procedure.
  'photic':           { target: 'awake', compatible: ['awake', 'drowsy'] },
  'hyperventilation': { target: 'awake', compatible: ['awake', 'drowsy'] },
};

export default function App() {
  const [montageId,    setMontageId]    = useState<string>('bipolar-ap');
  const [speed,        setSpeed]        = useState<Speed>(30);
  const [sensitivity,  setSensitivity]  = useState<Sensitivity>(7);
  const [patientState, setPatientState] = useState<PatientState>('awake');
  const [activePatterns, setActivePatterns] = useState<Set<string>>(new Set());
  const [ictalParams, setIctalParams] = useState<IctalParamsMap>(defaultIctalParamsMap());
  const updateIctalParams = (toggleId: string, patch: Partial<IctalParams>) =>
    setIctalParams(prev => ({ ...prev, [toggleId]: { ...prev[toggleId], ...patch } }));

  // One object for the whole artifact layer rather than one per toggle: unlike
  // seizures, which run independently and simultaneously, there is only ever one
  // patient's jaw, heart and mains supply.
  const [artifactParams, setArtifactParams] = useState<ArtifactParams>(defaultArtifactParams());
  const updateArtifactParams = (patch: Partial<ArtifactParams>) =>
    setArtifactParams(prev => ({ ...prev, ...patch }));

  const [theme, setTheme] = useState<EEGTheme>('green-paper');
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [graphHover, setGraphHover] = useState(true);
  const [showSpectrum, setShowSpectrum] = useState(false);
  const [showRightSpectrum, setShowRightSpectrum] = useState(false);
  const [freezeYAxis, setFreezeYAxis] = useState(false);
  const [quizMode, setQuizMode] = useState(false);
  const [tutorialMode, setTutorialMode] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);

  const dataBuffer = useRef<number[][]>([]);
  const timeBuffer = useRef<number[]>([]);

  const [show3DPanel, setShow3DPanel] = useState(false);
  const [headOpacity, setHeadOpacity] = useState(0.3);
  const [brainOpacity, setBrainOpacity] = useState(0.8);

  const togglePattern = (id: string) =>
    setActivePatterns(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (id === 'eyes-open') next.delete('blink');
      } else {
        next.add(id);
        const lock = STATE_LOCKED_PATTERNS[id];
        if (lock) setPatientState(lock.target);
        if (id === 'blink') next.add('eyes-open');
      }
      return next;
    });

  // A stage-locked pattern can't survive a manual state change that moves the
  // patient out of the stage it belongs to (e.g. K-complex switched on in N2,
  // then the user manually selects Awake) — clear it rather than leave the
  // toggle showing "on" while nothing physiologically compatible renders.
  useEffect(() => {
    setActivePatterns(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        const lock = STATE_LOCKED_PATTERNS[id];
        if (lock && !lock.compatible.includes(patientState)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientState]);

  // Clearing the toggle set is sufficient: the streaming engine quiesces each
  // source the moment its enabled flag drops (transient schedules clear, scripted
  // patterns reset their clocks), so there is no separate generator state to reset.
  const clearAll = () => setActivePatterns(new Set());

  const settings: SimSettings = {
    speed, sensitivity, patientState, activePatterns, ictalParams, artifactParams,
  };

  // Build active-effects label list for canvas overlay
  const activeEffects = Array.from(activePatterns).slice(0, 5).join(' · ');

  return (
    <TooltipProvider>
      <div className={`flex h-screen w-full overflow-hidden font-sans ${theme === 'dark-mode' ? 'bg-[#121212]' : theme === 'white-paper' ? 'bg-white' : 'bg-[#c8e6c0]'}`}>
        <ControlPanel
          montageId={montageId}         setMontageId={setMontageId}
          activePatterns={activePatterns} togglePattern={togglePattern}
          ictalParams={ictalParams} updateIctalParams={updateIctalParams}
          artifactParams={artifactParams} updateArtifactParams={updateArtifactParams}
          speed={speed}                 setSpeed={setSpeed}
          sensitivity={sensitivity}     setSensitivity={setSensitivity}
          patientState={patientState}   setPatientState={setPatientState}
          clearAll={clearAll}
          theme={theme} setTheme={setTheme}
          showAnnotations={showAnnotations} setShowAnnotations={setShowAnnotations}
          graphHover={graphHover} setGraphHover={setGraphHover}
          showSpectrum={showSpectrum} setShowSpectrum={setShowSpectrum}
          showRightSpectrum={showRightSpectrum} setShowRightSpectrum={setShowRightSpectrum}
          setQuizMode={setQuizMode} setTutorialMode={setTutorialMode}
          dataBuffer={dataBuffer} timeBuffer={timeBuffer}
          show3DPanel={show3DPanel} setShow3DPanel={setShow3DPanel}
          headOpacity={headOpacity} setHeadOpacity={setHeadOpacity}
          brainOpacity={brainOpacity} setBrainOpacity={setBrainOpacity}
        />
        <div className="flex-1 flex flex-col h-full relative">
          {/*
            The PanelGroup is unconditional and EEGCanvas is written exactly once.
            It used to appear twice — inside the group and again as a bare sibling —
            so toggling the 3D panel moved it to a different position in the element
            tree. React read that as an unmount plus a mount, which built a fresh
            SimulationSource on a new random seed, reset the elapsed clock and wiped
            both buffers: the record did not merely lose its history, it became a
            different patient. Holding the position fixed means the toggle only
            changes the canvas width, which the ResizeObserver handles.

            `order` is required on conditionally-rendered panels so the group can
            place the 3D panel consistently when it reappears.
          */}
          <PanelGroup direction="horizontal">
            <Panel id="eeg" order={1} minSize={30}>
              <EEGCanvas
                montage={MONTAGES[montageId]}
                settings={settings}
                activeEffectsLabel={activeEffects}
                theme={theme}
                showAnnotations={showAnnotations}
                isFrozen={isFrozen}
                setIsFrozen={setIsFrozen}
                dataBuffer={dataBuffer}
                timeBuffer={timeBuffer}
                graphHover={graphHover}
              />
            </Panel>
            {show3DPanel && (
              <>
                <PanelResizeHandle className="w-2 bg-[#2e4a2e] hover:bg-[#3e5a3e] cursor-col-resize transition-colors flex items-center justify-center">
                  <div className="w-1 h-8 bg-slate-500 rounded-full" />
                </PanelResizeHandle>
                <Panel id="head3d" order={2} defaultSize={30} minSize={20}>
                  <Suspense fallback={<PanelLoading label="3D head model" />}>
                    <HeadModel3D
                      montage={MONTAGES[montageId]}
                      headOpacity={headOpacity}
                      brainOpacity={brainOpacity}
                    />
                  </Suspense>
                </Panel>
              </>
            )}
            {showRightSpectrum && (
              <>
                <PanelResizeHandle className="w-2 bg-[#2e4a2e] hover:bg-[#3e5a3e] cursor-col-resize transition-colors flex items-center justify-center">
                  <div className="w-1 h-8 bg-slate-500 rounded-full" />
                </PanelResizeHandle>
                <Panel id="rightSpectrum" order={3} defaultSize={22} minSize={12}>
                  <Suspense fallback={<PanelLoading label="band panel" />}>
                    <RightSpectrumPanel
                      dataBuffer={dataBuffer}
                      montage={MONTAGES[montageId]}
                    />
                  </Suspense>
                </Panel>
              </>
            )}
          </PanelGroup>
          {showSpectrum && (
            <Suspense fallback={<div className="h-48 bg-[#1e2a1e] border-t border-[#2e4a2e]" />}>
              <SpectrumPanel
                dataBuffer={dataBuffer}
                montage={MONTAGES[montageId]}
                freezeYAxis={freezeYAxis}
                setFreezeYAxis={setFreezeYAxis}
                settings={settings}
              />
            </Suspense>
          )}
        </div>
        
        {quizMode && (
          <QuizMode 
            onClose={() => setQuizMode(false)}
            setPatientState={setPatientState}
            setActivePatterns={setActivePatterns}
            setFreeze={setIsFrozen}
          />
        )}
        
        {tutorialMode && (
          <TutorialMode 
            onClose={() => setTutorialMode(false)}
            setPatientState={setPatientState}
            setActivePatterns={setActivePatterns}
            setMontageId={setMontageId}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
