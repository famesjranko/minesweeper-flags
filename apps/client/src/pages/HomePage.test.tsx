// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RoomLobby } from "../features/room/RoomLobby.js";
import { HomePage } from "./HomePage.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("moves keyboard focus and visible content between both game mode tabs", () => {
  // Given the shared home page with a disconnected friend form
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);

  act(() =>
    root.render(
      <HomePage
        connectionStatus="connecting"
        onFriendSelected={vi.fn()}
        friendContent={
          <RoomLobby
            connectionStatus="connecting"
            deploymentMode="server"
            error={null}
            onCreateRoom={vi.fn()}
            onJoinRoom={vi.fn()}
          />
        }
      />
    )
  );

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

    // Then friend has focus and its room form is visible without another navigation step
    expect(document.activeElement).toBe(friend);
    expect(friend?.getAttribute("aria-selected")).toBe("true");
    expect(friendPanel?.hidden).toBe(false);
    expect(soloPanel?.hidden).toBe(true);
    expect(friendPanel?.querySelector(".lobby-create-button")).not.toBeNull();
    expect(container.querySelector("a[href='/lobby']")).toBeNull();

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

it("keeps the header, selector, and friend drafts when switching modes in place", () => {
  // Given a shared lobby with an editable friend form
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <HomePage
        initialMode="friend"
        connectionStatus="connected"
        onFriendSelected={vi.fn()}
        friendContent={
          <RoomLobby
            connectionStatus="connected"
            deploymentMode="server"
            error={null}
            onCreateRoom={vi.fn()}
            onJoinRoom={vi.fn()}
          />
        }
      />
    )
  );
  try {
    const header = container.querySelector("header");
    const tabs = container.querySelector("[role='tablist']");
    const name = container.querySelector<HTMLInputElement>(
      "input[placeholder='Enter your display name']"
    )!;
    const token = container.querySelector<HTMLInputElement>(".invite-token-input")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setValue.call(name, "Andy");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(token, "AbCdEfGhIjKlMnOpQrStUw");
      token.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // When the player switches to solo and back to friend
    act(() => container.querySelector<HTMLButtonElement>("#solo-tab")!.click());
    act(() => container.querySelector<HTMLButtonElement>("#friend-tab")!.click());

    // Then the same header and selector remain and both drafts are preserved
    expect(container.querySelector("header")).toBe(header);
    expect(container.querySelector("[role='tablist']")).toBe(tabs);
    expect(container.querySelector("input[placeholder='Enter your display name']")).toBe(name);
    expect(name.value).toBe("Andy");
    expect(token.value).toBe("AbCdEfGhIjKlMnOpQrStUw");
    expect(container.querySelector<HTMLButtonElement>(".lobby-join-button")!.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("mounts the friend form before selection while keeping it hidden and inert", () => {
  // Given a cold solo page with an editable friend form
  const container = document.createElement("div");
  const root = createRoot(container);
  const onFriendSelected = vi.fn();
  act(() =>
    root.render(
      <HomePage
        connectionStatus="connecting"
        onFriendSelected={onFriendSelected}
        friendContent={<input aria-label="Friend draft" defaultValue="Andy" />}
      />
    )
  );

  try {
    // When the page has rendered before any friend choice
    const panel = container.querySelector<HTMLElement>("#friend-panel")!;
    const draft = panel.querySelector<HTMLInputElement>("input")!;

    // Then its form already reserves layout without exposing controls or requesting online play
    expect(draft).not.toBeNull();
    expect(panel.hidden).toBe(true);
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(onFriendSelected).not.toHaveBeenCalled();

    // When the player first selects the friend mode
    act(() => container.querySelector<HTMLButtonElement>("#friend-tab")!.click());

    // Then the same form becomes accessible and friend play is requested
    expect(panel.querySelector("input")).toBe(draft);
    expect(panel.hidden).toBe(false);
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(onFriendSelected).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#solo-panel")?.hasAttribute("inert")).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});

it("follows the route when browser history changes the selected mode", () => {
  // Given the shared lobby opened on the friend route
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (initialMode: "solo" | "friend") =>
    act(() =>
      root.render(
        <HomePage
          initialMode={initialMode}
          connectionStatus="connected"
          onFriendSelected={vi.fn()}
          friendContent={<p>Friend form</p>}
        />
      )
    );
  render("friend");

  try {
    // When browser history returns to the game selection route
    render("solo");

    // Then the solo tab is selected and its panel is shown
    const solo = container.querySelector("button[aria-controls='solo-panel']");
    expect(solo?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector<HTMLElement>("#solo-panel")?.hidden).toBe(false);
  } finally {
    act(() => root.unmount());
  }
});
