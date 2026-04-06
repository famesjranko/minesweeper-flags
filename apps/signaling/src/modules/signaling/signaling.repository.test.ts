import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignalingRedisClient } from "../../state/redis-client.js";
import {
  REDIS_EXPIRED_SESSION_GRACE_SECONDS,
  RedisSignalingRepository
} from "./signaling.repository.js";
import { SignalingService } from "./signaling.service.js";

const offer = {
  protocolVersion: 1 as const,
  mode: "p2p" as const,
  role: "host" as const,
  sdp: "offer-sdp",
  timestamp: 1000
};

const answer = {
  protocolVersion: 1 as const,
  mode: "p2p" as const,
  role: "guest" as const,
  sdp: "answer-sdp",
  timestamp: 2000,
  displayName: "Guest"
};

const reconnectOffer = {
  protocolVersion: 1 as const,
  mode: "p2p-reconnect" as const,
  role: "host" as const,
  sdp: "reconnect-offer-sdp",
  timestamp: 3000
};

const reconnectAnswer = {
  protocolVersion: 1 as const,
  mode: "p2p-reconnect" as const,
  role: "guest" as const,
  sdp: "reconnect-answer-sdp",
  timestamp: 4000
};

class FakeExpiringRedisClient implements SignalingRedisClient {
  private readonly values = new Map<string, string>();
  private readonly expiresAt = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    this.evictExpired(key);
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { expireInSeconds?: number; onlyIfAbsent?: boolean }
  ): Promise<boolean> {
    this.evictExpired(key);

    if (options?.onlyIfAbsent && this.values.has(key)) {
      return false;
    }

    this.values.set(key, value);

    if (options?.expireInSeconds) {
      this.expiresAt.set(key, Date.now() + options.expireInSeconds * 1000);
    } else {
      this.expiresAt.delete(key);
    }

    return true;
  }

  async compareAndSwap(
    key: string,
    expectedValue: string,
    nextValue: string,
    options?: { expireInSeconds?: number }
  ): Promise<boolean> {
    this.evictExpired(key);

    if ((this.values.get(key) ?? null) !== expectedValue) {
      return false;
    }

    this.values.set(key, nextValue);

    if (options?.expireInSeconds) {
      this.expiresAt.set(key, Date.now() + options.expireInSeconds * 1000);
    } else {
      this.expiresAt.delete(key);
    }

    return true;
  }

  async del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let deleted = 0;

    for (const currentKey of keys) {
      this.evictExpired(currentKey);

      if (this.values.delete(currentKey)) {
        this.expiresAt.delete(currentKey);
        deleted += 1;
      }
    }

    return deleted;
  }

  async close(): Promise<void> {}

  private evictExpired(key: string): void {
    const expiresAt = this.expiresAt.get(key);

    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.expiresAt.delete(key);
      this.values.delete(key);
    }
  }
}

