import { WebSocket, type WebSocketServer } from "ws";

interface SocketHeartbeatMonitorOptions {
  intervalMs: number;
  onStaleSocket?: (socket: WebSocket) => void;
}

export class SocketHeartbeatMonitor {
  private readonly awaitingPongBySocket = new WeakMap<WebSocket, boolean>();

  constructor(private readonly options: SocketHeartbeatMonitorOptions) {}

  attach(socket: WebSocket): void {
    this.awaitingPongBySocket.set(socket, false);
    socket.on("pong", () => {
      this.awaitingPongBySocket.set(socket, false);
    });
  }

  sweep(sockets: Iterable<WebSocket>): void {
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      if (this.awaitingPongBySocket.get(socket)) {
        this.options.onStaleSocket?.(socket);
        socket.terminate();
        continue;
      }

      this.awaitingPongBySocket.set(socket, true);
      socket.ping();
    }
  }

  start(webSocketServer: Pick<WebSocketServer, "clients">): () => void {
    const interval = setInterval(() => {
      this.sweep(webSocketServer.clients);
    }, this.options.intervalMs);

    interval.unref?.();

    return () => clearInterval(interval);
  }
}
