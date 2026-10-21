// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { storeSession } from "../lib/socket/session-storage.js";
import { InvitePage } from "./InvitePage.js";

const joinRoom = vi.fn();

vi.mock("../features/connection/useGameClient.js", () => ({
  useGameClient: () => ({
    connectionStatus: "connected",
    error: null,
    session: null,
    joinRoom,
    clearError: () => {}
  })
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INVITE_TOKEN = "AbCdEfGhIjKlMnOpQrStUw";
let root: Root | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  joinRoom.mockClear();
  localStorage.clear();
});

describe("InvitePage", () => {
  it("returns a player to their saved room when a used invitation is reopened", () => {
    // Given a saved seat associated with this invitation and an unrelated room
    localStorage.setItem("msf:session:STALE", "{broken");
    storeSession({
      roomId: "room-1",
      roomCode: "ABCDE",
      inviteToken: INVITE_TOKEN,
      playerId: "guest-1",
      displayName: "Guest",
      sessionToken: "guest-session"
    });
    storeSession({
      roomId: "room-2",
      roomCode: "OTHER",
      inviteToken: "ZyXwVuTsRqPoNmLkJiHgFe",
      playerId: "host-2",
      displayName: "Other",
      sessionToken: "other-session"
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // When the browser reloads the original invitation instead of the room URL
    act(() => {
      root?.render(
        <MemoryRouter initialEntries={[`/invite/${INVITE_TOKEN}`]}>
          <Routes>
            <Route path="/invite/:inviteToken" element={<InvitePage />} />
            <Route path="/room/ABCDE" element={<p>Saved room recovery</p>} />
          </Routes>
        </MemoryRouter>
      );
    });

    // Then the room route restores the saved seat without trying to join again
    expect(container.textContent).toBe("Saved room recovery");
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it("joins when the player presses Enter in the display name field", () => {
    // Given a new invitation and a saved seat belonging to another invitation
    storeSession({
      roomId: "room-2",
      roomCode: "OTHER",
      inviteToken: "ZyXwVuTsRqPoNmLkJiHgFe",
      playerId: "host-2",
      displayName: "Other",
      sessionToken: "other-session"
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <MemoryRouter initialEntries={[`/invite/${INVITE_TOKEN}`]}>
          <Routes>
            <Route path="/invite/:inviteToken" element={<InvitePage />} />
          </Routes>
        </MemoryRouter>
      );
    });
    const nameField = container.querySelector<HTMLInputElement>(
      "input[placeholder='Enter your display name']"
    );

    // When the name field submits its form, as a browser does on Enter
    act(() => {
      nameField?.form?.requestSubmit();
    });

    // Then the player joins with the default name and the invite token
    expect(joinRoom).toHaveBeenCalledWith("Captain Sweeper", INVITE_TOKEN);
  });

  it("keeps a new invitation usable when browser storage is blocked", () => {
    // Given a browser that blocks access to local session storage
    const storage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // When the invite page opens and the guest submits the join form
    try {
      act(() => {
        root?.render(
          <MemoryRouter initialEntries={[`/invite/${INVITE_TOKEN}`]}>
            <Routes>
              <Route path="/invite/:inviteToken" element={<InvitePage />} />
            </Routes>
          </MemoryRouter>
        );
      });
      act(() => {
        container.querySelector("form")?.requestSubmit();
      });

      // Then the new join still works without a saved seat
      expect(joinRoom).toHaveBeenCalledWith("Captain Sweeper", INVITE_TOKEN);
    } finally {
      storage.mockRestore();
    }
  });
});
