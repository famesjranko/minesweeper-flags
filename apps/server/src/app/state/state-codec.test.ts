import { describe, expect, it } from "vitest";
import type { MatchState } from "@minesweeper-flags/game-engine";
import {
  deserializeMatchState,
  deserializePlayerSession,
  deserializeRoomRecord,
  serializeMatchState,
  serializePlayerSession,
  serializeRoomRecord
} from "./state-codec.js";

describe("state codec", () => {
  it("round-trips room records", () => {
    const room = {
      roomId: "room-1",
      roomCode: "ABCDE",
      inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
      players: [
        { playerId: "player-1", displayName: "Host" },
        { playerId: "player-2", displayName: "Guest" }
      ],
      nextStarterIndex: 1 as const,
      createdAt: 100,
      updatedAt: 200
    };

    expect(deserializeRoomRecord(serializeRoomRecord(room))).toEqual(room);
  });

  it("round-trips reconnect sessions", () => {
    const session = {
      sessionToken: "token-1",
      roomCode: "ABCDE",
      playerId: "player-1",
      displayName: "Host"
    };

    expect(deserializePlayerSession(serializePlayerSession(session))).toEqual(session);
  });

  it("round-trips match state snapshots", () => {
    const matchState = {
      roomId: "room-1",
      phase: "live",
      board: {
        rows: 2,
        columns: 2,
        mineCount: 1,
        cells: [
          [
            {
              row: 0,
              column: 0,
              hasMine: false,
              isRevealed: true,
              adjacentMines: 1,
              claimedByPlayerId: null
            },
            {
              row: 0,
              column: 1,
              hasMine: true,
              isRevealed: false,
              adjacentMines: 0,
              claimedByPlayerId: "player-1"
            }
          ],
          [
            {
              row: 1,
              column: 0,
              hasMine: false,
              isRevealed: false,
              adjacentMines: 1,
              claimedByPlayerId: null
            },
            {
              row: 1,
              column: 1,
              hasMine: false,
              isRevealed: false,
              adjacentMines: 1,
              claimedByPlayerId: null
            }
          ]
        ]
      },
      players: [
        {
          playerId: "player-1",
          displayName: "Host",
          score: 1,
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
      turnNumber: 2,
      winnerPlayerId: null,
      seed: 123,
      createdAt: 100,
      updatedAt: 200,
      lastAction: {
        type: "select",
        playerId: "player-1",
        row: 0,
        column: 0,
        outcome: "safe_reveal",
        revealedCount: 1,
        claimedMineCount: 0,
        claimedMineCoordinates: []
      }
    } as unknown as MatchState;

    expect(deserializeMatchState(serializeMatchState(matchState))).toEqual(matchState);
  });
});
