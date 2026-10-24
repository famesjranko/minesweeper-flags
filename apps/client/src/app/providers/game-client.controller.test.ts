import {
  CLIENT_EVENT_NAMES,
  type ClientEvent,
  SERVER_EVENT_NAMES,
  type ServerEvent,
  WEBSOCKET_CLOSE_CODES
} from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import type { SessionPersistence, StoredSession } from "../../lib/socket/session-storage.js";
import { GameClientController, type GameClientScheduler } from "./game-client.controller.js";
import { GameClientStore } from "./game-client.store.js";
import type {
  GameClientTransport,
  GameClientTransportListener,
  GameClientTransportStatusChange
} from "./game-client.transport.js";

class FakeTransport implements GameClientTransport {
  readonly sentEvents: ClientEvent[] = [];
  connectCalls = 0;
  disconnectCalls = 0;
  throwOnSend = false;

  private status: "disconnected" | "connecting" | "connected" = "disconnected";
  private readonly listeners = new Set<GameClientTransportListener>();

  connect = (): void => {
    this.connectCalls += 1;
    // Like the WebSocket transport, an open or opening connection is reused silently.
    if (this.status !== "disconnected") return;
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

const createHarness = ({ sessions = [] }: { sessions?: StoredSession[] } = {}) => {
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
  it("persists the invitation used to join so a reload can find the guest seat", () => {
    // Given a guest joining through a valid invitation
    const { controller, transport, persistence } = createHarness();
    controller.start();
    controller.joinRoom("Guest", "AbCdEfGhIjKlMnOpQrStUw");
    transport.emitStatus({ status: "connected" });

    // When the server confirms the join without echoing the consumed invitation
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomJoined,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        self: { playerId: "guest-1", displayName: "Guest", sessionToken: "guest-session" },
        players: [
          { playerId: "host-1", displayName: "Host" },
          { playerId: "guest-1", displayName: "Guest" }
        ]
      }
    });

    // Then the saved guest seat includes the invitation as well as the reconnect credential
    expect(persistence.read("ABCDE")).toMatchObject({
      inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
      playerId: "guest-1",
      sessionToken: "guest-session"
    });
  });

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
          turnPhase: "awaiting_action",
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
    expect(store.getSnapshot().connectionStatus).toBe("disconnected");
  });

  it("reports connecting when the lobby opens before the client starts", () => {
    // Given a client that has not started yet
    const { controller, store } = createHarness();

    // When the lobby opens the connection and the client then starts
    controller.openLobby();
    controller.start();

    // Then the status shows the connection attempt in progress
    expect(store.getSnapshot().connectionStatus).toBe("connecting");
  });

  it("keeps the connecting status through retry delays until the transport reconnects", () => {
    // Given a started client whose connection fails twice
    const { controller, scheduler, store, transport } = createHarness();
    controller.start();
    transport.emitStatus({ status: "disconnected", closeCode: 1006 });

    // When each retry delay elapses and the next connection also fails
    expect(store.getSnapshot().connectionStatus).toBe("connecting");
    scheduler.runNextTimeout();
    transport.emitStatus({ status: "disconnected", closeCode: 1006 });

    // Then the header state remains connecting until the transport is ready
    expect(store.getSnapshot().connectionStatus).toBe("connecting");
    scheduler.runNextTimeout();
    transport.emitStatus({ status: "connected" });

    expect(store.getSnapshot().connectionStatus).toBe("connected");
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

  it("forgets room credentials only after its matching cancellation acknowledgement", () => {
    // Given a connected host with a saved waiting-room session
    const { controller, persistence, store, transport } = createHarness({
      sessions: [storedSession]
    });
    controller.start();
    transport.emitStatus({ status: "connected" });
    controller.reconnect("ABCDE");
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        players: [{ playerId: "player-1", displayName: "Host" }]
      }
    });

    // When the host asks to cancel but receives a stale acknowledgement first
    controller.cancelRoom();
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomCancelled,
      payload: { roomCode: "ABCDE", requestId: "cancel-old" }
    });

    // Then the credentials remain until the current request is acknowledged
    expect(store.getSnapshot().session?.roomCode).toBe("ABCDE");
    expect(persistence.read("ABCDE")).not.toBeNull();
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomCancelled,
      payload: { roomCode: "ABCDE", requestId: "cancel-1" }
    });
    expect(store.getSnapshot().session).toBeNull();
    expect(persistence.read("ABCDE")).toBeNull();
  });

  it("keeps waiting-room credentials when cancellation fails", () => {
    // Given a connected host with a saved waiting-room session
    const { controller, persistence, store, transport } = createHarness({
      sessions: [storedSession]
    });
    controller.start();
    transport.emitStatus({ status: "connected" });
    controller.reconnect("ABCDE");
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        players: [{ playerId: "player-1", displayName: "Host" }]
      }
    });

    // When cancellation is rejected by the server
    controller.cancelRoom();
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.serverError,
      payload: { message: "Delete failed." }
    });

    // Then no false success clears the current or stored credentials
    expect(store.getSnapshot().session?.roomCode).toBe("ABCDE");
    expect(persistence.read("ABCDE")).not.toBeNull();
    expect(store.getSnapshot().error).toBe("Delete failed.");
  });
});

