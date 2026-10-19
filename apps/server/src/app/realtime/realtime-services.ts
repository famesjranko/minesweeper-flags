import { KeyedSerialTaskRunner } from "../../lib/async/keyed-serial-task-runner.js";
import { ChatService } from "../../modules/chat/chat.service.js";
import { MatchService } from "../../modules/matches/match.service.js";
import { RematchService } from "../../modules/rematch/rematch.service.js";
import { RoomService } from "../../modules/rooms/room.service.js";
import { GameCommandService } from "../commands/game-command.service.js";
import {
  CHAT_HISTORY_LIMIT,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_MESSAGE_RATE_LIMIT_MAX,
  CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS,
  INVALID_MESSAGE_RATE_LIMIT_MAX,
  INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS,
  MAX_CONCURRENT_ROOMS,
  MAX_CONNECTIONS_PER_IP,
  ROOM_CREATE_RATE_LIMIT_MAX,
  ROOM_CREATE_RATE_LIMIT_WINDOW_MS,
  ROOM_JOIN_RATE_LIMIT_MAX,
  ROOM_JOIN_RATE_LIMIT_WINDOW_MS
} from "../config/env.js";
import type { StateStores } from "../state/state-store.js";
import { ConnectionRegistry } from "./connection.registry.js";
import { PlayerSessionService } from "./player-session.service.js";
import { RealtimeAbusePrevention } from "./realtime-abuse-prevention.js";

export interface RealtimeServices {
  /** Serializes every room mutation, across services and cleanup, by room code. */
  roomTaskRunner: KeyedSerialTaskRunner;
  roomService: RoomService;
  playerSessionService: PlayerSessionService;
  commandService: GameCommandService;
  connectionRegistry: ConnectionRegistry;
  abusePrevention: RealtimeAbusePrevention;
}

/** Wires the gameplay services and connection guards for one realtime server. */
export const createRealtimeServices = ({
  roomRepository,
  matchRepository,
  chatRepository,
  playerSessionStore
}: StateStores): RealtimeServices => {
  const roomTaskRunner = new KeyedSerialTaskRunner();
  const roomService = new RoomService(roomRepository, roomTaskRunner);
  const matchService = new MatchService(roomService, matchRepository, roomTaskRunner);
  const chatService = new ChatService(roomService, chatRepository, {
    historyLimit: CHAT_HISTORY_LIMIT,
    messageMaxLength: CHAT_MESSAGE_MAX_LENGTH
  });
  const rematchService = new RematchService(roomService, matchService, roomTaskRunner);
  const playerSessionService = new PlayerSessionService(playerSessionStore);
  const commandService = new GameCommandService({
    roomService,
    matchService,
    chatService,
    rematchService,
    playerSessionService,
    maxConcurrentRooms: MAX_CONCURRENT_ROOMS
  });
  const connectionRegistry = new ConnectionRegistry();
  const abusePrevention = new RealtimeAbusePrevention({
    maxConnectionsPerIp: MAX_CONNECTIONS_PER_IP,
    roomCreateLimit: {
      maxEvents: ROOM_CREATE_RATE_LIMIT_MAX,
      windowMs: ROOM_CREATE_RATE_LIMIT_WINDOW_MS
    },
    roomJoinLimit: {
      maxEvents: ROOM_JOIN_RATE_LIMIT_MAX,
      windowMs: ROOM_JOIN_RATE_LIMIT_WINDOW_MS
    },
    chatMessageLimit: {
      maxEvents: CHAT_MESSAGE_RATE_LIMIT_MAX,
      windowMs: CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS
    },
    invalidMessageLimit: {
      maxEvents: INVALID_MESSAGE_RATE_LIMIT_MAX,
      windowMs: INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS
    }
  });

  return {
    roomTaskRunner,
    roomService,
    playerSessionService,
    commandService,
    connectionRegistry,
    abusePrevention
  };
};
