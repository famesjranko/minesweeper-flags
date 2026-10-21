// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { HomePage } from "./HomePage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("switches between local solo play and the friend lobby without a game client", () => {
  // Given the inert home page without a multiplayer provider
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  act(() => root.render(<HomePage />));

  try {
    // When the player chooses the friend segment with the keyboard
    const friend = container.querySelector<HTMLButtonElement>(
      "button[aria-controls='friend-panel']"
    );
    friend?.focus();
    act(() => friend?.click());

    // Then the selected panel keeps the normal create-or-join-room route available
    expect(document.activeElement).toBe(friend);
    expect(friend?.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Create or join a room");
    expect(container.querySelector<HTMLAnchorElement>("a[href='/lobby']")).not.toBeNull();
    expect(container.querySelector<HTMLAnchorElement>("a[href='/solo']")).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
