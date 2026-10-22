import { createBoard, createMatchState, resolveAction } from "@minesweeper-flags/game-engine";
import { type MatchStateDto, toMatchStateDto } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import type { SoloDifficulty } from "./bot-profiles.js";
import {
  BOT_ID,
  claim,
  createMatch,
  createSeededRandom,
  createSizedMatch,
  HUMAN_ID,
  reveal,
  seeds
} from "./bot-test-support.js";
import { chooseSoloAction, decideSoloAction } from "./solo-bot.js";

const LEVELS: SoloDifficulty[] = ["easy", "normal", "hard"];

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

const key = (action: { row: number; column: number } | null | undefined): string =>
  action ? `${action.row},${action.column}` : "none";

const choicesOverSeeds = (
  match: MatchStateDto,
  difficulty: SoloDifficulty,
  count: number
): ReturnType<typeof chooseSoloAction>[] =>
  seeds(count).map((seed) =>
    chooseSoloAction(match, BOT_ID, { difficulty, random: createSeededRandom(seed) })
  );

const withCertainMineCorners = (): MatchStateDto => {
  // Each corner clue of 3 proves its three hidden neighbours are mines.
  const match = createMatch();
  reveal(match, 0, 0, 3);
  reveal(match, 15, 15, 3);
  match.lastAction = {
    type: "select",
    playerId: HUMAN_ID,
    row: 14,
    column: 12,
    outcome: "safe_reveal",
    revealedCount: 1,
    claimedMineCount: 0
  };
  reveal(match, 14, 12, 2);
  return match;
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

  it.each(LEVELS)("makes the same %s decision from paired public worlds and seeds", (level) => {
    // Given two independent DTOs with the same revealed corner clue and the same random seed
    const first = createMatch();
    const second = createMatch();
    reveal(first, 0, 0, 1);
    reveal(second, 0, 0, 1);

    // When the bot selects from each public DTO
    const actions = [first, second].map((match) =>
      chooseSoloAction(match, BOT_ID, { difficulty: level, random: createSeededRandom(7) })
    );

    // Then both decisions are the same select on a neighbour of the clue
    expect(actions[0]).toEqual(actions[1]);
    expect(["0,1", "1,0", "1,1"]).toContain(key(actions[0]));
  });

  it.each(LEVELS)("claims a certain mine before spending a comeback bomb at %s", (level) => {
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

    // When the bot decides an action
    const decision = decideSoloAction(match, BOT_ID, {
      difficulty: level,
      random: createSeededRandom(1)
    });

    // Then it selects the certain mine and reports it as certain
    expect(decision).toEqual({ action: { type: "select", row: 8, column: 9 }, kind: "certain" });
  });

  it.each(LEVELS)("claims the certain mine nearest the last action at %s", (level) => {
    // Given proven mines in two corners and a last action two cells from the bottom-right corner
    const match = withCertainMineCorners();

    // When the bot chooses over many seeds
    const choices = new Set(choicesOverSeeds(match, level, 40).map(key));

    // Then it always takes one of the two nearest proven mines, choosing between them at random
    expect(choices).toEqual(new Set(["14,14", "15,14"]));
  });

  it.each(LEVELS)("spreads equal clue neighbours across seeds at %s", (level) => {
    // Given a clue whose eight hidden neighbours share more mine probability than the fallback
    const match = createMatch();
    match.board.mineCount = 1;
    reveal(match, 5, 5, 1);
    const neighbours = ["4,4", "4,5", "4,6", "5,4", "5,6", "6,4", "6,5", "6,6"];

    // When the bot chooses over many seeds
    const choices = new Set(choicesOverSeeds(match, level, 100).map(key));

    // Then every choice is a clue neighbour and no board position is favoured
    expect(choices).toEqual(new Set(neighbours));
  });

  it("spreads opening picks instead of always starting in a corner", () => {
    // Given an all-hidden board
    const match = createMatch();

    // When the bot opens over 400 seeds
    const choices = choicesOverSeeds(match, "normal", 400).map(key);

    // Then (0,0) is under 5 percent of openings
    // And the openings cover many distinct cells
    expect(choices.filter((choice) => choice === "0,0").length).toBeLessThan(20);
    expect(new Set(choices).size).toBeGreaterThan(100);
  });

  it("favours the middle of the board for an opening", () => {
    // Given an all-hidden board
    const match = createMatch();

    // When the bot opens over 400 seeds
    const choices = choicesOverSeeds(match, "normal", 400);

    // Then more than 40 percent land in the central 8×8 block, which holds a quarter of the cells
    const central = choices.filter(
      (action) =>
        !!action && action.row >= 4 && action.row <= 11 && action.column >= 4 && action.column <= 11
    );
    expect(central.length / choices.length).toBeGreaterThan(0.4);
  });

  it.each([
    { name: "a blind opening", kind: "guess", setup: (_: MatchStateDto) => undefined },
    {
      name: "a clue neighbour",
      kind: "frontier",
      setup: (match: MatchStateDto) => {
        match.board.mineCount = 1;
        reveal(match, 5, 5, 1);
      }
    },
    {
      name: "a comeback bomb",
      kind: "bomb",
      setup: (match: MatchStateDto) => {
        match.players[1].score = 4;
      }
    }
  ])("reports $name as $kind", ({ kind, setup }) => {
    // Given a board prepared for the case
    const match = createMatch();
    setup(match);

    // When the bot decides an action
    const decision = decideSoloAction(match, BOT_ID, { random: createSeededRandom(3) });

    // Then the decision reports why it was chosen
    expect(decision?.kind).toBe(kind);
  });

  it.each(LEVELS)("spends the comeback bomb at a four-point deficit at %s", (level) => {
    // Given an all-hidden board and an available bomb with a four-point deficit
    const match = createMatch();
    match.players[1].score = 4;

    // When the bot chooses over many seeds
    const actions = choicesOverSeeds(match, level, 20);

    // Then every action is a bomb
    // And equal-yield centres are not resolved by board position
    expect(actions.every((action) => action?.type === "bomb")).toBe(true);
    expect(new Set(actions.map(key)).size).toBeGreaterThan(1);
  });

  it.each(LEVELS)(
    "does not spend a bomb below the threshold or after it is spent at %s",
    (level) => {
      // Given one three-point deficit and one spent-bomb four-point deficit
      const belowThreshold = createMatch();
      belowThreshold.players[1].score = 3;
      const spentBomb = createMatch();
      spentBomb.players[0].bombsRemaining = 0;
      spentBomb.players[1].score = 4;

      // When the bot selects actions
      const actions = [belowThreshold, spentBomb].map((match) =>
        chooseSoloAction(match, BOT_ID, { difficulty: level, random: createSeededRandom(1) })
      );

      // Then both actions remain selects
      expect(actions.map((action) => action?.type)).toEqual(["select", "select"]);
    }
  );

  it.each(LEVELS)("returns null for no legal moves and contradictory clues at %s", (level) => {
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
    const actions = [noMoves, contradiction].map((match) =>
      chooseSoloAction(match, BOT_ID, { difficulty: level })
    );

    // Then unsupported public facts fail closed without an illegal action
    expect(actions).toEqual([null, null]);
  });

  it.each(["normal", "hard"] as const)(
    "settles progressive facts within the bounded inference cap at %s",
    (level) => {
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
      const action = chooseSoloAction(match, BOT_ID, {
        difficulty: level,
        random: createSeededRandom(1)
      });

      // Then it reaches the second-round certain mine instead of failing at the first cap
      expect(action).toEqual({ type: "select", row: 4, column: 6 });
    }
  );

  it.each(LEVELS)("keeps dense public-clue evaluation within a cell-read bound at %s", (level) => {
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
    const action = chooseSoloAction(match, BOT_ID, { difficulty: level });

    // Then it returns no legal move before more than the capped cell-read budget
    expect(action).toBeNull();
    expect(getReads()).toBeLessThanOrEqual(25000);
  });
});

