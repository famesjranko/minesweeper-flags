import { createBrowserSessionPersistence } from "../../lib/socket/session-storage.js";
import {
  DEPLOYMENT_MODE,
  resolveServerUrl,
  type DeploymentMode
} from "../../lib/config/env.js";
import { createP2PGameClientRuntime } from "../../p2p/runtime/create-p2p-game-client-runtime.js";
import type { P2PRuntimeSupport } from "../../p2p/runtime/p2p-runtime.types.js";
import {
  GameClientController,
  createBrowserGameClientScheduler
} from "./game-client.controller.js";
import { GameClientStore } from "./game-client.store.js";
import { WebSocketGameClientTransport } from "./game-client.transport.js";

export interface GameClientRuntimeController {
  start: () => void;
  dispose: () => void;
  hasStoredSession: (roomCode: string) => boolean;
  openLobby: () => void;
  createRoom: (displayName: string) => void;
  joinRoom: (displayName: string, inviteToken: string) => void;
  reconnect: (roomCode: string) => void;
  submitCellAction: (row: number, column: number) => void;
  setChatDraft: (value: string) => void;
  sendChatMessage: () => void;
  toggleBombMode: () => void;
  resignMatch: () => void;
  requestRematch: () => void;
  cancelRematch: () => void;
  clearError: () => void;
}

export interface GameClientRuntime {
  controller: GameClientRuntimeController;
  store: GameClientStore;
  p2p?: P2PRuntimeSupport;
}

export const createServerGameClientRuntime = (): GameClientRuntime => {
  const store = new GameClientStore();
  const transport = new WebSocketGameClientTransport(resolveServerUrl());
  const controller = new GameClientController({
    store,
    transport,
    persistence: createBrowserSessionPersistence(),
    scheduler: createBrowserGameClientScheduler()
  });

  return {
    controller,
    store
  };
};

export const createGameClientRuntimeForMode = (
  deploymentMode: DeploymentMode
): GameClientRuntime => {
  if (deploymentMode === "p2p") {
    return createP2PGameClientRuntime();
  }

  return createServerGameClientRuntime();
};

export const createGameClientRuntime = (): GameClientRuntime =>
  createGameClientRuntimeForMode(DEPLOYMENT_MODE);
