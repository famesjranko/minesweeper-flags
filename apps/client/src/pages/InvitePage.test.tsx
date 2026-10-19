// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});

describe("InvitePage", () => {
  it("joins when the player presses Enter in the display name field", () => {
    // Given the invite page for a valid invite token
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
});
