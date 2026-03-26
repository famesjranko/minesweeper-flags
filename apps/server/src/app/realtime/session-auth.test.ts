import { describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { ConnectionRegistry } from "./connection.registry.js";
import { PlayerSessionService } from "./player-session.service.js";
import { requireAttachedSession } from "./session-auth.js";

const createSocket = () => ({ readyState: 1, close: () => undefined } as unknown as WebSocket);

describe("session auth", () => {
  it("rejects a valid session token when the sending socket is not the active owner", async () => {
    const connectionRegistry = new ConnectionRegistry();
    const playerSessionService = new PlayerSessionService();
    const activeSocket = createSocket();
    const spoofedSocket = createSocket();
    const session = await playerSessionService.createSession("ABCDE", {
      playerId: "player-1",
      displayName: "Host"
    });

    connectionRegistry.attach(session, activeSocket);

    await expect(
      requireAttachedSession(
        {
          connectionRegistry,
          playerSessionService
        },
        "ABCDE",
        session.sessionToken,
        spoofedSocket
      )
    ).rejects.toThrow("Reconnect before sending match updates");
  });

  it("accepts the active socket for the issued room session", async () => {
    const connectionRegistry = new ConnectionRegistry();
    const playerSessionService = new PlayerSessionService();
    const activeSocket = createSocket();
    const session = await playerSessionService.createSession("ABCDE", {
      playerId: "player-1",
      displayName: "Host"
    });

    connectionRegistry.attach(session, activeSocket);

    await expect(
      requireAttachedSession(
        {
          connectionRegistry,
          playerSessionService
        },
        "ABCDE",
        session.sessionToken,
        activeSocket
      )
    ).resolves.toEqual(session);
  });
});
