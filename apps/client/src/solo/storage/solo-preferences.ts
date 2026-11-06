import {
  type BoardSize,
  DEFAULT_OFFERED_BOARD_SIZE,
  isOfferedBoardSize
} from "@minesweeper-flags/game-engine";
import { DEFAULT_SOLO_DIFFICULTY, type SoloDifficulty } from "../bot/bot-profiles.js";
import { isSoloDifficulty } from "./solo-storage.js";

export const SOLO_DIFFICULTY_KEY = "msf:solo:difficulty";
export const SOLO_BOARD_SIZE_KEY = "msf:solo:board-size";

// Lasting preferences live in localStorage, unlike the per-tab replay.
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

const readPreference = <T extends string>(
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: T
): T => {
  try {
    const stored = getPreferenceStorage()?.getItem(key);
    return isValid(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
};

const writePreference = (key: string, value: string): void => {
  try {
    getPreferenceStorage()?.setItem(key, value);
  } catch {
    // A denied browser storage only loses the remembered default.
  }
};

export const readSoloDifficulty = (): SoloDifficulty =>
  readPreference(SOLO_DIFFICULTY_KEY, isSoloDifficulty, DEFAULT_SOLO_DIFFICULTY);

export const writeSoloDifficulty = (difficulty: SoloDifficulty): void =>
  writePreference(SOLO_DIFFICULTY_KEY, difficulty);

export const readSoloBoardSize = (): BoardSize =>
  readPreference(SOLO_BOARD_SIZE_KEY, isOfferedBoardSize, DEFAULT_OFFERED_BOARD_SIZE);

export const writeSoloBoardSize = (boardSize: BoardSize): void =>
  writePreference(SOLO_BOARD_SIZE_KEY, boardSize);
