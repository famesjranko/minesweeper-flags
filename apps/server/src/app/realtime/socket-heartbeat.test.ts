import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { SocketHeartbeatMonitor } from "./socket-heartbeat.js";

type HeartbeatEventName = "pong";

interface MockHeartbeatSocket {
  ping: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  on: (event: HeartbeatEventName, listener: () => void) => void;
  readyState: number;
}

const createSocket = () => {
  const listeners = new Map<HeartbeatEventName, () => void>();
  const socket: MockHeartbeatSocket = {
    ping: vi.fn(),
    terminate: vi.fn(),
    on: (event, listener) => {
      listeners.set(event, listener);
    },
    readyState: WebSocket.OPEN
  };

  return {
    socket: socket as unknown as WebSocket,
    emit: (event: HeartbeatEventName) => listeners.get(event)?.(),
    ping: socket.ping,
    terminate: socket.terminate
  };
};

describe("socket heartbeat monitor", () => {
  it("pings healthy sockets and resets when pong is received", () => {
    const staleSocketSpy = vi.fn();
    const heartbeatMonitor = new SocketHeartbeatMonitor({
      intervalMs: 1_000,
      onStaleSocket: staleSocketSpy
    });
    const socket = createSocket();

    heartbeatMonitor.attach(socket.socket);
    heartbeatMonitor.sweep([socket.socket]);
    socket.emit("pong");
    heartbeatMonitor.sweep([socket.socket]);

    expect(socket.ping).toHaveBeenCalledTimes(2);
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(staleSocketSpy).not.toHaveBeenCalled();
  });

  it("terminates sockets that miss a heartbeat window", () => {
    const staleSocketSpy = vi.fn();
    const heartbeatMonitor = new SocketHeartbeatMonitor({
      intervalMs: 1_000,
      onStaleSocket: staleSocketSpy
    });
    const socket = createSocket();

    heartbeatMonitor.attach(socket.socket);
    heartbeatMonitor.sweep([socket.socket]);
    heartbeatMonitor.sweep([socket.socket]);

    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(staleSocketSpy).toHaveBeenCalledWith(socket.socket);
  });
});
