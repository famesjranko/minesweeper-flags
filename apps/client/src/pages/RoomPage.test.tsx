// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  current: {
    connectionStatus: "disconnected" as string,
    error: null as string | null,
    session: {
      roomId: "room-1",
      roomCode: "DIRECT",
      playerId: "host-1",
      displayName: "Host",
      sessionToken: "host-token",
      players: [{ playerId: "host-1", displayName: "Host" }]
    } as Record<string, unknown> | null,
    match: null as Record<string, unknown> | null,
    bombArmed: false,
    chatMessages: [] as unknown[],
    chatError: null as string | null,
    chatDraft: "",
    chatPending: false,
    hasStoredSession: (() => false) as (roomCode: string) => boolean,
    reconnect: vi.fn(),
    submitCellAction: vi.fn(),
    setChatDraft: vi.fn(),
    sendChatMessage: vi.fn(),
    toggleBombMode: vi.fn(),
    resignMatch: vi.fn(),
    requestRematch: vi.fn(),
    cancelRematch: vi.fn(),
    p2pSetup: {
      host: {
        role: "host",
        stage: "waiting-for-guest",
        displayName: "Host",
        error: null,
        offerPayload: {
          protocolVersion: 1,
          mode: "p2p",
          role: "host",
          sdp: "offer-sdp",
          timestamp: 1
        },
        offerUrlFragment: null,
        sessionId: "session-1",
        hostSecret: "host-secret",
        sessionState: "open",
        expiresAt: 100,
        joinUrl: "http://localhost:5173/p2p/join/session-1",
        guestAnswerText: "",
        guestAnswerPayload: null
      },
      guest: {
        role: "guest",
        stage: "idle",
        displayName: "",
        error: null,
        offerPayload: null,
        answerPayload: null,
        answerText: null
      }
    },
    setHostGuestAnswerText: vi.fn(),
    applyHostGuestAnswer: vi.fn(),
    clearHostSetupError: vi.fn()
  }
}));

vi.mock("../lib/config/env.js", () => ({
  DEPLOYMENT_MODE: "p2p"
}));

vi.mock("../features/connection/useGameClient.js", () => ({
  useGameClient: () => mockState.current
}));

import { RoomPage } from "./RoomPage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderRoomPage = (roomCode = "DIRECT") => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter initialEntries={[`/room/${roomCode}`]}>
        <Routes>
          <Route path="/room/:roomCode" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>
    );
  });

  return { container, root };
};

const resetMockState = () => {
  mockState.current.session = {
    roomId: "room-1",
    roomCode: "DIRECT",
    playerId: "host-1",
    displayName: "Host",
    sessionToken: "host-token",
    players: [{ playerId: "host-1", displayName: "Host" }]
  };
  mockState.current.error = null;
  mockState.current.match = null;
  mockState.current.hasStoredSession = () => false;
  mockState.current.reconnect = vi.fn();
};

describe("RoomPage", () => {
  afterEach(() => {
    document.body.textContent = "";
    resetMockState();
  });

  it("shows the host direct-match waiting room in p2p mode", () => {
    const { container, root } = renderRoomPage();

    expect(container.textContent).toContain("Host Direct Match");
    expect(container.textContent).toContain("Share Direct Link");
    expect(container.textContent).toContain("Waiting For Guest");
    expect(container.textContent).not.toContain("Paste Guest Answer");

    act(() => {
      root.unmount();
    });
  });

  it("shows conflict guidance when the tab is displaced by another tab", () => {
    mockState.current.session = null;
    mockState.current.error =
      "This direct match is active in another tab or window. Use that tab, or reconnect here.";
    mockState.current.hasStoredSession = () => true;

    const { container, root } = renderRoomPage();

    expect(container.textContent).toContain("Room unavailable");
    expect(container.textContent).toContain("active in another tab or window");
    expect(container.textContent).toContain(
      "Another tab has claimed control. Close other tabs for this room, or reconnect to reclaim control."
    );

    const reconnectButton = container.querySelector("button.primary-button");
    expect(reconnectButton).not.toBeNull();
    expect(reconnectButton?.textContent).toBe("Reconnect");

    act(() => {
      root.unmount();
    });
  });

  it("shows recovery-unavailable guidance without a reconnect button", () => {
    mockState.current.session = null;
    mockState.current.error =
      "Direct-match recovery is no longer available for this session. Start a new direct match if the connection drops again.";
    mockState.current.hasStoredSession = () => false;

    const { container, root } = renderRoomPage();

    expect(container.textContent).toContain("Room unavailable");
    expect(container.textContent).toContain("recovery is no longer available");
    expect(container.textContent).toContain(
      "Recovery data was cleared. You can start a fresh direct match from the lobby."
    );

    const buttons = Array.from(container.querySelectorAll("button.primary-button"));
    const reconnectButton = buttons.find((button) => button.textContent === "Reconnect");
    expect(reconnectButton).toBeUndefined();

    act(() => {
      root.unmount();
    });
  });

  it("shows claim victory notice without a reconnect button", () => {
    mockState.current.session = null;
    mockState.current.error = "You now have control. This direct match is active in this tab.";
    mockState.current.hasStoredSession = () => true;

    const { container, root } = renderRoomPage();

    expect(container.textContent).toContain("Room unavailable");
    expect(container.textContent).toContain("now have control");

    const buttons = Array.from(container.querySelectorAll("button.primary-button"));
    const reconnectButton = buttons.find((button) => button.textContent === "Reconnect");
    expect(reconnectButton).toBeUndefined();

    act(() => {
      root.unmount();
    });
  });

  it("calls reconnect when the displaced tab reconnect button is clicked", () => {
    mockState.current.session = null;
    mockState.current.error =
      "This direct match is active in another tab or window. Use that tab, or reconnect here.";
    mockState.current.hasStoredSession = () => true;

    const { container, root } = renderRoomPage();

    const reconnectButton = container.querySelector("button.primary-button");

    act(() => {
      reconnectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockState.current.reconnect).toHaveBeenCalledWith("DIRECT");

    act(() => {
      root.unmount();
    });
  });
});
