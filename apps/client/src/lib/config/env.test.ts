import { describe, expect, it } from "vitest";
import { isLocalHostname, resolveServerUrl } from "./env.js";

const remoteLocation = {
  host: "play.example.com",
  hostname: "play.example.com",
  protocol: "https:"
};

describe("client socket env", () => {
  it("prefers the explicit socket URL when provided", () => {
    expect(
      resolveServerUrl({
        explicitUrl: "wss://api.example.com/ws",
        isDev: false,
        location: remoteLocation
      })
    ).toBe("wss://api.example.com/ws");
  });

  it("allows same-origin fallback in development", () => {
    expect(
      resolveServerUrl({
        isDev: true,
        location: remoteLocation,
        socketPath: "/ws"
      })
    ).toBe("wss://play.example.com/ws");
  });

  it("allows same-origin fallback on localhost in non-dev builds", () => {
    expect(
      resolveServerUrl({
        isDev: false,
        location: {
          host: "localhost:8080",
          hostname: "localhost",
          protocol: "http:"
        },
        socketPath: "/ws"
      })
    ).toBe("ws://localhost:8080/ws");
  });

  it("uses the local backend default when no browser location exists", () => {
    expect(
      resolveServerUrl({
        explicitUrl: undefined,
        isDev: false,
        location: undefined,
        socketPath: "/ws"
      })
    ).toBe("ws://localhost:3001/ws");
  });

  it("rejects non-local production deployments without an explicit socket URL", () => {
    expect(() =>
      resolveServerUrl({
        isDev: false,
        location: remoteLocation,
        socketPath: "/ws"
      })
    ).toThrow("VITE_SOCKET_URL is required for non-local frontend deployments.");
  });

  it("detects loopback hostnames as local", () => {
    expect(isLocalHostname("127.0.0.1")).toBe(true);
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("play.example.com")).toBe(false);
  });
});
