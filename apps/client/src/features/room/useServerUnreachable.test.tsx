// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_UNREACHABLE_DELAY_MS, useServerUnreachable } from "./useServerUnreachable.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest = false;
let root: Root;

const Probe = ({ watching, status }: { watching: boolean; status: string }) => {
  latest = useServerUnreachable(watching, status);
  return null;
};

const render = (status: string, watching = true) =>
  act(() => root.render(<Probe watching={watching} status={status} />));
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("useServerUnreachable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("stays quiet during a normal connection", () => {
    // Given a connection that has just started
    render("connecting");

    // When it connects just before the delay ends
    wait(SERVER_UNREACHABLE_DELAY_MS - 1);
    render("connected");
    wait(SERVER_UNREACHABLE_DELAY_MS);

    // Then the player never sees a warning
    expect(latest).toBe(false);
  });

  it("reports the server once the connection has failed to come up", () => {
    // Given a connection that keeps retrying
    render("connecting");

    // When the delay passes
    wait(SERVER_UNREACHABLE_DELAY_MS);

    // Then the notice is due
    expect(latest).toBe(true);
  });

  it("clears as soon as the connection returns, and waits afresh if it drops again", () => {
    // Given the notice is showing
    render("connecting");
    wait(SERVER_UNREACHABLE_DELAY_MS);

    // When the connection returns
    render("connected");
    expect(latest).toBe(false);

    // And then drops again
    render("connecting");

    // Then a brief drop stays quiet until the delay has passed again
    expect(latest).toBe(false);
    wait(SERVER_UNREACHABLE_DELAY_MS);
    expect(latest).toBe(true);
  });

  it("never reports while the caller is not watching", () => {
    // Given a hidden friend panel whose connection has not started
    render("disconnected", false);

    // When time passes
    wait(SERVER_UNREACHABLE_DELAY_MS * 2);

    // Then nothing is reported
    expect(latest).toBe(false);
  });

  it("starts the delay when watching begins", () => {
    // Given a panel that was hidden for a long time
    render("disconnected", false);
    wait(SERVER_UNREACHABLE_DELAY_MS * 2);

    // When the player opens it
    render("connecting", true);

    // Then the new connection gets its full delay
    expect(latest).toBe(false);
    wait(SERVER_UNREACHABLE_DELAY_MS);
    expect(latest).toBe(true);
  });
});
