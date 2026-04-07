import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameClientScheduler } from "../../app/providers/game-client.controller.js";
import {
  P2P_RECOVERY_STORAGE_VERSION,
  type P2PRecoveryPersistence
} from "../storage/p2p-recovery-storage.js";
import type { GuestAnswerPayload, HostOfferPayload, ReconnectAnswerPayload, ReconnectOfferPayload } from "@minesweeper-flags/shared";
import { createP2PGameClientRuntime } from "./create-p2p-game-client-runtime.js";
import { P2PRendezvousRequestError } from "../signaling/p2p-rendezvous-client.js";
import type {
  WebRTCPeerController,
  WebRTCPeerListener,
  WebRTCPeerStatus
} from "../transport/webrtc-peer.types.js";

class PairedFakePeer implements WebRTCPeerController {
  private status: WebRTCPeerStatus = "idle";
  private readonly listeners = new Set<WebRTCPeerListener>();
  private partner: PairedFakePeer | null = null;
  private autoConnectOnReconnectAnswer = true;
  guestAnswerCalls = 0;
  reconnectAnswerError: Error | null = null;

  setPartner(partner: PairedFakePeer): void {
    this.partner = partner;
  }

  setAutoConnectOnReconnectAnswer(enabled: boolean): void {
    this.autoConnectOnReconnectAnswer = enabled;
  }

  getStatus = (): WebRTCPeerStatus => this.status;

  subscribe = (listener: WebRTCPeerListener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  createHostOffer = async (): Promise<HostOfferPayload> => {
    this.emitStatus("creating-offer");
    this.emitStatus("waiting-for-answer");

    return {
      protocolVersion: 1,
      mode: "p2p",
      role: "host",
      sdp: "host-offer-sdp",
      timestamp: 1
    };
  };

  createReconnectOffer = async (): Promise<ReconnectOfferPayload> => {
    this.emitStatus("creating-offer");
    this.emitStatus("waiting-for-answer");

    return {
      protocolVersion: 1,
      mode: "p2p-reconnect",
      role: "host",
      sdp: "reconnect-offer-sdp",
      timestamp: 3
    };
  };

  createGuestAnswer = async (
    _offerPayload: HostOfferPayload,
    displayName: string
  ): Promise<GuestAnswerPayload> => {
    this.guestAnswerCalls += 1;
    this.emitStatus("creating-answer");
    this.emitStatus("waiting-for-host-finalize");

    return {
      protocolVersion: 1,
      mode: "p2p",
      role: "guest",
      displayName,
      sdp: "guest-answer-sdp",
      timestamp: 2
    };
  };

  createReconnectAnswer = async (_offerPayload: ReconnectOfferPayload): Promise<ReconnectAnswerPayload> => {
    if (this.reconnectAnswerError) {
      throw this.reconnectAnswerError;
    }

    this.emitStatus("creating-answer");
    this.emitStatus("waiting-for-host-finalize");

    return {
      protocolVersion: 1,
      mode: "p2p-reconnect",
      role: "guest",
      sdp: "reconnect-answer-sdp",
      timestamp: 4
    };
  };

  applyGuestAnswer = async (_answerPayload: GuestAnswerPayload): Promise<void> => {
    this.emitStatus("connecting");
    this.emitStatus("connected");
    this.partner?.emitStatus("connected");
  };

  applyReconnectAnswer = async (_answerPayload: ReconnectAnswerPayload): Promise<void> => {
    this.emitStatus("connecting");

    if (this.autoConnectOnReconnectAnswer) {
      this.completeReconnectConnection();
    }
  };

  completeReconnectConnection(): void {
    this.emitStatus("connected");
    this.partner?.emitStatus("connected");
  }

  send = (message: string): void => {
    if (this.status !== "connected") {
      throw new Error("Peer is not connected.");
    }

    this.partner?.emitMessage(message);
  };

  disconnect = (): void => {
    this.emitStatus("closed");
    this.partner?.emitStatus("closed");
  };

  failConnection(error = "Peer connection failed."): void {
    this.emitStatus("failed", error);
    this.partner?.emitStatus("failed", error);
  }

  private emitStatus(status: WebRTCPeerStatus, error?: string): void {
    this.status = status;

    for (const listener of this.listeners) {
      listener.onStatusChange?.(
        error === undefined
          ? { status }
          : {
              status,
              error
            }
      );
    }
  }

  private emitMessage(message: string): void {
    for (const listener of this.listeners) {
      listener.onMessage?.(message);
    }
  }
}

class FakeRendezvousClient {
  private storedOffer: HostOfferPayload | null = null;
  private answerResolver: ((answer: GuestAnswerPayload) => void) | null = null;
  private finalizationResolver: (() => void) | null = null;
  sessionState: "open" | "answered" | "finalized" | "expired" = "open";
  revalidatedSessionState: "open" | "answered" | "finalized" | "expired" | null = null;
  expiresAt = 9_999_999_999_999;
  revalidatedExpiresAt: number | null = null;
  pollForAnswerState: "answered" | "expired" = "answered";
  finalizeSessionError: Error | null = null;
  getSessionErrorAtCall: number | null = null;
  getSessionError: Error | null = null;
  submitAnswerCalls = 0;
  finalizeSessionCalls = 0;
  getSessionCalls = 0;
  reconnectClaims: Array<{ sessionId: string; role: "host" | "guest"; instanceId: string }> = [];
  reconnectHeartbeats: Array<{ sessionId: string; role: "host" | "guest"; instanceId: string }> = [];
  reconnectOffer: ReconnectOfferPayload | null = null;
  reconnectAnswer: ReconnectAnswerPayload | null = null;
  reconnectFinalizationOutcome: "reconnected" | "aborted" | null = null;
  reconnectFinalizationBy: "host" | "guest" | null = null;
  reconnectFinalizations: Array<{ role: "host" | "guest"; outcome: "reconnected" | "aborted" }> = [];
  registerReconnectControlSessionError: Error | null = null;
  writeReconnectAnswerError: Error | null = null;
  pollForReconnectOfferState: "open" | "expired" = "open";
  pollForReconnectAnswerState: "open" | "expired" = "open";
  heartbeatErrorByRole: Partial<Record<"host" | "guest", Error>> = {};
  heartbeatErrorsByRole: Partial<Record<"host" | "guest", Error[]>> = {};

