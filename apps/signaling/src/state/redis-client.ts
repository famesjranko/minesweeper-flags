import { createClient } from "redis";

const COMPARE_AND_SWAP_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then
  return 0
end

if ARGV[3] ~= '' then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
else
  redis.call('SET', KEYS[1], ARGV[2])
end

return 1
`;

export interface RedisSetOptions {
  expireInSeconds?: number;
  onlyIfAbsent?: boolean;
}

export interface RedisCompareAndSwapOptions {
  expireInSeconds?: number;
}

export interface SignalingRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<boolean>;
  compareAndSwap(
    key: string,
    expectedValue: string,
    nextValue: string,
    options?: RedisCompareAndSwapOptions
  ): Promise<boolean>;
  del(key: string | string[]): Promise<number>;
  close(): Promise<void>;
}

export const createSignalingRedisClient = async (
  url: string
): Promise<SignalingRedisClient> => {
  const client = createClient({ url });

  client.on("error", (error) => {
    console.error("signaling.redis_client_error", error);
  });

  await client.connect();

  return {
    get: async (key) => await client.get(key),
    set: async (key, value, options) => {
      const setOptions: { EX?: number; NX?: true } = {};

      if (options?.expireInSeconds) {
        setOptions.EX = options.expireInSeconds;
      }

      if (options?.onlyIfAbsent) {
        setOptions.NX = true;
      }

      const response = await client.set(key, value, setOptions);

      return response === "OK";
    },
    compareAndSwap: async (key, expectedValue, nextValue, options) => {
      const result = await client.eval(COMPARE_AND_SWAP_SCRIPT, {
        keys: [key],
        arguments: [
          expectedValue,
          nextValue,
          options?.expireInSeconds ? String(options.expireInSeconds) : ""
        ]
      });

      return result === 1;
    },
    del: async (keys) => {
      if (Array.isArray(keys)) {
        return keys.length === 0 ? 0 : await client.del(keys);
      }

      return await client.del(keys);
    },
    close: async () => {
      if (client.isOpen) {
        await client.quit();
      }
    }
  };
};
