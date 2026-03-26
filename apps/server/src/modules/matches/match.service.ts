import {
  clearRematchVotes,
  createMatchState,
  resolveAction,
  resignMatch,
  setPlayerRematchRequested,
  setPlayerConnection,
  type MatchAction,
  type MatchState
} from "@minesweeper-flags/game-engine";
import type { MatchStateDto } from "@minesweeper-flags/shared";
import type { RoomService } from "../rooms/room.service.js";
import type { RoomRecord } from "../rooms/room.types.js";
import type { MatchRepository } from "./match.repository.js";
import type { MatchResult } from "./match.types.js";

const toMatchStateDto = (matchState: MatchState): MatchStateDto => ({
  roomId: matchState.roomId,
  phase: matchState.phase,
  board: {
    rows: matchState.board.rows,
    columns: matchState.board.columns,
    mineCount: matchState.board.mineCount,
    cells: matchState.board.cells.map((row) =>
      row.map((cell) => {
        if (cell.claimedByPlayerId) {
          return {
            row: cell.row,
            column: cell.column,
            status: "claimed" as const,
            adjacentMines: null,
            claimedByPlayerId: cell.claimedByPlayerId
          };
        }

        if (cell.isRevealed) {
          return {
            row: cell.row,
            column: cell.column,
            status: "revealed" as const,
            adjacentMines: cell.adjacentMines,
            claimedByPlayerId: null
          };
        }

        if (matchState.phase === "finished" && cell.hasMine) {
          return {
            row: cell.row,
            column: cell.column,
            status: "mine-revealed" as const,
            adjacentMines: null,
            claimedByPlayerId: null
          };
        }

        return {
          row: cell.row,
          column: cell.column,
          status: "hidden" as const,
          adjacentMines: null,
          claimedByPlayerId: null
        };
      })
    )
  },
  players: [
    { ...matchState.players[0] },
    { ...matchState.players[1] }
  ],
  currentTurnPlayerId: matchState.currentTurnPlayerId,
  turnPhase: matchState.turnPhase,
  turnNumber: matchState.turnNumber,
  winnerPlayerId: matchState.winnerPlayerId,
  lastAction: matchState.lastAction
    ? {
        ...matchState.lastAction,
        claimedMineCoordinates: matchState.lastAction.claimedMineCoordinates
      }
    : null
});

export class MatchService {
  constructor(
    private readonly roomService: RoomService,
    private readonly matchRepository: MatchRepository
  ) {}

  async startMatchForRoom(room: RoomRecord, startedAt: number): Promise<MatchResult> {
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
  }

  async setConnectionState(
    roomCode: string,
    playerId: string,
    connected: boolean
  ): Promise<MatchResult | null> {
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
  }

  async resign(roomCode: string, playerId: string, now: number): Promise<MatchResult> {
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
  }

  async setRematchRequested(
    roomCode: string,
    playerId: string,
    rematchRequested: boolean
  ): Promise<MatchResult> {
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
  }

  async clearRematchRequested(roomCode: string): Promise<MatchResult> {
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
  }
}

export { toMatchStateDto };
