import { DEFAULT_SERVER_PORT } from "@minesweeper-flags/shared";
import { parseStateBackend } from "../state/state-backend.js";

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
};

export const SERVER_PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
export const SERVER_HOST = process.env.HOST ?? "0.0.0.0";
export const WEBSOCKET_PATH = process.env.WS_PATH ?? "/ws";
export const TRUST_PROXY = parseBoolean(process.env.TRUST_PROXY, false);
export const MAX_CONNECTIONS_PER_IP = parsePositiveInteger(process.env.MAX_CONNECTIONS_PER_IP, 6);
export const ROOM_CREATE_RATE_LIMIT_MAX = parsePositiveInteger(
  process.env.ROOM_CREATE_RATE_LIMIT_MAX,
  4
);
export const ROOM_CREATE_RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
  process.env.ROOM_CREATE_RATE_LIMIT_WINDOW_MS,
  60_000
);
export const ROOM_JOIN_RATE_LIMIT_MAX = parsePositiveInteger(
  process.env.ROOM_JOIN_RATE_LIMIT_MAX,
  10
);
export const ROOM_JOIN_RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
  process.env.ROOM_JOIN_RATE_LIMIT_WINDOW_MS,
  60_000
);
export const INVALID_MESSAGE_RATE_LIMIT_MAX = parsePositiveInteger(
  process.env.INVALID_MESSAGE_RATE_LIMIT_MAX,
  5
);
export const INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
  process.env.INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS,
  30_000
);
export const SOCKET_HEARTBEAT_INTERVAL_MS = parsePositiveInteger(
  process.env.SOCKET_HEARTBEAT_INTERVAL_MS,
  30_000
);
export const STATE_BACKEND = parseStateBackend(process.env.STATE_BACKEND);
export const REDIS_URL = process.env.REDIS_URL;
export const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? "minesweeper-flags";
export const RECONNECT_SESSION_TTL_SECONDS = parsePositiveInteger(
  process.env.RECONNECT_SESSION_TTL_SECONDS,
  30 * 60
);
