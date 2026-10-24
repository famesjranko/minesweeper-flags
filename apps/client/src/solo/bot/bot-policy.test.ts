import type { MatchStateDto } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { analyse, type BotAnalysis } from "./bot-analysis.js";
import { type Fact, readBoard } from "./bot-board.js";
import { decide } from "./bot-policy.js";
import { BOT_PROFILES, type BotProfile } from "./bot-profiles.js";
import {
  BOT_ID,
  createMatch,
  createSeededRandom,
  createSizedMatch,
  lastActionAt,
  reveal,
  seeds
} from "./bot-test-support.js";

const at = (row: number, column: number): number => row * 16 + column;

// A hand-made analysis: every hidden cell gets `base` unless `overrides` names it.
const createAnalysis = (
  base: number,
  overrides: Map<number, number>,
  match = createMatch()
): BotAnalysis => {
  reveal(match, 15, 15, 0);
  const board = readBoard(match);
  return {
    board,
    facts: board.hidden.map((): Fact => "unknown"),
    probabilities: board.hidden.map((hidden, cell) => (hidden ? (overrides.get(cell) ?? base) : 0)),
    attention: null
  };
};

const decideOverSeeds = (
  analysis: BotAnalysis,
  profile: BotProfile,
  match = createMatch()
): string[] =>
  seeds(200).map((seed) => {
    const decision = decide({
      match,
      botPlayerId: BOT_ID,
      analysis,
      profile,
      random: createSeededRandom(seed)
    });
    return decision
      ? `${decision.action.type} ${decision.action.row},${decision.action.column}`
      : "none";
  });

// A 5×5 block of likely mines centred on (7,7): the bomb there covers all 25 of them,
// a centre one step along an axis covers 20, and a diagonal step covers 16.
const createMineBlock = (): Map<number, number> => {
  const block = new Map<number, number>();
  for (let row = 5; row <= 9; row += 1) {
    for (let column = 5; column <= 9; column += 1) {
      block.set(at(row, column), 0.9);
    }
  }
  return block;
};

// Cells (4,4) to (4,6) border the clue at (5,5), so they are plausible; (12,12) is far
// from every clue but rates better than two of them.
const createSpreadAnalysis = (): BotAnalysis => {
  const match = createMatch();
  reveal(match, 5, 5, 2);
  return createAnalysis(
    0.1,
    new Map([
      [at(4, 4), 0.6],
      [at(12, 12), 0.55],
      [at(4, 5), 0.5],
      [at(4, 6), 0.45]
    ]),
    match
  );
};

const looseSpread: BotProfile = {
  ...BOT_PROFILES.normal,
  choicePool: 3,
  choiceTemperature: 1,
  localityWeight: 0
};

const withAttention = (radius: number): BotProfile => ({
  ...BOT_PROFILES.normal,
  attentionRadius: radius
});

// The clue of 3 in the corner proves (0,1), (1,0), and (1,1) are mines.
const CORNER_MINES = new Set(["select 0,1", "select 1,0", "select 1,1"]);

const withCornerMines = (): MatchStateDto => {
  const match = createMatch();
  reveal(match, 0, 0, 3);
  return match;
};

// Analyses the public board the way the bot does, then decides over many seeds.
const playOverSeeds = (match: MatchStateDto, profile: BotProfile): string[] => {
  const analysis = analyse(match, profile.deduction, { attentionRadius: profile.attentionRadius });
  if (!analysis) {
    throw new Error("The test board must be consistent.");
  }
  return decideOverSeeds(analysis, profile, match);
};

const trailingByFour = () => {
  const match = createMatch();
  match.players[1].score = 4;
  return match;
};

