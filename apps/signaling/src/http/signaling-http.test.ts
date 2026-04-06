import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSignalingServer, type SignalingServerController } from "./signaling.server.js";
import { InMemorySignalingRepository } from "../modules/signaling/signaling.repository.js";
import { SignalingService } from "../modules/signaling/signaling.service.js";

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

interface StartedTestServer {
  server: SignalingServerController;
  baseUrl: string;
}

const startServer = async (options?: {
  sessionTtlSeconds?: number;
  maxPayloadBytes?: number;
  allowedOrigins?: string[];
  createRateLimitMax?: number;
  answerRateLimitMax?: number;
  trustProxy?: boolean;
}): Promise<StartedTestServer> => {
  const service = new SignalingService(new InMemorySignalingRepository(), {
    sessionTtlSeconds: options?.sessionTtlSeconds ?? 60
  });
  const server = createSignalingServer({
    service,
    maxPayloadBytes: options?.maxPayloadBytes ?? 16 * 1024,
    trustProxy: options?.trustProxy ?? false,
    allowedOrigins: options?.allowedOrigins ?? [],
    createRateLimit: {
      maxEvents: options?.createRateLimitMax ?? 6,
      windowMs: 60_000
    },
    answerRateLimit: {
      maxEvents: options?.answerRateLimitMax ?? 12,
      windowMs: 60_000
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.httpServer.once("error", reject);
    server.httpServer.listen(0, "127.0.0.1", () => {
      server.httpServer.off("error", reject);
      resolve();
    });
  });

  server.markReady();

  const address = server.httpServer.address() as AddressInfo;

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
};

const requestJson = async (
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: any; headers: Headers }> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const bodyText = await response.text();

  return {
    status: response.status,
    body: bodyText ? (JSON.parse(bodyText) as unknown) : {},
    headers: response.headers
  };
};

