import { describe, expect, it } from "vitest";
import { createStateStores } from "./state-store.js";
import { PlayerSessionService } from "../realtime/player-session.service.js";
import type {
  RedisSetOptions,
  RedisStateClient,
  RedisTransactionCommand
} from "./redis-state-client.js";

class FakeRedisStateClient implements RedisStateClient {
  readonly expiryByKey = new Map<string, number>();
  private readonly strings = new Map<string, string>();
  private readonly lists = new Map<string, string[]>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sets = new Map<string, Set<string>>();

  private sliceList(key: string, start: number, stop: number): string[] {
    const list = this.lists.get(key) ?? [];
    const normalizedStart = start < 0 ? list.length + start : start;
    const normalizedStop = stop < 0 ? list.length + stop : stop;
    const boundedStart = Math.max(0, normalizedStart);
    const boundedStop = Math.min(list.length - 1, normalizedStop);

    if (boundedStart >= list.length || boundedStart > boundedStop) {
      return [];
    }

    return list.slice(boundedStart, boundedStop + 1);
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string, options?: RedisSetOptions): Promise<void> {
    this.strings.set(key, value);

    if (options?.expireInSeconds) {
      this.expiryByKey.set(key, options.expireInSeconds);
      return;
    }

    this.expiryByKey.delete(key);
  }

  async del(keys: string | string[]): Promise<number> {
    const keyList = Array.isArray(keys) ? keys : [keys];
    let removed = 0;

    for (const key of keyList) {
      removed += Number(this.strings.delete(key));
      removed += Number(this.lists.delete(key));
      removed += Number(this.hashes.delete(key));
      removed += Number(this.sets.delete(key));
      this.expiryByKey.delete(key);
    }

    return removed;
  }

  async exists(key: string): Promise<number> {
    return Number(
      this.strings.has(key) ||
        this.lists.has(key) ||
        this.hashes.has(key) ||
        this.sets.has(key)
    );
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    return this.sliceList(key, start, stop);
  }

  async lTrim(key: string, start: number, stop: number): Promise<void> {
    this.lists.set(key, this.sliceList(key, start, stop));
  }

  async rPush(key: string, values: string[]): Promise<number> {
    const list = this.lists.get(key) ?? [];
    const nextList = [...list, ...values];

    this.lists.set(key, nextList);

    return nextList.length;
  }

  async hGet(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hSet(key: string, values: Record<string, string>): Promise<number> {
    let hash = this.hashes.get(key);

    if (!hash) {
      hash = new Map<string, string>();
      this.hashes.set(key, hash);
    }

    let added = 0;

    for (const [field, value] of Object.entries(values)) {
      if (!hash.has(field)) {
        added += 1;
      }

      hash.set(field, value);
    }

    return added;
  }

  async hDel(key: string, fields: string[]): Promise<number> {
    const hash = this.hashes.get(key);

    if (!hash) {
      return 0;
    }

    let removed = 0;

    for (const field of fields) {
      removed += Number(hash.delete(field));
    }

    return removed;
  }

  async sAdd(key: string, members: string[]): Promise<number> {
    let set = this.sets.get(key);

    if (!set) {
      set = new Set<string>();
      this.sets.set(key, set);
    }

    let added = 0;

    for (const member of members) {
      if (!set.has(member)) {
        added += 1;
      }

      set.add(member);
    }

    return added;
  }

  async sMembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }

  async sRem(key: string, members: string[]): Promise<number> {
    const set = this.sets.get(key);

    if (!set) {
      return 0;
    }

    let removed = 0;

    for (const member of members) {
      removed += Number(set.delete(member));
    }

    return removed;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (
      !this.strings.has(key) &&
      !this.lists.has(key) &&
      !this.hashes.has(key) &&
      !this.sets.has(key)
    ) {
      return 0;
    }

    this.expiryByKey.set(key, seconds);
    return 1;
  }

  async executeTransaction(commands: RedisTransactionCommand[]): Promise<void> {
    for (const command of commands) {
      switch (command.type) {
        case "set":
          await this.set(command.key, command.value, command.options);
          break;
        case "del":
          await this.del(command.keys);
          break;
        case "lTrim":
          await this.lTrim(command.key, command.start, command.stop);
          break;
        case "rPush":
          await this.rPush(command.key, command.values);
          break;
        case "hSet":
          await this.hSet(command.key, command.values);
          break;
        case "hDel":
          await this.hDel(command.key, command.fields);
          break;
        case "sAdd":
          await this.sAdd(command.key, command.members);
          break;
        case "sRem":
          await this.sRem(command.key, command.members);
          break;
        case "expire":
          await this.expire(command.key, command.seconds);
          break;
      }
    }
  }

  async close(): Promise<void> {}
}

