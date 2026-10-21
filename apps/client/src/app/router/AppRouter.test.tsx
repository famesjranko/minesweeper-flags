// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEPLOYMENT_MODE } from "../../lib/config/env.js";
import { createBrowserSessionPersistence, storeSession } from "../../lib/socket/session-storage.js";
import { App } from "../../main.js";
import {
  getStoredP2PRecoveryRecord,
  P2P_RECOVERY_STORAGE_VERSION,
  type P2PRecoveryGuestRecord,
  storeP2PRecoveryRecord
} from "../../p2p/storage/p2p-recovery-storage.js";
import { createSoloSession } from "../../solo/session/solo-session.js";
import { createBrowserSoloStorage } from "../../solo/storage/solo-storage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderApp = () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => root.render(<App />));

  return {
    container,
    dispose: () => {
      act(() => root.unmount());
      container.remove();
    }
  };
};

const navigate = (path: string) => {
  act(() => {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
};

const storeRecoverableMultiplayerState = () => {
  const session = {
    roomId: "room-1",
    roomCode: "ABCDE",
    inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
    playerId: "player-1",
    displayName: "Host",
    sessionToken: "session-1"
  };
  const p2pRecovery: P2PRecoveryGuestRecord = {
    version: P2P_RECOVERY_STORAGE_VERSION,
    role: "guest",
    roomId: "room-1",
    roomCode: "ABCDE",
    playerId: "player-2",
    displayName: "Guest",
    sessionToken: "guest-session-token",
    players: [
      { playerId: "player-1", displayName: "Host" },
      { playerId: "player-2", displayName: "Guest" }
    ],
    reconnect: { controlSessionId: "control-session-1", guestSecret: "guest-secret-1" }
  };
  storeSession(session);
  storeP2PRecoveryRecord(p2pRecovery);

  return { p2pRecovery, session };
};

const createPersistedSoloReplay = () => {
  const session = createSoloSession({
    nextSeed: () => 4,
    now: () => 7,
    scheduler: { set: () => 0, clear: () => {} }
  });
  session.start();
  session.submitCellAction(0, 0);
  const snapshot = session.getSnapshot();
  session.dispose();
  return snapshot.match.board.cells.flat().filter((cell) => cell.status !== "hidden").length;
};

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("AppRouter", () => {
  it("gives visitors a route back to the lobby from an unknown URL", () => {
    // Given a visitor opens an unknown URL
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", "/not-a-page");
    let app: ReturnType<typeof renderApp> | null = null;

    try {
      // When the application displays that URL
      app = renderApp();

      // Then the visitor sees a not-found message and a link back to the lobby
      expect(app.container.querySelector("h1")?.textContent).toBe("We couldn’t find that page.");
      expect(app.container.querySelector("a")?.getAttribute("href")).toBe("/lobby");
    } finally {
      app?.dispose();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each(["/", "/solo?restore=1#board"])(
    "does not start multiplayer transport on a cold %s entry with stale multiplayer state",
    (path) => {
      // Given a cold home or solo entry and stale records from a multiplayer session
      const originalUrl = window.location.href;
      const fetchMock = vi.fn((_input: RequestInfo | URL) => new Promise(() => {}));
      let websocketCalls = 0;
      const xhrMock = vi.fn();
      const rtcMock = vi.fn();
      class InstrumentedWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        readonly addEventListener = vi.fn();
        readonly close = vi.fn();
        readonly send = vi.fn();
        readyState = InstrumentedWebSocket.CONNECTING;

        constructor() {
          websocketCalls += 1;
        }
      }
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("WebSocket", InstrumentedWebSocket);
      vi.stubGlobal("XMLHttpRequest", xhrMock);
      vi.stubGlobal("RTCPeerConnection", rtcMock);
      const { p2pRecovery, session } = storeRecoverableMultiplayerState();
      window.history.replaceState(null, "", path);
      let app: ReturnType<typeof renderApp> | null = null;

      try {
        // When the application renders at that cold entry
        expect(createBrowserSessionPersistence().read("ABCDE")).toEqual(session);
        expect(getStoredP2PRecoveryRecord("ABCDE")).toEqual(p2pRecovery);
        app = renderApp();
        navigate(path);

        // Then no multiplayer health, transport, rendezvous, or peer connection starts
        expect(fetchMock).not.toHaveBeenCalled();
        expect(websocketCalls).toBe(0);
        expect(xhrMock).not.toHaveBeenCalled();
        expect(rtcMock).not.toHaveBeenCalled();
      } finally {
        app?.dispose();
        window.history.replaceState(null, "", originalUrl);
      }
    }
  );

  it("restores a persisted solo replay on a true /solo refresh without multiplayer activation", () => {
    // Given an accepted nonempty solo replay and valid stale multiplayer recovery records
    const originalUrl = window.location.href;
    const restoredCells = createPersistedSoloReplay();
    const fetchMock = vi.fn(() => new Promise(() => {}));
    const websocketMock = vi.fn();
    const xhrMock = vi.fn();
    const rtcMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", websocketMock);
    vi.stubGlobal("XMLHttpRequest", xhrMock);
    vi.stubGlobal("RTCPeerConnection", rtcMock);
    storeRecoverableMultiplayerState();
    window.history.replaceState(null, "", "/solo?resume=1#board");
    let firstApp: ReturnType<typeof renderApp> | null = null;
    let refreshedApp: ReturnType<typeof renderApp> | null = null;

    try {
      // When the actual app is disposed and mounted again at the same URL
      expect(createBrowserSoloStorage().read().record?.actions).not.toHaveLength(0);
      firstApp = renderApp();
      firstApp.dispose();
      firstApp = null;
      refreshedApp = renderApp();

      // Then the local progress returns while every multiplayer boundary remains unused
      expect(
        refreshedApp.container.querySelectorAll(".status-revealed, .status-claimed").length
      ).toBe(restoredCells);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(websocketMock).not.toHaveBeenCalled();
      expect(xhrMock).not.toHaveBeenCalled();
      expect(rtcMock).not.toHaveBeenCalled();
    } finally {
      firstApp?.dispose();
      refreshedApp?.dispose();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  (DEPLOYMENT_MODE === "p2p" ? it : it.skip)(
    "activates signaling from the configured direct friend route",
    () => {
      // Given a direct-match invitation in the P2P operator configuration
      const originalUrl = window.location.href;
      const fetchMock = vi.fn((_input: RequestInfo | URL) => new Promise(() => {}));
      vi.stubGlobal("fetch", fetchMock);
      window.history.replaceState(null, "", "/p2p/join/session-1");
      let app: ReturnType<typeof renderApp> | null = null;

      try {
        // When the real friend route opens its guest setup session
        app = renderApp();

        // Then the configured rendezvous boundary is actually activated
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe(
          "http://signaling.test/signaling/sessions/session-1"
        );
      } finally {
        app?.dispose();
        window.history.replaceState(null, "", originalUrl);
      }
    }
  );

  (DEPLOYMENT_MODE === "server" ? it : it.skip)(
    "keeps server multiplayer alive between friend routes and disposes it before solo",
    async () => {
      // Given an active server friend route with an issued health request and scheduled refresh
      const originalUrl = window.location.href;
      vi.useFakeTimers();
      const healthRequests: AbortSignal[] = [];
      let resolveLatestHealth: ((value: { json: () => Promise<unknown> }) => void) | null = null;
      const sockets: { close: ReturnType<typeof vi.fn> }[] = [];
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        healthRequests.push(init?.signal as AbortSignal);
        return new Promise((resolve) => {
          resolveLatestHealth = resolve;
        });
      });
      class TrackingWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        readonly close = vi.fn();
        readonly addEventListener = vi.fn();
        readonly send = vi.fn();
        readyState = TrackingWebSocket.CONNECTING;

        constructor() {
          sockets.push(this);
        }
      }
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("WebSocket", TrackingWebSocket);
      window.history.replaceState(null, "", "/lobby");
      let app: ReturnType<typeof renderApp> | null = null;

      try {
        // When the visitor changes friend routes and chooses solo while that refresh is pending
        app = renderApp();
        const startedSocketCount = sockets.length;
        expect(startedSocketCount).toBeGreaterThan(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        navigate("/room/ABCDE");
        navigate("/solo");
        await act(async () => {
          resolveLatestHealth?.({ json: async () => ({ activeRooms: 1, maxRooms: 3 }) });
        });
        act(() => {
          vi.advanceTimersByTime(1000);
        });

        // Then the friend provider survives the friend route, then cannot recreate transport or health work
        expect(sockets).toHaveLength(startedSocketCount);
        expect(sockets.some((socket) => socket.close.mock.calls.length > 0)).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(healthRequests.at(-1)?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        expect(app.container.querySelector(".solo-local-status")?.textContent).toContain(
          "Local match"
        );
      } finally {
        app?.dispose();
        vi.useRealTimers();
        window.history.replaceState(null, "", originalUrl);
      }
    }
  );

  (DEPLOYMENT_MODE === "p2p" ? it : it.skip)(
    "starts a direct friend setup from the lobby and disposes it before solo",
    async () => {
      // Given a direct-match lobby with browser WebRTC and signaling boundaries.
      const originalUrl = window.location.href;
      const fetchMock = vi.fn((_url: string) => new Promise(() => {}));
      const peers: { close: ReturnType<typeof vi.fn> }[] = [];
      class TrackingDataChannel {
        readonly addEventListener = vi.fn();
        readonly close = vi.fn();
        readonly send = vi.fn();
        readyState = "connecting";
      }
      class TrackingPeerConnection {
        readonly addEventListener = vi.fn();
        readonly removeEventListener = vi.fn();
        readonly close = vi.fn();
        readonly createDataChannel = vi.fn(() => new TrackingDataChannel());
        connectionState: RTCPeerConnectionState = "new";
        iceGatheringState: RTCIceGatheringState = "complete";
        localDescription: RTCSessionDescriptionInit | null = null;

        constructor() {
          peers.push(this);
        }

        createOffer = async (): Promise<RTCSessionDescriptionInit> => ({
          type: "offer",
          sdp: "test-offer"
        });

        setLocalDescription = async (description: RTCSessionDescriptionInit): Promise<void> => {
          this.localDescription = description;
        };
      }
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("RTCPeerConnection", TrackingPeerConnection);
      window.history.replaceState(null, "", "/lobby");
      let app: ReturnType<typeof renderApp> | null = null;

      try {
        app = renderApp();

        // When the visitor starts the existing direct-match action and then chooses solo.
        await act(async () => {
          app?.container
            .querySelector("form.lobby-action-card.is-create")
            ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          await Promise.resolve();
          await Promise.resolve();
        });
        navigate("/solo");

        // Then setup reaches WebRTC and signaling, then the friend runtime is disposed for solo.
        expect(peers).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledWith(
          "http://signaling.test/signaling/sessions",
          expect.objectContaining({ method: "POST" })
        );
        expect(peers[0]?.close).toHaveBeenCalledTimes(1);
        expect(app.container.querySelector(".solo-local-status")?.textContent).toContain(
          "Local match"
        );
      } finally {
        app?.dispose();
        window.history.replaceState(null, "", originalUrl);
      }
    }
  );
});
