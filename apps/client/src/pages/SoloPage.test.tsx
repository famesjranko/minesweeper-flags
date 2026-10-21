// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SoloSession, SoloSnapshot } from "../solo/session/solo-session.js";
import { SoloPage } from "./SoloPage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const match = (phase: "live" | "finished", turn: string | null): MatchStateDto => ({
  roomId: "solo-local",
  phase,
  board: {
    rows: 2,
    columns: 2,
    mineCount: 1,
    cells: Array.from({ length: 2 }, (_, row) =>
      Array.from({ length: 2 }, (_, column) => ({
        row,
        column,
        status: "hidden" as const,
        adjacentMines: null,
        claimedByPlayerId: null
      }))
    )
  },
  players: [
    {
      playerId: "solo-human",
      displayName: "You",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: "solo-bot",
      displayName: "Bot",
      score: 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    }
  ],
  currentTurnPlayerId: turn,
  turnPhase: phase === "live" ? "awaiting_action" : "ended",
  turnNumber: 1,
  winnerPlayerId: phase === "finished" ? "solo-human" : null,
  lastAction: null
});

const sessionFor = (snapshot: SoloSnapshot) => {
  const listeners = new Set<() => void>();
  const session: SoloSession = {
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    start: vi.fn(),
    submitCellAction: vi.fn(),
    toggleBombMode: vi.fn(),
    resign: vi.fn(),
    restart: vi.fn(),
    rematch: vi.fn(),
    dispose: vi.fn()
  };
  return session;
};

it("disables local input while the bot thinks and disposes its session on unmount", () => {
  // Given a started local session while the bot owns the turn
  const session = sessionFor({
    match: match("live", "solo-bot"),
    humanId: "solo-human",
    bombArmed: false,
    botThinking: true,
    error: null,
    recoveryNotice: null
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  act(() => root.render(<SoloPage createSession={() => session} />));

  try {
    // When the local board renders
    const cell = container.querySelector<HTMLButtonElement>("button[title='Row 1, Column 1']");

    // Then bot status is exposed and human controls cannot act
    expect(session.start).toHaveBeenCalledBefore(session.getSnapshot as ReturnType<typeof vi.fn>);
    expect(container.textContent).toContain("Bot is thinking");
    expect(cell?.disabled).toBe(true);
    expect(container.querySelector(".arcade-chat-toggle")).toBeNull();
  } finally {
    act(() => root.unmount());
    expect(session.dispose).toHaveBeenCalledOnce();
    container.remove();
  }
});

it("offers a local rematch and restart after the match finishes", () => {
  // Given a finished local session
  const session = sessionFor({
    match: match("finished", null),
    humanId: "solo-human",
    bombArmed: false,
    botThinking: false,
    error: "Last move was invalid.",
    recoveryNotice: "Solo progress cannot be saved in this browser."
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  act(() => root.render(<SoloPage createSession={() => session} />));

  try {
    // When the player requests another local game and a restart
    act(() => container.querySelector<HTMLButtonElement>("button[name='rematch']")?.click());
    act(() => container.querySelector<HTMLButtonElement>("button[name='restart']")?.click());

    // Then both actions stay with the local authority and notices remain visible
    expect(session.rematch).toHaveBeenCalledOnce();
    expect(session.restart).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Last move was invalid.");
    expect(container.textContent).toContain("Solo progress cannot be saved in this browser.");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("creates a fresh session when Strict Mode reactivates the effect", () => {
  // Given Strict Mode and two sessions that cannot restart after disposal
  const first = sessionFor({
    match: match("live", "solo-human"),
    humanId: "solo-human",
    bombArmed: false,
    botThinking: false,
    error: null,
    recoveryNotice: null
  });
  const second = sessionFor({
    match: match("live", "solo-human"),
    humanId: "solo-human",
    bombArmed: false,
    botThinking: false,
    error: null,
    recoveryNotice: null
  });
  const createSession = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  act(() =>
    root.render(
      <StrictMode>
        <SoloPage createSession={createSession} />
      </StrictMode>
    )
  );

  try {
    // When React tears down and activates the effect again
    // Then it disposes the first authority and starts a new one exactly once
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(first.start).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.start).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    expect(second.dispose).toHaveBeenCalledOnce();
    container.remove();
  }
});
