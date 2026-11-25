/**
 * Contextual controls for the artifact toggles.
 *
 * An artifact is never one fixed thing: it is a specific muscle contracting, a
 * specific electrode losing contact, a specific mains supply. Hiding that behind
 * one on/off switch makes every artifact look like a single canned effect, when
 * recognising *which* one is present — and where — is the clinical skill being
 * taught. So each toggle reveals only its own controls, and only while it is on,
 * exactly as the ictal toggles reveal hemisphere and intensity.
 */

import React from 'react';
import { Label } from '@/components/ui/label';
import type { ArtifactParams, EmgRegion } from '../utils/simTypes';
import type { LiveArtifacts } from '../engine/engine';
import { POP_TARGET_ANY } from '../utils/simTypes';
import { electrodePositions3D } from '../utils/electrodePositions3D';
import { ALL_ELECTRODES } from '../utils/montages';

/** Same list the leadfield is built from, so every selectable electrode exists in the engine. */
const ELECTRODES = Object.keys(electrodePositions3D);

const EMG_REGIONS: { id: EmgRegion; label: string; hint: string }[] = [
  { id: 'temporalisL', label: 'Temporalis L', hint: 'Left jaw muscle — maximal at T3/F7.' },
  { id: 'temporalisR', label: 'Temporalis R', hint: 'Right jaw muscle — maximal at T4/F8.' },
  { id: 'frontalis',   label: 'Frontalis',    hint: 'Brow tension — maximal at Fp1/Fp2.' },
  { id: 'nuchal',      label: 'Nuchal',       hint: 'Posterior neck muscles — buries the posterior rhythm at O1/O2, T5/T6.' },
];

const LABEL_CLASS = 'text-[10px] text-slate-500 uppercase tracking-wider';

