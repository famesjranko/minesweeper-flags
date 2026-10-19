import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveClientAddress } from "../lib/http/client-address.js";
import type { SignalingService } from "../modules/signaling/signaling.service.js";
import {
  SignalingSessionConflictError,
  SignalingSessionExpiredError,
  SignalingSessionForbiddenError,
  SignalingSessionNotFoundError
} from "../modules/signaling/signaling.types.js";
import { createHttpResponder, type HttpResponder, isAllowedHttpOrigin } from "./http-responder.js";
import { readJsonBody } from "./read-json-body.js";
import {
  type FixedWindowLimit,
  SignalingHttpAbusePrevention,
  type SignalingRateLimitBucket
} from "./signaling-rate-limit.js";
import { matchSignalingRoute } from "./signaling-routes.js";

const RATE_LIMIT_ERRORS: Record<SignalingRateLimitBucket, string> = {
  create: "Too many session creation requests.",
  answer: "Too many signaling answer requests.",
  reconnect: "Too many reconnect requests."
};

interface ErrorResponse {
  statusCode: number;
  message: string;
}

const toErrorResponse = (error: unknown): ErrorResponse => {
  if (error instanceof SignalingSessionNotFoundError) {
    return { statusCode: 404, message: error.message };
  }

  if (error instanceof SignalingSessionForbiddenError) {
    return { statusCode: 403, message: error.message };
  }

  if (error instanceof SignalingSessionExpiredError) {
    return { statusCode: 410, message: error.message };
  }

  if (error instanceof SignalingSessionConflictError) {
    return { statusCode: 409, message: error.message };
  }

  if (error instanceof Error && error.message === "payload-too-large") {
    return { statusCode: 413, message: "Request payload is too large." };
  }

  if (error instanceof Error && error.message === "invalid-json") {
    return { statusCode: 400, message: "Request body must be valid JSON." };
  }

  if (error instanceof Error && error.name === "ZodError") {
    return { statusCode: 400, message: "Request payload is invalid." };
  }

  return { statusCode: 500, message: "Unexpected signaling server error." };
};

const getRequestPath = (requestUrl?: string): string =>
  new URL(requestUrl ?? "/", "http://127.0.0.1").pathname;

const respondToPreflight = (
  request: IncomingMessage,
  respond: HttpResponder,
  allowedOrigins: readonly string[]
): void => {
  if (!isAllowedHttpOrigin(request, allowedOrigins)) {
    respond.json(403, { error: "Origin not allowed." });
    return;
  }

  respond.empty(204);
};

export interface CreateSignalingHttpHandlerOptions {
  service: SignalingService;
  maxPayloadBytes: number;
  trustProxy: boolean;
  allowedOrigins: string[];
  createRateLimit: FixedWindowLimit;
  answerRateLimit: FixedWindowLimit;
  reconnectRateLimit: FixedWindowLimit;
}

export const createSignalingHttpHandler = ({
  service,
  maxPayloadBytes,
  trustProxy,
  allowedOrigins,
  createRateLimit,
  answerRateLimit,
  reconnectRateLimit
}: CreateSignalingHttpHandlerOptions) => {
  const abusePrevention = new SignalingHttpAbusePrevention({
    create: createRateLimit,
    answer: answerRateLimit,
    reconnect: reconnectRateLimit
  });

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const respond = createHttpResponder(request, response, allowedOrigins);
    const path = getRequestPath(request.url);

    if (request.method === "OPTIONS" && path.startsWith("/signaling/")) {
      respondToPreflight(request, respond, allowedOrigins);
      return;
    }

    if (!path.startsWith("/signaling/")) {
      respond.json(404, { error: "Not found." });
      return;
    }

    if (!isAllowedHttpOrigin(request, allowedOrigins)) {
      respond.json(403, { error: "Origin not allowed." });
      return;
    }

    const segments = path.split("/").filter(Boolean);
    const ipAddress = resolveClientAddress(request, { trustProxy });

    try {
      const match = matchSignalingRoute(request.method, segments);

      if (!match) {
        respond.json(404, { error: "Not found." });
        return;
      }

      const rateLimitResult = abusePrevention.consume(match.route.rateLimit, ipAddress);

      if (!rateLimitResult.allowed) {
        response.setHeader("retry-after", Math.ceil(rateLimitResult.retryAfterMs / 1000));
        respond.json(429, {
          error: RATE_LIMIT_ERRORS[match.route.rateLimit],
          retryAfterMs: rateLimitResult.retryAfterMs,
          limit: rateLimitResult.limit
        });
        return;
      }

      const payload = await match.route.handle(service, {
        sessionId: match.sessionId,
        readBody: () => readJsonBody(request, maxPayloadBytes)
      });

      respond.json(match.route.successStatus, payload);
    } catch (error) {
      const { statusCode, message } = toErrorResponse(error);
      respond.json(statusCode, { error: message });
    }
  };
};
