import {
  clearRematchVotes,
  createMatchState,
  resolveAction,
  resignMatch,
  setPlayerRematchRequested,
  setPlayerConnection,
  type MatchAction
} from "@minesweeper-flags/game-engine";
import { toMatchStateDto, type MatchStateDto } from "@minesweeper-flags/shared";
import { KeyedSerialTaskRunner } from "../../lib/async/keyed-serial-task-runner.js";
import type { RoomService } from "../rooms/room.service.js";
import type { RoomRecord } from "../rooms/room.types.js";
import type { MatchRepository } from "./match.repository.js";
import type { MatchResult } from "./match.types.js";

export class MatchService {
  constructor(
    private readonly roomService: RoomService,
    private readonly matchRepository: MatchRepository,
    private readonly taskRunner: KeyedSerialTaskRunner = new KeyedSerialTaskRunner()
  ) {}

  async startMatchForRoom(room: RoomRecord, startedAt: number): Promise<MatchResult> {
    return await this.taskRunner.run(room.roomCode, async () => {
      if (room.players.length !== 2) {
        throw new Error("Two players are required to start a match.");
      }

      const [firstPlayer, secondPlayer] = room.players;

      if (!firstPlayer || !secondPlayer) {
        throw new Error("Two players are required to start a match.");
      }

      const matchState = createMatchState({
        roomId: room.roomId,
        players: [
          firstPlayer,
          secondPlayer
        ],
        seed: startedAt,
        createdAt: startedAt,
        startingPlayerId: room.players[room.nextStarterIndex]?.playerId ?? firstPlayer.playerId
      });

      await this.matchRepository.save(matchState);

      return {
        roomCode: room.roomCode,
        state: matchState,
        dto: toMatchStateDto(matchState)
      };
    });
  }

  async getMatchByRoomCode(roomCode: string): Promise<MatchResult> {
    const room = await this.roomService.getRoomByCode(roomCode);
    const matchState = await this.matchRepository.getByRoomId(room.roomId);

    if (!matchState) {
      throw new Error("No match exists for this room yet.");
    }

    return {
      roomCode,
      state: matchState,
      dto: toMatchStateDto(matchState)
    };
  }

  async applyAction(
    roomCode: string,
    playerId: string,
    action: Omit<MatchAction, "playerId">,
    now: number
  ): Promise<MatchResult> {
    return await this.taskRunner.run(roomCode, async () => {
      const room = await this.roomService.getRoomByCode(roomCode);
      const matchState = await this.matchRepository.getByRoomId(room.roomId);

      if (!matchState) {
        throw new Error("The match has not started yet.");
      }

      const resolution = resolveAction(matchState, { ...action, playerId } as MatchAction, now);

      if (!resolution.ok) {
        throw new Error(resolution.error);
      }

      await this.matchRepository.save(resolution.state);

      return {
        roomCode,
        state: resolution.state,
        dto: toMatchStateDto(resolution.state)
      };
    });
  }

  async setConnectionState(
    roomCode: string,
    playerId: string,
    connected: boolean
  ): Promise<MatchResult | null> {
    return await this.taskRunner.run(roomCode, async () => {
      const room = await this.roomService.getRoomByCode(roomCode);
      const matchState = await this.matchRepository.getByRoomId(room.roomId);

      if (!matchState) {
        return null;
      }

      const nextState = setPlayerConnection(matchState, playerId, connected);
      await this.matchRepository.save(nextState);

      return {
        roomCode,
        state: nextState,
        dto: toMatchStateDto(nextState)
      };
    });
  }

  async resign(roomCode: string, playerId: string, now: number): Promise<MatchResult> {
    return await this.taskRunner.run(roomCode, async () => {
      const room = await this.roomService.getRoomByCode(roomCode);
      const matchState = await this.matchRepository.getByRoomId(room.roomId);

      if (!matchState) {
        throw new Error("The match has not started yet.");
      }

      const nextState = resignMatch(matchState, playerId, now);
      await this.matchRepository.save(nextState);

      return {
        roomCode,
        state: nextState,
        dto: toMatchStateDto(nextState)
      };
    });
  }

  async setRematchRequested(
    roomCode: string,
    playerId: string,
    rematchRequested: boolean
  ): Promise<MatchResult> {
    return await this.taskRunner.run(roomCode, async () => {
      const room = await this.roomService.getRoomByCode(roomCode);
      const matchState = await this.matchRepository.getByRoomId(room.roomId);

      if (!matchState) {
        throw new Error("The match has not started yet.");
      }

      const nextState = setPlayerRematchRequested(matchState, playerId, rematchRequested);
      await this.matchRepository.save(nextState);

      return {
        roomCode,
        state: nextState,
        dto: toMatchStateDto(nextState)
      };
    });
  }

  async clearRematchRequested(roomCode: string): Promise<MatchResult> {
    return await this.taskRunner.run(roomCode, async () => {
      const room = await this.roomService.getRoomByCode(roomCode);
      const matchState = await this.matchRepository.getByRoomId(room.roomId);

      if (!matchState) {
        throw new Error("The match has not started yet.");
      }

      const nextState = clearRematchVotes(matchState);
      await this.matchRepository.save(nextState);

      return {
        roomCode,
        state: nextState,
        dto: toMatchStateDto(nextState)
      };
    });
  }
}
