import { createServer, type ServerResponse } from "node:http";
import type { Socket as NetSocket } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  WEBSOCKET_CLOSE_CODES,
  WEBSOCKET_CLOSE_REASONS,
  clientEventSchema,
  serverEventSchema,
  type ServerEvent
} from "@minesweeper-flags/shared";
import { logger } from "../../lib/logging/logger.js";
import { createId } from "../../lib/ids/id.js";
import { KeyedSerialTaskRunner } from "../../lib/async/keyed-serial-task-runner.js";
import { ConnectionRegistry } from "./connection.registry.js";
import { resolveClientAddress } from "./client-address.js";
import { cleanupInactiveRooms } from "./inactive-room-cleanup.js";
import { PlayerSessionService, type PlayerSession } from "./player-session.service.js";
import { createStateStores, type StateStores } from "../state/state-store.js";
import { RealtimeAbusePrevention } from "./realtime-abuse-prevention.js";
import { requireAttachedSession } from "./session-auth.js";
import { SocketHeartbeatMonitor } from "./socket-heartbeat.js";
import {
  handleMatchAction,
  handleMatchResign,
  handleReconnect,
  handleSocketClosed
} from "../../modules/matches/match.handlers.js";
import {
  handleChatSend,
  sendChatHistory,
  sendChatRejected
} from "../../modules/chat/chat.handlers.js";
import { ChatService } from "../../modules/chat/chat.service.js";
import { MatchService } from "../../modules/matches/match.service.js";
import { handleRematchCancel, handleRematchRequest } from "../../modules/rematch/rematch.handlers.js";
import { RematchService } from "../../modules/rematch/rematch.service.js";
import { handleRoomCreate, handleRoomJoin } from "../../modules/rooms/room.handlers.js";
import { RoomService } from "../../modules/rooms/room.service.js";
import {
  CHAT_HISTORY_LIMIT,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_MESSAGE_RATE_LIMIT_MAX,
  CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS,
  INVALID_MESSAGE_RATE_LIMIT_MAX,
  INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS,
  MAX_CONNECTIONS_PER_IP,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  ROOM_CREATE_RATE_LIMIT_MAX,
  ROOM_CREATE_RATE_LIMIT_WINDOW_MS,
  ROOM_JOIN_RATE_LIMIT_MAX,
  ROOM_JOIN_RATE_LIMIT_WINDOW_MS,
  STATE_BACKEND,
  SOCKET_HEARTBEAT_INTERVAL_MS,
  WEBSOCKET_ALLOWED_ORIGINS,
  TRUST_PROXY
} from "../config/env.js";
import {
  getRawMessageByteLength,
  isAllowedWebSocketOrigin
} from "./websocket-admission.js";

const INACTIVE_ROOM_TTL_MS = 30 * 60 * 1000;
const INACTIVE_ROOM_SWEEP_INTERVAL_MS = 60 * 1000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

const sendEvent = (socket: WebSocket, event: ServerEvent): void => {
  const parsed = serverEventSchema.parse(event);
  socket.send(JSON.stringify(parsed));
};

type RealtimeServerLifecycleState = "starting" | "ready" | "shutting_down" | "stopped";

type ShutdownTrigger = NodeJS.Signals | "manual" | "startup_failure";

interface ShutdownOptions {
  signal?: ShutdownTrigger;
  timeoutMs?: number;
}

interface SocketContext {
  connectionId: string;
  remoteAddress: string;
  openedAt: number;
}

interface RealtimeServerOptions {
  websocketPath: string;
  stateStores?: StateStores;
}

interface StartRealtimeServerOptions extends RealtimeServerOptions {
  host: string;
  port: number;
}

export interface StartedRealtimeServer {
  httpServer: ReturnType<typeof createServer>;
  webSocketServer: WebSocketServer;
  shutdown: (options?: ShutdownOptions) => Promise<void>;
}

interface RealtimeServerController extends StartedRealtimeServer {
  markReady: () => void;
}

const respondWithJson = (
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>
) => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

