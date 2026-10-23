import { DEFAULT_SOLO_DIFFICULTY, type SoloDifficulty } from "../bot/bot-profiles.js";
import { isSoloDifficulty } from "./solo-storage.js";

export const SOLO_DIFFICULTY_KEY = "msf:solo:difficulty";

// The level is a lasting preference, so it lives in localStorage, unlike the per-tab replay.
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

export const readSoloDifficulty = (): SoloDifficulty => {
  try {
    const stored = getPreferenceStorage()?.getItem(SOLO_DIFFICULTY_KEY);
    return isSoloDifficulty(stored) ? stored : DEFAULT_SOLO_DIFFICULTY;
  } catch {
    return DEFAULT_SOLO_DIFFICULTY;
  }
};

export const writeSoloDifficulty = (difficulty: SoloDifficulty): void => {
  try {
    getPreferenceStorage()?.setItem(SOLO_DIFFICULTY_KEY, difficulty);
  } catch {
    // A denied browser storage only loses the remembered default.
  }
};
