import {
  CLIENT_EVENT_NAMES,
  clientEventSchema,
  type ClientEvent,
  type ServerEvent
} from "@minesweeper-flags/shared";
import type {
  GameClientTransport,
  GameClientTransportListener,
  GameClientTransportStatusChange
} from "../../app/providers/game-client.transport.js";
import type { ConnectionStatus } from "../../app/providers/game-client.store.js";
import { emitP2PHostFanout } from "../host/p2p-host-events.js";
import { P2PHostOrchestrator } from "../host/p2p-host-orchestrator.js";
import {
  encodeP2PRecoveryControlMessage,
  type P2PRecoveryControlMessage
} from "../recovery/p2p-recovery-control.js";
import type { P2PHostAuthoritySnapshot } from "../host/p2p-host-state.js";
import type { WebRTCPeerController } from "../transport/webrtc-peer.types.js";

const createBindingId = (): string =>
  globalThis.crypto?.randomUUID() ?? `p2p-binding-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const parseClientEvent = (message: string): ClientEvent | null => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(message) as unknown;
  } catch {
    return null;
  }

  const result = clientEventSchema.safeParse(parsed);

  if (!result.success) {
    return null;
  }

  return result.data;
};

export class P2PHostGameClientTransport implements GameClientTransport {
  private readonly listeners = new Set<GameClientTransportListener>();
  private unsubscribePeer: (() => void) | null = null;
  private status: ConnectionStatus = "disconnected";
  private guestBindingId: string | null = null;
  private peer: WebRTCPeerController;

  constructor(
    private readonly orchestrator: P2PHostOrchestrator,
    peer: WebRTCPeerController
  ) {
    this.peer = peer;
    this.bindPeer(peer);
  }

  connect = (): void => {
    this.emitStatus({ status: "connected" });
  };

  disconnect = (): void => {
    this.unsubscribePeer?.();
    this.unsubscribePeer = null;
    this.peer.disconnect();
    this.guestBindingId = null;
    this.orchestrator.rebindGuest(null);
    this.emitStatus({ status: "disconnected" });
  };

  send = (event: ClientEvent): void => {
    switch (event.type) {
      case CLIENT_EVENT_NAMES.roomCreate:
        this.emitSteps(this.orchestrator.createRoom(event.payload.displayName).steps);
        return;
      case CLIENT_EVENT_NAMES.chatSend:
        this.emitSteps(this.orchestrator.sendHostChat(event.payload.text).steps);
        return;
      case CLIENT_EVENT_NAMES.matchAction:
        this.emitSteps(this.orchestrator.applyHostAction(event.payload.action).steps);
        return;
      case CLIENT_EVENT_NAMES.matchResign:
        this.emitSteps(this.orchestrator.resignHost().steps);
        return;
      case CLIENT_EVENT_NAMES.matchRematchRequest:
        this.emitSteps(this.orchestrator.requestHostRematch().steps);
        return;
      case CLIENT_EVENT_NAMES.matchRematchCancel:
        this.emitSteps(this.orchestrator.cancelHostRematch().steps);
        return;
      case CLIENT_EVENT_NAMES.roomJoin:
      case CLIENT_EVENT_NAMES.playerReconnect:
        return;
    }
  };

  subscribe = (listener: GameClientTransportListener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  getStatus = (): ConnectionStatus => this.status;

  acceptGuest = (displayName: string): void => {
    if (this.orchestrator.getState().guestSession) {
      return;
    }

    this.guestBindingId = createBindingId();
    this.emitSteps(
      this.orchestrator.acceptGuest({
        displayName,
        bindingId: this.guestBindingId
      }).steps
    );
  };

  replacePeer = (peer: WebRTCPeerController): void => {
    const previousPeer = this.peer;

    this.unsubscribePeer?.();
    this.unsubscribePeer = null;
    this.peer = peer;
    this.guestBindingId = null;
    this.orchestrator.rebindGuest(null);

    if (previousPeer !== peer) {
      previousPeer.disconnect();
    }

    this.bindPeer(peer);
  };

  rebindGuestPeer = (): string | null => {
    if (!this.orchestrator.getState().guestSession) {
      return null;
    }

    this.guestBindingId = createBindingId();
    this.orchestrator.rebindGuest(this.guestBindingId);
    return this.guestBindingId;
  };

  sendRecoveryControlMessage = (message: P2PRecoveryControlMessage): void => {
    this.peer.send(encodeP2PRecoveryControlMessage(message));
  };

  hasGuestSession = (): boolean => this.orchestrator.getState().guestSession !== null;

  getAuthoritySnapshot = (): P2PHostAuthoritySnapshot => this.orchestrator.getState();

  private handlePeerMessage = (message: string): void => {
    const event = parseClientEvent(message);

    if (!event) {
      return;
    }

    this.emitSteps(
      this.orchestrator.applyRemoteGuestCommand({
        bindingId: this.guestBindingId,
        event
      }).steps
    );
  };

  private emitSteps(steps: Parameters<typeof emitP2PHostFanout>[0]): void {
    emitP2PHostFanout(steps, {
      deliverToHostLocal: this.emitServerEvent,
      deliverToGuest: (event) => {
        this.peer.send(JSON.stringify(event));
      }
    });
  }

  private bindPeer(peer: WebRTCPeerController): void {
    this.unsubscribePeer = peer.subscribe({
      onMessage: this.handlePeerMessage,
      onStatusChange: ({ status }) => {
        if (status === "connected") {
          this.emitStatus({ status: "connected" });
          return;
        }

        if (status === "failed" || status === "closed") {
          this.emitStatus({ status: "disconnected" });
        }
      }
    });
  }

  private emitServerEvent = (event: ServerEvent): void => {
    for (const listener of this.listeners) {
      listener.onServerEvent?.(event);
    }
  };

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
