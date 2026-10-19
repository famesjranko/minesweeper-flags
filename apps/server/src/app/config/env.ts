import { DEFAULT_SERVER_PORT } from "@minesweeper-flags/shared";
import { parseAllowedOrigins } from "../realtime/websocket-admission.js";
import { parseStateBackend } from "../state/state-backend.js";

export const DEPLOYMENT_MODES = ["local", "public"] as const;

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

const isValidPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

export interface ServerEnv {
  DEPLOYMENT_MODE: DeploymentMode;
  SERVER_PORT: number;
  SERVER_HOST: string;
  WEBSOCKET_PATH: string;
  WEBSOCKET_ALLOWED_ORIGINS: string[];
  MAX_WEBSOCKET_MESSAGE_BYTES: number;
  TRUST_PROXY: boolean;
  MAX_CONNECTIONS_PER_IP: number;
  MAX_CONCURRENT_ROOMS: number;
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

const getPublicModeConfigurationErrors = (env: ServerEnv, rawPort: string | number): string[] => {
  const configurationErrors: string[] = [];

  if (env.STATE_BACKEND !== "redis") {
    configurationErrors.push("DEPLOYMENT_MODE=public requires STATE_BACKEND=redis.");
  }

  if (env.WEBSOCKET_ALLOWED_ORIGINS.length === 0 || env.WEBSOCKET_ALLOWED_ORIGINS.includes("*")) {
    configurationErrors.push(
      "DEPLOYMENT_MODE=public requires WEBSOCKET_ALLOWED_ORIGINS to be set to an explicit allowlist."
    );
  }

  if (!env.TRUST_PROXY) {
    configurationErrors.push("DEPLOYMENT_MODE=public requires TRUST_PROXY=true.");
  }

  if (!isValidPositiveInteger(env.SERVER_PORT)) {
    configurationErrors.push(
      `DEPLOYMENT_MODE=public requires PORT to be a positive integer. Received "${rawPort}".`
    );
  }

  return configurationErrors;
};

export const parseServerEnv = (environment: NodeJS.ProcessEnv = process.env): ServerEnv => {
  const rawPort = environment.PORT ?? DEFAULT_SERVER_PORT;
  const positiveInteger = (name: string, fallback: number): number =>
    parsePositiveInteger(environment[name], fallback);
  const env: ServerEnv = {
    DEPLOYMENT_MODE: parseDeploymentMode(environment.DEPLOYMENT_MODE),
    SERVER_PORT: Number(rawPort),
    SERVER_HOST: environment.HOST ?? "0.0.0.0",
    WEBSOCKET_PATH: environment.WS_PATH ?? "/ws",
    WEBSOCKET_ALLOWED_ORIGINS: parseAllowedOrigins(environment.WEBSOCKET_ALLOWED_ORIGINS),
    MAX_WEBSOCKET_MESSAGE_BYTES: positiveInteger("MAX_WEBSOCKET_MESSAGE_BYTES", 16 * 1024),
    TRUST_PROXY: parseBoolean(environment.TRUST_PROXY, false),
    MAX_CONNECTIONS_PER_IP: positiveInteger("MAX_CONNECTIONS_PER_IP", 6),
    MAX_CONCURRENT_ROOMS: positiveInteger("MAX_CONCURRENT_ROOMS", 4),
    ROOM_CREATE_RATE_LIMIT_MAX: positiveInteger("ROOM_CREATE_RATE_LIMIT_MAX", 4),
    ROOM_CREATE_RATE_LIMIT_WINDOW_MS: positiveInteger("ROOM_CREATE_RATE_LIMIT_WINDOW_MS", 60_000),
    ROOM_JOIN_RATE_LIMIT_MAX: positiveInteger("ROOM_JOIN_RATE_LIMIT_MAX", 10),
    ROOM_JOIN_RATE_LIMIT_WINDOW_MS: positiveInteger("ROOM_JOIN_RATE_LIMIT_WINDOW_MS", 60_000),
    INVALID_MESSAGE_RATE_LIMIT_MAX: positiveInteger("INVALID_MESSAGE_RATE_LIMIT_MAX", 5),
    INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS: positiveInteger(
      "INVALID_MESSAGE_RATE_LIMIT_WINDOW_MS",
      30_000
    ),
    CHAT_MESSAGE_MAX_LENGTH: positiveInteger("CHAT_MESSAGE_MAX_LENGTH", 200),
    CHAT_HISTORY_LIMIT: positiveInteger("CHAT_HISTORY_LIMIT", 25),
    CHAT_MESSAGE_RATE_LIMIT_MAX: positiveInteger("CHAT_MESSAGE_RATE_LIMIT_MAX", 8),
    CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS: positiveInteger("CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS", 10_000),
    SOCKET_HEARTBEAT_INTERVAL_MS: positiveInteger("SOCKET_HEARTBEAT_INTERVAL_MS", 30_000),
    STATE_BACKEND: parseStateBackend(environment.STATE_BACKEND),
    REDIS_URL: environment.REDIS_URL,
    REDIS_KEY_PREFIX: environment.REDIS_KEY_PREFIX ?? "minesweeper-flags",
    RECONNECT_SESSION_TTL_SECONDS: positiveInteger("RECONNECT_SESSION_TTL_SECONDS", 30 * 60)
  };

  if (env.DEPLOYMENT_MODE === "public") {
    const configurationErrors = getPublicModeConfigurationErrors(env, rawPort);

    if (configurationErrors.length > 0) {
      throw new Error(configurationErrors.join(" "));
    }
  }

  return env;
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
export const MAX_CONCURRENT_ROOMS = serverEnv.MAX_CONCURRENT_ROOMS;
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