describe("state stores", () => {
  it("creates working in-memory adapters for the current server", async () => {
    const stateStores = await createStateStores("memory");
    const playerSessionService = new PlayerSessionService(stateStores.playerSessionStore);
    const room = {
      roomId: "room-1",
      roomCode: "ABCDE",
      players: [
        {
          playerId: "player-1",
          displayName: "Host"
        }
      ],
      nextStarterIndex: 0 as const,
      createdAt: 100,
      updatedAt: 100
    };

    await stateStores.roomRepository.save(room);
    expect(await stateStores.roomRepository.getByCode(room.roomCode)).toEqual(room);

    await stateStores.matchRepository.save({ roomId: room.roomId } as never);
    expect(await stateStores.matchRepository.getByRoomId(room.roomId)).toEqual({
      roomId: room.roomId
    });
    await stateStores.chatRepository.append(room.roomCode, {
      messageId: "message-1",
      playerId: room.players[0]!.playerId,
      displayName: room.players[0]!.displayName,
      text: "Hello",
      sentAt: 200
    });
    expect(await stateStores.chatRepository.listRecent(room.roomCode, 25)).toEqual([
      {
        messageId: "message-1",
        playerId: room.players[0]!.playerId,
        displayName: room.players[0]!.displayName,
        text: "Hello",
        sentAt: 200
      }
    ]);

    const session = await playerSessionService.createSession(room.roomCode, room.players[0]!);
    await expect(
      playerSessionService.requireSession(room.roomCode, session.sessionToken)
    ).resolves.toEqual(session);

    await stateStores.deleteRoomState(room);
    await expect(stateStores.roomRepository.getByCode(room.roomCode)).resolves.toBeUndefined();
  });

  it("creates working redis adapters with an injected redis client", async () => {
    const redis = new FakeRedisStateClient();
    const stateStores = await createStateStores("redis", {
      redis: {
        client: redis,
        keyPrefix: "test-prefix",
        reconnectSessionTtlSeconds: 90
      }
    });
    const playerSessionService = new PlayerSessionService(stateStores.playerSessionStore);
    const room = {
      roomId: "room-1",
      roomCode: "ABCDE",
      players: [
        {
          playerId: "player-1",
          displayName: "Host"
        }
      ],
      nextStarterIndex: 0 as const,
      createdAt: 100,
      updatedAt: 100
    };

    await stateStores.roomRepository.save(room);
    expect(await stateStores.roomRepository.getByCode(room.roomCode)).toEqual(room);
    expect(await stateStores.roomRepository.getByPlayerId(room.players[0]!.playerId)).toEqual(room);
    expect(await stateStores.roomRepository.roomCodeExists(room.roomCode)).toBe(true);
    expect(await stateStores.roomRepository.listAll()).toEqual([room]);

    await stateStores.matchRepository.save({ roomId: room.roomId } as never);
    expect(await stateStores.matchRepository.getByRoomId(room.roomId)).toEqual({
      roomId: room.roomId
    });
    await stateStores.chatRepository.append(room.roomCode, {
      messageId: "message-1",
      playerId: room.players[0]!.playerId,
      displayName: room.players[0]!.displayName,
      text: "Hello",
      sentAt: 200
    });
    expect(await stateStores.chatRepository.listRecent(room.roomCode, 25)).toEqual([
      {
        messageId: "message-1",
        playerId: room.players[0]!.playerId,
        displayName: room.players[0]!.displayName,
        text: "Hello",
        sentAt: 200
      }
    ]);

    const session = await playerSessionService.createSession(room.roomCode, room.players[0]!);
    await expect(
      playerSessionService.requireSession(room.roomCode, session.sessionToken)
    ).resolves.toEqual(session);
    expect(redis.expiryByKey.get(`test-prefix:sessions:records:${session.sessionToken}`)).toBe(90);
    expect(redis.expiryByKey.get(`test-prefix:sessions:room-index:${room.roomCode}`)).toBe(90);

    redis.expiryByKey.clear();

    await expect(
      playerSessionService.requireSession(room.roomCode, session.sessionToken)
    ).resolves.toEqual(session);
    expect(redis.expiryByKey.get(`test-prefix:sessions:records:${session.sessionToken}`)).toBe(90);
    expect(redis.expiryByKey.get(`test-prefix:sessions:room-index:${room.roomCode}`)).toBe(90);

    await stateStores.playerSessionStore.deleteByRoomCode(room.roomCode);
    await expect(
      playerSessionService.requireSession(room.roomCode, session.sessionToken)
    ).rejects.toThrow("That session is not valid for this room.");

    const sessionForDelete = await playerSessionService.createSession(room.roomCode, room.players[0]!);
    await stateStores.deleteRoomState(room);

    await expect(stateStores.roomRepository.getByCode(room.roomCode)).resolves.toBeUndefined();
    await expect(stateStores.matchRepository.getByRoomId(room.roomId)).resolves.toBeUndefined();
    await expect(stateStores.chatRepository.listRecent(room.roomCode, 25)).resolves.toEqual([]);
    await expect(
      playerSessionService.requireSession(room.roomCode, sessionForDelete.sessionToken)
    ).rejects.toThrow("That session is not valid for this room.");

    await stateStores.roomRepository.save(room);
    expect(await stateStores.roomRepository.delete(room.roomCode)).toEqual(room);
    expect(await stateStores.roomRepository.getByPlayerId(room.players[0]!.playerId)).toBeUndefined();
    expect(await stateStores.roomRepository.listAll()).toEqual([]);
    await stateStores.chatRepository.deleteByRoomCode(room.roomCode);
    expect(await stateStores.chatRepository.listRecent(room.roomCode, 25)).toEqual([]);
  });

  it("fails fast when the redis backend is selected without connection details", async () => {
    await expect(
      createStateStores("redis", {
        redis: {
          url: ""
        }
      })
    ).rejects.toThrow("STATE_BACKEND=redis requires REDIS_URL.");
  });
});