describe("signaling http api", () => {
  let activeServer: SignalingServerController | undefined;

  afterEach(async () => {
    await activeServer?.shutdown();
    activeServer = undefined;
  });

  it("reports health and readiness", async () => {
    const { server, baseUrl } = await startServer();
    activeServer = server;

    expect(await requestJson(baseUrl, "/health", { method: "GET" })).toMatchObject({
      status: 200,
      body: { status: "ok" }
    });

    expect(await requestJson(baseUrl, "/ready", { method: "GET" })).toMatchObject({
      status: 200,
      body: { status: "ready" }
    });
  });

  it("completes the create, fetch, answer, poll, and finalize lifecycle", async () => {
    const { server, baseUrl } = await startServer();
    activeServer = server;

    const created = await requestJson(baseUrl, "/signaling/sessions", {
      method: "POST",
      body: JSON.stringify({ offer })
    });

    expect(created.status).toBe(201);
    expect(created.body.offer).toEqual(offer);
    expect(created.body.state).toBe("open");

    const sessionId = created.body.sessionId as string;
    const hostSecret = created.body.hostSecret as string;

    expect(await requestJson(baseUrl, `/signaling/sessions/${sessionId}`, { method: "GET" })).toMatchObject({
      status: 200,
      body: {
        sessionId,
        state: "open",
        offer
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/answer/read`, {
        method: "POST",
        body: JSON.stringify({ hostSecret })
      })
    ).toMatchObject({
      status: 200,
      body: {
        sessionId,
        state: "open",
        answer: null
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer })
      })
    ).toMatchObject({
      status: 200,
      body: {
        sessionId,
        state: "answered",
        answer
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/answer/read`, {
        method: "POST",
        body: JSON.stringify({ hostSecret })
      })
    ).toMatchObject({
      status: 200,
      body: {
        sessionId,
        state: "answered",
        answer
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ hostSecret })
      })
    ).toMatchObject({
      status: 200,
      body: {
        sessionId,
        state: "finalized"
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/finalization`, {
        method: "GET"
      })
    ).toMatchObject({
      status: 200,
      body: {
        sessionId,
        state: "finalized"
      }
    });
  });

  it("completes the reconnect register, claim, exchange, and finalize lifecycle", async () => {
    const { server, baseUrl } = await startServer();
    activeServer = server;

    const sessionId = "reconnect-http-lifecycle";
    const hostSecret = "host-secret";
    const guestSecret = "guest-secret";
    const hostInstanceId = "host-instance-1";
    const guestInstanceId = "guest-instance-1";

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/register`, {
        method: "POST",
        body: JSON.stringify({ sessionId, hostSecret, guestSecret })
      })
    ).toMatchObject({
      status: 201,
      body: {
        sessionId,
        state: "open",
        attempt: {
          status: "idle"
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/claim`, {
        method: "POST",
        body: JSON.stringify({ role: "host", secret: hostSecret, instanceId: hostInstanceId })
      })
    ).toMatchObject({
      status: 200,
      body: {
        host: {
          claimStatus: "claimed",
          instanceId: hostInstanceId
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/claim`, {
        method: "POST",
        body: JSON.stringify({ role: "guest", secret: guestSecret, instanceId: guestInstanceId })
      })
    ).toMatchObject({
      status: 200,
      body: {
        guest: {
          claimStatus: "claimed",
          instanceId: guestInstanceId
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/read`, {
        method: "POST",
        body: JSON.stringify({ secret: hostSecret, instanceId: hostInstanceId })
      })
    ).toMatchObject({
      status: 200,
      body: {
        sessionId,
        state: "open",
        attempt: {
          status: "idle"
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ role: "host", secret: hostSecret, instanceId: hostInstanceId })
      })
    ).toMatchObject({
      status: 200,
      body: {
        host: {
          claimStatus: "claimed",
          instanceId: hostInstanceId
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/offer`, {
        method: "POST",
        body: JSON.stringify({ secret: hostSecret, instanceId: hostInstanceId, offer: reconnectOffer })
      })
    ).toMatchObject({
      status: 200,
      body: {
        state: "open",
        attempt: {
          status: "offer-ready"
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/offer/read`, {
        method: "POST",
        body: JSON.stringify({ secret: guestSecret, instanceId: guestInstanceId })
      })
    ).toMatchObject({
      status: 200,
      body: {
        offer: reconnectOffer,
        attempt: {
          status: "offer-ready"
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/answer`, {
        method: "POST",
        body: JSON.stringify({ secret: guestSecret, instanceId: guestInstanceId, answer: reconnectAnswer })
      })
    ).toMatchObject({
      status: 200,
      body: {
        attempt: {
          status: "answer-ready"
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/answer/read`, {
        method: "POST",
        body: JSON.stringify({ secret: hostSecret, instanceId: hostInstanceId })
      })
    ).toMatchObject({
      status: 200,
      body: {
        answer: reconnectAnswer,
        attempt: {
          status: "answer-ready"
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/finalize`, {
        method: "POST",
        body: JSON.stringify({
          role: "host",
          secret: hostSecret,
          instanceId: hostInstanceId,
          outcome: "reconnected"
        })
      })
    ).toMatchObject({
      status: 200,
      body: {
        state: "finalized",
        attempt: {
          status: "finalized",
          finalizationOutcome: "reconnected",
          finalizedBy: "host"
        }
      }
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/finalization/read`, {
        method: "POST",
        body: JSON.stringify({ secret: guestSecret, instanceId: guestInstanceId })
      })
    ).toMatchObject({
      status: 200,
      body: {
        state: "finalized",
        attempt: {
          status: "finalized",
          finalizationOutcome: "reconnected",
          finalizedBy: "host"
        }
      }
    });
  });

  it("rejects invalid secrets, duplicate answers, and expired writes", async () => {
    const { server, baseUrl } = await startServer({ sessionTtlSeconds: 1 });
    activeServer = server;

    const created = await requestJson(baseUrl, "/signaling/sessions", {
      method: "POST",
      body: JSON.stringify({ offer })
    });
    const sessionId = created.body.sessionId as string;
    const hostSecret = created.body.hostSecret as string;

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/answer/read`, {
        method: "POST",
        body: JSON.stringify({ hostSecret: "wrong-secret" })
      })
    ).toMatchObject({
      status: 403
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ hostSecret: "wrong-secret" })
      })
    ).toMatchObject({
      status: 403
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer })
      })
    ).toMatchObject({
      status: 200
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer })
      })
    ).toMatchObject({
      status: 409
    });

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${sessionId}/finalize`, {
        method: "POST",
        body: JSON.stringify({ hostSecret })
      })
    ).toMatchObject({
      status: 410
    });
  });

  it("rejects invalid reconnect secrets and wrong reconnect instances", async () => {
    const { server, baseUrl } = await startServer();
    activeServer = server;

    const sessionId = "reconnect-http-auth";

    await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/register`, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      })
    });

    await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/claim`, {
      method: "POST",
      body: JSON.stringify({ role: "host", secret: "host-secret", instanceId: "host-instance-1" })
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/claim`, {
        method: "POST",
        body: JSON.stringify({ role: "guest", secret: "wrong-secret", instanceId: "guest-instance-1" })
      })
    ).toMatchObject({ status: 403 });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/read`, {
        method: "POST",
        body: JSON.stringify({ secret: "host-secret", instanceId: "host-instance-2" })
      })
    ).toMatchObject({ status: 403 });
  });

  it("returns reconnect conflicts when a guest answers before a host offer exists", async () => {
    const { server, baseUrl } = await startServer();
    activeServer = server;

    const sessionId = "reconnect-http-conflict";

    await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/register`, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      })
    });
    await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/claim`, {
      method: "POST",
      body: JSON.stringify({ role: "guest", secret: "guest-secret", instanceId: "guest-instance-1" })
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/answer`, {
        method: "POST",
        body: JSON.stringify({
          secret: "guest-secret",
          instanceId: "guest-instance-1",
          answer: reconnectAnswer
        })
      })
    ).toMatchObject({ status: 409 });
  });

  it("returns expired errors for reconnect writes after expiry", async () => {
    const { server, baseUrl } = await startServer({ sessionTtlSeconds: 1 });
    activeServer = server;

    const sessionId = "reconnect-http-expired";

    await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/register`, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      })
    });

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/claim`, {
        method: "POST",
        body: JSON.stringify({ role: "host", secret: "host-secret", instanceId: "host-instance-1" })
      })
    ).toMatchObject({ status: 410 });
  });

  it("rejects invalid reconnect payloads and invalid reconnect json", async () => {
    const { server, baseUrl } = await startServer();
    activeServer = server;

    const sessionId = "reconnect-http-invalid";

    await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/register`, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        hostSecret: "host-secret",
        guestSecret: "guest-secret"
      })
    });

    expect(
      await requestJson(baseUrl, `/signaling/reconnect/${sessionId}/claim`, {
        method: "POST",
        body: JSON.stringify({ role: "host", secret: "host-secret" })
      })
    ).toMatchObject({ status: 400 });

    const invalidJsonResponse = await fetch(`${baseUrl}/signaling/reconnect/${sessionId}/read`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: "{"
    });

    expect(invalidJsonResponse.status).toBe(400);
    expect(await invalidJsonResponse.json()).toMatchObject({
      error: "Request body must be valid JSON."
    });
  });

  it("enforces origin policy, payload limits, and create rate limits", async () => {
    const restrictedServer = await startServer({
      allowedOrigins: ["https://app.example.com"],
      maxPayloadBytes: 32,
      createRateLimitMax: 1
    });
    activeServer = restrictedServer.server;

    expect(
      await requestJson(restrictedServer.baseUrl, "/signaling/sessions", {
        method: "POST",
        headers: {
          Origin: "https://evil.example.com"
        },
        body: JSON.stringify({ offer })
      })
    ).toMatchObject({
      status: 403
    });

    expect(
      await requestJson(restrictedServer.baseUrl, "/signaling/sessions", {
        method: "POST",
        headers: {
          Origin: "https://app.example.com"
        },
        body: JSON.stringify({ offer })
      })
    ).toMatchObject({
      status: 413
    });

    await restrictedServer.server.shutdown();
    activeServer = undefined;

    const unrestrictedServer = await startServer({ createRateLimitMax: 1 });
    activeServer = unrestrictedServer.server;

    expect(
      await requestJson(unrestrictedServer.baseUrl, "/signaling/sessions", {
        method: "POST",
        body: JSON.stringify({ offer })
      })
    ).toMatchObject({
      status: 201
    });

    expect(
      await requestJson(unrestrictedServer.baseUrl, "/signaling/sessions", {
        method: "POST",
        body: JSON.stringify({ offer })
      })
    ).toMatchObject({
      status: 429
    });

    await unrestrictedServer.server.shutdown();
    activeServer = undefined;
  });

  it("rate limits session creation by the proxy-appended forwarded address", async () => {
    const { server, baseUrl } = await startServer({
      createRateLimitMax: 1,
      trustProxy: true
    });
    activeServer = server;

    expect(
      await requestJson(baseUrl, "/signaling/sessions", {
        method: "POST",
        headers: {
          "x-forwarded-for": "198.51.100.10, 203.0.113.20"
        },
        body: JSON.stringify({ offer })
      })
    ).toMatchObject({
      status: 201
    });

    expect(
      await requestJson(baseUrl, "/signaling/sessions", {
        method: "POST",
        headers: {
          "x-forwarded-for": "198.51.100.99, 203.0.113.20"
        },
        body: JSON.stringify({ offer })
      })
    ).toMatchObject({
      status: 429
    });
  });

  it("rate limits answers by the proxy-appended forwarded address", async () => {
    const { server, baseUrl } = await startServer({
      answerRateLimitMax: 1,
      trustProxy: true
    });
    activeServer = server;

    const createdOne = await requestJson(baseUrl, "/signaling/sessions", {
      method: "POST",
      body: JSON.stringify({ offer })
    });
    const createdTwo = await requestJson(baseUrl, "/signaling/sessions", {
      method: "POST",
      body: JSON.stringify({ offer })
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${createdOne.body.sessionId as string}/answer`, {
        method: "POST",
        headers: {
          "x-forwarded-for": "198.51.100.10, 203.0.113.20"
        },
        body: JSON.stringify({ answer })
      })
    ).toMatchObject({
      status: 200
    });

    expect(
      await requestJson(baseUrl, `/signaling/sessions/${createdTwo.body.sessionId as string}/answer`, {
        method: "POST",
        headers: {
          "x-forwarded-for": "198.51.100.99, 203.0.113.20"
        },
        body: JSON.stringify({ answer })
      })
    ).toMatchObject({
      status: 429
    });
  });
});
