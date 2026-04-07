import { randomBytes } from "node:crypto";
import {
  type ClaimReconnectRoleRequest,
  type ClaimReconnectRoleResponse,
  type CreateSignalingSessionRequest,
  type CreateSignalingSessionResponse,
  type FinalizeReconnectAttemptRequest,
  type FinalizeReconnectAttemptResponse,
  type FinalizeSignalingSessionResponse,
  type GetReconnectControlSessionResponse,
  type GetReconnectFinalizationResponse,
  type HeartbeatReconnectRoleRequest,
  type HeartbeatReconnectRoleResponse,
  type GetSignalingAnswerResponse,
  type GetSignalingFinalizationResponse,
  type GetSignalingSessionResponse,
  type ReadReconnectAnswerResponse,
  type ReadReconnectOfferResponse,
  type ReconnectAnswerPayload,
  type ReconnectControlRole,
  type ReconnectFinalizationOutcome,
  type ReconnectOfferPayload,
  type RegisterReconnectControlSessionRequest,
  type RegisterReconnectControlSessionResponse,
  type SubmitSignalingAnswerRequest,
  type SubmitSignalingAnswerResponse,
  type WriteReconnectAnswerRequest,
  type WriteReconnectAnswerResponse,
  type WriteReconnectOfferRequest,
  type WriteReconnectOfferResponse
} from "@minesweeper-flags/shared";
import { KeyedSerialTaskRunner } from "../../lib/async/keyed-serial-task-runner.js";
import type { SignalingRepository } from "./signaling.repository.js";
import {
  type ReconnectAttemptRecord,
  type ReconnectControlSessionRecord,
  type ReconnectRoleClaimRecord,
  SignalingSessionConflictError,
  SignalingSessionExpiredError,
  SignalingSessionForbiddenError,
  SignalingSessionNotFoundError,
  type SignalingSessionRecord,
  type VisibleReconnectControlSessionRecord,
  type VisibleReconnectRoleClaimRecord
} from "./signaling.types.js";

const SESSION_CREATION_LOCK_KEY = "__signaling-session-create__";

const createSessionId = (): string => randomBytes(16).toString("base64url");

const createHostSecret = (): string => randomBytes(18).toString("base64url");

const createReconnectAttempt = (): ReconnectAttemptRecord => ({
  status: "idle",
  offer: null,
  answer: null,
  finalizationOutcome: null,
  finalizedBy: null,
  finalizedAt: null
});

const toSessionMetadata = (session: SignalingSessionRecord) => ({
  sessionId: session.sessionId,
  state: session.state,
  createdAt: session.createdAt,
  expiresAt: session.expiresAt
});

export interface SignalingServiceOptions {
  sessionTtlSeconds: number;
  reconnectControlSession?: {
    sessionTtlSeconds: number;
    heartbeatTimeoutMs: number;
  };
}

interface ReconnectControlSessionOptions {
  sessionTtlSeconds: number;
  heartbeatTimeoutMs: number;
}

export class SignalingService {
  private readonly reconnectControlSessionOptions: ReconnectControlSessionOptions;

  constructor(
    private readonly repository: SignalingRepository,
    private readonly options: SignalingServiceOptions,
    private readonly taskRunner: KeyedSerialTaskRunner = new KeyedSerialTaskRunner()
  ) {
    this.reconnectControlSessionOptions = options.reconnectControlSession ?? {
      sessionTtlSeconds: options.sessionTtlSeconds,
      heartbeatTimeoutMs: 10_000
    };
  }

  async createSession(
    request: CreateSignalingSessionRequest,
    now = Date.now()
  ): Promise<CreateSignalingSessionResponse> {
    return await this.taskRunner.run(SESSION_CREATION_LOCK_KEY, async () => {
      const createdAt = now;
      const expiresAt = createdAt + this.options.sessionTtlSeconds * 1000;
      let session: SignalingSessionRecord;

      do {
        session = {
          sessionId: createSessionId(),
          hostSecret: createHostSecret(),
          offer: request.offer,
          answer: null,
          state: "open",
          createdAt,
          expiresAt
        };
      } while (!(await this.repository.create(session)));

      return {
        ...toSessionMetadata(session),
        hostSecret: session.hostSecret,
        offer: session.offer
      };
    });
  }

