import { useSyncExternalStore } from "react";
import { readSoundEnabled, writeSoundEnabled } from "./sound-preference.js";

const listeners = new Set<() => void>();
let enabled: boolean | null = null;

export const isSoundEnabled = (): boolean => {
  enabled ??= readSoundEnabled();
  return enabled;
};

export const setSoundEnabled = (next: boolean): void => {
  enabled = next;
  writeSoundEnabled(next);
  listeners.forEach((listener) => {
    listener();
  });
};

export const subscribeSoundEnabled = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useSoundEnabled = (): boolean =>
  useSyncExternalStore(subscribeSoundEnabled, isSoundEnabled, () => true);
