import type { MatchStateDto } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { diffMatchSounds } from "./match-sound-events.js";

type Action = NonNullable<MatchStateDto["lastAction"]>;

const ME = "me";
const THEM = "them";

const action = (overrides: Partial<Action> = {}): Action => ({
  type: "select",
  playerId: ME,
  row: 1,
  column: 1,
  outcome: "safe_reveal",
  revealedCount: 1,
  claimedMineCount: 0,
  ...overrides
});

const match = (overrides: Partial<MatchStateDto> = {}): MatchStateDto => ({
  roomId: "room",
  phase: "live",
  board: { rows: 1, columns: 1, mineCount: 1, cells: [] },
  players: [
    {
      playerId: ME,
      displayName: "Me",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: THEM,
      displayName: "Them",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    }
  ],
  currentTurnPlayerId: ME,
  turnPhase: "awaiting_action",
  turnNumber: 1,
  winnerPlayerId: null,
  lastAction: null,
  ...overrides
});

describe("diffMatchSounds", () => {
  it("stays silent for the first snapshot", () => {
    // Given no previous snapshot and a live match on my turn with a past action
    const next = match({ turnNumber: 4, lastAction: action({ playerId: THEM }) });

    // When the first snapshot is diffed
    const sounds = diffMatchSounds(null, next, ME);

    // Then nothing plays
    expect(sounds).toEqual([]);
  });

  it.each([
    ["safe_reveal", "reveal"],
    ["mine_claimed", "flag"],
    ["bomb_used", "bomb"]
  ] as const)("maps a %s outcome to the %s sound", (outcome, expected) => {
    // Given my own move that keeps the turn
    const previous = match({ turnNumber: 1 });
    const next = match({ turnNumber: 2, lastAction: action({ outcome }) });

    // When the snapshots are diffed
    const sounds = diffMatchSounds(previous, next, ME);

    // Then the matching move sound plays
    expect(sounds).toEqual([expected]);
  });

  it("also sounds the opponent's move and tells me it is my turn", () => {
    // Given the opponent revealed a cell and the turn passed to me
    const previous = match({ currentTurnPlayerId: THEM, turnNumber: 1 });
    const next = match({
      currentTurnPlayerId: ME,
      turnNumber: 2,
      lastAction: action({ playerId: THEM })
    });

    // When the snapshots are diffed
    const sounds = diffMatchSounds(previous, next, ME);

    // Then the move sound comes first, then your-turn
    expect(sounds).toEqual(["reveal", "your-turn"]);
  });

  it("does not announce my turn when I claim a mine and keep the turn", () => {
    // Given I held the turn before and after claiming a mine
    const previous = match({ currentTurnPlayerId: ME, turnNumber: 1 });
    const next = match({
      currentTurnPlayerId: ME,
      turnNumber: 2,
      lastAction: action({ outcome: "mine_claimed" })
    });

    // When the snapshots are diffed
    const sounds = diffMatchSounds(previous, next, ME);

    // Then only the flag sound plays
    expect(sounds).toEqual(["flag"]);
  });

  it("does not announce my turn when it passes to the opponent", () => {
    // Given I revealed a safe cell and the turn passed away from me
    const previous = match({ currentTurnPlayerId: ME, turnNumber: 1 });
    const next = match({ currentTurnPlayerId: THEM, turnNumber: 2, lastAction: action() });

    // When the snapshots are diffed
    const sounds = diffMatchSounds(previous, next, ME);

    // Then only the reveal sound plays
    expect(sounds).toEqual(["reveal"]);
  });

  it.each([
    [ME, "win"],
    [THEM, "lose"],
    [null, "lose"]
  ] as const)(
    "plays the result sound for winner %s as %s without your-turn",
    (winnerPlayerId, expected) => {
      // Given a final move that ends the match with the turn on me
      const previous = match({ turnNumber: 1 });
      const next = match({
        phase: "finished",
        turnPhase: "ended",
        winnerPlayerId,
        turnNumber: 2,
        currentTurnPlayerId: ME,
        lastAction: action({ outcome: "mine_claimed" })
      });

      // When the snapshots are diffed
      const sounds = diffMatchSounds(previous, next, ME);

      // Then the flag sound is followed by the result and no your-turn
      expect(sounds).toEqual(["flag", expected]);
    }
  );

  it("plays only lose when a resign ends the match with the last action unchanged", () => {
    // Given a resign that finishes the match while lastAction stays the same
    const last = action({ playerId: THEM });
    const previous = match({ turnNumber: 3, lastAction: last, currentTurnPlayerId: ME });
    const next = match({
      phase: "finished",
      turnPhase: "ended",
      turnNumber: 3,
      lastAction: { ...last },
      winnerPlayerId: THEM,
      currentTurnPlayerId: null
    });

    // When the snapshots are diffed
    const sounds = diffMatchSounds(previous, next, ME);

    // Then only lose plays
    expect(sounds).toEqual(["lose"]);
  });

  it("stays silent for an identical replayed snapshot", () => {
    // Given the same snapshot delivered twice, finished included
    const snapshot = match({
      phase: "finished",
      winnerPlayerId: ME,
      turnNumber: 5,
      lastAction: action()
    });

    // When the second delivery is diffed against the first
    const sounds = diffMatchSounds(snapshot, { ...snapshot }, ME);

    // Then nothing plays
    expect(sounds).toEqual([]);
  });

  it("sounds a new match whose first move reuses the old turnNumber", () => {
    // Given a rematch whose first move has the old match's turnNumber but another cell
    const previous = match({ turnNumber: 2, lastAction: action({ row: 0, column: 0 }) });
    const next = match({ turnNumber: 2, lastAction: action({ row: 3, column: 3 }) });

    // When the snapshots are diffed
    const sounds = diffMatchSounds(previous, next, ME);

    // Then the move sound plays
    expect(sounds).toEqual(["reveal"]);
  });
  it("sounds a repeated action on a later turn", () => {
    // Given the same cell and player acting again on a higher turnNumber
    const previous = match({ turnNumber: 2, lastAction: action() });
    const next = match({ turnNumber: 3, lastAction: action() });

    // When the snapshots are diffed
    const sounds = diffMatchSounds(previous, next, ME);

    // Then the move sound plays
    expect(sounds).toEqual(["reveal"]);
  });

  it("does not announce my turn while the match is not live", () => {
    // Given the turn pointing at me in a waiting room snapshot
    const previous = match({ phase: "waiting", currentTurnPlayerId: null });
    const next = match({ phase: "waiting", currentTurnPlayerId: ME });

    // When the snapshots are diffed
    const sounds = diffMatchSounds(previous, next, ME);

    // Then nothing plays
    expect(sounds).toEqual([]);
  });
});
