import type { ReconnectControlRole } from "@minesweeper-flags/shared";
import {
  type ReconnectAttemptRecord,
  type ReconnectControlSessionRecord,
  type ReconnectRoleClaimRecord,
  SignalingSessionExpiredError,
  SignalingSessionForbiddenError,
  type VisibleReconnectControlSessionRecord,
  type VisibleReconnectRoleClaimRecord
} from "./signaling.types.js";

// Pure rules for reconnect control session records. Storage, serialization,
// and expiry refresh stay in the service.

export const createReconnectAttempt = (): ReconnectAttemptRecord => ({
  status: "idle",
  offer: null,
  answer: null,
  finalizationOutcome: null,
  finalizedBy: null,
  finalizedAt: null
});

const toVisibleReconnectRoleClaim = (
  claim: ReconnectRoleClaimRecord,
  now: number,
  heartbeatTimeoutMs: number
): VisibleReconnectRoleClaimRecord => {
  if (!claim.instanceId) {
    return {
      claimStatus: "unclaimed",
      instanceId: null,
      lastHeartbeatAt: null
    };
  }

  if (claim.lastHeartbeatAt !== null && claim.lastHeartbeatAt + heartbeatTimeoutMs <= now) {
    return {
      claimStatus: "stale",
      instanceId: claim.instanceId,
      lastHeartbeatAt: claim.lastHeartbeatAt
    };
  }

  return {
    claimStatus: "claimed",
    instanceId: claim.instanceId,
    lastHeartbeatAt: claim.lastHeartbeatAt
  };
};

export const toVisibleReconnectControlSession = (
  session: ReconnectControlSessionRecord,
  now: number,
  heartbeatTimeoutMs: number
): VisibleReconnectControlSessionRecord => {
  const state = session.expiresAt <= now ? "expired" : session.state;

  return {
    sessionId: session.sessionId,
    state,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    host: toVisibleReconnectRoleClaim(session.host, now, heartbeatTimeoutMs),
    guest: toVisibleReconnectRoleClaim(session.guest, now, heartbeatTimeoutMs),
    attempt: {
      status: session.attempt.status,
      finalizationOutcome: session.attempt.finalizationOutcome,
      finalizedBy: session.attempt.finalizedBy,
      finalizedAt: session.attempt.finalizedAt
    }
  };
};

export const assertActiveReconnectControlSession = (
  session: ReconnectControlSessionRecord,
  now: number
): ReconnectControlSessionRecord => {
  if (session.expiresAt <= now) {
    throw new SignalingSessionExpiredError("That reconnect control session has expired.");
  }

  return session;
};

export const getReconnectRoleBySecret = (
  session: ReconnectControlSessionRecord,
  secret: string
): ReconnectControlRole => {
  if (session.host.secret === secret) {
    return "host";
  }

  if (session.guest.secret === secret) {
    return "guest";
  }

  throw new SignalingSessionForbiddenError(
    "That reconnect secret is not valid for this control session."
  );
};

export const getReconnectRoleClaim = (
  session: ReconnectControlSessionRecord,
  role: ReconnectControlRole
): ReconnectRoleClaimRecord => (role === "host" ? session.host : session.guest);

export const withUpdatedReconnectRoleClaim = (
  session: ReconnectControlSessionRecord,
  role: ReconnectControlRole,
  claim: ReconnectRoleClaimRecord
): ReconnectControlSessionRecord =>
  role === "host"
    ? {
        ...session,
        host: claim
      }
    : {
        ...session,
        guest: claim
      };

export const withReconnectAttemptReconciledForRoleReplacement = (
  session: ReconnectControlSessionRecord,
  role: ReconnectControlRole
): ReconnectControlSessionRecord => {
  const isAbortedFinalization =
    session.attempt.status === "finalized" && session.attempt.finalizationOutcome === "aborted";

  if (role === "host") {
    if (
      session.attempt.status !== "offer-ready" &&
      session.attempt.status !== "answer-ready" &&
      !isAbortedFinalization
    ) {
      return session;
    }

    return {
      ...session,
      state: "open",
      attempt: createReconnectAttempt()
    };
  }

  if (isAbortedFinalization) {
    return {
      ...session,
      state: "open",
      attempt: createReconnectAttempt()
    };
  }

  if (session.attempt.status !== "answer-ready") {
    return session;
  }

  return {
    ...session,
    state: "open",
    attempt: {
      ...session.attempt,
      status: "offer-ready",
      answer: null,
      finalizationOutcome: null,
      finalizedBy: null,
      finalizedAt: null
    }
  };
};

export const assertReconnectRoleSecret = (
  session: ReconnectControlSessionRecord,
  role: ReconnectControlRole,
  secret: string
): void => {
  if (getReconnectRoleClaim(session, role).secret !== secret) {
    throw new SignalingSessionForbiddenError(
      "That reconnect secret is not valid for this control session."
    );
  }
};

export const assertReconnectRoleAccess = (
  session: ReconnectControlSessionRecord,
  role: ReconnectControlRole,
  secret: string,
  instanceId: string
): ReconnectRoleClaimRecord => {
  assertReconnectRoleSecret(session, role, secret);

  const claim = getReconnectRoleClaim(session, role);

  if (claim.instanceId !== instanceId) {
    throw new SignalingSessionForbiddenError(
      "That reconnect instance is not the active claimant for this role."
    );
  }

  return claim;
};
