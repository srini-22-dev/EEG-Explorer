import { ChannelGroup } from './montages';

export type EEGTheme = 'green-paper' | 'white-paper' | 'dark-mode';

export type ThemeColors = {
  bgEven: string;
  bgOdd: string;
  labelBg: string;
  grid1s: string;
  grid200: string;
  gridH5mm: string;
  gridH1mm: string;
  baselineColor: string;
  traceColors: Record<ChannelGroup, string>;
  calibColor: string;
  stateTextColor: string;
  overlayBg: string;
  overlayText: string;
};

export const THEMES: Record<EEGTheme, ThemeColors> = {
  'green-paper': {
    bgEven: '#c8e6c0',
    bgOdd: '#bdddb5',
    labelBg: 'rgba(200,230,192,0.93)',
    grid1s: 'rgba(0,100,0,0.26)',
    grid200: 'rgba(0,100,0,0.10)',
    gridH5mm: 'rgba(0,100,0,0.16)',
    gridH1mm: 'rgba(0,100,0,0.07)',
    baselineColor: 'rgba(0,80,0,0.13)',
    traceColors: {
      'left-paramedian': '#1a4fa0',
      'right-paramedian': '#8b1a1a',
      'left-temporal': '#1a4fa0',
      'right-temporal': '#8b1a1a',
      'central': '#1a3a1a',
      'ecg': '#1b6b1b',
    },
    calibColor: '#6b4400',
    stateTextColor: 'rgba(0,60,0,0.60)',
    overlayBg: 'rgba(0,40,0,0.68)',
    overlayText: '#a0e8a0',
  },
  'white-paper': {
    bgEven: '#ffffff',
    bgOdd: '#f8f9fa',
    labelBg: 'rgba(255,255,255,0.93)',
    grid1s: 'rgba(0,0,0,0.2)',
    grid200: 'rgba(0,0,0,0.08)',
    gridH5mm: 'rgba(0,0,0,0.12)',
    gridH1mm: 'rgba(0,0,0,0.05)',
    baselineColor: 'rgba(0,0,0,0.1)',
    traceColors: {
      'left-paramedian': '#000080',
      'right-paramedian': '#800000',
      'left-temporal': '#000080',
      'right-temporal': '#800000',
      'central': '#000000',
      'ecg': '#006400',
    },
    calibColor: '#000000',
    stateTextColor: 'rgba(0,0,0,0.6)',
    overlayBg: 'rgba(0,0,0,0.7)',
    overlayText: '#ffffff',
  },
  'dark-mode': {
    bgEven: '#121212',
    bgOdd: '#1a1a1a',
    labelBg: 'rgba(18,18,18,0.93)',
    grid1s: 'rgba(255,255,255,0.15)',
    grid200: 'rgba(255,255,255,0.05)',
    gridH5mm: 'rgba(255,255,255,0.1)',
    gridH1mm: 'rgba(255,255,255,0.03)',
    baselineColor: 'rgba(255,255,255,0.1)',
    traceColors: {
      'left-paramedian': '#60a5fa',
      'right-paramedian': '#f87171',
      'left-temporal': '#60a5fa',
      'right-temporal': '#f87171',
      'central': '#e2e8f0',
      'ecg': '#4ade80',
    },
    calibColor: '#fbbf24',
    stateTextColor: 'rgba(255,255,255,0.6)',
    overlayBg: 'rgba(255,255,255,0.2)',
    overlayText: '#ffffff',
  }
};