const BOARD_SIZES = [
  { rows: 8, columns: 8, mineCount: 13 },
  { rows: 9, columns: 12, mineCount: 20 },
  { rows: 5, columns: 5, mineCount: 5 }
];

const playSizedGame = (
  size: (typeof BOARD_SIZES)[number],
  level: SoloDifficulty,
  seed: number
): { phase: string; illegal: string[] } => {
  let state = {
    ...createMatchState({
      roomId: "sized",
      players: [
        { playerId: "blue", displayName: "Blue" },
        { playerId: "red", displayName: "Red" }
      ],
      seed,
      createdAt: 0,
      startingPlayerId: "blue"
    }),
    board: createBoard(seed, size)
  };
  const random = createSeededRandom(seed);
  const illegal: string[] = [];
  // Every legal move reveals or claims at least one cell, so the board bounds the game.
  for (let move = 0; move < size.rows * size.columns && state.phase === "live"; move += 1) {
    const playerId = state.currentTurnPlayerId ?? "blue";
    const action = chooseSoloAction(toMatchStateDto(state), playerId, {
      difficulty: level,
      random
    });
    const result = action
      ? resolveAction(state, { ...action, playerId }, state.updatedAt + 1)
      : null;
    if (!result?.ok) {
      illegal.push(`${move}: ${result ? result.error : "no action"}`);
      break;
    }
    state = result.state;
  }
  return { phase: state.phase, illegal };
};

