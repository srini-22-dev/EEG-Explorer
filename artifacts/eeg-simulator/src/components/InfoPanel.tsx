import React, { useEffect, useRef } from 'react';
import { X, BookOpen, Clock } from 'lucide-react';
import { PATTERN_CATEGORIES } from '../utils/patterns';
import { PATTERN_INFO } from '../utils/patternInfo';
import { PATTERN_GALLERY } from '../utils/patternGallery';
import { MONTAGES } from '../utils/montages';
import { CONDITION_LEVELS, RECIPES } from '../utils/recordingConditions';
import { NOTCH_HZ, type ConditionLevel } from '../utils/simTypes';

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

// The top bar's two "i" buttons open these instead of a toggle's entry.
const TOP_BAR_COLOR = '#34d399';

/** The notch filter: what it removes, why, and how this display applies it. */
const NOTCH_INFO: { title: string; text: string }[] = [
  { title: 'What it is', text: `A notch filter removes a narrow band around one frequency and leaves the rest of the record alone. Here it is ${NOTCH_HZ} Hz, the mains frequency in India, Europe and most of the world; the Americas use 60 Hz. Mains hum is picked up from nearby wiring, lights and equipment, and reaches the page mostly through electrodes with poor contact.` },
  { title: 'Why it is used', text: 'It takes the hum off the page, so the activity underneath can be read by eye or measured. It does not fix the cause: re-gelling the electrode does. Guidelines keep it off by default and use it only when other measures fail, because it can distort or blunt spikes, whose sharp peaks carry energy near the mains frequency.' },
  { title: 'How it is applied', text: 'In the amplifier hardware, as a real-time (causal) digital filter while the record is drawn, or offline as a zero-phase filter run forwards and backwards over a stored record. This display is drawn live, so its notch is causal. It is about 18 Hz wide (41 to 59 Hz for 50 Hz mains), as on a clinical recorder, so it also takes some muscle and the sharpest part of a spike with it. What it leaves is the hum\'s 100 Hz harmonic, which the high-cut filter mostly removes.' },
  { title: 'Try it', text: 'Choose ICU bedside under Recording conditions, look at the occipital rows, then switch the notch on.' },
];

function TopBarInfo({ title, kicker, children, onClose }: { title: string; kicker: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="relative px-5 pt-4 pb-3 border-b border-[#2e4a2e]" style={{ background: `linear-gradient(180deg, ${TOP_BAR_COLOR}1f, transparent)` }}>
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: TOP_BAR_COLOR }} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: TOP_BAR_COLOR }}>{kicker}</div>
            <h2 className="text-lg font-bold text-slate-100 leading-tight mt-0.5">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close information"
            className="shrink-0 rounded p-1 text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
    </>
  );
}

export function InfoPanel({ id, onClose, conditions }: { id: string; onClose: () => void; conditions: ConditionLevel }) {
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

  if (id === 'conditions' || id === 'notch') {
    return (
      <div ref={ref} className="w-full h-full flex flex-col bg-[#1a241a] text-slate-200 border-l border-[#2e4a2e] overflow-hidden">
        {id === 'notch' ? (
          <TopBarInfo kicker="Filters" title={`Notch filter (${NOTCH_HZ} Hz)`} onClose={onClose}>
            {NOTCH_INFO.map(s => (
              <section key={s.title} className="space-y-1.5">
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{s.title}</h3>
                <p className="text-[13px] leading-relaxed text-slate-300">{s.text}</p>
              </section>
            ))}
          </TopBarInfo>
        ) : (
          <TopBarInfo kicker="Artifacts" title="Recording conditions" onClose={onClose}>
            <p className="text-[13px] leading-relaxed text-slate-300">
              The setting the record was made in. Choosing one switches on the artifacts that setting brings, and they then
              come and go as a real patient's would. You can still change any artifact by hand afterwards.
            </p>
            {CONDITION_LEVELS.map(l => {
              const r = RECIPES[l];
              const current = l === conditions;
              return (
                <section key={l} className={`rounded-md border px-3 py-2.5 space-y-1 ${current ? 'border-emerald-600 bg-emerald-900/20' : 'border-[#2e4a2e]'}`}>
                  <h3 className="text-[12px] font-bold text-slate-100">
                    {r.name}{current && <span className="ml-2 text-[9px] font-semibold uppercase tracking-widest text-emerald-400">shown now</span>}
                  </h3>
                  <p className="text-[12px] leading-relaxed text-slate-300">{r.scope.setting}</p>
                  <p className="text-[12px] leading-relaxed text-slate-400"><span className="text-slate-500">What appears: </span>{r.scope.appears}</p>
                  <p className="text-[12px] leading-relaxed text-slate-400"><span className="text-slate-500">Good for: </span>{r.scope.learn}</p>
                </section>
              );
            })}
          </TopBarInfo>
        )}
      </div>
    );
  }

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