  createSession = async (offer: HostOfferPayload) => {
    this.storedOffer = offer;

    return {
      sessionId: "session-1",
      hostSecret: "host-secret",
      state: "open" as const,
      offer,
      createdAt: 10,
      expiresAt: this.expiresAt
    };
  };

  getSession = async (sessionId: string) => {
    this.getSessionCalls += 1;

    if (this.getSessionErrorAtCall === this.getSessionCalls && this.getSessionError) {
      throw this.getSessionError;
    }

    return {
      sessionId,
      state: this.getSessionCalls > 1 && this.revalidatedSessionState
        ? this.revalidatedSessionState
        : this.sessionState,
      offer: this.storedOffer ?? {
        protocolVersion: 1,
        mode: "p2p" as const,
        role: "host" as const,
        sdp: "host-offer-sdp",
        timestamp: 1
      },
      createdAt: 10,
      expiresAt: this.getSessionCalls > 1 && this.revalidatedExpiresAt !== null
        ? this.revalidatedExpiresAt
        : this.expiresAt
    };
  };

  submitAnswer = async (sessionId: string, answer: GuestAnswerPayload) => {
    this.submitAnswerCalls += 1;
    this.answerResolver?.(answer);

    return {
      sessionId,
      state: "answered" as const,
      answer,
      createdAt: 10,
      expiresAt: this.expiresAt
    };
  };

  pollForAnswer = async (sessionId: string, _hostSecret: string, options?: { signal?: AbortSignal }) => {
    const answer = await new Promise<GuestAnswerPayload>((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(createAbortError());
        return;
      }

      const abortListener = () => {
        options?.signal?.removeEventListener("abort", abortListener);
        reject(createAbortError());
      };

      options?.signal?.addEventListener("abort", abortListener, { once: true });
      this.answerResolver = (value) => {
        options?.signal?.removeEventListener("abort", abortListener);
        resolve(value);
      };
    });

    return {
      sessionId,
      state: this.pollForAnswerState,
      answer,
      createdAt: 10,
      expiresAt: this.expiresAt
    };
  };

  finalizeSession = async (sessionId: string) => {
    this.finalizeSessionCalls += 1;

    if (this.finalizeSessionError) {
      throw this.finalizeSessionError;
    }

    this.finalizationResolver?.();

    return {
      sessionId,
      state: "finalized" as const,
      createdAt: 10,
      expiresAt: this.expiresAt
    };
  };

  pollForFinalization = async (sessionId: string, options?: { signal?: AbortSignal }) => {
    await new Promise<void>((resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(createAbortError());
        return;
      }

      const abortListener = () => {
        options?.signal?.removeEventListener("abort", abortListener);
        reject(createAbortError());
      };

      options?.signal?.addEventListener("abort", abortListener, { once: true });
      this.finalizationResolver = () => {
        options?.signal?.removeEventListener("abort", abortListener);
        resolve();
      };
    });

