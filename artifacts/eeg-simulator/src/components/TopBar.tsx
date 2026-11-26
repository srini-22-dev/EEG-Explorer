import React, { useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { MONTAGES } from '../utils/montages';
import {
  SPEED_VALUES, SENSITIVITY_VALUES, LOW_CUT_VALUES, HIGH_CUT_VALUES, NOTCH_HZ,
  type Speed, type Sensitivity, type FilterSettings, type ConditionLevel,
} from '../utils/simTypes';
import { CONDITION_LEVELS, RECIPES } from '../utils/recordingConditions';
import { INFO_TRIGGER_ATTR } from './InfoPanel';

/**
 * The reading controls, as on an EEG review station's toolbar: what the page is
 * drawn with (montage, sensitivity, paper speed) and what it is filtered with (low
 * cut, high cut, notch). They sit above the trace because a reader changes them
 * while looking at it (owner, 2026-11-16); the left panel keeps what is on the page.
 */

/** A labelled native dropdown. Mouse-wheel over it steps through the options; the
 *  listener is native and non-passive so it can stop the page scrolling. */
function WheelSelect<T extends string | number>({
  label, value, options, format, onChange, wide,
}: {
  label: string; value: T; options: readonly T[]; format: (v: T) => string;
  onChange: (v: T) => void; wide?: boolean;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const i = options.indexOf(value);
      const next = i + (e.deltaY > 0 ? 1 : -1);
      if (next >= 0 && next < options.length) onChange(options[next]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [value, options, onChange]);
  return (
    <label className="flex flex-col gap-0.5 shrink-0">
      <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest">{label}</span>
      <select
        ref={ref}
        value={String(value)}
        onChange={(e) => onChange(options.find(o => String(o) === e.target.value)!)}
        className={`${wide ? 'w-52' : 'w-24'} py-1 px-1.5 rounded text-[11px] font-mono border border-slate-700 bg-slate-900 text-emerald-300 hover:bg-slate-800 focus:outline-none focus:border-emerald-600 cursor-pointer`}>
        {options.map(o => <option key={String(o)} value={String(o)}>{format(o)}</option>)}
      </select>
    </label>
  );
}

const MONTAGE_IDS = Object.keys(MONTAGES);
const hz = (v: number) => `${v} Hz`;

/** The "i" beside a control: opens the information panel on `id`, or closes it. */
function InfoButton({ id, about, infoId, onShowInfo }: {
  id: string; about: string; infoId: string | null; onShowInfo: (id: string | null) => void;
}) {
  return (
    <button
      {...{ [INFO_TRIGGER_ATTR]: '' }}
      onClick={() => onShowInfo(infoId === id ? null : id)}
      aria-label={`About ${about}`}
      title={`About ${about}`}
      className={`shrink-0 self-end mb-1.5 rounded p-0.5 transition-colors ${
        infoId === id ? 'text-emerald-300 bg-emerald-800/50' : 'text-slate-500 hover:text-slate-300'
      }`}>
      <Info className="w-3 h-3" />
    </button>
  );
}

type Props = {
  montageId: string; setMontageId: (id: string) => void;
  sensitivity: Sensitivity; setSensitivity: (v: Sensitivity) => void;
  speed: Speed; setSpeed: (v: Speed) => void;
  filters: FilterSettings; setFilters: (f: FilterSettings) => void;
  conditions: ConditionLevel; setConditions: (l: ConditionLevel) => void;
  /** The page has been changed by hand since the level was chosen. */
  conditionsEdited: boolean;
  infoId: string | null; onShowInfo: (id: string | null) => void;
  showResp: boolean; setShowResp: (v: boolean) => void;
};

export function TopBar({
  montageId, setMontageId, sensitivity, setSensitivity, speed, setSpeed, filters, setFilters,
  conditions, setConditions, conditionsEdited, infoId, onShowInfo, showResp, setShowResp,
}: Props) {
  const divider = <div className="w-px self-stretch bg-[#2e4a2e]" />;
  return (
    // Wraps rather than scrolls: scrolling hid Recording conditions off the right edge
    // at 1440 px and below.
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1 px-3 py-1.5 bg-[#1e2a1e] border-b border-[#2e4a2e] text-slate-200 flex-shrink-0">
      <WheelSelect label="Montage" value={montageId} options={MONTAGE_IDS} wide
        format={id => MONTAGES[id].name} onChange={setMontageId} />
      <label className="flex items-center gap-1.5 pb-1 cursor-pointer select-none shrink-0" title="A respiration row under the ECG, to check breathing and ventilator artifact against">
        <input type="checkbox" checked={showResp} onChange={e => setShowResp(e.target.checked)}
          className="accent-emerald-600 w-3.5 h-3.5 cursor-pointer" />
        <span className="text-[11px] font-mono text-emerald-300 whitespace-nowrap">Resp row</span>
      </label>
      {divider}
      <WheelSelect label="Sensitivity" value={sensitivity} options={SENSITIVITY_VALUES}
        format={v => `${v} µV/mm`} onChange={setSensitivity} />
      <WheelSelect label="Paper speed" value={speed} options={SPEED_VALUES}
        format={v => `${v} mm/s`} onChange={setSpeed} />
      {divider}
      <WheelSelect label="Low cut" value={filters.lowCutHz} options={LOW_CUT_VALUES}
        format={hz} onChange={v => setFilters({ ...filters, lowCutHz: v })} />
      <WheelSelect label="High cut" value={filters.highCutHz} options={HIGH_CUT_VALUES}
        format={hz} onChange={v => setFilters({ ...filters, highCutHz: v })} />
      <label className="flex items-center gap-1.5 pb-1 cursor-pointer select-none shrink-0">
        <input
          type="checkbox"
          checked={filters.notchHz != null}
          onChange={e => setFilters({ ...filters, notchHz: e.target.checked ? NOTCH_HZ : null })}
          className="accent-emerald-600 w-3.5 h-3.5 cursor-pointer"
        />
        <span className="text-[11px] font-mono text-emerald-300 whitespace-nowrap">Notch {NOTCH_HZ} Hz</span>
      </label>
      <InfoButton id="notch" about="the notch filter" infoId={infoId} onShowInfo={onShowInfo} />
      {divider}
      <WheelSelect label="Recording conditions" value={conditions} options={CONDITION_LEVELS} wide
        format={l => RECIPES[l].name + (l === conditions && conditionsEdited ? ' (edited)' : '')}
        onChange={setConditions} />
      <InfoButton id="conditions" about="recording conditions" infoId={infoId} onShowInfo={onShowInfo} />
    </div>
  );
}
