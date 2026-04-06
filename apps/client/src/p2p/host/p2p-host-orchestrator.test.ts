import { CLIENT_EVENT_NAMES, SERVER_EVENT_NAMES } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { emitP2PHostFanout } from "./p2p-host-events.js";
import {
  P2PHostOrchestrator,
  type P2PHostOrchestratorOptions
} from "./p2p-host-orchestrator.js";

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
