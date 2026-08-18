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
import { POP_TARGET_ANY } from '../utils/simTypes';
import { electrodePositions3D } from '../utils/electrodePositions3D';

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
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <Label className={LABEL_CLASS}>{label}</Label>
        <span className="text-[10px] font-mono text-orange-400">
          {step < 1 ? value.toFixed(step < 0.1 ? 2 : 1) : Math.round(value)}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-orange-500"
      />
    </div>
  );
}

/** A small pressed/unpressed button, used for the multi-select and enum controls. */
function Chip({
  on, label, title, onClick,
}: { on: boolean; label: string; title?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 py-1 px-1 rounded text-[10px] font-mono border transition-colors ${
        on
          ? 'bg-orange-800/40 border-orange-600 text-orange-300'
          : 'border-slate-700 text-slate-500 hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  );
}

export function ArtifactControls({
  id, params, update,
}: {
  id: string;
  params: ArtifactParams;
  update: (patch: Partial<ArtifactParams>) => void;
}) {
  const wrap = (children: React.ReactNode) => (
    <div className="pt-2 pb-1 pl-1 space-y-2">{children}</div>
  );

  switch (id) {
    case 'blink':
      return wrap(
        <Slider
          label="Blink rate" value={params.blinkRatePerMin} min={2} max={40} step={1} unit="/min"
          onChange={v => update({ blinkRatePerMin: v })}
        />,
      );

    case 'eye-movement':
      return wrap(
        <Slider
          label="Saccade rate" value={params.saccadeRatePerMin} min={4} max={60} step={1} unit="/min"
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
                  onClick={() => toggleRegion(r.id)}
                />
              ))}
            </div>
          </div>
          <Slider
            label="Severity" value={params.emgSeverity} min={0.25} max={3} step={0.05} unit="×"
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
          <Slider
            label="Pop rate" value={params.popRatePerMin} min={0.1} max={6} step={0.1} unit="/min"
            onChange={v => update({ popRatePerMin: v })}
          />
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
            {!targeted ? 'Pick an electrode to detach'
              : isDetached ? `Reattach ${target}`
              : `Detach ${target} (pop, then flat)`}
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
        </>,
      );
    }

    case 'sweat':
      return wrap(
        <Slider
          label="Severity" value={params.sweatSeverity} min={0.25} max={3} step={0.05} unit="×"
          onChange={v => update({ sweatSeverity: v })}
        />,
      );

    case 'ecg-artifact':
      return wrap(
        <Slider
          label="Heart rate" value={params.ecgBpm} min={40} max={140} step={1} unit=" bpm"
          onChange={v => update({ ecgBpm: v })}
        />,
      );

    case 'movement':
      return wrap(
        <>
          <Slider
            label="Rate" value={params.movementRatePerMin} min={0.1} max={4} step={0.1} unit="/min"
            onChange={v => update({ movementRatePerMin: v })}
          />
          <Slider
            label="Severity" value={params.movementSeverity} min={0.25} max={3} step={0.05} unit="×"
            onChange={v => update({ movementSeverity: v })}
          />
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
