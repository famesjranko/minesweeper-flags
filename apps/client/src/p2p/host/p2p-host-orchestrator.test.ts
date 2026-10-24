import { CLIENT_EVENT_NAMES, SERVER_EVENT_NAMES } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { emitP2PHostFanout } from "./p2p-host-events.js";
import { P2PHostOrchestrator, type P2PHostOrchestratorOptions } from "./p2p-host-orchestrator.js";

const createIdentityFactory = () => {
  let nextId = 1;
  let nextRoomCode = 1;
  let nextInviteToken = 1;

  return {
    createId: () => `id-${nextId++}`,
    createRoomCode: () => `ROOM${nextRoomCode++}`,
    createInviteToken: () => `invite_token_value_${nextInviteToken++}`
  };
};

const createOrchestrator = (
  options: Partial<P2PHostOrchestratorOptions> = {}
): P2PHostOrchestrator => {
  let now = 100;

  return new P2PHostOrchestrator({
    now: () => ++now,
    identityFactory: createIdentityFactory(),
    ...options
  });
};

describe("P2PHostOrchestrator", () => {
  it("mirrors the server bootstrap ordering for create and guest acceptance", () => {
    const orchestrator = createOrchestrator();

    const created = orchestrator.createRoom("Host");

    expect(created.steps.map((step) => `${step.target}:${step.event.type}`)).toEqual([
      "host-local:room:created",
      "host-local:chat:history"
    ]);

    const accepted = orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });

    expect(accepted.steps.map((step) => `${step.target}:${step.event.type}`)).toEqual([
      "guest:room:joined",
      "guest:chat:history",
      "broadcast:room:state",
      "broadcast:match:started"
    ]);

    const snapshot = orchestrator.getState();

    expect(snapshot.room?.players).toEqual([
      { playerId: "id-1", displayName: "Host" },
      { playerId: "id-4", displayName: "Guest" }
    ]);
    expect(snapshot.guestSession?.bindingId).toBe("peer-1");
    expect(snapshot.match?.phase).toBe("live");
  });

  it("starts the direct match on the board size the host chose", () => {
    // Given a host who creates a room with a giant board
    const orchestrator = createOrchestrator();
    orchestrator.createRoom("Host", "giant");

    // When a guest is accepted
    orchestrator.acceptGuest({ displayName: "Guest" });

    // Then the match is on a 30×30 board with 179 mines
    const board = orchestrator.getState().match?.board;
    expect(
      board && { rows: board.rows, columns: board.columns, mineCount: board.mineCount }
    ).toEqual({ rows: 30, columns: 30, mineCount: 179 });
  });

  it("starts the direct rematch on the room's board size", () => {
    // Given a finished match on a large board
    const orchestrator = createOrchestrator();
    orchestrator.createRoom("Host", "large");
    orchestrator.acceptGuest({ displayName: "Guest" });
    orchestrator.resignHost();

    // When both players request a rematch
    orchestrator.requestHostRematch();
    orchestrator.requestGuestRematch();

    // Then the new match is live on a 20×20 board with 79 mines
    const match = orchestrator.getState().match;
    expect(match?.phase).toBe("live");
    expect(match && [match.board.rows, match.board.columns, match.board.mineCount]).toEqual([
      20, 20, 79
    ]);
  });

  it("broadcasts chat, match state, rematch updates, and match restart", () => {
    const orchestrator = createOrchestrator();

    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest" });

    const hostChat = orchestrator.sendHostChat("Hello from host");
    expect(hostChat.steps).toHaveLength(1);
    expect(hostChat.steps[0]).toMatchObject({
      target: "broadcast",
      event: {
        type: SERVER_EVENT_NAMES.chatMessage,
        payload: {
          message: {
            displayName: "Host",
            text: "Hello from host"
          }
        }
      }
    });

    const firstAction = orchestrator.applyHostAction({ type: "select", row: 0, column: 0 });

    expect(firstAction.steps[0]?.target).toBe("broadcast");
    expect(firstAction.steps[0]?.event.type).toBe(SERVER_EVENT_NAMES.matchState);

    const liveMatch = orchestrator.getState().match;

    if (!liveMatch) {
      throw new Error("Expected a live match.");
    }

    const resignResult =
      liveMatch.currentTurnPlayerId === orchestrator.getState().hostSession?.playerId
        ? orchestrator.resignHost()
        : orchestrator.resignGuest();

    expect(resignResult.steps[0]?.event.type).toBe(SERVER_EVENT_NAMES.matchEnded);

    const firstRematch = orchestrator.requestHostRematch();
    expect(firstRematch.steps).toMatchObject([
      {
        target: "broadcast",
        event: {
          type: SERVER_EVENT_NAMES.matchRematchUpdated,
          payload: {
            readyCount: 1
          }
        }
      }
    ]);

    const secondRematch = orchestrator.requestGuestRematch();
    expect(secondRematch.steps.map((step) => `${step.target}:${step.event.type}`)).toEqual([
      "broadcast:match:rematch-updated",
      "broadcast:match:started"
    ]);
    expect(secondRematch.steps[0]?.event).toMatchObject({
      payload: {
        readyCount: 0
      }
    });
  });

  it("fans out actor-specific rejection events to the correct consumer", () => {
    const orchestrator = createOrchestrator();

    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest" });

    const rejected = orchestrator.sendGuestChat("   ");
    const hostEvents: string[] = [];
    const guestEvents: string[] = [];

    emitP2PHostFanout(rejected.steps, {
      deliverToHostLocal: (event) => {
        hostEvents.push(event.type);
      },
      deliverToGuest: (event) => {
        guestEvents.push(event.type);
      }
    });

    expect(hostEvents).toEqual([]);
    expect(guestEvents).toEqual([SERVER_EVENT_NAMES.chatMessageRejected]);
  });

  it("rejects invalid display names during room creation and guest acceptance", () => {
    const orchestrator = createOrchestrator();

    expect(() => orchestrator.createRoom("   ")).toThrow();

    orchestrator.createRoom("Host");

    expect(() => orchestrator.acceptGuest({ displayName: "x".repeat(21) })).toThrow();
  });

  it("interprets bound remote guest commands as the canonical guest identity", () => {
    const orchestrator = createOrchestrator();

    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });

    const guestSession = orchestrator.getState().guestSession;

    if (!guestSession) {
      throw new Error("Expected a guest session.");
    }

    const result = orchestrator.applyRemoteGuestCommand({
      bindingId: "peer-1",
      event: {
        type: CLIENT_EVENT_NAMES.chatSend,
        payload: {
          roomCode: guestSession.roomCode,
          sessionToken: guestSession.sessionToken,
          text: "hello from the bound guest"
        }
      }
    });

    expect(result.steps).toMatchObject([
      {
        target: "broadcast",
        event: {
          type: SERVER_EVENT_NAMES.chatMessage,
          payload: {
            message: {
              playerId: guestSession.playerId,
              displayName: guestSession.displayName,
              text: "hello from the bound guest"
            }
          }
        }
      }
    ]);
  });

  it("ignores remote privileged commands from the wrong binding", () => {
    const orchestrator = createOrchestrator();

    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });

    const guestSession = orchestrator.getState().guestSession;

    if (!guestSession) {
      throw new Error("Expected a guest session.");
    }

    const result = orchestrator.applyRemoteGuestCommand({
      bindingId: "peer-2",
      event: {
        type: CLIENT_EVENT_NAMES.chatSend,
        payload: {
          roomCode: guestSession.roomCode,
          sessionToken: guestSession.sessionToken,
          text: "spoofed"
        }
      }
    });

    expect(result.steps).toEqual([]);
    expect(orchestrator.getState().chatMessages).toEqual([]);
  });

  it("rejects bound guest commands with a spoofed host session token", () => {
    const orchestrator = createOrchestrator();

    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });

    const snapshot = orchestrator.getState();
    const guestSession = snapshot.guestSession;
    const hostSession = snapshot.hostSession;

    if (!guestSession || !hostSession) {
      throw new Error("Expected host and guest sessions.");
    }

    const result = orchestrator.applyRemoteGuestCommand({
      bindingId: "peer-1",
      event: {
        type: CLIENT_EVENT_NAMES.matchResign,
        payload: {
          roomCode: guestSession.roomCode,
          sessionToken: hostSession.sessionToken
        }
      }
    });

    expect(result.steps).toEqual([
      {
        target: "guest",
        event: {
          type: SERVER_EVENT_NAMES.serverError,
          payload: {
            message: "That session is not valid for this room."
          }
        }
      }
    ]);
    expect(orchestrator.getState().match?.phase).toBe("live");
  });

  it("ignores remote attempts to use host-only commands over the guest channel", () => {
    const orchestrator = createOrchestrator();

    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });

    const result = orchestrator.applyRemoteGuestCommand({
      bindingId: "peer-1",
      event: {
        type: CLIENT_EVENT_NAMES.roomCreate,
        payload: {
          displayName: "Spoofed Host"
        }
      }
    });

    expect(result.steps).toEqual([]);
    expect(orchestrator.getState().room?.players).toHaveLength(2);
  });

  it("rebinds the guest and replays bootstrap on player reconnect", () => {
    const orchestrator = createOrchestrator();

    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });
    orchestrator.sendHostChat("ready to resume");
    orchestrator.applyHostAction({ type: "select", row: 0, column: 0 });

    const guestSession = orchestrator.getState().guestSession;

    if (!guestSession) {
      throw new Error("Expected a guest session.");
    }

    orchestrator.rebindGuest("peer-2");

    const result = orchestrator.applyRemoteGuestCommand({
      bindingId: "peer-2",
      event: {
        type: CLIENT_EVENT_NAMES.playerReconnect,
        payload: {
          roomCode: guestSession.roomCode,
          sessionToken: guestSession.sessionToken
        }
      }
    });

    expect(result.steps.map((step) => `${step.target}:${step.event.type}`)).toEqual([
      "guest:room:joined",
      "guest:chat:history",
      "broadcast:player:reconnected",
      "guest:match:state"
    ]);
    expect(orchestrator.getState().guestSession?.bindingId).toBe("peer-2");
  });

  it("marks the guest disconnected once when its connection drops", () => {
    // Given a live match with a connected guest
    const orchestrator = createOrchestrator();
    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });
    const guestId = orchestrator.getState().guestSession?.playerId;

    // When the guest's connection drops, and the drop is reported twice
    const first = orchestrator.disconnectGuest();
    const second = orchestrator.disconnectGuest();

    // Then only the host hears about it, once, with the guest marked offline
    expect(first.steps.map((step) => `${step.target}:${step.event.type}`)).toEqual([
      "host-local:player:disconnected",
      "host-local:match:state"
    ]);
    expect(
      orchestrator.getState().match?.players.find((player) => player.playerId === guestId)
        ?.connected
    ).toBe(false);

    // And the repeated report changes nothing
    expect(second.steps).toEqual([]);
  });

  it("marks the guest connected again when it reconnects", () => {
    // Given a guest whose connection dropped
    const orchestrator = createOrchestrator();
    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });
    orchestrator.disconnectGuest();
    const guestSession = orchestrator.getState().guestSession;

    if (!guestSession) {
      throw new Error("Expected a guest session.");
    }

    // When the guest reconnects on a new binding
    orchestrator.rebindGuest("peer-2");
    const result = orchestrator.applyRemoteGuestCommand({
      bindingId: "peer-2",
      event: {
        type: CLIENT_EVENT_NAMES.playerReconnect,
        payload: { roomCode: guestSession.roomCode, sessionToken: guestSession.sessionToken }
      }
    });

    // Then the guest is connected in the match state the host sees
    expect(
      orchestrator
        .getState()
        .match?.players.find((player) => player.playerId === guestSession.playerId)?.connected
    ).toBe(true);
    expect(result.steps.map((step) => `${step.target}:${step.event.type}`)).toContain(
      "host-local:match:state"
    );
  });

  it("rejects a move outside the board instead of throwing", () => {
    // Given a live match on the host's turn
    const orchestrator = createOrchestrator();
    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });

    // When a move targets a row past the board's edge
    const result = orchestrator.applyHostAction({ type: "select", row: 999, column: 0 });

    // Then the mover gets the usual rejection and the match is unchanged
    expect(result.steps.map((step) => `${step.target}:${step.event.type}`)).toEqual([
      "host-local:match:action-rejected"
    ]);
    expect(orchestrator.getState().match?.lastAction).toBeNull();
  });

  it("hydrates a host snapshot saved before board sizes as a classic room", () => {
    // Given a host snapshot whose room has no board size
    const source = createOrchestrator();
    source.createRoom("Host", "giant");
    source.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });
    const snapshot = source.getState();
    if (!snapshot.room) throw new Error("Expected a room.");
    const { boardSize: _omitted, ...legacyRoom } = snapshot.room;
    const restored = createOrchestrator();

    // When a new orchestrator hydrates that snapshot
    restored.hydrate({ ...snapshot, room: legacyRoom as typeof snapshot.room });

    // Then the restored room uses the classic board
    expect(restored.getState().room?.boardSize).toBe("classic");
  });

  it("hydrates host authority state and continues serving commands", () => {
    const source = createOrchestrator();

    source.createRoom("Host");
    source.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });
    source.sendHostChat("before refresh");
    source.applyHostAction({ type: "select", row: 0, column: 0 });

    const restored = createOrchestrator();
    restored.hydrate(source.getState());

    expect(restored.getState()).toEqual(source.getState());

    const guestSession = restored.getState().guestSession;

    if (!guestSession) {
      throw new Error("Expected a guest session.");
    }

    const result = restored.applyRemoteGuestCommand({
      bindingId: "peer-1",
      event: {
        type: CLIENT_EVENT_NAMES.chatSend,
        payload: {
          roomCode: guestSession.roomCode,
          sessionToken: guestSession.sessionToken,
          text: "after hydrate"
        }
      }
    });

    expect(result.steps).toMatchObject([
      {
        target: "broadcast",
        event: {
          type: SERVER_EVENT_NAMES.chatMessage,
          payload: {
            message: {
              displayName: "Guest",
              text: "after hydrate"
            }
          }
        }
      }
    ]);
  });

  it("rejects invalid host authority snapshots during hydrate", () => {
    const orchestrator = createOrchestrator();

    expect(() =>
      orchestrator.hydrate({
        room: {
          roomId: "room-1",
          roomCode: "ROOM1",
          inviteToken: null,
          players: [
            { playerId: "player-1", displayName: "Host" },
            { playerId: "player-2", displayName: "Guest" }
          ],
          nextStarterIndex: 0,
          boardSize: "classic",
          createdAt: 1,
          updatedAt: 2
        },
        hostSession: {
          role: "host",
          roomId: "room-1",
          roomCode: "ROOM2",
          playerId: "player-1",
          displayName: "Host",
          sessionToken: "host-session"
        },
        guestSession: {
          role: "guest",
          roomId: "room-1",
          roomCode: "ROOM1",
          playerId: "player-2",
          displayName: "Guest",
          sessionToken: "guest-session",
          bindingId: "peer-1"
        },
        chatMessages: [],
        match: null
      })
    ).toThrow("Invalid host recovery snapshot.");

    expect(() =>
      orchestrator.hydrate({
        room: null,
        hostSession: null,
        guestSession: null,
        chatMessages: [],
        match: {
          phase: "live"
        } as never
      })
    ).toThrow("Invalid host recovery snapshot.");
  });

  it("rejects bound guest commands for the wrong room", () => {
    const orchestrator = createOrchestrator();

    orchestrator.createRoom("Host");
    orchestrator.acceptGuest({ displayName: "Guest", bindingId: "peer-1" });

    const guestSession = orchestrator.getState().guestSession;

    if (!guestSession) {
      throw new Error("Expected a guest session.");
    }

    const result = orchestrator.applyRemoteGuestCommand({
      bindingId: "peer-1",
      event: {
        type: CLIENT_EVENT_NAMES.chatSend,
        payload: {
          roomCode: "ROOM2",
          sessionToken: guestSession.sessionToken,
          text: "wrong room"
        }
      }
    });

    expect(result.steps).toEqual([
      {
        target: "guest",
        event: {
          type: SERVER_EVENT_NAMES.serverError,
          payload: {
            message: "That session is not valid for this room."
          }
        }
      }
    ]);
    expect(orchestrator.getState().chatMessages).toEqual([]);
  });
});