describe("decide", () => {
  it("draws only from the pool's best-scored cells even at a high temperature", () => {
    // Given three plausible cells with descending probabilities above a flat field
    // And a profile that pools two cells and weighs them almost equally
    const match = createMatch();
    reveal(match, 4, 6, 3);
    const analysis = createAnalysis(
      0.1,
      new Map([
        [at(5, 5), 0.9],
        [at(5, 6), 0.8],
        [at(5, 7), 0.7]
      ]),
      match
    );
    const profile: BotProfile = { ...BOT_PROFILES.normal, choicePool: 2, choiceTemperature: 10 };

    // When the bot decides over many seeds
    const choices = new Set(decideOverSeeds(analysis, profile));

    // Then it only ever picks the two best cells
    expect(choices).toEqual(new Set(["select 5,5", "select 5,6"]));
  });

  it("sometimes takes a less-than-best plausible cell at a loose spread", () => {
    // Given a best cell and two worse plausible cells
    const analysis = createSpreadAnalysis();

    // When a bot with a loose spread decides over many seeds
    const choices = new Set(decideOverSeeds(analysis, looseSpread));

    // Then it takes each of the worse plausible cells at least once
    expect(choices).toContain("select 4,5");
    expect(choices).toContain("select 4,6");
  });

  it("never spreads to a far cell while plausible cells exist", () => {
    // Given a far cell that rates better than two plausible cells
    const analysis = createSpreadAnalysis();

    // When a bot with a loose spread decides over many seeds
    const choices = new Set(decideOverSeeds(analysis, looseSpread));

    // Then it never takes the far cell
    expect(choices).not.toContain("select 12,12");
  });

  it("keeps a loose spread on the best cell when it is the only plausible one", () => {
    // Given a 1×12 strip whose only clue makes (0,1) the single plausible cell
    // And (0,1) rates better than every far cell
    const match = createSizedMatch(1, 12, 3);
    reveal(match, 0, 0, 1);
    const board = readBoard(match);
    const analysis: BotAnalysis = {
      board,
      facts: board.hidden.map((): Fact => "unknown"),
      probabilities: board.hidden.map((hidden, cell) => (!hidden ? 0 : cell === 1 ? 0.6 : 0.3)),
      attention: null
    };

    // When a bot with a loose spread decides over many seeds
    const choices = new Set(decideOverSeeds(analysis, looseSpread, match));

    // Then it always takes the plausible cell rather than a worse far one
    expect(choices).toEqual(new Set(["select 0,1"]));
  });

  it("does not notice a certain mine outside its attention", () => {
    // Given a last action at (14,12) whose clue leaves plausible cells near it
    // And the clue of 3 at (11,12), three steps away, proves the mines at (10,11) to (10,13), four steps away
    const match = createMatch();
    for (const [row, column, clue] of [
      [11, 11, 2],
      [11, 12, 3],
      [11, 13, 2],
      [12, 11, 0],
      [12, 12, 0],
      [12, 13, 0],
      [14, 12, 2]
    ] as const) {
      reveal(match, row, column, clue);
    }
    lastActionAt(match, 14, 12);

    // When a bot with an attention radius of 2 decides over many seeds
    const choices = playOverSeeds(match, withAttention(2));

    // Then it never takes a proven mine
    expect(choices.filter((choice) => choice.startsWith("select 10,"))).toEqual([]);
  });

  it("always takes a certain mine inside its attention, even when it could bomb", () => {
    // Given proven mines in the top-left corner
    // And a last action at (3,3), so only the mine at (1,1) lies within two steps
    // And a four-point deficit that allows a bomb
    const match = withCornerMines();
    reveal(match, 3, 3, 1);
    lastActionAt(match, 3, 3);
    match.players[1].score = 4;

    // When a bot with an attention radius of 2 decides over many seeds
    const choices = new Set(playOverSeeds(match, withAttention(2)));

    // Then it always takes the proven mine at (1,1)
    expect(choices).toEqual(new Set(["select 1,1"]));
  });

  it("widens its attention until a plausible cell is in reach", () => {
    // Given a last action at (8,8) inside a revealed 3×3 block, so nothing within one step is hidden
    // And the block's clues leave plausible cells two steps away
    // And a clue of 8 at (8,12) proves mines three steps away
    const match = createMatch();
    for (let row = 7; row <= 9; row += 1) {
      for (let column = 7; column <= 9; column += 1) {
        reveal(match, row, column, row === 8 && column === 8 ? 0 : 1);
      }
    }
    reveal(match, 8, 12, 8);
    lastActionAt(match, 8, 8);

    // When a bot with an attention radius of 1 decides over many seeds
    const choices = playOverSeeds(match, withAttention(1));

    // Then every pick lies two steps from the last action, where the widened attention ends
    const steps = choices.map((choice) => {
      const [row, column] = choice.replace("select ", "").split(",").map(Number);
      return Math.max(Math.abs(row! - 8), Math.abs(column! - 8));
    });
    expect(new Set(steps)).toEqual(new Set([2]));
  });

  it("notices the whole board before any action", () => {
    // Given proven mines in the top-left corner and a plausible clue far from them
    // And no last action
    const match = withCornerMines();
    reveal(match, 14, 12, 2);

    // When a bot with an attention radius of 2 decides over many seeds
    const choices = playOverSeeds(match, withAttention(2));

    // Then it always takes one of the proven mines
    expect(choices.every((choice) => CORNER_MINES.has(choice))).toBe(true);
  });

  it("bombs the centre with the best expected yield every time at hard", () => {
    // Given a block of likely mines and a four-point deficit
    const analysis = createAnalysis(0.1, createMineBlock());

    // When the hard bot decides over many seeds
    const choices = new Set(decideOverSeeds(analysis, BOT_PROFILES.hard, trailingByFour()));

    // Then it always bombs the block's centre
    expect(choices).toEqual(new Set(["bomb 7,7"]));
  });

  it("bombs where the clamped square covers the likely mines on a board shorter than the bomb", () => {
    // Given a 4×6 board whose likely mines fill the last column and a four-point deficit
    // And the engine clamps the 5×5 bomb to all four rows and columns 1 to 5 for centres in column 3 or later
    const match = createSizedMatch(4, 6, 6);
    match.players[1].score = 4;
    reveal(match, 0, 0, 0);
    const board = readBoard(match);
    const analysis: BotAnalysis = {
      board,
      facts: board.hidden.map((): Fact => "unknown"),
      probabilities: board.hidden.map((hidden, cell) =>
        hidden ? (cell % 6 === 5 ? 0.9 : 0.05) : 0
      ),
      attention: null
    };

    // When the hard bot decides over many seeds
    const columns = new Set(
      decideOverSeeds(analysis, BOT_PROFILES.hard, match).map((choice) => choice.split(",")[1])
    );

    // Then every bomb centre lies in column 3, 4, or 5
    expect([...columns].every((column) => ["3", "4", "5"].includes(column ?? ""))).toBe(true);
  });

  it.each(["normal", "easy"] as const)("draws a bomb from the best few centres at %s", (level) => {
    // Given a block of likely mines and a four-point deficit
    const analysis = createAnalysis(0.1, createMineBlock());

    // When the bot decides over many seeds
    const choices = new Set(decideOverSeeds(analysis, BOT_PROFILES[level], trailingByFour()));

    // Then it varies only between the centre and the four centres one step along an axis
    expect(choices).toEqual(new Set(["bomb 7,7", "bomb 6,7", "bomb 8,7", "bomb 7,6", "bomb 7,8"]));
  });
});