  async getSession(sessionId: string, now = Date.now()): Promise<GetSignalingSessionResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    const visibleSession = this.withVisibleState(session, now);

    return {
      ...toSessionMetadata(visibleSession),
      offer: visibleSession.offer
    };
  }

  async submitAnswer(
    sessionId: string,
    request: SubmitSignalingAnswerRequest,
    now = Date.now()
  ): Promise<SubmitSignalingAnswerResponse> {
    return await this.taskRunner.run(sessionId, async () => {
      while (true) {
        const session = this.assertActiveSession(await this.getSessionOrThrow(sessionId), now);

        if (session.answer) {
          throw new SignalingSessionConflictError("That direct-match link already has a guest answer.");
        }

        if (session.state !== "open") {
          throw new SignalingSessionConflictError(
            "That direct-match link is no longer accepting guest answers."
          );
        }

        const updatedSession: SignalingSessionRecord = {
          ...session,
          answer: request.answer,
          state: "answered"
        };

        if (!(await this.repository.saveIfUnchanged(session, updatedSession))) {
          continue;
        }

        return {
          ...toSessionMetadata(updatedSession),
          answer: request.answer
        };
      }
    });
  }

  async getAnswer(
    sessionId: string,
    hostSecret: string,
    now = Date.now()
  ): Promise<GetSignalingAnswerResponse> {
    const session = await this.getSessionOrThrow(sessionId);

    this.assertHostSecret(session, hostSecret);

    const visibleSession = this.withVisibleState(session, now);

    return {
      ...toSessionMetadata(visibleSession),
      answer: visibleSession.answer
    };
  }

  async finalizeSession(
    sessionId: string,
    hostSecret: string,
    now = Date.now()
  ): Promise<FinalizeSignalingSessionResponse> {
    return await this.taskRunner.run(sessionId, async () => {
      while (true) {
        const session = this.assertActiveSession(await this.getSessionOrThrow(sessionId), now);

        this.assertHostSecret(session, hostSecret);

        if (!session.answer) {
          throw new SignalingSessionConflictError(
            "That direct-match link cannot be finalized before a guest answer exists."
          );
        }

        if (session.state === "finalized") {
          return toSessionMetadata(session);
        }

        const updatedSession: SignalingSessionRecord = {
          ...session,
          state: "finalized"
        };

        if (!(await this.repository.saveIfUnchanged(session, updatedSession))) {
          continue;
        }

        return toSessionMetadata(updatedSession);
      }
    });
  }

  async getFinalization(
    sessionId: string,
    now = Date.now()
  ): Promise<GetSignalingFinalizationResponse> {
    const session = await this.getSessionOrThrow(sessionId);
    return toSessionMetadata(this.withVisibleState(session, now));
  }

  async registerReconnectControlSession(
    request: RegisterReconnectControlSessionRequest,
    now = Date.now()
  ): Promise<RegisterReconnectControlSessionResponse> {
    return await this.taskRunner.run(request.sessionId, async () => {
      const createdAt = now;
      const expiresAt = createdAt + this.reconnectControlSessionOptions.sessionTtlSeconds * 1000;
      const session: ReconnectControlSessionRecord = {
        sessionId: request.sessionId,
        state: "open",
        createdAt,
        expiresAt,
        host: {
          secret: request.hostSecret,
          instanceId: null,
          lastHeartbeatAt: null
        },
        guest: {
          secret: request.guestSecret,
          instanceId: null,
          lastHeartbeatAt: null
        },
        attempt: createReconnectAttempt()
      };

      if (!(await this.repository.createReconnectControlSession(session))) {
        throw new SignalingSessionConflictError(
          "That reconnect control session is already registered."
        );
      }

      return this.toReconnectControlSessionMetadata(session, now);
    });
  }

  async getReconnectControlSession(
    sessionId: string,
    now = Date.now()
  ): Promise<GetReconnectControlSessionResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    return this.toReconnectControlSessionMetadata(session, now);
  }

  async readReconnectControlSession(
    sessionId: string,
    secret: string,
    instanceId: string,
    now = Date.now()
  ): Promise<GetReconnectControlSessionResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    const role = this.getReconnectRoleBySecret(session, secret);

    this.assertReconnectRoleAccess(session, role, secret, instanceId);

    return this.toReconnectControlSessionMetadata(session, now);
  }

  async claimReconnectRole(
    sessionId: string,
    request: ClaimReconnectRoleRequest,
    now = Date.now()
  ): Promise<ClaimReconnectRoleResponse> {
    return await this.taskRunner.run(sessionId, async () => {
      while (true) {
        const session = this.assertActiveReconnectControlSession(
          await this.getReconnectControlSessionOrThrow(sessionId),
          now
        );

        this.assertReconnectRoleSecret(session, request.role, request.secret);
        const previousClaim = this.getReconnectRoleClaim(session, request.role);
        const isSameRoleReplacement =
          previousClaim.instanceId !== null && previousClaim.instanceId !== request.instanceId;

        let updatedSession = this.withUpdatedReconnectRoleClaim(session, request.role, {
          secret: this.getReconnectRoleClaim(session, request.role).secret,
          instanceId: request.instanceId,
          lastHeartbeatAt: now
        });

        if (isSameRoleReplacement) {
          updatedSession = this.withReconnectAttemptReconciledForRoleReplacement(
            updatedSession,
            request.role
          );
        }

        const refreshedSession = this.withRefreshedReconnectControlSessionExpiry(updatedSession, now);

        if (!(await this.repository.saveReconnectControlSessionIfUnchanged(session, refreshedSession))) {
          continue;
        }

        return this.toReconnectControlSessionMetadata(refreshedSession, now);
      }
    });
  }

  async heartbeatReconnectRole(
    sessionId: string,
    request: HeartbeatReconnectRoleRequest,
    now = Date.now()
  ): Promise<HeartbeatReconnectRoleResponse> {
    return await this.taskRunner.run(sessionId, async () => {
      while (true) {
        const session = this.assertActiveReconnectControlSession(
          await this.getReconnectControlSessionOrThrow(sessionId),
          now
        );

        const claim = this.assertReconnectRoleAccess(
          session,
          request.role,
          request.secret,
          request.instanceId
        );

        const updatedSession = this.withUpdatedReconnectRoleClaim(session, request.role, {
          ...claim,
          lastHeartbeatAt: now
        });
        const refreshedSession = this.withRefreshedReconnectControlSessionExpiry(updatedSession, now);

        if (!(await this.repository.saveReconnectControlSessionIfUnchanged(session, refreshedSession))) {
          continue;
        }

        return this.toReconnectControlSessionMetadata(refreshedSession, now);
      }
    });
  }

  async writeReconnectOffer(
    sessionId: string,
    request: WriteReconnectOfferRequest,
    now = Date.now()
  ): Promise<WriteReconnectOfferResponse> {
    return await this.taskRunner.run(sessionId, async () => {
      while (true) {
        const session = this.assertActiveReconnectControlSession(
          await this.getReconnectControlSessionOrThrow(sessionId),
          now
        );

        this.assertReconnectRoleAccess(session, "host", request.secret, request.instanceId);

        const updatedSession: ReconnectControlSessionRecord = {
          ...session,
          state: "open",
          attempt: {
            status: "offer-ready",
            offer: request.offer,
            answer: null,
            finalizationOutcome: null,
            finalizedBy: null,
            finalizedAt: null
          }
        };
        const refreshedSession = this.withRefreshedReconnectControlSessionExpiry(updatedSession, now);

        if (!(await this.repository.saveReconnectControlSessionIfUnchanged(session, refreshedSession))) {
          continue;
        }

        return this.toReconnectControlSessionMetadata(refreshedSession, now);
      }
    });
  }

  async readReconnectOffer(
    sessionId: string,
    secret: string,
    instanceId: string,
    now = Date.now()
  ): Promise<ReadReconnectOfferResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    const role = this.getReconnectRoleBySecret(session, secret);

    this.assertReconnectRoleAccess(session, role, secret, instanceId);

    return {
      ...this.toReconnectControlSessionMetadata(session, now),
      offer: session.attempt.offer
    };
  }

  async writeReconnectAnswer(
    sessionId: string,
    request: WriteReconnectAnswerRequest,
    now = Date.now()
  ): Promise<WriteReconnectAnswerResponse> {
    return await this.taskRunner.run(sessionId, async () => {
      while (true) {
        const session = this.assertActiveReconnectControlSession(
          await this.getReconnectControlSessionOrThrow(sessionId),
          now
        );

        this.assertReconnectRoleAccess(session, "guest", request.secret, request.instanceId);

        if (!session.attempt.offer || session.attempt.status !== "offer-ready") {
          throw new SignalingSessionConflictError(
            "That reconnect attempt is not ready for a guest answer."
          );
        }

        const updatedSession: ReconnectControlSessionRecord = {
          ...session,
          attempt: {
            ...session.attempt,
            status: "answer-ready",
            answer: request.answer
          }
        };
        const refreshedSession = this.withRefreshedReconnectControlSessionExpiry(updatedSession, now);

        if (!(await this.repository.saveReconnectControlSessionIfUnchanged(session, refreshedSession))) {
          continue;
        }

        return this.toReconnectControlSessionMetadata(refreshedSession, now);
      }
    });
  }

  async readReconnectAnswer(
    sessionId: string,
    secret: string,
    instanceId: string,
    now = Date.now()
  ): Promise<ReadReconnectAnswerResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    const role = this.getReconnectRoleBySecret(session, secret);

    this.assertReconnectRoleAccess(session, role, secret, instanceId);

    return {
      ...this.toReconnectControlSessionMetadata(session, now),
      answer: session.attempt.answer
    };
  }

  async finalizeReconnectAttempt(
    sessionId: string,
    request: FinalizeReconnectAttemptRequest,
    now = Date.now()
  ): Promise<FinalizeReconnectAttemptResponse> {
    return await this.taskRunner.run(sessionId, async () => {
      while (true) {
        const session = this.assertActiveReconnectControlSession(
          await this.getReconnectControlSessionOrThrow(sessionId),
          now
        );

        this.assertReconnectRoleAccess(session, request.role, request.secret, request.instanceId);

        if (session.attempt.status === "idle") {
          throw new SignalingSessionConflictError("That reconnect attempt has not started yet.");
        }

        if (session.attempt.status === "finalized") {
          return this.toReconnectControlSessionMetadata(session, now);
        }

        const updatedSession: ReconnectControlSessionRecord = {
          ...session,
          state: "finalized",
          attempt: {
            ...session.attempt,
            status: "finalized",
            finalizationOutcome: request.outcome,
            finalizedBy: request.role,
            finalizedAt: now
          }
        };
        const refreshedSession = this.withRefreshedReconnectControlSessionExpiry(updatedSession, now);

        if (!(await this.repository.saveReconnectControlSessionIfUnchanged(session, refreshedSession))) {
          continue;
        }

        return this.toReconnectControlSessionMetadata(refreshedSession, now);
      }
    });
  }

  async getReconnectFinalization(
    sessionId: string,
    now = Date.now()
  ): Promise<GetReconnectFinalizationResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    return this.toReconnectControlSessionMetadata(session, now);
  }

  async readReconnectFinalization(
    sessionId: string,
    secret: string,
    instanceId: string,
    now = Date.now()
  ): Promise<GetReconnectFinalizationResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    const role = this.getReconnectRoleBySecret(session, secret);

    this.assertReconnectRoleAccess(session, role, secret, instanceId);

    return this.toReconnectControlSessionMetadata(session, now);
  }

  private async getSessionOrThrow(sessionId: string): Promise<SignalingSessionRecord> {
    const session = await this.repository.getBySessionId(sessionId);

    if (!session) {
      throw new SignalingSessionNotFoundError("That direct-match link is no longer valid.");
    }

    return session;
  }

  private async getReconnectControlSessionOrThrow(
    sessionId: string
  ): Promise<ReconnectControlSessionRecord> {
    const session = await this.repository.getReconnectControlSessionBySessionId(sessionId);

    if (!session) {
      throw new SignalingSessionNotFoundError("That reconnect control session is no longer valid.");
    }

    return session;
  }

  private withVisibleState(session: SignalingSessionRecord, now: number): SignalingSessionRecord {
    if (session.expiresAt <= now && session.state !== "expired") {
      return {
        ...session,
        state: "expired"
      };
    }

    return session;
  }

  private assertActiveSession(session: SignalingSessionRecord, now: number): SignalingSessionRecord {
    if (session.expiresAt <= now) {
      throw new SignalingSessionExpiredError("That direct-match link has expired.");
    }

    return session;
  }

  private assertHostSecret(session: SignalingSessionRecord, hostSecret: string): void {
    if (session.hostSecret !== hostSecret) {
      throw new SignalingSessionForbiddenError("That host secret is not valid for this session.");
    }
  }

  private toReconnectControlSessionMetadata(
    session: ReconnectControlSessionRecord,
    now: number
  ): VisibleReconnectControlSessionRecord {
    const state = session.expiresAt <= now ? "expired" : session.state;

    return {
      sessionId: session.sessionId,
      state,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      host: this.toVisibleReconnectRoleClaim(session.host, now),
      guest: this.toVisibleReconnectRoleClaim(session.guest, now),
      attempt: {
        status: session.attempt.status,
        finalizationOutcome: session.attempt.finalizationOutcome,
        finalizedBy: session.attempt.finalizedBy,
        finalizedAt: session.attempt.finalizedAt
      }
    };
  }

  private toVisibleReconnectRoleClaim(
    claim: ReconnectRoleClaimRecord,
    now: number
  ): VisibleReconnectRoleClaimRecord {
    if (!claim.instanceId) {
      return {
        claimStatus: "unclaimed",
        instanceId: null,
        lastHeartbeatAt: null
      };
    }

    if (
      claim.lastHeartbeatAt !== null &&
      claim.lastHeartbeatAt + this.reconnectControlSessionOptions.heartbeatTimeoutMs <= now
    ) {
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
  }

  private assertActiveReconnectControlSession(
    session: ReconnectControlSessionRecord,
    now: number
  ): ReconnectControlSessionRecord {
    if (session.expiresAt <= now) {
      throw new SignalingSessionExpiredError("That reconnect control session has expired.");
    }

    return session;
  }

  private getReconnectRoleBySecret(
    session: ReconnectControlSessionRecord,
    secret: string
  ): ReconnectControlRole {
    if (session.host.secret === secret) {
      return "host";
    }

    if (session.guest.secret === secret) {
      return "guest";
    }

    throw new SignalingSessionForbiddenError(
      "That reconnect secret is not valid for this control session."
    );
  }

  private getReconnectRoleClaim(
    session: ReconnectControlSessionRecord,
    role: ReconnectControlRole
  ): ReconnectRoleClaimRecord {
    return role === "host" ? session.host : session.guest;
  }

  private withUpdatedReconnectRoleClaim(
    session: ReconnectControlSessionRecord,
    role: ReconnectControlRole,
    claim: ReconnectRoleClaimRecord
  ): ReconnectControlSessionRecord {
    return role === "host"
      ? {
          ...session,
          host: claim
        }
      : {
          ...session,
          guest: claim
        };
  }

  private withReconnectAttemptReconciledForRoleReplacement(
    session: ReconnectControlSessionRecord,
    role: ReconnectControlRole
  ): ReconnectControlSessionRecord {
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
  }

  private withRefreshedReconnectControlSessionExpiry(
    session: ReconnectControlSessionRecord,
    now: number
  ): ReconnectControlSessionRecord {
    return {
      ...session,
      expiresAt: now + this.reconnectControlSessionOptions.sessionTtlSeconds * 1000
    };
  }

  private assertReconnectRoleSecret(
    session: ReconnectControlSessionRecord,
    role: ReconnectControlRole,
    secret: string
  ): void {
    if (this.getReconnectRoleClaim(session, role).secret !== secret) {
      throw new SignalingSessionForbiddenError(
        "That reconnect secret is not valid for this control session."
      );
    }
  }

  private assertReconnectRoleAccess(
    session: ReconnectControlSessionRecord,
    role: ReconnectControlRole,
    secret: string,
    instanceId: string
  ): ReconnectRoleClaimRecord {
    this.assertReconnectRoleSecret(session, role, secret);

    const claim = this.getReconnectRoleClaim(session, role);

    if (claim.instanceId !== instanceId) {
      throw new SignalingSessionForbiddenError(
        "That reconnect instance is not the active claimant for this role."
      );
    }

    return claim;
  }
}
