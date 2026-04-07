import { describe, expect, it } from "vitest";
import type { SignalingRedisClient } from "../../state/redis-client.js";
import {
  InMemorySignalingRepository,
  RedisSignalingRepository,
  type SignalingRepository
} from "./signaling.repository.js";
import { SignalingService } from "./signaling.service.js";
import {
  SignalingSessionConflictError,
  SignalingSessionExpiredError,
  SignalingSessionForbiddenError
} from "./signaling.types.js";

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

class FakeRedisClient implements SignalingRedisClient {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { expireInSeconds?: number; onlyIfAbsent?: boolean }
  ): Promise<boolean> {
    if (options?.onlyIfAbsent && this.values.has(key)) {
      return false;
    }

    this.values.set(key, value);
    return true;
  }

  async compareAndSwap(
    key: string,
    expectedValue: string,
    nextValue: string
  ): Promise<boolean> {
    const currentValue = this.values.get(key) ?? null;

    if (currentValue !== expectedValue) {
      return false;
    }

    this.values.set(key, nextValue);
    return true;
  }

  async del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let deleted = 0;

    for (const currentKey of keys) {
      if (this.values.delete(currentKey)) {
        deleted += 1;
      }
    }

    return deleted;
  }

  async close(): Promise<void> {}
}

const createService = (repository: SignalingRepository, sessionTtlSeconds = 60): SignalingService =>
  new SignalingService(repository, {
    sessionTtlSeconds,
    reconnectControlSession: {
      sessionTtlSeconds,
      heartbeatTimeoutMs: 5_000
    }
  });

