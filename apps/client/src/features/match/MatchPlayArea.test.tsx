// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NO_LAST_MOVE_MARKS } from "../../entities/board/last-move.js";
import { MatchPlayArea } from "./MatchPlayArea.js";
import { getMatchPresentation } from "./match-presentation.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("lets a player zoom, select the same square, and return to the fitted board", () => {
  // Given a live match where the viewing player can choose a square
  const match: MatchStateDto = {
    roomId: "zoom-test",
    phase: "live",
    board: {
      rows: 2,
      columns: 2,
      mineCount: 1,
      cells: Array.from({ length: 2 }, (_, row) =>
        Array.from({ length: 2 }, (_, column) => ({
          row,
          column,
          status: "hidden",
          adjacentMines: null,
          claimedByPlayerId: null
        }))
      )
    },
    players: [
      {
        playerId: "blue",
        displayName: "Blue",
        score: 0,
        bombsRemaining: 1,
        connected: true,
        rematchRequested: false
      },
      {
        playerId: "red",
        displayName: "Red",
        score: 0,
        bombsRemaining: 1,
        connected: true,
        rematchRequested: false
      }
    ],
    currentTurnPlayerId: "blue",
    turnPhase: "awaiting_action",
    turnNumber: 1,
    winnerPlayerId: null,
    lastAction: null
  };
  const onCellSelect = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <MatchPlayArea
        match={match}
        currentPlayerId="blue"
        bombArmed={false}
        view={getMatchPresentation({ match, currentPlayerId: "blue", bombArmed: false })}
        lastMove={NO_LAST_MOVE_MARKS}
        onCellSelect={onCellSelect}
        onToggleBomb={vi.fn()}
        onRequestRematch={vi.fn()}
        onCancelRematch={vi.fn()}
        chatMessageCount={0}
        onOpenChat={vi.fn()}
      />
    )
  );

  try {
    // When the player zooms and selects row two, column two
    act(() => container.querySelector<HTMLButtonElement>(".arcade-zoom-button")?.click());
    act(() =>
      container.querySelector<HTMLButtonElement>("button[title='Row 2, Column 2']")?.click()
    );

    // Then zoom is active and the selected board coordinates are unchanged
    expect(container.querySelector(".arcade-zoom-button")?.getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(container.querySelector(".arcade-board-viewport")?.getAttribute("aria-label")).toContain(
      "Zoomed board"
    );
    expect(onCellSelect).toHaveBeenCalledExactlyOnceWith(1, 1);

    // And returning to fit mode restores the normal board label and zoom control
    act(() => container.querySelector<HTMLButtonElement>(".arcade-zoom-button")?.click());
    expect(container.querySelector(".arcade-zoom-button")?.getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(container.querySelector(".arcade-board-viewport")?.getAttribute("aria-label")).toBe(
      "Game board"
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
