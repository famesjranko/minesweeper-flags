import type { MatchStateDto } from "@minesweeper-flags/shared";
import { getBombPreviewBounds, type BombPreviewBounds } from "./bomb-preview.js";

type ResolvedAction = NonNullable<MatchStateDto["lastAction"]>;
type Tone = "blue" | "red";

export interface LastMoveTrailEntry {
  turnNumber: number;
  action: ResolvedAction;
}

export type LastMoveTrail = readonly LastMoveTrailEntry[];

/** 0 is the newest move; higher levels are older and drawn fainter. */
export type LastMoveAge = 0 | 1 | 2;

export interface LastMoveCell {
  row: number;
  column: number;
  age: LastMoveAge;
  tone: Tone;
}

export interface LastMoveArea {
  bounds: BombPreviewBounds;
  age: LastMoveAge;
  tone: Tone;
}

export interface LastMoveMarks {
  cells: readonly LastMoveCell[];
  areas: readonly LastMoveArea[];
}

export const NO_LAST_MOVE_MARKS: LastMoveMarks = { cells: [], areas: [] };

const EMPTY_TRAIL: LastMoveTrail = [];

/**
 * Tracks the opponent's actions since the viewer's own last action.
 * Every engine action bumps turnNumber, so it identifies a snapshot's action
 * and makes repeated renders of the same state a no-op.
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
  if (newest && newest.turnNumber === turnNumber) {
    return trail;
  }

  // A lower turnNumber means a different match was loaded; drop the old trail.
  const base = newest && newest.turnNumber > turnNumber ? EMPTY_TRAIL : trail;
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

  // Newest first so a cell hit by several moves keeps its strongest mark.
  [...trail].reverse().forEach(({ action }, index) => {
    const age = Math.min(index, 2) as LastMoveAge;
    const tone = playerTones[action.playerId] ?? "blue";

    if (action.type === "bomb") {
      areas.push({
        bounds: getBombPreviewBounds(rows, columns, action.row, action.column),
        age,
        tone
      });
    }

    if (!cells.some((cell) => cell.row === action.row && cell.column === action.column)) {
      cells.push({ row: action.row, column: action.column, age, tone });
    }
  });

  return { cells, areas };
};
