import type { Server } from "node:http";
import type { Socket as NetSocket } from "node:net";
import { WebSocket, type WebSocketServer } from "ws";
import { logger } from "../../lib/logging/logger.js";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export type RealtimeServerLifecycleState = "starting" | "ready" | "shutting_down" | "stopped";

/** Shared, mutable lifecycle state. Only markReady and shutdown change it. */
export interface RealtimeLifecycle {
  state: RealtimeServerLifecycleState;
}

type ShutdownTrigger = NodeJS.Signals | "manual" | "startup_failure";

export interface ShutdownOptions {
  signal?: ShutdownTrigger;
  timeoutMs?: number;
}

interface ShutdownDependencies {
  lifecycle: RealtimeLifecycle;
  httpServer: Server;
  webSocketServer: WebSocketServer;
  /** Raw TCP sockets still open on the HTTP server; destroyed if shutdown stalls. */
  activeSockets: ReadonlySet<NetSocket>;
  stopBackgroundTasks: () => void;
  releaseStateStores: () => Promise<void>;
}

/**
 * Builds an idempotent graceful shutdown: close every WebSocket and the HTTP
 * server, then force-close whatever remains after the timeout.
 */
export const createShutdown = ({
  lifecycle,
  httpServer,
  webSocketServer,
  activeSockets,
  stopBackgroundTasks,
  releaseStateStores
}: ShutdownDependencies): ((options?: ShutdownOptions) => Promise<void>) => {
  let shutdownPromise: Promise<void> | undefined;

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

  const closeAll = async (timeoutMs: number): Promise<void> => {
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
      await releaseStateStores();
      lifecycle.state = "stopped";
      logger.info("realtime.shutdown_completed");
    } catch (error) {
      lifecycle.state = "stopped";
      destroyRemainingConnections();
      logger.error("realtime.shutdown_failed", { error });
      throw error;
    } finally {
      clearTimeout(forceCloseTimer);
    }
  };

  return async ({ signal = "manual", timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS } = {}) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    lifecycle.state = "shutting_down";
    stopBackgroundTasks();
    logger.info("realtime.shutdown_requested", {
      signal,
      timeoutMs,
      activeWebSocketCount: webSocketServer.clients.size
    });

    shutdownPromise = closeAll(timeoutMs);

    return shutdownPromise;
  };
};