describe.each([
  {
    name: "memory",
    createRepository: () => new InMemorySignalingRepository()
  },
  {
    name: "redis",
    createRepository: () => new RedisSignalingRepository(new FakeRedisClient(), "test-signaling")
  }
])("signaling service with $name repository", ({ createRepository }) => {
  it("emits session ids with at least 128 bits of entropy", async () => {
    const service = createService(createRepository());
    const createdSession = await service.createSession({ offer }, 1_000);

    // randomBytes(16).toString("base64url") yields 22 characters of unpadded
    // base64url, encoding 128 bits of entropy. Catches accidental regressions
    // that would shorten the session id (e.g. randomBytes(9) → 12 chars).
    expect(createdSession.sessionId.length).toBeGreaterThanOrEqual(22);
  });

  it("creates, answers, and finalizes a signaling session", async () => {
    const service = createService(createRepository());
    const createdSession = await service.createSession({ offer }, 1_000);

    expect(createdSession.offer).toEqual(offer);
    expect(createdSession.state).toBe("open");
    expect(createdSession.hostSecret.length).toBeGreaterThan(10);

    await expect(service.getAnswer(createdSession.sessionId, "wrong-secret", 1_001)).rejects.toBeInstanceOf(
      SignalingSessionForbiddenError
    );

    expect(await service.getSession(createdSession.sessionId, 1_001)).toMatchObject({
      sessionId: createdSession.sessionId,
      state: "open",
      offer
    });

    expect(await service.getAnswer(createdSession.sessionId, createdSession.hostSecret, 1_001)).toMatchObject({
      sessionId: createdSession.sessionId,
      state: "open",
      answer: null
    });

    expect(await service.submitAnswer(createdSession.sessionId, { answer }, 1_002)).toMatchObject({
      sessionId: createdSession.sessionId,
      state: "answered",
      answer
    });

    await expect(service.submitAnswer(createdSession.sessionId, { answer }, 1_003)).rejects.toBeInstanceOf(
      SignalingSessionConflictError
    );

    expect(await service.getAnswer(createdSession.sessionId, createdSession.hostSecret, 1_003)).toMatchObject({
      sessionId: createdSession.sessionId,
      state: "answered",
      answer
    });

    await expect(
      service.finalizeSession(createdSession.sessionId, "wrong-secret", 1_004)
    ).rejects.toBeInstanceOf(SignalingSessionForbiddenError);

    expect(
      await service.finalizeSession(createdSession.sessionId, createdSession.hostSecret, 1_004)
    ).toMatchObject({
      sessionId: createdSession.sessionId,
      state: "finalized"
    });

    expect(await service.getFinalization(createdSession.sessionId, 1_005)).toMatchObject({
      sessionId: createdSession.sessionId,
      state: "finalized"
    });
  });

  it("surfaces expired state for polling reads and rejects expired writes", async () => {
    const service = createService(createRepository(), 1);
    const createdSession = await service.createSession({ offer }, 10_000);

    expect(await service.getSession(createdSession.sessionId, 11_500)).toMatchObject({
      sessionId: createdSession.sessionId,
      state: "expired"
    });

    expect(
      await service.getAnswer(createdSession.sessionId, createdSession.hostSecret, 11_500)
    ).toMatchObject({
      sessionId: createdSession.sessionId,
      state: "expired",
      answer: null
    });

    expect(await service.getFinalization(createdSession.sessionId, 11_500)).toMatchObject({
      sessionId: createdSession.sessionId,
      state: "expired"
    });

    await expect(service.submitAnswer(createdSession.sessionId, { answer }, 11_500)).rejects.toBeInstanceOf(
      SignalingSessionExpiredError
    );
  });

  it("keeps first-answer-wins semantics when the stored session changes during submit", async () => {
    const repository = createRepository();
    const service = createService(repository);
    const createdSession = await service.createSession({ offer }, 1_000);
    const storedSession = await repository.getBySessionId(createdSession.sessionId);

    if (!storedSession) {
      throw new Error("Expected the stored signaling session.");
    }

    const competingAnswer = {
      ...answer,
      displayName: "Other Guest"
    };

    await repository.save({
      ...storedSession,
      answer: competingAnswer,
      state: "answered"
    });

    await expect(service.submitAnswer(createdSession.sessionId, { answer }, 1_001)).rejects.toBeInstanceOf(
      SignalingSessionConflictError
    );
  });

  it("registers and reads a reconnect control session", async () => {
    const service = createService(createRepository());

    const created = await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-1",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    expect(created).toMatchObject({
      sessionId: "reconnect-1",
      state: "open",
      host: {
        claimStatus: "unclaimed",
        instanceId: null,
        lastHeartbeatAt: null
      },
      guest: {
        claimStatus: "unclaimed",
        instanceId: null,
        lastHeartbeatAt: null
      },
      attempt: {
        status: "idle"
      }
    });

    await expect(service.getReconnectControlSession("reconnect-1", 1_001)).resolves.toMatchObject({
      sessionId: "reconnect-1",
      state: "open",
      attempt: {
        status: "idle"
      }
    });
  });

  it("claims reconnect roles and updates heartbeats", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-claim",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await expect(
      service.claimReconnectRole(
        "reconnect-claim",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-1"
        },
        1_100
      )
    ).resolves.toMatchObject({
      host: {
        claimStatus: "claimed",
        instanceId: "host-instance-1",
        lastHeartbeatAt: 1_100
      }
    });

    await expect(
      service.heartbeatReconnectRole(
        "reconnect-claim",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-1"
        },
        1_200
      )
    ).resolves.toMatchObject({
      host: {
        claimStatus: "claimed",
        instanceId: "host-instance-1",
        lastHeartbeatAt: 1_200
      }
    });

    await expect(
      service.heartbeatReconnectRole(
        "reconnect-claim",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-2"
        },
        1_300
      )
    ).rejects.toBeInstanceOf(SignalingSessionForbiddenError);
  });

  it("displaces the previous reconnect claimant when the same role is reclaimed by a newer instance", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-displace",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await service.claimReconnectRole(
      "reconnect-displace",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      1_100
    );

    await expect(
      service.claimReconnectRole(
        "reconnect-displace",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-2"
        },
        1_200
      )
    ).resolves.toMatchObject({
      host: {
        claimStatus: "claimed",
        instanceId: "host-instance-2",
        lastHeartbeatAt: 1_200
      }
    });

    await expect(
      service.heartbeatReconnectRole(
        "reconnect-displace",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-1"
        },
        1_201
      )
    ).rejects.toBeInstanceOf(SignalingSessionForbiddenError);

    await expect(
      service.readReconnectControlSession("reconnect-displace", "host-secret", "host-instance-2", 1_202)
    ).resolves.toMatchObject({
      host: {
        claimStatus: "claimed",
        instanceId: "host-instance-2"
      }
    });
  });

  it("extends reconnect control expiry while heartbeats continue", async () => {
    const service = createService(createRepository(), 1);

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-sliding-ttl",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await expect(
      service.claimReconnectRole(
        "reconnect-sliding-ttl",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-1"
        },
        1_100
      )
    ).resolves.toMatchObject({
      state: "open",
      expiresAt: 2_100,
      host: {
        claimStatus: "claimed",
        lastHeartbeatAt: 1_100
      }
    });

    await expect(
      service.heartbeatReconnectRole(
        "reconnect-sliding-ttl",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-1"
        },
        1_900
      )
    ).resolves.toMatchObject({
      state: "open",
      expiresAt: 2_900,
      host: {
        claimStatus: "claimed",
        lastHeartbeatAt: 1_900
      }
    });

    await expect(service.getReconnectControlSession("reconnect-sliding-ttl", 2_050)).resolves.toMatchObject({
      state: "open",
      expiresAt: 2_900,
      host: {
        claimStatus: "claimed",
        lastHeartbeatAt: 1_900
      }
    });

    await expect(service.getReconnectControlSession("reconnect-sliding-ttl", 2_950)).resolves.toMatchObject({
      state: "expired",
      expiresAt: 2_900
    });
  });

  it("surfaces stale reconnect claims after the heartbeat timeout", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-stale",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await service.claimReconnectRole(
      "reconnect-stale",
      {
        role: "guest",
        secret: "guest-secret",
        instanceId: "guest-instance-1"
      },
      1_100
    );

    await expect(service.getReconnectControlSession("reconnect-stale", 6_100)).resolves.toMatchObject({
      guest: {
        claimStatus: "stale",
        instanceId: "guest-instance-1",
        lastHeartbeatAt: 1_100
      }
    });
  });

  it("resets reconnect answer and finalization metadata when writing a new host offer", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-reset",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await service.claimReconnectRole(
      "reconnect-reset",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      1_100
    );
    await service.claimReconnectRole(
      "reconnect-reset",
      {
        role: "guest",
        secret: "guest-secret",
        instanceId: "guest-instance-1"
      },
      1_101
    );
    await service.writeReconnectOffer(
      "reconnect-reset",
      {
        secret: "host-secret",
        instanceId: "host-instance-1",
        offer: reconnectOffer
      },
      1_200
    );
    await service.writeReconnectAnswer(
      "reconnect-reset",
      {
        secret: "guest-secret",
        instanceId: "guest-instance-1",
        answer: reconnectAnswer
      },
      1_300
    );
    await service.finalizeReconnectAttempt(
      "reconnect-reset",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1",
        outcome: "reconnected"
      },
      1_400
    );

    await expect(
      service.writeReconnectOffer(
        "reconnect-reset",
        {
          secret: "host-secret",
          instanceId: "host-instance-1",
          offer: {
            ...reconnectOffer,
            sdp: "reconnect-offer-sdp-2",
            timestamp: 5000
          }
        },
        1_500
      )
    ).resolves.toMatchObject({
      state: "open",
      attempt: {
        status: "offer-ready",
        finalizationOutcome: null,
        finalizedBy: null,
        finalizedAt: null
      }
    });

    await expect(
      service.readReconnectAnswer("reconnect-reset", "host-secret", "host-instance-1", 1_501)
    ).resolves.toMatchObject({
      answer: null,
      attempt: {
        status: "offer-ready"
      }
    });
  });

  it("drops an in-flight host reconnect attempt when a newer host claim replaces it", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-host-replace",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await service.claimReconnectRole(
      "reconnect-host-replace",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      1_100
    );
    await service.claimReconnectRole(
      "reconnect-host-replace",
      {
        role: "guest",
        secret: "guest-secret",
        instanceId: "guest-instance-1"
      },
      1_101
    );
    await service.writeReconnectOffer(
      "reconnect-host-replace",
      {
        secret: "host-secret",
        instanceId: "host-instance-1",
        offer: reconnectOffer
      },
      1_200
    );

    await expect(
      service.claimReconnectRole(
        "reconnect-host-replace",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-2"
        },
        1_300
      )
    ).resolves.toMatchObject({
      host: {
        instanceId: "host-instance-2"
      },
      attempt: {
        status: "idle",
        finalizationOutcome: null,
        finalizedBy: null,
        finalizedAt: null
      }
    });

    await expect(
      service.readReconnectOffer("reconnect-host-replace", "guest-secret", "guest-instance-1", 1_301)
    ).resolves.toMatchObject({
      offer: null,
      attempt: {
        status: "idle"
      }
    });

    await expect(
      service.readReconnectAnswer("reconnect-host-replace", "host-secret", "host-instance-1", 1_302)
    ).rejects.toBeInstanceOf(SignalingSessionForbiddenError);
  });

  it("clears a stale guest answer when a newer guest claim replaces it", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-guest-replace",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await service.claimReconnectRole(
      "reconnect-guest-replace",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      1_100
    );
    await service.claimReconnectRole(
      "reconnect-guest-replace",
      {
        role: "guest",
        secret: "guest-secret",
        instanceId: "guest-instance-1"
      },
      1_101
    );
    await service.writeReconnectOffer(
      "reconnect-guest-replace",
      {
        secret: "host-secret",
        instanceId: "host-instance-1",
        offer: reconnectOffer
      },
      1_200
    );
    await service.writeReconnectAnswer(
      "reconnect-guest-replace",
      {
        secret: "guest-secret",
        instanceId: "guest-instance-1",
        answer: reconnectAnswer
      },
      1_250
    );

    await expect(
      service.claimReconnectRole(
        "reconnect-guest-replace",
        {
          role: "guest",
          secret: "guest-secret",
          instanceId: "guest-instance-2"
        },
        1_300
      )
    ).resolves.toMatchObject({
      guest: {
        instanceId: "guest-instance-2"
      },
      attempt: {
        status: "offer-ready",
        finalizationOutcome: null,
        finalizedBy: null,
        finalizedAt: null
      }
    });

    await expect(
      service.readReconnectAnswer("reconnect-guest-replace", "host-secret", "host-instance-1", 1_301)
    ).resolves.toMatchObject({
      answer: null,
      attempt: {
        status: "offer-ready"
      }
    });

    await expect(
      service.heartbeatReconnectRole(
        "reconnect-guest-replace",
        {
          role: "guest",
          secret: "guest-secret",
          instanceId: "guest-instance-1"
        },
        1_302
      )
    ).rejects.toBeInstanceOf(SignalingSessionForbiddenError);
  });

  it("rejects reconnect answers when no host offer is available", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-conflict",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await service.claimReconnectRole(
      "reconnect-conflict",
      {
        role: "guest",
        secret: "guest-secret",
        instanceId: "guest-instance-1"
      },
      1_100
    );

    await expect(
      service.writeReconnectAnswer(
        "reconnect-conflict",
        {
          secret: "guest-secret",
          instanceId: "guest-instance-1",
          answer: reconnectAnswer
        },
        1_200
      )
    ).rejects.toBeInstanceOf(SignalingSessionConflictError);
  });

  it("finalizes reconnect attempts with outcome and finalizing role", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-finalize",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await service.claimReconnectRole(
      "reconnect-finalize",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      1_050
    );
    await service.writeReconnectOffer(
      "reconnect-finalize",
      {
        secret: "host-secret",
        instanceId: "host-instance-1",
        offer: reconnectOffer
      },
      1_100
    );

    await expect(
      service.finalizeReconnectAttempt(
        "reconnect-finalize",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-1",
          outcome: "aborted"
        },
        1_200
      )
    ).resolves.toMatchObject({
      state: "finalized",
      attempt: {
        status: "finalized",
        finalizationOutcome: "aborted",
        finalizedBy: "host",
        finalizedAt: 1_200
      }
    });
  });

  it("supports repeated reconnect attempts on the same control session", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-repeat",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await service.claimReconnectRole(
      "reconnect-repeat",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      1_050
    );
    await service.claimReconnectRole(
      "reconnect-repeat",
      {
        role: "guest",
        secret: "guest-secret",
        instanceId: "guest-instance-1"
      },
      1_051
    );

    await service.writeReconnectOffer(
      "reconnect-repeat",
      {
        secret: "host-secret",
        instanceId: "host-instance-1",
        offer: reconnectOffer
      },
      1_100
    );
    await service.writeReconnectAnswer(
      "reconnect-repeat",
      {
        secret: "guest-secret",
        instanceId: "guest-instance-1",
        answer: reconnectAnswer
      },
      1_200
    );
    await service.finalizeReconnectAttempt(
      "reconnect-repeat",
      {
        role: "guest",
        secret: "guest-secret",
        instanceId: "guest-instance-1",
        outcome: "reconnected"
      },
      1_300
    );

    await service.claimReconnectRole(
      "reconnect-repeat",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-2"
      },
      1_400
    );

    await expect(
      service.writeReconnectOffer(
        "reconnect-repeat",
        {
          secret: "host-secret",
          instanceId: "host-instance-2",
          offer: {
            ...reconnectOffer,
            sdp: "reconnect-offer-second-attempt",
            timestamp: 6000
          }
        },
        1_500
      )
    ).resolves.toMatchObject({
      state: "open",
      host: {
        instanceId: "host-instance-2"
      },
      attempt: {
        status: "offer-ready",
        finalizationOutcome: null,
        finalizedBy: null,
        finalizedAt: null
      }
    });

    await expect(
      service.readReconnectOffer("reconnect-repeat", "guest-secret", "guest-instance-1", 1_501)
    ).resolves.toMatchObject({
      offer: {
        sdp: "reconnect-offer-second-attempt"
      }
    });
  });

  it("resets an aborted reconnect attempt to idle when a role is reclaimed on the same control session", async () => {
    const service = createService(createRepository());

    await service.registerReconnectControlSession(
      {
        sessionId: "reconnect-aborted-retry",
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      },
      1_000
    );

    await service.claimReconnectRole(
      "reconnect-aborted-retry",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1"
      },
      1_050
    );
    await service.claimReconnectRole(
      "reconnect-aborted-retry",
      {
        role: "guest",
        secret: "guest-secret",
        instanceId: "guest-instance-1"
      },
      1_051
    );
    await service.writeReconnectOffer(
      "reconnect-aborted-retry",
      {
        secret: "host-secret",
        instanceId: "host-instance-1",
        offer: reconnectOffer
      },
      1_100
    );
    await service.finalizeReconnectAttempt(
      "reconnect-aborted-retry",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-1",
        outcome: "aborted"
      },
      1_200
    );

    await expect(
      service.claimReconnectRole(
        "reconnect-aborted-retry",
        {
          role: "host",
          secret: "host-secret",
          instanceId: "host-instance-2"
        },
        1_300
      )
    ).resolves.toMatchObject({
      state: "open",
      attempt: {
        status: "idle",
        finalizationOutcome: null,
        finalizedBy: null,
        finalizedAt: null
      }
    });

    await expect(
      service.writeReconnectOffer(
        "reconnect-aborted-retry",
        {
          secret: "host-secret",
          instanceId: "host-instance-2",
          offer: {
            ...reconnectOffer,
            sdp: "reconnect-offer-after-abort",
            timestamp: 7000
          }
        },
        1_400
      )
    ).resolves.toMatchObject({
      state: "open",
      attempt: {
        status: "offer-ready",
        finalizationOutcome: null
      }
    });

    await service.finalizeReconnectAttempt(
      "reconnect-aborted-retry",
      {
        role: "host",
        secret: "host-secret",
        instanceId: "host-instance-2",
        outcome: "aborted"
      },
      1_500
    );

    await expect(
      service.claimReconnectRole(
        "reconnect-aborted-retry",
        {
          role: "guest",
          secret: "guest-secret",
          instanceId: "guest-instance-2"
        },
        1_600
      )
    ).resolves.toMatchObject({
      state: "open",
      attempt: {
        status: "idle",
        finalizationOutcome: null,
        finalizedBy: null,
        finalizedAt: null
      }
    });
  });
});
