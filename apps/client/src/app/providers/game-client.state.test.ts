import { describe, expect, it } from "vitest";
import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  type ServerEvent
} from "@minesweeper-flags/shared";
import {
  buildReconnectEvent,
  buildSessionFromRoomEvent,
  shouldApplyServerEvent,
  shouldQueueWhileOffline
} from "./game-client.state.js";

describe("game client state helpers", () => {
  it("builds a reconnect event from persisted session data", () => {
    expect(
      buildReconnectEvent({
        roomId: "room-1",
        roomCode: "ABCDE",
        playerId: "player-1",
        displayName: "Host",
        sessionToken: "session-1"
      })
    ).toEqual({
      type: CLIENT_EVENT_NAMES.playerReconnect,
      payload: {
        roomCode: "ABCDE",
        sessionToken: "session-1"
      }
    });
  });

  it("keeps room-scoped server events isolated to the active room", () => {
    const roomStateEvent: ServerEvent = {
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        players: []
      }
    };

    expect(shouldApplyServerEvent(roomStateEvent, "ABCDE")).toBe(true);
    expect(shouldApplyServerEvent(roomStateEvent, "ZZZZZ")).toBe(false);
  });

  it("queues only lobby bootstrap events while offline", () => {
    expect(
      shouldQueueWhileOffline({
        type: CLIENT_EVENT_NAMES.roomCreate,
        payload: { displayName: "Host" }
      })
    ).toBe(true);

    expect(
      shouldQueueWhileOffline({
        type: CLIENT_EVENT_NAMES.matchResign,
        payload: {
          roomCode: "ABCDE",
          sessionToken: "session-1"
        }
      })
    ).toBe(false);
  });

  it("builds persisted client session data from room bootstrap events", () => {
    const session = buildSessionFromRoomEvent({
      type: SERVER_EVENT_NAMES.roomCreated,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
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

    expect(session.sessionToken).toBe("session-1");
    expect(session.players).toHaveLength(1);
  });
});
