import type { SignalingRedisClient } from "../../state/redis-client.js";
import type {
  ReconnectControlSessionRecord,
  SignalingSessionRecord
} from "./signaling.types.js";

export const REDIS_EXPIRED_SESSION_GRACE_SECONDS = 60;

const getSessionTtlSeconds = (
  session: SignalingSessionRecord,
  now = Date.now(),
  graceSeconds = 0
): number => Math.max(1, Math.ceil((session.expiresAt - now) / 1000) + graceSeconds);

const serializeSession = (session: SignalingSessionRecord): string => JSON.stringify(session);

const deserializeSession = (value: string): SignalingSessionRecord =>
  JSON.parse(value) as SignalingSessionRecord;

const getReconnectControlSessionTtlSeconds = (
  session: ReconnectControlSessionRecord,
  now = Date.now(),
  graceSeconds = 0
): number => Math.max(1, Math.ceil((session.expiresAt - now) / 1000) + graceSeconds);

const serializeReconnectControlSession = (session: ReconnectControlSessionRecord): string =>
  JSON.stringify(session);

const deserializeReconnectControlSession = (value: string): ReconnectControlSessionRecord =>
  JSON.parse(value) as ReconnectControlSessionRecord;

export interface SignalingRepository {
  create(session: SignalingSessionRecord): Promise<boolean>;
  getBySessionId(sessionId: string): Promise<SignalingSessionRecord | undefined>;
  save(session: SignalingSessionRecord): Promise<void>;
  saveIfUnchanged(previousSession: SignalingSessionRecord, nextSession: SignalingSessionRecord): Promise<boolean>;
  createReconnectControlSession(session: ReconnectControlSessionRecord): Promise<boolean>;
  getReconnectControlSessionBySessionId(
    sessionId: string
  ): Promise<ReconnectControlSessionRecord | undefined>;
  saveReconnectControlSession(session: ReconnectControlSessionRecord): Promise<void>;
  saveReconnectControlSessionIfUnchanged(
    previousSession: ReconnectControlSessionRecord,
    nextSession: ReconnectControlSessionRecord
  ): Promise<boolean>;
}

export class InMemorySignalingRepository implements SignalingRepository {
  private readonly sessionsById = new Map<string, SignalingSessionRecord>();
  private readonly reconnectControlSessionsById = new Map<string, ReconnectControlSessionRecord>();

  async create(session: SignalingSessionRecord): Promise<boolean> {
    if (this.sessionsById.has(session.sessionId)) {
      return false;
    }

    this.sessionsById.set(session.sessionId, session);
    return true;
  }

  async getBySessionId(sessionId: string): Promise<SignalingSessionRecord | undefined> {
    return this.sessionsById.get(sessionId);
  }

  async save(session: SignalingSessionRecord): Promise<void> {
    this.sessionsById.set(session.sessionId, session);
  }

  async saveIfUnchanged(
    previousSession: SignalingSessionRecord,
    nextSession: SignalingSessionRecord
  ): Promise<boolean> {
    const currentSession = this.sessionsById.get(previousSession.sessionId);

    if (!currentSession || serializeSession(currentSession) !== serializeSession(previousSession)) {
      return false;
    }

    this.sessionsById.set(nextSession.sessionId, nextSession);
    return true;
  }

  async createReconnectControlSession(session: ReconnectControlSessionRecord): Promise<boolean> {
    if (this.reconnectControlSessionsById.has(session.sessionId)) {
      return false;
    }

    this.reconnectControlSessionsById.set(session.sessionId, session);
    return true;
  }

  async getReconnectControlSessionBySessionId(
    sessionId: string
  ): Promise<ReconnectControlSessionRecord | undefined> {
    return this.reconnectControlSessionsById.get(sessionId);
  }

  async saveReconnectControlSession(session: ReconnectControlSessionRecord): Promise<void> {
    this.reconnectControlSessionsById.set(session.sessionId, session);
  }