function Slider({
  label, value, min, max, step, unit, onChange, disabled = false, offAtMin = false, live,
}: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; onChange: (v: number) => void; disabled?: boolean; offAtMin?: boolean;
  /** The value in effect now, when a recording level moves it: the thumb follows it, and the setting is shown beside it. */
  live?: number;
}) {
  const fmt = (v: number) => `${step < 1 ? v.toFixed(step < 0.1 ? 2 : 1) : Math.round(v)}${unit}`;
  const shown = live != null ? Math.min(max, Math.max(min, live)) : value;
  return (
    <div className={`space-y-1 ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex justify-between items-center">
        <Label className={LABEL_CLASS}>{label}</Label>
        <span className="text-[10px] font-mono text-orange-400">
          {offAtMin && value <= min ? 'off'
            : live != null ? <>{fmt(live)} <span className="text-slate-500">now · set {fmt(value)}</span></> : fmt(value)}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={shown} disabled={disabled}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-orange-500 disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** A small pressed/unpressed button, used for the multi-select and enum controls. */
function Chip({
  on, label, title, onClick, resting = false,
}: {
  on: boolean; label: string; title?: string; onClick: () => void;
  /** Selected, but not active this moment (a recording level's muscle episode uses others, or none). */
  resting?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 py-1 px-1 rounded text-[10px] font-mono border transition-colors duration-300 ${
        on && resting
          ? 'border-orange-800 border-dashed text-orange-300/50'
          : on
            ? 'bg-orange-800/40 border-orange-600 text-orange-300'
            : 'border-slate-700 text-slate-500 hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  );
}

export function ArtifactControls({
  id, params, update, live = null,
}: {
  id: string;
  params: ArtifactParams;
  update: (patch: Partial<ArtifactParams>) => void;
  /** What the artifacts are doing now; under a recording level the controls follow it. */
  live?: LiveArtifacts | null;
}) {
  const lv = live?.level ? live : null;
  const wrap = (children: React.ReactNode) => (
    <div className="pt-2 pb-1 pl-1 space-y-2">{children}</div>
  );

  switch (id) {
    case 'blink':
      return wrap(
        <Slider
          label="Blink rate" value={params.blinkRatePerMin} min={2} max={40} step={1} unit="/min"
          live={lv?.blinkRate}
          onChange={v => update({ blinkRatePerMin: v })}
        />,
      );

    case 'eye-movement':
      return wrap(
        <Slider
          label="Saccade rate" value={params.saccadeRatePerMin} min={4} max={60} step={1} unit="/min"
          live={lv?.saccadeRate}
          onChange={v => update({ saccadeRatePerMin: v })}
        />,
      );

    case 'muscle': {
      const regions = params.emgRegions;
      const toggleRegion = (r: EmgRegion) =>
        update({
          emgRegions: regions.includes(r) ? regions.filter(x => x !== r) : [...regions, r],
        });
      return wrap(
        <>
          <div className="space-y-1">
            <Label className={LABEL_CLASS}>Muscle group</Label>
            <div className="grid grid-cols-2 gap-1">
              {EMG_REGIONS.map(r => (
                <Chip
                  key={r.id} on={regions.includes(r.id)} label={r.label} title={r.hint}
                  resting={!!lv && !(lv.emgOn && !!lv.emgRegions?.includes(r.id))}
                  onClick={() => toggleRegion(r.id)}
                />
              ))}
            </div>
          </div>
          <Slider
            label="Severity" value={params.emgSeverity} min={0.25} max={3} step={0.05} unit="×"
            live={lv ? (lv.emgOn ? lv.emgSeverity : 0.25) : undefined}
            onChange={v => update({ emgSeverity: v })}
          />
          {regions.length === 0 && (
            <p className="text-[10px] text-slate-600 leading-snug">
              No muscle selected — the toggle is on but nothing is contracting.
            </p>
          )}
        </>,
      );
    }

    case 'electrode-pop': {
      const detached = params.detachedElectrodes;
      const target = params.popTarget;
      const targeted = target !== POP_TARGET_ANY;
      const isDetached = detached.includes(target);
      const setDetached = (next: string[]) => update({ detachedElectrodes: next });
      return wrap(
        <>
          <div className="space-y-1">
            <Label className={LABEL_CLASS}>Electrode</Label>
            <select
              value={target}
              onChange={e => update({ popTarget: e.target.value })}
              className="w-full bg-[#192219] border border-[#2e4a2e] rounded px-2 py-1 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-orange-700"
            >
              <option value={POP_TARGET_ANY}>Any electrode (random)</option>
              {ELECTRODES.map(n => (
                <option key={n} value={n}>{n}{detached.includes(n) ? ' — detached' : ''}</option>
              ))}
            </select>
          </div>
          {/* Automatic popping: an unstable-but-attached electrode firing repeated
              transients. 0 = off (manual pops still work). Meaningless once the
              electrode is flat, so it grays out while the selection is detached. */}
          <Slider
            label="Pop rate" value={params.popRatePerMin} min={0} max={6} step={0.1} unit="/min"
            live={lv?.popRate}
            offAtMin disabled={isDetached}
            onChange={v => update({ popRatePerMin: v })}
          />
          {/* Manual pop: one discrete transient on the selected electrode (random
              if "any"), the electrode staying attached. */}
          <button
            disabled={targeted && isDetached}
            onClick={() => update({ manualPopNonce: params.manualPopNonce + 1 })}
            className={`w-full py-1 rounded text-[11px] font-mono border transition-colors ${
              targeted && isDetached
                ? 'border-slate-800 text-slate-700 cursor-not-allowed'
                : 'bg-amber-800/40 border-amber-600 text-amber-300 hover:bg-amber-800/60'
            }`}
          >
            {targeted
              ? isDetached ? `${target} is detached` : `Pop ${target}`
              : 'Pop random electrode'}
          </button>
          {/* Disconnection: contact breaks (one pop) and the channel goes flat until
              reattached — a different finding from a pop, hence its own button. */}
          <button
            disabled={!targeted}
            onClick={() =>
              setDetached(isDetached ? detached.filter(n => n !== target) : [...detached, target])
            }
            className={`w-full py-1 rounded text-[11px] font-mono border transition-colors ${
              !targeted
                ? 'border-slate-800 text-slate-700 cursor-not-allowed'
                : isDetached
                  ? 'bg-emerald-800/40 border-emerald-600 text-emerald-300 hover:bg-emerald-800/60'
                  : 'bg-orange-800/40 border-orange-600 text-orange-300 hover:bg-orange-800/60'
            }`}
          >
            {!targeted ? 'Pick an electrode to disconnect'
              : isDetached ? `Reattach ${target}`
              : `Disconnect ${target} (pop, then flat)`}
          </button>
          {detached.length > 0 && (
            <div className="space-y-1">
              <Label className={LABEL_CLASS}>Detached</Label>
              <div className="flex flex-wrap gap-1">
                {detached.map(n => (
                  <button
                    key={n}
                    onClick={() => setDetached(detached.filter(x => x !== n))}
                    title={`Reattach ${n}`}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-orange-700 bg-orange-900/40 text-orange-300 hover:bg-orange-900/70"
                  >
                    {n} &times;
                  </button>
                ))}
              </div>
              {/*
                Stated rather than left to be discovered, because the montage
                changes what "flat" looks like and the bipolar case is the one
                that catches readers out.
              */}
              <p className="text-[10px] text-slate-600 leading-snug">
                A detached electrode is isoelectric. In a referential montage its channel is
                flat; in a bipolar chain the two derivations containing it show only the
                neighbour&rsquo;s activity.
              </p>
            </div>
          )}
          {/* Reset the whole control: reattach every electrode and restore the
              default rate and target. */}
          <button
            onClick={() => update({ detachedElectrodes: [], popRatePerMin: 1, popTarget: POP_TARGET_ANY })}
            className="w-full py-1 rounded text-[11px] font-mono border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors"
          >
            Reset
          </button>
        </>,
      );
    }

    case 'sweat':
      return wrap(
        <Slider
          label="Severity" value={params.sweatSeverity} min={0.25} max={3} step={0.05} unit="×"
          live={lv?.sweatSeverity}
          onChange={v => update({ sweatSeverity: v })}
        />,
      );

    case 'ecg-artifact':
      return wrap(
        <Slider
          label="Heart rate" value={params.ecgBpm} min={40} max={140} step={1} unit=" bpm"
          live={lv?.heartRate}
          onChange={v => update({ ecgBpm: v })}
        />,
      );

    case 'movement':
      return wrap(
        <>
          <Slider
            label="Rate" value={params.movementRatePerMin} min={0.1} max={4} step={0.1} unit="/min"
            live={lv?.movementRate}
            onChange={v => update({ movementRatePerMin: v })}
          />
          <Slider
            label="Severity" value={params.movementSeverity} min={0.25} max={3} step={0.05} unit="×"
            onChange={v => update({ movementSeverity: v })}
          />
        </>,
      );

    case 'respiration':
      return wrap(
        <>
          <div className="space-y-1">
            <Label className={LABEL_CLASS}>Form</Label>
            <div className="flex gap-1">
              {(['electrode', 'lying'] as const).map(f => (
                <Chip
                  key={f} on={params.respirationForm === f} label={f === 'electrode' ? 'One electrode' : 'Lying on'}
                  title={f === 'electrode'
                    ? 'A smooth wave per breath on one electrode whose contact the breathing moves'
                    : 'A sharp wave at each inspiration on the electrodes the head rests on (O1/O2, supine)'}
                  onClick={() => update({ respirationForm: f })}
                />
              ))}
            </div>
          </div>
          {params.respirationForm === 'electrode' && (
            <div className="space-y-1">
              <Label className={LABEL_CLASS}>Electrode</Label>
              <select
                value={params.respirationElectrode}
                onChange={e => update({ respirationElectrode: e.target.value })}
                className="w-full py-1 px-1.5 rounded text-[11px] font-mono border border-slate-700 bg-slate-900 text-slate-200">
                {ALL_ELECTRODES.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          )}
        </>,
      );

    case 'pulse':
      return wrap(
        <div className="space-y-1">
          <Label className={LABEL_CLASS}>Electrode over the artery</Label>
          <select
            value={params.pulseElectrode}
            onChange={e => update({ pulseElectrode: e.target.value })}
            title="Moving the electrode off the artery is what removes a pulse artifact"
            className="w-full py-1 px-1.5 rounded text-[11px] font-mono border border-slate-700 bg-slate-900 text-slate-200">
            {ALL_ELECTRODES.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>,
      );

    case 'iv-drip':
      return wrap(
        <Slider
          label="Drip rate" value={params.dripRatePerMin} min={10} max={60} step={1} unit="/min"
          onChange={v => update({ dripRatePerMin: v })}
        />,
      );

    case 'ventilator':
      return wrap(
        <>
          <Slider
            label="Ventilator rate" value={params.ventRatePerMin} min={8} max={30} step={1} unit="/min"
            onChange={v => update({ ventRatePerMin: v })}
          />
          <div className="space-y-1">
            <Label className={LABEL_CLASS}>Ventilator side</Label>
            <div className="flex gap-1">
              {(['left', 'right'] as const).map(sd => (
                <Chip key={sd} on={params.ventSide === sd} label={sd === 'left' ? 'Left' : 'Right'}
                  title={`Ventilator and tubing on the patient's ${sd}: the bursts are larger on that side`}
                  onClick={() => update({ ventSide: sd })} />
              ))}
            </div>
          </div>
          <button
            onClick={() => update({ suctionNonce: params.suctionNonce + 1 })}
            title="Suction the water out of the tubing: the bursts stop until it builds up again"
            className="w-full py-1 rounded text-[11px] font-semibold border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700">
            Suction the tubing
          </button>
        </>,
      );

    case '50hz':
      return wrap(
        <>
          <div className="space-y-1">
            <Label className={LABEL_CLASS}>Mains frequency</Label>
            <div className="flex gap-1">
              {([50, 60] as const).map(f => (
                <Chip
                  key={f} on={params.lineFreq === f} label={`${f} Hz`}
                  title={f === 50 ? 'Europe, Asia, Africa, most of South America' : 'North America, parts of South America, Japan (east)'}
                  onClick={() => update({ lineFreq: f })}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className={LABEL_CLASS}>Poor contacts</Label>
            <div className="flex gap-1">
              {(['one', 'many'] as const).map(m => (
                <Chip
                  key={m} on={params.mainsContacts === m} label={m === 'one' ? 'One' : 'Many'}
                  title={m === 'one'
                    ? 'One poorly connected electrode: a band on the two rows that share it'
                    : 'Many poor contacts, worst over the back of the head, as on a hastily applied or dry-electrode cap'}
                  onClick={() => update({ mainsContacts: m })}
                />
              ))}
            </div>
          </div>
          <Slider
            label="Amplitude" value={params.lineAmpUv} min={0} max={15} step={0.5} unit=" µV"
            onChange={v => update({ lineAmpUv: v })}
          />
        </>,
      );

    default:
      return null;
  }
}
