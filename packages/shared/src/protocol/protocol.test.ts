import { describe, expect, it } from "vitest";
import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  clientEventSchema,
  serverEventSchema
} from "../index.js";

describe("protocol schemas", () => {
  it("accepts a valid action event", () => {
    const parsed = clientEventSchema.parse({
      type: CLIENT_EVENT_NAMES.matchAction,
      payload: {
        roomCode: "ABCDE",
        sessionToken: "session-1",
        action: {
          type: "select",
          row: 3,
          column: 5
        }
      }
    });

    if (parsed.type === CLIENT_EVENT_NAMES.matchAction) {
      expect(parsed.payload.action.type).toBe("select");
    }
  });

  it("accepts a valid invite join event", () => {
    const parsed = clientEventSchema.parse({
      type: CLIENT_EVENT_NAMES.roomJoin,
      payload: {
        inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
        displayName: "Guest"
      }
    });

    expect(parsed.type).toBe(CLIENT_EVENT_NAMES.roomJoin);
  });

  it("accepts a valid resign event", () => {
    const parsed = clientEventSchema.parse({
      type: CLIENT_EVENT_NAMES.matchResign,
      payload: {
        roomCode: "ABCDE",
        sessionToken: "session-1"
      }
    });

    expect(parsed.type).toBe(CLIENT_EVENT_NAMES.matchResign);
  });

  it("accepts a valid chat send event", () => {
    const parsed = clientEventSchema.parse({
      type: CLIENT_EVENT_NAMES.chatSend,
      payload: {
        roomCode: "ABCDE",
        sessionToken: "session-1",
        text: "Hello there :)"
      }
    });

    expect(parsed.type).toBe(CLIENT_EVENT_NAMES.chatSend);
  });

  it("accepts a valid match state event", () => {
    const parsed = serverEventSchema.parse({
      type: SERVER_EVENT_NAMES.matchState,
      payload: {
        roomCode: "ABCDE",
        match: {
          roomId: "room-1",
          phase: "live",
          board: {
            rows: 16,
            columns: 16,
            mineCount: 51,
            cells: Array.from({ length: 16 }, (_, row) =>
              Array.from({ length: 16 }, (_, column) => ({
                row,
                column,
                status: "hidden",
                adjacentMines: null,
                claimedByPlayerId: null
              }))
            )
          },
          players: [
            {
              playerId: "player-1",
              displayName: "A",
              score: 0,
              bombsRemaining: 1,
              connected: true,
              rematchRequested: false
            },
            {
              playerId: "player-2",
              displayName: "B",
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

    expect(parsed.type).toBe(SERVER_EVENT_NAMES.matchState);
  });

  it("accepts a valid chat history event", () => {
    const parsed = serverEventSchema.parse({
      type: SERVER_EVENT_NAMES.chatHistory,
      payload: {
        roomCode: "ABCDE",
        messages: [
          {
            messageId: "msg-1",
            playerId: "player-1",
            displayName: "Host",
            text: "Ready?",
            sentAt: 123
          }
        ]
      }
    });

    expect(parsed.type).toBe(SERVER_EVENT_NAMES.chatHistory);
  });

  it("accepts a valid room created event with an invite token", () => {
    const parsed = serverEventSchema.parse({
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

    expect(parsed.type).toBe(SERVER_EVENT_NAMES.roomCreated);
  });
});
