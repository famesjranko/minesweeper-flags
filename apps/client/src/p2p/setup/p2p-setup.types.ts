import type { GuestAnswerPayload, HostOfferPayload, SignalingSessionState } from "@minesweeper-flags/shared";

export type P2PSetupStage =
  | "idle"
  | "loading-session"
  | "creating-offer"
  | "creating-session"
  | "waiting-for-guest"
  | "applying-answer"
  | "creating-answer"
  | "submitting-answer"
  | "waiting-for-host-finalize"
  | "connecting"
  | "connected"
  | "failed"
  | "closed";

interface P2PSetupStateBase {
  stage: P2PSetupStage;
  displayName: string;
  error: string | null;
}

export interface P2PHostSetupState extends P2PSetupStateBase {
  role: "host";
  offerPayload: HostOfferPayload | null;
  offerUrlFragment: string | null;
  sessionId: string | null;
  hostSecret: string | null;
  sessionState: SignalingSessionState | null;
  expiresAt: number | null;
  joinUrl: string | null;
  guestAnswerText: string;
  guestAnswerPayload: GuestAnswerPayload | null;
}

export interface P2PGuestSetupState extends P2PSetupStateBase {
  role: "guest";
  sessionId: string | null;
  sessionState: SignalingSessionState | null;
  expiresAt: number | null;
  offerPayload: HostOfferPayload | null;
  answerPayload: GuestAnswerPayload | null;
  answerText: string | null;
}

export interface P2PSetupSnapshot {
  host: P2PHostSetupState;
  guest: P2PGuestSetupState;
}
