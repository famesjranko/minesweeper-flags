// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_UNREACHABLE_DELAY_MS } from "../features/room/useServerUnreachable.js";
import { LobbyPage } from "./LobbyPage.js";

const { build, gameClient } = vi.hoisted(() => ({
  build: { mode: "server" },
  gameClient: {
    openLobby: vi.fn(),
    connectionStatus: "connecting",
    error: null,
    session: null,
    match: null,
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    slotAvailability: null,
    refreshSlotCount: vi.fn(),
    roomCancelPending: false,
    roomCancelAttempted: false
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

let container: HTMLDivElement;
let root: Root;

const renderLobbyAt = (path: string) =>
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <LobbyPage />
      </MemoryRouter>
    )
  );
const waitPastDelay = () => act(() => vi.advanceTimersByTime(SERVER_UNREACHABLE_DELAY_MS));
const notice = () => container.querySelector(".server-unreachable");

describe("the friend lobby's server notice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    build.mode = "server";
  });

  it("appears when a server build cannot reach its server", () => {
    // Given the friend tab of a server build whose connection never comes up
    renderLobbyAt("/lobby");
    expect(notice()).toBeNull();

    // When the normal connection time has passed
    waitPastDelay();

    // Then the player learns why and sees the way to Solo
    expect(notice()?.textContent).toContain("Can’t reach the game server.");
    expect(notice()?.querySelector("a")?.getAttribute("href")).toBe("/");
  });

  it("stays away from the Solo tab, where nothing is connecting", () => {
    // Given a player on the Solo tab who never asked for a friend match
    renderLobbyAt("/");

    // When time passes
    waitPastDelay();

    // Then the Solo player sees no server warning
    expect(notice()).toBeNull();
  });

  it("reports the connection in a server build", () => {
    // Given the friend tab of a server build
    // When it renders
    renderLobbyAt("/lobby");

    // Then the header shows the connection state
    expect(container.querySelector(".arcade-connection")?.textContent).toBe("Connecting…");
  });

  it("shows no connection state in a direct-match lobby, which has no server link", () => {
    // Given the friend tab of a direct-match build, before anything has started
    build.mode = "p2p";

    // When it renders
    renderLobbyAt("/lobby");

    // Then no misleading status appears
    expect(container.querySelector(".arcade-connection")).toBeNull();
  });

  it("stays away from a direct-match build, which has no game server", () => {
    // Given a direct-match build
    build.mode = "p2p";
    renderLobbyAt("/lobby");

    // When time passes
    waitPastDelay();

    // Then the player sees no server warning
    expect(notice()).toBeNull();
  });
});
