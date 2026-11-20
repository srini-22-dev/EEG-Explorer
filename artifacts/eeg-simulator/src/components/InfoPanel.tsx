import React, { useEffect, useRef } from 'react';
import { X, BookOpen, Clock } from 'lucide-react';
import { PATTERN_CATEGORIES } from '../utils/patterns';
import { PATTERN_INFO } from '../utils/patternInfo';
import { PATTERN_GALLERY } from '../utils/patternGallery.generated';
import { MONTAGES } from '../utils/montages';

/**
 * The information panel for one toggle (owner, 2026-11-16): its name, an example
 * of it drawn by this simulator, what it is, and where it is seen. Opened from the
 * info icon beside a toggle, and closed by clicking anywhere else — an info icon
 * excepted, which switches the panel to that toggle instead.
 */

// renderTrace's label strip and horizontal scale (scripts/src/renderTrace.ts).
const STRIP_PX = 70;
const PX_PER_SEC = 120;

const STATE_NAME: Record<string, string> = {
  awake: 'Awake', drowsy: 'Drowsy', n1: 'N1', n2: 'N2', n3: 'N3', rem: 'REM',
};

/** Marks an element whose click opens or switches the panel rather than closing it. */
export const INFO_TRIGGER_ATTR = 'data-info-trigger';

export function InfoPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el || ref.current?.contains(el) || el.closest(`[${INFO_TRIGGER_ATTR}]`)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const cat = PATTERN_CATEGORIES.find(c => c.patterns.some(p => p.id === id));
  const pattern = cat?.patterns.find(p => p.id === id);
  const info = PATTERN_INFO[id];
  const shot = PATTERN_GALLERY[id];
  if (!cat || !pattern) return null;
  const color = cat.color;
  // The image's own strip carries only row numbers, so it is cropped off and the
  // montage's labels are set in a column beside the trace instead.
  const traceW = shot ? shot.seconds * PX_PER_SEC : 1;
  const imgScale = (STRIP_PX + traceW) / traceW;

  return (
    <div ref={ref} className="w-full h-full flex flex-col bg-[#1a241a] text-slate-200 border-l border-[#2e4a2e] overflow-hidden">
      {/* Header */}
      <div className="relative px-5 pt-4 pb-3 border-b border-[#2e4a2e]" style={{ background: `linear-gradient(180deg, ${color}1f, transparent)` }}>
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color }}>{cat.name}</div>
            <h2 className="text-lg font-bold text-slate-100 leading-tight mt-0.5">{pattern.name}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close information"
            className="shrink-0 rounded p-1 text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Example */}
        {shot && (
          <figure className="space-y-1.5">
            <div className="rounded-md overflow-hidden border border-[#2e4a2e] bg-[#f6f4ea] flex">
              <div className="relative shrink-0 w-12 bg-[#ecebe1] border-r border-[#d6d3c4]">
                {shot.rows.map(r => (
                  <span
                    key={r.label}
                    className="absolute left-1 -translate-y-1/2 text-[8px] leading-none font-mono font-semibold text-slate-600 whitespace-nowrap"
                    style={{ top: `${r.y * 100}%` }}>
                    {r.label}
                  </span>
                ))}
              </div>
              <div className="relative flex-1 overflow-hidden">
                <img
                  src={`${import.meta.env.BASE_URL}${shot.file}`}
                  alt={`${pattern.name}, as drawn by this simulator`}
                  className="block max-w-none"
                  style={{ width: `${imgScale * 100}%`, marginLeft: `${-(imgScale - 1) * 100}%` }}
                />
              </div>
            </div>
            <figcaption className="text-[10px] text-slate-500 font-mono">
              {STATE_NAME[shot.state] ?? shot.state} · {MONTAGES[shot.montage]?.name ?? shot.montage} · {shot.sensitivity} µV/mm · 30 mm/s · LFF {shot.lowCutHz} Hz · HFF {shot.highCutHz} Hz — drawn by this simulator
            </figcaption>
          </figure>
        )}

        {info ? (
          <>
            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                <BookOpen className="w-3 h-3" style={{ color }} /> What it is
              </h3>
              <p className="text-[13px] leading-relaxed text-slate-300">{info.summary}</p>
            </section>
            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                <Clock className="w-3 h-3" style={{ color }} /> When you see it
              </h3>
              <p className="text-[13px] leading-relaxed text-slate-300">{info.seenIn}</p>
            </section>
          </>
        ) : (
          <p className="text-[13px] leading-relaxed text-slate-300">{pattern.desc}</p>
        )}
      </div>
    </div>
  );
}
