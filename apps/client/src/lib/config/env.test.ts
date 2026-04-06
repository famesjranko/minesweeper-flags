import { describe, expect, it } from "vitest";
import {
  isLocalHostname,
  resolveDeploymentMode,
  resolveP2PSignalingUrl,
  resolveP2PStunUrls,
  resolveServerUrl
} from "./env.js";

const remoteLocation = {
  host: "play.example.com",
  hostname: "play.example.com",
  protocol: "https:"
};

describe("client socket env", () => {
  it("defaults the deployment mode to server", () => {
    expect(resolveDeploymentMode()).toBe("server");
  });

  it("accepts p2p as a deployment mode", () => {
    expect(resolveDeploymentMode({ explicitMode: "p2p" })).toBe("p2p");
  });

  it("rejects unsupported deployment modes", () => {
    expect(() => resolveDeploymentMode({ explicitMode: "hybrid" })).toThrow(
      'VITE_DEPLOYMENT_MODE must be "server" or "p2p".'
    );
  });

  it("parses comma-separated STUN URLs", () => {
    expect(
      resolveP2PStunUrls({
        explicitUrls: "stun:stun1.example.com:3478, stun:stun2.example.com:3478 , ,"
      })
    ).toEqual(["stun:stun1.example.com:3478", "stun:stun2.example.com:3478"]);
  });

  it("allows an empty STUN URL list", () => {
    expect(resolveP2PStunUrls({ explicitUrls: undefined })).toEqual([]);
  });

  it("requires a signaling URL for p2p builds", () => {
    expect(() => resolveP2PSignalingUrl({ deploymentMode: "p2p" })).toThrow(
      "VITE_P2P_SIGNALING_URL is required when VITE_DEPLOYMENT_MODE=p2p."
    );
  });

  it("accepts a signaling URL for p2p builds", () => {
    expect(
      resolveP2PSignalingUrl({
        explicitUrl: "https://signal.example.com",
        deploymentMode: "p2p"
      })
    ).toBe("https://signal.example.com");
  });

  it("does not require a signaling URL for server builds", () => {
    expect(resolveP2PSignalingUrl({ deploymentMode: "server" })).toBeUndefined();
  });

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
