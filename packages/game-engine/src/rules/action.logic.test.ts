import { describe, expect, it } from "vitest";
import type { BoardCell, MatchState } from "../index.js";
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  TOTAL_MINES,
  createMatchState,
  resignMatch,
  resolveAction
} from "../index.js";

const createCustomBoard = (overrides: Partial<BoardCell>[]): MatchState["board"] => {
  const cells = Array.from({ length: BOARD_ROWS }, (_, row) =>
    Array.from({ length: BOARD_COLUMNS }, (_, column) => ({
      row,
      column,
      hasMine: false,
      adjacentMines: 0,
      isRevealed: false,
      claimedByPlayerId: null
    }))
  );

  for (const override of overrides) {
    const { row = 0, column = 0 } = override;
    Object.assign(cells[row]![column]!, override);
  }

  return {
    rows: BOARD_ROWS,
    columns: BOARD_COLUMNS,
    mineCount: TOTAL_MINES,
    cells
  };
};

describe("resolveAction", () => {
  it("keeps the turn when a player claims a mine", () => {
    const match = createMatchState({
      roomId: "room-1",
      players: [
        { playerId: "p1", displayName: "A" },
        { playerId: "p2", displayName: "B" }
      ],
      seed: 1,
      createdAt: 1,
      startingPlayerId: "p1"
    });

    match.board = createCustomBoard([{ row: 0, column: 0, hasMine: true }]);
    const resolution = resolveAction(match, { type: "select", playerId: "p1", row: 0, column: 0 }, 2);

    expect(resolution.ok).toBe(true);

    if (resolution.ok) {
      expect(resolution.state.players[0].score).toBe(1);
      expect(resolution.state.currentTurnPlayerId).toBe("p1");
      expect(resolution.state.board.cells[0]![0]!.claimedByPlayerId).toBe("p1");
    }
  });

  it("passes the turn when a safe cell is selected", () => {
    const match = createMatchState({
      roomId: "room-1",
      players: [
        { playerId: "p1", displayName: "A" },
        { playerId: "p2", displayName: "B" }
      ],
      seed: 1,
      createdAt: 1,
      startingPlayerId: "p1"
    });

    match.board = createCustomBoard([{ row: 0, column: 1, adjacentMines: 1 }]);
    const resolution = resolveAction(match, { type: "select", playerId: "p1", row: 0, column: 1 }, 2);

    expect(resolution.ok).toBe(true);

    if (resolution.ok) {
      expect(resolution.state.currentTurnPlayerId).toBe("p2");
      expect(resolution.state.board.cells[0]![1]!.isRevealed).toBe(true);
      expect(resolution.action.outcome).toBe("safe_reveal");
    }
  });

  it("only allows bombs while trailing", () => {
    const match = createMatchState({
      roomId: "room-1",
      players: [
        { playerId: "p1", displayName: "A" },
        { playerId: "p2", displayName: "B" }
      ],
      seed: 1,
      createdAt: 1,
      startingPlayerId: "p1"
    });

    const resolution = resolveAction(match, { type: "bomb", playerId: "p1", row: 4, column: 4 }, 2);

    expect(resolution.ok).toBe(false);

    if (!resolution.ok) {
      expect(resolution.error).toContain("trailing");
    }
  });

  it("claims mines in the bomb area", () => {
    const match = createMatchState({
      roomId: "room-1",
      players: [
        { playerId: "p1", displayName: "A" },
        { playerId: "p2", displayName: "B" }
      ],
      seed: 1,
      createdAt: 1,
      startingPlayerId: "p1"
    });

    match.players[0].score = 0;
    match.players[1].score = 2;
    match.board = createCustomBoard([
      { row: 4, column: 4, hasMine: true },
      { row: 5, column: 5, hasMine: true }
    ]);

    const resolution = resolveAction(match, { type: "bomb", playerId: "p1", row: 4, column: 4 }, 2);

    expect(resolution.ok).toBe(true);

    if (resolution.ok) {
      expect(resolution.state.players[0].score).toBe(2);
      expect(resolution.state.players[0].bombsRemaining).toBe(0);
      expect(resolution.action.claimedMineCount).toBe(2);
    }
  });

  it("finishes the match when a player reaches the winning score", () => {
    const match = createMatchState({
      roomId: "room-1",
      players: [
        { playerId: "p1", displayName: "A" },
        { playerId: "p2", displayName: "B" }
      ],
      seed: 1,
      createdAt: 1,
      startingPlayerId: "p1"
    });

    match.players[0].score = 25;
    match.board = createCustomBoard([{ row: 0, column: 0, hasMine: true }]);

    const resolution = resolveAction(match, { type: "select", playerId: "p1", row: 0, column: 0 }, 2);

    expect(resolution.ok).toBe(true);

    if (resolution.ok) {
      expect(resolution.state.phase).toBe("finished");
      expect(resolution.state.winnerPlayerId).toBe("p1");
      expect(resolution.state.currentTurnPlayerId).toBeNull();
    }
  });
});

describe("resignMatch", () => {
  it("ends the match and awards the win to the opponent", () => {
    const match = createMatchState({
      roomId: "room-1",
      players: [
        { playerId: "p1", displayName: "A" },
        { playerId: "p2", displayName: "B" }
      ],
      seed: 1,
      createdAt: 1,
      startingPlayerId: "p1"
    });

    const resigned = resignMatch(match, "p1", 2);

    expect(resigned.phase).toBe("finished");
    expect(resigned.turnPhase).toBe("ended");
    expect(resigned.currentTurnPlayerId).toBeNull();
    expect(resigned.winnerPlayerId).toBe("p2");
    expect(resigned.updatedAt).toBe(2);
  });
});
