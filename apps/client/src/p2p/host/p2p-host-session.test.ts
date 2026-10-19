import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultP2PHostIdentityFactory } from "./p2p-host-session.js";

const realCrypto = globalThis.crypto;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("default P2P host identity factory", () => {
  it("creates ids on a plain-HTTP origin, where crypto.randomUUID does not exist", () => {
    // Given a browser crypto without randomUUID, as on http://192.168.x.x
    vi.stubGlobal("crypto", {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto)
    });
    const factory = createDefaultP2PHostIdentityFactory();

    // When the host creates two ids
    const first = factory.createId();
    const second = factory.createId();

    // Then both are 128-bit hex ids
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);

    // And they differ
    expect(first).not.toBe(second);
  });

  it("refuses to create ids when no secure random source exists", () => {
    // Given no crypto at all
    vi.stubGlobal("crypto", undefined);
    const factory = createDefaultP2PHostIdentityFactory();

    // When the host creates an id
    const createId = () => factory.createId();

    // Then it fails instead of issuing a guessable id
    expect(createId).toThrow("Secure random numbers are unavailable");
  });
});
