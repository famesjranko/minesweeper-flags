import type { HostOfferPayload } from "@minesweeper-flags/shared";
import { decodeHostOfferPayload, encodeHostOfferPayload } from "./p2p-signaling.codec.js";

const normalizeFragmentPayload = (fragment: string): string => {
  const normalizedFragment = fragment.startsWith("#") ? fragment.slice(1) : fragment;

  return normalizedFragment.trim();
};

export const createHostOfferUrlFragment = (payload: HostOfferPayload): string =>
  `#${encodeHostOfferPayload(payload)}`;

export const parseHostOfferUrlFragment = (fragment: string): HostOfferPayload => {
  const encodedPayload = normalizeFragmentPayload(fragment);

  if (!encodedPayload) {
    throw new Error("P2P offer URL fragment is empty.");
  }

  return decodeHostOfferPayload(encodedPayload);
};

export const createP2PJoinUrl = (
  sessionId: string,
  origin = typeof window === "undefined" ? "http://localhost" : window.location.origin
): string => `${origin}/p2p/join/${encodeURIComponent(sessionId)}`;
