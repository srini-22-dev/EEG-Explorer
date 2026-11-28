import { useEffect, useState } from 'react';

/**
 * The interface's look (owner, 2026-11-28): Apple Light, Apple Dark, or the app's
 * clinical Green refined. "System" follows the device's light or dark setting. It
 * colours the interface only; the paper the trace is drawn on is chosen separately
 * (utils/themes.ts) and keeps its three themes.
 */
export type Appearance = 'system' | 'light' | 'dark' | 'green';
export const APPEARANCES: { id: Appearance; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'green', label: 'Green' },
];

const KEY = 'eeg.appearance';

function readSaved(): Appearance {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'system' || v === 'light' || v === 'dark' || v === 'green') return v;
  } catch { /* storage unavailable: the default stands */ }
  return 'system';
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setOn(m.matches);
    onChange();
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [query]);
  return on;
}

/** The chosen appearance, remembered on this device, applied to <html data-ui>. */
export function useAppearance(): [Appearance, (a: Appearance) => void] {
  const [appearance, setAppearance] = useState<Appearance>(readSaved);
  const prefersDark = useMedia('(prefers-color-scheme: dark)');
  const resolved = appearance === 'system' ? (prefersDark ? 'dark' : 'light') : appearance;
  useEffect(() => {
    document.documentElement.dataset.ui = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--ui-root').trim());
  }, [resolved]);
  const set = (a: Appearance) => {
    setAppearance(a);
    try { localStorage.setItem(KEY, a); } catch { /* not remembered, still applied */ }
  };
  return [appearance, set];
}

/**
 * Phone layout: narrow (a phone held upright) or short (a phone on its side). Below
 * these the sidebar and the toolbar would leave the trace too little room, so the
 * controls move into sheets and the trace takes the screen.
 */
export function useLayoutMode(): { compact: boolean; portrait: boolean } {
  const compact = useMedia('(max-width: 767px), (max-height: 520px)');
  const portrait = useMedia('(orientation: portrait)');
  return { compact, portrait };
}
