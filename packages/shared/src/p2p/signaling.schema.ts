import { z } from "zod";
import { displayNameSchema } from "../schemas/primitives.js";

export const P2P_SIGNALING_PROTOCOL_VERSION = 1;
export const SIGNALING_SESSION_STATES = [
  "open",
  "answered",
  "finalized",
  "expired"
] as const;
export const RECONNECT_CONTROL_ROLES = ["host", "guest"] as const;
export const RECONNECT_CONTROL_SESSION_STATES = ["open", "finalized", "expired"] as const;
export const RECONNECT_CLAIM_STATUSES = ["unclaimed", "claimed", "stale"] as const;
export const RECONNECT_ATTEMPT_STATUSES = [
  "idle",
  "offer-ready",
  "answer-ready",
  "finalized",
  "expired"
] as const;
export const RECONNECT_FINALIZATION_OUTCOMES = ["reconnected", "aborted"] as const;

const signalingSdpSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "SDP must not be empty."
});
const signalingTimestampSchema = z.number().int().nonnegative();
const signalingSessionIdSchema = z.string().trim().min(1);
const signalingHostSecretSchema = z.string().trim().min(1);
const reconnectControlSessionIdSchema = z.string().trim().min(1);
const reconnectSecretSchema = z.string().trim().min(1);
const reconnectInstanceIdSchema = z.string().trim().min(1);

const signalingPayloadBaseSchema = z
  .object({
    protocolVersion: z.literal(P2P_SIGNALING_PROTOCOL_VERSION),
    mode: z.literal("p2p"),
    sdp: signalingSdpSchema,
    timestamp: signalingTimestampSchema
  })
  .strict();

export const hostOfferPayloadSchema = signalingPayloadBaseSchema
  .extend({
    role: z.literal("host")
  })
  .strict();

export const guestAnswerPayloadSchema = signalingPayloadBaseSchema
  .extend({
    role: z.literal("guest"),
    displayName: displayNameSchema
  })
  .strict();

export const signalingSessionStateSchema = z.enum(SIGNALING_SESSION_STATES);

const signalingSessionMetadataSchema = z
  .object({
    sessionId: signalingSessionIdSchema,
    state: signalingSessionStateSchema,
    createdAt: signalingTimestampSchema,
    expiresAt: signalingTimestampSchema
  })
  .strict();

export const createSignalingSessionRequestSchema = z
  .object({
    offer: hostOfferPayloadSchema
  })
  .strict();

export const createSignalingSessionResponseSchema = signalingSessionMetadataSchema
  .extend({
    hostSecret: signalingHostSecretSchema,
    offer: hostOfferPayloadSchema
  })
  .strict();

export const getSignalingSessionResponseSchema = signalingSessionMetadataSchema
  .extend({
    offer: hostOfferPayloadSchema
  })
  .strict();

export const submitSignalingAnswerRequestSchema = z
  .object({
    answer: guestAnswerPayloadSchema
  })
  .strict();

export const submitSignalingAnswerResponseSchema = signalingSessionMetadataSchema
  .extend({
    answer: guestAnswerPayloadSchema
  })
  .strict();

export const getSignalingAnswerRequestSchema = z
  .object({
    hostSecret: signalingHostSecretSchema
  })
  .strict();

export const getSignalingAnswerResponseSchema = signalingSessionMetadataSchema
  .extend({
    answer: guestAnswerPayloadSchema.nullable()
  })
  .strict();

export const finalizeSignalingSessionRequestSchema = z
  .object({
    hostSecret: signalingHostSecretSchema
  })
  .strict();

export const finalizeSignalingSessionResponseSchema = signalingSessionMetadataSchema;
export const getSignalingFinalizationResponseSchema = signalingSessionMetadataSchema;

const reconnectPayloadBaseSchema = z
  .object({
    protocolVersion: z.literal(P2P_SIGNALING_PROTOCOL_VERSION),
    mode: z.literal("p2p-reconnect"),
    sdp: signalingSdpSchema,
    timestamp: signalingTimestampSchema
  })
  .strict();

export const reconnectControlRoleSchema = z.enum(RECONNECT_CONTROL_ROLES);
export const reconnectControlSessionStateSchema = z.enum(RECONNECT_CONTROL_SESSION_STATES);
export const reconnectClaimStatusSchema = z.enum(RECONNECT_CLAIM_STATUSES);
export const reconnectAttemptStatusSchema = z.enum(RECONNECT_ATTEMPT_STATUSES);
export const reconnectFinalizationOutcomeSchema = z.enum(RECONNECT_FINALIZATION_OUTCOMES);

