import type { IncomingMessage } from "node:http";
import type { RawData } from "ws";

export const getRawMessageByteLength = (message: RawData): number => {
  if (typeof message === "string") {
    return Buffer.byteLength(message);
  }

  if (Array.isArray(message)) {
    return message.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  return message.byteLength;
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
      throw new Error(`Invalid WEBSOCKET_ALLOWED_ORIGINS entry "${origin}".`);
    }

    return normalizedOrigin;
  });
};

export const isAllowedWebSocketOrigin = (
  request: IncomingMessage,
  allowedOrigins: readonly string[]
): boolean => {
  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    return true;
  }

  const originHeader = request.headers.origin;
  const originValue = Array.isArray(originHeader) ? originHeader[0] : originHeader;

  if (!originValue) {
    return false;
  }

  const normalizedOrigin = normalizeOrigin(originValue);

  return Boolean(normalizedOrigin && allowedOrigins.includes(normalizedOrigin));
};