    return {
      sessionId,
      state: "finalized" as const,
      createdAt: 10,
      expiresAt: this.expiresAt
    };
  };

  registerReconnectControlSession = async (sessionId: string, _hostSecret: string, _guestSecret: string) => {
    if (this.registerReconnectControlSessionError) {
      throw this.registerReconnectControlSessionError;
    }

    return {
      sessionId,
      state: "open" as const,
      createdAt: 10,
      expiresAt: this.expiresAt,
      host: { claimStatus: "unclaimed" as const, instanceId: null, lastHeartbeatAt: null },
      guest: { claimStatus: "unclaimed" as const, instanceId: null, lastHeartbeatAt: null },
      attempt: { status: "idle" as const, finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
    };
  };

  claimReconnectRole = async (
    sessionId: string,
    role: "host" | "guest",
    _secret: string,
    instanceId: string
  ) => {
    this.reconnectClaims.push({ sessionId, role, instanceId });

    return {
      sessionId,
      state: "open" as const,
      createdAt: 10,
      expiresAt: this.expiresAt,
      host: {
        claimStatus: role === "host" ? ("claimed" as const) : ("unclaimed" as const),
        instanceId: role === "host" ? instanceId : null,
        lastHeartbeatAt: 10
      },
      guest: {
        claimStatus: role === "guest" ? ("claimed" as const) : ("unclaimed" as const),
        instanceId: role === "guest" ? instanceId : null,
        lastHeartbeatAt: 10
      },
      attempt: { status: "idle" as const, finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
    };
  };

  writeReconnectOffer = async (
    sessionId: string,
    _secret: string,
    _instanceId: string,
    offer: ReconnectOfferPayload
  ) => {
    this.reconnectOffer = offer;

    return {
      sessionId,
      state: "open" as const,
      createdAt: 10,
      expiresAt: this.expiresAt,
      host: { claimStatus: "claimed" as const, instanceId: "host-instance-2", lastHeartbeatAt: 10 },
      guest: { claimStatus: "unclaimed" as const, instanceId: null, lastHeartbeatAt: null },
      attempt: { status: "offer-ready" as const, finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
    };
  };

  heartbeatReconnectRole = async (
    sessionId: string,
    role: "host" | "guest",
    _secret: string,
    instanceId: string
  ) => {
    this.reconnectHeartbeats.push({ sessionId, role, instanceId });

    const queuedHeartbeatError = this.heartbeatErrorsByRole[role]?.shift();
    const heartbeatError = queuedHeartbeatError ?? this.heartbeatErrorByRole[role];

    if (heartbeatError) {
      throw heartbeatError;
    }

    return {
      sessionId,
      state: "open" as const,
      createdAt: 10,
      expiresAt: this.expiresAt,
      host: {
        claimStatus: "claimed" as const,
        instanceId: role === "host" ? instanceId : "host-instance-2",
        lastHeartbeatAt: 11
      },
      guest: {
        claimStatus: "claimed" as const,
        instanceId: role === "guest" ? instanceId : "guest-instance-2",
        lastHeartbeatAt: 11
      },
      attempt: { status: "idle" as const, finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
    };
  };

  pollForReconnectOffer = async (
    sessionId: string,
    _secret?: string,
    _instanceId?: string,
    options?: { signal?: AbortSignal }
  ) => {
    await waitFor(() => Boolean(this.reconnectOffer || this.reconnectFinalizationOutcome), options?.signal);

    return {
      sessionId,
      state: this.pollForReconnectOfferState,
      createdAt: 10,
      expiresAt: this.expiresAt,
      host: { claimStatus: "claimed" as const, instanceId: "host-instance-2", lastHeartbeatAt: 10 },
      guest: { claimStatus: "claimed" as const, instanceId: "guest-instance-2", lastHeartbeatAt: 10 },
      attempt: this.reconnectFinalizationOutcome
        ? {
            status: "finalized" as const,
            finalizationOutcome: this.reconnectFinalizationOutcome,
            finalizedBy: this.reconnectFinalizationBy,
            finalizedAt: 10
          }
        : { status: "offer-ready" as const, finalizationOutcome: null, finalizedBy: null, finalizedAt: null },
      offer: this.reconnectOffer
    };
  };

  writeReconnectAnswer = async (
    sessionId: string,
    _secret: string,
    _instanceId: string,
    answer: ReconnectAnswerPayload
  ) => {
    if (this.writeReconnectAnswerError) {
      throw this.writeReconnectAnswerError;
    }

    this.reconnectAnswer = answer;

    return {
      sessionId,
      state: "open" as const,
      createdAt: 10,
      expiresAt: this.expiresAt,
      host: { claimStatus: "claimed" as const, instanceId: "host-instance-2", lastHeartbeatAt: 10 },
      guest: { claimStatus: "claimed" as const, instanceId: "guest-instance-2", lastHeartbeatAt: 10 },
      attempt: { status: "answer-ready" as const, finalizationOutcome: null, finalizedBy: null, finalizedAt: null }
    };
  };

  pollForReconnectAnswer = async (
    sessionId: string,
    _secret?: string,
    _instanceId?: string,
    options?: { signal?: AbortSignal }
  ) => {
    await waitFor(() => Boolean(this.reconnectAnswer || this.reconnectFinalizationOutcome), options?.signal);

    return {
      sessionId,
      state: this.pollForReconnectAnswerState,
      createdAt: 10,
      expiresAt: this.expiresAt,
      host: { claimStatus: "claimed" as const, instanceId: "host-instance-2", lastHeartbeatAt: 10 },
      guest: { claimStatus: "claimed" as const, instanceId: "guest-instance-2", lastHeartbeatAt: 10 },
      attempt: this.reconnectFinalizationOutcome
        ? {
            status: "finalized" as const,
            finalizationOutcome: this.reconnectFinalizationOutcome,
            finalizedBy: this.reconnectFinalizationBy,
            finalizedAt: 10
          }
        : { status: "answer-ready" as const, finalizationOutcome: null, finalizedBy: null, finalizedAt: null },
      answer: this.reconnectAnswer
    };
  };

  finalizeReconnectAttempt = async (
    sessionId: string,
    role: "host" | "guest",
    _secret: string,
    _instanceId: string,
    outcome: "reconnected" | "aborted"
  ) => {
    this.reconnectFinalizationOutcome = outcome;
    this.reconnectFinalizationBy = role;
    this.reconnectFinalizations.push({ role, outcome });

    return {
      sessionId,
      state: "finalized" as const,
      createdAt: 10,
      expiresAt: this.expiresAt,
      host: { claimStatus: "claimed" as const, instanceId: "host-instance-2", lastHeartbeatAt: 10 },
      guest: { claimStatus: "claimed" as const, instanceId: "guest-instance-2", lastHeartbeatAt: 10 },
      attempt: { status: "finalized" as const, finalizationOutcome: outcome, finalizedBy: role, finalizedAt: 10 }
    };
  };

  pollForReconnectFinalization = async (
    sessionId: string,
    _secret?: string,
    _instanceId?: string,
    options?: { signal?: AbortSignal }
  ) => {
    await waitFor(() => this.reconnectFinalizationOutcome !== null, options?.signal);

    return {
      sessionId,
      state: "finalized" as const,
      createdAt: 10,
      expiresAt: this.expiresAt,
      host: { claimStatus: "claimed" as const, instanceId: "host-instance-2", lastHeartbeatAt: 10 },
      guest: { claimStatus: "claimed" as const, instanceId: "guest-instance-2", lastHeartbeatAt: 10 },
      attempt: {
        status: "finalized" as const,
        finalizationOutcome: this.reconnectFinalizationOutcome,
        finalizedBy: this.reconnectFinalizationBy,
        finalizedAt: 10
      }
    };
  };
}

class MemoryRecoveryPersistence implements P2PRecoveryPersistence {
  private readonly records = new Map<string, unknown>();

  read = (roomCode: string) => (this.records.get(roomCode) as ReturnType<P2PRecoveryPersistence["read"]>) ?? null;

  write = (record: Parameters<P2PRecoveryPersistence["write"]>[0]) => {
    const roomCode = record.role === "guest" ? record.roomCode : record.room.roomCode;
    this.records.set(roomCode, structuredClone(record));
  };

  remove = (roomCode: string) => {
    this.records.delete(roomCode);
  };
}

const createRecoveryPersistences = () => ({
  hostRecoveryPersistence: new MemoryRecoveryPersistence(),
  guestRecoveryPersistence: new MemoryRecoveryPersistence()
});

class FakeScheduler implements GameClientScheduler {
  private nextId = 1;
  private readonly timeouts = new Map<number, () => void>();

  setTimeout = (callback: () => void, _delayMs: number): number => {
    const timeoutId = this.nextId;
    this.nextId += 1;
    this.timeouts.set(timeoutId, callback);
    return timeoutId;
  };

  clearTimeout = (timeoutId: number): void => {
    this.timeouts.delete(timeoutId);
  };

  random = (): number => 0;

  runNext = async (): Promise<void> => {
    const nextTimeout = this.timeouts.entries().next().value as [number, () => void] | undefined;

    if (!nextTimeout) {
      return;
    }

    const [timeoutId, callback] = nextTimeout;
    this.timeouts.delete(timeoutId);
    callback();
    await flushPromises();
  };
}

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const createAbortError = (): DOMException => new DOMException("The operation was aborted.", "AbortError");

const waitFor = async (predicate: () => boolean, signal?: AbortSignal): Promise<void> => {
  while (!predicate()) {
    if (signal?.aborted) {
      throw createAbortError();
    }

    await flushPromises();
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createP2PGameClientRuntime", () => {
  it("connects host and guest runtimes through the automated direct-match flow", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();

    if (!hostRuntime.p2p || !guestRuntime.p2p) {
      throw new Error("Expected p2p runtime support.");
    }

    expect(hostRuntime.p2p.getSnapshot().host.joinUrl).toContain("/p2p/join/session-1");

    guestRuntime.p2p.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();

    expect(hostRuntime.store.getSnapshot().session?.roomCode).toBeDefined();
    expect(guestRuntime.store.getSnapshot().session?.roomCode).toBe(
      hostRuntime.store.getSnapshot().session?.roomCode
    );
    expect(hostRuntime.store.getSnapshot().match?.phase).toBe("live");
    expect(guestRuntime.store.getSnapshot().match?.phase).toBe("live");
    expect(hostRuntime.p2p.getSnapshot().host.sessionId).toBe("session-1");
    expect(guestRuntime.p2p.getSnapshot().guest.sessionId).toBe("session-1");
    expect(hostRuntime.p2p.getSnapshot().host.stage).toBe("connected");
    expect(guestRuntime.p2p.getSnapshot().guest.stage).toBe("connected");

    guestRuntime.controller.setChatDraft("hello direct match");
    guestRuntime.controller.sendChatMessage();
    await flushPromises();

    expect(hostRuntime.store.getSnapshot().chatMessages.at(-1)?.text).toBe("hello direct match");
    expect(guestRuntime.store.getSnapshot().chatMessages.at(-1)?.text).toBe("hello direct match");

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("restores a refreshed guest through the reconnect control session while the host tab stays open", async () => {
    const hostPeers = [new PairedFakePeer(), new PairedFakePeer()];
    const guestPeers = [new PairedFakePeer(), new PairedFakePeer()];
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeers[0]?.setPartner(guestPeers[0]!);
    guestPeers[0]?.setPartner(hostPeers[0]!);
    hostPeers[1]?.setPartner(guestPeers[1]!);
    guestPeers[1]?.setPartner(hostPeers[1]!);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();

    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    hostRuntime.controller.setChatDraft("before refresh");
    hostRuntime.controller.sendChatMessage();
    hostRuntime.controller.submitCellAction(0, 0);
    await flushPromises();
    await flushPromises();

    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({
      version: P2P_RECOVERY_STORAGE_VERSION,
      role: "guest",
      roomCode,
      reconnect: {
        controlSessionId: expect.any(String),
        guestSecret: expect.any(String)
      }
    });

    guestRuntime.controller.dispose();
    await flushPromises();

    const refreshedGuestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    refreshedGuestRuntime.controller.start();
    refreshedGuestRuntime.controller.reconnect(roomCode);
    await flushPromises();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(refreshedGuestRuntime.store.getSnapshot().session?.roomCode).toBe(roomCode);
    expect(refreshedGuestRuntime.store.getSnapshot().chatMessages.at(-1)?.text).toBe("before refresh");
    expect(refreshedGuestRuntime.store.getSnapshot().match).toEqual(hostRuntime.store.getSnapshot().match);

    refreshedGuestRuntime.controller.setChatDraft("after refresh");
    refreshedGuestRuntime.controller.sendChatMessage();
    await flushPromises();

    expect(hostRuntime.store.getSnapshot().chatMessages.at(-1)?.text).toBe("after refresh");
    expect(refreshedGuestRuntime.store.getSnapshot().chatMessages.at(-1)?.text).toBe("after refresh");

    refreshedGuestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("writes a host recovery record for a live host session once reconnect metadata exists", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(hostRecoveryPersistence.read(roomCode)).toMatchObject({
      version: P2P_RECOVERY_STORAGE_VERSION,
      role: "host",
      room: {
        roomCode,
        players: expect.arrayContaining([
          { playerId: expect.any(String), displayName: "Host Player" },
          { playerId: expect.any(String), displayName: "Guest Player" }
        ])
      },
      chatMessages: [],
      match: expect.objectContaining({ phase: "live" }),
      reconnect: {
        controlSessionId: expect.any(String),
        hostSecret: expect.any(String),
        guestSecret: expect.any(String)
      }
    });

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("restores a refreshed host from persisted authority state and the still-open guest reconnects automatically", async () => {
    const initialHostPeer = new PairedFakePeer();
    const reconnectHostPeer = new PairedFakePeer();
    const initialGuestPeer = new PairedFakePeer();
    const reconnectGuestPeer = new PairedFakePeer();
    const hostPeers = [initialHostPeer, reconnectHostPeer];
    const guestPeers = [initialGuestPeer, reconnectGuestPeer];
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    initialHostPeer.setPartner(initialGuestPeer);
    initialGuestPeer.setPartner(initialHostPeer);
    reconnectHostPeer.setPartner(reconnectGuestPeer);
    reconnectGuestPeer.setPartner(reconnectHostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    hostRuntime.controller.setChatDraft("before host refresh");
    hostRuntime.controller.sendChatMessage();
    hostRuntime.controller.submitCellAction(0, 0);
    await flushPromises();
    await flushPromises();

    const persistedRecord = hostRecoveryPersistence.read(roomCode);
    expect(persistedRecord).toMatchObject({ role: "host", room: { roomCode } });

    if (!persistedRecord || persistedRecord.role !== "host") {
      throw new Error("Expected a host recovery record.");
    }

    hostRuntime.controller.dispose();
    await flushPromises();

    const refreshedHostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });

    refreshedHostRuntime.controller.start();
    refreshedHostRuntime.controller.reconnect(roomCode);

    expect(refreshedHostRuntime.store.getSnapshot().session?.roomCode).toBe(roomCode);
    expect(refreshedHostRuntime.store.getSnapshot().chatMessages.at(-1)?.text).toBe("before host refresh");
    expect(refreshedHostRuntime.store.getSnapshot().match?.turnNumber).toBe(persistedRecord.match?.turnNumber);

    const restoredMatch = structuredClone(refreshedHostRuntime.store.getSnapshot().match);
    refreshedHostRuntime.controller.submitCellAction(0, 1);
    expect(refreshedHostRuntime.store.getSnapshot().match).toEqual(restoredMatch);
    expect(refreshedHostRuntime.store.getSnapshot().error).toBe(
      "Direct connection interrupted. Restart the direct match if it does not recover."
    );

    await flushPromises();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(guestRuntime.store.getSnapshot().session?.roomCode).toBe(roomCode);
    expect(guestRuntime.store.getSnapshot().chatMessages.at(-1)?.text).toBe("before host refresh");
    expect(guestRuntime.store.getSnapshot().match).toEqual(refreshedHostRuntime.store.getSnapshot().match);

    guestRuntime.controller.setChatDraft("after host refresh");
    guestRuntime.controller.sendChatMessage();
    await flushPromises();

    expect(refreshedHostRuntime.store.getSnapshot().chatMessages.at(-1)?.text).toBe("after host refresh");
    expect(guestRuntime.store.getSnapshot().chatMessages.at(-1)?.text).toBe("after host refresh");

    guestRuntime.controller.dispose();
    refreshedHostRuntime.controller.dispose();
  });

  it("clears the guest recovery record when the guest intentionally leaves the direct match", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = guestRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({ role: "guest", roomCode });

    guestRuntime.controller.openLobby();

    expect(guestRecoveryPersistence.read(roomCode)).toBeNull();

    hostRuntime.controller.dispose();
    guestRuntime.controller.dispose();
  });

  it("clears the active guest recovery record before loading a new guest setup session", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = guestRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({ role: "guest", roomCode });

    guestRuntime.p2p?.controller.openGuestSetupSession("session-2");
    await flushPromises();

    expect(guestRecoveryPersistence.read(roomCode)).toBeNull();

    hostRuntime.controller.dispose();
    guestRuntime.controller.dispose();
  });

  it("clears the host recovery record when the host intentionally leaves the direct match", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(hostRecoveryPersistence.read(roomCode)).toMatchObject({ role: "host", room: { roomCode } });

    guestRuntime.controller.dispose();
    hostRuntime.controller.openLobby();

    expect(hostRecoveryPersistence.read(roomCode)).toBeNull();
  });

  it("starts heartbeating after a live host claim is established", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const scheduler = new FakeScheduler();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      scheduler
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      scheduler
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(rendezvousClient.reconnectClaims).toContainEqual({
      sessionId: expect.any(String),
      role: "host",
      instanceId: expect.any(String)
    });

    await scheduler.runNext();

    expect(rendezvousClient.reconnectHeartbeats).toContainEqual({
      sessionId: expect.any(String),
      role: "host",
      instanceId: expect.any(String)
    });

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("retries heartbeat after a transient failure and continues recovery", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const scheduler = new FakeScheduler();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);
    rendezvousClient.heartbeatErrorsByRole.host = [
      new P2PRendezvousRequestError("Temporary server error.", 500)
    ];

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      scheduler,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      scheduler,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    await scheduler.runNext();
    await scheduler.runNext();
    await scheduler.runNext();
    await scheduler.runNext();

    expect(
      rendezvousClient.reconnectHeartbeats.filter((heartbeat) => heartbeat.role === "host")
    ).toHaveLength(2);
    expect(hostRuntime.store.getSnapshot().error).toBeNull();

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("waits for the replacement host peer to connect before finalizing reconnect", async () => {
    const initialHostPeer = new PairedFakePeer();
    const reconnectHostPeer = new PairedFakePeer();
    const initialGuestPeer = new PairedFakePeer();
    const reconnectGuestPeer = new PairedFakePeer();
    const hostPeers = [initialHostPeer, reconnectHostPeer];
    const guestPeers = [initialGuestPeer, reconnectGuestPeer];
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    reconnectHostPeer.setAutoConnectOnReconnectAnswer(false);
    initialHostPeer.setPartner(initialGuestPeer);
    initialGuestPeer.setPartner(initialHostPeer);
    reconnectHostPeer.setPartner(reconnectGuestPeer);
    reconnectGuestPeer.setPartner(reconnectHostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    guestRuntime.controller.dispose();
    await flushPromises();

    const refreshedGuestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    refreshedGuestRuntime.controller.start();
    refreshedGuestRuntime.controller.reconnect(roomCode);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(rendezvousClient.reconnectFinalizations).not.toContainEqual({
      role: "host",
      outcome: "reconnected"
    });

    reconnectHostPeer.completeReconnectConnection();
    await flushPromises();
    await flushPromises();

    expect(rendezvousClient.reconnectFinalizations).toContainEqual({
      role: "host",
      outcome: "reconnected"
    });
    expect(refreshedGuestRuntime.store.getSnapshot().session?.roomCode).toBe(roomCode);

    refreshedGuestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("recovers the host-side reconnect flow when the peer fails instead of closing", async () => {
    const initialHostPeer = new PairedFakePeer();
    const reconnectHostPeer = new PairedFakePeer();
    const initialGuestPeer = new PairedFakePeer();
    const reconnectGuestPeer = new PairedFakePeer();
    const hostPeers = [initialHostPeer, reconnectHostPeer];
    const guestPeers = [initialGuestPeer, reconnectGuestPeer];
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    initialHostPeer.setPartner(initialGuestPeer);
    initialGuestPeer.setPartner(initialHostPeer);
    reconnectHostPeer.setPartner(reconnectGuestPeer);
    reconnectGuestPeer.setPartner(reconnectHostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    initialGuestPeer.failConnection();
    await flushPromises();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(rendezvousClient.reconnectClaims).toContainEqual({
      sessionId: expect.any(String),
      role: "host",
      instanceId: expect.any(String)
    });
    expect(guestRuntime.store.getSnapshot().session?.roomCode).toBe(roomCode);

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("finalizes a failed host reconnect attempt as aborted", async () => {
    const initialHostPeer = new PairedFakePeer();
    const reconnectHostPeer = new PairedFakePeer();
    const initialGuestPeer = new PairedFakePeer();
    const reconnectGuestPeer = new PairedFakePeer();
    const hostPeers = [initialHostPeer, reconnectHostPeer];
    const guestPeers = [initialGuestPeer, reconnectGuestPeer];
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    rendezvousClient.pollForReconnectAnswerState = "expired";
    initialHostPeer.setPartner(initialGuestPeer);
    initialGuestPeer.setPartner(initialHostPeer);
    reconnectHostPeer.setPartner(reconnectGuestPeer);
    reconnectGuestPeer.setPartner(reconnectHostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    guestRuntime.controller.dispose();
    await flushPromises();

    const refreshedGuestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    refreshedGuestRuntime.controller.start();
    refreshedGuestRuntime.controller.reconnect(roomCode);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(rendezvousClient.reconnectFinalizations).toContainEqual({
      role: "host",
      outcome: "aborted"
    });
    expect(hostRuntime.store.getSnapshot().error).toBe("Guest reconnect expired before the direct match could recover.");

    refreshedGuestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("finalizes a failed guest reconnect attempt as aborted", async () => {
    const initialHostPeer = new PairedFakePeer();
    const reconnectHostPeer = new PairedFakePeer();
    const initialGuestPeer = new PairedFakePeer();
    const reconnectGuestPeer = new PairedFakePeer();
    const hostPeers = [initialHostPeer, reconnectHostPeer];
    const guestPeers = [initialGuestPeer, reconnectGuestPeer];
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    reconnectGuestPeer.reconnectAnswerError = new Error("Guest reconnect answer failed.");
    initialHostPeer.setPartner(initialGuestPeer);
    initialGuestPeer.setPartner(initialHostPeer);
    reconnectHostPeer.setPartner(reconnectGuestPeer);
    reconnectGuestPeer.setPartner(reconnectHostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    guestRuntime.controller.dispose();
    await flushPromises();

    const refreshedGuestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    refreshedGuestRuntime.controller.start();
    refreshedGuestRuntime.controller.reconnect(roomCode);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(rendezvousClient.reconnectFinalizations).toContainEqual({
      role: "guest",
      outcome: "aborted"
    });
    expect(refreshedGuestRuntime.store.getSnapshot().error).toBe("Guest reconnect answer failed.");

    refreshedGuestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("preserves guest recovery and shows a displaced message when the guest heartbeat loses its claim", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const scheduler = new FakeScheduler();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence,
      scheduler
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence,
      scheduler
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = guestRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({ role: "guest", roomCode });

    rendezvousClient.heartbeatErrorByRole.guest = new P2PRendezvousRequestError("Claim displaced.", 403);

    await scheduler.runNext();
    await scheduler.runNext();

    expect(rendezvousClient.reconnectHeartbeats).toContainEqual({
      sessionId: expect.any(String),
      role: "guest",
      instanceId: expect.any(String)
    });
    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({ role: "guest", roomCode });
    expect(guestRuntime.store.getSnapshot().session).toBeNull();
    expect(guestRuntime.store.getSnapshot().match).toBeNull();
    expect(guestRuntime.store.getSnapshot().error).toBe(
      "This direct match is active in another tab or window. Use that tab, or reconnect here."
    );

    const guestHeartbeatCount = rendezvousClient.reconnectHeartbeats.filter(
      (heartbeat) => heartbeat.role === "guest"
    ).length;
    await scheduler.runNext();
    expect(
      rendezvousClient.reconnectHeartbeats.filter((heartbeat) => heartbeat.role === "guest")
    ).toHaveLength(guestHeartbeatCount);

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it.each([404, 410] as const)(
    "clears guest recovery and shows a recovery-unavailable message when the guest heartbeat gets %s",
    async (status) => {
      const hostPeer = new PairedFakePeer();
      const guestPeer = new PairedFakePeer();
      const scheduler = new FakeScheduler();
      const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
      const rendezvousClient = new FakeRendezvousClient();

      hostPeer.setPartner(guestPeer);
      guestPeer.setPartner(hostPeer);

      const hostRuntime = createP2PGameClientRuntime({
        createPeer: () => hostPeer,
        rendezvousClient,
        recoveryPersistence: hostRecoveryPersistence,
        scheduler
      });
      const guestRuntime = createP2PGameClientRuntime({
        createPeer: () => guestPeer,
        rendezvousClient,
        recoveryPersistence: guestRecoveryPersistence,
        scheduler
      });

      hostRuntime.controller.start();
      guestRuntime.controller.start();
      hostRuntime.controller.createRoom("Host Player");
      await flushPromises();
      guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
      await flushPromises();
      guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
      await flushPromises();
      await flushPromises();
      await flushPromises();

      const roomCode = guestRuntime.store.getSnapshot().session?.roomCode;

      if (!roomCode) {
        throw new Error("Expected a room code.");
      }

      rendezvousClient.heartbeatErrorByRole.guest = new P2PRendezvousRequestError(
        "Recovery unavailable.",
        status
      );

      await scheduler.runNext();
      await scheduler.runNext();

      expect(guestRecoveryPersistence.read(roomCode)).toBeNull();
      expect(guestRuntime.store.getSnapshot().session).toBeNull();
      expect(guestRuntime.store.getSnapshot().match).toBeNull();
      expect(guestRuntime.store.getSnapshot().error).toBe(
        "Direct-match recovery is no longer available for this session. Start a new direct match if the connection drops again."
      );

      const guestHeartbeatCount = rendezvousClient.reconnectHeartbeats.filter(
        (heartbeat) => heartbeat.role === "guest"
      ).length;
      await scheduler.runNext();
      expect(
        rendezvousClient.reconnectHeartbeats.filter((heartbeat) => heartbeat.role === "guest")
      ).toHaveLength(guestHeartbeatCount);

      guestRuntime.controller.dispose();
      hostRuntime.controller.dispose();
    }
  );

  it("preserves host recovery and deactivates the live host runtime when the host heartbeat loses its claim", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const scheduler = new FakeScheduler();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence,
      scheduler
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence,
      scheduler
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(hostRecoveryPersistence.read(roomCode)).toMatchObject({ role: "host", room: { roomCode } });

    rendezvousClient.heartbeatErrorByRole.host = new P2PRendezvousRequestError("Claim displaced.", 403);

    await scheduler.runNext();
    await scheduler.runNext();

    expect(hostRecoveryPersistence.read(roomCode)).toMatchObject({ role: "host", room: { roomCode } });
    expect(hostRuntime.store.getSnapshot().session).toBeNull();
    expect(hostRuntime.store.getSnapshot().match).toBeNull();
    expect(hostRuntime.store.getSnapshot().error).toBe(
      "This direct match is active in another tab or window. Use that tab, or reconnect here."
    );

    hostRuntime.controller.dispose();
    guestRuntime.controller.dispose();
  });

  it("buffers an early recovery control frame until the guest session exists", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const rendezvousClient = new FakeRendezvousClient();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);
    hostPeer.setAutoConnectOnReconnectAnswer(true);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();

    expect(guestRuntime.store.getSnapshot().session).toBeNull();

    await flushPromises();
    await flushPromises();

    const roomCode = guestRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({
      role: "guest",
      roomCode,
      reconnect: {
        controlSessionId: expect.any(String),
        guestSecret: expect.any(String)
      }
    });

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("surfaces reconnect control registration failures and disables recovery for that session", async () => {
    const initialHostPeer = new PairedFakePeer();
    const reconnectHostPeer = new PairedFakePeer();
    const initialGuestPeer = new PairedFakePeer();
    const reconnectGuestPeer = new PairedFakePeer();
    const hostPeers = [initialHostPeer, reconnectHostPeer];
    const guestPeers = [initialGuestPeer, reconnectGuestPeer];
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    rendezvousClient.registerReconnectControlSessionError = new Error(
      "Reconnect recovery could not be registered."
    );
    initialHostPeer.setPartner(initialGuestPeer);
    initialGuestPeer.setPartner(initialHostPeer);
    reconnectHostPeer.setPartner(reconnectGuestPeer);
    reconnectGuestPeer.setPartner(reconnectHostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(hostRuntime.store.getSnapshot().error).toBe("Reconnect recovery could not be registered.");

    initialHostPeer.disconnect();
    await flushPromises();
    await flushPromises();

    expect(rendezvousClient.reconnectClaims).toEqual([]);
    expect(hostRuntime.p2p?.getSnapshot().host.stage).toBe("closed");

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it.each([
    ["expired", "This direct-match link has expired. Start a new direct match."],
    ["answered", "This direct-match link was already used by another guest. Ask the host for a new link."],
    ["finalized", "This direct-match link has already finished setup. Ask the host for a new link."]
  ] as const)("refuses %s guest links before creating an answer", async (sessionState, message) => {
    const guestPeer = new PairedFakePeer();
    const rendezvousClient = new FakeRendezvousClient();

    rendezvousClient.sessionState = sessionState;

    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient
    });

    guestRuntime.controller.start();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();

    expect(guestRuntime.p2p?.getSnapshot().guest.stage).toBe("failed");
    expect(guestRuntime.p2p?.getSnapshot().guest.error).toBe(message);

    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();

    expect(guestPeer.guestAnswerCalls).toBe(0);
    expect(rendezvousClient.submitAnswerCalls).toBe(0);
    expect(guestRuntime.p2p?.getSnapshot().guest.stage).toBe("failed");
    expect(guestRuntime.p2p?.getSnapshot().guest.error).toBe(message);

    guestRuntime.controller.dispose();
  });

  it("fails host setup if pollForAnswer returns an expired session with an answer", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const rendezvousClient = new FakeRendezvousClient();

    rendezvousClient.pollForAnswerState = "expired";
    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();

    expect(hostRuntime.p2p?.getSnapshot().host.stage).toBe("failed");
    expect(hostRuntime.p2p?.getSnapshot().host.error).toBe(
      "This direct-match link expired before a guest connected. Start a new direct match."
    );
    expect(hostRuntime.store.getSnapshot().match?.phase).not.toBe("live");
    expect(hostRuntime.store.getSnapshot().session?.roomCode).not.toBe(
      guestRuntime.store.getSnapshot().session?.roomCode
    );

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("fails host setup without admitting the guest when finalization fails", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const rendezvousClient = new FakeRendezvousClient();

    rendezvousClient.finalizeSessionError = new Error("Failed to finalize direct-match signaling.");
    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();

    expect(rendezvousClient.finalizeSessionCalls).toBe(1);
    expect(hostRuntime.p2p?.getSnapshot().host.stage).toBe("failed");
    expect(hostRuntime.p2p?.getSnapshot().host.error).toBe("Failed to finalize direct-match signaling.");
    expect(hostRuntime.store.getSnapshot().match?.phase).not.toBe("live");
    expect(guestRuntime.store.getSnapshot().session?.roomCode).not.toBe(
      hostRuntime.store.getSnapshot().session?.roomCode
    );

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it.each([
    ["expired", "This direct-match link has expired. Start a new direct match."],
    [
      "answered",
      "This direct-match link was already used by another guest. Ask the host for a new link."
    ],
    [
      "finalized",
      "This direct-match link has already finished setup. Ask the host for a new link."
    ]
  ] as const)(
    "revalidates the guest session before creating an answer and refuses %s links",
    async (revalidatedSessionState, message) => {
      const guestPeer = new PairedFakePeer();
      const rendezvousClient = new FakeRendezvousClient();

      rendezvousClient.revalidatedSessionState = revalidatedSessionState;

      const guestRuntime = createP2PGameClientRuntime({
        createPeer: () => guestPeer,
        rendezvousClient
      });

      guestRuntime.controller.start();
      guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
      await flushPromises();
      guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
      await flushPromises();

      expect(rendezvousClient.getSessionCalls).toBe(2);
      expect(guestPeer.guestAnswerCalls).toBe(0);
      expect(rendezvousClient.submitAnswerCalls).toBe(0);
      expect(guestRuntime.p2p?.getSnapshot().guest.stage).toBe("failed");
      expect(guestRuntime.p2p?.getSnapshot().guest.error).toBe(message);

      guestRuntime.controller.dispose();
    }
  );

  it("fails guest answer creation when revalidation cannot be loaded", async () => {
    const guestPeer = new PairedFakePeer();
    const rendezvousClient = new FakeRendezvousClient();

    rendezvousClient.getSessionErrorAtCall = 2;
    rendezvousClient.getSessionError = new Error("This direct-match link could not be revalidated.");

    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient
    });

    guestRuntime.controller.start();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();

    expect(rendezvousClient.getSessionCalls).toBe(2);
    expect(guestPeer.guestAnswerCalls).toBe(0);
    expect(rendezvousClient.submitAnswerCalls).toBe(0);
    expect(guestRuntime.p2p?.getSnapshot().guest.stage).toBe("failed");
    expect(guestRuntime.p2p?.getSnapshot().guest.error).toBe(
      "This direct-match link could not be revalidated."
    );

    guestRuntime.controller.dispose();
  });

  it("short-circuits guest answer creation when the loaded link has already expired locally", async () => {
    const guestPeer = new PairedFakePeer();
    const rendezvousClient = new FakeRendezvousClient();

    rendezvousClient.expiresAt = 100;
    vi.spyOn(Date, "now").mockReturnValue(100);

    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient
    });

    guestRuntime.controller.start();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();

    expect(rendezvousClient.getSessionCalls).toBe(1);
    expect(guestPeer.guestAnswerCalls).toBe(0);
    expect(rendezvousClient.submitAnswerCalls).toBe(0);
    expect(guestRuntime.p2p?.getSnapshot().guest.stage).toBe("failed");
    expect(guestRuntime.p2p?.getSnapshot().guest.error).toBe(
      "This direct-match link has expired. Start a new direct match."
    );

    guestRuntime.controller.dispose();
  });

  it("preserves recovery records when host claim is lost so the displaced tab can reclaim", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const scheduler = new FakeScheduler();
    const { hostRecoveryPersistence } = createRecoveryPersistences();
    const guestRecoveryPersistence = new MemoryRecoveryPersistence();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence,
      scheduler
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence,
      scheduler
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(hostRecoveryPersistence.read(roomCode)).toMatchObject({ role: "host", room: { roomCode } });

    rendezvousClient.heartbeatErrorByRole.host = new P2PRendezvousRequestError("Claim displaced.", 403);

    await scheduler.runNext();
    await scheduler.runNext();

    expect(hostRecoveryPersistence.read(roomCode)).toMatchObject({ role: "host", room: { roomCode } });
    expect(hostRuntime.store.getSnapshot().error).toBe(
      "This direct match is active in another tab or window. Use that tab, or reconnect here."
    );

    hostRuntime.controller.dispose();
    guestRuntime.controller.dispose();
  });

  it("preserves recovery records when guest claim is lost so the displaced tab can reclaim", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const scheduler = new FakeScheduler();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence,
      scheduler
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence,
      scheduler
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = guestRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({ role: "guest", roomCode });

    rendezvousClient.heartbeatErrorByRole.guest = new P2PRendezvousRequestError("Claim displaced.", 403);

    await scheduler.runNext();
    await scheduler.runNext();

    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({ role: "guest", roomCode });
    expect(guestRuntime.store.getSnapshot().error).toBe(
      "This direct match is active in another tab or window. Use that tab, or reconnect here."
    );

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("host recovery record captures new match state after rematch", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(hostRuntime.store.getSnapshot().match?.phase).toBe("live");

    const firstRecord = hostRecoveryPersistence.read(roomCode);

    expect(firstRecord).toMatchObject({ role: "host", match: expect.objectContaining({ phase: "live" }) });

    const firstMatchCreatedAt = firstRecord?.role === "host" ? firstRecord.match?.createdAt : undefined;

    expect(firstMatchCreatedAt).toEqual(expect.any(Number));

    // Resign the match to finish it
    hostRuntime.controller.resignMatch();
    await flushPromises();

    expect(hostRuntime.store.getSnapshot().match?.phase).toBe("finished");

    // Both players request rematch → new match starts
    hostRuntime.controller.requestRematch();
    await flushPromises();
    guestRuntime.controller.requestRematch();
    await flushPromises();

    expect(hostRuntime.store.getSnapshot().match?.phase).toBe("live");

    const rematchRecord = hostRecoveryPersistence.read(roomCode);

    expect(rematchRecord).toMatchObject({
      role: "host",
      match: expect.objectContaining({ phase: "live" })
    });

    const rematchCreatedAt = rematchRecord?.role === "host" ? rematchRecord.match?.createdAt : undefined;

    expect(rematchCreatedAt).toEqual(expect.any(Number));
    expect(rematchCreatedAt).not.toBe(firstMatchCreatedAt);

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("guest auto-reconnects after host peer closes during a live match", async () => {
    const initialGuestPeer = new PairedFakePeer();
    const reconnectGuestPeer = new PairedFakePeer();
    const hostPeer = new PairedFakePeer();
    const guestPeers = [initialGuestPeer, reconnectGuestPeer];
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(initialGuestPeer);
    initialGuestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeers.shift() ?? new PairedFakePeer(),
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = guestRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(guestRuntime.store.getSnapshot().match?.phase).toBe("live");
    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({ role: "guest", roomCode });

    // Simulate the guest peer closing (e.g. host tab closes, ICE failure)
    initialGuestPeer.disconnect();
    await flushPromises();

    // tryAutoReconnectGuest should fire: the guest runtime calls reconnect(),
    // which reads the guest recovery record and starts the guest reconnect flow.
    // The recovery record should still exist.
    expect(guestRecoveryPersistence.read(roomCode)).toMatchObject({ role: "guest", roomCode });

    // The reconnect claim should have been submitted for the guest role
    expect(rendezvousClient.reconnectClaims).toContainEqual({
      sessionId: expect.any(String),
      role: "guest",
      instanceId: expect.any(String)
    });

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });

  it("host recovery record preserves finished match state for rematch window", async () => {
    const hostPeer = new PairedFakePeer();
    const guestPeer = new PairedFakePeer();
    const { hostRecoveryPersistence, guestRecoveryPersistence } = createRecoveryPersistences();
    const rendezvousClient = new FakeRendezvousClient();

    hostPeer.setPartner(guestPeer);
    guestPeer.setPartner(hostPeer);

    const hostRuntime = createP2PGameClientRuntime({
      createPeer: () => hostPeer,
      rendezvousClient,
      recoveryPersistence: hostRecoveryPersistence
    });
    const guestRuntime = createP2PGameClientRuntime({
      createPeer: () => guestPeer,
      rendezvousClient,
      recoveryPersistence: guestRecoveryPersistence
    });

    hostRuntime.controller.start();
    guestRuntime.controller.start();
    hostRuntime.controller.createRoom("Host Player");
    await flushPromises();
    guestRuntime.p2p?.controller.openGuestSetupSession("session-1");
    await flushPromises();
    guestRuntime.p2p?.controller.createGuestAnswer("Guest Player");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const roomCode = hostRuntime.store.getSnapshot().session?.roomCode;

    if (!roomCode) {
      throw new Error("Expected a room code.");
    }

    expect(hostRuntime.store.getSnapshot().match?.phase).toBe("live");

    // Resign to finish the match
    hostRuntime.controller.resignMatch();
    await flushPromises();

    expect(hostRuntime.store.getSnapshot().match?.phase).toBe("finished");

    const finishedRecord = hostRecoveryPersistence.read(roomCode);

    expect(finishedRecord).toMatchObject({
      role: "host",
      match: expect.objectContaining({ phase: "finished" })
    });

    guestRuntime.controller.dispose();
    hostRuntime.controller.dispose();
  });
});
