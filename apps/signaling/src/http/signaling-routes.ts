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
import type { SignalingService } from "../modules/signaling/signaling.service.js";
import type { SignalingRateLimitBucket } from "./signaling-rate-limit.js";

const SESSION_ID_SEGMENT = ":sessionId";

export interface SignalingRouteRequest {
  /** The `:sessionId` path segment; empty for routes without one. */
  sessionId: string;
  readBody: () => Promise<unknown>;
}

interface SignalingRoute {
  method: "GET" | "POST";
  path: readonly string[];
  rateLimit: SignalingRateLimitBucket;
  successStatus: 200 | 201;
  handle: (
    service: SignalingService,
    request: SignalingRouteRequest
  ) => Promise<Record<string, unknown>>;
}

const route = (
  method: SignalingRoute["method"],
  path: string,
  options: Omit<SignalingRoute, "method" | "path">
): SignalingRoute => ({
  method,
  path: path.split("/").filter(Boolean),
  ...options
});

// Reconnect control sessions: short-lived rendezvous between an existing host and guest.
const reconnectRoutes: readonly SignalingRoute[] = [
  route("POST", "/signaling/reconnect/:sessionId/register", {
    rateLimit: "reconnect",
    successStatus: 201,
    handle: async (service, { sessionId, readBody }) => {
      const body = registerReconnectControlSessionRequestSchema.parse(await readBody());
      return registerReconnectControlSessionResponseSchema.parse(
        await service.registerReconnectControlSession({ ...body, sessionId })
      );
    }
  }),
  route("POST", "/signaling/reconnect/:sessionId/read", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = readReconnectControlSessionRequestSchema.parse(await readBody());
      return getReconnectControlSessionResponseSchema.parse(
        await service.readReconnectControlSession(sessionId, body.secret, body.instanceId)
      );
    }
  }),
  route("POST", "/signaling/reconnect/:sessionId/claim", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = claimReconnectRoleRequestSchema.parse(await readBody());
      return claimReconnectRoleResponseSchema.parse(
        await service.claimReconnectRole(sessionId, body)
      );
    }
  }),
  route("POST", "/signaling/reconnect/:sessionId/heartbeat", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = heartbeatReconnectRoleRequestSchema.parse(await readBody());
      return heartbeatReconnectRoleResponseSchema.parse(
        await service.heartbeatReconnectRole(sessionId, body)
      );
    }
  }),
  route("POST", "/signaling/reconnect/:sessionId/offer", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = writeReconnectOfferRequestSchema.parse(await readBody());
      return writeReconnectOfferResponseSchema.parse(
        await service.writeReconnectOffer(sessionId, body)
      );
    }
  }),
  route("POST", "/signaling/reconnect/:sessionId/offer/read", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = readReconnectOfferRequestSchema.parse(await readBody());
      return readReconnectOfferResponseSchema.parse(
        await service.readReconnectOffer(sessionId, body.secret, body.instanceId)
      );
    }
  }),
  route("POST", "/signaling/reconnect/:sessionId/answer", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = writeReconnectAnswerRequestSchema.parse(await readBody());
      return writeReconnectAnswerResponseSchema.parse(
        await service.writeReconnectAnswer(sessionId, body)
      );
    }
  }),
  route("POST", "/signaling/reconnect/:sessionId/answer/read", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = readReconnectAnswerRequestSchema.parse(await readBody());
      return readReconnectAnswerResponseSchema.parse(
        await service.readReconnectAnswer(sessionId, body.secret, body.instanceId)
      );
    }
  }),
  route("POST", "/signaling/reconnect/:sessionId/finalize", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = finalizeReconnectAttemptRequestSchema.parse(await readBody());
      return finalizeReconnectAttemptResponseSchema.parse(
        await service.finalizeReconnectAttempt(sessionId, body)
      );
    }
  }),
  route("POST", "/signaling/reconnect/:sessionId/finalization/read", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = readReconnectFinalizationRequestSchema.parse(await readBody());
      return getReconnectFinalizationResponseSchema.parse(
        await service.readReconnectFinalization(sessionId, body.secret, body.instanceId)
      );
    }
  })
];

// Invite sessions: the first offer/answer exchange of a direct match.
const sessionRoutes: readonly SignalingRoute[] = [
  route("POST", "/signaling/sessions", {
    rateLimit: "create",
    successStatus: 201,
    handle: async (service, { readBody }) => {
      const body = createSignalingSessionRequestSchema.parse(await readBody());
      return createSignalingSessionResponseSchema.parse(await service.createSession(body));
    }
  }),
  route("GET", "/signaling/sessions/:sessionId", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId }) =>
      getSignalingSessionResponseSchema.parse(await service.getSession(sessionId))
  }),
  route("POST", "/signaling/sessions/:sessionId/answer", {
    rateLimit: "answer",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = submitSignalingAnswerRequestSchema.parse(await readBody());
      return submitSignalingAnswerResponseSchema.parse(await service.submitAnswer(sessionId, body));
    }
  }),
  route("POST", "/signaling/sessions/:sessionId/answer/read", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = getSignalingAnswerRequestSchema.parse(await readBody());
      return getSignalingAnswerResponseSchema.parse(
        await service.getAnswer(sessionId, body.hostSecret)
      );
    }
  }),
  route("POST", "/signaling/sessions/:sessionId/finalize", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId, readBody }) => {
      const body = finalizeSignalingSessionRequestSchema.parse(await readBody());
      return finalizeSignalingSessionResponseSchema.parse(
        await service.finalizeSession(sessionId, body.hostSecret)
      );
    }
  }),
  route("GET", "/signaling/sessions/:sessionId/finalization", {
    rateLimit: "reconnect",
    successStatus: 200,
    handle: async (service, { sessionId }) =>
      getSignalingFinalizationResponseSchema.parse(await service.getFinalization(sessionId))
  })
];

const signalingRoutes: readonly SignalingRoute[] = [...reconnectRoutes, ...sessionRoutes];

export interface SignalingRouteMatch {
  route: SignalingRoute;
  sessionId: string;
}

export const matchSignalingRoute = (
  method: string | undefined,
  segments: readonly string[]
): SignalingRouteMatch | undefined => {
  for (const candidate of signalingRoutes) {
    if (
      candidate.method === method &&
      candidate.path.length === segments.length &&
      candidate.path.every(
        (segment, index) => segment === SESSION_ID_SEGMENT || segment === segments[index]
      )
    ) {
      const sessionIdIndex = candidate.path.indexOf(SESSION_ID_SEGMENT);
      return {
        route: candidate,
        sessionId: sessionIdIndex === -1 ? "" : (segments[sessionIdIndex] ?? "")
      };
    }
  }

  return undefined;
};