describe("redis signaling repository", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps expired sessions readable through the grace window, then drops them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const repository = new RedisSignalingRepository(new FakeExpiringRedisClient(), "test-signaling", 2);
    const service = new SignalingService(repository, {
      sessionTtlSeconds: 1,
      reconnectControlSession: {
        sessionTtlSeconds: 1,
        heartbeatTimeoutMs: 5_000
      }
    });

    const created = await service.createSession({ offer }, 10_000);

    vi.setSystemTime(11_500);

    await expect(service.getSession(created.sessionId, 11_500)).resolves.toMatchObject({
      sessionId: created.sessionId,
      state: "expired"
    });

    await expect(service.getAnswer(created.sessionId, created.hostSecret, 11_500)).resolves.toMatchObject({
      sessionId: created.sessionId,
      state: "expired",
      answer: null
    });

    await expect(service.submitAnswer(created.sessionId, { answer }, 11_500)).rejects.toThrow(
      "That direct-match link has expired."
    );

    vi.setSystemTime(13_100);

    await expect(service.getSession(created.sessionId, 13_100)).rejects.toThrow(
      "That direct-match link is no longer valid."
    );
  });

  it("uses active ttl plus grace for create and compare-and-swap updates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);

    const redis = new FakeExpiringRedisClient();
    const repository = new RedisSignalingRepository(redis, "test-signaling");
    const session = {
      sessionId: "session-1",
      hostSecret: "secret",
      offer,
      answer: null,
      state: "open" as const,
      createdAt: 20_000,
      expiresAt: 24_500
    };

    await expect(repository.create(session)).resolves.toBe(true);
    vi.setSystemTime(84_499);
    await expect(repository.getBySessionId(session.sessionId)).resolves.toBeDefined();

    vi.setSystemTime(85_001);
    await expect(repository.getBySessionId(session.sessionId)).resolves.toBeUndefined();

    vi.setSystemTime(20_000);

    const previousSession = {
      ...session,
      sessionId: "session-2"
    };

    await repository.create(previousSession);

    const nextSession = {
      ...previousSession,
      answer,
      state: "answered" as const
    };

    await expect(repository.saveIfUnchanged(previousSession, nextSession)).resolves.toBe(true);
    await expect(repository.saveIfUnchanged(previousSession, nextSession)).resolves.toBe(false);

    vi.setSystemTime(84_499);
    await expect(repository.getBySessionId(nextSession.sessionId)).resolves.toMatchObject({
      state: "answered",
      answer
    });
  });

  it("exports the default redis grace window constant", () => {
    expect(REDIS_EXPIRED_SESSION_GRACE_SECONDS).toBe(60);
  });

  it("persists and updates reconnect control sessions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(30_000);

    const repository = new RedisSignalingRepository(new FakeExpiringRedisClient(), "test-signaling");
    const service = new SignalingService(repository, {
      sessionTtlSeconds: 60,
      reconnectControlSession: {
        sessionTtlSeconds: 60,
        heartbeatTimeoutMs: 5_000
      }
    });

    await expect(
      service.registerReconnectControlSession(
        {
          sessionId: "reconnect-redis",
          hostSecret: "host-secret",
          guestSecret: "guest-secret"
        },
        30_000
      )
    ).resolves.toMatchObject({
      sessionId: "reconnect-redis",
      attempt: {
        status: "idle"
      }
    });

    await expect(
      repository.getReconnectControlSessionBySessionId("reconnect-redis")
    ).resolves.toMatchObject({
      sessionId: "reconnect-redis",
      state: "open",
      host: {
        secret: "host-secret"
      },
      guest: {
        secret: "guest-secret"
      }
    });

    await service.claimReconnectRole(
      "reconnect-redis",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      30_100
    );
    await service.claimReconnectRole(
      "reconnect-redis",
      {
        role: "guest",
        secret: "guest-secret",
        instanceId: "guest-instance-1"
      },
      30_200
    );
    await service.writeReconnectOffer(
      "reconnect-redis",
      {
        secret: "host-secret",
        instanceId: "host-instance-1",
        offer: reconnectOffer
      },
      30_300
    );
    await service.writeReconnectAnswer(
      "reconnect-redis",
      {
        secret: "guest-secret",
        instanceId: "guest-instance-1",
        answer: reconnectAnswer
      },
      30_400
    );

    await expect(
      repository.getReconnectControlSessionBySessionId("reconnect-redis")
    ).resolves.toMatchObject({
      attempt: {
        status: "answer-ready",
        offer: reconnectOffer,
        answer: reconnectAnswer
      },
      host: {
        instanceId: "host-instance-1",
        lastHeartbeatAt: 30_100
      },
      guest: {
        instanceId: "guest-instance-1",
        lastHeartbeatAt: 30_200
      }
    });

    vi.setSystemTime(90_500);

    await expect(
      repository.getReconnectControlSessionBySessionId("reconnect-redis")
    ).resolves.toBeDefined();

    vi.setSystemTime(92_001);

    await expect(
      repository.getReconnectControlSessionBySessionId("reconnect-redis")
    ).resolves.toBeUndefined();
  });

  it("keeps redis reconnect control sessions alive when heartbeats refresh expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(40_000);

    const repository = new RedisSignalingRepository(new FakeExpiringRedisClient(), "test-signaling");
    const service = new SignalingService(repository, {
      sessionTtlSeconds: 1,
      reconnectControlSession: {
        sessionTtlSeconds: 1,
        heartbeatTimeoutMs: 5_000
      }
    });

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-sliding-redis",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      40_000
    );

    await service.claimReconnectRole(
      "reconnect-sliding-redis",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      40_100
    );

    vi.setSystemTime(40_900);

    await service.heartbeatReconnectRole(
      "reconnect-sliding-redis",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      40_900
    );

    vi.setSystemTime(41_500);

    await expect(repository.getReconnectControlSessionBySessionId("reconnect-sliding-redis")).resolves.toMatchObject({
      sessionId: "reconnect-sliding-redis",
      expiresAt: 41_900,
      host: {
        instanceId: "host-instance-1",
        lastHeartbeatAt: 40_900
      }
    });

    vi.setSystemTime(42_899);

    await expect(repository.getReconnectControlSessionBySessionId("reconnect-sliding-redis")).resolves.toBeDefined();

    vi.setSystemTime(42_901);

    await expect(repository.getReconnectControlSessionBySessionId("reconnect-sliding-redis")).resolves.toBeUndefined();
  });
});
