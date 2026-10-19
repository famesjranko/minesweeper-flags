import { createServer } from "node:http";
import type { Socket as NetSocket } from "node:net";
import { type WebSocket, WebSocketServer } from "ws";
import { logger } from "../../lib/logging/logger.js";
import {
  MAX_WEBSOCKET_MESSAGE_BYTES,
  SOCKET_HEARTBEAT_INTERVAL_MS,
  STATE_BACKEND
} from "../config/env.js";
import { createStateStores, type StateStores } from "../state/state-store.js";
import { createExecutionDispatcher } from "./execution-dispatcher.js";
import { startInactiveRoomSweep } from "./inactive-room-cleanup.js";
import { RealtimeConnectionHandler } from "./realtime-connection.js";
import { createHttpRequestHandler, createUpgradeHandler } from "./realtime-http.js";
import {
  createShutdown,
  type RealtimeLifecycle,
  type ShutdownOptions
} from "./realtime-lifecycle.js";
import { RealtimeMessageRouter, type SocketContext } from "./realtime-message-router.js";
import { createRealtimeServices } from "./realtime-services.js";
import { SocketHeartbeatMonitor } from "./socket-heartbeat.js";

const INACTIVE_ROOM_TTL_MS = 30 * 60 * 1000;
const INACTIVE_ROOM_SWEEP_INTERVAL_MS = 60 * 1000;

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

export const createRealtimeServer = async ({
  websocketPath,
  stateStores
}: RealtimeServerOptions): Promise<RealtimeServerController> => {
  const ownsStateStores = !stateStores;
  const activeStateStores = stateStores ?? (await createStateStores(STATE_BACKEND));
  const services = createRealtimeServices(activeStateStores);
  const lifecycle: RealtimeLifecycle = { state: "starting" };
  const activeSockets = new Set<NetSocket>();
  const socketContexts = new WeakMap<WebSocket, SocketContext>();
  const heartbeatMonitor = new SocketHeartbeatMonitor({
    intervalMs: SOCKET_HEARTBEAT_INTERVAL_MS,
    onStaleSocket: (socket) => {
      const socketContext = socketContexts.get(socket);

      logger.warn("realtime.connection_stale", {
        connectionId: socketContext?.connectionId ?? "unknown",
        remoteAddress: socketContext?.remoteAddress ?? "unknown"
      });
    }
  });
  const dispatchExecution = createExecutionDispatcher(services);
  const httpServer = createServer(
    createHttpRequestHandler({ roomRepository: activeStateStores.roomRepository, lifecycle })
  );
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES
  });
  const stopHeartbeat = heartbeatMonitor.start(webSocketServer);
  const stopCleanupInterval = startInactiveRoomSweep({
    roomRepository: activeStateStores.roomRepository,
    matchRepository: activeStateStores.matchRepository,
    chatRepository: activeStateStores.chatRepository,
    playerSessionService: services.playerSessionService,
    connectionRegistry: services.connectionRegistry,
    taskRunner: services.roomTaskRunner,
    deleteRoomState: activeStateStores.deleteRoomState,
    ttlMs: INACTIVE_ROOM_TTL_MS,
    intervalMs: INACTIVE_ROOM_SWEEP_INTERVAL_MS
  });

  httpServer.once("close", stopCleanupInterval);
  httpServer.once("close", stopHeartbeat);
  httpServer.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.on("close", () => {
      activeSockets.delete(socket);
    });
  });
  httpServer.on("upgrade", createUpgradeHandler({ websocketPath, webSocketServer, lifecycle }));

  const shutdown = createShutdown({
    lifecycle,
    httpServer,
    webSocketServer,
    activeSockets,
    stopBackgroundTasks: () => {
      stopCleanupInterval();
      stopHeartbeat();
    },
    releaseStateStores: async () => {
      if (ownsStateStores) {
        await activeStateStores.dispose();
      }
    }
  });

  const connectionHandler = new RealtimeConnectionHandler({
    services,
    stateStores: activeStateStores,
    socketContexts,
    heartbeatMonitor,
    dispatchExecution,
    messageRouter: new RealtimeMessageRouter({ ...services, lifecycle, dispatchExecution })
  });

  webSocketServer.on("connection", (socket, request) => {
    connectionHandler.accept(socket, request);
  });

  return {
    httpServer,
    webSocketServer,
    markReady: () => {
      if (lifecycle.state === "starting") {
        lifecycle.state = "ready";
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
