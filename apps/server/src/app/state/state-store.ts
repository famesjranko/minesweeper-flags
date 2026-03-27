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
import type { RoomRecord } from "../../modules/rooms/room.types.js";
import type { StateBackend } from "./state-backend.js";

export interface StateStores {
  backend: StateBackend;
  roomRepository: RoomRepository;
  matchRepository: MatchRepository;
  chatRepository: ChatRepository;
  playerSessionStore: PlayerSessionStore;
  deleteRoomState(room: RoomRecord): Promise<void>;
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
    case "memory": {
      const roomRepository = new InMemoryRoomRepository();
      const matchRepository = new InMemoryMatchRepository();
      const chatRepository = new InMemoryChatRepository(CHAT_HISTORY_LIMIT);
      const playerSessionStore = new InMemoryPlayerSessionStore();

      return {
        backend,
        roomRepository,
        matchRepository,
        chatRepository,
        playerSessionStore,
        deleteRoomState: async (room) => {
          await Promise.all([
            roomRepository.delete(room.roomCode),
            matchRepository.deleteByRoomId(room.roomId),
            chatRepository.deleteByRoomCode(room.roomCode),
            playerSessionStore.deleteByRoomCode(room.roomCode)
          ]);
        },
        dispose: async () => {}
      };
    }
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
  const roomRepository = new RedisRoomRepository(connectedRedisClient, keyPrefix);
  const matchRepository = new RedisMatchRepository(connectedRedisClient, keyPrefix);
  const chatRepository = new RedisChatRepository(connectedRedisClient, keyPrefix, CHAT_HISTORY_LIMIT);
  const playerSessionStore = new RedisPlayerSessionStore(
    connectedRedisClient,
    keyPrefix,
    reconnectSessionTtlSeconds
  );
  const buildKey = (suffix: string) => `${keyPrefix}:${suffix}`;

  const stateStores: StateStores = {
    backend,
    roomRepository,
    matchRepository,
    chatRepository,
    playerSessionStore,
    deleteRoomState: async (room) => {
      const roomSessionsKey = buildKey(`sessions:room-index:${room.roomCode}`);
      const sessionTokens = await connectedRedisClient.sMembers(roomSessionsKey);

      await connectedRedisClient.executeTransaction([
        {
          type: "sRem",
          key: buildKey("rooms:index"),
          members: [room.roomCode]
        },
        {
          type: "hDel",
          key: buildKey("rooms:player-index"),
          fields: room.players.map((player) => player.playerId)
        },
        {
          type: "del",
          keys: [
            buildKey(`rooms:records:${room.roomCode}`),
            buildKey(`matches:records:${room.roomId}`),
            buildKey(`chat:rooms:${room.roomCode}`),
            roomSessionsKey,
            ...sessionTokens.map((sessionToken) => buildKey(`sessions:records:${sessionToken}`))
          ]
        }
      ]);
    },
    dispose: redisClient
      ? async () => {}
      : async () => {
          await connectedRedisClient.close();
        }
  };

  return stateStores;
};
