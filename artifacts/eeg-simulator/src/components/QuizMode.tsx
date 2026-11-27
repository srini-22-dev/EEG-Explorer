import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Brain, Check, X } from 'lucide-react';
import { PATTERN_BY_ID, PATTERN_CATEGORIES } from '../utils/patterns';
import { quizPage, effective } from '../utils/toggleRules';

/**
 * Not asked: what cannot be seen on the one page a question records (it was 4 s until
 * 2026-11-27; the 2026-10-23 audit below was made at 4 s). Hyperventilation
 * builds over minutes and photic stimulation starts at 1 Hz, where there is no
 * driving; ECG and mains are under a millimetre on the double banana at 7 uV/mm
 * (2026-10-23 audit). A slow-fused transient is told from posterior slow waves of
 * youth only by seeing its sharp wave both with a slow wave and apart, which 4 s
 * rarely holds (2026-10-27). Each is still a distractor.
 */
const NOT_ASKED = new Set(['hyperventilation', 'photic', 'ecg-artifact', '50hz', 'slow-fused']);

/** The sidebar category a pattern is listed under, shown with the answer only. */
const CATEGORY_OF: Record<string, string> = Object.fromEntries(
  PATTERN_CATEGORIES.flatMap(c => c.patterns.map(p => [p.id, c.name])),
);

type QuizModeProps = {
  onClose: () => void;
  setActivePatterns: (p: Set<string>) => void;
  setFreeze: (f: boolean) => void;
  /** Start blank paper for the next question, on this pattern (EEGCanvas freshPageKey, pageInterest). */
  newPage: (target: string) => void;
  /** The current question's page has filled; it is frozen then and the question asked. */
  pageFull: boolean;
  /** Seconds the page takes to fill, at this width and speed. */
  pageSec: number;
  /** Show the page's annotations: once answered (owner's inbox, 2026-11-27). */
  setReveal: (r: boolean) => void;
};

/**
 * Docked in the sidebar's place (App.tsx), never over the trace: the student has to
 * read the page they are asked about. App hides what would name the answer.
 */
