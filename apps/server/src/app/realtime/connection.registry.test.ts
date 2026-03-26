import { describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { ConnectionRegistry } from "./connection.registry.js";
import type { PlayerSession } from "./player-session.service.js";

const createSocket = () => ({ readyState: 1, close: () => undefined } as unknown as WebSocket);

const createSession = (playerId: string, roomCode: string): PlayerSession => ({
  playerId,
  roomCode,
  displayName: playerId,
  sessionToken: `${playerId}-token`
});

describe("connection registry", () => {
  it("invalidates the old socket when the same player session moves to a new socket", () => {
    const registry = new ConnectionRegistry();
    const originalSocket = createSocket();
    const replacementSocket = createSocket();
    const session = createSession("player-1", "ABCDE");

    registry.attach(session, originalSocket);
    const result = registry.attach(session, replacementSocket);

    expect(result.replacedSocket).toBe(originalSocket);
    expect(registry.isCurrentSocket(session.playerId, originalSocket)).toBe(false);
    expect(registry.isCurrentSocket(session.playerId, replacementSocket)).toBe(true);
    expect(registry.detachIfCurrent(originalSocket)).toBeUndefined();
  });

  it("displaces the old player binding when the same socket is reused for a different room session", () => {
    const registry = new ConnectionRegistry();
    const sharedSocket = createSocket();
    const firstSession = createSession("player-1", "ABCDE");
    const secondSession = createSession("player-2", "FGHIJ");

    registry.attach(firstSession, sharedSocket);
    const result = registry.attach(secondSession, sharedSocket);

    expect(result.displacedSession).toEqual(firstSession);
    expect(registry.getSocketForPlayer(firstSession.playerId)).toBeUndefined();
    expect(registry.isCurrentSocket(secondSession.playerId, sharedSocket)).toBe(true);
  });

  it("exposes the current session bound to a socket", () => {
    const registry = new ConnectionRegistry();
    const socket = createSocket();
    const session = createSession("player-1", "ABCDE");

    registry.attach(session, socket);

    expect(registry.getSessionForSocket(socket)).toEqual(session);
  });
});
