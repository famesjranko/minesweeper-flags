import type { RedisStateClient } from "../../app/state/redis-state-client.js";
import { deserializeRoomRecord, serializeRoomRecord } from "../../app/state/state-codec.js";
import type { RoomRecord } from "./room.types.js";

export interface RoomRepository {
  save(room: RoomRecord): Promise<void>;
  getByCode(roomCode: string): Promise<RoomRecord | undefined>;
  getByPlayerId(playerId: string): Promise<RoomRecord | undefined>;
  roomCodeExists(roomCode: string): Promise<boolean>;
  listAll(): Promise<RoomRecord[]>;
  delete(roomCode: string): Promise<RoomRecord | undefined>;
}

export class InMemoryRoomRepository implements RoomRepository {
  private readonly roomsByCode = new Map<string, RoomRecord>();
  private readonly roomCodesByPlayerId = new Map<string, string>();

  async save(room: RoomRecord): Promise<void> {
    this.roomsByCode.set(room.roomCode, room);

    for (const player of room.players) {
      this.roomCodesByPlayerId.set(player.playerId, room.roomCode);
    }
  }

  async getByCode(roomCode: string): Promise<RoomRecord | undefined> {
    return this.roomsByCode.get(roomCode);
  }

  async getByPlayerId(playerId: string): Promise<RoomRecord | undefined> {
    const roomCode = this.roomCodesByPlayerId.get(playerId);
    return roomCode ? this.roomsByCode.get(roomCode) : undefined;
  }

  async roomCodeExists(roomCode: string): Promise<boolean> {
    return this.roomsByCode.has(roomCode);
  }

  async listAll(): Promise<RoomRecord[]> {
    return Array.from(this.roomsByCode.values());
  }

  async delete(roomCode: string): Promise<RoomRecord | undefined> {
    const room = this.roomsByCode.get(roomCode);

    if (!room) {
      return undefined;
    }

    this.roomsByCode.delete(roomCode);

    for (const player of room.players) {
      if (this.roomCodesByPlayerId.get(player.playerId) === roomCode) {
        this.roomCodesByPlayerId.delete(player.playerId);
      }
    }

    return room;
  }
}

export class RedisRoomRepository implements RoomRepository {
  private readonly roomCodesKey: string;
  private readonly roomCodesByPlayerIdKey: string;

  constructor(
    private readonly redis: RedisStateClient,
    private readonly keyPrefix: string
  ) {
    this.roomCodesKey = this.key("rooms:index");
    this.roomCodesByPlayerIdKey = this.key("rooms:player-index");
  }

  async save(room: RoomRecord): Promise<void> {
    const existingRoom = await this.getByCode(room.roomCode);
    const nextPlayerIds = new Set(room.players.map((player) => player.playerId));
    const removedPlayerIds =
      existingRoom?.players
        .map((player) => player.playerId)
        .filter((playerId) => !nextPlayerIds.has(playerId)) ?? [];

    await this.redis.set(this.roomKey(room.roomCode), serializeRoomRecord(room));
    await this.redis.sAdd(this.roomCodesKey, [room.roomCode]);
    await this.redis.hSet(
      this.roomCodesByPlayerIdKey,
      Object.fromEntries(room.players.map((player) => [player.playerId, room.roomCode]))
    );

    if (removedPlayerIds.length > 0) {
      await this.redis.hDel(this.roomCodesByPlayerIdKey, removedPlayerIds);
    }
  }

  async getByCode(roomCode: string): Promise<RoomRecord | undefined> {
    const storedRoom = await this.redis.get(this.roomKey(roomCode));

    return storedRoom ? deserializeRoomRecord(storedRoom) : undefined;
  }

  async getByPlayerId(playerId: string): Promise<RoomRecord | undefined> {
    const roomCode = await this.redis.hGet(this.roomCodesByPlayerIdKey, playerId);

    if (!roomCode) {
      return undefined;
    }

    const room = await this.getByCode(roomCode);

    if (!room) {
      await this.redis.hDel(this.roomCodesByPlayerIdKey, [playerId]);
      return undefined;
    }

    return room;
  }

  async roomCodeExists(roomCode: string): Promise<boolean> {
    return (await this.redis.exists(this.roomKey(roomCode))) === 1;
  }

  async listAll(): Promise<RoomRecord[]> {
    const roomCodes = await this.redis.sMembers(this.roomCodesKey);
    const rooms = await Promise.all(roomCodes.map(async (roomCode) => await this.getByCode(roomCode)));
    const missingRoomCodes = roomCodes.filter((_, index) => !rooms[index]);

    if (missingRoomCodes.length > 0) {
      await this.redis.sRem(this.roomCodesKey, missingRoomCodes);
    }

    return rooms.filter((room): room is RoomRecord => Boolean(room));
  }

  async delete(roomCode: string): Promise<RoomRecord | undefined> {
    const room = await this.getByCode(roomCode);

    await this.redis.sRem(this.roomCodesKey, [roomCode]);

    if (!room) {
      return undefined;
    }

    await this.redis.del(this.roomKey(roomCode));
    await this.redis.hDel(
      this.roomCodesByPlayerIdKey,
      room.players.map((player) => player.playerId)
    );

    return room;
  }

  private key(suffix: string): string {
    return `${this.keyPrefix}:${suffix}`;
  }

  private roomKey(roomCode: string): string {
    return this.key(`rooms:records:${roomCode}`);
  }
}
