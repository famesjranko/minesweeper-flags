import type { IncomingMessage } from "node:http";

interface ResolveClientAddressOptions {
  trustProxy: boolean;
}

const readForwardedForHeader = (request: IncomingMessage): string | undefined => {
  const forwardedForHeader = request.headers["x-forwarded-for"];
  const forwardedForValue = Array.isArray(forwardedForHeader)
    ? forwardedForHeader[0]
    : forwardedForHeader;

  if (!forwardedForValue) {
    return undefined;
  }

  const firstForwardedAddress = forwardedForValue.split(",")[0]?.trim();

  return firstForwardedAddress || undefined;
};

export const resolveClientAddress = (
  request: IncomingMessage,
  { trustProxy }: ResolveClientAddressOptions
): string => {
  if (trustProxy) {
    const forwardedAddress = readForwardedForHeader(request);

    if (forwardedAddress) {
      return forwardedAddress;
    }
  }

  return request.socket.remoteAddress?.trim() || "unknown";
};
