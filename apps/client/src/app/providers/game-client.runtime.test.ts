import { describe, expect, it, vi } from "vitest";

vi.mock("../../p2p/runtime/create-p2p-game-client-runtime.js", () => ({
  createP2PGameClientRuntime: vi.fn(() => ({
    controller: {
      start: vi.fn(),
      dispose: vi.fn(),
      hasStoredSession: vi.fn(() => false),
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
    },
    store: {
      subscribe: vi.fn(),
      getSnapshot: vi.fn()
    }
  }))
}));

vi.mock("./game-client.transport.js", () => ({
  WebSocketGameClientTransport: vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    subscribe: vi.fn(),
    getStatus: vi.fn(() => "disconnected")
  }))
}));

vi.mock("../../lib/socket/session-storage.js", () => ({
  createBrowserSessionPersistence: vi.fn(() => ({
    read: vi.fn(() => null),
    write: vi.fn(),
    remove: vi.fn()
  }))
}));

vi.mock("./game-client.controller.js", () => ({
  GameClientController: vi.fn(() => ({
    start: vi.fn(),
    dispose: vi.fn(),
    hasStoredSession: vi.fn(() => false),
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
  })),
  createBrowserGameClientScheduler: vi.fn(() => ({
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
    random: vi.fn(() => 0)
  }))
}));

import { createP2PGameClientRuntime } from "../../p2p/runtime/create-p2p-game-client-runtime.js";
import { createGameClientRuntimeForMode } from "./game-client.runtime.js";
import { WebSocketGameClientTransport } from "./game-client.transport.js";

describe("createGameClientRuntimeForMode", () => {
  it("creates the hosted websocket runtime for server mode", () => {
    createGameClientRuntimeForMode("server");

    expect(WebSocketGameClientTransport).toHaveBeenCalledTimes(1);
    expect(createP2PGameClientRuntime).not.toHaveBeenCalled();
  });

  it("creates the p2p runtime for p2p mode", () => {
    createGameClientRuntimeForMode("p2p");

    expect(createP2PGameClientRuntime).toHaveBeenCalledTimes(1);
  });
});