export const reconnectOfferPayloadSchema = reconnectPayloadBaseSchema
  .extend({
    role: z.literal("host")
  })
  .strict();

export const reconnectAnswerPayloadSchema = reconnectPayloadBaseSchema
  .extend({
    role: z.literal("guest")
  })
  .strict();

const reconnectRoleStatusSchema = z
  .object({
    claimStatus: reconnectClaimStatusSchema,
    instanceId: reconnectInstanceIdSchema.nullable(),
    lastHeartbeatAt: signalingTimestampSchema.nullable()
  })
  .strict();

const reconnectAttemptMetadataSchema = z
  .object({
    status: reconnectAttemptStatusSchema,
    finalizationOutcome: reconnectFinalizationOutcomeSchema.nullable(),
    finalizedBy: reconnectControlRoleSchema.nullable(),
    finalizedAt: signalingTimestampSchema.nullable()
  })
  .strict();

const reconnectControlSessionMetadataSchema = z
  .object({
    sessionId: reconnectControlSessionIdSchema,
    state: reconnectControlSessionStateSchema,
    createdAt: signalingTimestampSchema,
    expiresAt: signalingTimestampSchema,
    host: reconnectRoleStatusSchema,
    guest: reconnectRoleStatusSchema,
    attempt: reconnectAttemptMetadataSchema
  })
  .strict();

export const registerReconnectControlSessionRequestSchema = z
  .object({
    sessionId: reconnectControlSessionIdSchema,
    hostSecret: reconnectSecretSchema,
    guestSecret: reconnectSecretSchema
  })
  .strict();

export const registerReconnectControlSessionResponseSchema = reconnectControlSessionMetadataSchema;
export const getReconnectControlSessionResponseSchema = reconnectControlSessionMetadataSchema;

export const claimReconnectRoleRequestSchema = z
  .object({
    role: reconnectControlRoleSchema,
    secret: reconnectSecretSchema,
    instanceId: reconnectInstanceIdSchema
  })
  .strict();

export const claimReconnectRoleResponseSchema = reconnectControlSessionMetadataSchema;

export const heartbeatReconnectRoleRequestSchema = z
  .object({
    role: reconnectControlRoleSchema,
    secret: reconnectSecretSchema,
    instanceId: reconnectInstanceIdSchema
  })
  .strict();

export const heartbeatReconnectRoleResponseSchema = reconnectControlSessionMetadataSchema;

const authenticatedReconnectReadRequestSchema = z
  .object({
    secret: reconnectSecretSchema,
    instanceId: reconnectInstanceIdSchema
  })
  .strict();

export const readReconnectControlSessionRequestSchema = authenticatedReconnectReadRequestSchema;

export const writeReconnectOfferRequestSchema = z
  .object({
    secret: reconnectSecretSchema,
    instanceId: reconnectInstanceIdSchema,
    offer: reconnectOfferPayloadSchema
  })
  .strict();

export const writeReconnectOfferResponseSchema = reconnectControlSessionMetadataSchema;

export const readReconnectOfferRequestSchema = authenticatedReconnectReadRequestSchema;

export const readReconnectOfferResponseSchema = reconnectControlSessionMetadataSchema
  .extend({
    offer: reconnectOfferPayloadSchema.nullable()
  })
  .strict();

export const writeReconnectAnswerRequestSchema = z
  .object({
    secret: reconnectSecretSchema,
    instanceId: reconnectInstanceIdSchema,
    answer: reconnectAnswerPayloadSchema
  })
  .strict();

export const writeReconnectAnswerResponseSchema = reconnectControlSessionMetadataSchema;

export const readReconnectAnswerRequestSchema = authenticatedReconnectReadRequestSchema;

export const readReconnectAnswerResponseSchema = reconnectControlSessionMetadataSchema
  .extend({
    answer: reconnectAnswerPayloadSchema.nullable()
  })
  .strict();

export const finalizeReconnectAttemptRequestSchema = z
  .object({
    role: reconnectControlRoleSchema,
    secret: reconnectSecretSchema,
    instanceId: reconnectInstanceIdSchema,
    outcome: reconnectFinalizationOutcomeSchema
  })
  .strict();

export const finalizeReconnectAttemptResponseSchema = reconnectControlSessionMetadataSchema;
export const readReconnectFinalizationRequestSchema = authenticatedReconnectReadRequestSchema;
export const getReconnectFinalizationResponseSchema = reconnectControlSessionMetadataSchema;

