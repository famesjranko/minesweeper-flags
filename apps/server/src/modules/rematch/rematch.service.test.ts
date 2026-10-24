import { createMatchState } from "@minesweeper-flags/game-engine";
import { describe, expect, it } from "vitest";
import { KeyedSerialTaskRunner } from "../../lib/async/keyed-serial-task-runner.js";
import { InMemoryMatchRepository } from "../matches/match.repository.js";
import { MatchService } from "../matches/match.service.js";
import { InMemoryRoomRepository } from "../rooms/room.repository.js";
import { RoomService } from "../rooms/room.service.js";
import { RematchService } from "./rematch.service.js";

describe("rematch service", () => {
  it("serializes simultaneous rematch requests so exactly one new match is started", async () => {
    const roomTaskRunner = new KeyedSerialTaskRunner();
    const roomService = new RoomService(new InMemoryRoomRepository(), roomTaskRunner);
    const matchRepository = new InMemoryMatchRepository();
    const matchService = new MatchService(roomService, matchRepository, roomTaskRunner);
    const rematchService = new RematchService(roomService, matchService, roomTaskRunner);
    const { room: lobbyRoom } = await roomService.createRoom("Host", "classic");
    const { room } = await roomService.joinRoomByInviteToken(lobbyRoom.inviteToken ?? "", "Guest");
    const [host, guest] = room.players;

    if (!host || !guest) {
      throw new Error("Expected the fixture room to include both players.");
    }

    await matchRepository.save({
      ...createMatchState({
        roomId: room.roomId,
        players: [host, guest],
        seed: 100,
        createdAt: 100,
        startingPlayerId: host.playerId
      }),
      phase: "finished",
      turnPhase: "ended",
      currentTurnPlayerId: null,
      winnerPlayerId: host.playerId,
      updatedAt: 200
    });

    const results = await Promise.all([
      rematchService.requestRematch(room.roomCode, host.playerId, 300),
      rematchService.requestRematch(room.roomCode, guest.playerId, 301)
    ]);
    const restartedMatch = await matchService.getMatchByRoomCode(room.roomCode);

    expect(results.filter((result) => Boolean(result.match))).toHaveLength(1);
    expect(restartedMatch.state.phase).toBe("live");
    expect(restartedMatch.state.players.every((player) => !player.rematchRequested)).toBe(true);
    expect(restartedMatch.state.turnNumber).toBe(1);
  });

  it("starts the rematch on the room's board size", async () => {
    // Given a finished match in a room created with a large board
    const roomService = new RoomService(new InMemoryRoomRepository());
    const matchRepository = new InMemoryMatchRepository();
    const matchService = new MatchService(roomService, matchRepository);
    const rematchService = new RematchService(roomService, matchService);
    const { room: lobbyRoom } = await roomService.createRoom("Host", "large");
    const { room } = await roomService.joinRoomByInviteToken(lobbyRoom.inviteToken ?? "", "Guest");
    const [host, guest] = room.players;
    if (!host || !guest) throw new Error("Expected the fixture room to include both players.");
    const firstMatch = await matchService.startMatchForRoom(room, 100);
    await matchRepository.save({
      ...firstMatch.state,
      phase: "finished",
      turnPhase: "ended",
      currentTurnPlayerId: null,
      winnerPlayerId: host.playerId
    });

    // When both players request a rematch
    await rematchService.requestRematch(room.roomCode, host.playerId, 300);
    await rematchService.requestRematch(room.roomCode, guest.playerId, 301);

    // Then the new match is on a 20×20 board with 79 mines
    const { rows, columns, mineCount } = (await matchService.getMatchByRoomCode(room.roomCode))
      .state.board;
    expect({ rows, columns, mineCount }).toEqual({ rows: 20, columns: 20, mineCount: 79 });
    // And it is a fresh match, not the finished one
    expect((await matchService.getMatchByRoomCode(room.roomCode)).state.phase).toBe("live");
  });
});
