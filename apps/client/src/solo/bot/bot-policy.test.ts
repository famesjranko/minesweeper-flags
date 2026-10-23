import { describe, expect, it } from "vitest";
import type { BotAnalysis } from "./bot-analysis.js";
import { type Fact, readBoard } from "./bot-board.js";
import { decide } from "./bot-policy.js";
import { BOT_PROFILES, type BotProfile } from "./bot-profiles.js";
import {
  BOT_ID,
  createMatch,
  createSeededRandom,
  createSizedMatch,
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
    probabilities: board.hidden.map((hidden, cell) => (hidden ? (overrides.get(cell) ?? base) : 0))
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

const trailingByFour = () => {
  const match = createMatch();
  match.players[1].score = 4;
  return match;
};

describe("decide", () => {
  it("draws only from the topK best-scored cells even at a high temperature", () => {
    // Given three cells with descending probabilities above a flat field
    // And a profile that keeps two cells and weighs them almost equally
    const analysis = createAnalysis(
      0.1,
      new Map([
        [at(5, 5), 0.9],
        [at(5, 6), 0.8],
        [at(5, 7), 0.7]
      ])
    );
    const profile: BotProfile = { ...BOT_PROFILES.normal, topK: 2, temperature: 10 };

    // When the bot decides over many seeds
    const choices = new Set(decideOverSeeds(analysis, profile));

    // Then it only ever picks the two best cells
    expect(choices).toEqual(new Set(["select 5,5", "select 5,6"]));
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
      )
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
