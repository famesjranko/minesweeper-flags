import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import { logger } from "../../lib/logging/logger.js";
import type { RoomRepository } from "../../modules/rooms/room.repository.js";
import { MAX_CONCURRENT_ROOMS, TRUST_PROXY, WEBSOCKET_ALLOWED_ORIGINS } from "../config/env.js";
import { resolveClientAddress } from "./client-address.js";
import type { RealtimeLifecycle } from "./realtime-lifecycle.js";
import { isAllowedWebSocketOrigin } from "./websocket-admission.js";

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

interface HttpRequestHandlerDependencies {
  roomRepository: RoomRepository;
  lifecycle: Readonly<RealtimeLifecycle>;
}

/** Serves the health and readiness probes; every other plain HTTP path is 404. */
export const createHttpRequestHandler =
  ({ roomRepository, lifecycle }: HttpRequestHandlerDependencies) =>
  (request: IncomingMessage, response: ServerResponse): void => {
    const path = getRequestPath(request.url);

    if (path === "/" || path === "/health") {
      roomRepository
        .listAll()
        .then((rooms) => {
          respondWithJson(response, 200, {
            status: "ok",
            activeRooms: rooms.length,
            maxRooms: MAX_CONCURRENT_ROOMS
          });
        })
        .catch((error) => {
          logger.error("realtime.health_check_failed", { error });
          respondWithJson(response, 200, { status: "ok" });
        });
      return;
    }

    if (path === "/ready") {
      respondWithJson(response, lifecycle.state === "ready" ? 200 : 503, {
        status: lifecycle.state === "ready" ? "ready" : lifecycle.state
      });
      return;
    }

    respondWithJson(response, 404, { status: "not_found" });
  };

interface UpgradeHandlerDependencies {
  websocketPath: string;
  webSocketServer: WebSocketServer;
  lifecycle: Readonly<RealtimeLifecycle>;
}

/** Admits a WebSocket upgrade only on the configured path, from an allowed origin, while running. */
export const createUpgradeHandler =
  ({ websocketPath, webSocketServer, lifecycle }: UpgradeHandlerDependencies) =>
  (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
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

    if (lifecycle.state === "shutting_down" || lifecycle.state === "stopped") {
      rejectWebSocketUpgrade(socket, 503, "The server is shutting down.");
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  };
