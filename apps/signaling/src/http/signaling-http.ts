import type { IncomingMessage, ServerResponse } from "node:http";
import {
  claimReconnectRoleRequestSchema,
  claimReconnectRoleResponseSchema,
  createSignalingSessionRequestSchema,
  createSignalingSessionResponseSchema,
  finalizeReconnectAttemptRequestSchema,
  finalizeReconnectAttemptResponseSchema,
  finalizeSignalingSessionRequestSchema,
  finalizeSignalingSessionResponseSchema,
  getReconnectControlSessionResponseSchema,
  getReconnectFinalizationResponseSchema,
  getSignalingAnswerRequestSchema,
  getSignalingAnswerResponseSchema,
  getSignalingFinalizationResponseSchema,
  getSignalingSessionResponseSchema,
  heartbeatReconnectRoleRequestSchema,
  heartbeatReconnectRoleResponseSchema,
  readReconnectAnswerRequestSchema,
  readReconnectAnswerResponseSchema,
  readReconnectControlSessionRequestSchema,
  readReconnectFinalizationRequestSchema,
  readReconnectOfferRequestSchema,
  readReconnectOfferResponseSchema,
  registerReconnectControlSessionRequestSchema,
  registerReconnectControlSessionResponseSchema,
  submitSignalingAnswerRequestSchema,
  submitSignalingAnswerResponseSchema,
  writeReconnectAnswerRequestSchema,
  writeReconnectAnswerResponseSchema,
  writeReconnectOfferRequestSchema,
  writeReconnectOfferResponseSchema
} from "@minesweeper-flags/shared";
import { resolveClientAddress } from "../lib/http/client-address.js";
import {
  SignalingSessionConflictError,
  SignalingSessionExpiredError,
  SignalingSessionForbiddenError,
  SignalingSessionNotFoundError
} from "../modules/signaling/signaling.types.js";
import type { SignalingService } from "../modules/signaling/signaling.service.js";

interface FixedWindowLimit {
  maxEvents: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  retryAfterMs: number;
}

interface RateLimitBucket {
  timestamps: number[];
  windowMs: number;
}

class SignalingHttpAbusePrevention {
  private readonly bucketsByKey = new Map<string, RateLimitBucket>();
  private readonly bucketCleanupIntervalMs: number;
  private nextBucketCleanupAt = 0;

  constructor(
    private readonly createLimit: FixedWindowLimit,
    private readonly answerLimit: FixedWindowLimit,
    private readonly reconnectLimit: FixedWindowLimit
  ) {
    this.bucketCleanupIntervalMs = Math.max(
      createLimit.windowMs,
      answerLimit.windowMs,
      reconnectLimit.windowMs
    );
  }

  consumeCreate(ipAddress: string, now = Date.now()): RateLimitResult {
    return this.consume(`create:${ipAddress.trim() || "unknown"}`, this.createLimit, now);
  }

  consumeAnswer(ipAddress: string, now = Date.now()): RateLimitResult {
    return this.consume(`answer:${ipAddress.trim() || "unknown"}`, this.answerLimit, now);
  }

  consumeReconnect(ipAddress: string, now = Date.now()): RateLimitResult {
    return this.consume(`reconnect:${ipAddress.trim() || "unknown"}`, this.reconnectLimit, now);
  }

  private consume(bucketKey: string, limit: FixedWindowLimit, now: number): RateLimitResult {
    this.pruneExpiredBuckets(now);

    const cutoff = now - limit.windowMs;
    const bucket = this.bucketsByKey.get(bucketKey);
    const activeTimestamps = (bucket?.timestamps ?? []).filter((timestamp) => timestamp > cutoff);

    if (activeTimestamps.length >= limit.maxEvents) {
      const oldestTimestamp = activeTimestamps[0] ?? now;

      this.bucketsByKey.set(bucketKey, {
        timestamps: activeTimestamps,
        windowMs: limit.windowMs
      });

      return {
        allowed: false,
        limit: limit.maxEvents,
        retryAfterMs: Math.max(0, oldestTimestamp + limit.windowMs - now)
      };
    }

    activeTimestamps.push(now);
    this.bucketsByKey.set(bucketKey, {
      timestamps: activeTimestamps,
      windowMs: limit.windowMs
    });

    return {
      allowed: true,
      limit: limit.maxEvents,
      retryAfterMs: 0
    };
  }

