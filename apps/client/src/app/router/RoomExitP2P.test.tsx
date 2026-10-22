// @vitest-environment jsdom
import { act, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AppRouter } from "./AppRouter.js";

const { cancelRoom } = vi.hoisted(() => ({ cancelRoom: vi.fn() }));
vi.mock("../../lib/config/env.js", async (original) => ({
  ...(await original<object>()),
  DEPLOYMENT_MODE: "p2p"
}));
vi.mock("../providers/GameClientProvider.js", () => ({
  GameClientProvider: ({ children }: PropsWithChildren) => children
}));
vi.mock("../../features/connection/useGameClient.js", () => ({
  useGameClient: () => ({
    session: { roomCode: "ABCDE" },
    match: null,
    cancelRoom,
    roomCancelPending: false,
    roomCancelAttempted: false
  })
}));
vi.mock("../../pages/RoomPage.js", () => ({ RoomPage: () => <div>Direct room</div> }));
vi.mock("../../pages/LobbyPage.js", () => ({ LobbyPage: () => <div>Game selection</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe("direct room navigation", () => {
  it.each(["/", "/lobby"])("leaves %s to the P2P lifecycle without server cancellation", (path) => {
    // Given a direct room with an active setup session
    cancelRoom.mockClear();
    window.history.replaceState(null, "", "/room/ABCDE");
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<AppRouter />));
    try {
      // When browser history returns to game selection
      act(() => {
        window.history.pushState(null, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      // Then the server cancellation boundary does not invoke P2P cancellation
      expect(cancelRoom).not.toHaveBeenCalled();
      expect(container.textContent).toBe("Game selection");
    } finally {
      act(() => root.unmount());
    }
  });
});
