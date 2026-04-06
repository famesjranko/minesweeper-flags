import { P2P_SIGNALING_PROTOCOL_VERSION, type HostOfferPayload } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { createHostOfferUrlFragment, createP2PJoinUrl, parseHostOfferUrlFragment } from "./p2p-signaling-url.js";

const hostOfferPayload: HostOfferPayload = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p",
  role: "host",
  sdp: "offer-sdp",
  timestamp: 42
};

describe("p2p signaling url helpers", () => {
  it("creates and parses a host offer fragment", () => {
    const fragment = createHostOfferUrlFragment(hostOfferPayload);

    expect(fragment.startsWith("#")).toBe(true);
    expect(parseHostOfferUrlFragment(fragment)).toEqual(hostOfferPayload);
  });

  it("rejects empty fragments", () => {
    expect(() => parseHostOfferUrlFragment("#")).toThrow("P2P offer URL fragment is empty.");
  });

  it("rejects unsupported payload versions in fragments", () => {
    const fragment = `#${encodeURIComponent(
      JSON.stringify({
        ...hostOfferPayload,
        protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION + 1
      })
    )}`;

    expect(() => parseHostOfferUrlFragment(fragment)).toThrow(
      `Unsupported P2P signaling protocol version: ${P2P_SIGNALING_PROTOCOL_VERSION + 1}.`
    );
  });

  it("creates a session-based join url", () => {
    expect(createP2PJoinUrl("session-1", "https://app.example.com")).toBe(
      "https://app.example.com/p2p/join/session-1"
    );
  });
});
