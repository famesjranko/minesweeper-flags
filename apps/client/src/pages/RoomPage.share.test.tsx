// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomPage } from "./RoomPage.js";

const { build, gameClient } = vi.hoisted(() => ({
  build: { mode: "server" },
  gameClient: {
    connectionStatus: "connected",
    error: null,
    session: {
      roomId: "room-1",
      roomCode: "ABCDE",
      inviteToken: "AbCdEfGhIjKlMnOpQrStUw",
      playerId: "host-1",
      displayName: "Host",
      sessionToken: "host-token",
      players: [{ playerId: "host-1", displayName: "Host" }]
    },
    match: null,
    hasStoredSession: () => false,
    reconnect: () => {},
    cancelRoom: () => {},
    roomCancelPending: false,
    roomCancelAttempted: false,
    p2pSetup: {
      host: {
        stage: "waiting-for-guest",
        sessionState: "open",
        joinUrl: "https://example.test/p2p/join/session-1"
      }
    }
  }
}));
vi.mock("../features/connection/useGameClient.js", () => ({ useGameClient: () => gameClient }));
vi.mock("../lib/config/env.js", async (original) => ({
  ...(await original<object>()),
  get DEPLOYMENT_MODE() {
    return build.mode;
  }
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setShare = (share: unknown) =>
  Object.defineProperty(window.navigator, "share", { configurable: true, value: share });

let container: HTMLDivElement;
let root: Root;

const renderRoom = () =>
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/room/ABCDE"]}>
        <Routes>
          <Route path="/room/:roomCode" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>
    )
  );
const button = (text: string) =>
  [...container.querySelectorAll("button")].find((element) => element.textContent === text);
const press = (text: string) =>
  act(async () => {
    button(text)?.click();
  });

describe("sharing the invite from the waiting room", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setShare(undefined);
    build.mode = "server";
  });

  it("opens the share sheet with the invite link", async () => {
    // Given a phone with a share sheet
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    renderRoom();

    // When the host presses Share invite link
    await press("Share invite link");

    // Then the sheet receives the link, and nothing looks wrong
    expect(share).toHaveBeenCalledExactlyOnceWith({
      title: "Minesweeper Flags",
      url: `${window.location.origin}/invite/AbCdEfGhIjKlMnOpQrStUw`
    });
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("stays quiet when the host closes the share sheet", async () => {
    // Given a host who will close the sheet
    setShare(vi.fn().mockRejectedValue(new DOMException("Closed", "AbortError")));
    renderRoom();

    // When the share settles
    await press("Share invite link");

    // Then no error appears
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("points to Copy when sharing really fails", async () => {
    // Given a browser that refuses to share
    setShare(vi.fn().mockRejectedValue(new DOMException("Refused", "NotAllowedError")));
    renderRoom();

    // When the share settles
    await press("Share invite link");

    // Then the host learns what to do
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Sharing failed. Copy the link instead."
    );
  });

  it("keeps the Copy layout where the browser cannot share", () => {
    // Given a browser with no share sheet
    setShare(undefined);

    // When the waiting room renders
    renderRoom();

    // Then Copy leads, as it always has
    expect(button("Copy invite link")).toBeDefined();
    expect(button("Share invite link")).toBeUndefined();
  });

  it("offers the same Share and Copy in a direct match", async () => {
    // Given a direct-match host on a phone with a share sheet
    build.mode = "p2p";
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    renderRoom();

    // When the host presses Share invite link
    await press("Share invite link");

    // Then the sheet receives the direct link
    expect(share).toHaveBeenCalledExactlyOnceWith({
      title: "Minesweeper Flags",
      url: "https://example.test/p2p/join/session-1"
    });
    expect(button("Copy")).toBeDefined();
  });
});
