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

  // Take the rightmost entry. This assumes the CLAUDE.md "single trusted
  // ingress" model: exactly one proxy in front of us appends the real client
  // IP to X-Forwarded-For, so the rightmost value is the client. Multi-hop
  // proxy chains are explicitly unsupported — do not change this to `[0]`.
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
