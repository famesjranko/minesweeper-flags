import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createSignalingHttpHandler, type CreateSignalingHttpHandlerOptions } from "./signaling-http.js";

type LifecycleState = "starting" | "ready" | "shutting_down" | "stopped";

export interface SignalingServerController {
  httpServer: ReturnType<typeof createServer>;
  markReady: () => void;
  shutdown: () => Promise<void>;
}

const respondWithJson = (
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>
): void => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
};

export const createSignalingServer = (
  options: CreateSignalingHttpHandlerOptions
): SignalingServerController => {
  const handler = createSignalingHttpHandler(options);
  let lifecycleState: LifecycleState = "starting";
  let shutdownPromise: Promise<void> | undefined;

  const routeRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method === "GET" && request.url === "/health") {
      respondWithJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method === "GET" && request.url === "/ready") {
      if (lifecycleState === "ready") {
        respondWithJson(response, 200, { status: "ready" });
        return;
      }

      respondWithJson(response, 503, { status: lifecycleState });
      return;
    }

    await handler(request, response);
  };

  const httpServer = createServer((request, response) => {
    void routeRequest(request, response);
  });

  return {
    httpServer,
    markReady: () => {
      lifecycleState = "ready";
    },
    shutdown: async () => {
      if (shutdownPromise) {
        await shutdownPromise;
        return;
      }

      lifecycleState = "shutting_down";
      shutdownPromise = new Promise((resolve, reject) => {
        if (!httpServer.listening) {
          lifecycleState = "stopped";
          resolve();
          return;
        }

        httpServer.close((error) => {
          lifecycleState = "stopped";

          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      await shutdownPromise;
    }
  };
};
