import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { GraduationCap, ChevronLeft, ChevronRight } from 'lucide-react';
import { LESSONS, type LessonView } from '../utils/lessons';
import type { Montage } from '../utils/montages';
import { setClickedChannels } from '../utils/highlightStore';

type LessonsModeProps = {
  onClose: () => void;
  /** Puts a view's page on screen: toggles, montage, focus, sensitivity and speed. */
  showView: (view: LessonView) => void;
  /** The montage on screen, to find the rows a view highlights. */
  montage: Montage;
};

/**
 * The Lessons section (utils/lessons.ts). Docked in the sidebar's place like the
 * quiz, so the trace it talks about stays uncovered; each view drives the live page
 * and highlights the rows its text is about.
 */
export function LessonsMode({ onClose, showView, montage }: LessonsModeProps) {
  const [lessonIndex, setLessonIndex] = useState(0);
  const [viewIndex, setViewIndex] = useState(0);
  const lesson = LESSONS[lessonIndex];
  const view = lesson.views[viewIndex];

  useEffect(() => { showView(view); }, [lessonIndex, viewIndex]);

  // Highlight once the view's montage is the one on screen; indices are per montage.
  useEffect(() => {
    const rows = new Set<number>();
    montage.channels.forEach((ch, i) => { if (view.look.includes(ch.label)) rows.add(i); });
    setClickedChannels(rows);
  }, [view, montage]);
  useEffect(() => () => setClickedChannels(new Set()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const goLesson = (i: number) => { setLessonIndex(i); setViewIndex(0); };

  return (
    // `visible` overrides the hidden sidebar this panel sits over.
    <div className="visible absolute inset-0 z-20 flex flex-col bg-[#1e2a1e] border-r border-[#2e4a2e] text-slate-200 text-sm">
      <div className="px-4 py-3 border-b border-[#2e4a2e]">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <GraduationCap className="w-4 h-4" /> Lessons: how to read EEG
        </div>
        <select
          aria-label="Choose a lesson"
          className="mt-2 w-full rounded border border-slate-700 bg-[#162016] px-2 py-1 text-xs text-slate-200"
          value={lessonIndex}
          onChange={e => goLesson(Number(e.target.value))}
        >
          {LESSONS.map((l, i) => <option key={l.id} value={i}>{i + 1}. {l.title}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Lesson {lessonIndex + 1} of {LESSONS.length}</div>
          <h2 className="text-base font-bold text-white">{lesson.title}</h2>
          <p className="mt-2 text-slate-300 leading-snug">{lesson.concept}</p>
        </div>

        {lesson.views.length > 1 && (
          <div className="space-y-1">
            {lesson.views.map((v, i) => (
              <Button
                key={v.label}
                variant="outline"
                size="sm"
                className={`w-full justify-start h-auto py-1.5 whitespace-normal text-left text-xs bg-transparent ${
                  i === viewIndex ? 'border-emerald-600 bg-emerald-900/40 text-emerald-200' : 'border-slate-700 text-slate-300 hover:bg-[#2a3a2a]'}`}
                onClick={() => setViewIndex(i)}
              >
                {i + 1}. {v.label}
              </Button>
            ))}
          </div>
        )}

        <div className="rounded border border-emerald-800 bg-emerald-950/30 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-emerald-500">On the page · {view.label}</div>
          <p className="text-xs text-slate-200 leading-snug">{view.text}</p>
          <div className="flex flex-wrap gap-1">
            {view.look.map(r => (
              <span key={r} className="rounded bg-yellow-700/40 px-1.5 py-0.5 text-[10px] font-mono text-yellow-100">{r}</span>
            ))}
          </div>
          <p className="text-[10px] text-slate-500">
            Highlighted rows are the ones to watch. New events arrive at the right edge; the pause button on the trace holds one.
          </p>
        </div>

        <p className="text-[10px] text-slate-500 leading-snug">Source: {lesson.basis}</p>
      </div>

      <div className="px-4 py-3 border-t border-[#2e4a2e] space-y-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 border-slate-700 text-slate-300 bg-transparent"
            disabled={lessonIndex === 0} onClick={() => goLesson(lessonIndex - 1)}>
            <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Previous
          </Button>
          <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={lessonIndex === LESSONS.length - 1} onClick={() => goLesson(lessonIndex + 1)}>
            Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
        <Button variant="ghost" className="w-full text-slate-400 hover:text-white hover:bg-[#2a3a2a]" onClick={onClose}>
          Exit lessons <span className="ml-2 text-[10px] text-slate-500">Esc</span>
        </Button>
      </div>
    </div>
  );
}
