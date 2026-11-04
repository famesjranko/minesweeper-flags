// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useMatchTitle } from "./useMatchTitle.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createMatch = (phase: "live" | "finished", winnerPlayerId: string | null = null) =>
  ({
    phase,
    winnerPlayerId,
    players: [
      { playerId: "me", displayName: "Me", score: 0 },
      { playerId: "them", displayName: "Bo", score: 0 }
    ]
  }) as unknown as MatchStateDto;

const Title = ({ match, canAct }: { match: MatchStateDto; canAct: boolean }) => {
  useMatchTitle(match, "me", canAct);
  return null;
};

const root = createRoot(document.createElement("div"));

afterEach(() => {
  act(() => root.render(null));
});

describe("useMatchTitle", () => {
  it.each([
    ["the player's turn", createMatch("live"), true, "Your turn · Minesweeper Flags"],
    ["the opponent's turn", createMatch("live"), false, "Minesweeper Flags"],
    ["a win", createMatch("finished", "me"), false, "You won · Minesweeper Flags"],
    ["a loss", createMatch("finished", "them"), false, "Bo won · Minesweeper Flags"]
  ])("shows the right title for %s", (_name, match, canAct, title) => {
    // Given a match in that state
    // When it renders
    act(() => root.render(<Title match={match} canAct={canAct} />));

    // Then the tab title says so
    expect(document.title).toBe(title);
  });

  it("restores the app title when the match leaves the screen", () => {
    // Given a tab showing the player's turn
    act(() => root.render(<Title match={createMatch("live")} canAct />));

    // When the match unmounts
    act(() => root.render(null));

    // Then the turn message is gone
    expect(document.title).toBe("Minesweeper Flags");
  });
});
