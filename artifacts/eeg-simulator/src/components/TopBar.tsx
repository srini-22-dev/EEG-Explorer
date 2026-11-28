import React, { useEffect, useRef } from 'react';
import { MONTAGES } from '../utils/montages';
import {
  SPEED_VALUES, SENSITIVITY_VALUES, LOW_CUT_VALUES, HIGH_CUT_VALUES, NOTCH_HZ,
  type Speed, type Sensitivity, type FilterSettings, type ConditionLevel,
} from '../utils/simTypes';
import { CONDITION_LEVELS, RECIPES } from '../utils/recordingConditions';
import { Switch } from '@/components/ui/switch';
import { Group, Row, SelectMenu, InfoButton } from '@/components/ui/ios';

/**
 * The reading controls, as on an EEG review station's toolbar: what the page is
 * drawn with (montage, sensitivity, paper speed) and what it is filtered with (low
 * cut, high cut, notch). They sit above the trace because a reader changes them
 * while looking at it (owner, 2026-11-16); the left panel keeps what is on the page.
 * On a phone the same controls are a grouped list in the Recording sheet.
 */

/** A labelled pop-up menu. Mouse-wheel over it steps through the options; the
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
      <span className="pl-1 text-[10px] font-medium text-ui-text-2">{label}</span>
      <SelectMenu selectRef={ref} ariaLabel={label} value={value} options={options} format={format}
        onChange={onChange} className={wide ? 'w-52' : 'w-[92px]'} />
    </label>
  );
}

const MONTAGE_IDS = Object.keys(MONTAGES);
const hz = (v: number) => `${v} Hz`;

/** A small labelled switch for the toolbar. */
function ToolbarSwitch({ label, checked, onChange, title }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; title?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 shrink-0 cursor-pointer select-none" title={title}>
      <span className="pl-1 text-[10px] font-medium text-ui-text-2">{label}</span>
      <span className="h-7 flex items-center px-1">
        <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
      </span>
    </label>
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

const RESP_TITLE = 'A respiration row under the ECG, to check breathing and ventilator artifact against';
const conditionName = (l: ConditionLevel, current: ConditionLevel, edited: boolean) =>
  RECIPES[l].name + (l === current && edited ? ' (edited)' : '');

export function TopBar({
  montageId, setMontageId, sensitivity, setSensitivity, speed, setSpeed, filters, setFilters,
  conditions, setConditions, conditionsEdited, infoId, onShowInfo, showResp, setShowResp,
}: Props) {
  const divider = <div className="w-px self-stretch my-1 bg-ui-sep" />;
  const info = (id: string, about: string) => (
    <InfoButton about={about} active={infoId === id} onClick={() => onShowInfo(infoId === id ? null : id)} className="self-end" />
  );
  return (
    // Wraps rather than scrolls: scrolling hid Recording conditions off the right edge
    // at 1440 px and below.
    <div className="ui-material relative z-20 flex flex-wrap items-end gap-x-3 gap-y-1.5 px-3 pt-1.5 pb-2 border-b border-ui-sep text-ui-text flex-shrink-0">
      <WheelSelect label="Montage" value={montageId} options={MONTAGE_IDS} wide
        format={id => MONTAGES[id].name} onChange={setMontageId} />
      <ToolbarSwitch label="Resp row" checked={showResp} onChange={setShowResp} title={RESP_TITLE} />
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
      <ToolbarSwitch label={`Notch ${NOTCH_HZ} Hz`} checked={filters.notchHz != null}
        onChange={on => setFilters({ ...filters, notchHz: on ? NOTCH_HZ : null })} />
      {info('notch', 'the notch filter')}
      {divider}
      <WheelSelect label="Recording conditions" value={conditions} options={CONDITION_LEVELS} wide
        format={l => conditionName(l, conditions, conditionsEdited)} onChange={setConditions} />
      {info('conditions', 'recording conditions')}
    </div>
  );
}

/** The same controls as a grouped list, for the phone's Recording sheet. */
export function RecordingList({
  montageId, setMontageId, sensitivity, setSensitivity, speed, setSpeed, filters, setFilters,
  conditions, setConditions, conditionsEdited, infoId, onShowInfo, showResp, setShowResp,
}: Props) {
  const menu = 'max-w-[58%]';
  return (
    <>
      <Group title="Page">
        <Row label="Montage">
          <SelectMenu className={menu} ariaLabel="Montage" value={montageId} options={MONTAGE_IDS}
            format={id => MONTAGES[id].name} onChange={setMontageId} />
        </Row>
        <Row label="Respiration row" sub="Under the ECG, to check breathing artifact against" htmlFor="resp-row">
          <Switch id="resp-row" checked={showResp} onCheckedChange={setShowResp} />
        </Row>
        <Row label="Sensitivity">
          <SelectMenu ariaLabel="Sensitivity" value={sensitivity} options={SENSITIVITY_VALUES}
            format={v => `${v} µV/mm`} onChange={setSensitivity} />
        </Row>
        <Row label="Paper speed">
          <SelectMenu ariaLabel="Paper speed" value={speed} options={SPEED_VALUES}
            format={v => `${v} mm/s`} onChange={setSpeed} />
        </Row>
      </Group>
      <Group title="Filters">
        <Row label="Low cut">
          <SelectMenu ariaLabel="Low cut" value={filters.lowCutHz} options={LOW_CUT_VALUES}
            format={hz} onChange={v => setFilters({ ...filters, lowCutHz: v })} />
        </Row>
        <Row label="High cut">
          <SelectMenu ariaLabel="High cut" value={filters.highCutHz} options={HIGH_CUT_VALUES}
            format={hz} onChange={v => setFilters({ ...filters, highCutHz: v })} />
        </Row>
        <Row label={`Notch ${NOTCH_HZ} Hz`}>
          <InfoButton about="the notch filter" active={infoId === 'notch'} onClick={() => onShowInfo(infoId === 'notch' ? null : 'notch')} />
          <Switch aria-label={`Notch ${NOTCH_HZ} Hz`} checked={filters.notchHz != null}
            onCheckedChange={on => setFilters({ ...filters, notchHz: on ? NOTCH_HZ : null })} />
        </Row>
      </Group>
      <Group title="Recording conditions" footer="The setting the record was made in: it brings the artifacts that setting has, coming and going over time.">
        <Row label="Setting">
          <InfoButton about="recording conditions" active={infoId === 'conditions'} onClick={() => onShowInfo(infoId === 'conditions' ? null : 'conditions')} />
          <SelectMenu className={menu} ariaLabel="Recording conditions" value={conditions} options={CONDITION_LEVELS}
            format={l => conditionName(l, conditions, conditionsEdited)} onChange={setConditions} />
        </Row>
      </Group>
    </>
  );
}
