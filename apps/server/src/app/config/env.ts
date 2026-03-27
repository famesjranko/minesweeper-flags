import { DEFAULT_SERVER_PORT } from "@minesweeper-flags/shared";
import { parseStateBackend } from "../state/state-backend.js";
import { parseAllowedOrigins } from "../realtime/websocket-admission.js";

export const DEPLOYMENT_MODES = [
  "local",
  "public"
] as const;

export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

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

const parseDeploymentMode = (value: string | undefined): DeploymentMode => {
  if (!value) {
    return "local";
  }

  if (DEPLOYMENT_MODES.includes(value as DeploymentMode)) {
    return value as DeploymentMode;
  }

  throw new Error(
    `Unsupported DEPLOYMENT_MODE "${value}". Expected one of: ${DEPLOYMENT_MODES.join(", ")}.`
  );
};

const isValidPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

export interface ServerEnv {
  DEPLOYMENT_MODE: DeploymentMode;
  SERVER_PORT: number;
  SERVER_HOST: string;
  WEBSOCKET_PATH: string;
  WEBSOCKET_ALLOWED_ORIGINS: string[];
  MAX_WEBSOCKET_MESSAGE_BYTES: number;
  TRUST_PROXY: boolean;
  MAX_CONNECTIONS_PER_IP: number;
  ROOM_CREATE_RATE_LIMIT_MAX: number;
  ROOM_CREATE_RATE_LIMIT_WINDOW_MS: number;
  ROOM_JOIN_RATE_LIMIT_MAX: number;
  ROOM_JOIN_RATE_LIMIT_WINDOW_MS: number;
  INVALID_MESSAGE_RATE_LIMIT_MAX: number;
  INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS: number;
  CHAT_MESSAGE_MAX_LENGTH: number;
  CHAT_HISTORY_LIMIT: number;
  CHAT_MESSAGE_RATE_LIMIT_MAX: number;
  CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS: number;
  SOCKET_HEARTBEAT_INTERVAL_MS: number;
  STATE_BACKEND: ReturnType<typeof parseStateBackend>;
  REDIS_URL: string | undefined;
  REDIS_KEY_PREFIX: string;
  RECONNECT_SESSION_TTL_SECONDS: number;
}

export const parseServerEnv = (environment: NodeJS.ProcessEnv = process.env): ServerEnv => {
  const DEPLOYMENT_MODE = parseDeploymentMode(environment.DEPLOYMENT_MODE);
  const SERVER_PORT = Number(environment.PORT ?? DEFAULT_SERVER_PORT);
  const SERVER_HOST = environment.HOST ?? "0.0.0.0";
  const WEBSOCKET_PATH = environment.WS_PATH ?? "/ws";
  const WEBSOCKET_ALLOWED_ORIGINS = parseAllowedOrigins(environment.WEBSOCKET_ALLOWED_ORIGINS);
  const MAX_WEBSOCKET_MESSAGE_BYTES = parsePositiveInteger(
    environment.MAX_WEBSOCKET_MESSAGE_BYTES,
    16 * 1024
  );
  const TRUST_PROXY = parseBoolean(environment.TRUST_PROXY, false);
  const MAX_CONNECTIONS_PER_IP = parsePositiveInteger(environment.MAX_CONNECTIONS_PER_IP, 6);
  const ROOM_CREATE_RATE_LIMIT_MAX = parsePositiveInteger(
    environment.ROOM_CREATE_RATE_LIMIT_MAX,
    4
  );
  const ROOM_CREATE_RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
    environment.ROOM_CREATE_RATE_LIMIT_WINDOW_MS,
    60_000
  );
  const ROOM_JOIN_RATE_LIMIT_MAX = parsePositiveInteger(
    environment.ROOM_JOIN_RATE_LIMIT_MAX,
    10
  );
  const ROOM_JOIN_RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
    environment.ROOM_JOIN_RATE_LIMIT_WINDOW_MS,
    60_000
  );
  const INVALID_MESSAGE_RATE_LIMIT_MAX = parsePositiveInteger(
    environment.INVALID_MESSAGE_RATE_LIMIT_MAX,
    5
  );
  const INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
    environment.INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS,
    30_000
  );
  const CHAT_MESSAGE_MAX_LENGTH = parsePositiveInteger(
    environment.CHAT_MESSAGE_MAX_LENGTH,
    200
  );
  const CHAT_HISTORY_LIMIT = parsePositiveInteger(environment.CHAT_HISTORY_LIMIT, 25);
  const CHAT_MESSAGE_RATE_LIMIT_MAX = parsePositiveInteger(
    environment.CHAT_MESSAGE_RATE_LIMIT_MAX,
    8
  );
  const CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
    environment.CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS,
    10_000
  );
  const SOCKET_HEARTBEAT_INTERVAL_MS = parsePositiveInteger(
    environment.SOCKET_HEARTBEAT_INTERVAL_MS,
    30_000
  );
  const STATE_BACKEND = parseStateBackend(environment.STATE_BACKEND);
  const REDIS_URL = environment.REDIS_URL;
  const REDIS_KEY_PREFIX = environment.REDIS_KEY_PREFIX ?? "minesweeper-flags";
  const RECONNECT_SESSION_TTL_SECONDS = parsePositiveInteger(
    environment.RECONNECT_SESSION_TTL_SECONDS,
    30 * 60
  );

  if (DEPLOYMENT_MODE === "public") {
    const configurationErrors: string[] = [];

    if (STATE_BACKEND !== "redis") {
      configurationErrors.push("DEPLOYMENT_MODE=public requires STATE_BACKEND=redis.");
    }

    if (WEBSOCKET_ALLOWED_ORIGINS.length === 0 || WEBSOCKET_ALLOWED_ORIGINS.includes("*")) {
      configurationErrors.push(
        "DEPLOYMENT_MODE=public requires WEBSOCKET_ALLOWED_ORIGINS to be set to an explicit allowlist."
      );
    }

    if (!TRUST_PROXY) {
      configurationErrors.push("DEPLOYMENT_MODE=public requires TRUST_PROXY=true.");
    }

    if (!isValidPositiveInteger(SERVER_PORT)) {
      configurationErrors.push(
        `DEPLOYMENT_MODE=public requires PORT to be a positive integer. Received "${environment.PORT ?? DEFAULT_SERVER_PORT}".`
      );
    }

    if (configurationErrors.length > 0) {
      throw new Error(configurationErrors.join(" "));
    }
  }

  return {
    DEPLOYMENT_MODE,
    SERVER_PORT,
    SERVER_HOST,
    WEBSOCKET_PATH,
    WEBSOCKET_ALLOWED_ORIGINS,
    MAX_WEBSOCKET_MESSAGE_BYTES,
    TRUST_PROXY,
    MAX_CONNECTIONS_PER_IP,
    ROOM_CREATE_RATE_LIMIT_MAX,
    ROOM_CREATE_RATE_LIMIT_WINDOW_MS,
    ROOM_JOIN_RATE_LIMIT_MAX,
    ROOM_JOIN_RATE_LIMIT_WINDOW_MS,
    INVALID_MESSAGE_RATE_LIMIT_MAX,
    INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS,
    CHAT_MESSAGE_MAX_LENGTH,
    CHAT_HISTORY_LIMIT,
    CHAT_MESSAGE_RATE_LIMIT_MAX,
    CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS,
    SOCKET_HEARTBEAT_INTERVAL_MS,
    STATE_BACKEND,
    REDIS_URL,
    REDIS_KEY_PREFIX,
    RECONNECT_SESSION_TTL_SECONDS
  };
};

