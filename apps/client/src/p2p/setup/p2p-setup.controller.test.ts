import { P2P_SIGNALING_PROTOCOL_VERSION, type GuestAnswerPayload, type HostOfferPayload } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { getGuestDirectJoinUnavailableMessage, P2PSetupController } from "./p2p-setup.controller.js";
import { P2PSetupStore } from "./p2p-setup.store.js";

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

describe("P2PSetupController", () => {
  it("tracks host offer creation separately from guest state", () => {
    const store = new P2PSetupStore();
    const controller = new P2PSetupController(store);

    controller.startHostOfferCreation("Host Player");
    controller.completeHostOfferCreation({
      displayName: "Host Player",
      offerPayload: hostOfferPayload
    });
    controller.completeHostSessionCreation({
      sessionId: "session-1",
      hostSecret: "host-secret",
      expiresAt: 100,
      sessionState: "open",
      joinUrl: "https://app.example.com/p2p/join/session-1"
    });

    expect(store.getSnapshot()).toEqual({
      host: {
        role: "host",
        stage: "waiting-for-guest",
        displayName: "Host Player",
        error: null,
        offerPayload: hostOfferPayload,
        offerUrlFragment: null,
        sessionId: "session-1",
        hostSecret: "host-secret",
        sessionState: "open",
        expiresAt: 100,
        joinUrl: "https://app.example.com/p2p/join/session-1",
        guestAnswerText: "",
        guestAnswerPayload: null
      },
      guest: {
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
      }
    });
  });

  it("tracks guest answer creation without mutating host offer state", () => {
    const store = new P2PSetupStore();
    const controller = new P2PSetupController(store);

    controller.startGuestSessionLoad("session-1");
    controller.completeGuestSessionLoad({
      sessionId: "session-1",
      offerPayload: hostOfferPayload,
      expiresAt: 100,
      sessionState: "open",
      displayName: "Guest Player"
    });
    controller.startGuestAnswerCreation("Guest Player");
    controller.completeGuestAnswerCreation({
      displayName: "Guest Player",
      answerPayload: guestAnswerPayload
    });
    controller.completeGuestAnswerSubmission("answered");

    expect(store.getSnapshot().host.stage).toBe("idle");
    expect(store.getSnapshot().guest).toEqual({
      role: "guest",
      sessionId: "session-1",
      sessionState: "answered",
      expiresAt: 100,
      stage: "waiting-for-host-finalize",
      displayName: "Guest Player",
      error: null,
      offerPayload: hostOfferPayload,
      answerPayload: guestAnswerPayload,
      answerText: null
    });
  });

  it.each([
    ["expired", "This direct-match link has expired. Start a new direct match."],
    ["answered", "This direct-match link was already used by another guest. Ask the host for a new link."],
    ["finalized", "This direct-match link has already finished setup. Ask the host for a new link."]
  ] as const)("marks %s guest sessions as unavailable during load", (sessionState, message) => {
    const store = new P2PSetupStore();
    const controller = new P2PSetupController(store);

    controller.startGuestSessionLoad("session-1");
    controller.completeGuestSessionLoad({
      sessionId: "session-1",
      offerPayload: hostOfferPayload,
      expiresAt: 100,
      sessionState
    });

    expect(getGuestDirectJoinUnavailableMessage(sessionState)).toBe(message);
    expect(store.getSnapshot().guest.stage).toBe("failed");
    expect(store.getSnapshot().guest.error).toBe(message);
    expect(store.getSnapshot().guest.sessionState).toBe(sessionState);
    expect(store.getSnapshot().guest.offerPayload).toBe(hostOfferPayload);
  });
});
