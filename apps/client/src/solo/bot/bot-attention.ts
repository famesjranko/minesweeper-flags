import type { MatchStateDto } from "@minesweeper-flags/shared";
import { type BoardShape, type BoardView, distance } from "./bot-board.js";

export interface Focus {
  row: number;
  column: number;
}

/** The square of cells the bot notices: every cell within `radius` steps of `focus`. */
export interface AttentionWindow {
  focus: Focus;
  radius: number;
}

/** The most recent action is where the bot is looking; before any action it looks everywhere. */
export const focusOf = (match: MatchStateDto): Focus | null =>
  match.lastAction ? { row: match.lastAction.row, column: match.lastAction.column } : null;

/** A null window means the bot notices the whole board. */
export const isNoticed = (
  shape: BoardShape,
  window: AttentionWindow | null,
  cell: number
): boolean => !window || distance(shape, cell, window.focus) <= window.radius;

/** A hidden cell next to a revealed clue or a claimed mine: a cell a player would consider. */
export const isPlausible = (board: BoardView, cell: number): boolean =>
  board.hidden[cell]! &&
  board.neighbors[cell]!.some((neighbor) => board.clues[neighbor]! >= 0 || board.claimed[neighbor]);

/**
 * The window the bot notices this turn. It starts at `radius` around the focus and
 * doubles until it holds a plausible cell, so the bot looks further away only when
 * nothing near its focus is worth a move. It returns null, the whole board, once the
 * window would cover the board or when the radius or focus sets no limit.
 */
export const attentionWindow = (
  board: BoardView,
  focus: Focus | null,
  radius: number
): AttentionWindow | null => {
  if (!focus || !Number.isFinite(radius)) {
    return null;
  }
  const reach = Math.max(board.rows, board.columns);
  for (let current = Math.max(1, radius); current < reach; current *= 2) {
    const window = { focus, radius: current };
    for (let cell = 0; cell < board.size; cell += 1) {
      if (isNoticed(board, window, cell) && isPlausible(board, cell)) {
        return window;
      }
    }
  }
  return null;
};
