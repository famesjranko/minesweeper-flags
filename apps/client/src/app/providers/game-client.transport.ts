import type { ClientEvent, ServerEvent } from "@minesweeper-flags/shared";
import { decodeServerEvent } from "./game-client.protocol.js";
import type { ConnectionStatus } from "./game-client.store.js";

export interface GameClientTransportStatusChange {
  status: ConnectionStatus;
  closeCode?: number;
}

export interface GameClientTransportListener {
  onServerEvent?: (event: ServerEvent | null) => void;
  onStatusChange?: (change: GameClientTransportStatusChange) => void;
}

export interface GameClientTransport {
  connect: () => void;
  disconnect: () => void;
  send: (event: ClientEvent) => void;
  subscribe: (listener: GameClientTransportListener) => () => void;
  getStatus: () => ConnectionStatus;
}

export class WebSocketGameClientTransport implements GameClientTransport {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private readonly listeners = new Set<GameClientTransportListener>();

  constructor(private readonly serverUrl: string) {}

  connect = (): void => {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const nextSocket = new WebSocket(this.serverUrl);
    this.socket = nextSocket;
    this.emitStatus({ status: "connecting" });

    nextSocket.addEventListener("open", () => {
      if (this.socket !== nextSocket) {
        nextSocket.close();
        return;
      }

      this.emitStatus({ status: "connected" });
    });

    nextSocket.addEventListener("message", (message) => {
      if (this.socket !== nextSocket) {
        return;
      }

      this.emitServerEvent(decodeServerEvent(message.data));
    });

    nextSocket.addEventListener("close", (event) => {
      if (this.socket !== nextSocket) {
        return;
      }

      this.socket = null;
      this.emitStatus({
        status: "disconnected",
        closeCode: event.code
      });
    });
  };

  disconnect = (): void => {
    const activeSocket = this.socket;

    this.socket = null;

    if (
      activeSocket &&
      (activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING)
    ) {
      activeSocket.close();
    }

    this.emitStatus({ status: "disconnected" });
  };

  send = (event: ClientEvent): void => {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Transport is not connected.");
    }

    this.socket.send(JSON.stringify(event));
  };

  subscribe = (listener: GameClientTransportListener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  getStatus = (): ConnectionStatus => this.status;

  private emitServerEvent(event: ServerEvent | null): void {
    for (const listener of this.listeners) {
      listener.onServerEvent?.(event);
    }
  }

  private emitStatus(change: GameClientTransportStatusChange): void {
    if (this.status === change.status && change.closeCode === undefined) {
      return;
    }

    this.status = change.status;

    for (const listener of this.listeners) {
      listener.onStatusChange?.(change);
    }
  }
}
