// @vitest-environment jsdom

import type { SignalingSessionState } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const gameClientMock = vi.hoisted(() => ({
  openGuestSetupSession: vi.fn(),
  createGuestAnswer: vi.fn(),
  clearGuestSetupError: vi.fn(),
  guestSessionState: "open" as SignalingSessionState,
  guestError: null as string | null,
  guestOfferLoaded: true
}));

vi.mock("../../lib/config/env.js", () => ({
  DEPLOYMENT_MODE: "p2p"
}));

vi.mock("../../features/connection/useGameClient.js", () => ({
  useGameClient: () => ({
    connectionStatus: "connected",
    error: null,
    session: null,
    p2pSetup: {
      host: {
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
      },
      guest: {
        role: "guest",
        stage: gameClientMock.guestError ? "failed" : "idle",
        displayName: "First Mate",
        error: gameClientMock.guestError,
        sessionId: "session-1",
        sessionState: gameClientMock.guestSessionState,
        expiresAt: 100,
        offerPayload: gameClientMock.guestOfferLoaded
          ? {
              protocolVersion: 1,
              mode: "p2p",
              role: "host",
              sdp: "offer-sdp",
              timestamp: 1
            }
          : null,
        answerPayload: {
          protocolVersion: 1,
          mode: "p2p",
          role: "guest",
          displayName: "First Mate",
          sdp: "answer-sdp",
          timestamp: 2
        },
        answerText: null
      }
    },
    openGuestSetupSession: gameClientMock.openGuestSetupSession,
    createGuestAnswer: gameClientMock.createGuestAnswer,
    clearGuestSetupError: gameClientMock.clearGuestSetupError
  })
}));

import { P2PJoinPage } from "./P2PJoinPage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderPage = () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/p2p/join/session-1"]}>
        <Routes>
          <Route path="/p2p/join/:sessionId" element={<P2PJoinPage />} />
        </Routes>
      </MemoryRouter>
    );
  });

  return { container, root };
};

describe("P2PJoinPage", () => {
  afterEach(() => {
    gameClientMock.openGuestSetupSession.mockReset();
    gameClientMock.createGuestAnswer.mockReset();
    gameClientMock.clearGuestSetupError.mockReset();
    gameClientMock.guestSessionState = "open";
    gameClientMock.guestError = null;
    gameClientMock.guestOfferLoaded = true;
    document.body.innerHTML = "";
  });

  it("shows a link that never loaded as unavailable, with no way to join", () => {
    // Given a join link the signaling service does not recognise
    gameClientMock.guestOfferLoaded = false;
    gameClientMock.guestError = "This direct-match link could not be found.";

    // When the page renders
    const { container, root } = renderPage();

    // Then it says so plainly and offers no Join button
    expect(container.textContent).toContain("Invite unavailable");
    expect(container.textContent).toContain("This direct-match link could not be found.");
    expect(container.textContent).not.toContain("A friend invited you.");
    expect(container.querySelector("button[type=submit]")).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("loads the direct link session and routes guest join actions through the runtime", () => {
    const { container, root } = renderPage();

    expect(container.textContent).toContain("A friend invited you.");
    expect(container.textContent).toContain("Direct link loaded");
    expect(container.textContent).not.toMatch(/disconnected|webrtc|signaling/i);
    expect(gameClientMock.openGuestSetupSession).toHaveBeenCalledWith("session-1");

    const joinButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Join game"
    );

    act(() => {
      joinButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(gameClientMock.clearGuestSetupError).toHaveBeenCalledTimes(1);
    expect(gameClientMock.createGuestAnswer).toHaveBeenCalledWith("First Mate");
    expect(container.textContent).not.toContain("Copy Answer Payload");
    expect(container.textContent).not.toContain("send back outside the app");

    act(() => {
      root.unmount();
    });
  });

  it.each([
    ["expired", "This direct-match link has expired. Start a new direct match."],
    [
      "answered",
      "This direct-match link was already used by another guest. Ask the host for a new link."
    ],
    ["finalized", "This direct-match link has already finished setup. Ask the host for a new link."]
  ] as const)("shows %s direct links as unavailable", (sessionState, message) => {
    gameClientMock.guestSessionState = sessionState;
    gameClientMock.guestError = message;

    const { container, root } = renderPage();

    expect(container.textContent).toContain("Invite unavailable");
    expect(container.querySelector('a[href="/lobby"]')?.textContent).toBe("Back to lobby");
    expect(container.textContent?.split(message).length).toBe(2);
    expect(container.textContent).not.toContain("guest answer");
    expect(container.textContent).not.toContain("no longer joinable");

    const joinButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Join game"
    );

    expect(joinButton).toBeUndefined();
    expect(gameClientMock.clearGuestSetupError).not.toHaveBeenCalled();
    expect(gameClientMock.createGuestAnswer).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });
});
