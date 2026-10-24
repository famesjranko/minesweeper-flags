// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
