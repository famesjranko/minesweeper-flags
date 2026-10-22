// @vitest-environment jsdom

import { createMatchState } from "@minesweeper-flags/game-engine";
import { toMatchStateDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserSessionPersistence, storeSession } from "../../lib/socket/session-storage.js";
import { AppRouter } from "./AppRouter.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = {
  roomId: "room-1",
  roomCode: "ABCDE",
  inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
  playerId: "host-1",
  displayName: "Host",
  sessionToken: "session-1"
};
class Socket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: Socket[] = [];
  readyState = 0;
  sent: { type: string; payload: Record<string, unknown> }[] = [];
  close = vi.fn(() => {
    this.readyState = 3;
  });
  constructor() {
    super();
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  receive(type: string, payload: unknown) {
    act(() =>
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type, payload }) }))
    );
  }
}
const startedMatch = () =>
  toMatchStateDto(
    createMatchState({
      roomId: session.roomId,
      players: [
        { playerId: session.playerId, displayName: "Host" },
        { playerId: "guest-1", displayName: "Guest" }
      ],
      seed: 1,
      createdAt: 0,
      startingPlayerId: session.playerId
    })
  );
let root: Root | undefined;
let container: HTMLDivElement;
const navigate = (path: string) =>
  act(() => {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
const setup = () => {
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  const health = vi.fn(async () => ({ json: async () => ({ activeRooms: 0, maxRooms: 4 }) }));
  vi.stubGlobal("fetch", health);
  storeSession(session);
  window.history.replaceState(null, "", "/room/ABCDE");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<AppRouter />));
  const socket = Socket.instances.at(-1)!;
  act(() => {
    socket.readyState = 1;
    socket.dispatchEvent(new Event("open"));
  });
  socket.receive("room:state", {
    roomId: session.roomId,
    roomCode: session.roomCode,
    players: [{ playerId: session.playerId, displayName: "Host" }]
  });
  return { socket, health };
};
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("waiting room exit", () => {
  it.each(["/", "/lobby"])(
    "keeps cancellation connected after browser navigation to %s and refreshes capacity",
    async (path) => {
      // Given a restored waiting host
      const { socket, health } = setup();
      // When browser history returns to the lobby before cancellation is acknowledged
      navigate(path);
      const cancellation = socket.sent.find((event) => event.type === "room:cancel");
      expect(cancellation).toBeDefined();
      expect(socket.close).not.toHaveBeenCalled();
      const previousFetches = health.mock.calls.length;
      socket.receive("room:cancelled", {
        roomCode: session.roomCode,
        requestId: cancellation?.payload.requestId
      });
      await act(async () => {
        await Promise.resolve();
      });
      // Then the old credentials are removed and availability is refreshed immediately
      expect(createBrowserSessionPersistence().read(session.roomCode)).toBeNull();
      expect(health.mock.calls.length).toBeGreaterThan(previousFetches);
      expect(window.location.pathname).toBe(path);
    }
  );
  it.each(["/", "/lobby"])("returns a failed cancellation from %s to its waiting room", (path) => {
    // Given a host leaves its waiting room through browser history
    const { socket } = setup();
    navigate(path);
    // When storage rejects cancellation
    socket.receive("server:error", { message: "Delete failed." });
    // Then its credentials and visible error remain available for retry
    expect(window.location.pathname).toBe("/room/ABCDE");
    expect(container.textContent).toContain("Delete failed.");
    expect(createBrowserSessionPersistence().read(session.roomCode)).not.toBeNull();
  });
  it.each([".room-waiting-back", ".arcade-brand"])(
    "uses %s to cancel once before returning",
    (selector) => {
      // Given a waiting host with the cancel action and home link
      const { socket } = setup();
      // When the host clicks the action twice before acknowledgement
      act(() => container.querySelector<HTMLElement>(selector)?.click());
      act(() => container.querySelector<HTMLElement>(".arcade-brand")?.click());
      const requests = socket.sent.filter((event) => event.type === "room:cancel");
      // Then only one cancellation is sent and the acknowledged host returns to the lobby
      expect(requests).toHaveLength(1);
      socket.receive("room:cancelled", {
        roomCode: session.roomCode,
        requestId: requests[0]?.payload.requestId
      });
      expect(window.location.pathname).toBe(selector === ".arcade-brand" ? "/" : "/lobby");
    }
  );
  it("leaves the waiting room on browser Back while offline and keeps credentials", () => {
    // Given the host loses its network connection before leaving
    const { socket } = setup();
    act(() => socket.dispatchEvent(new CloseEvent("close", { code: 1006 })));

    // When browser Back returns to game selection
    navigate("/");

    // Then the host stays at game selection without sending a cancellation
    expect(window.location.pathname).toBe("/");
    expect(socket.sent.some((event) => event.type === "room:cancel")).toBe(false);

    // And the stored session remains so the host can return to the room
    expect(createBrowserSessionPersistence().read(session.roomCode)).not.toBeNull();
  });
  it.each([
    [".room-waiting-back", "/lobby"],
    [".arcade-brand", "/"]
  ])("leaves through %s while offline", (selector, destination) => {
    // Given a waiting host whose connection has dropped
    const { socket } = setup();
    act(() => socket.dispatchEvent(new CloseEvent("close", { code: 1006 })));

    // When the host uses the exit control
    act(() => container.querySelector<HTMLElement>(selector)?.click());

    // Then the host reaches its destination and keeps the stored session
    expect(window.location.pathname).toBe(destination);
    expect(createBrowserSessionPersistence().read(session.roomCode)).not.toBeNull();
  });
  it("lets the host leave after a failed cancellation once the match starts", () => {
    // Given a cancellation that failed because a guest took the second seat
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }));
    // jsdom has no dialog methods; the match chat calls them when the board mounts.
    HTMLDialogElement.prototype.close ??= () => undefined;
    HTMLDialogElement.prototype.showModal ??= () => undefined;
    const { socket } = setup();
    navigate("/lobby");
    socket.receive("server:error", { message: "Only the waiting room host can cancel this room." });
    socket.receive("room:state", {
      roomId: session.roomId,
      roomCode: session.roomCode,
      players: [
        { playerId: session.playerId, displayName: "Host" },
        { playerId: "guest-1", displayName: "Guest" }
      ]
    });
    socket.receive("match:started", { roomCode: session.roomCode, match: startedMatch() });

    // When the host later uses browser navigation to reach the lobby
    navigate("/lobby");

    // Then the host is not sent back to the room
    expect(window.location.pathname).toBe("/lobby");

    // And the stale cancellation error is gone
    expect(container.textContent).not.toContain("Only the waiting room host");
  });
  it.each([false, true])("does not cancel on unmount after network loss is %s", (networkLost) => {
    // Given a waiting room whose transport drops
    const { socket } = setup();
    // When the network closes and the page is disposed
    if (networkLost) act(() => socket.dispatchEvent(new CloseEvent("close", { code: 1006 })));
    act(() => root?.unmount());
    root = undefined;
    // Then cancellation was never sent and reload credentials remain
    expect(socket.sent.some((event) => event.type === "room:cancel")).toBe(false);
    expect(createBrowserSessionPersistence().read(session.roomCode)).not.toBeNull();
  });
});
