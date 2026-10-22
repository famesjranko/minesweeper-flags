// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { HomePage } from "./HomePage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("moves keyboard focus and visible content between both game mode tabs", () => {
  // Given the inert home page without a multiplayer provider
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  act(() => root.render(<HomePage />));

  try {
    // When the player moves from solo to friend and back with arrow keys
    const solo = container.querySelector<HTMLButtonElement>("button[aria-controls='solo-panel']");
    const friend = container.querySelector<HTMLButtonElement>(
      "button[aria-controls='friend-panel']"
    );
    const soloPanel = container.querySelector<HTMLElement>("#solo-panel");
    const friendPanel = container.querySelector<HTMLElement>("#friend-panel");
    solo?.focus();
    act(() =>
      solo?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }))
    );

    // Then friend has focus and only its create-or-join panel is visible
    expect(document.activeElement).toBe(friend);
    expect(friend?.getAttribute("aria-selected")).toBe("true");
    expect(friendPanel?.hidden).toBe(false);
    expect(soloPanel?.hidden).toBe(true);
    expect(container.querySelector<HTMLAnchorElement>("a[href='/lobby']")).not.toBeNull();

    act(() =>
      friend?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }))
    );

    // And returning left restores solo focus and its local-match panel
    expect(document.activeElement).toBe(solo);
    expect(solo?.getAttribute("aria-selected")).toBe("true");
    expect(soloPanel?.hidden).toBe(false);
    expect(friendPanel?.hidden).toBe(true);
    expect(container.querySelector<HTMLAnchorElement>("a[href='/solo']")).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
