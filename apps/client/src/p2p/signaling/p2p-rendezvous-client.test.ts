import {
  P2P_SIGNALING_PROTOCOL_VERSION,
  type GuestAnswerPayload,
  type HostOfferPayload,
  type ReconnectAnswerPayload,
  type ReconnectOfferPayload
} from "@minesweeper-flags/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { P2PRendezvousClient } from "./p2p-rendezvous-client.js";

const offer: HostOfferPayload = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p",
  role: "host",
  sdp: "offer-sdp",
  timestamp: 1
};

const answer: GuestAnswerPayload = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p",
  role: "guest",
  displayName: "Guest Player",
  sdp: "answer-sdp",
  timestamp: 2
};

const reconnectOffer: ReconnectOfferPayload = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p-reconnect",
  role: "host",
  sdp: "reconnect-offer-sdp",
  timestamp: 3
};

const reconnectAnswer: ReconnectAnswerPayload = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p-reconnect",
  role: "guest",
  sdp: "reconnect-answer-sdp",
  timestamp: 4
};

const createJsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

describe("P2PRendezvousClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates sessions through the signaling API", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse(
        {
          sessionId: "session-1",
          hostSecret: "host-secret",
          state: "open",
          offer,
          createdAt: 10,
          expiresAt: 20
        },
        201
      )
    );
    const client = new P2PRendezvousClient({
      baseUrl: "https://signal.example.com",
      fetch: fetchMock as typeof fetch
    });

    await expect(client.createSession(offer)).resolves.toMatchObject({
      sessionId: "session-1",
      hostSecret: "host-secret",
      state: "open"
    });
    expect(fetchMock).toHaveBeenCalledWith("https://signal.example.com/signaling/sessions", {
      method: "POST",
      signal: undefined,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offer })
    });
  });

  it("polls for an answer until one is available", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "session-1",
          state: "open",
          answer: null,
          createdAt: 10,
          expiresAt: 20
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "session-1",
          state: "answered",
          answer,
          createdAt: 10,
          expiresAt: 20
        })
      );
    const sleepMock = vi.fn(async () => {});
    const client = new P2PRendezvousClient({
      baseUrl: "https://signal.example.com",
      fetch: fetchMock as typeof fetch,
      sleep: sleepMock
    });

    await expect(client.pollForAnswer("session-1", "host-secret", { intervalMs: 5 })).resolves.toMatchObject({
      state: "answered",
      answer
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://signal.example.com/signaling/sessions/session-1/answer/read",
      {
        method: "POST",
        signal: undefined,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostSecret: "host-secret" })
      }
    );
    expect(sleepMock).toHaveBeenCalledWith(5, undefined);
  });

  it("covers reconnect control-session routes", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "reconnect-1",
          state: "open",
          createdAt: 10,
          expiresAt: 20,
          host: { claimStatus: "unclaimed", instanceId: null, lastHeartbeatAt: null },
          guest: { claimStatus: "unclaimed", instanceId: null, lastHeartbeatAt: null },
          attempt: { status: "idle", finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
        }, 201)
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "reconnect-1",
          state: "open",
          createdAt: 10,
          expiresAt: 20,
          host: { claimStatus: "claimed", instanceId: "host-instance-1", lastHeartbeatAt: 11 },
          guest: { claimStatus: "unclaimed", instanceId: null, lastHeartbeatAt: null },
          attempt: { status: "idle", finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "reconnect-1",
          state: "open",
          createdAt: 10,
          expiresAt: 20,
          host: { claimStatus: "claimed", instanceId: "host-instance-1", lastHeartbeatAt: 12 },
          guest: { claimStatus: "unclaimed", instanceId: null, lastHeartbeatAt: null },
          attempt: { status: "idle", finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "reconnect-1",
          state: "open",
          createdAt: 10,
          expiresAt: 20,
          host: { claimStatus: "claimed", instanceId: "host-instance-1", lastHeartbeatAt: 11 },
          guest: { claimStatus: "unclaimed", instanceId: null, lastHeartbeatAt: null },
          attempt: { status: "offer-ready", finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "reconnect-1",
          state: "open",
          createdAt: 10,
          expiresAt: 20,
          host: { claimStatus: "claimed", instanceId: "host-instance-1", lastHeartbeatAt: 11 },
          guest: { claimStatus: "claimed", instanceId: "guest-instance-1", lastHeartbeatAt: 12 },
          attempt: { status: "offer-ready", finalizationOutcome: null, finalizedBy: null, finalizedAt: null },
          offer: reconnectOffer
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "reconnect-1",
          state: "open",
          createdAt: 10,
          expiresAt: 20,
          host: { claimStatus: "claimed", instanceId: "host-instance-1", lastHeartbeatAt: 11 },
          guest: { claimStatus: "claimed", instanceId: "guest-instance-1", lastHeartbeatAt: 12 },
          attempt: { status: "answer-ready", finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "reconnect-1",
          state: "open",
          createdAt: 10,
          expiresAt: 20,
          host: { claimStatus: "claimed", instanceId: "host-instance-1", lastHeartbeatAt: 11 },
          guest: { claimStatus: "claimed", instanceId: "guest-instance-1", lastHeartbeatAt: 12 },
          attempt: { status: "finalized", finalizationOutcome: "reconnected", finalizedBy: "host", finalizedAt: 13 },
          answer: reconnectAnswer
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "reconnect-1",
          state: "open",
          createdAt: 10,
          expiresAt: 20,
          host: { claimStatus: "claimed", instanceId: "host-instance-1", lastHeartbeatAt: 11 },
          guest: { claimStatus: "claimed", instanceId: "guest-instance-1", lastHeartbeatAt: 12 },
          attempt: { status: "finalized", finalizationOutcome: "reconnected", finalizedBy: "host", finalizedAt: 13 }
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionId: "reconnect-1",
          state: "open",
          createdAt: 10,
          expiresAt: 20,
          host: { claimStatus: "claimed", instanceId: "host-instance-1", lastHeartbeatAt: 11 },
          guest: { claimStatus: "claimed", instanceId: "guest-instance-1", lastHeartbeatAt: 12 },
          attempt: { status: "finalized", finalizationOutcome: "reconnected", finalizedBy: "host", finalizedAt: 13 }
        })
      );
    const client = new P2PRendezvousClient({
      baseUrl: "https://signal.example.com",
      fetch: fetchMock as typeof fetch,
      sleep: vi.fn(async () => {})
    });

    await expect(
      client.registerReconnectControlSession("reconnect-1", "host-secret", "guest-secret")
    ).resolves.toMatchObject({ sessionId: "reconnect-1" });
    await expect(
      client.claimReconnectRole("reconnect-1", "host", "host-secret", "host-instance-1")
    ).resolves.toMatchObject({ host: { instanceId: "host-instance-1" } });
    await expect(
      client.heartbeatReconnectRole("reconnect-1", "host", "host-secret", "host-instance-1")
    ).resolves.toMatchObject({ host: { lastHeartbeatAt: 12 } });
    await expect(
      client.writeReconnectOffer("reconnect-1", "host-secret", "host-instance-1", reconnectOffer)
    ).resolves.toMatchObject({ attempt: { status: "offer-ready" } });
    await expect(
      client.pollForReconnectOffer("reconnect-1", "guest-secret", "guest-instance-1", { intervalMs: 5 })
    ).resolves.toMatchObject({ offer: reconnectOffer });
    await expect(
      client.writeReconnectAnswer("reconnect-1", "guest-secret", "guest-instance-1", reconnectAnswer)
    ).resolves.toMatchObject({ attempt: { status: "answer-ready" } });
    await expect(
      client.pollForReconnectAnswer("reconnect-1", "host-secret", "host-instance-1", { intervalMs: 5 })
    ).resolves.toMatchObject({ answer: reconnectAnswer });
    await expect(
      client.finalizeReconnectAttempt(
        "reconnect-1",
        "host",
        "host-secret",
        "host-instance-1",
        "reconnected"
      )
    ).resolves.toMatchObject({ attempt: { finalizationOutcome: "reconnected" } });
    await expect(
      client.pollForReconnectFinalization("reconnect-1", "guest-secret", "guest-instance-1", { intervalMs: 5 })
    ).resolves.toMatchObject({ attempt: { finalizationOutcome: "reconnected" } });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://signal.example.com/signaling/reconnect/reconnect-1/register", {
      method: "POST",
      signal: undefined,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "reconnect-1", hostSecret: "host-secret", guestSecret: "guest-secret" })
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://signal.example.com/signaling/reconnect/reconnect-1/heartbeat", {
      method: "POST",
      signal: undefined,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "host", secret: "host-secret", instanceId: "host-instance-1" })
    });
  });

  it("maps expired responses to a user-facing error", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ error: "expired" }, 410));
    const client = new P2PRendezvousClient({
      baseUrl: "https://signal.example.com",
      fetch: fetchMock as typeof fetch
    });

    await expect(client.getSession("session-1")).rejects.toThrow(
      "This direct-match link has expired. Start a new direct match."
    );
  });

  it("uses a bound global fetch by default", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () =>
      createJsonResponse({
        sessionId: "session-1",
        state: "open",
        offer,
        createdAt: 10,
        expiresAt: 20
      })
    );

    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const client = new P2PRendezvousClient({
        baseUrl: "https://signal.example.com"
      });

      await expect(client.getSession("session-1")).resolves.toMatchObject({
        sessionId: "session-1",
        state: "open"
      });
      expect(fetchSpy).toHaveBeenCalledWith("https://signal.example.com/signaling/sessions/session-1", {
        method: "GET"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
