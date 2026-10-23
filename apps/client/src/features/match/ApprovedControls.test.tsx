// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NO_LAST_MOVE_MARKS } from "../../entities/board/last-move.js";
import { MatchPlayArea } from "./MatchPlayArea.js";
import { getMatchPresentation } from "./match-presentation.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createMatch = (): MatchStateDto => ({
  roomId: "approved-controls",
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
      displayName: "Full Blue Name",
      score: 4,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: "red",
      displayName: "Full Red Name",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    }
  ],
  currentTurnPlayerId: "red",
  turnPhase: "awaiting_action",
  turnNumber: 2,
  winnerPlayerId: null,
  lastAction: null
});

const onRequest = vi.fn();
const onCancel = vi.fn();
const onSelect = vi.fn();
const onToggle = vi.fn();
const onResign = vi.fn();
const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const Scene = ({
  match,
  connected = true,
  solo = false
}: {
  match: MatchStateDto;
  connected?: boolean;
  solo?: boolean;
}) => {
  const [bombArmed, setBombArmed] = useState(false);
  return (
    <MatchPlayArea
      match={match}
      currentPlayerId="red"
      bombArmed={bombArmed}
      view={getMatchPresentation({
        match,
        currentPlayerId: "red",
        bombArmed,
        connectionStatus: connected ? "connected" : "disconnected"
      })}
      lastMove={NO_LAST_MOVE_MARKS}
      onToggleBomb={() => {
        setBombArmed(!bombArmed);
        onToggle();
      }}
      onCellSelect={(row, column) => onSelect(row, column, bombArmed)}
      onRequestRematch={onRequest}
      onCancelRematch={onCancel}
      onResign={onResign}
      resignDisabled={!connected}
      solo={solo ? { botThinking: false } : undefined}
    />
  );
};

const render = (match: MatchStateDto, connected = true) => {
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Scene match={match} connected={connected} />));
};

it("keeps Red as You and routes only the local inline bomb through arm, cancel and board selection", () => {
  // Given Red is the local player and trails by four on their turn
  render(createMatch());
  const red = container.querySelector(".sidebar-player-panel-red")!;
  const blue = container.querySelector(".sidebar-player-panel-blue")!;
  const bomb = red.querySelector<HTMLButtonElement>("button.inline-bomb")!;
  expect(red.textContent).toContain("RED · You");
  expect(red.querySelector(".sidebar-player-name")?.getAttribute("title")).toBe("Full Red Name");
  expect(blue.querySelector("button")).toBeNull();
  expect(blue.querySelector(".inline-bomb")?.getAttribute("aria-label")).toContain(
    "Opponent bomb unused"
  );

  // When the player arms, cancels and then arms before selecting a square
  act(() => bomb.click());
  expect(bomb.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector("[role=status]")?.textContent).toContain(
    "Bomb armed · tap a square"
  );
  act(() => bomb.click());
  expect(bomb.getAttribute("aria-pressed")).toBe("false");
  act(() => bomb.click());
  act(() => container.querySelector<HTMLButtonElement>("button[title='Row 2, Column 1']")!.click());

  // Then only the local control toggles and the board receives the armed selection
  expect(onToggle).toHaveBeenCalledTimes(3);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(1, 0, true);
  expect(container.querySelectorAll("button.inline-bomb")).toHaveLength(1);
});

it("disables local bomb and board input when the connection is lost", () => {
  // Given an otherwise eligible local bomb with a disconnected client
  render(createMatch(), false);
  const bomb = container.querySelector<HTMLButtonElement>("button.inline-bomb")!;
  const cell = container.querySelector<HTMLButtonElement>("button[title='Row 1, Column 1']")!;

  // When the player tries both controls
  act(() => {
    bomb.click();
    cell.click();
  });

  // Then neither action is sent and the bomb exposes its waiting state
  expect(bomb.disabled).toBe(true);
  expect(cell.disabled).toBe(true);
  expect(bomb.getAttribute("aria-label")).toContain("connection");
  expect(onToggle).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});

