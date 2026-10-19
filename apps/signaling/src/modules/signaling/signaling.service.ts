import { randomBytes } from "node:crypto";
import type {
  ClaimReconnectRoleRequest,
  ClaimReconnectRoleResponse,
  CreateSignalingSessionRequest,
  CreateSignalingSessionResponse,
  FinalizeReconnectAttemptRequest,
  FinalizeReconnectAttemptResponse,
  FinalizeSignalingSessionResponse,
  GetReconnectControlSessionResponse,
  GetReconnectFinalizationResponse,
  GetSignalingAnswerResponse,
  GetSignalingFinalizationResponse,
  GetSignalingSessionResponse,
  HeartbeatReconnectRoleRequest,
  HeartbeatReconnectRoleResponse,
  ReadReconnectAnswerResponse,
  ReadReconnectOfferResponse,
  RegisterReconnectControlSessionRequest,
  RegisterReconnectControlSessionResponse,
  SubmitSignalingAnswerRequest,
  SubmitSignalingAnswerResponse,
  WriteReconnectAnswerRequest,
  WriteReconnectAnswerResponse,
  WriteReconnectOfferRequest,
  WriteReconnectOfferResponse
} from "@minesweeper-flags/shared";
import { KeyedSerialTaskRunner } from "../../lib/async/keyed-serial-task-runner.js";
import {
  assertActiveReconnectControlSession,
  assertReconnectRoleAccess,
  assertReconnectRoleSecret,
  createReconnectAttempt,
  getReconnectRoleBySecret,
  getReconnectRoleClaim,
  toVisibleReconnectControlSession,
  withReconnectAttemptReconciledForRoleReplacement,
  withUpdatedReconnectRoleClaim
} from "./reconnect-control-session.js";
import type { SignalingRepository } from "./signaling.repository.js";
import {
  type ReconnectControlSessionRecord,
  SignalingSessionConflictError,
  SignalingSessionExpiredError,
  SignalingSessionForbiddenError,
  SignalingSessionNotFoundError,
  type SignalingSessionRecord,
  type VisibleReconnectControlSessionRecord
} from "./signaling.types.js";

const SESSION_CREATION_LOCK_KEY = "__signaling-session-create__";

const createSessionId = (): string => randomBytes(16).toString("base64url");

