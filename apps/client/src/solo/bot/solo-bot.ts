import type { MatchStateDto } from "@minesweeper-flags/shared";
import { analyse } from "./bot-analysis.js";
import { decide, type SoloBotAction, type SoloDecision } from "./bot-policy.js";
import { BOT_PROFILES, DEFAULT_SOLO_DIFFICULTY, type SoloDifficulty } from "./bot-profiles.js";

export type { SoloDecision, SoloDecisionKind } from "./bot-policy.js";
export type { SoloDifficulty } from "./bot-profiles.js";

export interface SoloBotOptions {
  difficulty?: SoloDifficulty;
  /** Source of uniform numbers in [0, 1); inject a seeded one for reproducible play. */
  random?: () => number;
}

const isSupportedCell = (
  cell: MatchStateDto["board"]["cells"][number][number],
  row: number,
  column: number
): boolean => {
  if (cell.row !== row || cell.column !== column) {
    return false;
  }
  if (cell.status === "revealed") {
    return (
      Number.isInteger(cell.adjacentMines) &&
      cell.adjacentMines !== null &&
      cell.adjacentMines >= 0 &&
      cell.adjacentMines <= 8
    );
  }
  return cell.status !== "mine-revealed";
};

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

// The bot reads the board size from the DTO, so the DTO must agree with itself.
const isConsistentBoard = (board: MatchStateDto["board"]): boolean =>
  isPositiveInteger(board.rows) &&
  isPositiveInteger(board.columns) &&
  board.cells.length === board.rows &&
  Number.isInteger(board.mineCount) &&
  board.mineCount >= 0 &&
  board.mineCount <= board.rows * board.columns &&
  board.cells.every(
    (row, rowIndex) =>
      row.length === board.columns &&
      row.every((cell, columnIndex) => isSupportedCell(cell, rowIndex, columnIndex))
  );

const isSupportedMatch = (match: MatchStateDto, botPlayerId: string): boolean =>
  match.phase === "live" &&
  match.turnPhase === "awaiting_action" &&
  match.currentTurnPlayerId === botPlayerId &&
  match.players.some((player) => player.playerId === botPlayerId) &&
  isConsistentBoard(match.board);

export const decideSoloAction = (
  publicMatch: MatchStateDto,
  botPlayerId: string,
  options: SoloBotOptions = {}
): SoloDecision | null => {
  if (!isSupportedMatch(publicMatch, botPlayerId)) {
    return null;
  }
  const profile = BOT_PROFILES[options.difficulty ?? DEFAULT_SOLO_DIFFICULTY];
  const analysis = analyse(publicMatch, profile.deduction);
  if (!analysis) {
    return null;
  }
  return decide({
    match: publicMatch,
    botPlayerId,
    analysis,
    profile,
    random: options.random ?? Math.random
  });
};

export const chooseSoloAction = (
  publicMatch: MatchStateDto,
  botPlayerId: string,
  options: SoloBotOptions = {}
): SoloBotAction | null => decideSoloAction(publicMatch, botPlayerId, options)?.action ?? null;
