import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { IconTile, CloseButton, SelectMenu } from '@/components/ui/ios';
import { GraduationCap, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { LESSONS, type LessonView } from '../utils/lessons';
import type { Montage } from '../utils/montages';
import { setClickedChannels } from '../utils/highlightStore';
import { cn } from '@/lib/utils';

type LessonsModeProps = {
  onClose: () => void;
  /** Puts a view's page on screen: toggles, montage, focus, sensitivity and speed. */
  showView: (view: LessonView) => void;
  /** The montage on screen, to find the rows a view highlights. */
  montage: Montage;
};

const LESSON_INDICES = LESSONS.map((_, i) => i);

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
    <div className="h-full flex flex-col bg-ui-root text-ui-text">
      <div className="px-4 pt-3 pb-2 space-y-2.5">
        <div className="flex items-center gap-3">
          <IconTile color="var(--ui-blue)"><GraduationCap /></IconTile>
          <h2 className="flex-1 min-w-0 text-[17px] font-semibold leading-tight">How to read EEG</h2>
          <CloseButton onClick={onClose} label="Exit lessons" />
        </div>
        <SelectMenu className="w-full" ariaLabel="Choose a lesson" value={lessonIndex} options={LESSON_INDICES}
          format={i => `${i + 1}. ${LESSONS[i].title}`} onChange={goLesson} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto ui-scroll px-4 pb-4 space-y-4">
        <div className="pt-1">
          <div className="text-[12px] font-medium text-ui-text-2 tabular-nums">Lesson {lessonIndex + 1} of {LESSONS.length}</div>
          <h3 className="text-[20px] font-bold leading-tight mt-0.5">{lesson.title}</h3>
          <p className="mt-2 text-[14px] pointer-coarse:text-[16px] text-ui-text leading-relaxed">{lesson.concept}</p>
        </div>

        {lesson.views.length > 1 && (
          <div className="rounded-[12px] bg-ui-card overflow-hidden">
            {lesson.views.map((v, i) => (
              <button
                key={v.label}
                type="button"
                onClick={() => setViewIndex(i)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 min-h-10 pointer-coarse:min-h-11 py-2 text-left text-[13px] pointer-coarse:text-[15px] transition-colors hover:bg-ui-fill',
                  i > 0 && 'border-t border-ui-sep',
                  i === viewIndex ? 'text-ui-accent font-semibold' : 'text-ui-text',
                )}
              >
                <span className="flex-1">{i + 1}. {v.label}</span>
                {i === viewIndex && <Check className="w-4 h-4 shrink-0" />}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-[12px] bg-ui-card p-3.5 space-y-2.5">
          <div className="text-[11px] font-semibold text-ui-accent">On the page · {view.label}</div>
          <p className="text-[13px] pointer-coarse:text-[15px] leading-relaxed">{view.text}</p>
          <div className="flex flex-wrap gap-1.5">
            {view.look.map(r => (
              <span key={r} className="rounded-full bg-ui-yellow/25 px-2.5 py-0.5 text-[11px] pointer-coarse:text-[13px] font-mono font-semibold text-ui-text">{r}</span>
            ))}
          </div>
          <p className="text-[11px] pointer-coarse:text-[12px] text-ui-text-2 leading-snug">
            Highlighted rows are the ones to watch. New events arrive at the right edge; the pause button on the trace holds one.
          </p>
        </div>

        <p className="text-[11px] text-ui-text-2 leading-snug">Source: {lesson.basis}</p>
      </div>

      <div className="ui-material px-4 pt-2.5 pb-3 border-t border-ui-sep space-y-1 pb-safe">
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1"
            disabled={lessonIndex === 0} onClick={() => goLesson(lessonIndex - 1)}>
            <ChevronLeft /> Previous
          </Button>
          <Button className="flex-1"
            disabled={lessonIndex === LESSONS.length - 1} onClick={() => goLesson(lessonIndex + 1)}>
            Next <ChevronRight />
          </Button>
        </div>
        <Button variant="ghost" className="w-full" onClick={onClose}>
          Exit lessons <span className="ml-1 text-[11px] font-normal text-ui-text-3 pointer-coarse:hidden">Esc</span>
        </Button>
      </div>
    </div>
  );
}