const getRequestPath = (requestUrl?: string): string =>
  new URL(requestUrl ?? "/", "http://127.0.0.1").pathname;

const getCloseReason = (reasonBuffer: Buffer): string | undefined => {
  const reason = reasonBuffer.toString();

  return reason ? reason : undefined;
};

const getStatusText = (statusCode: number): string => {
  switch (statusCode) {
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 503:
      return "Service Unavailable";
    default:
      return "Error";
  }
};

const rejectWebSocketUpgrade = (socket: Duplex, statusCode: number, message: string): void => {
  const body = `${message}\n`;

  socket.write(
    [
      `HTTP/1.1 ${statusCode} ${getStatusText(statusCode)}`,
      "Connection: close",
      "Content-Type: text/plain; charset=utf-8",
      `Content-Length: ${Buffer.byteLength(body)}`,
      "",
      body
    ].join("\r\n")
  );
  socket.destroy();
};

const rawDataToString = (message: RawData): string => {
  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return Buffer.concat(message).toString();
  }

  if (message instanceof ArrayBuffer) {
    return Buffer.from(message).toString();
  }

  return Buffer.from(message as Uint8Array).toString();
};

export const createRealtimeServer = async ({
  websocketPath,
  stateStores
}: RealtimeServerOptions): Promise<RealtimeServerController> => {
  const ownsStateStores = !stateStores;
  const activeStateStores = stateStores ?? (await createStateStores(STATE_BACKEND));
  const { roomRepository, matchRepository, chatRepository, playerSessionStore } = activeStateStores;
  const roomTaskRunner = new KeyedSerialTaskRunner();
  const roomService = new RoomService(roomRepository, roomTaskRunner);
  const matchService = new MatchService(roomService, matchRepository, roomTaskRunner);
  const chatService = new ChatService(roomService, chatRepository, {
    historyLimit: CHAT_HISTORY_LIMIT,
    messageMaxLength: CHAT_MESSAGE_MAX_LENGTH
  });
  const rematchService = new RematchService(roomService, matchService, roomTaskRunner);
  const playerSessionService = new PlayerSessionService(playerSessionStore);
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
  const activeSockets = new Set<NetSocket>();
  const socketContexts = new WeakMap<WebSocket, SocketContext>();
  let lifecycleState: RealtimeServerLifecycleState = "starting";
  let shutdownPromise: Promise<void> | undefined;

  const getSocketContext = (socket: WebSocket): SocketContext =>
    socketContexts.get(socket) ?? {
      connectionId: "unknown",
      remoteAddress: "unknown",
      openedAt: Date.now()
    };
  const heartbeatMonitor = new SocketHeartbeatMonitor({
    intervalMs: SOCKET_HEARTBEAT_INTERVAL_MS,
    onStaleSocket: (socket) => {
      const socketContext = getSocketContext(socket);

      logger.warn("realtime.connection_stale", {
        connectionId: socketContext.connectionId,
        remoteAddress: socketContext.remoteAddress
      });
    }
  });

  const createSession = async (
    roomCode: string,
    player: { playerId: string; displayName: string }
  ) => await playerSessionService.createSession(roomCode, player);

  const sendRoomState = async (socket: WebSocket, roomCode: string) => {
    const room = await roomService.getRoomByCode(roomCode);

    sendEvent(socket, {
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: room.roomId,
        roomCode: room.roomCode,
        players: room.players
      }
    });
  };

  const broadcastToRoom = async (roomCode: string, event: ServerEvent) => {
    const room = await roomService.getRoomByCode(roomCode);

    for (const player of room.players) {
      const socket = connectionRegistry.getSocketForPlayer(player.playerId);

      if (socket && socket.readyState === WebSocket.OPEN) {
        sendEvent(socket, event);
      }
    }
  };
  const sendRoomChatHistory = async (socket: WebSocket, roomCode: string) => {
    await sendChatHistory(socket, roomCode, {
      chatService,
      roomService,
      sendEvent,
      broadcastToRoom
    });
  };

  const matchHandlerDependencies = {
    roomService,
    matchService,
    sendEvent,
    sendRoomState,
    sendChatHistory: sendRoomChatHistory,
    broadcastToRoom
  };

  const attachSessionSocket = async (session: PlayerSession, socket: WebSocket) => {
    const { displacedSession, replacedSocket } = connectionRegistry.attach(session, socket);

    if (displacedSession) {
      await handleSocketClosed(displacedSession, {
        ...matchHandlerDependencies,
        attachSessionSocket
      });
    }

    if (replacedSocket && replacedSocket.readyState !== WebSocket.CLOSED) {
      replacedSocket.close(
        WEBSOCKET_CLOSE_CODES.sessionReplaced,
        WEBSOCKET_CLOSE_REASONS.sessionReplaced
      );
    }
  };

  const sendServerError = (socket: WebSocket, message: string) => {
    sendEvent(socket, {
      type: SERVER_EVENT_NAMES.serverError,
      payload: {
        message
      }
    });
  };

  const httpServer = createServer((request, response) => {
    const path = getRequestPath(request.url);

    if (path === "/" || path === "/health") {
      respondWithJson(response, 200, { status: "ok" });
      return;
    }

    if (path === "/ready") {
      respondWithJson(response, lifecycleState === "ready" ? 200 : 503, {
        status: lifecycleState === "ready" ? "ready" : lifecycleState
      });
      return;
    }

    respondWithJson(response, 404, { status: "not_found" });
  });

  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES
  });
  const stopHeartbeat = heartbeatMonitor.start(webSocketServer);
  const cleanupInterval = setInterval(() => {
    void (async () => {
      const removedRooms = await cleanupInactiveRooms({
        roomRepository,
        matchRepository,
        chatRepository,
        playerSessionService,
        connectionRegistry,
        taskRunner: roomTaskRunner,
        deleteRoomState: activeStateStores.deleteRoomState,
        now: Date.now(),
        ttlMs: INACTIVE_ROOM_TTL_MS
      });

      if (removedRooms.length > 0) {
        for (const removedRoom of removedRooms) {
          logger.info("realtime.room_cleaned_up", { ...removedRoom });
        }

        logger.info("realtime.inactive_room_cleanup", { removedRooms: removedRooms.length });
      }
    })().catch((error) => {
      logger.error("realtime.inactive_room_cleanup_failed", { error });
    });
  }, INACTIVE_ROOM_SWEEP_INTERVAL_MS);

  cleanupInterval.unref?.();
  const stopCleanupInterval = () => clearInterval(cleanupInterval);
  httpServer.once("close", stopCleanupInterval);
  httpServer.once("close", stopHeartbeat);

  httpServer.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => {
      activeSockets.delete(socket);
    });
  });
  httpServer.on("upgrade", (request, socket, head) => {
    const requestPath = getRequestPath(request.url);

    if (requestPath !== websocketPath) {
      rejectWebSocketUpgrade(socket, 404, "WebSocket endpoint not found.");
      return;
    }

    if (!isAllowedWebSocketOrigin(request, WEBSOCKET_ALLOWED_ORIGINS)) {
      logger.warn("realtime.upgrade_rejected", {
        remoteAddress: resolveClientAddress(request, { trustProxy: TRUST_PROXY }),
        reason: "origin_not_allowed",
        origin: request.headers.origin
      });
      rejectWebSocketUpgrade(socket, 403, "WebSocket origin is not allowed.");
      return;
    }

    if (lifecycleState === "shutting_down" || lifecycleState === "stopped") {
      rejectWebSocketUpgrade(socket, 503, "The server is shutting down.");
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  });

  const closeHttpServer = () =>
    new Promise<void>((resolve, reject) => {
      if (!httpServer.listening) {
        resolve();
        return;
      }

      httpServer.close((error) => {
        if (!error || (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
          resolve();
          return;
        }

        reject(error);
      });
      httpServer.closeIdleConnections?.();
    });

  const closeWebSocketServer = () =>
    new Promise<void>((resolve, reject) => {
      webSocketServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });

      for (const client of webSocketServer.clients) {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
          client.close(1001, "Server shutting down");
        }
      }
    });

  const destroyRemainingConnections = () => {
    for (const client of webSocketServer.clients) {
      if (client.readyState !== WebSocket.CLOSED) {
        client.terminate();
      }
    }

    for (const socket of activeSockets) {
      socket.destroy();
    }
  };

  const shutdown = async ({
    signal = "manual",
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS
  }: ShutdownOptions = {}): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    lifecycleState = "shutting_down";
    stopCleanupInterval();
    stopHeartbeat();
    logger.info("realtime.shutdown_requested", {
      signal,
      timeoutMs,
      activeWebSocketCount: webSocketServer.clients.size
    });

    shutdownPromise = (async () => {
      const forceCloseTimer = setTimeout(() => {
        logger.warn("realtime.shutdown_force_close", {
          activeWebSocketCount: webSocketServer.clients.size,
          activeSocketCount: activeSockets.size
        });
        destroyRemainingConnections();
      }, timeoutMs);

      forceCloseTimer.unref?.();

      try {
        await Promise.all([closeWebSocketServer(), closeHttpServer()]);
        if (ownsStateStores) {
          await activeStateStores.dispose();
        }
        lifecycleState = "stopped";
        logger.info("realtime.shutdown_completed");
      } catch (error) {
        lifecycleState = "stopped";
        destroyRemainingConnections();
        logger.error("realtime.shutdown_failed", { error });
        throw error;
      } finally {
        clearTimeout(forceCloseTimer);
      }
    })();

    return shutdownPromise;
  };

  webSocketServer.on("connection", (socket, request) => {
    const remoteAddress = resolveClientAddress(request, { trustProxy: TRUST_PROXY });
    const socketContext: SocketContext = {
      connectionId: createId(),
      remoteAddress,
      openedAt: Date.now()
    };
    const connectionAdmission = abusePrevention.registerConnection(remoteAddress);

    socketContexts.set(socket, socketContext);
    heartbeatMonitor.attach(socket);
    socket.on("pong", () => {
      const session = connectionRegistry.getSessionForSocket(socket);

      if (!session) {
        return;
      }

      void (async () => {
        await playerSessionService.refreshSession(session);
        await roomService.touchRoomActivity(session.roomCode);
      })().catch((error) => {
        logger.error("realtime.session_refresh_failed", {
          error,
          connectionId: socketContext.connectionId,
          remoteAddress,
          roomCode: session.roomCode,
          playerId: session.playerId
        });
      });
    });

    logger.info("realtime.connection_opened", {
      connectionId: socketContext.connectionId,
      remoteAddress,
      activeConnections: connectionAdmission.activeConnections
    });

    socket.on("error", (error) => {
      logger.warn("realtime.socket_error", {
        connectionId: socketContext.connectionId,
        remoteAddress,
        error
      });
    });

    socket.on("close", (code, reasonBuffer) => {
      abusePrevention.unregisterConnection(remoteAddress);

      const session = connectionRegistry.detachIfCurrent(socket);
      const closeReason = getCloseReason(reasonBuffer);

      logger.info("realtime.connection_closed", {
        connectionId: socketContext.connectionId,
        remoteAddress,
        roomCode: session?.roomCode,
        playerId: session?.playerId,
        closeCode: code,
        closeReason,
        connectionDurationMs: Date.now() - socketContext.openedAt,
        activeConnections: abusePrevention.getActiveConnections(remoteAddress)
      });

      if (!session) {
        return;
      }

      void handleSocketClosed(session, {
        ...matchHandlerDependencies,
        attachSessionSocket
      }).catch((error) => {
        logger.error("realtime.connection_close_failed", {
          error,
          connectionId: socketContext.connectionId,
          remoteAddress,
          roomCode: session.roomCode,
          playerId: session.playerId
        });
      });
    });

    if (!connectionAdmission.allowed) {
      logger.warn("realtime.connection_rejected", {
        connectionId: socketContext.connectionId,
        remoteAddress,
        reason: "connection_limit",
        activeConnections: connectionAdmission.activeConnections,
        limit: connectionAdmission.limit
      });
      sendServerError(socket, "Too many open connections from this IP address. Try again later.");
      socket.close(1008, "Connection limit exceeded");
      return;
    }

    socket.on("message", async (message) => {
      let eventType: string | undefined;

      try {
        if (lifecycleState !== "ready") {
          logger.warn("realtime.request_rejected", {
            connectionId: socketContext.connectionId,
            remoteAddress,
            reason: "server_not_ready"
          });
          sendServerError(socket, "The server is shutting down.");
          socket.close(1001, "Server shutting down");
          return;
        }

        const messageByteLength = getRawMessageByteLength(message);

        if (messageByteLength > MAX_WEBSOCKET_MESSAGE_BYTES) {
          logger.warn("realtime.message_rejected", {
            connectionId: socketContext.connectionId,
            remoteAddress,
            reason: "message_too_large",
            messageByteLength,
            limit: MAX_WEBSOCKET_MESSAGE_BYTES
          });
          socket.close(1009, "Message too large");
          return;
        }

        const parsedMessage = JSON.parse(rawDataToString(message)) as unknown;
        const parsedEvent = clientEventSchema.safeParse(parsedMessage);

        if (!parsedEvent.success) {
          const invalidMessageResult = abusePrevention.recordInvalidMessage(remoteAddress);

          logger.warn("realtime.invalid_client_event", {
            connectionId: socketContext.connectionId,
            remoteAddress,
            invalidMessageRemaining: invalidMessageResult.remaining,
            retryAfterMs: invalidMessageResult.retryAfterMs
          });

          sendServerError(
            socket,
            invalidMessageResult.allowed
              ? "The message format is invalid."
              : "Too many invalid messages. Reconnect and try again."
          );

          if (!invalidMessageResult.allowed) {
            socket.close(1008, "Invalid message limit exceeded");
          }
          return;
        }

        const event = parsedEvent.data;
        eventType = event.type;

        switch (event.type) {
          case CLIENT_EVENT_NAMES.roomCreate: {
            const roomCreateResult = abusePrevention.consumeRoomCreate(remoteAddress);

            if (!roomCreateResult.allowed) {
              logger.warn("realtime.room_create_rate_limited", {
                connectionId: socketContext.connectionId,
                remoteAddress,
                retryAfterMs: roomCreateResult.retryAfterMs,
                limit: roomCreateResult.limit
              });
              sendServerError(socket, "Too many room creation attempts. Try again in a moment.");
              return;
            }

            await handleRoomCreate(socket, event.payload.displayName, {
              roomService,
              matchService,
              createSession,
              attachSessionSocket,
              sendEvent,
              sendChatHistory: sendRoomChatHistory,
              broadcastToRoom
            });
            break;
          }
          case CLIENT_EVENT_NAMES.roomJoin: {
            const roomJoinResult = abusePrevention.consumeRoomJoin(remoteAddress);

            if (!roomJoinResult.allowed) {
              logger.warn("realtime.room_join_rate_limited", {
                connectionId: socketContext.connectionId,
                remoteAddress,
                retryAfterMs: roomJoinResult.retryAfterMs,
                limit: roomJoinResult.limit
              });
              sendServerError(socket, "Too many room join attempts. Try again in a moment.");
              return;
            }

            await handleRoomJoin(socket, event.payload.inviteToken, event.payload.displayName, {
              roomService,
              matchService,
              createSession,
              attachSessionSocket,
              sendEvent,
              sendChatHistory: sendRoomChatHistory,
              broadcastToRoom
            });
            break;
          }
          case CLIENT_EVENT_NAMES.chatSend: {
            const session = await requireAttachedSession(
              {
                connectionRegistry,
                playerSessionService
              },
              event.payload.roomCode,
              event.payload.sessionToken,
              socket
            );
            const chatRateLimitResult = abusePrevention.consumeChatMessage(session.playerId);

            if (!chatRateLimitResult.allowed) {
              logger.warn("realtime.chat_message_rate_limited", {
                connectionId: socketContext.connectionId,
                remoteAddress,
                roomCode: session.roomCode,
                playerId: session.playerId,
                retryAfterMs: chatRateLimitResult.retryAfterMs,
                limit: chatRateLimitResult.limit
              });
              sendChatRejected(
                socket,
                session.roomCode,
                "You're sending messages too quickly. Try again in a moment.",
                { sendEvent }
              );
              return;
            }

            await handleChatSend(socket, session, event.payload.text, {
              chatService,
              roomService,
              sendEvent,
              broadcastToRoom
            });
            break;
          }
          case CLIENT_EVENT_NAMES.matchAction: {
            const session = await requireAttachedSession(
              {
                connectionRegistry,
                playerSessionService
              },
              event.payload.roomCode,
              event.payload.sessionToken,
              socket
            );
            await handleMatchAction(socket, session, event.payload.action, {
              ...matchHandlerDependencies,
              attachSessionSocket
            });
            break;
          }
          case CLIENT_EVENT_NAMES.matchResign: {
            const session = await requireAttachedSession(
              {
                connectionRegistry,
                playerSessionService
              },
              event.payload.roomCode,
              event.payload.sessionToken,
              socket
            );
            await handleMatchResign(socket, session, {
              ...matchHandlerDependencies,
              attachSessionSocket
            });
            break;
          }
          case CLIENT_EVENT_NAMES.playerReconnect: {
            const session = await playerSessionService.requireSession(
              event.payload.roomCode,
              event.payload.sessionToken
            );
            await handleReconnect(socket, session, {
              ...matchHandlerDependencies,
              attachSessionSocket
            });
            break;
          }
          case CLIENT_EVENT_NAMES.matchRematchRequest: {
            const session = await requireAttachedSession(
              {
                connectionRegistry,
                playerSessionService
              },
              event.payload.roomCode,
              event.payload.sessionToken,
              socket
            );
            await handleRematchRequest(socket, session, {
              rematchService,
              roomService,
              sendEvent,
              broadcastToRoom
            });
            break;
          }
          case CLIENT_EVENT_NAMES.matchRematchCancel: {
            const session = await requireAttachedSession(
              {
                connectionRegistry,
                playerSessionService
              },
              event.payload.roomCode,
              event.payload.sessionToken,
              socket
            );
            await handleRematchCancel(socket, session, {
              rematchService,
              roomService,
              sendEvent,
              broadcastToRoom
            });
            break;
          }
        }
      } catch (error) {
        logger.error("realtime.message_failed", {
          error,
          connectionId: socketContext.connectionId,
          remoteAddress,
          eventType
        });

        sendServerError(socket, error instanceof Error ? error.message : "Unexpected server error.");
      }
    });
  });

  return {
    httpServer,
    webSocketServer,
    markReady: () => {
      if (lifecycleState === "starting") {
        lifecycleState = "ready";
      }
    },
    shutdown
  } satisfies RealtimeServerController;
};

export const startRealtimeServer = ({
  host,
  port,
  websocketPath,
  stateStores
}: StartRealtimeServerOptions): Promise<StartedRealtimeServer> =>
  (async () => {
    const realtimeServer = await createRealtimeServer({
      websocketPath,
      ...(stateStores ? { stateStores } : {})
    });

    return await new Promise<StartedRealtimeServer>((resolve, reject) => {
      const onError = (error: Error) => {
        realtimeServer.httpServer.off("listening", onListening);
        logger.error("realtime.server_start_failed", { error, host, port, websocketPath });
        void realtimeServer.shutdown({ signal: "startup_failure", timeoutMs: 1_000 });
        reject(error);
      };

      const onListening = () => {
        realtimeServer.httpServer.off("error", onError);
        realtimeServer.markReady();
        logger.info("realtime.server_listening", { host, port, websocketPath });
        resolve(realtimeServer);
      };

      realtimeServer.httpServer.once("error", onError);
      realtimeServer.httpServer.once("listening", onListening);
      realtimeServer.httpServer.listen(port, host);
    });
  })();
