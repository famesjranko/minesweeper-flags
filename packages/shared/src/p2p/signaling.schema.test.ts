import { describe, expect, it } from "vitest";
import {
  SIGNALING_SESSION_STATES,
  RECONNECT_ATTEMPT_STATUSES,
  RECONNECT_CLAIM_STATUSES,
  RECONNECT_CONTROL_ROLES,
  RECONNECT_CONTROL_SESSION_STATES,
  RECONNECT_FINALIZATION_OUTCOMES,
  P2P_SIGNALING_PROTOCOL_VERSION,
  claimReconnectRoleRequestSchema,
  finalizeReconnectAttemptRequestSchema,
  createSignalingSessionRequestSchema,
  createSignalingSessionResponseSchema,
  finalizeSignalingSessionRequestSchema,
  readReconnectControlSessionRequestSchema,
  readReconnectFinalizationRequestSchema,
  getReconnectControlSessionResponseSchema,
  getReconnectFinalizationResponseSchema,
  getSignalingAnswerRequestSchema,
  getSignalingAnswerResponseSchema,
  getSignalingFinalizationResponseSchema,
  getSignalingSessionResponseSchema,
  guestAnswerPayloadSchema,
  heartbeatReconnectRoleRequestSchema,
  hostOfferPayloadSchema,
  readReconnectAnswerResponseSchema,
  readReconnectOfferResponseSchema,
  reconnectAnswerPayloadSchema,
  reconnectOfferPayloadSchema,
  registerReconnectControlSessionRequestSchema,
  registerReconnectControlSessionResponseSchema,
  submitSignalingAnswerRequestSchema,
  submitSignalingAnswerResponseSchema,
  writeReconnectAnswerRequestSchema,
  writeReconnectOfferRequestSchema
} from "../index.js";

const hostOffer = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p" as const,
  role: "host" as const,
  sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1",
  timestamp: 1_744_000_000_000
};

const guestAnswer = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p" as const,
  role: "guest" as const,
  displayName: "Guest",
  sdp: "v=0\r\no=- 3 4 IN IP4 127.0.0.1",
  timestamp: 1_744_000_000_001
};

const reconnectOffer = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p-reconnect" as const,
  role: "host" as const,
  sdp: "v=0\r\no=- 5 6 IN IP4 127.0.0.1",
  timestamp: 1_744_000_100_000
};

const reconnectAnswer = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p-reconnect" as const,
  role: "guest" as const,
  sdp: "v=0\r\no=- 7 8 IN IP4 127.0.0.1",
  timestamp: 1_744_000_100_001
};

const reconnectStatus = {
  sessionId: "reconnect-session-123",
  state: "open" as const,
  createdAt: 1_744_000_000_000,
  expiresAt: 1_744_000_900_000,
  host: {
    claimStatus: "claimed" as const,
    instanceId: "host-instance-1",
    lastHeartbeatAt: 1_744_000_100_010
  },
  guest: {
    claimStatus: "unclaimed" as const,
    instanceId: null,
    lastHeartbeatAt: null
  },
  attempt: {
    status: "offer-ready" as const,
    finalizationOutcome: null,
    finalizedBy: null,
    finalizedAt: null
  }
};

