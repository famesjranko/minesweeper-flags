import { describe, expect, it } from "vitest";
import { parseSignalingEnv } from "./env.js";

describe("signaling env parsing", () => {
  it("defaults to local mode with the in-memory backend", () => {
    expect(parseSignalingEnv({})).toMatchObject({
      DEPLOYMENT_MODE: "local",
      HOST: "0.0.0.0",
      PORT: 3002,
      STATE_BACKEND: "memory",
      TRUST_PROXY: false,
      SIGNALING_ALLOWED_ORIGINS: []
    });
  });

  it("accepts a strict public configuration", () => {
    expect(
      parseSignalingEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3002",
        STATE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        TRUST_PROXY: "true",
        SIGNALING_ALLOWED_ORIGINS: "https://app.example.com"
      })
    ).toMatchObject({
      DEPLOYMENT_MODE: "public",
      PORT: 3002,
      STATE_BACKEND: "redis",
      REDIS_URL: "redis://localhost:6379",
      TRUST_PROXY: true,
      SIGNALING_ALLOWED_ORIGINS: ["https://app.example.com"]
    });
  });

  it("rejects redis without a URL", () => {
    expect(() =>
      parseSignalingEnv({
        STATE_BACKEND: "redis"
      })
    ).toThrow("STATE_BACKEND=redis requires REDIS_URL to be set.");
  });

  it("rejects public mode without redis", () => {
    expect(() =>
      parseSignalingEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3002",
        TRUST_PROXY: "true",
        SIGNALING_ALLOWED_ORIGINS: "https://app.example.com"
      })
    ).toThrow("DEPLOYMENT_MODE=public requires STATE_BACKEND=redis.");
  });

  it("rejects public mode without redis url", () => {
    expect(() =>
      parseSignalingEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3002",
        STATE_BACKEND: "redis",
        TRUST_PROXY: "true",
        SIGNALING_ALLOWED_ORIGINS: "https://app.example.com"
      })
    ).toThrow("DEPLOYMENT_MODE=public requires REDIS_URL to be set.");
  });

  it("rejects public mode without an explicit origin allowlist", () => {
    expect(() =>
      parseSignalingEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3002",
        STATE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        TRUST_PROXY: "true"
      })
    ).toThrow(
      "DEPLOYMENT_MODE=public requires SIGNALING_ALLOWED_ORIGINS to be set to an explicit allowlist."
    );
  });

  it("rejects wildcard origins in public mode", () => {
    expect(() =>
      parseSignalingEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3002",
        STATE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        TRUST_PROXY: "true",
        SIGNALING_ALLOWED_ORIGINS: "*"
      })
    ).toThrow(
      "DEPLOYMENT_MODE=public requires SIGNALING_ALLOWED_ORIGINS to be set to an explicit allowlist."
    );
  });

  it("rejects public mode without trusted proxy mode", () => {
    expect(() =>
      parseSignalingEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "3002",
        STATE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        SIGNALING_ALLOWED_ORIGINS: "https://app.example.com"
      })
    ).toThrow("DEPLOYMENT_MODE=public requires TRUST_PROXY=true.");
  });

  it("rejects invalid public ports", () => {
    expect(() =>
      parseSignalingEnv({
        DEPLOYMENT_MODE: "public",
        PORT: "abc",
        STATE_BACKEND: "redis",
        REDIS_URL: "redis://localhost:6379",
        TRUST_PROXY: "true",
        SIGNALING_ALLOWED_ORIGINS: "https://app.example.com"
      })
    ).toThrow("DEPLOYMENT_MODE=public requires PORT to be a positive integer.");
  });
});
