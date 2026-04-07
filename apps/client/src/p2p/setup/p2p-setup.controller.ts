import type { GuestAnswerPayload, HostOfferPayload, SignalingSessionState } from "@minesweeper-flags/shared";
import { P2PSetupStore } from "./p2p-setup.store.js";
import type { P2PSetupStage } from "./p2p-setup.types.js";

export const getGuestDirectJoinUnavailableMessage = (
  sessionState: SignalingSessionState | null | undefined
): string | null => {
  switch (sessionState) {
    case "expired":
      return "This direct-match link has expired. Start a new direct match.";
    case "answered":
      return "This direct-match link was already used by another guest. Ask the host for a new link.";
    case "finalized":
      return "This direct-match link has already finished setup. Ask the host for a new link.";
    default:
      return null;
  }
};

export class P2PSetupController {
  constructor(private readonly store: P2PSetupStore) {}

  resetHost = (): void => {
    this.store.resetHost();
  };

  resetGuest = (): void => {
    this.store.resetGuest();
  };

  startHostOfferCreation = (displayName: string): void => {
    this.store.resetHost();
    this.store.setHostDisplayName(displayName);
    this.store.setHostStage("creating-offer");
  };

  completeHostOfferCreation = ({
    displayName,
    offerPayload
  }: {
    displayName: string;
    offerPayload: HostOfferPayload;
  }): void => {
    this.store.setHostDisplayName(displayName);
    this.store.setHostOffer(offerPayload);
    this.store.setHostStage("creating-session");
  };

  completeHostSessionCreation = ({
    sessionId,
    hostSecret,
    expiresAt,
    sessionState,
    joinUrl
  }: {
    sessionId: string;
    hostSecret: string;
    expiresAt: number;
    sessionState: SignalingSessionState;
    joinUrl: string;
  }): void => {
    this.store.setHostSession({
      sessionId,
      hostSecret,
      expiresAt,
      sessionState,
      joinUrl
    });
    this.store.setHostStage("waiting-for-guest");
  };

  setGuestAnswerText = (value: string): void => {
    this.store.setGuestAnswerText(value);
  };

  applyGuestAnswer = (payload: GuestAnswerPayload): void => {
    this.store.setAppliedGuestAnswer(payload);
    this.store.setHostStage("applying-answer");
  };

  startGuestSessionLoad = (sessionId: string): void => {
    this.store.resetGuest();
    this.store.setGuestSessionId(sessionId);
    this.store.setGuestStage("loading-session");
  };

  openGuestSetup = ({
    offerPayload,
    displayName = ""
  }: {
    offerPayload: HostOfferPayload;
    displayName?: string;
  }): void => {
    this.store.resetGuest();
    this.store.setGuestDisplayName(displayName);
    this.store.setGuestOffer(offerPayload);
  };

  completeGuestSessionLoad = ({
    sessionId,
    offerPayload,
    expiresAt,
    sessionState,
    displayName = ""
  }: {
    sessionId: string;
    offerPayload: HostOfferPayload;
    expiresAt: number;
    sessionState: SignalingSessionState;
    displayName?: string;
  }): void => {
    this.store.setGuestDisplayName(displayName);
    this.store.setGuestSession({
      sessionId,
      sessionState,
      expiresAt,
      offerPayload
    });

    const unavailableMessage = getGuestDirectJoinUnavailableMessage(sessionState);

    if (unavailableMessage) {
      this.store.setGuestError(unavailableMessage);
      this.store.setGuestStage("failed");
      return;
    }

    this.store.setGuestStage("idle");
  };

  startGuestAnswerCreation = (displayName: string): void => {
    this.store.setGuestDisplayName(displayName);
    this.store.setGuestStage("creating-answer");
  };

  completeGuestAnswerCreation = ({
    displayName,
    answerPayload
  }: {
    displayName: string;
    answerPayload: GuestAnswerPayload;
  }): void => {
    this.store.setGuestDisplayName(displayName);
    this.store.setGeneratedGuestAnswer(answerPayload, null);
    this.store.setGuestStage("submitting-answer");
  };

  completeGuestAnswerSubmission = (sessionState: SignalingSessionState): void => {
    this.store.setGuestSessionState(sessionState);
    this.store.setGuestStage("waiting-for-host-finalize");
  };

  setHostSessionState = (sessionState: SignalingSessionState): void => {
    this.store.setHostSessionState(sessionState);
  };

  setGuestSessionState = (sessionState: SignalingSessionState): void => {
    this.store.setGuestSessionState(sessionState);
  };

  setHostStage = (stage: P2PSetupStage): void => {
    this.store.setHostStage(stage);
  };

  setGuestStage = (stage: P2PSetupStage): void => {
    this.store.setGuestStage(stage);
  };

  failHostSetup = (error: string): void => {
    this.store.setHostError(error);
    this.store.setHostStage("failed");
  };

  failGuestSetup = (error: string): void => {
    this.store.setGuestError(error);
    this.store.setGuestStage("failed");
  };

  clearHostError = (): void => {
    this.store.setHostError(null);
  };

  clearGuestError = (): void => {
    this.store.setGuestError(null);
  };
}

export const createP2PSetupController = (): {
  controller: P2PSetupController;
  store: P2PSetupStore;
} => {
  const store = new P2PSetupStore();

  return {
    controller: new P2PSetupController(store),
    store
  };
};
