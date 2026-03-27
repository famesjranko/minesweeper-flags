import type { ChatRepository } from "../../modules/chat/chat.repository.js";
import { WebSocket } from "ws";
import { KeyedSerialTaskRunner } from "../../lib/async/keyed-serial-task-runner.js";
import type { MatchRepository } from "../../modules/matches/match.repository.js";
import type { RoomRepository } from "../../modules/rooms/room.repository.js";
import type { RoomRecord } from "../../modules/rooms/room.types.js";
import type { ConnectionRegistry } from "./connection.registry.js";
import type { PlayerSessionService } from "./player-session.service.js";

interface CleanupInactiveRoomsOptions {
  roomRepository: RoomRepository;
  matchRepository: MatchRepository;
  chatRepository: ChatRepository;
  playerSessionService: PlayerSessionService;
  connectionRegistry: ConnectionRegistry;
  taskRunner: KeyedSerialTaskRunner;
  deleteRoomState?: (room: RoomRecord) => Promise<void>;
  now: number;
  ttlMs: number;
}

export interface RemovedRoomRecord {
  roomId: string;
  roomCode: string;
  playerCount: number;
}

export const cleanupInactiveRooms = async ({
  roomRepository,
  matchRepository,
  chatRepository,
  playerSessionService,
  connectionRegistry,
  taskRunner,
  deleteRoomState,
  now,
  ttlMs
}: CleanupInactiveRoomsOptions): Promise<RemovedRoomRecord[]> => {
  const cutoff = now - ttlMs;
  const removedRooms: RemovedRoomRecord[] = [];

  const removeRoomState =
    deleteRoomState ??
    (async (room: RoomRecord) => {
      await roomRepository.delete(room.roomCode);
      await matchRepository.deleteByRoomId(room.roomId);
      await chatRepository.deleteByRoomCode(room.roomCode);
      await playerSessionService.revokeRoomSessions(room.roomCode);
    });

  for (const snapshotRoom of await roomRepository.listAll()) {
    if (snapshotRoom.updatedAt > cutoff) {
      continue;
    }

    await taskRunner.run(snapshotRoom.roomCode, async () => {
      const room = await roomRepository.getByCode(snapshotRoom.roomCode);

      if (!room || room.updatedAt > cutoff) {
        return;
      }

      const hasActiveConnection = room.players.some((player) => {
        const socket = connectionRegistry.getSocketForPlayer(player.playerId);

        return (
          socket &&
          (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
        );
      });

      if (hasActiveConnection) {
        return;
      }

      await removeRoomState(room);
      removedRooms.push({
        roomId: room.roomId,
        roomCode: room.roomCode,
        playerCount: room.players.length
      });
    });
  }

  return removedRooms;
};
