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
  guestError: null as string | null
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
        displayName: "Captain Sweeper",
        error: gameClientMock.guestError,
        sessionId: "session-1",
        sessionState: gameClientMock.guestSessionState,
        expiresAt: 100,
        offerPayload: {
          protocolVersion: 1,
          mode: "p2p",
          role: "host",
          sdp: "offer-sdp",
          timestamp: 1
        },
        answerPayload: {
          protocolVersion: 1,
          mode: "p2p",
          role: "guest",
          displayName: "Captain Sweeper",
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
    document.body.innerHTML = "";
  });

  it("loads the direct link session and routes guest join actions through the runtime", () => {
    const { container, root } = renderPage();

    expect(container.textContent).toContain("Join Direct Match");
    expect(container.textContent).toContain("Direct link loaded");
    expect(container.textContent).toContain("Loaded from session");
    expect(gameClientMock.openGuestSetupSession).toHaveBeenCalledWith("session-1");

    const joinButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Join Direct Match"
    );

    act(() => {
      joinButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(gameClientMock.clearGuestSetupError).toHaveBeenCalledTimes(1);
    expect(gameClientMock.createGuestAnswer).toHaveBeenCalledWith("Captain Sweeper");
    expect(container.textContent).not.toContain("Copy Answer Payload");
    expect(container.textContent).not.toContain("send back outside the app");

    act(() => {
      root.unmount();
    });
  });

  it.each([
    ["expired", "Expired", "This direct-match link has expired. Start a new direct match."],
    ["answered", "Already used", "This direct-match link was already used by another guest. Ask the host for a new link."],
    ["finalized", "Finalized", "This direct-match link has already finished setup. Ask the host for a new link."]
  ] as const)("shows %s direct links as unavailable", (sessionState, statusLabel, message) => {
    gameClientMock.guestSessionState = sessionState;
    gameClientMock.guestError = message;

    const { container, root } = renderPage();

    expect(container.textContent).toContain("Direct link unavailable");
    expect(container.textContent).toContain(statusLabel);
    expect(container.textContent).toContain(message);
    expect(container.textContent).toContain("This invite can no longer create a guest answer.");

    const joinButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Join Direct Match"
    );

    expect(joinButton).toBeDefined();
    expect(joinButton?.hasAttribute("disabled")).toBe(true);

    act(() => {
      joinButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(gameClientMock.clearGuestSetupError).not.toHaveBeenCalled();
    expect(gameClientMock.createGuestAnswer).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });
});
