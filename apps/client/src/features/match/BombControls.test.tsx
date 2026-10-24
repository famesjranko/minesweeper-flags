// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_LAST_MOVE_MARKS } from "../../entities/board/last-move.js";
import { MatchPlayArea } from "./MatchPlayArea.js";
import { getMatchPresentation } from "./match-presentation.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createMatch = (): MatchStateDto => ({
  roomId: "bomb-controls",
  phase: "live",
  board: {
    rows: 2,
    columns: 2,
    // The bomb threshold scales with the mine count; the classic count keeps it at 4.
    mineCount: 51,
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
      score: 2,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: "red",
      displayName: "Red",
      score: 6,
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
});

let container: HTMLDivElement;
let root: Root;

const Controls = ({ match, onToggle }: { match: MatchStateDto; onToggle: () => void }) => {
  const [bombArmed, setBombArmed] = useState(false);
  return (
    <MatchPlayArea
      match={match}
      currentPlayerId="blue"
      bombArmed={bombArmed}
      view={getMatchPresentation({ match, currentPlayerId: "blue", bombArmed })}
      lastMove={NO_LAST_MOVE_MARKS}
      onCellSelect={() => {}}
      onToggleBomb={() => {
        setBombArmed(!bombArmed);
        onToggle();
      }}
      onRequestRematch={() => {}}
      onCancelRematch={() => {}}
      onResign={() => {}}
    />
  );
};

const render = (match: MatchStateDto) => {
  const onToggle = vi.fn();
  act(() => root.render(<Controls match={match} onToggle={onToggle} />));
  return {
    onToggle,
    bomb: container.querySelector<HTMLButtonElement>("button.inline-bomb")!
  };
};

describe("bomb controls", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([
    {
      reason: "below the four-flag threshold",
      deficit: 3,
      spent: false,
      finished: false,
      opponentTurn: false,
      detail: "trailing by 4 or more"
    },
    {
      reason: "waiting for the player's turn",
      deficit: 4,
      spent: false,
      finished: false,
      opponentTurn: true,
      detail: "Wait for your turn"
    },
    {
      reason: "already used",
      deficit: 4,
      spent: true,
      finished: false,
      opponentTurn: false,
      detail: "already been used"
    },
    {
      reason: "the match has finished",
      deficit: 4,
      spent: false,
      finished: true,
      opponentTurn: false,
      detail: "match has finished"
    }
  ])(
    "explains why a bomb is unavailable when $reason",
    ({ deficit, spent, finished, opponentTurn, detail }) => {
      // Given a match with the stated bomb restriction
      const match = createMatch();
      match.players[1].score = match.players[0].score + deficit;
      match.players[0].bombsRemaining = spent ? 0 : 1;
      match.phase = finished ? "finished" : "live";
      match.currentTurnPlayerId = finished ? null : opponentTurn ? "red" : "blue";
      const { bomb, onToggle } = render(match);

      // When the player tries to activate the unavailable bomb
      act(() => bomb.click());

      // Then the accessible reason matches the restriction and no action is sent
      expect(bomb.getAttribute("aria-label")).toContain(detail);
      expect(bomb.textContent).toBe("");
      expect(bomb.disabled).toBe(true);
      expect(bomb.getAttribute("aria-pressed")).toBe("false");
      expect(onToggle).not.toHaveBeenCalled();
    }
  );

  it("arms the bomb at the four-flag boundary and lets the player cancel targeting", () => {
    // Given an unused bomb on the trailing player's turn at exactly four behind
    const { bomb, onToggle } = render(createMatch());
    expect(bomb.getAttribute("aria-label")).toContain("click to arm");
    expect(bomb.disabled).toBe(false);

    // When the player arms the bomb and then cancels it
    act(() => bomb.click());
    expect(bomb.getAttribute("aria-label")).toContain("cancel targeting");
    expect(container.querySelector("[role=status]")?.textContent).toContain(
      "Bomb armed · tap a square"
    );
    expect(bomb.getAttribute("aria-pressed")).toBe("true");
    act(() => bomb.click());

    // Then targeting is canceled and the bomb remains available
    expect(bomb.getAttribute("aria-label")).toContain("click to arm");
    expect(bomb.getAttribute("aria-pressed")).toBe("false");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("disarms an armed bomb from the Cancel button in the status strip", () => {
    // Given a player who has armed the bomb
    const { bomb, onToggle } = render(createMatch());
    act(() => bomb.click());

    // When the player presses Cancel in the status strip
    const cancel = container.querySelector<HTMLButtonElement>(
      ".arcade-match-status button.arcade-bomb-cancel"
    );
    act(() => cancel?.click());

    // Then the bomb is disarmed, stays available, and the Cancel button is gone
    expect(cancel?.textContent).toBe("Cancel");
    expect(bomb.getAttribute("aria-pressed")).toBe("false");
    expect(bomb.disabled).toBe(false);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".arcade-bomb-cancel")).toBeNull();
    expect(container.querySelector("[role=status]")?.textContent).not.toContain("Bomb armed");
  });

  it("offers no bomb Cancel button while the bomb is not armed", () => {
    // Given a player whose bomb is ready but not armed
    render(createMatch());

    // When the status strip renders
    const cancel = container.querySelector(".arcade-bomb-cancel");

    // Then there is nothing to cancel
    expect(cancel).toBeNull();
  });
});
