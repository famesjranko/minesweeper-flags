import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { resolveClientAddress } from "./client-address.js";

const createRequest = ({
  headers = {},
  remoteAddress = "10.0.0.5"
}: {
  headers?: IncomingMessage["headers"];
  remoteAddress?: string;
}) =>
  ({
    headers,
    socket: {
      remoteAddress
    }
  }) as IncomingMessage;

describe("client address resolution", () => {
  it("uses the socket address when proxy headers are not trusted", () => {
    expect(
      resolveClientAddress(
        createRequest({
          headers: {
            "x-forwarded-for": "198.51.100.10, 10.0.0.5"
          }
        }),
        { trustProxy: false }
      )
    ).toBe("10.0.0.5");
  });

  it("uses the proxy-appended client address when proxy headers are trusted", () => {
    expect(
      resolveClientAddress(
        createRequest({
          headers: {
            "x-forwarded-for": "198.51.100.10, 203.0.113.20"
          }
        }),
        { trustProxy: true }
      )
    ).toBe("203.0.113.20");
  });

  it("uses the last forwarded address across repeated headers when proxy headers are trusted", () => {
    expect(
      resolveClientAddress(
        createRequest({
          headers: {
            "x-forwarded-for": ["198.51.100.10", "203.0.113.20"]
          }
        }),
        { trustProxy: true }
      )
    ).toBe("203.0.113.20");
  });

  it("falls back to unknown when no address is available", () => {
    expect(
      resolveClientAddress(createRequest({ remoteAddress: "" }), { trustProxy: true })
    ).toBe("unknown");
  });
});