describe("pending room cancellation", () => {
  it("reconciles a matching acknowledgement after cancellation times out", () => {
    // Given a connected host has requested cancellation
    const { controller, store, transport, persistence, scheduler } = createHarness({
      sessions: [storedSession]
    });
    controller.start();
    transport.emitStatus({ status: "connected" });
    controller.reconnect("ABCDE");
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        players: [{ playerId: "player-1", displayName: "Host" }]
      }
    });
    controller.cancelRoom();
    const sentCount = transport.sentEvents.length;

    // When lobby effects and competing bootstrap actions race its acknowledgement
    controller.openLobby();
    controller.createRoom("Again");
    controller.joinRoom("Guest", "other-invite");
    controller.reconnect("ABCDE");
    controller.cancelRoom();

    // Then the single request owns the session while its status is reconciled
    expect(transport.sentEvents).toHaveLength(sentCount);
    expect(store.getSnapshot().session?.roomCode).toBe("ABCDE");
    scheduler.runNextTimeout();
    expect(store.getSnapshot().roomCancelPending).toBe(false);
    expect(persistence.read("ABCDE")).not.toBeNull();

    // And the delayed acknowledgement confirms the original cancellation
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomCancelled,
      payload: { roomCode: "ABCDE", requestId: "cancel-1" }
    });
    expect(store.getSnapshot().session).toBeNull();
    expect(persistence.read("ABCDE")).toBeNull();
  });

  it("invalidates a deleted session when cancellation acknowledgement is fully lost", () => {
    // Given a connected host with a cancellation awaiting confirmation
    const { controller, persistence, scheduler, store, transport } = createHarness({
      sessions: [storedSession]
    });
    controller.start();
    transport.emitStatus({ status: "connected" });
    controller.reconnect("ABCDE");
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        players: [{ playerId: "player-1", displayName: "Host" }]
      }
    });
    controller.cancelRoom();

    // When reconnect reports that the cancelled session no longer exists
    scheduler.runNextTimeout();
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.serverError,
      payload: { message: "This session is no longer valid." }
    });

    // Then recovery clears the invalid room state and shows the lobby again
    expect(store.getSnapshot().session).toBeNull();
    expect(store.getSnapshot().roomCancelAttempted).toBe(false);
    expect(persistence.read("ABCDE")).toBeNull();
  });

  it("clears a pending cancellation timeout when disposed", () => {
    // Given a connected host with a pending cancellation timeout
    const { controller, persistence, scheduler, store, transport } = createHarness({
      sessions: [storedSession]
    });
    controller.start();
    transport.emitStatus({ status: "connected" });
    controller.reconnect("ABCDE");
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        players: [{ playerId: "player-1", displayName: "Host" }]
      }
    });
    controller.cancelRoom();

    // When the provider disposes before its acknowledgement arrives
    controller.dispose();

    // Then no cancellation timer remains and persisted credentials are unchanged
    expect(scheduler.getTimeoutCount()).toBe(0);
    expect(store.getSnapshot().session?.roomCode).toBe("ABCDE");
    expect(persistence.read("ABCDE")).not.toBeNull();
  });

  it("ignores a stale cancellation acknowledgement after timeout", () => {
    // Given a timed-out cancellation that is reconciling its original request
    const { controller, persistence, scheduler, store, transport } = createHarness({
      sessions: [storedSession]
    });
    controller.start();
    transport.emitStatus({ status: "connected" });
    controller.reconnect("ABCDE");
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        players: [{ playerId: "player-1", displayName: "Host" }]
      }
    });
    controller.cancelRoom();
    scheduler.runNextTimeout();

    // When another room and a different request report success
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomCancelled,
      payload: { roomCode: "OTHER", requestId: "cancel-1" }
    });
    transport.emitServerEvent({
      type: SERVER_EVENT_NAMES.roomCancelled,
      payload: { roomCode: "ABCDE", requestId: "cancel-old" }
    });

    // Then the current session and credentials remain until the matching response
    expect(store.getSnapshot().session?.roomCode).toBe("ABCDE");
    expect(persistence.read("ABCDE")).not.toBeNull();
  });
});
