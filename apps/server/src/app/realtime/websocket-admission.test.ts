import type { IncomingMessage } from "node:http";
import type { RawData } from "ws";
import { describe, expect, it } from "vitest";
import {
  getRawMessageByteLength,
  isAllowedWebSocketOrigin,
  parseAllowedOrigins
} from "./websocket-admission.js";

const createRequest = (origin?: string) =>
  ({
    headers: origin ? { origin } : {}
  }) as IncomingMessage;

describe("websocket admission", () => {
  it("parses and normalizes configured origins", () => {
    expect(
      parseAllowedOrigins(" https://app.example.com , https://www.example.com:8443 ")
    ).toEqual([
      "https://app.example.com",
      "https://www.example.com:8443"
    ]);
  });

  it("allows all origins when the allowlist is empty or wildcarded", () => {
    expect(isAllowedWebSocketOrigin(createRequest("https://evil.example.com"), [])).toBe(true);
    expect(isAllowedWebSocketOrigin(createRequest("https://evil.example.com"), ["*"])).toBe(true);
  });

  it("rejects missing or mismatched origins when an allowlist is configured", () => {
    expect(
      isAllowedWebSocketOrigin(createRequest(), ["https://app.example.com"])
    ).toBe(false);
    expect(
      isAllowedWebSocketOrigin(createRequest("https://evil.example.com"), [
        "https://app.example.com"
      ])
    ).toBe(false);
    expect(
      isAllowedWebSocketOrigin(createRequest("https://app.example.com"), [
        "https://app.example.com"
      ])
    ).toBe(true);
  });

  it("measures raw websocket payload sizes consistently", () => {
    expect(getRawMessageByteLength("hello" as unknown as RawData)).toBe(5);
    expect(getRawMessageByteLength(Buffer.from("hello"))).toBe(5);
    expect(getRawMessageByteLength([Buffer.from("he"), Buffer.from("llo")])).toBe(5);
  });
});
