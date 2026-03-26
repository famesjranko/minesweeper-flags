import type { MatchState } from "@minesweeper-flags/game-engine";
import type { RedisStateClient } from "../../app/state/redis-state-client.js";
import { deserializeMatchState, serializeMatchState } from "../../app/state/state-codec.js";

export interface MatchRepository {
  save(matchState: MatchState): Promise<void>;
  getByRoomId(roomId: string): Promise<MatchState | undefined>;
  deleteByRoomId(roomId: string): Promise<void>;
}

export class InMemoryMatchRepository implements MatchRepository {
  private readonly matchesByRoomId = new Map<string, MatchState>();

  async save(matchState: MatchState): Promise<void> {
    this.matchesByRoomId.set(matchState.roomId, matchState);
  }

  async getByRoomId(roomId: string): Promise<MatchState | undefined> {
    return this.matchesByRoomId.get(roomId);
  }

  async deleteByRoomId(roomId: string): Promise<void> {
    this.matchesByRoomId.delete(roomId);
  }
}

export class RedisMatchRepository implements MatchRepository {
  constructor(
    private readonly redis: RedisStateClient,
    private readonly keyPrefix: string
  ) {}

  async save(matchState: MatchState): Promise<void> {
    await this.redis.set(this.matchKey(matchState.roomId), serializeMatchState(matchState));
  }

  async getByRoomId(roomId: string): Promise<MatchState | undefined> {
    const storedMatchState = await this.redis.get(this.matchKey(roomId));

    return storedMatchState ? deserializeMatchState(storedMatchState) : undefined;
  }

  async deleteByRoomId(roomId: string): Promise<void> {
    await this.redis.del(this.matchKey(roomId));
  }

  private matchKey(roomId: string): string {
    return `${this.keyPrefix}:matches:records:${roomId}`;
  }
}
