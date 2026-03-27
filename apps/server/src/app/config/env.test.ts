import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env.js";

describe("server env parsing", () => {
  it("defaults to local mode with the existing permissive settings", () => {
    expect(parseServerEnv({})).toMatchObject({
      DEPLOYMENT_MODE: "local",
      SERVER_PORT: 3001,
      STATE_BACKEND: "memory",
      TRUST_PROXY: false,
      WEBSOCKET_ALLOWED_ORIGINS: []
    });
  });

  it("accepts a strict public configuration", () => {
    expect(
      parseServerEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3001",
        STATE_BACKEND: "redis",
        TRUST_PROXY: "true",
        WEBSOCKET_ALLOWED_ORIGINS: "https://app.example.com"
      })
    ).toMatchObject({
      DEPLOYMENT_MODE: "public",
      SERVER_PORT: 3001,
      STATE_BACKEND: "redis",
      TRUST_PROXY: true,
      WEBSOCKET_ALLOWED_ORIGINS: ["https://app.example.com"]
    });
  });

  it("rejects public mode without redis", () => {
    expect(() =>
      parseServerEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3001",
        TRUST_PROXY: "true",
        WEBSOCKET_ALLOWED_ORIGINS: "https://app.example.com"
      })
    ).toThrow("DEPLOYMENT_MODE=public requires STATE_BACKEND=redis.");
  });

  it("rejects public mode without an explicit origin allowlist", () => {
    expect(() =>
      parseServerEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3001",
        STATE_BACKEND: "redis",
        TRUST_PROXY: "true"
      })
    ).toThrow(
      "DEPLOYMENT_MODE=public requires WEBSOCKET_ALLOWED_ORIGINS to be set to an explicit allowlist."
    );
  });

  it("rejects wildcard origins in public mode", () => {
    expect(() =>
      parseServerEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3001",
        STATE_BACKEND: "redis",
        TRUST_PROXY: "true",
        WEBSOCKET_ALLOWED_ORIGINS: "*"
      })
    ).toThrow(
      "DEPLOYMENT_MODE=public requires WEBSOCKET_ALLOWED_ORIGINS to be set to an explicit allowlist."
    );
  });

  it("rejects public mode without trusted proxy mode", () => {
    expect(() =>
      parseServerEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3001",
        STATE_BACKEND: "redis",
        WEBSOCKET_ALLOWED_ORIGINS: "https://app.example.com"
      })
    ).toThrow("DEPLOYMENT_MODE=public requires TRUST_PROXY=true.");
  });

  it("rejects invalid public ports", () => {
    expect(() =>
      parseServerEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "abc",
        STATE_BACKEND: "redis",
        TRUST_PROXY: "true",
        WEBSOCKET_ALLOWED_ORIGINS: "https://app.example.com"
      })
    ).toThrow("DEPLOYMENT_MODE=public requires PORT to be a positive integer.");
  });
});
