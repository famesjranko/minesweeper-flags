import { describe, expect, it } from "vitest";
import { SERVER_EVENT_NAMES } from "@minesweeper-flags/shared";
import { decodeServerEvent } from "./game-client.protocol.js";

describe("game client protocol", () => {
  it("decodes a schema-valid server event", () => {
    expect(
      decodeServerEvent(
        JSON.stringify({
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
        })
      )
    ).toEqual({
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
  });

  it("rejects malformed nested server payloads", () => {
    expect(
      decodeServerEvent(
        JSON.stringify({
          type: SERVER_EVENT_NAMES.matchState,
          payload: {
            roomCode: "ABCDE",
            match: {
              roomId: "room-1"
            }
          }
        })
      )
    ).toBeNull();
  });
});