  private pruneExpiredBuckets(now: number): void {
    if (now < this.nextBucketCleanupAt) {
      return;
    }

    this.nextBucketCleanupAt = now + this.bucketCleanupIntervalMs;

    for (const [bucketKey, bucket] of this.bucketsByKey) {
      const activeTimestamps = bucket.timestamps.filter(
        (timestamp) => timestamp > now - bucket.windowMs
      );

      if (activeTimestamps.length === 0) {
        this.bucketsByKey.delete(bucketKey);
        continue;
      }

      this.bucketsByKey.set(bucketKey, {
        ...bucket,
        timestamps: activeTimestamps
      });
    }
  }
}

const normalizeOrigin = (value: string): string | null => {
  if (value === "*") {
    return value;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const getRequestOrigin = (request: IncomingMessage): string | undefined => {
  const originHeader = request.headers.origin;
  return Array.isArray(originHeader) ? originHeader[0] : originHeader;
};

const isAllowedHttpOrigin = (request: IncomingMessage, allowedOrigins: readonly string[]): boolean => {
  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    return true;
  }

  const originValue = getRequestOrigin(request);

  if (!originValue) {
    return false;
  }

  const normalizedOrigin = normalizeOrigin(originValue);

  return Boolean(normalizedOrigin && allowedOrigins.includes(normalizedOrigin));
};

const getCorsHeaders = (
  request: IncomingMessage,
  allowedOrigins: readonly string[]
): Record<string, string> => {
  // Empty `allowedOrigins` is the dev/test fallback (e.g. local mode where no
  // SIGNALING_ALLOWED_ORIGINS is set). Public deploys are protected one layer up:
  // env.ts requires an explicit allowlist when DEPLOYMENT_MODE=public, so this
  // wildcard branch is unreachable in production.
  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    return {
      "access-control-allow-origin": "*"
    };
  }

  const originValue = getRequestOrigin(request);
  const normalizedOrigin = originValue ? normalizeOrigin(originValue) : null;

  if (!normalizedOrigin || !allowedOrigins.includes(normalizedOrigin)) {
    return {};
  }

  return {
    "access-control-allow-origin": normalizedOrigin,
    vary: "Origin"
  };
};

const respondWithJson = (
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
  allowedOrigins: readonly string[]
): void => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...getCorsHeaders(request, allowedOrigins)
  });
  response.end(JSON.stringify(payload));
};

const respondWithEmpty = (
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  allowedOrigins: readonly string[]
): void => {
  response.writeHead(statusCode, {
    ...getCorsHeaders(request, allowedOrigins),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store"
  });
  response.end();
};

const getRequestPath = (requestUrl?: string): string =>
  new URL(requestUrl ?? "/", "http://127.0.0.1").pathname;

const parseRequestUrl = (requestUrl?: string): URL => new URL(requestUrl ?? "/", "http://127.0.0.1");