describe("chooseSoloAction on other board sizes", () => {
  it.each(LEVELS.flatMap((level) => BOARD_SIZES.map((size) => ({ level, ...size }))))(
    "plays legal moves to the end of a $rows×$columns game at $level",
    ({ level, ...size }) => {
      // Given seeded engine games on a board of this size
      const gameSeeds = seeds(5);

      // When the bot plays both sides until the game ends
      const games = gameSeeds.map((seed) => playSizedGame(size, level, seed));

      // Then every game finishes without an illegal or missing move
      expect(games).toEqual(gameSeeds.map(() => ({ phase: "finished", illegal: [] })));
    }
  );

  it.each(LEVELS)("claims a certain mine in the far corner of a 9×12 board at %s", (level) => {
    // Given a 9×12 board whose bottom-right corner clue of 3 proves its three neighbours are mines
    const match = createSizedMatch(9, 12, 20);
    reveal(match, 8, 11, 3);

    // When the bot decides over many seeds
    const choices = new Set(choicesOverSeeds(match, level, 30).map(key));

    // Then it only ever claims those three proven mines
    expect(choices).toEqual(new Set(["7,10", "7,11", "8,10"]));
  });

  it.each([
    {
      name: "a row shorter than the column count",
      malform: (match: MatchStateDto) => {
        match.board.cells[3]!.pop();
      }
    },
    {
      name: "fewer rows than the row count",
      malform: (match: MatchStateDto) => {
        match.board.cells.pop();
      }
    },
    {
      name: "a cell at the wrong position",
      malform: (match: MatchStateDto) => {
        match.board.cells[2]![4]!.column = 5;
      }
    },
    {
      name: "more mines than cells",
      malform: (match: MatchStateDto) => {
        match.board.mineCount = 9 * 12 + 1;
      }
    }
  ])("rejects a board DTO with $name", ({ malform }) => {
    // Given a 9×12 board DTO that disagrees with itself
    const match = createSizedMatch(9, 12, 20);
    malform(match);

    // When the bot selects an action
    const action = chooseSoloAction(match, BOT_ID);

    // Then it has no action
    expect(action).toBeNull();
  });
});
