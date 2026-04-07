import type {
  ReconnectAnswerPayload,
  ReconnectAttemptStatus,
  ReconnectClaimStatus,
  ReconnectControlRole,
  ReconnectControlSessionState,
  ReconnectFinalizationOutcome,
  ReconnectOfferPayload,
  GuestAnswerPayload,
  HostOfferPayload,
  SignalingSessionState
} from "@minesweeper-flags/shared";

export interface SignalingSessionRecord {
  sessionId: string;
  hostSecret: string;
  offer: HostOfferPayload;
  answer: GuestAnswerPayload | null;
  state: SignalingSessionState;
  createdAt: number;
  expiresAt: number;
}

export interface ReconnectRoleClaimRecord {
  secret: string;
  instanceId: string | null;
  lastHeartbeatAt: number | null;
}

export interface ReconnectAttemptRecord {
  status: ReconnectAttemptStatus;
  offer: ReconnectOfferPayload | null;
  answer: ReconnectAnswerPayload | null;
  finalizationOutcome: ReconnectFinalizationOutcome | null;
  finalizedBy: ReconnectControlRole | null;
  finalizedAt: number | null;
}

export interface ReconnectControlSessionRecord {
  sessionId: string;
  state: ReconnectControlSessionState;
  createdAt: number;
  expiresAt: number;
  host: ReconnectRoleClaimRecord;
  guest: ReconnectRoleClaimRecord;
  attempt: ReconnectAttemptRecord;
}

export interface VisibleReconnectRoleClaimRecord {
  claimStatus: ReconnectClaimStatus;
  instanceId: string | null;
  lastHeartbeatAt: number | null;
}

export interface VisibleReconnectControlSessionRecord {
  sessionId: string;
  state: ReconnectControlSessionState;
  createdAt: number;
  expiresAt: number;
  host: VisibleReconnectRoleClaimRecord;
  guest: VisibleReconnectRoleClaimRecord;
  attempt: Omit<ReconnectAttemptRecord, "offer" | "answer"> & {
    status: ReconnectAttemptStatus;
  };
}

export class SignalingSessionNotFoundError extends Error {}

export class SignalingSessionExpiredError extends Error {}

export class SignalingSessionForbiddenError extends Error {}

export class SignalingSessionConflictError extends Error {}
