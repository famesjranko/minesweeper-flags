import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  WEBSOCKET_CLOSE_CODES,
  type ClientEvent,
  type ServerEvent
} from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import {
  GameClientController,
  type GameClientScheduler
} from "./game-client.controller.js";
import { GameClientStore } from "./game-client.store.js";
import type {
  GameClientTransport,
  GameClientTransportListener,
  GameClientTransportStatusChange
} from "./game-client.transport.js";
import type {
  SessionPersistence,
  StoredSession
} from "../../lib/socket/session-storage.js";

class FakeTransport implements GameClientTransport {
  readonly sentEvents: ClientEvent[] = [];
  connectCalls = 0;
  disconnectCalls = 0;
  throwOnSend = false;

  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private readonly listeners = new Set<GameClientTransportListener>();

  connect = (): void => {
    this.connectCalls += 1;
    this.emitStatus({ status: "connecting" });
  };

  disconnect = (): void => {
    this.disconnectCalls += 1;
    this.emitStatus({ status: "disconnected" });
  };

  send = (event: ClientEvent): void => {
    if (this.throwOnSend) {
      throw new Error("send failed");
    }

    this.sentEvents.push(event);
  };

  subscribe = (listener: GameClientTransportListener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  getStatus = () => this.status;

  emitStatus(change: GameClientTransportStatusChange): void {
    this.status = change.status;

    for (const listener of this.listeners) {
      listener.onStatusChange?.(change);
    }
  }

  emitServerEvent(event: ServerEvent | null): void {
    for (const listener of this.listeners) {
      listener.onServerEvent?.(event);
    }
  }
}

class FakeSessionPersistence implements SessionPersistence {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(initialSessions: StoredSession[] = []) {
    for (const session of initialSessions) {
      this.sessions.set(session.roomCode, session);
    }
  }

  read = (roomCode: string): StoredSession | null => this.sessions.get(roomCode) ?? null;

  write = (session: StoredSession): void => {
    this.sessions.set(session.roomCode, session);
  };

  remove = (roomCode: string): void => {
    this.sessions.delete(roomCode);
  };
}

class FakeScheduler implements GameClientScheduler {
  randomValue = 0;
  private nextTimeoutId = 1;
  private readonly timeouts = new Map<number, () => void>();

  setTimeout = (callback: () => void): number => {
    const timeoutId = this.nextTimeoutId;
    this.nextTimeoutId += 1;
    this.timeouts.set(timeoutId, callback);
    return timeoutId;
  };

  clearTimeout = (timeoutId: number): void => {
    this.timeouts.delete(timeoutId);
  };

  random = (): number => this.randomValue;

  getTimeoutCount(): number {
    return this.timeouts.size;
  }

