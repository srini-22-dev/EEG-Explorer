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
import { Button } from '@/components/ui/button';
import { Caption, Chip, Range, SelectMenu } from '@/components/ui/ios';
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

export function Slider({
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
    <div className={disabled ? 'opacity-40' : ''}>
      <Caption trailing={
        <span className="text-[12px] pointer-coarse:text-[14px] font-medium tabular-nums text-ui-text">
          {offAtMin && value <= min ? 'Off'
            : live != null ? <>{fmt(live)} <span className="text-ui-text-2 font-normal">now · set {fmt(value)}</span></> : fmt(value)}
        </span>
      }>{label}</Caption>
      <Range value={shown} min={min} max={max} step={step} disabled={disabled} ariaLabel={label} onChange={onChange} />
    </div>
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
    <div className="pt-0.5 pb-3 space-y-3">{children}</div>
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
            <Caption>Muscle group</Caption>
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {EMG_REGIONS.map(r => (
                <Chip
                  key={r.id} on={regions.includes(r.id)} title={r.hint}
                  resting={!!lv && !(lv.emgOn && !!lv.emgRegions?.includes(r.id))}
                  onClick={() => toggleRegion(r.id)}
                >{r.label}</Chip>
              ))}
            </div>
          </div>
          <Slider
            label="Severity" value={params.emgSeverity} min={0.25} max={3} step={0.05} unit="×"
            live={lv ? (lv.emgOn ? lv.emgSeverity : 0.25) : undefined}
            onChange={v => update({ emgSeverity: v })}
          />
          {regions.length === 0 && (
            <p className="text-[11px] pointer-coarse:text-[13px] text-ui-text-2 leading-snug">
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
            <Caption>Electrode</Caption>
            <SelectMenu
              className="w-full mt-1" ariaLabel="Electrode"
              value={target} options={[POP_TARGET_ANY, ...ELECTRODES]}
              format={n => n === POP_TARGET_ANY ? 'Any electrode (random)' : `${n}${detached.includes(n) ? ' — detached' : ''}`}
              onChange={v => update({ popTarget: v })}
            />
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
          <Button variant="tinted" size="sm" className="w-full"
            disabled={targeted && isDetached}
            onClick={() => update({ manualPopNonce: params.manualPopNonce + 1 })}
          >
            {targeted
              ? isDetached ? `${target} is detached` : `Pop ${target}`
              : 'Pop random electrode'}
          </Button>
          {/* A random pop: offer to disconnect the electrode that popped (owner's inbox,
              2026-11-27). Its rows then show no signal until it is reattached. */}
          {!targeted && live?.lastPop && (
            <Button variant="destructive" size="sm" className="w-full"
              disabled={detached.includes(live.lastPop)}
              onClick={() => setDetached([...detached, live.lastPop!])}
            >
              {detached.includes(live.lastPop) ? `${live.lastPop} (last popped) is detached` : `Disconnect ${live.lastPop} (last popped)`}
            </Button>
          )}
          {/* Disconnection: contact breaks (one pop) and the channel goes flat until
              reattached — a different finding from a pop, hence its own button. */}
          <Button variant={!targeted ? 'outline' : isDetached ? 'tinted' : 'destructive'} size="sm" className="w-full"
            disabled={!targeted}
            onClick={() =>
              setDetached(isDetached ? detached.filter(n => n !== target) : [...detached, target])
            }
          >
            {!targeted ? 'Pick an electrode to disconnect'
              : isDetached ? `Reattach ${target}`
              : `Disconnect ${target} (pop, then flat)`}
          </Button>
          {detached.length > 0 && (
            <div className="space-y-1">
              <Caption>Detached</Caption>
              <div className="flex flex-wrap gap-1.5">
                {detached.map(n => (
                  <button
                    key={n}
                    onClick={() => setDetached(detached.filter(x => x !== n))}
                    title={`Reattach ${n}`}
                    className="rounded-full px-2.5 h-7 pointer-coarse:h-8 text-[12px] pointer-coarse:text-[14px] font-medium bg-ui-red/15 text-ui-red hover:bg-ui-red/25"
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
              <p className="text-[11px] pointer-coarse:text-[13px] text-ui-text-2 leading-snug">
                A detached electrode records nothing: after its pop, every row that uses
                it shows no signal until it is reattached.
              </p>
            </div>
          )}
          {/* Reset the whole control: reattach every electrode and restore the
              default rate and target. */}
          <Button variant="outline" size="sm" className="w-full"
            onClick={() => update({ detachedElectrodes: [], popRatePerMin: 1, popTarget: POP_TARGET_ANY })}
          >
            Reset
          </Button>
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
            <Caption>Form</Caption>
            <div className="flex gap-1.5 pt-1">
              {(['electrode', 'lying'] as const).map(f => (
                <Chip role="radio"
                  key={f} on={params.respirationForm === f}
                  title={f === 'electrode'
                    ? 'A smooth wave per breath on one electrode whose contact the breathing moves'
                    : 'A sharp wave at each inspiration on the electrodes the head rests on (O1/O2, supine)'}
                  onClick={() => update({ respirationForm: f })}
                >{f === 'electrode' ? 'One electrode' : 'Lying on'}</Chip>
              ))}
            </div>
          </div>
          {params.respirationForm === 'electrode' && (
            <div className="space-y-1">
              <Caption>Electrode</Caption>
              <SelectMenu className="w-full mt-1" ariaLabel="Electrode"
                value={params.respirationElectrode} options={ALL_ELECTRODES} format={e => e}
                onChange={v => update({ respirationElectrode: v })} />
            </div>
          )}
        </>,
      );

    case 'pulse':
      return wrap(
        <div className="space-y-1">
          <Caption>Electrode over the artery</Caption>
          <SelectMenu className="w-full mt-1" ariaLabel="Electrode over the artery"
            title="Moving the electrode off the artery is what removes a pulse artifact"
            value={params.pulseElectrode} options={ALL_ELECTRODES} format={e => e}
            onChange={v => update({ pulseElectrode: v })} />
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
            <Caption>Ventilator side</Caption>
            <div className="flex gap-1.5 pt-1">
              {(['left', 'right'] as const).map(sd => (
                <Chip role="radio" key={sd} on={params.ventSide === sd}
                  title={`Ventilator and tubing on the patient's ${sd}: the bursts are larger on that side`}
                  onClick={() => update({ ventSide: sd })}>{sd === 'left' ? 'Left' : 'Right'}</Chip>
              ))}
            </div>
          </div>
          <Button variant="tinted" size="sm" className="w-full"
            onClick={() => update({ suctionNonce: params.suctionNonce + 1 })}
            title="Suction the water out of the tubing: the bursts stop until it builds up again">
            Suction the tubing
          </Button>
        </>,
      );

    case '50hz':
      return wrap(
        <>
          <div className="space-y-1">
            <Caption>Mains frequency</Caption>
            <div className="flex gap-1.5 pt-1">
              {([50, 60] as const).map(f => (
                <Chip role="radio"
                  key={f} on={params.lineFreq === f}
                  title={f === 50 ? 'Europe, Asia, Africa, most of South America' : 'North America, parts of South America, Japan (east)'}
                  onClick={() => update({ lineFreq: f })}
                >{f} Hz</Chip>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Caption>Poor contacts</Caption>
            <div className="flex gap-1.5 pt-1">
              {(['one', 'many'] as const).map(m => (
                <Chip role="radio"
                  key={m} on={params.mainsContacts === m}
                  title={m === 'one'
                    ? 'One poorly connected electrode: a band on the two rows that share it'
                    : 'Many poor contacts, worst over the back of the head, as on a hastily applied or dry-electrode cap'}
                  onClick={() => update({ mainsContacts: m })}
                >{m === 'one' ? 'One' : 'Many'}</Chip>
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
