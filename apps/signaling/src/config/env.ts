import { parseStateBackend, type StateBackend } from "../state/state-backend.js";

export const DEPLOYMENT_MODES = ["local", "public"] as const;

export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

const DEFAULT_SIGNALING_PORT = 3002;

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

const normalizeOrigin = (value: string): string | null => {
  if (value === "*") {
    return value;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

export const parseAllowedOrigins = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return [];
  }

  if (origins.includes("*")) {
    return ["*"];
  }

  return origins.map((origin) => {
    const normalizedOrigin = normalizeOrigin(origin);

    if (!normalizedOrigin) {
      throw new Error(`Invalid SIGNALING_ALLOWED_ORIGINS entry "${origin}".`);
    }

    return normalizedOrigin;
  });
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

export interface SignalingEnv {
  DEPLOYMENT_MODE: DeploymentMode;
  HOST: string;
  PORT: number;
  STATE_BACKEND: StateBackend;
  REDIS_URL: string | undefined;
  REDIS_KEY_PREFIX: string;
  P2P_SIGNALING_SESSION_TTL_SECONDS: number;
  P2P_SIGNALING_MAX_PAYLOAD_BYTES: number;
  TRUST_PROXY: boolean;
  SIGNALING_ALLOWED_ORIGINS: string[];
  SIGNALING_CREATE_RATE_LIMIT_MAX: number;
  SIGNALING_CREATE_RATE_LIMIT_WINDOW_MS: number;
  SIGNALING_ANSWER_RATE_LIMIT_MAX: number;
  SIGNALING_ANSWER_RATE_LIMIT_WINDOW_MS: number;
  SIGNALING_RECONNECT_RATE_LIMIT_MAX: number;
  SIGNALING_RECONNECT_RATE_LIMIT_WINDOW_MS: number;
}

const getPublicModeConfigurationErrors = (
  env: SignalingEnv,
  rawPort: string | number
): string[] => {
  const configurationErrors: string[] = [];

  if (env.STATE_BACKEND !== "redis") {
    configurationErrors.push("DEPLOYMENT_MODE=public requires STATE_BACKEND=redis.");
  }

  if (!env.REDIS_URL) {
    configurationErrors.push("DEPLOYMENT_MODE=public requires REDIS_URL to be set.");
  }

  if (env.SIGNALING_ALLOWED_ORIGINS.length === 0 || env.SIGNALING_ALLOWED_ORIGINS.includes("*")) {
    configurationErrors.push(
      "DEPLOYMENT_MODE=public requires SIGNALING_ALLOWED_ORIGINS to be set to an explicit allowlist."
    );
  }

  if (!env.TRUST_PROXY) {
    configurationErrors.push("DEPLOYMENT_MODE=public requires TRUST_PROXY=true.");
  }

  if (!isValidPositiveInteger(env.PORT)) {
    configurationErrors.push(
      `DEPLOYMENT_MODE=public requires PORT to be a positive integer. Received "${rawPort}".`
    );
  }

  return configurationErrors;
};

export const parseSignalingEnv = (environment: NodeJS.ProcessEnv = process.env): SignalingEnv => {
  const rawPort = environment.PORT ?? DEFAULT_SIGNALING_PORT;
  const positiveInteger = (name: string, fallback: number): number =>
    parsePositiveInteger(environment[name], fallback);
  const env: SignalingEnv = {
    DEPLOYMENT_MODE: parseDeploymentMode(environment.DEPLOYMENT_MODE),
    HOST: environment.HOST ?? "0.0.0.0",
    PORT: Number(rawPort),
    STATE_BACKEND: parseStateBackend(environment.STATE_BACKEND),
    REDIS_URL: environment.REDIS_URL,
    REDIS_KEY_PREFIX: environment.REDIS_KEY_PREFIX ?? "minesweeper-flags:signaling",
    P2P_SIGNALING_SESSION_TTL_SECONDS: positiveInteger(
      "P2P_SIGNALING_SESSION_TTL_SECONDS",
      15 * 60
    ),
    P2P_SIGNALING_MAX_PAYLOAD_BYTES: positiveInteger("P2P_SIGNALING_MAX_PAYLOAD_BYTES", 16 * 1024),
    TRUST_PROXY: parseBoolean(environment.TRUST_PROXY, false),
    SIGNALING_ALLOWED_ORIGINS: parseAllowedOrigins(environment.SIGNALING_ALLOWED_ORIGINS),
    SIGNALING_CREATE_RATE_LIMIT_MAX: positiveInteger("SIGNALING_CREATE_RATE_LIMIT_MAX", 6),
    SIGNALING_CREATE_RATE_LIMIT_WINDOW_MS: positiveInteger(
      "SIGNALING_CREATE_RATE_LIMIT_WINDOW_MS",
      60_000
    ),
    SIGNALING_ANSWER_RATE_LIMIT_MAX: positiveInteger("SIGNALING_ANSWER_RATE_LIMIT_MAX", 12),
    SIGNALING_ANSWER_RATE_LIMIT_WINDOW_MS: positiveInteger(
      "SIGNALING_ANSWER_RATE_LIMIT_WINDOW_MS",
      60_000
    ),
    // Despite the "RECONNECT" name this bucket is shared across every
    // post-create signaling operation: register/claim/heartbeat, offer and
    // answer reads/writes, finalization, and the GET reads on
    // /signaling/sessions/{id}. The high default (240/min) reflects the
    // polling cadence of those routes, not just reconnect heartbeats.
    SIGNALING_RECONNECT_RATE_LIMIT_MAX: positiveInteger("SIGNALING_RECONNECT_RATE_LIMIT_MAX", 240),
    SIGNALING_RECONNECT_RATE_LIMIT_WINDOW_MS: positiveInteger(
      "SIGNALING_RECONNECT_RATE_LIMIT_WINDOW_MS",
      60_000
    )
  };

  const configurationErrors: string[] = [];

  if (env.STATE_BACKEND === "redis" && !env.REDIS_URL) {
    configurationErrors.push("STATE_BACKEND=redis requires REDIS_URL to be set.");
  }

  if (env.DEPLOYMENT_MODE === "public") {
    configurationErrors.push(...getPublicModeConfigurationErrors(env, rawPort));
  }

  if (configurationErrors.length > 0) {
    throw new Error(configurationErrors.join(" "));
  }

  return env;
};

const signalingEnv = parseSignalingEnv(process.env);

export const DEPLOYMENT_MODE = signalingEnv.DEPLOYMENT_MODE;
export const HOST = signalingEnv.HOST;
export const PORT = signalingEnv.PORT;
export const STATE_BACKEND = signalingEnv.STATE_BACKEND;
export const REDIS_URL = signalingEnv.REDIS_URL;
export const REDIS_KEY_PREFIX = signalingEnv.REDIS_KEY_PREFIX;
export const P2P_SIGNALING_SESSION_TTL_SECONDS = signalingEnv.P2P_SIGNALING_SESSION_TTL_SECONDS;
export const P2P_SIGNALING_MAX_PAYLOAD_BYTES = signalingEnv.P2P_SIGNALING_MAX_PAYLOAD_BYTES;
export const TRUST_PROXY = signalingEnv.TRUST_PROXY;
export const SIGNALING_ALLOWED_ORIGINS = signalingEnv.SIGNALING_ALLOWED_ORIGINS;
export const SIGNALING_CREATE_RATE_LIMIT_MAX = signalingEnv.SIGNALING_CREATE_RATE_LIMIT_MAX;
export const SIGNALING_CREATE_RATE_LIMIT_WINDOW_MS =
  signalingEnv.SIGNALING_CREATE_RATE_LIMIT_WINDOW_MS;
export const SIGNALING_ANSWER_RATE_LIMIT_MAX = signalingEnv.SIGNALING_ANSWER_RATE_LIMIT_MAX;
export const SIGNALING_ANSWER_RATE_LIMIT_WINDOW_MS =
  signalingEnv.SIGNALING_ANSWER_RATE_LIMIT_WINDOW_MS;
export const SIGNALING_RECONNECT_RATE_LIMIT_MAX = signalingEnv.SIGNALING_RECONNECT_RATE_LIMIT_MAX;
export const SIGNALING_RECONNECT_RATE_LIMIT_WINDOW_MS =
  signalingEnv.SIGNALING_RECONNECT_RATE_LIMIT_WINDOW_MS;
