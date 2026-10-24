// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { LobbyPage } from "./LobbyPage.js";

const { openLobby, gameClient } = vi.hoisted(() => {
  const openLobby = vi.fn();
  return {
    openLobby,
    gameClient: {
      openLobby,
      connectionStatus: "connected",
      error: null,
      session: { roomCode: "ABCDE" },
      match: { phase: "live" },
      createRoom: vi.fn(),
      joinRoom: vi.fn(),
      slotAvailability: null,
      refreshSlotCount: vi.fn(),
      roomCancelPending: false,
      roomCancelAttempted: false
    }
  };
});
vi.mock("../features/connection/useGameClient.js", () => ({ useGameClient: () => gameClient }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps a live match connected when browser Back reaches the friend lobby", () => {
  // Given a player whose match is still live
  const container = document.createElement("div");
  const root = createRoot(container);

  // When the friend lobby route renders
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/lobby"]}>
        <LobbyPage />
      </MemoryRouter>
    )
  );

  try {
    // Then the lobby does not leave the match
    expect(openLobby).not.toHaveBeenCalled();

    // And it offers a way back to the match instead of the room form
    const link = container.querySelector<HTMLAnchorElement>("a[href='/room/ABCDE']");
    expect(link?.textContent).toBe("Return to match");
    expect(container.querySelector(".lobby-create-button[type='submit']")).toBeNull();
  } finally {
    act(() => root.unmount());
  }
});

const RouteProbe = ({ onRoute }: { onRoute: (route: string) => void }) => {
  const { pathname } = useLocation();
  onRoute(`${useNavigationType()} ${pathname}`);
  return null;
};

const renderLobbyAt = (path: string) => {
  const routes: string[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<LobbyPage />} />
          <Route path="/lobby" element={<LobbyPage />} />
        </Routes>
        <RouteProbe onRoute={(route) => routes.push(route)} />
      </MemoryRouter>
    )
  );
  const clickTab = (name: string) => {
    const tab = [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")].find(
      (button) => button.textContent === name
    );
    act(() => tab?.click());
  };
  return { routes, clickTab, unmount: () => act(() => root.unmount()) };
};

it("records the friend tab in the URL so a reload reopens it", () => {
  // Given the home page on the Solo tab
  const page = renderLobbyAt("/");

  // When the player chooses With a friend
  page.clickTab("With a friend");

  try {
    // Then the URL becomes the friend lobby without a new history entry
    expect(page.routes.at(-1)).toBe("REPLACE /lobby");
  } finally {
    page.unmount();
  }
});

it("records the solo tab in the URL so a reload reopens it", () => {
  // Given the friend lobby on the With a friend tab
  const page = renderLobbyAt("/lobby");

  // When the player chooses Solo
  page.clickTab("Solo");

  try {
    // Then the URL becomes the home page without a new history entry
    expect(page.routes.at(-1)).toBe("REPLACE /");
  } finally {
    page.unmount();
  }
});
