import React, { useEffect, useRef } from 'react';
import { X, BookOpen, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
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
const TOP_BAR_COLOR = 'var(--ui-accent)';

/** The notch filter: what it removes, why, and how this display applies it. */
const NOTCH_INFO: { title: string; text: string }[] = [
  { title: 'What it is', text: `A notch filter removes a narrow band around one frequency and leaves the rest of the record alone. Here it is ${NOTCH_HZ} Hz, the mains frequency in India, Europe and most of the world; the Americas use 60 Hz. Mains hum is picked up from nearby wiring, lights and equipment, and reaches the page mostly through electrodes with poor contact.` },
  { title: 'Why it is used', text: 'It takes the hum off the page, so the activity underneath can be read by eye or measured. It does not fix the cause: re-gelling the electrode does. Guidelines keep it off by default and use it only when other measures fail, because it can distort or blunt spikes, whose sharp peaks carry energy near the mains frequency.' },
  { title: 'How it is applied', text: 'In the amplifier hardware, as a real-time (causal) digital filter while the record is drawn, or offline as a zero-phase filter run forwards and backwards over a stored record. This display is drawn live, so its notch is causal. It is about 18 Hz wide (41 to 59 Hz for 50 Hz mains), as on a clinical recorder, so it also takes some muscle and the sharpest part of a spike with it. What it leaves is the hum\'s 100 Hz harmonic, which the high-cut filter mostly removes.' },
  { title: 'Try it', text: 'Choose ICU bedside under Recording conditions, look at the occipital rows, then switch the notch on.' },
];

const BODY = 'text-[14px] pointer-coarse:text-[16px] leading-relaxed text-ui-text';

/** The panel's title: the category in its colour, the name, and a close button. */
function Header({ kicker, title, color, onClose }: { kicker: string; title: string; color: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-ui-sep">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color }}>
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />{kicker}
        </div>
        <h2 className="text-[20px] font-bold text-ui-text leading-tight mt-0.5">{title}</h2>
      </div>
      <button onClick={onClose} aria-label="Close information"
        className="grid place-items-center shrink-0 -mr-1 w-8 h-8 pointer-coarse:w-10 pointer-coarse:h-10 rounded-full">
        <span className="grid place-items-center w-[26px] h-[26px] rounded-full bg-ui-fill text-ui-text-2 hover:bg-ui-fill-2 transition-colors">
          <X className="w-3.5 h-3.5" strokeWidth={2.6} />
        </span>
      </button>
    </div>
  );
}

/**
 * Beside the trace on a desktop (a resizable panel), or rising from the bottom as a
 * sheet on a phone. Either way a tap outside it closes it.
 */
function Shell({ sheet, panelRef, children }: { sheet: boolean; panelRef: React.Ref<HTMLDivElement>; children: React.ReactNode }) {
  if (!sheet) {
    return (
      <div ref={panelRef} className="w-full h-full flex flex-col bg-ui-root text-ui-text border-l border-ui-sep overflow-hidden">
        {children}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/35 animate-in fade-in-0 duration-300" />
      <div ref={panelRef} role="dialog" aria-modal="true"
        className={cn('relative w-full max-w-[640px] max-h-[88dvh] flex flex-col rounded-t-[14px] bg-ui-root text-ui-text overflow-hidden shadow-[var(--ui-shadow)] animate-in slide-in-from-bottom duration-300')}>
        <div className="mx-auto mt-1.5 h-[5px] w-9 shrink-0 rounded-full bg-ui-fill-2" />
        {children}
      </div>
    </div>
  );
}

function TopBarInfo({ title, kicker, children, onClose }: { title: string; kicker: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <Header kicker={kicker} title={title} color={TOP_BAR_COLOR} onClose={onClose} />
      <div className="flex-1 overflow-y-auto ui-scroll px-5 py-4 space-y-4 pb-safe">{children}</div>
    </>
  );
}

export function InfoPanel({ id, onClose, conditions, sheet = false }: {
  id: string; onClose: () => void; conditions: ConditionLevel;
  /** Shown as a bottom sheet (the phone layout) rather than a side panel. */
  sheet?: boolean;
}) {
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
      <Shell sheet={sheet} panelRef={ref}>
        {id === 'notch' ? (
          <TopBarInfo kicker="Filters" title={`Notch filter (${NOTCH_HZ} Hz)`} onClose={onClose}>
            {NOTCH_INFO.map(s => (
              <section key={s.title} className="space-y-1.5">
                <h3 className="text-[13px] font-semibold text-ui-text">{s.title}</h3>
                <p className={BODY}>{s.text}</p>
              </section>
            ))}
          </TopBarInfo>
        ) : (
          <TopBarInfo kicker="Artifacts" title="Recording conditions" onClose={onClose}>
            <p className={BODY}>
              The setting the record was made in. Choosing one switches on the artifacts that setting brings, and they then
              come and go as a real patient's would. You can still change any artifact by hand afterwards.
            </p>
            {CONDITION_LEVELS.map(l => {
              const r = RECIPES[l];
              const current = l === conditions;
              return (
                <section key={l} className={`rounded-[12px] bg-ui-card px-3.5 py-3 space-y-1 ${current ? 'ring-2 ring-ui-accent' : ''}`}>
                  <h3 className="text-[14px] font-semibold text-ui-text">
                    {r.name}{current && <span className="ml-2 text-[11px] font-semibold text-ui-accent">Shown now</span>}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-ui-text">{r.scope.setting}</p>
                  <p className="text-[13px] leading-relaxed text-ui-text-2"><span className="font-medium">What appears: </span>{r.scope.appears}</p>
                  <p className="text-[13px] leading-relaxed text-ui-text-2"><span className="font-medium">Good for: </span>{r.scope.learn}</p>
                </section>
              );
            })}
          </TopBarInfo>
        )}
      </Shell>
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
    <Shell sheet={sheet} panelRef={ref}>
      <Header kicker={cat.name} title={pattern.name} color={color} onClose={onClose} />

      <div className="flex-1 overflow-y-auto ui-scroll px-5 py-4 space-y-5 pb-safe">
        {/* Example */}
        {shot && (
          <figure className="space-y-1.5">
            <div className="rounded-[10px] overflow-hidden border border-ui-sep bg-[#f6f4ea] flex">
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
            <figcaption className="text-[11px] text-ui-text-2 font-mono leading-snug">
              {STATE_NAME[shot.state] ?? shot.state} · {MONTAGES[shot.montage]?.name ?? shot.montage} · {shot.sensitivity} µV/mm · 30 mm/s · LFF {shot.lowCutHz} Hz · HFF {shot.highCutHz} Hz — drawn by this simulator
            </figcaption>
          </figure>
        )}

        {info ? (
          <>
            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ui-text">
                <BookOpen className="w-3.5 h-3.5" style={{ color }} /> What it is
              </h3>
              <p className={BODY}>{info.summary}</p>
            </section>
            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ui-text">
                <Clock className="w-3.5 h-3.5" style={{ color }} /> When you see it
              </h3>
              <p className={BODY}>{info.seenIn}</p>
            </section>
          </>
        ) : (
          <p className={BODY}>{pattern.desc}</p>
        )}
      </div>
    </Shell>
  );
}
