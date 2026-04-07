import { beforeEach, describe, expect, it, vi } from "vitest";

const redisModule = vi.hoisted(() => ({
  createClient: vi.fn()
}));

vi.mock("redis", () => ({
  createClient: redisModule.createClient
}));

import { createSignalingRedisClient } from "./redis-client.js";

class FakeRawRedisClient {
  private readonly values = new Map<string, string>();
  private readonly expiresAt = new Map<string, number>();
  isOpen = true;

  on(): void {}

  async connect(): Promise<void> {}

  async get(key: string): Promise<string | null> {
    this.evictExpired(key);
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: true }
  ): Promise<"OK" | null> {
    this.evictExpired(key);

    if (options?.NX && this.values.has(key)) {
      return null;
    }

    this.values.set(key, value);

    if (options?.EX) {
      this.expiresAt.set(key, Date.now() + options.EX * 1000);
    } else {
      this.expiresAt.delete(key);
    }

    return "OK";
  }

  async eval(
    _script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<number> {
    const [key] = options.keys;
    const [expectedValue, nextValue, ttlSeconds] = options.arguments;

    if (!key || expectedValue === undefined || nextValue === undefined) {
      throw new Error("Expected compareAndSwap key and arguments.");
    }

    const currentValue = await this.get(key);

    await Promise.resolve();

    if (currentValue !== expectedValue) {
      return 0;
    }

    this.values.set(key, nextValue);

    if (ttlSeconds) {
      this.expiresAt.set(key, Date.now() + Number(ttlSeconds) * 1000);
    } else {
      this.expiresAt.delete(key);
    }

    return 1;
  }

  async del(keys: string | string[]): Promise<number> {
    const list = Array.isArray(keys) ? keys : [keys];
    let deleted = 0;

    for (const key of list) {
      this.evictExpired(key);

      if (this.values.delete(key)) {
        this.expiresAt.delete(key);
        deleted += 1;
      }
    }

    return deleted;
  }

  async quit(): Promise<void> {
    this.isOpen = false;
  }

  getExpiry(key: string): number | undefined {
    this.evictExpired(key);
    return this.expiresAt.get(key);
  }

  private evictExpired(key: string): void {
    const expiresAt = this.expiresAt.get(key);

    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.expiresAt.delete(key);
      this.values.delete(key);
    }
  }
}

describe("signaling redis client", () => {
  let rawClient: FakeRawRedisClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    rawClient = new FakeRawRedisClient();
    redisModule.createClient.mockReturnValue(rawClient);
  });

  it("applies compare-and-swap updates and ttl atomically", async () => {
    const client = await createSignalingRedisClient("redis://test");
    await client.set("session", "open");

    await expect(
      client.compareAndSwap("session", "open", "answered", { expireInSeconds: 5 })
    ).resolves.toBe(true);

    await expect(client.get("session")).resolves.toBe("answered");
    expect(rawClient.getExpiry("session")).toBe(15_000);
  });

  it("returns false on compare-and-swap mismatch without changing the value", async () => {
    const client = await createSignalingRedisClient("redis://test");
    await client.set("session", "open", { expireInSeconds: 3 });

    await expect(
      client.compareAndSwap("session", "other", "answered", { expireInSeconds: 8 })
    ).resolves.toBe(false);

    await expect(client.get("session")).resolves.toBe("open");
    expect(rawClient.getExpiry("session")).toBe(13_000);
  });

  it("does not let overlapping compare-and-swap calls interfere across keys", async () => {
    const client = await createSignalingRedisClient("redis://test");
    await client.set("session:a", "open-a");
    await client.set("session:b", "open-b");

    const [first, second] = await Promise.all([
      client.compareAndSwap("session:a", "open-a", "answered-a", { expireInSeconds: 5 }),
      client.compareAndSwap("session:b", "open-b", "answered-b", { expireInSeconds: 7 })
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    await expect(client.get("session:a")).resolves.toBe("answered-a");
    await expect(client.get("session:b")).resolves.toBe("answered-b");
    expect(rawClient.getExpiry("session:a")).toBe(15_000);
    expect(rawClient.getExpiry("session:b")).toBe(17_000);
  });
});
