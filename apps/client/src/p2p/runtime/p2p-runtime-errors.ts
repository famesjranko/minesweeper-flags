import { P2PRendezvousRequestError } from "../signaling/p2p-rendezvous-client.js";

export const DIRECT_MATCH_DISPLACED_MESSAGE =
  "This direct match is active in another tab or window. Use that tab, or reconnect here.";
export const DIRECT_MATCH_RECOVERY_UNAVAILABLE_MESSAGE =
  "Direct-match recovery is no longer available for this session. Start a new direct match if the connection drops again.";

export const isAbortError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";

// Signaling answers 403 when another tab or window now holds the reconnect role claim.
export const isReconnectClaimInactiveError = (error: unknown): boolean =>
  error instanceof P2PRendezvousRequestError && error.status === 403;

// Signaling answers 404 or 410 when the reconnect control session is gone for good.
export const isReconnectRecoveryUnavailableError = (error: unknown): boolean =>
  error instanceof P2PRendezvousRequestError && (error.status === 404 || error.status === 410);
