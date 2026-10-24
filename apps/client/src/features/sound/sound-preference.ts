export const SOUND_ENABLED_KEY = "msf:sound:enabled";

const getPreferenceStorage = (): Pick<Storage, "getItem" | "setItem"> | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readSoundEnabled = (): boolean => {
  try {
    return getPreferenceStorage()?.getItem(SOUND_ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
};

export const writeSoundEnabled = (enabled: boolean): void => {
  try {
    getPreferenceStorage()?.setItem(SOUND_ENABLED_KEY, enabled ? "on" : "off");
  } catch {
    // A denied browser storage only loses the remembered choice.
  }
};
