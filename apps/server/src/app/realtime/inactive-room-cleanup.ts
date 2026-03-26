import type { ChatRepository } from "../../modules/chat/chat.repository.js";
import { WebSocket } from "ws";
import type { MatchRepository } from "../../modules/matches/match.repository.js";
import type { RoomRepository } from "../../modules/rooms/room.repository.js";
import type { ConnectionRegistry } from "./connection.registry.js";
import type { PlayerSessionService } from "./player-session.service.js";

interface CleanupInactiveRoomsOptions {
  roomRepository: RoomRepository;
  matchRepository: MatchRepository;
  chatRepository: ChatRepository;
  playerSessionService: PlayerSessionService;
  connectionRegistry: ConnectionRegistry;
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
  now,
  ttlMs
}: CleanupInactiveRoomsOptions): Promise<RemovedRoomRecord[]> => {
  const cutoff = now - ttlMs;
  const removedRooms: RemovedRoomRecord[] = [];

  for (const room of await roomRepository.listAll()) {
    if (room.updatedAt > cutoff) {
      continue;
    }

    const hasActiveConnection = room.players.some((player) => {
      const socket = connectionRegistry.getSocketForPlayer(player.playerId);

      return (
        socket &&
        (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
      );
    });

    if (hasActiveConnection) {
      continue;
    }

    await roomRepository.delete(room.roomCode);
    await matchRepository.deleteByRoomId(room.roomId);
    await chatRepository.deleteByRoomCode(room.roomCode);
    await playerSessionService.revokeRoomSessions(room.roomCode);
    removedRooms.push({
      roomId: room.roomId,
      roomCode: room.roomCode,
      playerCount: room.players.length
    });
  }

  return removedRooms;
};
