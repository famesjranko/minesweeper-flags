import {
  claimReconnectRoleResponseSchema,
  createSignalingSessionResponseSchema,
  finalizeReconnectAttemptResponseSchema,
  finalizeSignalingSessionResponseSchema,
  getReconnectControlSessionResponseSchema,
  getReconnectFinalizationResponseSchema,
  heartbeatReconnectRoleResponseSchema,
  readReconnectAnswerResponseSchema,
  readReconnectOfferResponseSchema,
  registerReconnectControlSessionResponseSchema,
  writeReconnectAnswerResponseSchema,
  writeReconnectOfferResponseSchema,
  getSignalingAnswerRequestSchema,
  getSignalingAnswerResponseSchema,
  getSignalingFinalizationResponseSchema,
  getSignalingSessionResponseSchema,
  submitSignalingAnswerResponseSchema,
  type CreateSignalingSessionResponse,
  type FinalizeSignalingSessionResponse,
  type FinalizeReconnectAttemptResponse,
  type GetSignalingAnswerResponse,
  type GetSignalingFinalizationResponse,
  type GetSignalingSessionResponse,
  type GuestAnswerPayload,
  type HeartbeatReconnectRoleResponse,
  type HostOfferPayload,
  type ClaimReconnectRoleResponse,
  type GetReconnectControlSessionResponse,
  type GetReconnectFinalizationResponse,
  type ReadReconnectAnswerResponse,
  type ReadReconnectOfferResponse,
  type ReconnectAnswerPayload,
  type ReconnectControlRole,
  type ReconnectOfferPayload,
  type RegisterReconnectControlSessionResponse,
  type SubmitSignalingAnswerResponse
} from "@minesweeper-flags/shared";
import { P2P_SIGNALING_URL } from "../../lib/config/env.js";
import type { ZodType } from "zod";

const DEFAULT_POLL_INTERVAL_MS = 1_000;

type FetchLike = typeof fetch;

const defaultFetch: FetchLike = (...args) => globalThis.fetch(...args);

interface PollOptions {
  intervalMs?: number;
  signal?: AbortSignal;
}

interface RequestOptions {
  method: "GET" | "POST";
  body?: unknown | undefined;
  signal?: AbortSignal | undefined;
}

export class P2PRendezvousRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "P2PRendezvousRequestError";
    this.status = status;
  }
}

export interface P2PRendezvousClientOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  sleep?: (durationMs: number, signal?: AbortSignal) => Promise<void>;
}

const createAbortError = () => new DOMException("The operation was aborted.", "AbortError");

