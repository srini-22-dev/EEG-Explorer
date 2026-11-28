/**
 * The interface's building blocks, after Apple's Human Interface Guidelines: inset
 * grouped lists, rows with a trailing control, segmented controls, sliders, pop-up
 * menus and sheets. Each grows to a 44 pt touch target on a touch screen
 * (`pointer-coarse:`) and stays compact with a mouse, so one set of components
 * serves the desktop sidebar and the phone's sheets.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { INFO_TRIGGER_ATTR } from '../InfoPanel';

/** An inset grouped list: a header above, rounded cells, a footnote below. */
export function Group({
  title, trailing, footer, children, className, plain = false,
}: {
  title?: React.ReactNode; trailing?: React.ReactNode; footer?: React.ReactNode;
  children: React.ReactNode; className?: string;
  /** Children are laid out freely inside the card instead of as rows. */
  plain?: boolean;
}) {
  return (
    <section className={cn('px-4 pt-5', className)}>
      {(title || trailing) && (
        <div className="flex items-center justify-between px-3 pb-1.5 min-h-5">
          {title && <h2 className="text-[12px] pointer-coarse:text-[13px] font-semibold text-ui-text-2">{title}</h2>}
          {trailing}
        </div>
      )}
      <div className={cn('rounded-[10px] bg-ui-card overflow-hidden', plain && 'p-3')}>{children}</div>
      {footer && <p className="px-3 pt-1.5 text-[11px] pointer-coarse:text-[12px] leading-snug text-ui-text-2">{footer}</p>}
    </section>
  );
}

/** One row of a Group: an optional icon, a label (and a line under it), and a trailing control. */
export function Row({
  icon, label, sub, children, onClick, htmlFor, className, labelClassName,
}: {
  icon?: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode;
  onClick?: () => void; htmlFor?: string; className?: string; labelClassName?: string;
}) {
  // The separator above a row starts after its icon, as in iOS.
  const body = (
    <div className={cn(
      'flex items-center gap-3 min-h-9 pointer-coarse:min-h-11 py-1.5 pr-3',
      'border-t border-ui-sep group-first/row:border-t-0',
    )}>
      <div className="flex-1 min-w-0">
        {htmlFor
          ? <label htmlFor={htmlFor} className={cn('block text-[13px] pointer-coarse:text-[16px] text-ui-text cursor-pointer leading-tight', labelClassName)}>{label}</label>
          : <div className={cn('text-[13px] pointer-coarse:text-[16px] text-ui-text leading-tight', labelClassName)}>{label}</div>}
        {sub && <div className="mt-0.5 text-[11px] pointer-coarse:text-[13px] text-ui-text-2 leading-snug">{sub}</div>}
      </div>
      {children}
    </div>
  );
  const cls = cn('group/row flex items-center gap-3 pl-3', className);
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(cls, 'w-full text-left hover:bg-ui-fill active:bg-ui-fill-2 transition-colors')}>
        {icon}
        <div className="flex-1 min-w-0">{body}</div>
      </button>
    );
  }
  return (
    <div className={cls}>
      {icon}
      <div className="flex-1 min-w-0">{body}</div>
    </div>
  );
}

/** A coloured rounded square with a white glyph, as in iOS Settings. */
export function IconTile({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="grid place-items-center shrink-0 w-[26px] h-[26px] pointer-coarse:w-[29px] pointer-coarse:h-[29px] rounded-[7px] text-white [&_svg]:w-[15px] [&_svg]:h-[15px] pointer-coarse:[&_svg]:w-[17px] pointer-coarse:[&_svg]:h-[17px]"
      style={{ background: color }}>
      {children}
    </span>
  );
}

/** A small caption above a control inside a row. */
export function Caption({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] pointer-coarse:text-[13px] font-medium text-ui-text-2">{children}</span>
      {trailing}
    </div>
  );
}

/** The iOS segmented control: one of a few choices, the chosen one on a raised thumb. */
export function Segmented<T extends string | number | boolean>({
  value, options, onChange, ariaLabel, className,
}: {
  value: T; options: readonly { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void; ariaLabel?: string; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className={cn('flex w-full rounded-[9px] bg-ui-fill p-[2px] gap-[2px]', className)}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex-1 min-w-0 truncate rounded-[7px] px-1.5 h-7 pointer-coarse:h-8 text-[12px] pointer-coarse:text-[13px] font-medium transition-all duration-150',
              on ? 'bg-ui-thumb text-ui-text shadow-[0_3px_8px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.08)] font-semibold'
                : 'text-ui-text-2 hover:text-ui-text',
            )}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A pill that toggles on and off, for choices where several may be on at once. */
export function Chip({
  on, children, title, onClick, resting = false, disabled = false, role = 'checkbox',
}: {
  on: boolean; children: React.ReactNode; title?: string; onClick: () => void;
  /** Chosen, but not active this moment (a recording level is resting it). */
  resting?: boolean; disabled?: boolean; role?: 'checkbox' | 'radio';
}) {
  return (
    <button type="button" role={role} aria-checked={on} title={title} onClick={onClick} disabled={disabled}
      className={cn(
        'flex-1 min-w-0 truncate rounded-full px-2.5 h-7 pointer-coarse:h-9 text-[12px] pointer-coarse:text-[14px] font-medium transition-colors duration-200 disabled:opacity-40',
        on && resting ? 'border border-dashed border-ui-accent/60 text-ui-accent/70'
          : on ? 'bg-ui-accent text-ui-on-accent'
            : 'bg-ui-fill text-ui-text-2 hover:bg-ui-fill-2 hover:text-ui-text',
      )}>
      {children}
    </button>
  );
}

/** A slider: an iOS track filled up to the thumb. */
export function Range({
  value, min, max, step, onChange, disabled, ariaLabel, color, title, className,
}: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void;
  disabled?: boolean; ariaLabel?: string; color?: string; title?: string; className?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      aria-label={ariaLabel} title={title}
      onChange={e => onChange(parseFloat(e.target.value))}
      className={cn('ui-range', className)}
      style={{ '--pct': `${Math.min(100, Math.max(0, pct))}%`, ...(color ? { '--fill': color } : {}) } as React.CSSProperties} />
  );
}

