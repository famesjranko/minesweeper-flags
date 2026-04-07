import type { GuestAnswerPayload, HostOfferPayload, SignalingSessionState } from "@minesweeper-flags/shared";
import type {
  P2PGuestSetupState,
  P2PHostSetupState,
  P2PSetupSnapshot,
  P2PSetupStage
} from "./p2p-setup.types.js";

type Listener = () => void;

const createInitialHostState = (): P2PHostSetupState => ({
  role: "host",
  stage: "idle",
  displayName: "",
  error: null,
  offerPayload: null,
  offerUrlFragment: null,
  sessionId: null,
  hostSecret: null,
  sessionState: null,
  expiresAt: null,
  joinUrl: null,
  guestAnswerText: "",
  guestAnswerPayload: null
});

const createInitialGuestState = (): P2PGuestSetupState => ({
  role: "guest",
  stage: "idle",
  displayName: "",
  error: null,
  sessionId: null,
  sessionState: null,
  expiresAt: null,
  offerPayload: null,
  answerPayload: null,
  answerText: null
});

export const createP2PSetupSnapshot = (): P2PSetupSnapshot => ({
  host: createInitialHostState(),
  guest: createInitialGuestState()
});

export class P2PSetupStore {
  private snapshot: P2PSetupSnapshot;
  private readonly listeners = new Set<Listener>();

  constructor(initialSnapshot: P2PSetupSnapshot = createP2PSetupSnapshot()) {
    this.snapshot = initialSnapshot;
  }

  getSnapshot = (): P2PSetupSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  resetHost(): void {
    this.update((current) => ({
      ...current,
      host: createInitialHostState()
    }));
  }

  resetGuest(): void {
    this.update((current) => ({
      ...current,
      guest: createInitialGuestState()
    }));
  }

  setHostDisplayName(displayName: string): void {
    this.updateHost((current) => ({
      ...current,
      displayName
    }));
  }

  setGuestDisplayName(displayName: string): void {
    this.updateGuest((current) => ({
      ...current,
      displayName
    }));
  }

  setHostStage(stage: P2PSetupStage): void {
    this.updateHost((current) => ({
      ...current,
      stage
    }));
  }

  setGuestStage(stage: P2PSetupStage): void {
    this.updateGuest((current) => ({
      ...current,
      stage
    }));
  }

  setHostError(error: string | null): void {
    this.updateHost((current) => ({
      ...current,
      error
    }));
  }

  setGuestError(error: string | null): void {
    this.updateGuest((current) => ({
      ...current,
      error
    }));
  }

  setHostOffer(payload: HostOfferPayload, offerUrlFragment: string | null = null): void {
    this.updateHost((current) => ({
      ...current,
      offerPayload: payload,
      offerUrlFragment,
      error: null
    }));
  }

  setHostSession({
    sessionId,
    hostSecret,
    sessionState,
    expiresAt,
    joinUrl
  }: {
    sessionId: string;
    hostSecret: string;
    sessionState: SignalingSessionState;
    expiresAt: number;
    joinUrl: string;
  }): void {
    this.updateHost((current) => ({
      ...current,
      sessionId,
      hostSecret,
      sessionState,
      expiresAt,
      joinUrl,
      error: null
    }));
  }

  setHostSessionState(sessionState: SignalingSessionState): void {
    this.updateHost((current) => ({
      ...current,
      sessionState
    }));
  }

  setGuestOffer(payload: HostOfferPayload): void {
    this.updateGuest((current) => ({
      ...current,
      offerPayload: payload,
      error: null
    }));
  }

  setGuestSessionId(sessionId: string): void {
    this.updateGuest((current) => ({
      ...current,
      sessionId
    }));
  }

  setGuestSession({
    sessionId,
    sessionState,
    expiresAt,
    offerPayload
  }: {
    sessionId: string;
    sessionState: SignalingSessionState;
    expiresAt: number;
    offerPayload: HostOfferPayload;
  }): void {
    this.updateGuest((current) => ({
      ...current,
      sessionId,
      sessionState,
      expiresAt,
      offerPayload,
      error: null
    }));
  }

  setGuestSessionState(sessionState: SignalingSessionState): void {
    this.updateGuest((current) => ({
      ...current,
      sessionState
    }));
  }

  setGuestAnswerText(guestAnswerText: string): void {
    this.updateHost((current) => ({
      ...current,
      guestAnswerText
    }));
  }

  setAppliedGuestAnswer(payload: GuestAnswerPayload): void {
    this.updateHost((current) => ({
      ...current,
      guestAnswerPayload: payload,
      error: null
    }));
  }

  setGeneratedGuestAnswer(payload: GuestAnswerPayload, answerText: string | null): void {
    this.updateGuest((current) => ({
      ...current,
      answerPayload: payload,
      answerText,
      error: null
    }));
  }

  private updateHost(nextState: (current: P2PHostSetupState) => P2PHostSetupState): void {
    this.update((current) => ({
      ...current,
      host: nextState(current.host)
    }));
  }

  private updateGuest(nextState: (current: P2PGuestSetupState) => P2PGuestSetupState): void {
    this.update((current) => ({
      ...current,
      guest: nextState(current.guest)
    }));
  }

  private update(nextSnapshot: (current: P2PSetupSnapshot) => P2PSetupSnapshot): void {
    const updated = nextSnapshot(this.snapshot);

    if (updated === this.snapshot) {
      return;
    }

    this.snapshot = updated;

    for (const listener of this.listeners) {
      listener();
    }
  }
}
