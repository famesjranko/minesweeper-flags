import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  WEBSOCKET_CLOSE_CODES,
  WEBSOCKET_CLOSE_REASONS
} from "@minesweeper-flags/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";
import { InMemoryChatRepository } from "../../modules/chat/chat.repository.js";
import { InMemoryMatchRepository } from "../../modules/matches/match.repository.js";
import { InMemoryRoomRepository } from "../../modules/rooms/room.repository.js";
import type { PlayerSession, PlayerSessionStore } from "./player-session.service.js";
import { createRealtimeServer } from "./realtime.server.js";

type TestRealtimeServer = Awaited<ReturnType<typeof createRealtimeServer>>;

interface MockResponseResult {
  statusCode: number;
  payload: Record<string, unknown>;
}

interface SentEvent {
  type: string;
  payload: any;
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

const connectSocket = (server: TestRealtimeServer) => {
  const socket = new FakeSocket();

  server.webSocketServer.emit(
    "connection",
    socket as unknown as WebSocket,
    {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" }
    } as IncomingMessage
  );

  return socket;
};

const emitClientEvent = async (socket: FakeSocket, event: Record<string, unknown>) => {
  socket.emit("message", Buffer.from(JSON.stringify(event)));
  await flushAsyncWork();
};

const emitRawMessage = async (socket: FakeSocket, message: Buffer) => {
  socket.emit("message", message);
  await flushAsyncWork();
};

const readSentEvents = (socket: FakeSocket): SentEvent[] =>
  socket.sentMessages.map((message) => JSON.parse(message) as SentEvent);

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
        chatRepository: new InMemoryChatRepository(25),
        playerSessionStore,
        deleteRoomState: async () => {},
        dispose: async () => {}
      }
    });
    activeServer.markReady();

    const socket = connectSocket(activeServer);
    await emitClientEvent(socket, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: {
        displayName: "Host"
      }
    });

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

  it("returns chat history on room create, join, and reconnect", async () => {
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();

    const hostSocket = connectSocket(activeServer);
    await emitClientEvent(hostSocket, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: {
        displayName: "Host"
      }
    });

    const hostEventsAfterCreate = readSentEvents(hostSocket);
    const roomCreatedEvent = hostEventsAfterCreate[0];
    const initialChatHistoryEvent = hostEventsAfterCreate[1];

    expect(roomCreatedEvent?.type).toBe(SERVER_EVENT_NAMES.roomCreated);
    expect(initialChatHistoryEvent).toEqual({
      type: SERVER_EVENT_NAMES.chatHistory,
      payload: {
        roomCode: roomCreatedEvent?.payload.roomCode,
        messages: []
      }
    });

    await emitClientEvent(hostSocket, {
      type: CLIENT_EVENT_NAMES.chatSend,
      payload: {
        roomCode: roomCreatedEvent?.payload.roomCode,
        sessionToken: roomCreatedEvent?.payload.self.sessionToken,
        text: "Hello from the lobby :)"
      }
    });

    const hostChatMessageEvent = readSentEvents(hostSocket).at(-1);

    expect(hostChatMessageEvent?.type).toBe(SERVER_EVENT_NAMES.chatMessage);
    expect(hostChatMessageEvent?.payload).toMatchObject({
      roomCode: roomCreatedEvent?.payload.roomCode,
      message: {
        displayName: "Host",
        text: "Hello from the lobby :)"
      }
    });

    const guestSocket = connectSocket(activeServer);
    await emitClientEvent(guestSocket, {
      type: CLIENT_EVENT_NAMES.roomJoin,
      payload: {
        roomCode: roomCreatedEvent?.payload.roomCode,
        displayName: "Guest"
      }
    });

    const guestEvents = readSentEvents(guestSocket);

    expect(guestEvents[0]?.type).toBe(SERVER_EVENT_NAMES.roomJoined);
    expect(guestEvents[1]).toMatchObject({
      type: SERVER_EVENT_NAMES.chatHistory,
      payload: {
        roomCode: roomCreatedEvent?.payload.roomCode,
        messages: [
          {
            displayName: "Host",
            text: "Hello from the lobby :)"
          }
        ]
      }
    });

    const reconnectSocket = connectSocket(activeServer);
    await emitClientEvent(reconnectSocket, {
      type: CLIENT_EVENT_NAMES.playerReconnect,
      payload: {
        roomCode: roomCreatedEvent?.payload.roomCode,
        sessionToken: roomCreatedEvent?.payload.self.sessionToken
      }
    });

    const reconnectEvents = readSentEvents(reconnectSocket);

    expect(reconnectEvents[0]?.type).toBe(SERVER_EVENT_NAMES.roomState);
    expect(reconnectEvents[1]).toMatchObject({
      type: SERVER_EVENT_NAMES.chatHistory,
      payload: {
        roomCode: roomCreatedEvent?.payload.roomCode,
        messages: [
          {
            displayName: "Host",
            text: "Hello from the lobby :)"
          }
        ]
      }
    });
  });

  it("closes replaced sockets with an explicit session-replaced close code", async () => {
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();

    const originalSocket = connectSocket(activeServer);
    await emitClientEvent(originalSocket, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: {
        displayName: "Host"
      }
    });

    const roomCreatedEvent = readSentEvents(originalSocket)[0];
    const replacementSocket = connectSocket(activeServer);

    await emitClientEvent(replacementSocket, {
      type: CLIENT_EVENT_NAMES.playerReconnect,
      payload: {
        roomCode: roomCreatedEvent?.payload.roomCode,
        sessionToken: roomCreatedEvent?.payload.self.sessionToken
      }
    });

    expect(originalSocket.close).toHaveBeenCalledWith(
      WEBSOCKET_CLOSE_CODES.sessionReplaced,
      WEBSOCKET_CLOSE_REASONS.sessionReplaced
    );
  });

  it("rejects blank and oversized chat messages without using server:error", async () => {
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();

    const socket = connectSocket(activeServer);
    await emitClientEvent(socket, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: {
        displayName: "Host"
      }
    });

    const roomCreatedEvent = readSentEvents(socket)[0];

    await emitClientEvent(socket, {
      type: CLIENT_EVENT_NAMES.chatSend,
      payload: {
        roomCode: roomCreatedEvent?.payload.roomCode,
        sessionToken: roomCreatedEvent?.payload.self.sessionToken,
        text: "   "
      }
    });

    await emitClientEvent(socket, {
      type: CLIENT_EVENT_NAMES.chatSend,
      payload: {
        roomCode: roomCreatedEvent?.payload.roomCode,
        sessionToken: roomCreatedEvent?.payload.self.sessionToken,
        text: "x".repeat(201)
      }
    });

    const chatRejections = readSentEvents(socket).filter(
      (event) => event.type === SERVER_EVENT_NAMES.chatMessageRejected
    );

    expect(chatRejections).toHaveLength(2);
    expect(chatRejections[0]?.payload.message).toBe("Type a message before sending.");
    expect(chatRejections[1]?.payload.message).toBe(
      "Chat messages can be at most 200 characters."
    );
    expect(
      readSentEvents(socket).some((event) => event.type === SERVER_EVENT_NAMES.serverError)
    ).toBe(false);
  });

  it("rate limits chat spam per player", async () => {
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();

    const socket = connectSocket(activeServer);
    await emitClientEvent(socket, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: {
        displayName: "Host"
      }
    });

    const roomCreatedEvent = readSentEvents(socket)[0];

    for (let index = 0; index < 9; index += 1) {
      await emitClientEvent(socket, {
        type: CLIENT_EVENT_NAMES.chatSend,
        payload: {
          roomCode: roomCreatedEvent?.payload.roomCode,
          sessionToken: roomCreatedEvent?.payload.self.sessionToken,
          text: `message-${index}`
        }
      });
    }

    const events = readSentEvents(socket);
    const chatMessages = events.filter((event) => event.type === SERVER_EVENT_NAMES.chatMessage);
    const chatRejections = events.filter(
      (event) => event.type === SERVER_EVENT_NAMES.chatMessageRejected
    );

    expect(chatMessages).toHaveLength(8);
    expect(chatRejections.at(-1)?.payload.message).toBe(
      "You're sending messages too quickly. Try again in a moment."
    );
  });

  it("closes sockets that send oversized websocket messages", async () => {
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();

    const socket = connectSocket(activeServer);

    await emitRawMessage(socket, Buffer.alloc(20_000, "a"));

    expect(socket.close).toHaveBeenCalledWith(1009, "Message too large");
  });
});
