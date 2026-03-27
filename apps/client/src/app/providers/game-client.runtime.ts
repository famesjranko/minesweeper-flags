import { createBrowserSessionPersistence } from "../../lib/socket/session-storage.js";
import {
  GameClientController,
  createBrowserGameClientScheduler
} from "./game-client.controller.js";
import { GameClientStore } from "./game-client.store.js";
import { WebSocketGameClientTransport } from "./game-client.transport.js";

export interface GameClientRuntime {
  controller: GameClientController;
  store: GameClientStore;
}

export const createGameClientRuntime = (): GameClientRuntime => {
  const store = new GameClientStore();
  const transport = new WebSocketGameClientTransport();
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
