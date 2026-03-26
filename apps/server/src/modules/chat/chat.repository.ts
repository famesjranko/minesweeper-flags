import type { RedisStateClient } from "../../app/state/redis-state-client.js";
import {
  deserializeChatMessageRecord,
  serializeChatMessageRecord
} from "../../app/state/state-codec.js";
import type { ChatMessageRecord } from "./chat.types.js";

export interface ChatRepository {
  append(roomCode: string, message: ChatMessageRecord): Promise<void>;
  listRecent(roomCode: string, limit: number): Promise<ChatMessageRecord[]>;
  deleteByRoomCode(roomCode: string): Promise<void>;
}

export class InMemoryChatRepository implements ChatRepository {
  private readonly messagesByRoomCode = new Map<string, ChatMessageRecord[]>();

  constructor(private readonly historyLimit: number) {}

  async append(roomCode: string, message: ChatMessageRecord): Promise<void> {
    const nextMessages = [...(this.messagesByRoomCode.get(roomCode) ?? []), { ...message }].slice(
      -this.historyLimit
    );

    this.messagesByRoomCode.set(roomCode, nextMessages);
  }

  async listRecent(roomCode: string, limit: number): Promise<ChatMessageRecord[]> {
    return (this.messagesByRoomCode.get(roomCode) ?? []).slice(-limit).map((message) => ({
      ...message
    }));
  }

  async deleteByRoomCode(roomCode: string): Promise<void> {
    this.messagesByRoomCode.delete(roomCode);
  }
}

export class RedisChatRepository implements ChatRepository {
  constructor(
    private readonly redis: RedisStateClient,
    private readonly keyPrefix: string,
    private readonly historyLimit: number
  ) {}

  async append(roomCode: string, message: ChatMessageRecord): Promise<void> {
    const roomKey = this.chatRoomKey(roomCode);

    await this.redis.rPush(roomKey, [serializeChatMessageRecord(message)]);
    await this.redis.lTrim(roomKey, -this.historyLimit, -1);
  }

  async listRecent(roomCode: string, limit: number): Promise<ChatMessageRecord[]> {
    const serializedMessages = await this.redis.lRange(this.chatRoomKey(roomCode), -limit, -1);

    return serializedMessages.map((message) => deserializeChatMessageRecord(message));
  }

  async deleteByRoomCode(roomCode: string): Promise<void> {
    await this.redis.del(this.chatRoomKey(roomCode));
  }

  private chatRoomKey(roomCode: string): string {
    return `${this.keyPrefix}:chat:rooms:${roomCode}`;
  }
}
