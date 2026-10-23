import { Montage } from './montages';

export type HighlightState = {
  hoveredElectrodes: Set<string>;
  clickedElectrodes: Set<string>;
  hoveredChannels: Set<number>;
  clickedChannels: Set<number>;
};

let state: HighlightState = {
  hoveredElectrodes: new Set(),
  clickedElectrodes: new Set(),
  hoveredChannels: new Set(),
  clickedChannels: new Set(),
};

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function notify() {
  subscribers.forEach(sub => sub());
}

export function subscribe(callback: Subscriber) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function getHighlightState() {
  return state;
}

export function setHoverElectrodes(electrodes: Set<string>) {
  state = { ...state, hoveredElectrodes: electrodes };
  notify();
}

export function toggleClickElectrode(electrode: string) {
  const newSet = new Set(state.clickedElectrodes);
  if (newSet.has(electrode)) {
    newSet.delete(electrode);
  } else {
    newSet.add(electrode);
  }
  state = { ...state, clickedElectrodes: newSet };
  notify();
}

export function setHoverChannels(channels: Set<number>) {
  state = { ...state, hoveredChannels: channels };
  notify();
}

export function toggleClickChannel(channelIndex: number) {
  const newSet = new Set(state.clickedChannels);
  if (newSet.has(channelIndex)) {
    newSet.delete(channelIndex);
  } else {
    newSet.add(channelIndex);
  }
  state = { ...state, clickedChannels: newSet };
  notify();
}

export function clearAllHighlights() {
  state = {
    hoveredElectrodes: new Set(),
    clickedElectrodes: new Set(),
    hoveredChannels: new Set(),
    clickedChannels: new Set(),
  };
  notify();
}

export function getActiveElectrodes() {
  const active = new Set(state.hoveredElectrodes);
  state.clickedElectrodes.forEach(el => active.add(el));
  return active;
}

export function getActiveChannels() {
  const active = new Set(state.hoveredChannels);
  state.clickedChannels.forEach(ch => active.add(ch));
  return active;
}

export function getChannelsUsingElectrode(electrode: string, montage: Montage): number[] {
  const channels: number[] = [];
  montage.channels.forEach((ch, i) => {
    if (ch.active === electrode || ch.reference === electrode) {
      channels.push(i);
    }
  });
  return channels;
}

export function getElectrodesForChannel(channelIndex: number, montage: Montage): string[] {
  const ch = montage.channels[channelIndex];
  if (!ch) return [];
  const electrodes = [];
  if (ch.active && ch.active !== 'ECG') electrodes.push(ch.active);
  if (ch.reference && ch.reference !== 'AVG' && ch.reference !== 'CONTRA' && ch.reference !== 'IPSI') {
    electrodes.push(ch.reference);
  }
  return electrodes;
}
