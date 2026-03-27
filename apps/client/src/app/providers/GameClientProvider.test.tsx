// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomPage } from "../../pages/RoomPage.js";
import { useGameClient } from "../../features/connection/useGameClient.js";
import { GameClientProvider } from "./GameClientProvider.js";
import type { GameClientRuntime } from "./game-client.runtime.js";
import { createGameClientRuntime } from "./game-client.runtime.js";
import {
  createGameClientSnapshot,
  type GameClientSnapshot
} from "./game-client.store.js";

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

  return {
    store,
    controller
  } as unknown as GameClientRuntime & {
    store: FakeStore;
    controller: typeof controller;
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
    const runtime = createFakeRuntime({
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

    expect(runtime.controller.start).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid='connection']")?.textContent).toBe("connecting");
    expect(document.querySelector("[data-testid='error']")?.textContent).toBe("Boom");
    expect(document.querySelector("[data-testid='chat-draft']")?.textContent).toBe("Hello");

    act(() => {
      runtime.store.update({
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

    expect(runtime.controller.createRoom).toHaveBeenCalledWith("Host");

    act(() => {
      root?.unmount();
    });

    expect(runtime.controller.dispose).toHaveBeenCalledTimes(1);
  });

  it("lets RoomPage trigger route bootstrap reconnect through the provider boundary", () => {
    const runtime = createFakeRuntime({
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

    expect(runtime.controller.hasStoredSession).toHaveBeenCalledWith("ABCDE");
    expect(runtime.controller.reconnect).toHaveBeenCalledWith("ABCDE");
  });
});
