// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../main.js";

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

    try {
      // When the application displays that URL
      const app = renderApp();

      // Then the visitor sees a not-found message and a link back to the lobby
      expect(app.container.querySelector("h1")?.textContent).toBe("We couldn’t find that page.");
      expect(app.container.querySelector("a")?.getAttribute("href")).toBe("/lobby");
      app.dispose();
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each(["/", "/solo?restore=1#board"])(
    "does not start multiplayer transport on a cold %s entry with stale multiplayer state",
    (path) => {
      // Given a cold home or solo entry and stale records from a multiplayer session
      const originalUrl = window.location.href;
      const fetchMock = vi.fn(() => new Promise(() => {}));
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
      window.localStorage.setItem("msf:session:ABCDE", '{"roomCode":"ABCDE"}');
      window.localStorage.setItem("msf:p2p-recovery:ABCDE", '{"role":"host"}');
      window.history.replaceState(null, "", path);

      try {
        // When the application renders and the browser history is refreshed at the same entry
        const app = renderApp();
        navigate(path);

        // Then no multiplayer health, transport, rendezvous, or peer connection starts
        expect(fetchMock).not.toHaveBeenCalled();
        expect(websocketCalls).toBe(0);
        expect(xhrMock).not.toHaveBeenCalled();
        expect(rtcMock).not.toHaveBeenCalled();
        app.dispose();
      } finally {
        window.history.replaceState(null, "", originalUrl);
      }
    }
  );

  it("keeps multiplayer alive between friend routes and disposes it before solo", () => {
    // Given an active friend route with a transport and a pending health request
    const originalUrl = window.location.href;
    const healthRequests: AbortSignal[] = [];
    const sockets: { close: ReturnType<typeof vi.fn> }[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      healthRequests.push(init?.signal as AbortSignal);
      return new Promise(() => {});
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

    try {
      // When the visitor changes friend routes and then chooses solo
      const app = renderApp();
      const startedSocketCount = sockets.length;
      navigate("/room/ABCDE");
      navigate("/solo");

      // Then the friend provider survives the friend route, then closes before solo can schedule work
      expect(sockets).toHaveLength(startedSocketCount);
      expect(sockets.some((socket) => socket.close.mock.calls.length > 0)).toBe(true);
      expect(healthRequests.every((signal) => signal.aborted)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      app.dispose();
    } finally {
      window.history.replaceState(null, "", originalUrl);
    }
  });
});