const serverEnv = parseServerEnv(process.env);

export const DEPLOYMENT_MODE = serverEnv.DEPLOYMENT_MODE;
export const SERVER_PORT = serverEnv.SERVER_PORT;
export const SERVER_HOST = serverEnv.SERVER_HOST;
export const WEBSOCKET_PATH = serverEnv.WEBSOCKET_PATH;
export const WEBSOCKET_ALLOWED_ORIGINS = serverEnv.WEBSOCKET_ALLOWED_ORIGINS;
export const MAX_WEBSOCKET_MESSAGE_BYTES = serverEnv.MAX_WEBSOCKET_MESSAGE_BYTES;
export const TRUST_PROXY = serverEnv.TRUST_PROXY;
export const MAX_CONNECTIONS_PER_IP = serverEnv.MAX_CONNECTIONS_PER_IP;
export const ROOM_CREATE_RATE_LIMIT_MAX = serverEnv.ROOM_CREATE_RATE_LIMIT_MAX;
export const ROOM_CREATE_RATE_LIMIT_WINDOW_MS = serverEnv.ROOM_CREATE_RATE_LIMIT_WINDOW_MS;
export const ROOM_JOIN_RATE_LIMIT_MAX = serverEnv.ROOM_JOIN_RATE_LIMIT_MAX;
export const ROOM_JOIN_RATE_LIMIT_WINDOW_MS = serverEnv.ROOM_JOIN_RATE_LIMIT_WINDOW_MS;
export const INVALID_MESSAGE_RATE_LIMIT_MAX = serverEnv.INVALID_MESSAGE_RATE_LIMIT_MAX;
export const INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS = serverEnv.INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS;
export const CHAT_MESSAGE_MAX_LENGTH = serverEnv.CHAT_MESSAGE_MAX_LENGTH;
export const CHAT_HISTORY_LIMIT = serverEnv.CHAT_HISTORY_LIMIT;
export const CHAT_MESSAGE_RATE_LIMIT_MAX = serverEnv.CHAT_MESSAGE_RATE_LIMIT_MAX;
export const CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS = serverEnv.CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS;
export const SOCKET_HEARTBEAT_INTERVAL_MS = serverEnv.SOCKET_HEARTBEAT_INTERVAL_MS;
export const STATE_BACKEND = serverEnv.STATE_BACKEND;
export const REDIS_URL = serverEnv.REDIS_URL;
export const REDIS_KEY_PREFIX = serverEnv.REDIS_KEY_PREFIX;
export const RECONNECT_SESSION_TTL_SECONDS = serverEnv.RECONNECT_SESSION_TTL_SECONDS;
