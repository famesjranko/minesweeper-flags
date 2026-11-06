import { BOARD_SIZES, type BoardSize, DEFAULT_BOARD_SIZE } from "@minesweeper-flags/game-engine";
import { BOT_PROFILES, DEFAULT_SOLO_DIFFICULTY, type SoloDifficulty } from "../bot/bot-profiles.js";
import type { SoloReplayRecord } from "../session/solo-session.types.js";

export const SOLO_STORAGE_KEY = "msf:solo:v1";
// Every move reveals or claims at least one square, so a match has at most one move per square.
// The largest board sets both limits; one saved move is about 60 bytes of JSON.
const LARGEST_BOARD_CELLS = Math.max(
  ...Object.values(BOARD_SIZES).map(({ rows, columns }) => rows * columns)
);
export const SOLO_STORAGE_MAX_ACTIONS = LARGEST_BOARD_CELLS;
export const SOLO_STORAGE_MAX_BYTES = 80 * LARGEST_BOARD_CELLS;

export interface SoloStorage {
  read: () => { record: SoloReplayRecord | null; notice: string | null };
  write: (record: SoloReplayRecord) => string | null;
  clear: () => void;
}

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInteger = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

const isActionOn =
  (boardSize: BoardSize) =>
  (value: unknown): boolean =>
    isPlainObject(value) &&
    (value.type === "select" || value.type === "bomb") &&
    (value.playerId === "solo-human" || value.playerId === "solo-bot") &&
    isInteger(value.row, 0, BOARD_SIZES[boardSize].rows - 1) &&
    isInteger(value.column, 0, BOARD_SIZES[boardSize].columns - 1) &&
    Object.keys(value).length === 4;

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      return true;
    }
  }
  return false;
};

export const isSoloDifficulty = (value: unknown): value is SoloDifficulty =>
  typeof value === "string" && Object.hasOwn(BOT_PROFILES, value);

export const isBoardSize = (value: unknown): value is BoardSize =>
  typeof value === "string" && Object.hasOwn(BOARD_SIZES, value);

const RECORD_KEYS = [
  "version",
  "seed",
  "createdAt",
  "starter",
  "difficulty",
  "boardSize",
  "actions",
  "resignedBy"
];

// Reserve deterministic timestamps for a full replay and a final resignation.
export const validateSoloReplay = (value: unknown): SoloReplayRecord | null => {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !RECORD_KEYS.includes(key))) {
    return null;
  }
  // Records saved before board sizes existed were all played on the classic board.
  const boardSize = value.boardSize ?? DEFAULT_BOARD_SIZE;
  if (!isBoardSize(boardSize)) {
    return null;
  }
  const { rows, columns } = BOARD_SIZES[boardSize];
  if (
    value.version !== 1 ||
    !isInteger(value.seed, 0, 0xffffffff) ||
    !isInteger(value.createdAt, 0, Number.MAX_SAFE_INTEGER - SOLO_STORAGE_MAX_ACTIONS - 1) ||
    (value.starter !== "human" && value.starter !== "bot") ||
    !Array.isArray(value.actions) ||
    value.actions.length > rows * columns ||
    !value.actions.every(isActionOn(boardSize)) ||
    (value.resignedBy !== undefined &&
      value.resignedBy !== "human" &&
      value.resignedBy !== "bot") ||
    (value.difficulty !== undefined && !isSoloDifficulty(value.difficulty))
  ) {
    return null;
  }
  // Records saved before levels existed were all played at the default level.
  return {
    difficulty: DEFAULT_SOLO_DIFFICULTY,
    ...value,
    boardSize
  } as unknown as SoloReplayRecord;
};

const getBrowserStorage = (): BrowserStorage | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const clearSafely = (storage: BrowserStorage | null): void => {
  try {
    storage?.removeItem(SOLO_STORAGE_KEY);
  } catch {
    // A denied browser storage must not stop an in-memory game.
  }
};

export const createBrowserSoloStorage = (): SoloStorage => ({
  read: () => {
    const storage = getBrowserStorage();
    if (!storage) {
      return { record: null, notice: "Solo progress cannot be restored in this browser." };
    }
    let raw: string | null;
    try {
      raw = storage.getItem(SOLO_STORAGE_KEY);
    } catch {
      return { record: null, notice: "Solo progress cannot be restored in this browser." };
    }
    if (raw === null) {
      return { record: null, notice: null };
    }
    if (raw.length > SOLO_STORAGE_MAX_BYTES || hasControlCharacter(raw)) {
      clearSafely(storage);
      return { record: null, notice: "Saved solo progress was invalid and was reset." };
    }
    try {
      const record = validateSoloReplay(JSON.parse(raw));
      if (record) {
        return { record, notice: null };
      }
    } catch {
      // Invalid JSON is handled in the same fail-closed path.
    }
    clearSafely(storage);
    return { record: null, notice: "Saved solo progress was invalid and was reset." };
  },
  write: (record) => {
    const storage = getBrowserStorage();
    if (!storage) {
      return "Solo progress cannot be saved in this browser.";
    }
    const serialized = JSON.stringify(record);
    if (serialized.length > SOLO_STORAGE_MAX_BYTES) {
      return "Solo progress is too large to save.";
    }
    try {
      storage.setItem(SOLO_STORAGE_KEY, serialized);
      return null;
    } catch {
      return "Solo progress cannot be saved in this browser.";
    }
  },
  clear: () => clearSafely(getBrowserStorage())
});
