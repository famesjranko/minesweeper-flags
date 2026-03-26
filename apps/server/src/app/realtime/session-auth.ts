import type WebSocket from "ws";
import type { ConnectionRegistry } from "./connection.registry.js";
import type { PlayerSessionService } from "./player-session.service.js";

interface SessionAuthDependencies {
  connectionRegistry: ConnectionRegistry;
  playerSessionService: PlayerSessionService;
}

export const requireAttachedSession = async (
  dependencies: SessionAuthDependencies,
  roomCode: string,
  sessionToken: string,
  socket: WebSocket
) => {
  const session = await dependencies.playerSessionService.requireSession(roomCode, sessionToken);

  if (!dependencies.connectionRegistry.isCurrentSocket(session.playerId, socket)) {
    throw new Error("Reconnect before sending match updates for this session.");
  }

  return session;
};