  runNextTimeout(): void {
    const [timeoutId, callback] = this.timeouts.entries().next().value ?? [];

    if (typeof timeoutId !== "number" || typeof callback !== "function") {
      throw new Error("Expected a scheduled timeout.");
    }

    this.timeouts.delete(timeoutId);
    callback();
  }
}

const storedSession: StoredSession = {
  roomId: "room-1",
  roomCode: "ABCDE",
  inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
  playerId: "player-1",
  displayName: "Host",
  sessionToken: "session-1"
};

const createHarness = ({
  sessions = []
}: {
  sessions?: StoredSession[];
} = {}) => {
  const transport = new FakeTransport();
  const persistence = new FakeSessionPersistence(sessions);
  const scheduler = new FakeScheduler();
  const store = new GameClientStore();
  const controller = new GameClientController({
    store,
    transport,
    persistence,
    scheduler
  });

  return {
    controller,
    persistence,
    scheduler,
    store,
    transport
  };
};

describe("game client controller", () => {
  it("queues offline room bootstrap commands until the transport reconnects", () => {
    const { controller, store, transport } = createHarness();

    controller.start();
    controller.createRoom("Host");
    controller.joinRoom("Guest", "invite-token");

    expect(store.getSnapshot().session).toBeNull();
    expect(transport.sentEvents).toEqual([]);

    transport.emitStatus({ status: "connected" });

    expect(transport.sentEvents).toEqual([
      {
        type: CLIENT_EVENT_NAMES.roomJoin,
        payload: {
          displayName: "Guest",
          inviteToken: "invite-token"
        }
      }
    ]);
  });

  it("uses the persistence boundary for room-route reconnect bootstrap", () => {
    const { controller, store, transport } = createHarness({
      sessions: [storedSession]
    });

    controller.start();

    expect(controller.hasStoredSession("ABCDE")).toBe(true);
    expect(controller.hasStoredSession("ZZZZZ")).toBe(false);

    transport.emitStatus({ status: "connected" });
    controller.reconnect("ABCDE");

    expect(transport.sentEvents.at(-1)).toEqual({
      type: CLIENT_EVENT_NAMES.playerReconnect,
      payload: {
        roomCode: "ABCDE",
        sessionToken: "session-1"
      }
    });

    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        players: [
          {
            playerId: "player-1",
            displayName: "Host"
          }
        ]
      }
    });

    expect(store.getSnapshot().session).toEqual({
      ...storedSession,
      players: [
        {
          playerId: "player-1",
          displayName: "Host"
        }
      ]
    });
  });

  it("ignores room-scoped events for other rooms", () => {
    const { controller, store, transport } = createHarness();

    controller.start();
    transport.emitStatus({ status: "connected" });
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomCreated,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
        self: {
          playerId: "player-1",
          displayName: "Host",
          sessionToken: "session-1"
        },
        players: [
          {
            playerId: "player-1",
            displayName: "Host"
          }
        ]
      }
    });

    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.matchState,
      payload: {
        roomCode: "ZZZZZ",
        match: {
          roomId: "room-2",
          phase: "live",
          board: {
            rows: 16,
            columns: 16,
            mineCount: 51,
            cells: Array.from({ length: 16 }, (_, row) =>
              Array.from({ length: 16 }, (_, column) => ({
                row,
                column,
                status: "hidden" as const,
                adjacentMines: null,
                claimedByPlayerId: null
              }))
            )
          },
          players: [
            {
              playerId: "player-1",
              displayName: "Host",
              score: 0,
              bombsRemaining: 1,
              connected: true,
              rematchRequested: false
            },
            {
              playerId: "player-2",
              displayName: "Guest",
              score: 0,
              bombsRemaining: 1,
              connected: true,
              rematchRequested: false
            }
          ],
          currentTurnPlayerId: "player-1",
          turnPhase: "awaiting_selection",
          turnNumber: 1,
          winnerPlayerId: null,
          lastAction: null
        }
      }
    });

    expect(store.getSnapshot().match).toBeNull();
    expect(store.getSnapshot().session?.roomCode).toBe("ABCDE");
  });

  it("stops reconnecting when the session is replaced in another tab", () => {
    const { controller, scheduler, store, transport } = createHarness();

    controller.start();
    transport.emitStatus({ status: "connected" });
    transport.emitStatus({
      status: "disconnected",
      closeCode: WEBSOCKET_CLOSE_CODES.sessionReplaced
    });

    expect(store.getSnapshot().error).toBe(
      "This room is active in another tab or window. Use that tab, or reconnect here."
    );
    expect(scheduler.getTimeoutCount()).toBe(0);
  });

  it("recovers pending chat drafts across disconnect and confirmed reconnect delivery", () => {
    const { controller, scheduler, store, transport } = createHarness();

    controller.start();
    transport.emitStatus({ status: "connected" });
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomCreated,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
        self: {
          playerId: "player-1",
          displayName: "Host",
          sessionToken: "session-1"
        },
        players: [
          {
            playerId: "player-1",
            displayName: "Host"
          }
        ]
      }
    });

    controller.setChatDraft("Hello");
    controller.sendChatMessage();

    expect(store.getSnapshot().chatPendingText).toBe("Hello");
    expect(store.getSnapshot().chatDraft).toBe("");
    expect(transport.sentEvents.at(-1)).toEqual({
      type: CLIENT_EVENT_NAMES.chatSend,
      payload: {
        roomCode: "ABCDE",
        sessionToken: "session-1",
        text: "Hello"
      }
    });

    transport.emitStatus({ status: "disconnected", closeCode: 1006 });

    expect(store.getSnapshot().chatPendingText).toBeNull();
    expect(store.getSnapshot().chatDraft).toBe("Hello");
    expect(scheduler.getTimeoutCount()).toBe(1);

    scheduler.runNextTimeout();
    transport.emitStatus({ status: "connected" });

    expect(transport.sentEvents.at(-1)).toEqual({
      type: CLIENT_EVENT_NAMES.playerReconnect,
      payload: {
        roomCode: "ABCDE",
        sessionToken: "session-1"
      }
    });

    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.chatHistory,
      payload: {
        roomCode: "ABCDE",
        messages: [
          {
            messageId: "message-1",
            playerId: "player-1",
            displayName: "Host",
            text: "Hello",
            sentAt: 1
          }
        ]
      }
    });

    expect(store.getSnapshot().chatDraft).toBe("");
    expect(store.getSnapshot().chatPendingText).toBeNull();
    expect(store.getSnapshot().chatError).toBeNull();
  });
});
