import type { ClientEvent } from "@minesweeper-flags/shared";
import { decodeServerEvent } from "../../app/providers/game-client.protocol.js";
import type {
  GameClientTransport,
  GameClientTransportListener,
  GameClientTransportStatusChange
} from "../../app/providers/game-client.transport.js";
import type { ConnectionStatus } from "../../app/providers/game-client.store.js";
import type {
  WebRTCPeerStatus,
  WebRTCPeerStatusChange,
  WebRTCPeerTransportSource
} from "./webrtc-peer.types.js";

const mapWebRTCPeerStatusToConnectionStatus = (status: WebRTCPeerStatus): ConnectionStatus => {
  switch (status) {
    case "creating-offer":
    case "waiting-for-answer":
    case "creating-answer":
    case "waiting-for-host-finalize":
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    default:
      return "disconnected";
  }
};

export class WebRTCGameClientTransport implements GameClientTransport {
  private readonly listeners = new Set<GameClientTransportListener>();
  private status: ConnectionStatus;

  constructor(
    private readonly peer: WebRTCPeerTransportSource,
    private readonly options: {
      interceptMessage?: (message: string) => boolean;
    } = {}
  ) {
    this.status = mapWebRTCPeerStatusToConnectionStatus(peer.getStatus());

    peer.subscribe({
      onMessage: (message) => {
        if (this.options.interceptMessage?.(message)) {
          return;
        }

        const event = decodeServerEvent(message);

        if (!event) {
          return;
        }

        this.emitServerEvent(event);
      },
      onStatusChange: (change) => {
        this.emitStatus({
          status: mapWebRTCPeerStatusToConnectionStatus(change.status)
        });
      }
    });
  }

  connect = (): void => {
    this.emitStatus({
      status: mapWebRTCPeerStatusToConnectionStatus(this.peer.getStatus())
    });
  };

  disconnect = (): void => {
    this.peer.disconnect();
    this.emitStatus({ status: "disconnected" });
  };

  send = (event: ClientEvent): void => {
    this.peer.send(JSON.stringify(event));
  };

  subscribe = (listener: GameClientTransportListener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  getStatus = (): ConnectionStatus => this.status;

  private emitServerEvent(message: ReturnType<typeof decodeServerEvent>): void {
    for (const listener of this.listeners) {
      listener.onServerEvent?.(message);
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
