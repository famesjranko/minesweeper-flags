import type {
  GuestAnswerPayload,
  HostOfferPayload,
  ReconnectAnswerPayload,
  ReconnectOfferPayload
} from "@minesweeper-flags/shared";

export type WebRTCPeerStatus =
  | "idle"
  | "creating-offer"
  | "waiting-for-answer"
  | "creating-answer"
  | "waiting-for-host-finalize"
  | "connecting"
  | "connected"
  | "failed"
  | "closed";

export interface WebRTCPeerStatusChange {
  status: WebRTCPeerStatus;
  error?: string;
}

export interface WebRTCPeerListener {
  onMessage?: (message: string) => void;
  onStatusChange?: (change: WebRTCPeerStatusChange) => void;
}

export interface WebRTCPeerOptions {
  rtcConfiguration?: RTCConfiguration;
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection;
  dataChannelLabel?: string;
  dataChannelOptions?: RTCDataChannelInit;
  now?: () => number;
}

export interface WebRTCPeerTransportSource {
  disconnect: () => void;
  getStatus: () => WebRTCPeerStatus;
  send: (message: string) => void;
  subscribe: (listener: WebRTCPeerListener) => () => void;
}

export interface WebRTCPeerController extends WebRTCPeerTransportSource {
  createHostOffer: () => Promise<HostOfferPayload>;
  createGuestAnswer: (offerPayload: HostOfferPayload, displayName: string) => Promise<GuestAnswerPayload>;
  applyGuestAnswer: (answerPayload: GuestAnswerPayload) => Promise<void>;
  createReconnectOffer: () => Promise<ReconnectOfferPayload>;
  createReconnectAnswer: (offerPayload: ReconnectOfferPayload) => Promise<ReconnectAnswerPayload>;
  applyReconnectAnswer: (answerPayload: ReconnectAnswerPayload) => Promise<void>;
}