export type HostOfferPayload = z.infer<typeof hostOfferPayloadSchema>;
export type GuestAnswerPayload = z.infer<typeof guestAnswerPayloadSchema>;
export type SignalingSessionState = z.infer<typeof signalingSessionStateSchema>;
export type CreateSignalingSessionRequest = z.infer<typeof createSignalingSessionRequestSchema>;
export type CreateSignalingSessionResponse = z.infer<typeof createSignalingSessionResponseSchema>;
export type GetSignalingSessionResponse = z.infer<typeof getSignalingSessionResponseSchema>;
export type SubmitSignalingAnswerRequest = z.infer<typeof submitSignalingAnswerRequestSchema>;
export type SubmitSignalingAnswerResponse = z.infer<typeof submitSignalingAnswerResponseSchema>;
export type GetSignalingAnswerRequest = z.infer<typeof getSignalingAnswerRequestSchema>;
export type GetSignalingAnswerResponse = z.infer<typeof getSignalingAnswerResponseSchema>;
export type FinalizeSignalingSessionRequest = z.infer<typeof finalizeSignalingSessionRequestSchema>;
export type FinalizeSignalingSessionResponse = z.infer<typeof finalizeSignalingSessionResponseSchema>;
export type GetSignalingFinalizationResponse = z.infer<
  typeof getSignalingFinalizationResponseSchema
>;
export type ReconnectControlRole = z.infer<typeof reconnectControlRoleSchema>;
export type ReconnectControlSessionState = z.infer<typeof reconnectControlSessionStateSchema>;
export type ReconnectClaimStatus = z.infer<typeof reconnectClaimStatusSchema>;
export type ReconnectAttemptStatus = z.infer<typeof reconnectAttemptStatusSchema>;
export type ReconnectFinalizationOutcome = z.infer<typeof reconnectFinalizationOutcomeSchema>;
export type ReconnectOfferPayload = z.infer<typeof reconnectOfferPayloadSchema>;
export type ReconnectAnswerPayload = z.infer<typeof reconnectAnswerPayloadSchema>;
export type RegisterReconnectControlSessionRequest = z.infer<
  typeof registerReconnectControlSessionRequestSchema
>;
export type RegisterReconnectControlSessionResponse = z.infer<
  typeof registerReconnectControlSessionResponseSchema
>;
export type GetReconnectControlSessionResponse = z.infer<
  typeof getReconnectControlSessionResponseSchema
>;
export type ReadReconnectControlSessionRequest = z.infer<
  typeof readReconnectControlSessionRequestSchema
>;
export type ClaimReconnectRoleRequest = z.infer<typeof claimReconnectRoleRequestSchema>;
export type ClaimReconnectRoleResponse = z.infer<typeof claimReconnectRoleResponseSchema>;
export type HeartbeatReconnectRoleRequest = z.infer<typeof heartbeatReconnectRoleRequestSchema>;
export type HeartbeatReconnectRoleResponse = z.infer<typeof heartbeatReconnectRoleResponseSchema>;
export type WriteReconnectOfferRequest = z.infer<typeof writeReconnectOfferRequestSchema>;
export type WriteReconnectOfferResponse = z.infer<typeof writeReconnectOfferResponseSchema>;
export type ReadReconnectOfferRequest = z.infer<typeof readReconnectOfferRequestSchema>;
export type ReadReconnectOfferResponse = z.infer<typeof readReconnectOfferResponseSchema>;
export type WriteReconnectAnswerRequest = z.infer<typeof writeReconnectAnswerRequestSchema>;
export type WriteReconnectAnswerResponse = z.infer<typeof writeReconnectAnswerResponseSchema>;
export type ReadReconnectAnswerRequest = z.infer<typeof readReconnectAnswerRequestSchema>;
export type ReadReconnectAnswerResponse = z.infer<typeof readReconnectAnswerResponseSchema>;
export type FinalizeReconnectAttemptRequest = z.infer<typeof finalizeReconnectAttemptRequestSchema>;
export type FinalizeReconnectAttemptResponse = z.infer<
  typeof finalizeReconnectAttemptResponseSchema
>;
export type ReadReconnectFinalizationRequest = z.infer<
  typeof readReconnectFinalizationRequestSchema
>;
export type GetReconnectFinalizationResponse = z.infer<
  typeof getReconnectFinalizationResponseSchema
>;
