import { createClient } from "redis";
import { logger } from "../../lib/logging/logger.js";

export interface RedisSetOptions {
  expireInSeconds?: number;
}

export type RedisTransactionCommand =
  | {
      type: "set";
      key: string;
      value: string;
      options?: RedisSetOptions;
    }
  | {
      type: "del";
      keys: string[];
    }
  | {
      type: "lTrim";
      key: string;
      start: number;
      stop: number;
    }
  | {
      type: "rPush";
      key: string;
      values: string[];
    }
  | {
      type: "hSet";
      key: string;
      values: Record<string, string>;
    }
  | {
      type: "hDel";
      key: string;
      fields: string[];
    }
  | {
      type: "sAdd";
      key: string;
      members: string[];
    }
  | {
      type: "sRem";
      key: string;
      members: string[];
    }
  | {
      type: "expire";
      key: string;
      seconds: number;
    };

export interface RedisStateClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: RedisSetOptions): Promise<void>;
  del(keys: string | string[]): Promise<number>;
  exists(key: string): Promise<number>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  lTrim(key: string, start: number, stop: number): Promise<void>;
  rPush(key: string, values: string[]): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  hSet(key: string, values: Record<string, string>): Promise<number>;
  hDel(key: string, fields: string[]): Promise<number>;
  sAdd(key: string, members: string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  sRem(key: string, members: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  executeTransaction(commands: RedisTransactionCommand[]): Promise<void>;
  close(): Promise<void>;
}

interface CreateRedisStateClientOptions {
  url: string;
}

type RedisTransaction = ReturnType<ReturnType<typeof createClient>["multi"]>;

// Redis rejects variadic commands with an empty argument list, so commands
// with nothing to write are dropped from the transaction instead of queued.
const isNoOpTransactionCommand = (command: RedisTransactionCommand): boolean => {
  switch (command.type) {
    case "del":
      return command.keys.length === 0;
    case "rPush":
      return command.values.length === 0;
    case "hSet":
      return Object.keys(command.values).length === 0;
    case "hDel":
      return command.fields.length === 0;
    case "sAdd":
    case "sRem":
      return command.members.length === 0;
    default:
      return false;
  }
};

const queueTransactionCommand = (
  transaction: RedisTransaction,
  command: RedisTransactionCommand
): void => {
  switch (command.type) {
    case "set":
      if (command.options?.expireInSeconds) {
        transaction.set(command.key, command.value, { EX: command.options.expireInSeconds });
      } else {
        transaction.set(command.key, command.value);
      }
      break;
    case "del":
      transaction.del(command.keys);
      break;
    case "lTrim":
      transaction.lTrim(command.key, command.start, command.stop);
      break;
    case "rPush":
      transaction.rPush(command.key, command.values);
      break;
    case "hSet":
      transaction.hSet(command.key, command.values);
      break;
    case "hDel":
      transaction.hDel(command.key, command.fields);
      break;
    case "sAdd":
      transaction.sAdd(command.key, command.members);
      break;
    case "sRem":
      transaction.sRem(command.key, command.members);
      break;
    case "expire":
      transaction.expire(command.key, command.seconds);
      break;
  }
};

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
    lRange: async (key, start, stop) => await client.lRange(key, start, stop),
    lTrim: async (key, start, stop) => {
      await client.lTrim(key, start, stop);
    },
    rPush: async (key, values) => {
      return values.length === 0 ? 0 : await client.rPush(key, values);
    },
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
    executeTransaction: async (commands) => {
      if (commands.length === 0) {
        return;
      }

      const transaction = client.multi();

      for (const command of commands) {
        if (!isNoOpTransactionCommand(command)) {
          queueTransactionCommand(transaction, command);
        }
      }

      const result = await transaction.exec();

      if (result === null) {
        throw new Error("Redis transaction did not complete.");
      }
    },
    close: async () => {
      if (client.isOpen) {
        await client.quit();
      }
    }
  };
};
