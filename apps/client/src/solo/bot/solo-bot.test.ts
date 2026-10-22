import type { MatchStateDto } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { chooseSoloAction } from "./solo-bot.js";

const BOT_ID = "bot";
const HUMAN_ID = "human";

const createMatch = (overrides: Partial<MatchStateDto> = {}): MatchStateDto => ({
  roomId: "solo",
  phase: "live",
  board: {
    rows: 16,
    columns: 16,
    mineCount: 51,
    cells: Array.from({ length: 16 }, (_, row) =>
      Array.from({ length: 16 }, (_, column) => ({
        row,
        column,
        status: "hidden" as const,
        adjacentMines: null,
        claimedByPlayerId: null
      }))
    )
  },
  players: [
    {
      playerId: BOT_ID,
      displayName: "Bot",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: HUMAN_ID,
      displayName: "Human",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    }
  ],
  currentTurnPlayerId: BOT_ID,
  turnPhase: "awaiting_action",
  turnNumber: 1,
  winnerPlayerId: null,
  lastAction: null,
  ...overrides
});

const reveal = (match: MatchStateDto, row: number, column: number, adjacentMines: number): void => {
  match.board.cells[row]![column] = {
    row,
    column,
    status: "revealed",
    adjacentMines,
    claimedByPlayerId: null
  };
};

const claim = (match: MatchStateDto, row: number, column: number): void => {
  match.board.cells[row]![column] = {
    row,
    column,
    status: "claimed",
    adjacentMines: null,
    claimedByPlayerId: HUMAN_ID
  };
};

const countCellReads = (match: MatchStateDto): (() => number) => {
  let reads = 0;
  const rows = match.board.cells.map(
    (row) =>
      new Proxy(row, {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) {
            reads += 1;
          }
          return Reflect.get(target, property, receiver);
        }
      })
  );
  match.board.cells = rows as MatchStateDto["board"]["cells"];
  return () => reads;
};

describe("chooseSoloAction", () => {
  it("rejects a non-live match, another player's turn, and a non-canonical board", () => {
    // Given public matches that the bot cannot legally play
    const finished = createMatch({
      phase: "finished",
      currentTurnPlayerId: null,
      turnPhase: "ended"
    });
    const humanTurn = createMatch({ currentTurnPlayerId: HUMAN_ID });
    const unsupported = createMatch();
    unsupported.board.rows = 8;

    // When the bot selects an action
    const actions = [
      chooseSoloAction(finished, BOT_ID),
      chooseSoloAction(humanTurn, BOT_ID),
      chooseSoloAction(unsupported, BOT_ID)
    ];

    // Then every unsupported state has no action
    expect(actions).toEqual([null, null, null]);
  });

  it("makes the same decision from paired public worlds", () => {
    // Given two independent DTOs with the same revealed clue
    const first = createMatch();
    const second = createMatch();
    reveal(first, 0, 0, 1);
    reveal(second, 0, 0, 1);

    // When the bot selects from each public DTO
    const actions = [chooseSoloAction(first, BOT_ID), chooseSoloAction(second, BOT_ID)];

    // Then it uses the same stable public-clue decision
    expect(actions).toEqual([
      { type: "select", row: 0, column: 1 },
      { type: "select", row: 0, column: 1 }
    ]);
  });

  it("claims a certain mine before spending an available comeback bomb", () => {
    // Given one hidden neighbor of a clue and a four-point bot deficit
    const match = createMatch();
    match.players[1].score = 4;
    for (let row = 7; row <= 9; row += 1) {
      for (let column = 7; column <= 9; column += 1) {
        if (row !== 8 || column !== 9) {
          reveal(match, row, column, 1);
        }
      }
    }

    // When the bot selects an action
    const action = chooseSoloAction(match, BOT_ID);

    // Then it selects the certain mine and retains its turn
    expect(action).toEqual({ type: "select", row: 8, column: 9 });
  });

  it("ranks ambiguous clue neighbors ahead of the global fallback", () => {
    // Given a clue whose eight hidden neighbors have more mine probability than the board fallback
    const match = createMatch();
    match.board.mineCount = 1;
    reveal(match, 5, 5, 1);

    // When the bot selects an action
    const action = chooseSoloAction(match, BOT_ID);

    // Then stable row-column order chooses the first highest-probability cell
    expect(action).toEqual({ type: "select", row: 4, column: 4 });
  });

  it("uses a clipped edge bomb at a four-point deficit", () => {
    // Given an all-hidden board and an available bomb with a four-point deficit
    const match = createMatch();
    match.players[1].score = 4;

    // When the bot selects an action
    const action = chooseSoloAction(match, BOT_ID);

    // Then stable tie-breaking chooses the legal top-left bomb target
    expect(action).toEqual({ type: "bomb", row: 0, column: 0 });
  });

  it("does not spend a bomb below the deficit threshold or after it is spent", () => {
    // Given one three-point deficit and one spent-bomb four-point deficit
    const belowThreshold = createMatch();
    belowThreshold.players[1].score = 3;
    const spentBomb = createMatch();
    spentBomb.players[0].bombsRemaining = 0;
    spentBomb.players[1].score = 4;

    // When the bot selects actions
    const actions = [chooseSoloAction(belowThreshold, BOT_ID), chooseSoloAction(spentBomb, BOT_ID)];

    // Then both actions remain legal selects
    expect(actions).toEqual([
      { type: "select", row: 0, column: 0 },
      { type: "select", row: 0, column: 0 }
    ]);
  });

  it("returns null for no legal moves and contradictory public clues", () => {
    // Given a fully claimed board and a clue that exceeds its neighboring cells
    const noMoves = createMatch();
    for (let row = 0; row < 16; row += 1) {
      for (let column = 0; column < 16; column += 1) {
        claim(noMoves, row, column);
      }
    }
    const contradiction = createMatch();
    reveal(contradiction, 0, 0, 8);

    // When the bot selects an action
    const actions = [chooseSoloAction(noMoves, BOT_ID), chooseSoloAction(contradiction, BOT_ID)];

    // Then unsupported public facts fail closed without an illegal action
    expect(actions).toEqual([null, null]);
  });

  it("settles progressive facts within the bounded inference cap", () => {
    // Given one late clue that proves a mine and an earlier clue that depends on it
    const match = createMatch();
    match.board.mineCount = 13;
    const claims: [number, number][] = [
      [4, 4],
      [4, 5],
      [5, 4],
      [6, 4],
      [6, 5],
      [6, 6],
      [5, 7],
      [5, 8],
      [6, 8],
      [7, 6],
      [7, 7],
      [7, 8]
    ];
    for (const [row, column] of claims) {
      claim(match, row, column);
    }
    reveal(match, 5, 5, 7);
    reveal(match, 6, 7, 7);

    // When the bot propagates the public clues
    const action = chooseSoloAction(match, BOT_ID);

    // Then it reaches the second-round certain mine instead of failing at the first cap
    expect(action).toEqual({ type: "select", row: 4, column: 6 });
  });

  it("keeps dense public-clue evaluation within a deterministic cell-read bound", () => {
    // Given a fully revealed no-mine board with every local clue available
    const match = createMatch();
    match.board.mineCount = 0;
    for (let row = 0; row < 16; row += 1) {
      for (let column = 0; column < 16; column += 1) {
        reveal(match, row, column, 0);
      }
    }
    const getReads = countCellReads(match);

    // When the bot evaluates the dense public board
    const action = chooseSoloAction(match, BOT_ID);

    // Then it returns no legal move before more than the capped cell-read budget
    expect(action).toBeNull();
    expect(getReads()).toBeLessThanOrEqual(25000);
  });
});
