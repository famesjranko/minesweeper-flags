import type { IncomingMessage, ServerResponse } from "node:http";

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

const getRequestOrigin = (request: IncomingMessage): string | undefined => {
  const originHeader = request.headers.origin;
  return Array.isArray(originHeader) ? originHeader[0] : originHeader;
};

export const isAllowedHttpOrigin = (
  request: IncomingMessage,
  allowedOrigins: readonly string[]
): boolean => {
  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    return true;
  }

  const originValue = getRequestOrigin(request);

  if (!originValue) {
    return false;
  }

  const normalizedOrigin = normalizeOrigin(originValue);

  return Boolean(normalizedOrigin && allowedOrigins.includes(normalizedOrigin));
};

const getCorsHeaders = (
  request: IncomingMessage,
  allowedOrigins: readonly string[]
): Record<string, string> => {
  // Empty `allowedOrigins` is the dev/test fallback (e.g. local mode where no
  // SIGNALING_ALLOWED_ORIGINS is set). Public deploys are protected one layer up:
  // env.ts requires an explicit allowlist when DEPLOYMENT_MODE=public, so this
  // wildcard branch is unreachable in production.
  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    return {
      "access-control-allow-origin": "*"
    };
  }

  const originValue = getRequestOrigin(request);
  const normalizedOrigin = originValue ? normalizeOrigin(originValue) : null;

  if (!normalizedOrigin || !allowedOrigins.includes(normalizedOrigin)) {
    return {};
  }

  return {
    "access-control-allow-origin": normalizedOrigin,
    vary: "Origin"
  };
};

/** Writes responses that carry the CORS headers the request's origin is entitled to. */
export interface HttpResponder {
  json: (statusCode: number, payload: Record<string, unknown>) => void;
  empty: (statusCode: number) => void;
}

export const createHttpResponder = (
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[]
): HttpResponder => ({
  json: (statusCode, payload) => {
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...getCorsHeaders(request, allowedOrigins)
    });
    response.end(JSON.stringify(payload));
  },
  empty: (statusCode) => {
    response.writeHead(statusCode, {
      ...getCorsHeaders(request, allowedOrigins),
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store"
    });
    response.end();
  }
});