it.each([
  [7, 3],
  [0, 0]
])("uses the declared Red winner after resignation at %i–%i", (blueScore, redScore) => {
  // Given Blue resigned and Red won with a lower or equal score
  const match = createMatch();
  match.phase = "finished";
  match.currentTurnPlayerId = null;
  match.turnPhase = "ended";
  match.winnerPlayerId = "red";
  match.players[0].score = blueScore;
  match.players[1].score = redScore;

  // When the finished controls render
  render(match);
  const status = container.querySelector("[role=status]")!;
  const scores = container.querySelector(".arcade-match-scores")!;

  // Then one persistent strip gives the declared winner and winner-first resignation score
  expect(status.textContent).toContain(`You won · ${redScore} – ${blueScore} by resignation`);
  expect(container.querySelectorAll("[role=status]")).toHaveLength(1);
  expect(status.compareDocumentPosition(scores) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelectorAll(".winner-crown")).toHaveLength(1);
  expect(
    container.querySelector(".sidebar-player-panel-red .sidebar-player-name .winner-crown")
  ).not.toBeNull();
  expect(container.querySelector(".sidebar-player-panel-blue .winner-crown")).toBeNull();
  expect(container.querySelector(".sidebar-player-panel.is-turn")).toBeNull();
  expect(container.querySelectorAll(".match-primary-action")).toHaveLength(1);
  expect(container.querySelector(".match-result-overlay")).toBeNull();
});

it("keeps finished zoom and the single Request, Cancel or Accept rematch action usable", () => {
  // Given a finished friend match with no rematch request
  const match = createMatch();
  match.phase = "finished";
  match.turnPhase = "ended";
  match.currentTurnPlayerId = null;
  match.winnerPlayerId = "blue";
  render(match);
  const zoom = container.querySelector<HTMLButtonElement>(".arcade-zoom-button")!;
  const primary = () => container.querySelector<HTMLButtonElement>(".match-primary-action")!;

  // When the player expands the finished board and requests a rematch
  act(() => {
    zoom.click();
    primary().click();
  });

  // Then zoom stays available and the request callback runs once
  expect(zoom.getAttribute("aria-label")).toBe("Fit board");
  expect(container.querySelector(".arcade-board-viewport.is-zoomed")).not.toBeNull();
  expect(onRequest).toHaveBeenCalledOnce();

  // When their request is acknowledged and then replaced by an opponent request
  match.players[1].rematchRequested = true;
  act(() => root.render(<Scene match={match} />));
  expect(primary().textContent).toBe("Cancel rematch");
  act(() => primary().click());
  expect(onCancel).toHaveBeenCalledOnce();
  match.players[1].rematchRequested = false;
  match.players[0].rematchRequested = true;
  act(() => root.render(<Scene match={match} />));
  expect(primary().textContent).toBe("Accept rematch");
  act(() => {
    primary().click();
    zoom.click();
  });

  // Then acceptance uses the request callback and Fit restores the board
  expect(onRequest).toHaveBeenCalledTimes(2);
  expect(zoom.getAttribute("aria-label")).toBe("Expand board to 150%");
  expect(container.querySelectorAll(".match-primary-action")).toHaveLength(1);
  expect(container.querySelector(".arcade-board-viewport.is-zoomed")).toBeNull();
});