describe("p2p signaling schemas", () => {
  it("accepts a valid host offer payload", () => {
    const parsed = hostOfferPayloadSchema.parse(hostOffer);

    expect(parsed.role).toBe("host");
  });

  it("accepts a valid guest answer payload", () => {
    const parsed = guestAnswerPayloadSchema.parse(guestAnswer);

    expect(parsed.role).toBe("guest");
  });

  it("preserves trailing SDP line endings", () => {
    const sdp = "v=0\r\na=max-message-size:262144\r\n";

    const parsed = hostOfferPayloadSchema.parse({
      protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
      mode: "p2p",
      role: "host",
      sdp,
      timestamp: 1_744_000_000_000
    });

    expect(parsed.sdp).toBe(sdp);
  });

  it("rejects an unsupported protocol version", () => {
    const result = hostOfferPayloadSchema.safeParse({
      protocolVersion: 2,
      mode: "p2p",
      role: "host",
      sdp: "v=0",
      timestamp: 1_744_000_000_000
    });

    expect(result.success).toBe(false);
  });

  it("rejects the wrong role for an answer payload", () => {
    const result = guestAnswerPayloadSchema.safeParse({
      protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
      mode: "p2p",
      role: "host",
      displayName: "Guest",
      sdp: "v=0",
      timestamp: 1_744_000_000_000
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-p2p signaling payload", () => {
    const result = hostOfferPayloadSchema.safeParse({
      protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
      mode: "server",
      role: "host",
      sdp: "v=0",
      timestamp: 1_744_000_000_000
    });

    expect(result.success).toBe(false);
  });

  it("accepts the supported signaling session states", () => {
    expect(SIGNALING_SESSION_STATES).toEqual(["open", "answered", "finalized", "expired"]);
  });

  it("accepts a valid create-session request", () => {
    const parsed = createSignalingSessionRequestSchema.parse({
      offer: hostOffer
    });

    expect(parsed.offer).toEqual(hostOffer);
  });

  it("accepts a valid create-session response", () => {
    const parsed = createSignalingSessionResponseSchema.parse({
      sessionId: "session-123",
      hostSecret: "secret-123",
      state: "open",
      offer: hostOffer,
      createdAt: 1_744_000_000_000,
      expiresAt: 1_744_000_900_000
    });

    expect(parsed.state).toBe("open");
  });

  it("accepts a valid fetch-session response", () => {
    const parsed = getSignalingSessionResponseSchema.parse({
      sessionId: "session-123",
      state: "open",
      offer: hostOffer,
      createdAt: 1_744_000_000_000,
      expiresAt: 1_744_000_900_000
    });

    expect(parsed.offer.role).toBe("host");
  });

  it("accepts answer submission request and response payloads", () => {
    const request = submitSignalingAnswerRequestSchema.parse({
      answer: guestAnswer
    });
    const response = submitSignalingAnswerResponseSchema.parse({
      sessionId: "session-123",
      state: "answered",
      answer: guestAnswer,
      createdAt: 1_744_000_000_000,
      expiresAt: 1_744_000_900_000
    });

    expect(request.answer.displayName).toBe("Guest");
    expect(response.state).toBe("answered");
  });

  it("accepts answer polling before an answer exists", () => {
    const parsed = getSignalingAnswerResponseSchema.parse({
      sessionId: "session-123",
      state: "open",
      answer: null,
      createdAt: 1_744_000_000_000,
      expiresAt: 1_744_000_900_000
    });

    expect(parsed.answer).toBeNull();
  });

  it("accepts privileged answer polling requests with a host secret in the body", () => {
    const parsed = getSignalingAnswerRequestSchema.parse({
      hostSecret: "secret-123"
    });

    expect(parsed.hostSecret).toBe("secret-123");
  });

  it("accepts finalize request and finalization responses", () => {
    const request = finalizeSignalingSessionRequestSchema.parse({
      hostSecret: "secret-123"
    });
    const response = getSignalingFinalizationResponseSchema.parse({
      sessionId: "session-123",
      state: "finalized",
      createdAt: 1_744_000_000_000,
      expiresAt: 1_744_000_900_000
    });

    expect(request.hostSecret).toBe("secret-123");
    expect(response.state).toBe("finalized");
  });

  it("rejects create-session requests with unsupported payload roles", () => {
    const result = createSignalingSessionRequestSchema.safeParse({
      offer: guestAnswer
    });

    expect(result.success).toBe(false);
  });

  it("rejects strict session responses with unexpected fields", () => {
    const result = getSignalingSessionResponseSchema.safeParse({
      sessionId: "session-123",
      state: "open",
      offer: hostOffer,
      createdAt: 1_744_000_000_000,
      expiresAt: 1_744_000_900_000,
      hostSecret: "should-not-be-exposed"
    });

    expect(result.success).toBe(false);
  });

  it("rejects answer polling responses with invalid state values", () => {
    const result = getSignalingAnswerResponseSchema.safeParse({
      sessionId: "session-123",
      state: "pending",
      answer: null,
      createdAt: 1_744_000_000_000,
      expiresAt: 1_744_000_900_000
    });

    expect(result.success).toBe(false);
  });

  it("rejects privileged answer polling requests with unexpected fields", () => {
    const result = getSignalingAnswerRequestSchema.safeParse({
      hostSecret: "secret-123",
      query: "should-not-exist"
    });

    expect(result.success).toBe(false);
  });

  it("accepts the supported reconnect enums", () => {
    expect(RECONNECT_CONTROL_ROLES).toEqual(["host", "guest"]);
    expect(RECONNECT_CONTROL_SESSION_STATES).toEqual(["open", "finalized", "expired"]);
    expect(RECONNECT_CLAIM_STATUSES).toEqual(["unclaimed", "claimed", "stale"]);
    expect(RECONNECT_ATTEMPT_STATUSES).toEqual([
      "idle",
      "offer-ready",
      "answer-ready",
      "finalized",
      "expired"
    ]);
    expect(RECONNECT_FINALIZATION_OUTCOMES).toEqual(["reconnected", "aborted"]);
  });

  it("accepts valid reconnect offer and answer payloads", () => {
    const parsedOffer = reconnectOfferPayloadSchema.parse(reconnectOffer);
    const parsedAnswer = reconnectAnswerPayloadSchema.parse(reconnectAnswer);

    expect(parsedOffer.role).toBe("host");
    expect(parsedAnswer.role).toBe("guest");
  });

  it("accepts reconnect control-session registration and status responses", () => {
    const request = registerReconnectControlSessionRequestSchema.parse({
      sessionId: "reconnect-session-123",
      hostSecret: "host-secret-123",
      guestSecret: "guest-secret-123"
    });
    const response = registerReconnectControlSessionResponseSchema.parse(reconnectStatus);
    const fetched = getReconnectControlSessionResponseSchema.parse(reconnectStatus);

    expect(request.sessionId).toBe("reconnect-session-123");
    expect(response.host.claimStatus).toBe("claimed");
    expect(fetched.attempt.status).toBe("offer-ready");
  });

  it("accepts reconnect role claims and heartbeats with secrets in the body", () => {
    const claim = claimReconnectRoleRequestSchema.parse({
      role: "host",
      secret: "host-secret-123",
      instanceId: "host-instance-1"
    });
    const heartbeat = heartbeatReconnectRoleRequestSchema.parse({
      role: "guest",
      secret: "guest-secret-123",
      instanceId: "guest-instance-1"
    });

    expect(claim.role).toBe("host");
    expect(heartbeat.instanceId).toBe("guest-instance-1");
  });

  it("accepts authenticated reconnect control-session and finalization reads", () => {
    const controlRead = readReconnectControlSessionRequestSchema.parse({
      secret: "host-secret-123",
      instanceId: "host-instance-1"
    });
    const finalizationRead = readReconnectFinalizationRequestSchema.parse({
      secret: "guest-secret-123",
      instanceId: "guest-instance-1"
    });

    expect(controlRead.secret).toBe("host-secret-123");
    expect(finalizationRead.instanceId).toBe("guest-instance-1");
  });

  it("accepts reconnect offer and answer exchange request and read payloads", () => {
    const offerWrite = writeReconnectOfferRequestSchema.parse({
      secret: "host-secret-123",
      instanceId: "host-instance-1",
      offer: reconnectOffer
    });
    const offerRead = readReconnectOfferResponseSchema.parse({
      ...reconnectStatus,
      offer: reconnectOffer
    });
    const answerWrite = writeReconnectAnswerRequestSchema.parse({
      secret: "guest-secret-123",
      instanceId: "guest-instance-1",
      answer: reconnectAnswer
    });
    const answerRead = readReconnectAnswerResponseSchema.parse({
      ...reconnectStatus,
      attempt: {
        status: "answer-ready",
        finalizationOutcome: null,
        finalizedBy: null,
        finalizedAt: null
      },
      guest: {
        claimStatus: "claimed",
        instanceId: "guest-instance-1",
        lastHeartbeatAt: 1_744_000_100_020
      },
      answer: reconnectAnswer
    });

    expect(offerWrite.offer.role).toBe("host");
    expect(offerRead.offer?.sdp).toBe(reconnectOffer.sdp);
    expect(answerWrite.answer.role).toBe("guest");
    expect(answerRead.answer?.sdp).toBe(reconnectAnswer.sdp);
  });

  it("accepts reconnect finalization requests and responses", () => {
    const request = finalizeReconnectAttemptRequestSchema.parse({
      role: "host",
      secret: "host-secret-123",
      instanceId: "host-instance-1",
      outcome: "reconnected"
    });
    const response = getReconnectFinalizationResponseSchema.parse({
      ...reconnectStatus,
      state: "finalized",
      attempt: {
        status: "finalized",
        finalizationOutcome: "reconnected",
        finalizedBy: "host",
        finalizedAt: 1_744_000_100_030
      }
    });

    expect(request.outcome).toBe("reconnected");
    expect(response.attempt.finalizationOutcome).toBe("reconnected");
  });

  it("rejects reconnect claim requests with invalid roles", () => {
    const result = claimReconnectRoleRequestSchema.safeParse({
      role: "spectator",
      secret: "secret-123",
      instanceId: "instance-1"
    });

    expect(result.success).toBe(false);
  });

  it("rejects authenticated reconnect reads with unexpected fields", () => {
    const result = readReconnectControlSessionRequestSchema.safeParse({
      secret: "host-secret-123",
      instanceId: "host-instance-1",
      role: "host"
    });

    expect(result.success).toBe(false);
  });

  it("rejects strict reconnect status responses with unexpected fields", () => {
    const result = getReconnectControlSessionResponseSchema.safeParse({
      ...reconnectStatus,
      hostSecret: "should-not-be-exposed"
    });

    expect(result.success).toBe(false);
  });

  it("rejects reconnect status responses with invalid state values", () => {
    const result = getReconnectFinalizationResponseSchema.safeParse({
      ...reconnectStatus,
      attempt: {
        status: "pending",
        finalizationOutcome: null,
        finalizedBy: null,
        finalizedAt: null
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects reconnect finalization requests with invalid outcomes", () => {
    const result = finalizeReconnectAttemptRequestSchema.safeParse({
      role: "guest",
      secret: "guest-secret-123",
      instanceId: "guest-instance-1",
      outcome: "timeout"
    });

    expect(result.success).toBe(false);
  });
});
