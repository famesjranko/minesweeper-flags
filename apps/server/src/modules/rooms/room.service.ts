import { createId, createRoomCode } from "../../lib/ids/id.js";
import type { RoomRepository } from "./room.repository.js";
import type { RoomPlayer, RoomRecord } from "./room.types.js";

export class RoomService {
  constructor(private readonly roomRepository: RoomRepository) {}

  async createRoom(displayName: string): Promise<{ room: RoomRecord; player: RoomPlayer }> {
    let roomCode = createRoomCode();

    while (await this.roomRepository.roomCodeExists(roomCode)) {
      roomCode = createRoomCode();
    }

    const player = {
      playerId: createId(),
      displayName
    };
    const now = Date.now();

    const room: RoomRecord = {
      roomId: createId(),
      roomCode,
      players: [player],
      nextStarterIndex: 0,
      createdAt: now,
      updatedAt: now
    };

    await this.roomRepository.save(room);

    return { room, player };
  }

  async joinRoom(
    roomCode: string,
    displayName: string
  ): Promise<{ room: RoomRecord; player: RoomPlayer }> {
    const room = await this.roomRepository.getByCode(roomCode);

    if (!room) {
      throw new Error("That room does not exist.");
    }

    if (room.players.length >= 2) {
      throw new Error("That room is already full.");
    }

    const player = {
      playerId: createId(),
      displayName
    };
    const now = Date.now();

    const updatedRoom: RoomRecord = {
      ...room,
      players: [...room.players, player],
      updatedAt: now
    };

    await this.roomRepository.save(updatedRoom);

    return { room: updatedRoom, player };
  }

  async getRoomByCode(roomCode: string): Promise<RoomRecord> {
    const room = await this.roomRepository.getByCode(roomCode);

    if (!room) {
      throw new Error("That room does not exist.");
    }

    return room;
  }

  getRoomByPlayerId(playerId: string): Promise<RoomRecord | undefined> {
    return this.roomRepository.getByPlayerId(playerId);
  }

  async advanceStarter(roomCode: string): Promise<RoomRecord> {
    const room = await this.getRoomByCode(roomCode);
    const updatedRoom: RoomRecord = {
      ...room,
      nextStarterIndex: room.nextStarterIndex === 0 ? 1 : 0,
      updatedAt: Date.now()
    };

    await this.roomRepository.save(updatedRoom);
    return updatedRoom;
  }

  async touchRoomActivity(roomCode: string, updatedAt = Date.now()): Promise<RoomRecord> {
    const room = await this.getRoomByCode(roomCode);

    if (room.updatedAt >= updatedAt) {
      return room;
    }

    const updatedRoom: RoomRecord = {
      ...room,
      updatedAt
    };

    await this.roomRepository.save(updatedRoom);
    return updatedRoom;
  }
}