const readJsonBody = async (
  request: IncomingMessage,
  maxPayloadBytes: number
): Promise<unknown> => {
  const contentLengthHeader = request.headers["content-length"];
  const contentLengthValue = Array.isArray(contentLengthHeader)
    ? contentLengthHeader[0]
    : contentLengthHeader;

  if (contentLengthValue) {
    const contentLength = Number(contentLengthValue);

    if (Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
      throw new Error("payload-too-large");
    }
  }

  let bodyBytes = 0;
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bodyBytes += chunkBuffer.byteLength;

    if (bodyBytes > maxPayloadBytes) {
      throw new Error("payload-too-large");
    }

    chunks.push(chunkBuffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("invalid-json");
  }
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
  const abusePrevention = new SignalingHttpAbusePrevention(
    createRateLimit,
    answerRateLimit,
    reconnectRateLimit
  );

  const enforceReconnectRateLimit = (
    request: IncomingMessage,
    response: ServerResponse,
    ipAddress: string
  ): boolean => {
    const rateLimitResult = abusePrevention.consumeReconnect(ipAddress);

    if (!rateLimitResult.allowed) {
      response.setHeader("retry-after", Math.ceil(rateLimitResult.retryAfterMs / 1000));
      respondWithJson(
        request,
        response,
        429,
        {
          error: "Too many reconnect requests.",
          retryAfterMs: rateLimitResult.retryAfterMs,
          limit: rateLimitResult.limit
        },
        allowedOrigins
      );
      return false;
    }

    return true;
  };

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = getRequestPath(request.url);

    if (request.method === "OPTIONS" && path.startsWith("/signaling/")) {
      if (!isAllowedHttpOrigin(request, allowedOrigins)) {
        respondWithJson(request, response, 403, { error: "Origin not allowed." }, allowedOrigins);
        return;
      }

      respondWithEmpty(request, response, 204, allowedOrigins);
      return;
    }

    if (!path.startsWith("/signaling/")) {
      respondWithJson(request, response, 404, { error: "Not found." }, allowedOrigins);
      return;
    }

    if (!isAllowedHttpOrigin(request, allowedOrigins)) {
      respondWithJson(request, response, 403, { error: "Origin not allowed." }, allowedOrigins);
      return;
    }

    const url = parseRequestUrl(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const sessionId = segments[2];
    const ipAddress = resolveClientAddress(request, { trustProxy });

    try {
      if (
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "register" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = registerReconnectControlSessionRequestSchema.parse(
          await readJsonBody(request, maxPayloadBytes)
        );
        const createdSession = registerReconnectControlSessionResponseSchema.parse(
          await service.registerReconnectControlSession({
            ...body,
            sessionId
          })
        );

        respondWithJson(request, response, 201, createdSession, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "read" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = readReconnectControlSessionRequestSchema.parse(
          await readJsonBody(request, maxPayloadBytes)
        );
        const reconnectSession = getReconnectControlSessionResponseSchema.parse(
          await service.readReconnectControlSession(sessionId, body.secret, body.instanceId)
        );

        respondWithJson(request, response, 200, reconnectSession, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "claim" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = claimReconnectRoleRequestSchema.parse(await readJsonBody(request, maxPayloadBytes));
        const reconnectSession = claimReconnectRoleResponseSchema.parse(
          await service.claimReconnectRole(sessionId, body)
        );

        respondWithJson(request, response, 200, reconnectSession, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "heartbeat" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = heartbeatReconnectRoleRequestSchema.parse(
          await readJsonBody(request, maxPayloadBytes)
        );
        const reconnectSession = heartbeatReconnectRoleResponseSchema.parse(
          await service.heartbeatReconnectRole(sessionId, body)
        );

        respondWithJson(request, response, 200, reconnectSession, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "offer" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = writeReconnectOfferRequestSchema.parse(await readJsonBody(request, maxPayloadBytes));
        const reconnectSession = writeReconnectOfferResponseSchema.parse(
          await service.writeReconnectOffer(sessionId, body)
        );

        respondWithJson(request, response, 200, reconnectSession, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 5 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "offer" &&
        segments[4] === "read" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = readReconnectOfferRequestSchema.parse(await readJsonBody(request, maxPayloadBytes));
        const reconnectOffer = readReconnectOfferResponseSchema.parse(
          await service.readReconnectOffer(sessionId, body.secret, body.instanceId)
        );

        respondWithJson(request, response, 200, reconnectOffer, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "answer" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = writeReconnectAnswerRequestSchema.parse(await readJsonBody(request, maxPayloadBytes));
        const reconnectSession = writeReconnectAnswerResponseSchema.parse(
          await service.writeReconnectAnswer(sessionId, body)
        );

        respondWithJson(request, response, 200, reconnectSession, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 5 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "answer" &&
        segments[4] === "read" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = readReconnectAnswerRequestSchema.parse(await readJsonBody(request, maxPayloadBytes));
        const reconnectAnswer = readReconnectAnswerResponseSchema.parse(
          await service.readReconnectAnswer(sessionId, body.secret, body.instanceId)
        );

        respondWithJson(request, response, 200, reconnectAnswer, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "finalize" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = finalizeReconnectAttemptRequestSchema.parse(
          await readJsonBody(request, maxPayloadBytes)
        );
        const reconnectSession = finalizeReconnectAttemptResponseSchema.parse(
          await service.finalizeReconnectAttempt(sessionId, body)
        );

        respondWithJson(request, response, 200, reconnectSession, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 5 &&
        segments[0] === "signaling" &&
        segments[1] === "reconnect" &&
        segments[3] === "finalization" &&
        segments[4] === "read" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = readReconnectFinalizationRequestSchema.parse(
          await readJsonBody(request, maxPayloadBytes)
        );
        const reconnectFinalization = getReconnectFinalizationResponseSchema.parse(
          await service.readReconnectFinalization(sessionId, body.secret, body.instanceId)
        );

        respondWithJson(request, response, 200, reconnectFinalization, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 2 &&
        segments[0] === "signaling" &&
        segments[1] === "sessions"
      ) {
        const rateLimitResult = abusePrevention.consumeCreate(ipAddress);

        if (!rateLimitResult.allowed) {
          response.setHeader("retry-after", Math.ceil(rateLimitResult.retryAfterMs / 1000));
          respondWithJson(
            request,
            response,
            429,
            {
              error: "Too many session creation requests.",
              retryAfterMs: rateLimitResult.retryAfterMs,
              limit: rateLimitResult.limit
            },
            allowedOrigins
          );
          return;
        }

        const body = createSignalingSessionRequestSchema.parse(
          await readJsonBody(request, maxPayloadBytes)
        );
        const createdSession = createSignalingSessionResponseSchema.parse(
          await service.createSession(body)
        );

        respondWithJson(request, response, 201, createdSession, allowedOrigins);
        return;
      }

      if (
        request.method === "GET" &&
        segments.length === 3 &&
        segments[0] === "signaling" &&
        segments[1] === "sessions" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const session = getSignalingSessionResponseSchema.parse(await service.getSession(sessionId));
        respondWithJson(request, response, 200, session, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "sessions" &&
        segments[3] === "answer" &&
        sessionId
      ) {
        const rateLimitResult = abusePrevention.consumeAnswer(ipAddress);

        if (!rateLimitResult.allowed) {
          response.setHeader("retry-after", Math.ceil(rateLimitResult.retryAfterMs / 1000));
          respondWithJson(
            request,
            response,
            429,
            {
              error: "Too many signaling answer requests.",
              retryAfterMs: rateLimitResult.retryAfterMs,
              limit: rateLimitResult.limit
            },
            allowedOrigins
          );
          return;
        }

        const body = submitSignalingAnswerRequestSchema.parse(
          await readJsonBody(request, maxPayloadBytes)
        );
        const answerResponse = submitSignalingAnswerResponseSchema.parse(
          await service.submitAnswer(sessionId, body)
        );

        respondWithJson(request, response, 200, answerResponse, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 5 &&
        segments[0] === "signaling" &&
        segments[1] === "sessions" &&
        segments[3] === "answer" &&
        segments[4] === "read" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = getSignalingAnswerRequestSchema.parse(await readJsonBody(request, maxPayloadBytes));
        const answerResponse = getSignalingAnswerResponseSchema.parse(
          await service.getAnswer(sessionId, body.hostSecret)
        );

        respondWithJson(request, response, 200, answerResponse, allowedOrigins);
        return;
      }

      if (
        request.method === "POST" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "sessions" &&
        segments[3] === "finalize" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const body = finalizeSignalingSessionRequestSchema.parse(
          await readJsonBody(request, maxPayloadBytes)
        );
        const finalizeResponse = finalizeSignalingSessionResponseSchema.parse(
          await service.finalizeSession(sessionId, body.hostSecret)
        );

        respondWithJson(request, response, 200, finalizeResponse, allowedOrigins);
        return;
      }

      if (
        request.method === "GET" &&
        segments.length === 4 &&
        segments[0] === "signaling" &&
        segments[1] === "sessions" &&
        segments[3] === "finalization" &&
        sessionId
      ) {
        if (!enforceReconnectRateLimit(request, response, ipAddress)) {
          return;
        }

        const finalizationResponse = getSignalingFinalizationResponseSchema.parse(
          await service.getFinalization(sessionId)
        );

        respondWithJson(request, response, 200, finalizationResponse, allowedOrigins);
        return;
      }

      respondWithJson(request, response, 404, { error: "Not found." }, allowedOrigins);
    } catch (error) {
      if (error instanceof SignalingSessionNotFoundError) {
        respondWithJson(request, response, 404, { error: error.message }, allowedOrigins);
        return;
      }

      if (error instanceof SignalingSessionForbiddenError) {
        respondWithJson(request, response, 403, { error: error.message }, allowedOrigins);
        return;
      }

      if (error instanceof SignalingSessionExpiredError) {
        respondWithJson(request, response, 410, { error: error.message }, allowedOrigins);
        return;
      }

      if (error instanceof SignalingSessionConflictError) {
        respondWithJson(request, response, 409, { error: error.message }, allowedOrigins);
        return;
      }

      if (error instanceof Error && error.message === "payload-too-large") {
        respondWithJson(
          request,
          response,
          413,
          { error: "Request payload is too large." },
          allowedOrigins
        );
        return;
      }

      if (error instanceof Error && error.message === "invalid-json") {
        respondWithJson(request, response, 400, { error: "Request body must be valid JSON." }, allowedOrigins);
        return;
      }

      if (error instanceof Error && error.name === "ZodError") {
        respondWithJson(request, response, 400, { error: "Request payload is invalid." }, allowedOrigins);
        return;
      }

      respondWithJson(
        request,
        response,
        500,
        { error: "Unexpected signaling server error." },
        allowedOrigins
      );
    }
  };
};
