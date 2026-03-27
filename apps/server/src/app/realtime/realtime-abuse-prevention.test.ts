import { describe, expect, it } from "vitest";
import { RealtimeAbusePrevention } from "./realtime-abuse-prevention.js";

const createAbusePrevention = () =>
  new RealtimeAbusePrevention({
    maxConnectionsPerIp: 2,
    roomCreateLimit: {
      maxEvents: 2,
      windowMs: 1_000
    },
    roomJoinLimit: {
      maxEvents: 3,
      windowMs: 1_000
    },
    chatMessageLimit: {
      maxEvents: 2,
      windowMs: 750
    },
    invalidMessageLimit: {
      maxEvents: 2,
      windowMs: 500
    }
  });

describe("realtime abuse prevention", () => {
  it("caps active connections per ip", () => {
    const abusePrevention = createAbusePrevention();

    expect(abusePrevention.registerConnection("1.2.3.4")).toEqual({
      allowed: true,
      limit: 2,
      activeConnections: 1
    });
    expect(abusePrevention.registerConnection("1.2.3.4")).toEqual({
      allowed: true,
      limit: 2,
      activeConnections: 2
    });
    expect(abusePrevention.registerConnection("1.2.3.4")).toEqual({
      allowed: false,
      limit: 2,
      activeConnections: 3
    });

    abusePrevention.unregisterConnection("1.2.3.4");

    expect(abusePrevention.getActiveConnections("1.2.3.4")).toBe(2);
  });

  it("rate limits room creation within the configured window", () => {
    const abusePrevention = createAbusePrevention();

    expect(abusePrevention.consumeRoomCreate("1.2.3.4", 0).allowed).toBe(true);
    expect(abusePrevention.consumeRoomCreate("1.2.3.4", 100).allowed).toBe(true);

    expect(abusePrevention.consumeRoomCreate("1.2.3.4", 200)).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterMs: 800
    });

    expect(abusePrevention.consumeRoomCreate("1.2.3.4", 1_100).allowed).toBe(true);
  });

  it("tracks room join and invalid-message windows independently", () => {
    const abusePrevention = createAbusePrevention();

    expect(abusePrevention.consumeRoomJoin("1.2.3.4", 0).allowed).toBe(true);
    expect(abusePrevention.consumeRoomJoin("1.2.3.4", 1).allowed).toBe(true);
    expect(abusePrevention.consumeRoomJoin("1.2.3.4", 2).allowed).toBe(true);
    expect(abusePrevention.consumeRoomJoin("1.2.3.4", 3).allowed).toBe(false);

    expect(abusePrevention.recordInvalidMessage("1.2.3.4", 0).allowed).toBe(true);
    expect(abusePrevention.recordInvalidMessage("1.2.3.4", 100).allowed).toBe(true);
    expect(abusePrevention.recordInvalidMessage("1.2.3.4", 200)).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterMs: 300
    });
  });

  it("rate limits chat messages per player id", () => {
    const abusePrevention = createAbusePrevention();

    expect(abusePrevention.consumeChatMessage("player-1", 0).allowed).toBe(true);
    expect(abusePrevention.consumeChatMessage("player-1", 100).allowed).toBe(true);
    expect(abusePrevention.consumeChatMessage("player-1", 200)).toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterMs: 550
    });
    expect(abusePrevention.consumeChatMessage("player-2", 200).allowed).toBe(true);
  });

  it("isolates counters per ip address", () => {
    const abusePrevention = createAbusePrevention();

    abusePrevention.consumeRoomCreate("1.2.3.4", 0);

    expect(abusePrevention.consumeRoomCreate("5.6.7.8", 0)).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      retryAfterMs: 0
    });
  });

  it("prunes expired rate-limit buckets during later traffic", () => {
    const abusePrevention = createAbusePrevention();
    const bucketsByKey = (abusePrevention as unknown as { bucketsByKey: Map<string, unknown> })
      .bucketsByKey;

    abusePrevention.consumeRoomCreate("1.2.3.4", 0);
    abusePrevention.consumeChatMessage("player-1", 0);
    expect(bucketsByKey.size).toBe(2);

    abusePrevention.consumeRoomJoin("5.6.7.8", 2_000);

    expect(bucketsByKey.size).toBe(1);
  });
});
