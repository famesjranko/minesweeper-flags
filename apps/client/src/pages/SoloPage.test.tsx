// @vitest-environment jsdom

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SoloSession, SoloSnapshot } from "../solo/session/solo-session.js";
import { SOLO_DIFFICULTY_KEY } from "../solo/storage/solo-difficulty-preference.js";
import { SOLO_STORAGE_KEY } from "../solo/storage/solo-storage.js";
import { SoloPage } from "./SoloPage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const match = (phase: "live" | "finished", turn: string | null): MatchStateDto => ({
  roomId: "solo-local",
  phase,
  board: {
    rows: 16,
    columns: 16,
    mineCount: 51,
    cells: Array.from({ length: 16 }, (_, row) =>
      Array.from({ length: 16 }, (_, column) => ({
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
      score: phase === "finished" ? 26 : 0,
      bombsRemaining: 1,
      connected: true,
      rematchRequested: false
    },
    {
      playerId: "solo-bot",
      displayName: "Bot",
      score: phase === "finished" ? 12 : 0,
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

const sessionFor = (initialSnapshot: SoloSnapshot) => {
  const listeners = new Set<() => void>();
  let snapshot = initialSnapshot;
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
  return {
    session,
    setSnapshot: (nextSnapshot: SoloSnapshot) => {
      snapshot = nextSnapshot;
      listeners.forEach((listener) => {
        listener();
      });
    }
  };
};

it("disables local input while the bot thinks and disposes its session on unmount", () => {
  // Given a started local session while the bot owns the turn
  const { session } = sessionFor({
    match: match("live", "solo-bot"),
    humanId: "solo-human",
    difficulty: "normal",
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
    expect(container.textContent).toContain("Bot thinking");
    expect(cell?.disabled).toBe(true);
    expect(container.querySelector(".arcade-chat-preview")).toBeNull();
    expect(container.querySelector(".arcade-player-presence")).toBeNull();
  } finally {
    act(() => root.unmount());
    expect(session.dispose).toHaveBeenCalledOnce();
    container.remove();
  }
});

it("offers only a local rematch after the match finishes", () => {
  // Given a finished local session
  const { session } = sessionFor({
    match: match("finished", null),
    humanId: "solo-human",
    difficulty: "normal",
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
    // When the player requests another local game
    act(() => container.querySelector<HTMLButtonElement>("button[name='rematch']")?.click());

    // Then only rematch stays with the local authority, notices, and final result remain visible
    expect(session.rematch).toHaveBeenCalledOnce();
    expect(container.querySelector("button[name='resign']")).toBeNull();
    expect(container.querySelector("button[name='restart']")).toBeNull();
    expect(container.textContent).toContain("Last move was invalid.");
    expect(container.textContent).toContain("Solo progress cannot be saved in this browser.");
    expect(container.textContent).toContain("You won");
    expect(container.textContent).toContain("26 – 12");
    expect(container.querySelectorAll(".arcade-play-area [role=status]")).toHaveLength(1);
    expect(container.querySelectorAll(".match-primary-action")).toHaveLength(1);
    expect(container.querySelector(".solo-result")).toBeNull();
    expect(container.textContent).not.toContain("Request rematch");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("offers only resign while a local match is live", () => {
  // Given a live local session
  const { session } = sessionFor({
    match: match("live", "solo-human"),
    humanId: "solo-human",
    difficulty: "normal",
    bombArmed: false,
    botThinking: false,
    error: null,
    recoveryNotice: null
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  act(() => root.render(<SoloPage createSession={() => session} />));

  try {
    // When the player resigns the live local match and confirms
    act(() => container.querySelector<HTMLButtonElement>("button[name='resign']")?.click());
    act(() => container.querySelector<HTMLButtonElement>("button[name='confirm-resign']")?.click());

    // Then resign uses the local authority and rematch or restart are unavailable
    expect(session.resign).toHaveBeenCalledOnce();
    expect(container.querySelector("button[name='rematch']")).toBeNull();
    expect(container.querySelector("button[name='restart']")).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("creates a fresh session when Strict Mode reactivates the effect", () => {
  // Given Strict Mode and two sessions that cannot restart after disposal
  const { session: first } = sessionFor({
    match: match("live", "solo-human"),
    humanId: "solo-human",
    difficulty: "normal",
    bombArmed: false,
    botThinking: false,
    error: null,
    recoveryNotice: null
  });
  const { session: second } = sessionFor({
    match: match("live", "solo-human"),
    humanId: "solo-human",
    difficulty: "normal",
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

it("updates the persistent local status in place while bot input is disabled", () => {
  // Given a started local session where the human owns the turn
  const { session, setSnapshot } = sessionFor({
    match: match("live", "solo-human"),
    humanId: "solo-human",
    difficulty: "normal",
    bombArmed: false,
    botThinking: false,
    error: null,
    recoveryNotice: null
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  act(() => root.render(<SoloPage createSession={() => session} />));

  try {
    const status = container.querySelector(".arcade-turn-hint");
    const cell = container.querySelector<HTMLButtonElement>("button[title='Row 1, Column 1']");

    // When the deterministic local session moves to the bot turn
    act(() =>
      setSnapshot({
        match: match("live", "solo-bot"),
        humanId: "solo-human",
        difficulty: "normal",
        bombArmed: false,
        botThinking: true,
        error: null,
        recoveryNotice: null
      })
    );

    // Then the same status row announces the bot state and disables human input
    expect(container.querySelector(".arcade-turn-hint")).toBe(status);
    expect(status?.textContent).toContain("Bot thinking");
    expect(container.querySelector(".solo-thinking")).toBeNull();
    expect(cell?.disabled).toBe(true);

    // When the bot finishes and the match ends
    act(() =>
      setSnapshot({
        match: match("finished", null),
        humanId: "solo-human",
        difficulty: "normal",
        bombArmed: false,
        botThinking: false,
        error: null,
        recoveryNotice: null
      })
    );

    // Then the same status row announces the finished state without a transient card
    expect(container.querySelector(".arcade-turn-hint")).toBe(status);
    expect(status?.textContent).toContain("You won");
    expect(container.querySelector(".solo-thinking")).toBeNull();
  } finally {
    act(() => root.unmount());
    expect(session.dispose).toHaveBeenCalledOnce();
    container.remove();
  }
});

it("names the bot's level on its card", () => {
  // Given a local session played at the hard level
  const { session } = sessionFor({
    match: match("live", "solo-human"),
    humanId: "solo-human",
    difficulty: "hard",
    bombArmed: false,
    botThinking: false,
    error: null,
    recoveryNotice: null
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  // When the match renders
  act(() => root.render(<SoloPage createSession={() => session} />));

  try {
    // Then only the bot's card carries the level
    const [humanCard, botCard] = container.querySelectorAll(".sidebar-player-header");
    expect(botCard?.textContent).toBe("RED · Hard");
    expect(humanCard?.textContent).toBe("BLUE · You");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("starts a fresh local match at the level chosen on the home page", () => {
  // Given no saved solo progress and easy as the remembered level
  window.sessionStorage.clear();
  window.localStorage.setItem(SOLO_DIFFICULTY_KEY, "easy");
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  // When the solo page opens with its own session
  act(() => root.render(<SoloPage />));

  try {
    // Then the new match is saved and shown at the easy level
    expect(JSON.parse(window.sessionStorage.getItem(SOLO_STORAGE_KEY) ?? "{}").difficulty).toBe(
      "easy"
    );
    expect(container.querySelectorAll(".sidebar-player-header")[1]?.textContent).toBe("RED · Easy");
  } finally {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});