  async saveReconnectControlSessionIfUnchanged(
    previousSession: ReconnectControlSessionRecord,
    nextSession: ReconnectControlSessionRecord
  ): Promise<boolean> {
    const currentSession = this.reconnectControlSessionsById.get(previousSession.sessionId);

    if (
      !currentSession ||
      serializeReconnectControlSession(currentSession) !== serializeReconnectControlSession(previousSession)
    ) {
      return false;
    }

    this.reconnectControlSessionsById.set(nextSession.sessionId, nextSession);
    return true;
  }
}

export class RedisSignalingRepository implements SignalingRepository {
  constructor(
    private readonly redis: SignalingRedisClient,
    private readonly keyPrefix: string,
    private readonly expiredSessionGraceSeconds = REDIS_EXPIRED_SESSION_GRACE_SECONDS,
    private readonly reconnectControlSessionGraceSeconds = 1
  ) {}

  async create(session: SignalingSessionRecord): Promise<boolean> {
    return await this.redis.set(this.sessionKey(session.sessionId), serializeSession(session), {
      expireInSeconds: getSessionTtlSeconds(session, Date.now(), this.expiredSessionGraceSeconds),
      onlyIfAbsent: true
    });
  }

  async getBySessionId(sessionId: string): Promise<SignalingSessionRecord | undefined> {
    const storedSession = await this.redis.get(this.sessionKey(sessionId));

    return storedSession ? deserializeSession(storedSession) : undefined;
  }

  async save(session: SignalingSessionRecord): Promise<void> {
    await this.redis.set(this.sessionKey(session.sessionId), serializeSession(session), {
      expireInSeconds: getSessionTtlSeconds(session, Date.now(), this.expiredSessionGraceSeconds)
    });
  }

  async saveIfUnchanged(
    previousSession: SignalingSessionRecord,
    nextSession: SignalingSessionRecord
  ): Promise<boolean> {
    return await this.redis.compareAndSwap(
      this.sessionKey(previousSession.sessionId),
      serializeSession(previousSession),
      serializeSession(nextSession),
      {
        expireInSeconds: getSessionTtlSeconds(
          nextSession,
          Date.now(),
          this.expiredSessionGraceSeconds
        )
      }
    );
  }

  async createReconnectControlSession(session: ReconnectControlSessionRecord): Promise<boolean> {
    return await this.redis.set(
      this.reconnectControlSessionKey(session.sessionId),
      serializeReconnectControlSession(session),
      {
        expireInSeconds: getReconnectControlSessionTtlSeconds(
          session,
          Date.now(),
          this.reconnectControlSessionGraceSeconds
        ),
        onlyIfAbsent: true
      }
    );
  }

  async getReconnectControlSessionBySessionId(
    sessionId: string
  ): Promise<ReconnectControlSessionRecord | undefined> {
    const storedSession = await this.redis.get(this.reconnectControlSessionKey(sessionId));

    return storedSession ? deserializeReconnectControlSession(storedSession) : undefined;
  }

  async saveReconnectControlSession(session: ReconnectControlSessionRecord): Promise<void> {
    await this.redis.set(
      this.reconnectControlSessionKey(session.sessionId),
      serializeReconnectControlSession(session),
      {
        expireInSeconds: getReconnectControlSessionTtlSeconds(
          session,
          Date.now(),
          this.reconnectControlSessionGraceSeconds
        )
      }
    );
  }

  async saveReconnectControlSessionIfUnchanged(
    previousSession: ReconnectControlSessionRecord,
    nextSession: ReconnectControlSessionRecord
  ): Promise<boolean> {
    return await this.redis.compareAndSwap(
      this.reconnectControlSessionKey(previousSession.sessionId),
      serializeReconnectControlSession(previousSession),
      serializeReconnectControlSession(nextSession),
      {
        expireInSeconds: getReconnectControlSessionTtlSeconds(
          nextSession,
          Date.now(),
          this.reconnectControlSessionGraceSeconds
        )
      }
    );
  }

  private sessionKey(sessionId: string): string {
    return `${this.keyPrefix}:sessions:${sessionId}`;
  }

  private reconnectControlSessionKey(sessionId: string): string {
    return `${this.keyPrefix}:reconnect-control-sessions:${sessionId}`;
  }
}
