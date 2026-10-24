import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  WEBSOCKET_CLOSE_CODES,
  WEBSOCKET_CLOSE_REASONS
} from "@minesweeper-flags/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RawData, WebSocket } from "ws";
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
  // biome-ignore lint/suspicious/noExplicitAny: parsed wire events of many types; the assertions check their shape.
  payload: any;
}

class FakeSocket extends EventEmitter {
  readonly sentMessages: string[] = [];
  readonly close = vi.fn();
  readonly ping = vi.fn();
  readonly terminate = vi.fn();
  readyState: WebSocket["readyState"] = WebSocket.OPEN;

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

const sendRequest = async (server: TestRealtimeServer, url: string): Promise<MockResponseResult> =>
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

const connectSocket = (server: TestRealtimeServer, remoteAddress = "127.0.0.1") => {
  const socket = new FakeSocket();

  server.webSocketServer.emit(
    "connection",
    socket as unknown as WebSocket,
    {
      headers: {},
      socket: { remoteAddress }
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    await activeServer?.shutdown();
    activeServer = undefined;
  });

  it("cancels only an attached current host and invalidates its invite and reconnect", async () => {
    // Given a waiting host, a foreign room with a guest, and a replacement host socket
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();
    const oldHost = connectSocket(activeServer);
    const foreign = connectSocket(activeServer);
    await emitClientEvent(oldHost, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "Host" }
    });
    await emitClientEvent(foreign, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "Foreign" }
    });
    const foreignRoom = readSentEvents(foreign)[0]!;
    const guest = connectSocket(activeServer);
    await emitClientEvent(guest, {
      type: CLIENT_EVENT_NAMES.roomJoin,
      payload: { displayName: "Guest", inviteToken: foreignRoom.payload.inviteToken }
    });
    const created = readSentEvents(oldHost)[0]!;
    const credentials = {
      roomCode: created.payload.roomCode,
      sessionToken: created.payload.self.sessionToken
    };
    const host = connectSocket(activeServer);
    await emitClientEvent(host, { type: CLIENT_EVENT_NAMES.playerReconnect, payload: credentials });
    const unattached = connectSocket(activeServer);

    // When foreign host, guest, unattached, and replaced sockets present the stolen host credential
    for (const socket of [foreign, guest, unattached, oldHost]) {
      await emitClientEvent(socket, {
        type: CLIENT_EVENT_NAMES.roomCancel,
        payload: { ...credentials, requestId: "unauthorized" }
      });
      expect(readSentEvents(socket).at(-1)?.type).toBe(SERVER_EVENT_NAMES.serverError);
    }

    // Then only the current host can free its slot and both old access paths fail
    expect((await sendRequest(activeServer, "/health")).payload.activeRooms).toBe(2);
    await emitClientEvent(host, {
      type: CLIENT_EVENT_NAMES.roomCancel,
      payload: { ...credentials, requestId: "authorized" }
    });
    expect(readSentEvents(host).at(-1)).toMatchObject({
      type: SERVER_EVENT_NAMES.roomCancelled,
      payload: { requestId: "authorized" }
    });
    expect((await sendRequest(activeServer, "/health")).payload.activeRooms).toBe(1);
    await emitClientEvent(unattached, {
      type: CLIENT_EVENT_NAMES.roomJoin,
      payload: { displayName: "Guest", inviteToken: created.payload.inviteToken }
    });
    expect(readSentEvents(unattached).at(-1)?.type).toBe(SERVER_EVENT_NAMES.serverError);
    await emitClientEvent(host, { type: CLIENT_EVENT_NAMES.playerReconnect, payload: credentials });
    expect(readSentEvents(host).at(-1)?.type).toBe(SERVER_EVENT_NAMES.serverError);
  });

  it("replaces an attached waiting room at capacity and detaches after explicit cancellation", async () => {
    // Given all four room slots are occupied
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();
    const hosts = Array.from({ length: 4 }, (_, index) =>
      connectSocket(activeServer!, `10.0.0.${index + 1}`)
    );
    for (const host of hosts)
      await emitClientEvent(host, {
        type: CLIENT_EVENT_NAMES.roomCreate,
        payload: { displayName: "Host" }
      });
    const host = hosts[0]!;
    const old = readSentEvents(host)[0]!;

    // When the attached host creates again without waiting for inactivity cleanup
    await emitClientEvent(host, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "Again" }
    });
    const replacement = readSentEvents(host)
      .filter((event) => event.type === SERVER_EVENT_NAMES.roomCreated)
      .at(-1)!;

    // Then capacity stays bounded and cancellation detaches the socket for its next create
    expect(replacement.type).toBe(SERVER_EVENT_NAMES.roomCreated);
    expect(replacement.payload.roomCode).not.toBe(old.payload.roomCode);
    expect((await sendRequest(activeServer, "/health")).payload.activeRooms).toBe(4);
    await emitClientEvent(host, {
      type: CLIENT_EVENT_NAMES.roomCancel,
      payload: {
        roomCode: replacement.payload.roomCode,
        sessionToken: replacement.payload.self.sessionToken,
        requestId: "free"
      }
    });
    expect((await sendRequest(activeServer, "/health")).payload.activeRooms).toBe(3);
    await emitClientEvent(host, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "Third" }
    });
    expect(
      readSentEvents(host).filter((event) => event.type === SERVER_EVENT_NAMES.roomCreated)
    ).toHaveLength(3);
    expect((await sendRequest(activeServer, "/health")).payload.activeRooms).toBe(4);
  });

  it("retires a raw same-socket waiting room without the disconnect grace", async () => {
    // Given a connected host creates a waiting room twice on the same socket
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
    });
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();
    const host = connectSocket(activeServer);
    await emitClientEvent(host, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "First" }
    });
    await emitClientEvent(host, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "Second" }
    });

    // When the normal disconnect grace period passes without any socket closing
    await vi.advanceTimersByTimeAsync(30_000);

    const afterGrace = (await sendRequest(activeServer, "/health")).payload.activeRooms;
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 - 30_000);
    const afterInactivityExpiry = (await sendRequest(activeServer, "/health")).payload.activeRooms;

    // Then the replacement frees its old slot before the thirty-minute inactivity expiry
    expect([afterGrace, afterInactivityExpiry]).toEqual([1, 1]);
  });

  it("reports health separately from readiness", async () => {
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });

    const healthBeforeReady = await sendRequest(activeServer, "/health");
    const readinessBeforeReady = await sendRequest(activeServer, "/ready");

    activeServer.markReady();

    const readinessAfterReady = await sendRequest(activeServer, "/ready");

    expect(healthBeforeReady).toEqual({
      statusCode: 200,
      payload: { status: "ok", activeRooms: 0, maxRooms: 4 }
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

  it("restores a waiting host after a reload without deleting their room", async () => {
    // Given a waiting room whose host has a reconnect credential
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();
    const host = connectSocket(activeServer);
    await emitClientEvent(host, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "Host" }
    });
    const created = readSentEvents(host)[0]!;

    // When a reload closes the old socket and reconnects with the same seat
    host.readyState = WebSocket.CLOSED;
    host.emit("close", 1001, Buffer.from(""));
    await flushAsyncWork();
    const replacement = connectSocket(activeServer);
    await emitClientEvent(replacement, {
      type: CLIENT_EVENT_NAMES.playerReconnect,
      payload: {
        roomCode: created.payload.roomCode,
        sessionToken: created.payload.self.sessionToken
      }
    });
    await vi.advanceTimersByTimeAsync(30_000);

    // Then the original player is restored and remains present after the cleanup grace period
    expect(readSentEvents(replacement)[0]).toMatchObject({
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomCode: created.payload.roomCode,
        players: [{ playerId: created.payload.self.playerId }]
      }
    });
    expect((await sendRequest(activeServer, "/health")).payload.activeRooms).toBe(1);
  });

  it("releases an abandoned room only after the reconnect grace period", async () => {
    // Given a waiting room whose host disconnects
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();
    const host = connectSocket(activeServer);
    await emitClientEvent(host, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "Host" }
    });
    const created = readSentEvents(host)[0]!;
    host.readyState = WebSocket.CLOSED;
    host.emit("close", 1001, Buffer.from(""));
    await flushAsyncWork();

    // When the room remains empty for less than thirty seconds
    await vi.advanceTimersByTimeAsync(29_999);

    // Then the slot is reserved for reconnecting
    expect((await sendRequest(activeServer, "/health")).payload.activeRooms).toBe(1);

    // When the grace period ends and nobody has returned
    await vi.advanceTimersByTimeAsync(1);
    const replacement = connectSocket(activeServer);
    await emitClientEvent(replacement, {
      type: CLIENT_EVENT_NAMES.playerReconnect,
      payload: {
        roomCode: created.payload.roomCode,
        sessionToken: created.payload.self.sessionToken
      }
    });

    // Then the slot is free and its old reconnect credential is invalid
    expect((await sendRequest(activeServer, "/health")).payload.activeRooms).toBe(0);
    expect(readSentEvents(replacement)[0]).toMatchObject({
      type: SERVER_EVENT_NAMES.serverError,
      payload: { message: "That session is not valid for this room." }
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

    // Freeze Date so updatedAt only moves when the test advances the clock.
    vi.useFakeTimers({ toFake: ["Date"] });
    const socket = connectSocket(activeServer);
    await emitClientEvent(socket, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: {
        displayName: "Host"
      }
    });

    const roomCreatedEvent = JSON.parse(socket.sentMessages[0] ?? "null") as {
      type: string;
      payload: { roomCode: string; inviteToken: string; self: { sessionToken: string } };
    };

    expect(roomCreatedEvent.type).toBe(SERVER_EVENT_NAMES.roomCreated);
    expect(roomCreatedEvent.payload.inviteToken).toHaveLength(22);

    const roomBeforePong = await roomRepository.getByCode(roomCreatedEvent.payload.roomCode);

    if (!roomBeforePong) {
      throw new Error("Expected the room to exist after room creation.");
    }

    vi.setSystemTime(Date.now() + 5);

    socket.emit("pong");
    await flushAsyncWork();

    const roomAfterPong = await roomRepository.getByCode(roomCreatedEvent.payload.roomCode);

    expect(playerSessionStore.touchedSessions).toHaveLength(1);
    expect(playerSessionStore.touchedSessions[0]?.sessionToken).toBe(
      roomCreatedEvent.payload.self.sessionToken
    );
    expect(roomAfterPong?.updatedAt).toBeGreaterThan(roomBeforePong.updatedAt);
  });

  it("starts the match on the board size the host chose", async () => {
    // Given a host who creates a room with a huge board
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();
    const hostSocket = connectSocket(activeServer);
    await emitClientEvent(hostSocket, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName: "Host", boardSize: "huge" }
    });
    const inviteToken = readSentEvents(hostSocket)[0]?.payload.inviteToken;
    const guestSocket = connectSocket(activeServer);

    // When a guest joins with the invite
    await emitClientEvent(guestSocket, {
      type: CLIENT_EVENT_NAMES.roomJoin,
      payload: { inviteToken, displayName: "Guest" }
    });

    // Then the guest's match starts on a 24×24 board with 115 mines
    const matchStarted = readSentEvents(guestSocket).find(
      (event) => event.type === SERVER_EVENT_NAMES.matchStarted
    );
    expect(matchStarted?.payload.match.board).toMatchObject({
      rows: 24,
      columns: 24,
      mineCount: 115
    });
    expect(matchStarted?.payload.match.board.cells).toHaveLength(24);
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
        inviteToken: roomCreatedEvent?.payload.inviteToken,
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
    expect(guestEvents[2]?.type).toBe(SERVER_EVENT_NAMES.roomState);
    expect(guestEvents[3]?.type).toBe(SERVER_EVENT_NAMES.matchStarted);

    const hostEventsAfterJoin = readSentEvents(hostSocket);

    expect(hostEventsAfterJoin.at(-2)?.type).toBe(SERVER_EVENT_NAMES.roomState);
    expect(hostEventsAfterJoin.at(-1)?.type).toBe(SERVER_EVENT_NAMES.matchStarted);

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
    expect(reconnectEvents[2]?.type).toBe(SERVER_EVENT_NAMES.playerReconnected);
    expect(reconnectEvents[3]?.type).toBe(SERVER_EVENT_NAMES.matchState);
  });

  it("broadcasts ordered disconnect side effects when an attached player socket closes", async () => {
    activeServer = await createRealtimeServer({ websocketPath: "/ws" });
    activeServer.markReady();

    const hostSocket = connectSocket(activeServer);
    await emitClientEvent(hostSocket, {
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: {
        displayName: "Host"
      }
    });

    const roomCreatedEvent = readSentEvents(hostSocket)[0];
    const guestSocket = connectSocket(activeServer);

    await emitClientEvent(guestSocket, {
      type: CLIENT_EVENT_NAMES.roomJoin,
      payload: {
        inviteToken: roomCreatedEvent?.payload.inviteToken,
        displayName: "Guest"
      }
    });

    const guestEventsBeforeDisconnect = guestSocket.sentMessages.length;

    hostSocket.emit("close", 1001, Buffer.from(""));
    await flushAsyncWork();

    const guestEventsAfterDisconnect = readSentEvents(guestSocket).slice(
      guestEventsBeforeDisconnect
    );

    expect(guestEventsAfterDisconnect[0]?.type).toBe(SERVER_EVENT_NAMES.playerDisconnected);
    expect(guestEventsAfterDisconnect[1]?.type).toBe(SERVER_EVENT_NAMES.matchState);
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
    expect(chatRejections[1]?.payload.message).toBe("Chat messages can be at most 200 characters.");
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
