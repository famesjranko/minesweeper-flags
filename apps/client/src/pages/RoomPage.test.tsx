// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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
    clearError: vi.fn() as () => void,
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

vi.mock("../features/match/MatchView.js", () => ({
  MatchView: () => <div>Recovered board</div>
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

  it("shows recovery on the first paint when a saved seat is available", () => {
    // Given a fresh page with a saved seat but no in-memory session
    mockState.current.session = null;
    mockState.current.hasStoredSession = () => true;

    // When the page renders before its reconnect effect runs
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/room/DIRECT"]}>
        <Routes>
          <Route path="/room/:roomCode" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Then recovery is visible without an unavailable-room flash
    expect(html).toContain("Restoring your game…");
    expect(html).not.toContain("Reconnect to your game.");
    expect(mockState.current.reconnect).not.toHaveBeenCalled();
  });

  it("keeps recovery visible between the restored seat and the board snapshot", () => {
    // Given a saved game whose seat and board arrive in separate events
    mockState.current.session = null;
    mockState.current.hasStoredSession = () => true;
    const { container, root } = renderRoomPage();
    const rerender = () =>
      act(() =>
        root.render(
          <MemoryRouter initialEntries={["/room/DIRECT"]}>
            <Routes>
              <Route path="/room/:roomCode" element={<RoomPage />} />
            </Routes>
          </MemoryRouter>
        )
      );

    // When only the two-player seat has been restored
    resetMockState();
    mockState.current.session!.players = [
      { playerId: "host-1", displayName: "Host" },
      { playerId: "guest-1", displayName: "Guest" }
    ];
    rerender();

    // Then recovery stays visible until the board arrives
    expect(container.textContent).toContain("Restoring your game…");
    expect(container.textContent).not.toContain("Your room is ready.");
    mockState.current.match = {};
    rerender();
    expect(container.textContent).toContain("Recovered board");
    expect(container.textContent).not.toContain("Restoring your game…");
    act(() => root.unmount());
  });

  it("leaves recovery for the waiting room when the restored seat has no opponent", () => {
    // Given a saved waiting room
    mockState.current.session = null;
    mockState.current.hasStoredSession = () => true;
    const { container, root } = renderRoomPage();
    expect(container.textContent).toContain("Restoring your game…");

    // When the server restores its single host seat
    resetMockState();
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/room/DIRECT"]}>
          <Routes>
            <Route path="/room/:roomCode" element={<RoomPage />} />
          </Routes>
        </MemoryRouter>
      )
    );

    // Then the real waiting room is shown
    expect(container.textContent).toContain("Your room is ready.");
    expect(container.textContent).not.toContain("Restoring your game…");
    act(() => root.unmount());
  });

  it("shows the failure when saved-seat recovery is rejected", () => {
    // Given a pending saved-seat recovery
    mockState.current.session = null;
    mockState.current.hasStoredSession = () => true;
    const { container, root } = renderRoomPage();

    // When the server rejects the saved credential
    mockState.current.hasStoredSession = () => false;
    mockState.current.error = "Your saved room session is no longer valid. Join the room again.";
    act(() =>
      root.render(
        <MemoryRouter initialEntries={["/room/DIRECT"]}>
          <Routes>
            <Route path="/room/:roomCode" element={<RoomPage />} />
          </Routes>
        </MemoryRouter>
      )
    );

    // Then recovery stops and the actual failure is visible
    expect(container.textContent).toContain("Room unavailable");
    expect(container.textContent).toContain("Your saved room session is no longer valid.");
    expect(container.textContent).not.toContain("Restoring your game…");
    expect(mockState.current.reconnect).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("shows the host direct-match waiting room in p2p mode", () => {
    const { container, root } = renderRoomPage();

    expect(container.textContent).toContain("Your room is ready.");
    expect(container.textContent).toContain("Private invite link");
    expect(container.textContent).toContain("Waiting for your friend…");
    expect(container.textContent).not.toContain("Paste Guest Answer");

    act(() => {
      root.unmount();
    });
  });

  describe("when a direct-match guest loses the host", () => {
    const loseSeat = (hostStage: string) => {
      // The seat disappears while the page is open, as it does when the host's tab closes.
      const view = renderRoomPage();
      const setup = mockState.current.p2pSetup as { host: { stage: string } };
      const originalStage = setup.host.stage;
      setup.host.stage = hostStage;
      mockState.current.session = null;
      mockState.current.hasStoredSession = () => true;
      act(() => {
        view.root.render(
          <MemoryRouter initialEntries={["/room/DIRECT"]}>
            <Routes>
              <Route path="/room/:roomCode" element={<RoomPage />} />
            </Routes>
          </MemoryRouter>
        );
      });
      setup.host.stage = originalStage;
      return view;
    };

    it("says the guest is waiting for the host", () => {
      // Given a guest tab, which never hosted, that has just lost its seat
      // When the room page renders
      const { container, root } = loseSeat("idle");

      // Then it explains what happened and that rejoining is automatic
      expect(container.textContent).toContain("Waiting for the host to return.");
      expect(container.textContent).toContain(
        "The host’s tab closed or lost its connection. You’ll rejoin when they come back."
      );
      expect(container.textContent).not.toContain("not currently attached");
      act(() => root.unmount());
    });

    it("does not tell a host to wait for themselves", () => {
      // Given the hosting tab has lost its seat
      // When the room page renders
      const { container, root } = loseSeat("waiting-for-guest");

      // Then it keeps the plain reconnect wording
      expect(container.textContent).toContain("Reconnect to your game.");
      expect(container.textContent).not.toContain("Waiting for the host");
      act(() => root.unmount());
    });
  });

  describe("a message over a live match", () => {
    const clearError = vi.fn();

    const renderWithError = (
      match: Record<string, unknown> | null,
      connectionStatus = "connected",
      roomCode = "DIRECT"
    ) => {
      vi.useFakeTimers();
      clearError.mockClear();
      mockState.current.clearError = clearError;
      mockState.current.connectionStatus = connectionStatus;
      mockState.current.error = "It is not your turn.";
      mockState.current.match = match;
      return renderRoomPage(roomCode);
    };

    it("stays on the unavailable page when the running match is for another room", () => {
      // Given the page for one room, while a live match runs for a different room
      const { root } = renderWithError({ phase: "live" }, "connected", "OTHER1");

      // When time passes
      act(() => vi.advanceTimersByTime(60_000));

      // Then the explanation on that page stays
      expect(clearError).not.toHaveBeenCalled();
      act(() => root.unmount());
      vi.useRealTimers();
    });

    it("leaves by itself, so it cannot sit on the page for good", () => {
      // Given a live match showing a rejected move
      const { root } = renderWithError({ phase: "live" });
      expect(clearError).not.toHaveBeenCalled();

      // When a few seconds pass
      act(() => vi.advanceTimersByTime(6_000));

      // Then the message is cleared
      expect(clearError).toHaveBeenCalledOnce();
      act(() => root.unmount());
      vi.useRealTimers();
    });

    it("floats a passing message, so the board never moves under a tap", () => {
      // Given a live connection and a refused move
      // When the match renders
      const { container, root } = renderWithError({ phase: "live" });

      // Then the message is not given its own space on the page
      const message = container.querySelector(".arcade-match-error");
      expect(message?.classList.contains("is-lasting")).toBe(false);
      act(() => root.unmount());
      vi.useRealTimers();
    });

    it("gives a lasting message its own space, so it never hides the header", () => {
      // Given a tab displaced by another tab, with its board still on screen
      // When the match renders
      const { container, root } = renderWithError({ phase: "live" }, "disconnected");

      // Then the message takes its own space above the match
      const message = container.querySelector(".arcade-match-error");
      expect(message?.classList.contains("is-lasting")).toBe(true);
      act(() => root.unmount());
      vi.useRealTimers();
    });

    it("gives a new message its full time", () => {
      // Given a message that has been on screen for most of its time
      const { root } = renderWithError({ phase: "live" });
      act(() => vi.advanceTimersByTime(5_000));

      // When a different message replaces it
      mockState.current.error = "That square is already open.";
      act(() => {
        root.render(
          <MemoryRouter initialEntries={["/room/DIRECT"]}>
            <Routes>
              <Route path="/room/:roomCode" element={<RoomPage />} />
            </Routes>
          </MemoryRouter>
        );
      });
      act(() => vi.advanceTimersByTime(5_000));

      // Then it is still showing after the first message's time has passed
      expect(clearError).not.toHaveBeenCalled();

      // And it leaves when its own time is up
      act(() => vi.advanceTimersByTime(1_000));
      expect(clearError).toHaveBeenCalledOnce();
      act(() => root.unmount());
      vi.useRealTimers();
    });

    it("stays while the connection is lost, where it explains a lasting state", () => {
      // Given a tab displaced by another tab, with its board still on screen
      const { root } = renderWithError({ phase: "live" }, "disconnected");

      // When time passes
      act(() => vi.advanceTimersByTime(60_000));

      // Then the explanation stays
      expect(clearError).not.toHaveBeenCalled();
      act(() => root.unmount());
      vi.useRealTimers();
    });

    it("stays on a page with no match, where it explains why", () => {
      // Given an error on the room page with no match running
      const { root } = renderWithError(null);

      // When time passes
      act(() => vi.advanceTimersByTime(60_000));

      // Then the explanation stays
      expect(clearError).not.toHaveBeenCalled();
      act(() => root.unmount());
      vi.useRealTimers();
    });
  });

  it("always offers a way out while a saved seat is restoring", () => {
    // Given a saved seat being restored, which can take as long as the host stays away
    mockState.current.session = null;
    mockState.current.hasStoredSession = () => true;

    // When the page renders
    const { container, root } = renderRoomPage();

    // Then the player can leave, and knows why it might take a while
    expect(container.textContent).toContain("Restoring your game…");
    expect(container.textContent).toContain("you’ll rejoin when they come back");
    expect(container.querySelector('.arcade-recovery a[href="/lobby"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("does not promise a reconnect when a direct match has no saved seat", () => {
    // Given a direct-match room this browser holds no seat for
    mockState.current.session = null;
    mockState.current.hasStoredSession = () => false;

    // When the page renders
    const { container, root } = renderRoomPage();

    // Then it says the match has closed
    expect(container.textContent).toContain(
      "This direct match closed. Start a new one from the lobby."
    );
    expect(container.textContent).not.toContain("reconnecting");
    act(() => root.unmount());
  });

  it("shows conflict guidance when the tab is displaced by another tab", () => {
    mockState.current.session = null;
    mockState.current.error =
      "This direct match is active in another tab or window. Use that tab, or reconnect here.";
    mockState.current.hasStoredSession = () => true;

    const { container, root } = renderRoomPage();

    expect(container.textContent).toContain("Reconnect to your game.");
    expect(container.textContent).toContain("active in another tab or window");
    expect(container.textContent).toContain(
      "Another tab has claimed control. Close other tabs for this room, or reconnect to reclaim control."
    );

    const reconnectButton = container.querySelector("button.arcade-primary");
    expect(reconnectButton).not.toBeNull();
    expect(reconnectButton?.textContent).toBe("Reconnect");

    act(() => {
      root.unmount();
    });
  });

  it("reconnects once on open and not again after another tab displaces it", () => {
    // Given a tab that opens the room with only a stored recovery record
    mockState.current.session = null;
    mockState.current.hasStoredSession = () => true;
    const { root } = renderRoomPage();
    const rerender = () => {
      act(() => {
        root.render(
          <MemoryRouter initialEntries={["/room/DIRECT"]}>
            <Routes>
              <Route path="/room/:roomCode" element={<RoomPage />} />
            </Routes>
          </MemoryRouter>
        );
      });
    };

    // And its bootstrap reconnect restores the session
    mockState.current.session = {
      roomId: "room-1",
      roomCode: "DIRECT",
      playerId: "host-1",
      displayName: "Host",
      sessionToken: "host-token",
      players: [{ playerId: "host-1", displayName: "Host" }]
    };
    rerender();

    // When another tab takes the claim and the runtime clears this tab's session
    mockState.current.session = null;
    mockState.current.error =
      "This direct match is active in another tab or window. Use that tab, or reconnect here.";
    rerender();

    // Then the tab reconnected only on open, and leaves reclaiming to the user
    expect(mockState.current.reconnect).toHaveBeenCalledTimes(1);

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

    const buttons = Array.from(container.querySelectorAll("button.arcade-primary"));
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

    const buttons = Array.from(container.querySelectorAll("button.arcade-primary"));
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

    const reconnectButton = container.querySelector("button.arcade-primary");

    mockState.current.reconnect.mockClear();
    act(() => {
      reconnectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockState.current.reconnect).toHaveBeenCalledTimes(1);
    expect(mockState.current.reconnect).toHaveBeenCalledWith("DIRECT");

    act(() => {
      root.unmount();
    });
  });
});
