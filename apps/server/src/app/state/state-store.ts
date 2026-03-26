import {
  CHAT_HISTORY_LIMIT,
  REDIS_KEY_PREFIX,
  REDIS_URL,
  RECONNECT_SESSION_TTL_SECONDS
} from "../config/env.js";
import {
  InMemoryPlayerSessionStore,
  RedisPlayerSessionStore,
  type PlayerSessionStore
} from "../realtime/player-session.service.js";
import { createRedisStateClient, type RedisStateClient } from "./redis-state-client.js";
import type { MatchRepository } from "../../modules/matches/match.repository.js";
import {
  InMemoryMatchRepository,
  RedisMatchRepository
} from "../../modules/matches/match.repository.js";
import type { ChatRepository } from "../../modules/chat/chat.repository.js";
import {
  InMemoryChatRepository,
  RedisChatRepository
} from "../../modules/chat/chat.repository.js";
import type { RoomRepository } from "../../modules/rooms/room.repository.js";
import { InMemoryRoomRepository, RedisRoomRepository } from "../../modules/rooms/room.repository.js";
import type { StateBackend } from "./state-backend.js";

export interface StateStores {
  backend: StateBackend;
  roomRepository: RoomRepository;
  matchRepository: MatchRepository;
  chatRepository: ChatRepository;
  playerSessionStore: PlayerSessionStore;
  dispose(): Promise<void>;
}

interface CreateStateStoresOptions {
  redis?: {
    client?: RedisStateClient;
    url?: string;
    keyPrefix?: string;
    reconnectSessionTtlSeconds?: number;
  };
}

export const createStateStores = async (
  backend: StateBackend,
  options: CreateStateStoresOptions = {}
): Promise<StateStores> => {
  switch (backend) {
    case "memory":
      return {
        backend,
        roomRepository: new InMemoryRoomRepository(),
        matchRepository: new InMemoryMatchRepository(),
        chatRepository: new InMemoryChatRepository(CHAT_HISTORY_LIMIT),
        playerSessionStore: new InMemoryPlayerSessionStore(),
        dispose: async () => {}
      };
  }

  const redisOptions = options.redis ?? {};
  const redisClient = redisOptions.client;
  const redisUrl = redisOptions.url ?? REDIS_URL;

  if (!redisClient && !redisUrl) {
    throw new Error("STATE_BACKEND=redis requires REDIS_URL.");
  }

  const connectedRedisClient =
    redisClient ?? (await createRedisStateClient({ url: redisUrl as string }));
  const keyPrefix = redisOptions.keyPrefix ?? REDIS_KEY_PREFIX;
  const reconnectSessionTtlSeconds =
    redisOptions.reconnectSessionTtlSeconds ?? RECONNECT_SESSION_TTL_SECONDS;

  return {
    backend,
    roomRepository: new RedisRoomRepository(connectedRedisClient, keyPrefix),
    matchRepository: new RedisMatchRepository(connectedRedisClient, keyPrefix),
    chatRepository: new RedisChatRepository(connectedRedisClient, keyPrefix, CHAT_HISTORY_LIMIT),
    playerSessionStore: new RedisPlayerSessionStore(
      connectedRedisClient,
      keyPrefix,
      reconnectSessionTtlSeconds
    ),
    dispose: redisClient
      ? async () => {}
      : async () => {
          await connectedRedisClient.close();
        }
  };
};
