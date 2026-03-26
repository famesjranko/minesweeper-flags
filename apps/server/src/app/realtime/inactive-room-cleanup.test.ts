import { describe, expect, it } from "vitest";
import type { MatchState } from "@minesweeper-flags/game-engine";
import type WebSocket from "ws";
import { InMemoryMatchRepository } from "../../modules/matches/match.repository.js";
import { InMemoryRoomRepository } from "../../modules/rooms/room.repository.js";
import type { RoomRecord } from "../../modules/rooms/room.types.js";
import { ConnectionRegistry } from "./connection.registry.js";
import { cleanupInactiveRooms } from "./inactive-room-cleanup.js";
import { PlayerSessionService } from "./player-session.service.js";

const createSocket = (readyState = 1) =>
  ({ readyState, close: () => undefined } as unknown as WebSocket);

const createRoom = (updatedAt: number): RoomRecord => ({
  roomId: "room-1",
  roomCode: "ABCDE",
  players: [
    {
      playerId: "player-1",
      displayName: "Host"
    }
  ],
  nextStarterIndex: 0,
  createdAt: 0,
  updatedAt
});

describe("inactive room cleanup", () => {
  it("removes expired room state and revokes its reconnect sessions", async () => {
    const roomRepository = new InMemoryRoomRepository();
    const matchRepository = new InMemoryMatchRepository();
    const playerSessionService = new PlayerSessionService();
    const connectionRegistry = new ConnectionRegistry();
    const room = createRoom(0);
    const [host] = room.players;

    if (!host) {
      throw new Error("Expected the fixture room to include a host.");
    }

    await roomRepository.save(room);
    await matchRepository.save({ roomId: room.roomId } as MatchState);
    const session = await playerSessionService.createSession(room.roomCode, host);

    await expect(
      cleanupInactiveRooms({
        roomRepository,
        matchRepository,
        playerSessionService,
        connectionRegistry,
        now: 5_000,
        ttlMs: 1_000
      })
    ).resolves.toEqual([
      {
        roomId: room.roomId,
        roomCode: room.roomCode,
        playerCount: room.players.length
      }
    ]);

    await expect(roomRepository.getByCode(room.roomCode)).resolves.toBeUndefined();
    await expect(matchRepository.getByRoomId(room.roomId)).resolves.toBeUndefined();
    await expect(
      playerSessionService.requireSession(room.roomCode, session.sessionToken)
    ).rejects.toThrow("That session is not valid for this room.");
  });

  it("keeps expired rooms that still have an active socket", async () => {
    const roomRepository = new InMemoryRoomRepository();
    const matchRepository = new InMemoryMatchRepository();
    const playerSessionService = new PlayerSessionService();
    const connectionRegistry = new ConnectionRegistry();
    const room = createRoom(0);
    const [host] = room.players;

    if (!host) {
      throw new Error("Expected the fixture room to include a host.");
    }

    await roomRepository.save(room);
    await matchRepository.save({ roomId: room.roomId } as MatchState);
    const session = await playerSessionService.createSession(room.roomCode, host);
    connectionRegistry.attach(session, createSocket());

    await expect(
      cleanupInactiveRooms({
        roomRepository,
        matchRepository,
        playerSessionService,
        connectionRegistry,
        now: 5_000,
        ttlMs: 1_000
      })
    ).resolves.toEqual([]);

    await expect(roomRepository.getByCode(room.roomCode)).resolves.toEqual(room);
    await expect(matchRepository.getByRoomId(room.roomId)).resolves.toEqual({
      roomId: room.roomId
    });
    await expect(
      playerSessionService.requireSession(room.roomCode, session.sessionToken)
    ).resolves.toEqual(session);
  });
});
