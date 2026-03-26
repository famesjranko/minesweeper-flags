import { createClient } from "redis";
import { logger } from "../../lib/logging/logger.js";

export interface RedisSetOptions {
  expireInSeconds?: number;
}

export interface RedisStateClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<void>;
  del(keys: string | string[]): Promise<number>;
  exists(key: string): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  hSet(key: string, values: Record<string, string>): Promise<number>;
  hDel(key: string, fields: string[]): Promise<number>;
  sAdd(key: string, members: string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  sRem(key: string, members: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  close(): Promise<void>;
}

interface CreateRedisStateClientOptions {
  url: string;
}

export const createRedisStateClient = async ({
  url
}: CreateRedisStateClientOptions): Promise<RedisStateClient> => {
  const client = createClient({ url });

  client.on("error", (error) => {
    logger.error("state.redis_client_error", { error });
  });

  await client.connect();

  return {
    get: async (key) => await client.get(key),
    set: async (key, value, options) => {
      if (options?.expireInSeconds) {
        await client.set(key, value, { EX: options.expireInSeconds });
        return;
      }

      await client.set(key, value);
    },
    del: async (keys) => {
      if (Array.isArray(keys)) {
        return keys.length === 0 ? 0 : await client.del(keys);
      }

      return await client.del(keys);
    },
    exists: async (key) => await client.exists(key),
    hGet: async (key, field) => await client.hGet(key, field),
    hSet: async (key, values) => {
      return Object.keys(values).length === 0 ? 0 : await client.hSet(key, values);
    },
    hDel: async (key, fields) => {
      return fields.length === 0 ? 0 : await client.hDel(key, fields);
    },
    sAdd: async (key, members) => {
      return members.length === 0 ? 0 : await client.sAdd(key, members);
    },
    sMembers: async (key) => await client.sMembers(key),
    sRem: async (key, members) => {
      return members.length === 0 ? 0 : await client.sRem(key, members);
    },
    expire: async (key, seconds) => await client.expire(key, seconds),
    close: async () => {
      if (client.isOpen) {
        await client.quit();
      }
    }
  };
};
