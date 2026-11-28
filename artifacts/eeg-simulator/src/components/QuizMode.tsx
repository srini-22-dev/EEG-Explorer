import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { IconTile, CloseButton } from '@/components/ui/ios';
import { Brain, CheckCircle2, XCircle } from 'lucide-react';
import { PATTERN_BY_ID, PATTERN_CATEGORIES } from '../utils/patterns';
import { quizPage, effective } from '../utils/toggleRules';
import { cn } from '@/lib/utils';

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
    <div className="h-full flex flex-col bg-ui-root text-ui-text">
      {/* Progress and score */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <IconTile color="var(--ui-purple)"><Brain /></IconTile>
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-semibold leading-tight">Pattern quiz</h2>
          <div className="text-[12px] pointer-coarse:text-[13px] text-ui-text-2 tabular-nums">
            Question {questionNo} · Score {score} / {total}{total > 0 && ` (${Math.round((100 * score) / total)}%)`}
          </div>
        </div>
        <CloseButton onClick={onClose} label="Exit quiz" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto ui-scroll px-4 pb-4 space-y-4">
        {questionPhase === 'recording' && (
          <div className="rounded-[12px] bg-ui-card p-4 space-y-3">
            <p className="text-[15px] font-medium">Recording… watch the trace.</p>
            <div className="h-1.5 rounded-full bg-ui-fill overflow-hidden">
              <div
                key={questionNo}
                data-progress
                className="h-full rounded-full bg-ui-accent"
                style={{ animation: `quiz-record ${Math.round(pageSec * 1000)}ms linear forwards` }}
              />
            </div>
            <style>{'@keyframes quiz-record { from { width: 0 } to { width: 100% } }'}</style>
            <p className="text-[12px] pointer-coarse:text-[13px] text-ui-text-2 leading-snug">
              A fresh page: it freezes when full (about {Math.round(pageSec)} s) and what it asks
              about is clear of its edges. You can then measure on it (tap or click two points, or
              drag a box) before answering.
            </p>
          </div>
        )}

        {questionPhase !== 'recording' && (
          <div>
            <p className="px-1 pb-2 text-[15px] font-semibold">Which pattern is on this page?</p>
            <div className="rounded-[12px] bg-ui-card overflow-hidden">
              {options.map((opt, i) => {
                const isTarget = opt === currentPatternId;
                const isChosen = opt === selectedOption;
                const result = questionPhase === 'result';
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={result}
                    onClick={() => handleGuess(opt)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 min-h-11 pointer-coarse:min-h-12 py-2 text-left text-[14px] pointer-coarse:text-[16px] transition-colors',
                      i > 0 && 'border-t border-ui-sep',
                      !result && 'hover:bg-ui-fill active:bg-ui-fill-2',
                      result && isTarget && 'bg-ui-green/12 text-ui-green font-semibold',
                      result && isChosen && !isTarget && 'bg-ui-red/12 text-ui-red',
                      result && !isTarget && !isChosen && 'text-ui-text-3',
                    )}
                  >
                    <span className="flex-1">{PATTERN_BY_ID[opt].name}</span>
                    {result && isTarget && <CheckCircle2 className="w-5 h-5 shrink-0" />}
                    {result && isChosen && !isTarget && <XCircle className="w-5 h-5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {questionPhase === 'result' && target && (
          <div className="space-y-3">
            <div className={`text-[20px] font-bold ${correct ? 'text-ui-green' : 'text-ui-red'}`}>
              {correct ? 'Correct' : 'Incorrect'}
            </div>
            <div className="rounded-[12px] bg-ui-card p-3.5 border-l-4 border-ui-green">
              <div className="text-[11px] font-semibold text-ui-green">
                The page shows · {CATEGORY_OF[target.id]}
              </div>
              <div className="text-[15px] font-semibold mt-0.5">{target.name}</div>
              <p className="mt-1 text-[12px] pointer-coarse:text-[14px] text-ui-text-2 leading-snug">{target.desc}</p>
            </div>
            {!correct && chosen && (
              <div className="rounded-[12px] bg-ui-card p-3.5 border-l-4 border-ui-red">
                <div className="text-[11px] font-semibold text-ui-red">
                  You chose · {CATEGORY_OF[chosen.id]}
                </div>
                <div className="text-[15px] font-semibold mt-0.5">{chosen.name}</div>
                <p className="mt-1 text-[12px] pointer-coarse:text-[14px] text-ui-text-2 leading-snug">{chosen.desc}</p>
              </div>
            )}
            <p className="text-[12px] text-ui-text-2">The page stays frozen, now with its annotations: compare it with the descriptions.</p>
          </div>
        )}
      </div>

      <div className="ui-material px-4 pt-2.5 pb-3 border-t border-ui-sep space-y-1 pb-safe">
        {questionPhase === 'result' && (
          <Button size="lg" className="w-full" onClick={generateQuestion}>
            Next question
          </Button>
        )}
        <Button variant="ghost" className="w-full" onClick={onClose}>
          Exit quiz <span className="ml-1 text-[11px] font-normal text-ui-text-3 pointer-coarse:hidden">Esc</span>
        </Button>
      </div>
    </div>
  );
}
