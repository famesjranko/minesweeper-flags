// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomRecoveryNotice } from "./RoomRecoveryNotice.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onReconnect = vi.fn();
const onReload = vi.fn();
const render = (waiting: boolean, displaced = false, isP2PDeployment = false) =>
  act(() =>
    root.render(
      <MemoryRouter>
        <RoomRecoveryNotice
          waiting={waiting}
          displaced={displaced}
          isP2PDeployment={isP2PDeployment}
          onReconnect={onReconnect}
          onReload={onReload}
        />
      </MemoryRouter>
    )
  );

beforeEach(() => {
  vi.useFakeTimers();
  onReconnect.mockClear();
  onReload.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("inline recovery guidance", () => {
  it.each([false, true])("escalates a prolonged recovery in p2p=%s", (p2p) => {
    // Given a connection still being recovered
    render(true, false, p2p);

    // When the normal recovery interval has almost passed
    act(() => vi.advanceTimersByTime(14_999));

    // Then no extra guidance flashes during a normal reconnect
    expect(container.querySelector("aside")).toBeNull();

    // And after fifteen seconds, actionable guidance appears without forcing a reload
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Taking longer than usual"
    );
    expect(container.textContent).toContain("Check your internet connection.");
    expect(container.textContent?.includes("keep their game tab open")).toBe(p2p);
    expect(container.querySelector('a[href="/lobby"]')).not.toBeNull();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("clears on recovery and gives the next outage its own delay", () => {
    // Given a prolonged outage with guidance already visible
    render(true);
    act(() => vi.advanceTimersByTime(15_000));
    expect(container.querySelector("aside")).not.toBeNull();

    // When the connection returns, then drops again
    render(false);
    expect(container.querySelector("aside")).toBeNull();
    render(true);
    act(() => vi.advanceTimersByTime(14_999));

    // Then the next outage does not inherit the old timeout
    expect(container.querySelector("aside")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector("aside")).not.toBeNull();
  });

  it("reclaims a displaced game only when the player asks", () => {
    // Given a tab displaced by another tab
    render(false, true);
    expect(container.textContent).toContain("Game active in another tab");
    expect(onReconnect).not.toHaveBeenCalled();

    // When the player chooses Reconnect here
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Reconnect here");
    act(() => button!.click());

    // Then control is reclaimed through the room recovery callback
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("reloads only when the player chooses to restart recovery", () => {
    // Given a prolonged outage
    render(true);
    act(() => vi.advanceTimersByTime(15_000));

    // When the player chooses Reload and reconnect
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Reload and reconnect");
    act(() => button!.click());

    // Then the reload callback runs without also claiming another tab's seat
    expect(onReload).toHaveBeenCalledOnce();
    expect(onReconnect).not.toHaveBeenCalled();
  });
});
