// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoundPlayer } from "./sound-player.js";
import { setSoundEnabled } from "./sound-settings.js";
import { useMatchSounds } from "./useMatchSounds.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = "me";

const snapshot = (overrides: Partial<MatchStateDto> = {}): MatchStateDto => ({
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
      playerId: "them",
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

const revealed = snapshot({
  turnNumber: 2,
  lastAction: {
    type: "select",
    playerId: ME,
    row: 0,
    column: 0,
    outcome: "safe_reveal",
    revealedCount: 1,
    claimedMineCount: 0
  }
});

const Probe = ({ match, player }: { match: MatchStateDto; player: SoundPlayer }) => {
  useMatchSounds(match, ME, player);
  return null;
};

const setup = (initial: MatchStateDto) => {
  const play = vi.fn();
  const player: SoundPlayer = { play };
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (match: MatchStateDto) =>
    act(() => root.render(<Probe match={match} player={player} />));
  render(initial);
  return { play, render, unmount: () => act(() => root.unmount()) };
};

afterEach(() => {
  setSoundEnabled(true);
});

describe("useMatchSounds", () => {
  it("plays nothing on the first render", () => {
    // Given a hook mounted with a snapshot that has a last action
    const { play, unmount } = setup(revealed);

    // Then nothing played
    expect(play).not.toHaveBeenCalled();
    unmount();
  });

  it("plays the diffed sounds when a later snapshot arrives", () => {
    // Given a mounted hook on snapshot A
    const { play, render, unmount } = setup(snapshot());

    // When snapshot B with my reveal arrives
    render(revealed);

    // Then the reveal sound plays once
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith("reveal");
    unmount();
  });

  it("plays nothing when sound is disabled", () => {
    // Given sound switched off and a mounted hook on snapshot A
    setSoundEnabled(false);
    const { play, render, unmount } = setup(snapshot());

    // When snapshot B arrives
    render(revealed);

    // Then nothing plays
    expect(play).not.toHaveBeenCalled();
    unmount();
  });

  describe("vibration on a claim", () => {
    const claim = (playerId: string, outcome: "mine_claimed" | "bomb_used" = "mine_claimed") =>
      snapshot({
        turnNumber: 2,
        lastAction: {
          type: outcome === "bomb_used" ? "bomb" : "select",
          playerId,
          row: 0,
          column: 0,
          outcome,
          revealedCount: 1,
          claimedMineCount: 1
        }
      });
    const vibrate = vi.fn();

    beforeEach(() => {
      vibrate.mockClear();
      Object.defineProperty(window.navigator, "vibrate", { configurable: true, value: vibrate });
    });

    afterEach(() => {
      Reflect.deleteProperty(window.navigator, "vibrate");
    });

    it.each([
      ["a mine", "mine_claimed"],
      ["a bomb", "bomb_used"]
    ] as const)("buzzes when the player claims with %s", (_name, outcome) => {
      // Given a mounted hook on a quiet snapshot
      const { render, unmount } = setup(snapshot());

      // When the player's claim arrives
      render(claim(ME, outcome));

      // Then the phone buzzes once
      expect(vibrate).toHaveBeenCalledOnce();
      unmount();
    });

    it("stays still for the opponent's claim", () => {
      // Given a mounted hook on a quiet snapshot
      const { render, unmount } = setup(snapshot());

      // When the opponent claims a mine
      render(claim("them"));

      // Then the player's phone stays still
      expect(vibrate).not.toHaveBeenCalled();
      unmount();
    });

    it("stays still for a safe square", () => {
      // Given a mounted hook on a quiet snapshot
      const { render, unmount } = setup(snapshot());

      // When the player opens a safe square
      render(revealed);

      // Then nothing buzzes
      expect(vibrate).not.toHaveBeenCalled();
      unmount();
    });

    it("stays still when effects are switched off", () => {
      // Given the player muted the game
      setSoundEnabled(false);
      const { render, unmount } = setup(snapshot());

      // When they claim a mine
      render(claim(ME));

      // Then the mute also covers vibration
      expect(vibrate).not.toHaveBeenCalled();
      unmount();
    });

    it("does nothing where the browser cannot vibrate", () => {
      // Given a browser with no vibration API
      Reflect.deleteProperty(window.navigator, "vibrate");
      const { play, render, unmount } = setup(snapshot());

      // When the player claims a mine
      render(claim(ME));

      // Then the sound still plays and nothing throws
      expect(play).toHaveBeenCalledWith("flag");
      unmount();
    });
  });
});