const defaultSleep = (durationMs: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const getErrorMessage = (status: number): string => {
  switch (status) {
    case 404:
      return "This direct-match link could not be found.";
    case 409:
      return "This direct-match link is no longer available.";
    case 410:
      return "This direct-match link has expired. Start a new direct match.";
    case 429:
      return "Direct match setup is busy right now. Please try again.";
    default:
      return "Direct match setup failed. Please try again.";
  }
};

export class P2PRendezvousClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: (durationMs: number, signal?: AbortSignal) => Promise<void>;

  constructor({
    baseUrl = P2P_SIGNALING_URL,
    fetch: fetchImpl = defaultFetch,
    sleep = defaultSleep
  }: P2PRendezvousClientOptions = {}) {
    this.baseUrl = (baseUrl ?? "").replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleep;
  }

  createSession = (offer: HostOfferPayload, signal?: AbortSignal): Promise<CreateSignalingSessionResponse> =>
    this.request(
      "/signaling/sessions",
      {
        method: "POST",
        body: { offer },
        signal
      },
      createSignalingSessionResponseSchema
    );

  getSession = (sessionId: string, signal?: AbortSignal): Promise<GetSignalingSessionResponse> =>
    this.request(
      `/signaling/sessions/${encodeURIComponent(sessionId)}`,
      { method: "GET", signal },
      getSignalingSessionResponseSchema
    );

  submitAnswer = (
    sessionId: string,
    answer: GuestAnswerPayload,
    signal?: AbortSignal
  ): Promise<SubmitSignalingAnswerResponse> =>
    this.request(
      `/signaling/sessions/${encodeURIComponent(sessionId)}/answer`,
      {
        method: "POST",
        body: { answer },
        signal
      },
      submitSignalingAnswerResponseSchema
    );

  getAnswer = (
    sessionId: string,
    hostSecret: string,
    signal?: AbortSignal
  ): Promise<GetSignalingAnswerResponse> =>
    this.request(
      `/signaling/sessions/${encodeURIComponent(sessionId)}/answer/read`,
      {
        method: "POST",
        body: getSignalingAnswerRequestSchema.parse({ hostSecret }),
        signal
      },
      getSignalingAnswerResponseSchema
    );

  finalizeSession = (
    sessionId: string,
    hostSecret: string,
    signal?: AbortSignal
  ): Promise<FinalizeSignalingSessionResponse> =>
    this.request(
      `/signaling/sessions/${encodeURIComponent(sessionId)}/finalize`,
      {
        method: "POST",
        body: { hostSecret },
        signal
      },
      finalizeSignalingSessionResponseSchema
    );

  getFinalization = (sessionId: string, signal?: AbortSignal): Promise<GetSignalingFinalizationResponse> =>
    this.request(
      `/signaling/sessions/${encodeURIComponent(sessionId)}/finalization`,
      { method: "GET", signal },
      getSignalingFinalizationResponseSchema
    );

  pollForAnswer = async (
    sessionId: string,
    hostSecret: string,
    { intervalMs = DEFAULT_POLL_INTERVAL_MS, signal }: PollOptions = {}
  ): Promise<GetSignalingAnswerResponse> => {
    while (true) {
      const response = await this.getAnswer(sessionId, hostSecret, signal);

      if (response.answer || response.state === "expired") {
        return response;
      }

      await this.sleepImpl(intervalMs, signal);
    }
  };

  pollForFinalization = async (
    sessionId: string,
    { intervalMs = DEFAULT_POLL_INTERVAL_MS, signal }: PollOptions = {}
  ): Promise<GetSignalingFinalizationResponse> => {
    while (true) {
      const response = await this.getFinalization(sessionId, signal);

      if (response.state === "finalized" || response.state === "expired") {
        return response;
      }

      await this.sleepImpl(intervalMs, signal);
    }
  };

  registerReconnectControlSession = (
    sessionId: string,
    hostSecret: string,
    guestSecret: string,
    signal?: AbortSignal
  ): Promise<RegisterReconnectControlSessionResponse> =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/register`,
      {
        method: "POST",
        body: { sessionId, hostSecret, guestSecret },
        signal
      },
      registerReconnectControlSessionResponseSchema
    );

  getReconnectControlSession = (
    sessionId: string,
    secret: string,
    instanceId: string,
    signal?: AbortSignal
  ): Promise<GetReconnectControlSessionResponse> =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/read`,
      {
        method: "POST",
        body: { secret, instanceId },
        signal
      },
      getReconnectControlSessionResponseSchema
    );

  claimReconnectRole = (
    sessionId: string,
    role: ReconnectControlRole,
    secret: string,
    instanceId: string,
    signal?: AbortSignal
  ): Promise<ClaimReconnectRoleResponse> =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/claim`,
      {
        method: "POST",
        body: { role, secret, instanceId },
        signal
      },
      claimReconnectRoleResponseSchema
    );

  heartbeatReconnectRole = (
    sessionId: string,
    role: ReconnectControlRole,
    secret: string,
    instanceId: string,
    signal?: AbortSignal
  ): Promise<HeartbeatReconnectRoleResponse> =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/heartbeat`,
      {
        method: "POST",
        body: { role, secret, instanceId },
        signal
      },
      heartbeatReconnectRoleResponseSchema
    );

  writeReconnectOffer = (
    sessionId: string,
    secret: string,
    instanceId: string,
    offer: ReconnectOfferPayload,
    signal?: AbortSignal
  ) =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/offer`,
      {
        method: "POST",
        body: { secret, instanceId, offer },
        signal
      },
      writeReconnectOfferResponseSchema
    );

  readReconnectOffer = (
    sessionId: string,
    secret: string,
    instanceId: string,
    signal?: AbortSignal
  ): Promise<ReadReconnectOfferResponse> =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/offer/read`,
      {
        method: "POST",
        body: { secret, instanceId },
        signal
      },
      readReconnectOfferResponseSchema
    );

  writeReconnectAnswer = (
    sessionId: string,
    secret: string,
    instanceId: string,
    answer: ReconnectAnswerPayload,
    signal?: AbortSignal
  ) =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/answer`,
      {
        method: "POST",
        body: { secret, instanceId, answer },
        signal
      },
      writeReconnectAnswerResponseSchema
    );

  readReconnectAnswer = (
    sessionId: string,
    secret: string,
    instanceId: string,
    signal?: AbortSignal
  ): Promise<ReadReconnectAnswerResponse> =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/answer/read`,
      {
        method: "POST",
        body: { secret, instanceId },
        signal
      },
      readReconnectAnswerResponseSchema
    );

  finalizeReconnectAttempt = (
    sessionId: string,
    role: ReconnectControlRole,
    secret: string,
    instanceId: string,
    outcome: "reconnected" | "aborted",
    signal?: AbortSignal
  ): Promise<FinalizeReconnectAttemptResponse> =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/finalize`,
      {
        method: "POST",
        body: { role, secret, instanceId, outcome },
        signal
      },
      finalizeReconnectAttemptResponseSchema
    );

  getReconnectFinalization = (
    sessionId: string,
    secret: string,
    instanceId: string,
    signal?: AbortSignal
  ): Promise<GetReconnectFinalizationResponse> =>
    this.request(
      `/signaling/reconnect/${encodeURIComponent(sessionId)}/finalization/read`,
      {
        method: "POST",
        body: { secret, instanceId },
        signal
      },
      getReconnectFinalizationResponseSchema
    );

  pollForReconnectOffer = async (
    sessionId: string,
    secret: string,
    instanceId: string,
    { intervalMs = DEFAULT_POLL_INTERVAL_MS, signal }: PollOptions = {}
  ): Promise<ReadReconnectOfferResponse> => {
    while (true) {
      const response = await this.readReconnectOffer(sessionId, secret, instanceId, signal);

      if (response.offer || response.state === "expired" || response.attempt.status === "finalized") {
        return response;
      }

      await this.sleepImpl(intervalMs, signal);
    }
  };

  pollForReconnectAnswer = async (
    sessionId: string,
    secret: string,
    instanceId: string,
    { intervalMs = DEFAULT_POLL_INTERVAL_MS, signal }: PollOptions = {}
  ): Promise<ReadReconnectAnswerResponse> => {
    while (true) {
      const response = await this.readReconnectAnswer(sessionId, secret, instanceId, signal);

      if (response.answer || response.state === "expired" || response.attempt.status === "finalized") {
        return response;
      }

      await this.sleepImpl(intervalMs, signal);
    }
  };

  pollForReconnectFinalization = async (
    sessionId: string,
    secret: string,
    instanceId: string,
    { intervalMs = DEFAULT_POLL_INTERVAL_MS, signal }: PollOptions = {}
  ): Promise<GetReconnectFinalizationResponse> => {
    while (true) {
      const response = await this.getReconnectFinalization(sessionId, secret, instanceId, signal);

      if (response.state === "expired" || response.attempt.status === "finalized") {
        return response;
      }

      await this.sleepImpl(intervalMs, signal);
    }
  };

  private async request<TResponse>(
    path: string,
    { method, body, signal }: RequestOptions,
    schema: ZodType<TResponse>
  ): Promise<TResponse> {
    const init: RequestInit = { method };

    if (signal) {
      init.signal = signal;
    }

    if (body) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      let message = getErrorMessage(response.status);

      if (response.status === 403 || response.status >= 500) {
        try {
          const payload = await response.json();

          if (
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string" &&
            payload.error.trim()
          ) {
            message = payload.error;
          }
        } catch {
          // Fall back to the status-based message when the error body is unreadable.
        }
      }

      throw new P2PRendezvousRequestError(message, response.status);
    }

    const payload = await response.json();
    const result = schema.safeParse(payload);

    if (!result.success) {
      throw new Error("Direct match setup returned an invalid response.");
    }

    return result.data;
  }
}

export const createP2PRendezvousClient = (
  options: P2PRendezvousClientOptions = {}
): P2PRendezvousClient => new P2PRendezvousClient(options);