it("shows opponent availability without an action and preserves both spent bombs after finish", () => {
  // Given Blue is trailing on their turn while Red views the match
  const match = createMatch();
  match.players[0].score = 0;
  match.players[1].score = 4;
  match.currentTurnPlayerId = "blue";
  render(match);
  const opponent = container.querySelector(".sidebar-player-panel-blue .inline-bomb")!;
  expect(opponent.getAttribute("aria-label")).toBe("Opponent bomb available.");
  expect(opponent.tagName).toBe("SPAN");
  expect(opponent.hasAttribute("tabindex")).toBe(false);

  // When both bombs have been spent and the match finishes
  match.players[0].bombsRemaining = 0;
  match.players[1].bombsRemaining = 0;
  match.phase = "finished";
  match.turnPhase = "ended";
  match.currentTurnPlayerId = null;
  match.winnerPlayerId = "red";
  act(() => root.render(<Scene match={match} />));

  // Then both icons retain their spent state and neither can send a bomb action
  expect(container.querySelectorAll(".inline-bomb.is-used")).toHaveLength(2);
  expect(
    container.querySelectorAll('.inline-bomb path[fill="currentColor"][stroke="none"]')
  ).toHaveLength(2);
  expect(opponent.getAttribute("aria-label")).toContain("already been used");
  const local = container.querySelector<HTMLButtonElement>("button.inline-bomb")!;
  act(() => local.click());
  expect(local.disabled).toBe(true);
  expect(onToggle).not.toHaveBeenCalled();
});

const button = (name: string) =>
  container.querySelector<HTMLButtonElement>(`.arcade-play-area button[name='${name}']`);

it.each([false, true])("resigns only after the inline confirmation in solo=%s", (solo) => {
  // Given a live match using either presentation
  const match = createMatch();
  render(match);
  act(() => root.render(<Scene match={match} solo={solo} />));

  // When the player presses Resign match
  act(() => button("resign")?.click());

  // Then the control asks inline, focuses the safe choice, and has not resigned
  expect(button("resign")).toBeNull();
  expect(button("keep-playing")?.textContent).toBe("Keep playing");
  expect(button("confirm-resign")?.textContent).toBe("Confirm resign");
  expect(document.activeElement).toBe(button("keep-playing"));
  expect(onResign).not.toHaveBeenCalled();

  // When the player confirms
  act(() => button("confirm-resign")?.click());

  // Then the match is resigned once
  expect(onResign).toHaveBeenCalledOnce();
});

it.each([
  ["Keep playing", () => act(() => button("keep-playing")?.click())],
  [
    "Escape",
    () =>
      act(() =>
        button("confirm-resign")?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
        )
      )
  ]
])("returns to Resign match on %s without resigning", (_name, cancel) => {
  // Given a live match waiting for the player to confirm resignation
  render(createMatch());
  act(() => button("resign")?.click());

  // When the player backs out
  cancel();

  // Then the single resign control returns with focus and nothing is sent
  expect(button("confirm-resign")).toBeNull();
  expect(document.activeElement).toBe(button("resign"));
  expect(onResign).not.toHaveBeenCalled();
});

it("drops a pending resign confirmation when a move changes the match", () => {
  // Given a live match waiting for the player to confirm resignation
  const match = createMatch();
  render(match);
  act(() => button("resign")?.click());

  // When the opponent scores a mine
  const moved = createMatch();
  moved.players[0].score += 1;
  act(() => root.render(<Scene match={moved} />));

  // Then the confirmation is gone and the player must ask again
  expect(button("confirm-resign")).toBeNull();
  expect(button("resign")).not.toBeNull();
  expect(onResign).not.toHaveBeenCalled();
});

it("keeps a pending resign confirmation when the match is unchanged", () => {
  // Given a live match waiting for the player to confirm resignation
  render(createMatch());
  act(() => button("resign")?.click());

  // When the same position arrives again as a new snapshot
  act(() => root.render(<Scene match={createMatch()} />));

  // Then the player can still confirm
  expect(button("confirm-resign")).not.toBeNull();
});

it("blocks confirming a resignation while offline", () => {
  // Given a live match waiting for the player to confirm resignation
  const match = createMatch();
  render(match);
  act(() => button("resign")?.click());

  // When the connection drops
  act(() => root.render(<Scene match={match} connected={false} />));
  act(() => button("confirm-resign")?.click());

  // Then confirming is disabled and nothing is sent
  expect(button("confirm-resign")?.disabled).toBe(true);
  expect(button("keep-playing")?.disabled).toBe(false);
  expect(onResign).not.toHaveBeenCalled();
});