/** A native pop-up menu drawn as an Apple pop-up button: the value and an up-down chevron. */
export function SelectMenu<T extends string | number>({
  value, options, format, onChange, ariaLabel, className, title, selectRef,
}: {
  value: T; options: readonly T[]; format: (v: T) => string; onChange: (v: T) => void;
  ariaLabel?: string; className?: string; title?: string;
  selectRef?: React.Ref<HTMLSelectElement>;
}) {
  return (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <select ref={selectRef} aria-label={ariaLabel} title={title} value={String(value)}
        onChange={e => onChange(options.find(o => String(o) === e.target.value)!)}
        className="w-full min-w-0 appearance-none truncate rounded-[8px] bg-ui-fill hover:bg-ui-fill-2 pl-2.5 pr-7 h-7 pointer-coarse:h-9 text-[12px] pointer-coarse:text-[16px] font-medium text-ui-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-accent/50 transition-colors">
        {options.map(o => <option key={String(o)} value={String(o)}>{format(o)}</option>)}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ui-text-2" />
    </span>
  );
}

/** The ⓘ beside a control: opens its information, or closes it when it is the open one. */
export function InfoButton({ about, active, onClick, className }: {
  about: string; active: boolean; onClick: () => void; className?: string;
}) {
  return (
    <button type="button" {...{ [INFO_TRIGGER_ATTR]: '' }} onClick={onClick}
      aria-label={`About ${about}`} title={`About ${about}`} aria-pressed={active}
      className={cn(
        'grid place-items-center shrink-0 rounded-full w-7 h-7 pointer-coarse:w-10 pointer-coarse:h-10 transition-colors',
        active ? 'text-ui-on-accent [&>span]:bg-ui-accent' : 'text-ui-accent hover:[&>span]:bg-ui-accent/12',
        className,
      )}>
      <span className="grid place-items-center rounded-full w-6 h-6 pointer-coarse:w-7 pointer-coarse:h-7">
        <Info className="w-[17px] h-[17px] pointer-coarse:w-5 pointer-coarse:h-5" strokeWidth={2} />
      </span>
    </button>
  );
}

/**
 * A sheet that rises from the bottom of the screen (the phone layout's controls,
 * information and panels). Done, Escape, a tap on the dimmed page or a swipe down
 * on its grabber closes it.
 */
export function Sheet({
  open, onClose, title, children, tall = false, fill = false,
}: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode;
  /** Full height rather than fitted to its content. */
  tall?: boolean;
  /** The content fills the sheet and scrolls itself (it has a pinned footer of its own). */
  fill?: boolean;
}) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  useEffect(() => { if (!open) setDrag(0); }, [open]);
  if (!open) return null;
  const onDown = (e: React.PointerEvent) => { start.current = e.clientY; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: React.PointerEvent) => { if (start.current != null) setDrag(Math.max(0, e.clientY - start.current)); };
  const onUp = () => { if (start.current == null) return; start.current = null; if (drag > 90) onClose(); else setDrag(0); };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/35 animate-in fade-in-0 duration-300" onClick={onClose} />
      <div
        className={cn(
          'relative w-full max-w-[640px] flex flex-col rounded-t-[14px] bg-ui-root shadow-[var(--ui-shadow)] animate-in slide-in-from-bottom duration-300 ease-out',
          tall ? 'h-[calc(100dvh-env(safe-area-inset-top)-12px)]' : 'max-h-[calc(100dvh-env(safe-area-inset-top)-12px)]',
        )}
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: drag ? 'none' : undefined }}
      >
        <div className="shrink-0 touch-none cursor-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="mx-auto mt-1.5 h-[5px] w-9 rounded-full bg-ui-fill-2" />
          <div className="relative flex items-center justify-center h-11 px-14">
            <h2 className="text-[16px] font-semibold text-ui-text truncate">{title}</h2>
            <button type="button" onClick={onClose} onPointerDown={e => e.stopPropagation()}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-2.5 text-[16px] font-semibold text-ui-accent">
              Done
            </button>
          </div>
        </div>
        {fill ? (
          <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto ui-scroll pb-safe">
            {children}
            <div className="h-5" />
          </div>
        )}
      </div>
    </div>
  );
}

/** A round close button for panels: an × on a gray disc. */
export function CloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="grid place-items-center shrink-0 w-8 h-8 pointer-coarse:w-10 pointer-coarse:h-10 rounded-full">
      <span className="grid place-items-center w-[26px] h-[26px] rounded-full bg-ui-fill text-ui-text-2 hover:bg-ui-fill-2 transition-colors">
        <X className="w-3.5 h-3.5" strokeWidth={2.6} />
      </span>
    </button>
  );
}
