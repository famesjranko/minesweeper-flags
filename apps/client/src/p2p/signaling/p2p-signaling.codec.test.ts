import { P2P_SIGNALING_PROTOCOL_VERSION, type GuestAnswerPayload, type HostOfferPayload } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import {
  decodeGuestAnswerPayload,
  decodeHostOfferPayload,
  encodeGuestAnswerPayload,
  encodeHostOfferPayload
} from "./p2p-signaling.codec.js";

const hostOfferPayload: HostOfferPayload = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p",
  role: "host",
  sdp: "offer-sdp",
  timestamp: 1
};

const guestAnswerPayload: GuestAnswerPayload = {
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p",
  role: "guest",
  displayName: "Guest Player",
  sdp: "answer-sdp",
  timestamp: 2
};

describe("p2p signaling codec", () => {
  it("round-trips host offer payloads through encoded text", () => {
    expect(decodeHostOfferPayload(encodeHostOfferPayload(hostOfferPayload))).toEqual(hostOfferPayload);
  });

  it("round-trips guest answer payloads through encoded text", () => {
    expect(decodeGuestAnswerPayload(encodeGuestAnswerPayload(guestAnswerPayload))).toEqual(
      guestAnswerPayload
    );
  });

  it("rejects malformed payload text", () => {
    expect(() => decodeHostOfferPayload("not-json")).toThrow(
      "P2P signaling payload is not valid encoded JSON."
    );
  });

  it("rejects invalid payload shapes", () => {
    const invalidPayload = encodeURIComponent(
      JSON.stringify({
        protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
        mode: "p2p",
        role: "host",
        timestamp: 1
      })
    );

    expect(() => decodeHostOfferPayload(invalidPayload)).toThrow("Invalid host offer signaling payload.");
  });

  it("rejects unsupported payload versions", () => {
    const unsupportedPayload = encodeURIComponent(
      JSON.stringify({
        ...hostOfferPayload,
        protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION + 1
      })
    );

    expect(() => decodeHostOfferPayload(unsupportedPayload)).toThrow(
      `Unsupported P2P signaling protocol version: ${P2P_SIGNALING_PROTOCOL_VERSION + 1}.`
    );
  });
});
