/**
 * Every preset keeps the classic mine density of about 20% (51 of 256 cells). Each mine count is
 * odd, so a full board always has a majority and a match cannot end level.
 */
export const BOARD_SIZES = {
  classic: { rows: 16, columns: 16, mineCount: 51 },
  large: { rows: 20, columns: 20, mineCount: 79 },
  huge: { rows: 24, columns: 24, mineCount: 115 },
  giant: { rows: 30, columns: 30, mineCount: 179 }
} as const;

export type BoardSize = keyof typeof BOARD_SIZES;

/** Picker order, smallest first. */
export const BOARD_SIZE_IDS = [
  "classic",
  "large",
  "huge",
  "giant"
] as const satisfies readonly BoardSize[];

export const DEFAULT_BOARD_SIZE: BoardSize = "classic";

export const BOARD_ROWS = BOARD_SIZES[DEFAULT_BOARD_SIZE].rows;
export const BOARD_COLUMNS = BOARD_SIZES[DEFAULT_BOARD_SIZE].columns;
export const TOTAL_MINES = BOARD_SIZES[DEFAULT_BOARD_SIZE].mineCount;
export const BOMB_RADIUS = 2;

/** A strict majority of the board's mines wins outright. */
export const getWinningScore = (mineCount: number): number => Math.floor(mineCount / 2) + 1;
