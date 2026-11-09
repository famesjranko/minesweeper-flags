import { createMatchState, resolveAction } from "@minesweeper-flags/game-engine";
import { toMatchStateDto } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import type { SoloDifficulty } from "./bot-profiles.js";
import { createSeededRandom, seeds } from "./bot-test-support.js";
import { chooseSoloAction } from "./solo-bot.js";

// Game counts and margins come from measured win rates. Over 1000 games hard
// beats normal about 62% of the time and normal beats easy about 95%. One game
// is noisy, so the closer pair needs more games for its margin to mean anything.
// On these seeds normal wins 95.5% against easy and 83.5% against easy's values
// before tuning, so the easy margin also catches a lost tuning.
const EASY_NORMAL_SEEDS = seeds(100);
const NORMAL_HARD_SEEDS = seeds(150);

const playGame = (seed: number, blue: SoloDifficulty, red: SoloDifficulty): SoloDifficulty => {
  let state = createMatchState({
    roomId: "strength",
    players: [
      { playerId: "blue", displayName: "Blue" },
      { playerId: "red", displayName: "Red" }
    ],
    seed,
    createdAt: 0,
    startingPlayerId: "blue"
  });
  const random = { blue: createSeededRandom(seed * 2), red: createSeededRandom(seed * 2 + 1) };
  while (state.phase === "live") {
    const playerId = state.currentTurnPlayerId === "blue" ? "blue" : "red";
    const difficulty = playerId === "blue" ? blue : red;
    const action = chooseSoloAction(toMatchStateDto(state), playerId, {
      difficulty,
      random: random[playerId]
    });
    if (!action) {
      throw new Error(`No action for ${difficulty} in game ${seed}.`);
    }
    const result = resolveAction(state, { ...action, playerId }, state.updatedAt + 1);
    if (!result.ok) {
      throw new Error(`Illegal action for ${difficulty} in game ${seed}: ${result.error}`);
    }
    state = result.state;
  }
  return state.winnerPlayerId === "blue" ? blue : red;
};

// Each seed is played twice with sides swapped, so neither level gains from moving first.
const winShare = (
  gameSeeds: number[],
  stronger: SoloDifficulty,
  weaker: SoloDifficulty
): number => {
  const winners = gameSeeds.flatMap((seed) => [
    playGame(seed, stronger, weaker),
    playGame(seed, weaker, stronger)
  ]);
  return winners.filter((winner) => winner === stronger).length / winners.length;
};

// The hard pair takes about 4 s alone and longer when the whole suite runs in
// parallel, so the default 5 s timeout would fail on load rather than on strength.
describe("solo bot strength", { timeout: 30_000 }, () => {
  it("lets normal beat easy by a clear margin over seeded games", () => {
    // Given normal and easy bots on 200 seeded games with sides swapped
    const gameSeeds = EASY_NORMAL_SEEDS;

    // When every game is played to the end
    const share = winShare(gameSeeds, "normal", "easy");

    // Then normal wins at least 90 percent of them
    expect(share).toBeGreaterThanOrEqual(0.9);
  });

  it("lets hard beat normal by a clear margin over seeded games", () => {
    // Given hard and normal bots on 300 seeded games with sides swapped
    const gameSeeds = NORMAL_HARD_SEEDS;

    // When every game is played to the end
    const share = winShare(gameSeeds, "hard", "normal");

    // Then hard wins at least 55 percent of them
    expect(share).toBeGreaterThanOrEqual(0.55);
  });
});