export function QuizMode({ onClose, setActivePatterns, setFreeze, newPage, pageFull, pageSec, setReveal }: QuizModeProps) {
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [questionPhase, setQuestionPhase] = useState<'recording' | 'guessing' | 'result'>('recording');
  const [currentPatternId, setCurrentPatternId] = useState<string>('');
  const [options, setOptions] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<string>('');

  const generateQuestion = () => {
    const allPatterns = Object.keys(PATTERN_BY_ID);
    const askable = allPatterns.filter(p => !NOT_ASKED.has(p));
    const target = askable[Math.floor(Math.random() * askable.length)];
    setCurrentPatternId(target);
    setSelectedOption('');

    // No distractor may be on the page too (Eyes Open comes with Lambda, which
    // needs open eyes): it would be a second right answer, marked wrong.
    const onPage = effective(quizPage([target]));
    const distractors = allPatterns.filter(p => !onPage.has(p));
    const opts = new Set<string>([target]);
    while(opts.size < 4) {
      opts.add(distractors[Math.floor(Math.random() * distractors.length)]);
    }
    setOptions(Array.from(opts).sort(() => Math.random() - 0.5));

    setActivePatterns(new Set([target]));
    setFreeze(false);
    setReveal(false);
    // Each question on its own page: the last question's trace no longer fills most of it.
    newPage(target);
    setQuestionPhase('recording');
  };

  // The page is full: freeze it and ask.
  useEffect(() => {
    if (questionPhase === 'recording' && pageFull) {
      setFreeze(true);
      setQuestionPhase('guessing');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageFull, questionPhase]);

  useEffect(() => {
    generateQuestion();
    return () => { setFreeze(false); setReveal(false); };
  }, []);

  // Esc leaves the quiz from any phase; unmounting runs the cleanup above.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleGuess = (opt: string) => {
    setSelectedOption(opt);
    setQuestionPhase('result');
    // Now the arrows and boxes may name what is on the page.
    setReveal(true);
    setTotal(t => t + 1);
    if (opt === currentPatternId) {
      setScore(s => s + 1);
    }
  };

  const questionNo = questionPhase === 'result' ? total : total + 1;
  const correct = selectedOption === currentPatternId;
  const target = PATTERN_BY_ID[currentPatternId];
  const chosen = PATTERN_BY_ID[selectedOption];

  return (
    // `visible` overrides the hidden sidebar this panel sits over.
    <div className="visible absolute inset-0 z-20 flex flex-col bg-[#1e2a1e] border-r border-[#2e4a2e] text-slate-200 text-sm">
      {/* Progress and score */}
      <div className="px-4 py-3 border-b border-[#2e4a2e]">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <Brain className="w-4 h-4" /> Pattern quiz
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-400">
          <span>Question {questionNo}</span>
          <span>Score {score} / {total}{total > 0 && ` (${Math.round((100 * score) / total)}%)`}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {questionPhase === 'recording' && (
          <div className="space-y-3">
            <p className="text-slate-300">Recording… watch the trace.</p>
            <div className="h-1.5 rounded bg-[#2e4a2e] overflow-hidden">
              <div
                key={questionNo}
                className="h-full bg-emerald-500"
                style={{ animation: `quiz-record ${Math.round(pageSec * 1000)}ms linear forwards` }}
              />
            </div>
            <style>{'@keyframes quiz-record { from { width: 0 } to { width: 100% } }'}</style>
            <p className="text-xs text-slate-500">
              A fresh page: it freezes when full (about {Math.round(pageSec)} s) and what it asks
              about is clear of its edges. You can then measure on it (click two points or drag a
              box) before answering.
            </p>
          </div>
        )}

        {questionPhase !== 'recording' && (
          <div className="space-y-2">
            <p className="text-slate-300">Which pattern is on this page?</p>
            {options.map(opt => {
              const isTarget = opt === currentPatternId;
              const isChosen = opt === selectedOption;
              const resultStyle = questionPhase !== 'result'
                ? 'border-slate-700 text-slate-200 hover:bg-[#2a3a2a]'
                : isTarget
                  ? 'border-emerald-600 bg-emerald-900/40 text-emerald-200'
                  : isChosen
                    ? 'border-red-600 bg-red-900/30 text-red-200'
                    : 'border-slate-800 text-slate-500';
              return (
                <Button
                  key={opt}
                  variant="outline"
                  disabled={questionPhase === 'result'}
                  className={`w-full justify-start bg-transparent h-auto py-2 whitespace-normal text-left disabled:opacity-100 ${resultStyle}`}
                  onClick={() => handleGuess(opt)}
                >
                  {questionPhase === 'result' && isTarget && <Check className="w-4 h-4 mr-2 shrink-0" />}
                  {questionPhase === 'result' && isChosen && !isTarget && <X className="w-4 h-4 mr-2 shrink-0" />}
                  {PATTERN_BY_ID[opt].name}
                </Button>
              );
            })}
          </div>
        )}

        {questionPhase === 'result' && target && (
          <div className="space-y-3">
            <div className={`font-bold ${correct ? 'text-emerald-400' : 'text-red-400'}`}>
              {correct ? 'Correct' : 'Incorrect'}
            </div>
            <div className="rounded border border-emerald-800 bg-emerald-950/30 p-3">
              <div className="text-[10px] uppercase tracking-wide text-emerald-500">
                The page shows · {CATEGORY_OF[target.id]}
              </div>
              <div className="font-semibold text-white">{target.name}</div>
              <p className="mt-1 text-xs text-slate-300">{target.desc}</p>
            </div>
            {!correct && chosen && (
              <div className="rounded border border-red-900 bg-red-950/20 p-3">
                <div className="text-[10px] uppercase tracking-wide text-red-400">
                  You chose · {CATEGORY_OF[chosen.id]}
                </div>
                <div className="font-semibold text-white">{chosen.name}</div>
                <p className="mt-1 text-xs text-slate-300">{chosen.desc}</p>
              </div>
            )}
            <p className="text-xs text-slate-500">The page stays frozen, now with its annotations: compare it with the descriptions.</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-[#2e4a2e] space-y-2">
        {questionPhase === 'result' && (
          <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={generateQuestion}>
            Next question
          </Button>
        )}
        <Button variant="ghost" className="w-full text-slate-400 hover:text-white hover:bg-[#2a3a2a]" onClick={onClose}>
          Exit quiz <span className="ml-2 text-[10px] text-slate-500">Esc</span>
        </Button>
      </div>
    </div>
  );
}
