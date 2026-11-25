import { useEffect, useState } from 'react';
import type { LiveArtifacts } from '../engine/engine';

/**
 * What the artifacts are doing now (engine LiveArtifacts), handed from the canvas's
 * sample loop to the controls. The canvas writes `liveArtifacts.current` as it runs;
 * the controls read a copy a few times a second, often enough to watch a muscle
 * episode switch on and a slider drift, without re-rendering the panel per sample.
 */
export const liveArtifacts: { current: LiveArtifacts | null } = { current: null };

const POLL_MS = 250;

/** A copy of the live state, refreshed every POLL_MS while `enabled`; null otherwise. */
export function useLiveArtifacts(enabled: boolean): LiveArtifacts | null {
  const [snap, setSnap] = useState<LiveArtifacts | null>(null);
  useEffect(() => {
    if (!enabled) { setSnap(null); return; }
    const read = () => {
      const c = liveArtifacts.current;
      setSnap(c ? { ...c, emgRegions: c.emgRegions ? [...c.emgRegions] : null } : null);
    };
    read();
    const id = setInterval(read, POLL_MS);
    return () => clearInterval(id);
  }, [enabled]);
  return snap;
}

/** Whether a toggle that is switched on is active right now (a level rests some artifacts between episodes). */
export function isLiveOn(id: string, live: LiveArtifacts | null): boolean {
  if (!live) return true;
  if (id === 'muscle') return !live.level || live.emgOn;
  if (id === 'movement') return !live.level || live.movementActive;
  if (id === 'ventilator') return live.tubingWater > 0;
  return true;
}
