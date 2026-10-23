// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { LobbyPage } from "./LobbyPage.js";

const { openLobby, gameClient } = vi.hoisted(() => {
  const openLobby = vi.fn();
  return {
    openLobby,
    gameClient: {
      openLobby,
      connectionStatus: "connected",
      error: null,
      session: { roomCode: "ABCDE" },
      match: { phase: "live" },
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      slotAvailability: null,
      refreshSlotCount: vi.fn(),
      roomCancelPending: false,
      roomCancelAttempted: false
    }
  };
});
vi.mock("../features/connection/useGameClient.js", () => ({ useGameClient: () => gameClient }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps a live match connected when browser Back reaches the friend lobby", () => {
  // Given a player whose match is still live
  const container = document.createElement("div");
  const root = createRoot(container);

  // When the friend lobby route renders
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <LobbyPage />
      </MemoryRouter>
    )
  );

  try {
    // Then the lobby does not leave the match
    expect(openLobby).not.toHaveBeenCalled();

    // And it offers a way back to the match instead of the room form
    const link = container.querySelector<HTMLAnchorElement>("a[href='/room/ABCDE']");
    expect(link?.textContent).toBe("Return to match");
    expect(container.querySelector(".lobby-create-button[type='submit']")).toBeNull();
  } finally {
    act(() => root.unmount());
  }
});
