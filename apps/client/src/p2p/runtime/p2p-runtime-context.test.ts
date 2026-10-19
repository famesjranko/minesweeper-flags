import { describe, expect, it } from "vitest";
import type { P2PRuntimeDependencies } from "./p2p-runtime-context.js";
import { P2PRuntimeContext } from "./p2p-runtime-context.js";

function createContext(): P2PRuntimeContext {
  // Teardown touches only the scheduler's clearTimeout; the other dependencies stay unused.
  const dependencies = {
    scheduler: { clearTimeout: () => {} },
    rendezvousClient: {}
  } as unknown as P2PRuntimeDependencies;
  return new P2PRuntimeContext(dependencies);
}

function seedRuntime(context: P2PRuntimeContext) {
  const controller = new AbortController();
  context.hostReconnectAbortController = controller;
  context.hostReconnectControl = {
    controlSessionId: "control-1",
    hostSecret: "host-secret",
    guestSecret: "guest-secret"
  };
  context.activeRole = "host";
  return controller;
}

describe("P2PRuntimeContext teardown", () => {
  it("clears hostReconnectControl when the active runtime is torn down", () => {
    // Given a host runtime with reconnect control and an in-flight reconnect
    const context = createContext();
    const controller = seedRuntime(context);

    // When the active runtime is torn down
    context.teardownActiveRuntime();

    // Then the reconnect control is cleared and the reconnect is aborted
    expect(context.hostReconnectControl).toBeNull();
    expect(controller.signal.aborted).toBe(true);
    expect(context.hostReconnectAbortController).toBeNull();
    expect(context.activeRole).toBeNull();
  });

  it("keeps hostReconnectControl when a failed runtime is torn down", () => {
    // Given a host runtime with reconnect control and an in-flight reconnect
    const context = createContext();
    const controller = seedRuntime(context);

    // When the failed runtime is torn down
    context.teardownFailedRuntime();

    // Then the reconnect control survives so the host can reclaim, and the rest is reset
    expect(context.hostReconnectControl).toEqual({
      controlSessionId: "control-1",
      hostSecret: "host-secret",
      guestSecret: "guest-secret"
    });
    expect(controller.signal.aborted).toBe(true);
    expect(context.hostReconnectAbortController).toBeNull();
    expect(context.activeRole).toBeNull();
  });
});
