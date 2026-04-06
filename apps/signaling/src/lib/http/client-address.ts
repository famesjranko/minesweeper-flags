import type { IncomingMessage } from "node:http";

interface ResolveClientAddressOptions {
  trustProxy: boolean;
}

const readForwardedForHeader = (request: IncomingMessage): string | undefined => {
  const forwardedForHeader = request.headers["x-forwarded-for"];
  const forwardedForValues = Array.isArray(forwardedForHeader)
    ? forwardedForHeader
    : [forwardedForHeader];

  const forwardedAddresses = forwardedForValues
    .flatMap((forwardedForValue) => forwardedForValue?.split(",") ?? [])
    .map((forwardedAddress) => forwardedAddress.trim())
    .filter(Boolean);

  return forwardedAddresses.at(-1);
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
