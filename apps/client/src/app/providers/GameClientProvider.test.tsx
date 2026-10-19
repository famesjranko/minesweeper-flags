// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGameClient } from "../../features/connection/useGameClient.js";
import { LobbyPage } from "../../pages/LobbyPage.js";
import { RoomPage } from "../../pages/RoomPage.js";
import { GameClientProvider } from "./GameClientProvider.js";
import type { GameClientRuntime } from "./game-client.runtime.js";
import { createGameClientRuntime } from "./game-client.runtime.js";
import { createGameClientSnapshot, type GameClientSnapshot } from "./game-client.store.js";

vi.mock("./game-client.runtime.js", () => ({
  createGameClientRuntime: vi.fn()
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type GameClientHookValue = ReturnType<typeof useGameClient>;

class FakeStore {
  private snapshot: GameClientSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(initialSnapshot: Partial<GameClientSnapshot> = {}) {
    this.snapshot = {
      ...createGameClientSnapshot(),
      ...initialSnapshot
    };
  }

  getSnapshot = (): GameClientSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  update = (nextSnapshot: Partial<GameClientSnapshot>): void => {
    this.snapshot = {
      ...this.snapshot,
      ...nextSnapshot
    };

    for (const listener of this.listeners) {
      listener();
    }
  };
}

const createFakeRuntime = ({
  snapshot,
  hasStoredSession = false
}: {
  snapshot?: Partial<GameClientSnapshot>;
  hasStoredSession?: boolean;
} = {}) => {
  const store = new FakeStore(snapshot);
  const controller = {
    start: vi.fn(),
    dispose: vi.fn(),
    hasStoredSession: vi.fn(() => hasStoredSession),
    openLobby: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    reconnect: vi.fn(),
    submitCellAction: vi.fn(),
    setChatDraft: vi.fn(),
    sendChatMessage: vi.fn(),
    toggleBombMode: vi.fn(),
    resignMatch: vi.fn(),
    requestRematch: vi.fn(),
    cancelRematch: vi.fn(),
    clearError: vi.fn()
  };

  // The fake store stands in for GameClientStore structurally, but its private
  // members differ, so only the runtime handed to the provider is cast.
  return {
    runtime: { store, controller } as unknown as GameClientRuntime,
    store,
    controller
  };
};

const renderIntoRoot = (element: ReactNode) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    root
  };
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("GameClientProvider", () => {
  it("exposes the runtime snapshot through useGameClient and cleans up controller lifecycle", () => {
    const { runtime, store, controller } = createFakeRuntime({
      snapshot: {
        connectionStatus: "connecting",
        error: "Boom",
        chatDraft: "Hello"
      }
    });
    vi.mocked(createGameClientRuntime).mockReturnValue(runtime);
    let latestClient: GameClientHookValue | null = null;
    let root: Root | null = null;

    const Consumer = () => {
      latestClient = useGameClient();

      return (
        <section>
          <div data-testid="connection">{latestClient.connectionStatus}</div>
          <div data-testid="error">{latestClient.error}</div>
          <div data-testid="chat-draft">{latestClient.chatDraft}</div>
        </section>
      );
    };

    ({ root } = renderIntoRoot(
      <GameClientProvider>
        <Consumer />
      </GameClientProvider>
    ));

    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid='connection']")?.textContent).toBe("connecting");
    expect(document.querySelector("[data-testid='error']")?.textContent).toBe("Boom");
    expect(document.querySelector("[data-testid='chat-draft']")?.textContent).toBe("Hello");

    act(() => {
      store.update({
        connectionStatus: "connected",
        error: null,
        chatDraft: "Updated"
      });
    });

    expect(document.querySelector("[data-testid='connection']")?.textContent).toBe("connected");
    expect(document.querySelector("[data-testid='error']")?.textContent).toBe("");
    expect(document.querySelector("[data-testid='chat-draft']")?.textContent).toBe("Updated");

    act(() => {
      latestClient?.createRoom("Host");
    });

    expect(controller.createRoom).toHaveBeenCalledWith("Host");

    act(() => {
      root?.unmount();
    });

    expect(controller.dispose).toHaveBeenCalledTimes(1);
  });

  it("opens the lobby once when the lobby route updates the store", () => {
    // Given a runtime whose openLobby updates the store, as the real controller does
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
    const { runtime, store, controller } = createFakeRuntime();
    controller.openLobby.mockImplementation(() => {
      store.update({ error: null });
    });
    vi.mocked(createGameClientRuntime).mockReturnValue(runtime);

    // When the lobby route renders inside the provider
    renderIntoRoot(
      <GameClientProvider>
        <MemoryRouter initialEntries={["/lobby"]}>
          <Routes>
            <Route path="/lobby" element={<LobbyPage />} />
          </Routes>
        </MemoryRouter>
      </GameClientProvider>
    );

    // Then the lobby is opened exactly once instead of on every render
    expect(controller.openLobby).toHaveBeenCalledTimes(1);

    // And the lobby renders its create-room action
    expect(document.body.textContent).toContain("Create Room");
    vi.unstubAllGlobals();
  });

  it("lets RoomPage trigger route bootstrap reconnect through the provider boundary", () => {
    const { runtime, controller } = createFakeRuntime({
      hasStoredSession: true
    });
    vi.mocked(createGameClientRuntime).mockReturnValue(runtime);

    renderIntoRoot(
      <GameClientProvider>
        <MemoryRouter initialEntries={["/room/ABCDE"]}>
          <Routes>
            <Route path="/room/:roomCode" element={<RoomPage />} />
          </Routes>
        </MemoryRouter>
      </GameClientProvider>
    );

    expect(controller.hasStoredSession).toHaveBeenCalledWith("ABCDE");
    expect(controller.reconnect).toHaveBeenCalledWith("ABCDE");
  });

  it("cancels the pending slot refresh when the provider unmounts", () => {
    // Given a server-mode provider whose lobby was opened, scheduling a delayed slot refresh
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { runtime } = createFakeRuntime();
      vi.mocked(createGameClientRuntime).mockReturnValue(runtime);
      let client: GameClientHookValue | null = null;
      const Consumer = () => {
        client = useGameClient();
        return null;
      };
      const { root } = renderIntoRoot(
        <GameClientProvider>
          <Consumer />
        </GameClientProvider>
      );
      act(() => {
        client?.openLobby();
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // When the provider unmounts before the delay elapses
      act(() => {
        root.unmount();
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Then the delayed refresh never runs and no timer is left pending
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("replaces the pending slot refresh when the lobby is opened twice", () => {
    // Given a server-mode provider under fake timers
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { runtime } = createFakeRuntime();
      vi.mocked(createGameClientRuntime).mockReturnValue(runtime);
      let client: GameClientHookValue | null = null;
      const Consumer = () => {
        client = useGameClient();
        return null;
      };
      const { root } = renderIntoRoot(
        <GameClientProvider>
          <Consumer />
        </GameClientProvider>
      );

      // When the lobby is opened twice before the first delayed refresh fires
      act(() => {
        client?.openLobby();
      });
      act(() => {
        client?.openLobby();
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Then only the mount fetch and one delayed refresh ran
      expect(fetchMock).toHaveBeenCalledTimes(2);

      act(() => {
        root.unmount();
      });
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
