import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CLIENT_EVENT_NAMES, SERVER_EVENT_NAMES } from "@minesweeper-flags/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";
import { InMemoryMatchRepository } from "../../modules/matches/match.repository.js";
import { InMemoryRoomRepository } from "../../modules/rooms/room.repository.js";
import type { PlayerSession, PlayerSessionStore } from "./player-session.service.js";
import { createRealtimeServer } from "./realtime.server.js";

type TestRealtimeServer = Awaited<ReturnType<typeof createRealtimeServer>>;

interface MockResponseResult {
  statusCode: number;
  payload: Record<string, unknown>;
}

class FakeSocket extends EventEmitter {
  readonly sentMessages: string[] = [];
  readonly close = vi.fn();
  readonly ping = vi.fn();
  readonly terminate = vi.fn();
  readyState = WebSocket.OPEN;

  send(data: RawData): void {
    this.sentMessages.push(typeof data === "string" ? data : data.toString());
  }
}

class RecordingPlayerSessionStore implements PlayerSessionStore {
  readonly touchedSessions: PlayerSession[] = [];
  private readonly sessionsByToken = new Map<string, PlayerSession>();

  async save(session: PlayerSession): Promise<void> {
    this.sessionsByToken.set(session.sessionToken, session);
  }

  async getByToken(sessionToken: string): Promise<PlayerSession | undefined> {
    return this.sessionsByToken.get(sessionToken);
  }

  async deleteByRoomCode(roomCode: string): Promise<void> {
    for (const [sessionToken, session] of this.sessionsByToken) {
      if (session.roomCode === roomCode) {
        this.sessionsByToken.delete(sessionToken);
      }
    }
  }

  async touch(session: PlayerSession): Promise<void> {
    this.touchedSessions.push(session);
    this.sessionsByToken.set(session.sessionToken, session);
  }
}

const sendRequest = async (
  server: TestRealtimeServer,
  url: string
): Promise<MockResponseResult> =>
  await new Promise((resolve) => {
    let statusCode = 200;

    const response = {
      writeHead: (nextStatusCode: number) => {
        statusCode = nextStatusCode;
        return response;
      },
      end: (body?: string) => {
        resolve({
          statusCode,
          payload: body ? (JSON.parse(body) as Record<string, unknown>) : {}
        });
      }
    } as unknown as ServerResponse;

    server.httpServer.emit("request", { url } as IncomingMessage, response);
  });

const flushAsyncWork = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe("realtime server", () => {
  let activeServer: TestRealtimeServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await activeServer?.shutdown();
    activeServer = undefined;
  });

  it("reports health separately from readiness", async () => {
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });

    const healthBeforeReady = await sendRequest(activeServer, "/health");
    const readinessBeforeReady = await sendRequest(activeServer, "/ready");

    activeServer.markReady();

    const readinessAfterReady = await sendRequest(activeServer, "/ready");

    expect(healthBeforeReady).toEqual({
      statusCode: 200,
      payload: { status: "ok" }
    });
    expect(readinessBeforeReady).toEqual({
      statusCode: 503,
      payload: { status: "starting" }
    });
    expect(readinessAfterReady).toEqual({
      statusCode: 200,
      payload: { status: "ready" }
    });
  });

  it("closes websocket clients and flips readiness during shutdown", async () => {
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();
    const close = vi.fn();
    const terminate = vi.fn();

    const fakeClient = {
      readyState: WebSocket.OPEN,
      close,
      terminate
    } as unknown as WebSocket;

    activeServer.webSocketServer.clients.add(fakeClient);
    vi.spyOn(activeServer.webSocketServer, "close").mockImplementation((callback) => {
      callback?.();
    });

    await activeServer.shutdown({ timeoutMs: 100 });

    const readinessAfterShutdown = await sendRequest(activeServer, "/ready");

    expect(close).toHaveBeenCalledWith(1001, "Server shutting down");
    expect(readinessAfterShutdown).toEqual({
      statusCode: 503,
      payload: { status: "stopped" }
    });
  });

  it("refreshes the attached session and room activity when a live socket answers heartbeat pongs", async () => {
    const roomRepository = new InMemoryRoomRepository();
    const playerSessionStore = new RecordingPlayerSessionStore();

    activeServer = await createRealtimeServer({
      websocketPath: "/ws",
      stateStores: {
        backend: "memory",
        roomRepository,
        matchRepository: new InMemoryMatchRepository(),
        playerSessionStore,
        dispose: async () => {}
      }
    });
    activeServer.markReady();

    const socket = new FakeSocket();
    activeServer.webSocketServer.emit(
      "connection",
      socket as unknown as WebSocket,
      {
        headers: {},
        socket: { remoteAddress: "127.0.0.1" }
      } as IncomingMessage
    );

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: CLIENT_EVENT_NAMES.roomCreate,
          payload: {
            displayName: "Host"
          }
        })
      )
    );
    await flushAsyncWork();

    const roomCreatedEvent = JSON.parse(socket.sentMessages[0] ?? "null") as {
      type: string;
      payload: { roomCode: string; self: { sessionToken: string } };
    };

    expect(roomCreatedEvent.type).toBe(SERVER_EVENT_NAMES.roomCreated);

    const roomBeforePong = await roomRepository.getByCode(roomCreatedEvent.payload.roomCode);

    if (!roomBeforePong) {
      throw new Error("Expected the room to exist after room creation.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));

    socket.emit("pong");
    await flushAsyncWork();

    const roomAfterPong = await roomRepository.getByCode(roomCreatedEvent.payload.roomCode);

    expect(playerSessionStore.touchedSessions).toHaveLength(1);
    expect(playerSessionStore.touchedSessions[0]?.sessionToken).toBe(
      roomCreatedEvent.payload.self.sessionToken
    );
    expect(roomAfterPong?.updatedAt).toBeGreaterThan(roomBeforePong.updatedAt);
  });
});
