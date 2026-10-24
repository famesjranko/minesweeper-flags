import type { MatchStateDto } from "@minesweeper-flags/shared";
import { type BombPreviewBounds, getBombPreviewBounds } from "./bomb-preview.js";

type ResolvedAction = NonNullable<MatchStateDto["lastAction"]>;
type Tone = "blue" | "red";

export interface LastMoveTrailEntry {
  turnNumber: number;
  action: ResolvedAction;
}

export type LastMoveTrail = readonly LastMoveTrailEntry[];

export interface LastMoveCell {
  row: number;
  column: number;
  tone: Tone;
}

export interface LastMoveArea {
  bounds: BombPreviewBounds;
  tone: Tone;
}

export interface LastMoveMarks {
  cells: readonly LastMoveCell[];
  areas: readonly LastMoveArea[];
}

export const NO_LAST_MOVE_MARKS: LastMoveMarks = { cells: [], areas: [] };

const EMPTY_TRAIL: LastMoveTrail = [];

const isSameAction = (a: ResolvedAction, b: ResolvedAction): boolean =>
  a.type === b.type && a.playerId === b.playerId && a.row === b.row && a.column === b.column;

/**
 * Tracks the opponent's actions since the viewer's own last action.
 * A snapshot repeating the newest entry's turnNumber and action is a no-op.
 * The action is compared too: a missed rematch reset can leave a new match's
 * move at the same turnNumber as the old match's mark.
 */
export const advanceLastMoveTrail = (
  trail: LastMoveTrail,
  state: Pick<MatchStateDto, "lastAction" | "turnNumber">,
  viewerPlayerId: string
): LastMoveTrail => {
  const { lastAction, turnNumber } = state;

  if (lastAction === null || lastAction.playerId === viewerPlayerId) {
    return trail.length === 0 ? trail : EMPTY_TRAIL;
  }

  const newest = trail[trail.length - 1];
  if (newest && newest.turnNumber === turnNumber && isSameAction(newest.action, lastAction)) {
    return trail;
  }

  // A lower turnNumber, or the same one with a different action, means a
  // different match was loaded; drop the old trail.
  const base = newest && newest.turnNumber >= turnNumber ? EMPTY_TRAIL : trail;
  return [...base, { turnNumber, action: lastAction }];
};

export const getLastMoveMarks = (
  trail: LastMoveTrail,
  rows: number,
  columns: number,
  playerTones: Record<string, Tone>
): LastMoveMarks => {
  const cells: LastMoveCell[] = [];
  const areas: LastMoveArea[] = [];

  // Every move in the opponent's turn gets the same mark; the board shows what they did, not
  // the order. Newest first, and a cell hit by several moves is marked once.
  [...trail].reverse().forEach(({ action }) => {
    const tone = playerTones[action.playerId] ?? "blue";

    if (action.type === "bomb") {
      areas.push({
        bounds: getBombPreviewBounds(rows, columns, action.row, action.column),
        tone
      });
    }

    if (!cells.some((cell) => cell.row === action.row && cell.column === action.column)) {
      cells.push({ row: action.row, column: action.column, tone });
    }
  });

  return { cells, areas };
};
