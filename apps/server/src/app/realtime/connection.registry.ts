import type WebSocket from "ws";
import type { PlayerSession } from "./player-session.service.js";

interface AttachResult {
  displacedSession?: PlayerSession;
  replacedSocket?: WebSocket;
}

export class ConnectionRegistry {
  private readonly socketsByPlayerId = new Map<string, WebSocket>();
  private readonly sessionsBySocket = new WeakMap<WebSocket, PlayerSession>();

  attach(session: PlayerSession, socket: WebSocket): AttachResult {
    const existingSession = this.sessionsBySocket.get(socket);
    const displacedSession =
      existingSession && existingSession.playerId !== session.playerId ? existingSession : undefined;
    const replacedSocket = this.socketsByPlayerId.get(session.playerId);

    if (displacedSession && this.socketsByPlayerId.get(displacedSession.playerId) === socket) {
      this.socketsByPlayerId.delete(displacedSession.playerId);
    }

    this.sessionsBySocket.set(socket, session);
    this.socketsByPlayerId.set(session.playerId, socket);

    const result: AttachResult = {};

    if (displacedSession) {
      result.displacedSession = displacedSession;
    }

    if (replacedSocket && replacedSocket !== socket) {
      result.replacedSocket = replacedSocket;
    }

    return result;
  }

  getSocketForPlayer(playerId: string): WebSocket | undefined {
    return this.socketsByPlayerId.get(playerId);
  }

  isCurrentSocket(playerId: string, socket: WebSocket): boolean {
    return this.socketsByPlayerId.get(playerId) === socket;
  }

  getSessionForSocket(socket: WebSocket): PlayerSession | undefined {
    return this.sessionsBySocket.get(socket);
  }

  detachIfCurrent(socket: WebSocket): PlayerSession | undefined {
    const session = this.sessionsBySocket.get(socket);

    if (!session || this.socketsByPlayerId.get(session.playerId) !== socket) {
      return undefined;
    }

    this.socketsByPlayerId.delete(session.playerId);
    return session;
  }
}
