import { describe, expect, it } from "vitest";
import type { BoardCell, BoardSize, MatchState } from "../index.js";
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  BOARD_SIZE_IDS,
  BOARD_SIZES,
  createMatchState,
  MIN_BOMB_DEFICIT,
  resignMatch,
  resolveAction,
  TOTAL_MINES
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

const createTwoPlayerMatch = (): MatchState =>
  createMatchState({
    roomId: "room-1",
    players: [
      { playerId: "p1", displayName: "A" },
      { playerId: "p2", displayName: "B" }
    ],
    seed: 1,
    createdAt: 1,
    startingPlayerId: "p1"
  });

// Leaves the player far enough behind that the bomb-deficit guard would allow a bomb, so a
// rejection can only come from the guard a test is aiming at.
const makePlayerTrail = (match: MatchState, playerId: string): void => {
  for (const player of match.players) {
    player.score = player.playerId === playerId ? 0 : MIN_BOMB_DEFICIT;
  }
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
    const resolution = resolveAction(
      match,
      { type: "select", playerId: "p1", row: 0, column: 0 },
      2
    );

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
    const resolution = resolveAction(
      match,
      { type: "select", playerId: "p1", row: 0, column: 1 },
      2
    );

    expect(resolution.ok).toBe(true);

    if (resolution.ok) {
      expect(resolution.state.currentTurnPlayerId).toBe("p2");
      expect(resolution.state.board.cells[0]![1]!.isRevealed).toBe(true);
      expect(resolution.action.outcome).toBe("safe_reveal");
    }
  });

  it("only allows bombs while trailing by the minimum deficit", () => {
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

    match.players[0].score = 3;
    match.players[1].score = 3 + (MIN_BOMB_DEFICIT - 1);
    const resolution = resolveAction(match, { type: "bomb", playerId: "p1", row: 4, column: 4 }, 2);

    expect(resolution.ok).toBe(false);

    if (!resolution.ok) {
      expect(resolution.error).toContain(`${MIN_BOMB_DEFICIT} or more`);
    }
  });

  it("claims mines in the bomb area once the deficit threshold is met", () => {
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
    match.players[1].score = MIN_BOMB_DEFICIT;
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

    const resolution = resolveAction(
      match,
      { type: "select", playerId: "p1", row: 0, column: 0 },
      2
    );

    expect(resolution.ok).toBe(true);

    if (resolution.ok) {
      expect(resolution.state.phase).toBe("finished");
      expect(resolution.state.winnerPlayerId).toBe("p1");
      expect(resolution.state.currentTurnPlayerId).toBeNull();
    }
  });

  it.each([
    ["a select", "select", BOARD_ROWS, 0],
    ["a bomb", "bomb", 0, BOARD_COLUMNS + 4]
  ] as const)("rejects %s outside the board instead of throwing", (_label, type, row, column) => {
    // Given a live match on the active player's turn
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

    // When the player targets a cell past the board's edge
    const resolution = resolveAction(match, { type, playerId: "p1", row, column }, 2);

    // Then the action is rejected like any other invalid move
    expect(resolution).toEqual({ ok: false, error: "That cell is outside the board." });
  });

  it.each([
    ["select", 0, 0],
    ["bomb", 0, 0]
  ] as const)("rejects a %s when the match is not live", (type, row, column) => {
    // Given a match that has already finished
    const match = createTwoPlayerMatch();
    makePlayerTrail(match, "p1");
    match.phase = "finished";
    const before = structuredClone(match);

    // When a player acts on it
    const resolution = resolveAction(match, { type, playerId: "p1", row, column }, 2);

    // Then the action is rejected as inactive
    expect(resolution).toEqual({ ok: false, error: "The match is not currently active." });

    // And the match state is unchanged
    expect(match).toEqual(before);
  });

  it.each([["select"], ["bomb"]] as const)(
    "rejects a %s from the player whose turn it is not",
    (type) => {
      // Given a live match where p1 holds the turn
      const match = createTwoPlayerMatch();
      makePlayerTrail(match, "p2");
      const before = structuredClone(match);

      // When p2 acts on an open cell
      const resolution = resolveAction(match, { type, playerId: "p2", row: 0, column: 0 }, 2);

      // Then the action is rejected as out of turn
      expect(resolution).toEqual({ ok: false, error: "It is not your turn." });

      // And the match state is unchanged
      expect(match).toEqual(before);
    }
  );

  it.each([["select"], ["bomb"]] as const)(
    "rejects a %s from a player who is not in the match",
    (type) => {
      // Given a live match whose current turn belongs to an id that is not a player
      const match = createTwoPlayerMatch();
      match.currentTurnPlayerId = "ghost";
      const before = structuredClone(match);

      // When that id acts on an open cell
      const resolution = resolveAction(match, { type, playerId: "ghost", row: 0, column: 0 }, 2);

      // Then the action is rejected as coming from a non-participant
      expect(resolution).toEqual({ ok: false, error: "The player is not part of this match." });

      // And the match state is unchanged
      expect(match).toEqual(before);
    }
  );

  it.each([
    ["select", "a revealed cell", { isRevealed: true }],
    ["bomb", "a revealed cell", { isRevealed: true }],
    ["select", "a claimed cell", { claimedByPlayerId: "p2" }],
    ["bomb", "a claimed cell", { claimedByPlayerId: "p2" }]
  ] as const)("rejects a %s on %s", (type, _label, cellState) => {
    // Given a live match where the cell at 0,0 is already resolved
    const match = createTwoPlayerMatch();
    makePlayerTrail(match, "p1");
    match.board = createCustomBoard([{ row: 0, column: 0, ...cellState }]);
    const before = structuredClone(match);

    // When the player whose turn it is targets that cell
    const resolution = resolveAction(match, { type, playerId: "p1", row: 0, column: 0 }, 2);

    // Then the action is rejected as already resolved
    expect(resolution).toEqual({ ok: false, error: "That cell has already been resolved." });

    // And the match state is unchanged
    expect(match).toEqual(before);
  });

  it("checks the turn before whether the cell is resolved", () => {
    // Given a live match on p1's turn with an already revealed cell
    const match = createTwoPlayerMatch();
    match.board = createCustomBoard([{ row: 0, column: 0, isRevealed: true }]);

    // When p2 targets that revealed cell out of turn
    const resolution = resolveAction(
      match,
      { type: "select", playerId: "p2", row: 0, column: 0 },
      2
    );

    // Then the turn error wins over the resolved-cell error
    expect(resolution).toEqual({ ok: false, error: "It is not your turn." });
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

describe("board sizes", () => {
  const createSizedMatch = (boardSize?: BoardSize): MatchState =>
    createMatchState({
      roomId: "room-1",
      players: [
        { playerId: "p1", displayName: "A" },
        { playerId: "p2", displayName: "B" }
      ],
      seed: 7,
      createdAt: 1,
      startingPlayerId: "p1",
      ...(boardSize ? { boardSize } : {})
    });

  const findMine = (match: MatchState): BoardCell => {
    const mine = match.board.cells.flat().find((cell) => cell.hasMine);
    if (!mine) throw new Error("The board has no mine.");
    return mine;
  };

  it("builds the classic board when no size is given", () => {
    // Given a match created without a board size
    const match = createSizedMatch();

    // When the board is read
    const { rows, columns, mineCount } = match.board;

    // Then it is the classic 16×16 board with 51 mines
    expect({ rows, columns, mineCount }).toEqual({ rows: 16, columns: 16, mineCount: 51 });
  });

  it.each(BOARD_SIZE_IDS)("builds the %s board with its preset mines", (boardSize) => {
    // Given a match created with a board size preset
    const match = createSizedMatch(boardSize);

    // When the mines on the board are counted
    const placedMines = match.board.cells.flat().filter((cell) => cell.hasMine).length;

    // Then the board has the preset dimensions
    expect(match.board.cells).toHaveLength(BOARD_SIZES[boardSize].rows);
    expect(match.board.cells.every((row) => row.length === BOARD_SIZES[boardSize].columns)).toBe(
      true
    );
    // And it holds exactly the preset number of mines
    expect(placedMines).toBe(BOARD_SIZES[boardSize].mineCount);
  });

  it("keeps a large-board match live when a player reaches the classic winning score", () => {
    // Given a large-board match where p1 has 25 mines
    const match = createSizedMatch("large");
    match.players[0].score = 25;
    const mine = findMine(match);

    // When p1 claims a 26th mine
    const resolution = resolveAction(
      match,
      { type: "select", playerId: "p1", row: mine.row, column: mine.column },
      2
    );

    // Then the match is still live, because 26 is not a majority of 79 mines
    expect(resolution.ok && resolution.state.phase).toBe("live");
  });

  it("finishes a large-board match when a player claims a majority of its mines", () => {
    // Given a large-board match where p1 has 39 of its 79 mines
    const match = createSizedMatch("large");
    match.players[0].score = 39;
    const mine = findMine(match);

    // When p1 claims a 40th mine
    const resolution = resolveAction(
      match,
      { type: "select", playerId: "p1", row: mine.row, column: mine.column },
      2
    );

    // Then the match is finished
    expect(resolution.ok && resolution.state.phase).toBe("finished");
    // And p1 wins
    expect(resolution.ok && resolution.state.winnerPlayerId).toBe("p1");
  });
});

describe("board size presets", () => {
  it.each(BOARD_SIZE_IDS)("gives the %s board an odd mine count so a match cannot tie", (id) => {
    // Given a board size preset
    const { rows, columns, mineCount } = BOARD_SIZES[id];

    // When its mine count is checked
    const isOdd = mineCount % 2 === 1;

    // Then the count is odd
    expect(isOdd).toBe(true);
    // And the board has safe cells left over
    expect(mineCount).toBeLessThan(rows * columns);
  });
});

describe("bomb deficit by board size", () => {
  it.each([
    ["classic", 4],
    ["large", 6],
    ["huge", 9],
    ["giant", 14]
  ] as const)("unlocks the %s board's bomb at a deficit of %i", (boardSize, deficit) => {
    // Given a match on the board size
    const match = createMatchState({
      roomId: "room-1",
      players: [
        { playerId: "p1", displayName: "A" },
        { playerId: "p2", displayName: "B" }
      ],
      seed: 7,
      createdAt: 1,
      startingPlayerId: "p1",
      boardSize
    });

    // When p1 bombs one mine short of the deficit, then at the deficit
    match.players[1].score = deficit - 1;
    const early = resolveAction(match, { type: "bomb", playerId: "p1", row: 5, column: 5 }, 2);
    match.players[1].score = deficit;
    const unlocked = resolveAction(match, { type: "bomb", playerId: "p1", row: 5, column: 5 }, 2);

    // Then the early bomb is rejected with the board's deficit
    expect(!early.ok && early.error).toBe(
      `Bombs can only be used while trailing by ${deficit} or more.`
    );
    // And the bomb at the deficit is accepted
    expect(unlocked.ok).toBe(true);
  });
});
