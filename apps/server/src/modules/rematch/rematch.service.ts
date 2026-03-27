import type { MatchStateDto } from "@minesweeper-flags/shared";
import { KeyedSerialTaskRunner } from "../../lib/async/keyed-serial-task-runner.js";
import type { MatchService } from "../matches/match.service.js";
import type { RoomService } from "../rooms/room.service.js";

export interface RematchResult {
  roomCode: string;
  players: Array<{ playerId: string; rematchRequested: boolean }>;
  readyCount: number;
  match?: MatchStateDto;
}

export class RematchService {
  constructor(
    private readonly roomService: RoomService,
    private readonly matchService: MatchService,
    private readonly taskRunner: KeyedSerialTaskRunner = new KeyedSerialTaskRunner()
  ) {}

  async requestRematch(roomCode: string, playerId: string, now: number): Promise<RematchResult> {
    return await this.taskRunner.run(roomCode, async () => {
      const existing = await this.matchService.getMatchByRoomCode(roomCode);

      if (existing.state.phase !== "finished") {
        throw new Error("Rematch is only available once the current match has ended.");
      }

      const current = await this.matchService.setRematchRequested(roomCode, playerId, true);
      const readyCount = current.state.players.filter((player) => player.rematchRequested).length;

      if (readyCount === 2) {
        const room = await this.roomService.advanceStarter(roomCode);
        const started = await this.matchService.startMatchForRoom(room, now);

        return {
          roomCode,
          players: started.state.players.map((player) => ({
            playerId: player.playerId,
            rematchRequested: false
          })),
          readyCount: 0,
          match: started.dto
        };
      }

      return {
        roomCode,
        players: current.state.players.map((player) => ({
          playerId: player.playerId,
          rematchRequested: player.rematchRequested
        })),
        readyCount
      };
    });
  }

  async cancelRematch(roomCode: string, playerId: string): Promise<RematchResult> {
    return await this.taskRunner.run(roomCode, async () => {
      const existing = await this.matchService.getMatchByRoomCode(roomCode);

      if (existing.state.phase !== "finished") {
        throw new Error("Rematch is only available once the current match has ended.");
      }

      const current = await this.matchService.setRematchRequested(roomCode, playerId, false);
      return {
        roomCode,
        players: current.state.players.map((player) => ({
          playerId: player.playerId,
          rematchRequested: player.rematchRequested
        })),
        readyCount: current.state.players.filter((player) => player.rematchRequested).length
      };
    });
  }
}