const createHostSecret = (): string => randomBytes(18).toString("base64url");

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
          throw new SignalingSessionConflictError(
            "That direct-match link already has a guest answer."
          );
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

      return this.toVisibleReconnectControlSession(session, now);
    });
  }

  async getReconnectControlSession(
    sessionId: string,
    now = Date.now()
  ): Promise<GetReconnectControlSessionResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    return this.toVisibleReconnectControlSession(session, now);
  }

  async readReconnectControlSession(
    sessionId: string,
    secret: string,
    instanceId: string,
    now = Date.now()
  ): Promise<GetReconnectControlSessionResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    const role = getReconnectRoleBySecret(session, secret);

    assertReconnectRoleAccess(session, role, secret, instanceId);

    return this.toVisibleReconnectControlSession(session, now);
  }

  async claimReconnectRole(
    sessionId: string,
    request: ClaimReconnectRoleRequest,
    now = Date.now()
  ): Promise<ClaimReconnectRoleResponse> {
    return await this.updateReconnectControlSession(sessionId, now, (session) => {
      assertReconnectRoleSecret(session, request.role, request.secret);
      const previousClaim = getReconnectRoleClaim(session, request.role);
      const isSameRoleReplacement =
        previousClaim.instanceId !== null && previousClaim.instanceId !== request.instanceId;

      const updatedSession = withUpdatedReconnectRoleClaim(session, request.role, {
        secret: previousClaim.secret,
        instanceId: request.instanceId,
        lastHeartbeatAt: now
      });

      return isSameRoleReplacement
        ? withReconnectAttemptReconciledForRoleReplacement(updatedSession, request.role)
        : updatedSession;
    });
  }

  async heartbeatReconnectRole(
    sessionId: string,
    request: HeartbeatReconnectRoleRequest,
    now = Date.now()
  ): Promise<HeartbeatReconnectRoleResponse> {
    return await this.updateReconnectControlSession(sessionId, now, (session) => {
      const claim = assertReconnectRoleAccess(
        session,
        request.role,
        request.secret,
        request.instanceId
      );

      return withUpdatedReconnectRoleClaim(session, request.role, {
        ...claim,
        lastHeartbeatAt: now
      });
    });
  }

  async writeReconnectOffer(
    sessionId: string,
    request: WriteReconnectOfferRequest,
    now = Date.now()
  ): Promise<WriteReconnectOfferResponse> {
    return await this.updateReconnectControlSession(sessionId, now, (session) => {
      assertReconnectRoleAccess(session, "host", request.secret, request.instanceId);

      return {
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
    });
  }

  async readReconnectOffer(
    sessionId: string,
    secret: string,
    instanceId: string,
    now = Date.now()
  ): Promise<ReadReconnectOfferResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    const role = getReconnectRoleBySecret(session, secret);

    assertReconnectRoleAccess(session, role, secret, instanceId);

    return {
      ...this.toVisibleReconnectControlSession(session, now),
      offer: session.attempt.offer
    };
  }

  async writeReconnectAnswer(
    sessionId: string,
    request: WriteReconnectAnswerRequest,
    now = Date.now()
  ): Promise<WriteReconnectAnswerResponse> {
    return await this.updateReconnectControlSession(sessionId, now, (session) => {
      assertReconnectRoleAccess(session, "guest", request.secret, request.instanceId);

      if (!session.attempt.offer || session.attempt.status !== "offer-ready") {
        throw new SignalingSessionConflictError(
          "That reconnect attempt is not ready for a guest answer."
        );
      }

      return {
        ...session,
        attempt: {
          ...session.attempt,
          status: "answer-ready",
          answer: request.answer
        }
      };
    });
  }

  async readReconnectAnswer(
    sessionId: string,
    secret: string,
    instanceId: string,
    now = Date.now()
  ): Promise<ReadReconnectAnswerResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    const role = getReconnectRoleBySecret(session, secret);

    assertReconnectRoleAccess(session, role, secret, instanceId);

    return {
      ...this.toVisibleReconnectControlSession(session, now),
      answer: session.attempt.answer
    };
  }

  async finalizeReconnectAttempt(
    sessionId: string,
    request: FinalizeReconnectAttemptRequest,
    now = Date.now()
  ): Promise<FinalizeReconnectAttemptResponse> {
    return await this.updateReconnectControlSession(sessionId, now, (session) => {
      assertReconnectRoleAccess(session, request.role, request.secret, request.instanceId);

      if (session.attempt.status === "idle") {
        throw new SignalingSessionConflictError("That reconnect attempt has not started yet.");
      }

      if (session.attempt.status === "finalized") {
        return session;
      }

      return {
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
    });
  }

  async getReconnectFinalization(
    sessionId: string,
    now = Date.now()
  ): Promise<GetReconnectFinalizationResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    return this.toVisibleReconnectControlSession(session, now);
  }

  async readReconnectFinalization(
    sessionId: string,
    secret: string,
    instanceId: string,
    now = Date.now()
  ): Promise<GetReconnectFinalizationResponse> {
    const session = await this.getReconnectControlSessionOrThrow(sessionId);
    const role = getReconnectRoleBySecret(session, secret);

    assertReconnectRoleAccess(session, role, secret, instanceId);

    return this.toVisibleReconnectControlSession(session, now);
  }

  /**
   * Applies `update` to the active record under the session's task lock and saves it
   * with compare-and-swap, retrying when a concurrent write wins. A saved update also
   * extends the session's expiry. Returning the record unchanged skips the save.
   */
  private async updateReconnectControlSession(
    sessionId: string,
    now: number,
    update: (session: ReconnectControlSessionRecord) => ReconnectControlSessionRecord
  ): Promise<VisibleReconnectControlSessionRecord> {
    return await this.taskRunner.run(sessionId, async () => {
      while (true) {
        const session = assertActiveReconnectControlSession(
          await this.getReconnectControlSessionOrThrow(sessionId),
          now
        );
        const updatedSession = update(session);

        if (updatedSession === session) {
          return this.toVisibleReconnectControlSession(session, now);
        }

        const refreshedSession = this.withRefreshedReconnectControlSessionExpiry(
          updatedSession,
          now
        );

        if (
          !(await this.repository.saveReconnectControlSessionIfUnchanged(session, refreshedSession))
        ) {
          continue;
        }

        return this.toVisibleReconnectControlSession(refreshedSession, now);
      }
    });
  }

  private toVisibleReconnectControlSession(
    session: ReconnectControlSessionRecord,
    now: number
  ): VisibleReconnectControlSessionRecord {
    return toVisibleReconnectControlSession(
      session,
      now,
      this.reconnectControlSessionOptions.heartbeatTimeoutMs
    );
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

  private assertActiveSession(
    session: SignalingSessionRecord,
    now: number
  ): SignalingSessionRecord {
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

  private withRefreshedReconnectControlSessionExpiry(
    session: ReconnectControlSessionRecord,
    now: number
  ): ReconnectControlSessionRecord {
    return {
      ...session,
      expiresAt: now + this.reconnectControlSessionOptions.sessionTtlSeconds * 1000
    };
  }
}
