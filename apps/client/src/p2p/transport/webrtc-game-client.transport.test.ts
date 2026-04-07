import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  type ClientEvent,
  type ServerEvent
} from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import type {
  GameClientTransportStatusChange
} from "../../app/providers/game-client.transport.js";
import { WebRTCGameClientTransport } from "./webrtc-game-client.transport.js";
import type {
  WebRTCPeerListener,
  WebRTCPeerStatus,
  WebRTCPeerTransportSource
} from "./webrtc-peer.types.js";

class FakeWebRTCPeer implements WebRTCPeerTransportSource {
  readonly sentMessages: string[] = [];
  disconnectCalls = 0;

  private status: WebRTCPeerStatus = "idle";
  private readonly listeners = new Set<WebRTCPeerListener>();

  disconnect = (): void => {
    this.disconnectCalls += 1;
    this.emitStatus("closed");
  };

  getStatus = (): WebRTCPeerStatus => this.status;

  send = (message: string): void => {
    this.sentMessages.push(message);
  };

  subscribe = (listener: WebRTCPeerListener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  emitStatus(status: WebRTCPeerStatus): void {
    this.status = status;

    for (const listener of this.listeners) {
      listener.onStatusChange?.({ status });
    }
  }

  emitMessage(message: string): void {
    for (const listener of this.listeners) {
      listener.onMessage?.(message);
    }
  }
}

describe("WebRTCGameClientTransport", () => {
  it("maps peer status changes to the existing transport status contract", () => {
    const peer = new FakeWebRTCPeer();
    const transport = new WebRTCGameClientTransport(peer);
    const statuses: GameClientTransportStatusChange[] = [];

    transport.subscribe({
      onStatusChange: (change) => {
        statuses.push(change);
      }
    });

    transport.connect();
    peer.emitStatus("creating-offer");
    peer.emitStatus("connected");
    peer.emitStatus("failed");

    expect(statuses).toEqual([
      { status: "connecting" },
      { status: "connected" },
      { status: "disconnected" }
    ]);
    expect(transport.getStatus()).toBe("disconnected");
  });

  it("serializes client events and decodes server events from peer messages", () => {
    const peer = new FakeWebRTCPeer();
    const transport = new WebRTCGameClientTransport(peer);
    const receivedEvents: ServerEvent[] = [];
    const clientEvent: ClientEvent = {
      type: CLIENT_EVENT_NAMES.chatSend,
      payload: {
        roomCode: "ABCDE",
        sessionToken: "session-1",
        text: "hello"
      }
    };

    transport.subscribe({
      onServerEvent: (event) => {
        if (event) {
          receivedEvents.push(event);
        }
      }
    });

    transport.send(clientEvent);
    peer.emitMessage(
      JSON.stringify({
        type: SERVER_EVENT_NAMES.roomState,
        payload: {
          roomId: "room-1",
          roomCode: "ABCDE",
          players: [{ playerId: "player-1", displayName: "Host" }]
        }
      })
    );
    peer.emitMessage("not-json");

    expect(peer.sentMessages).toEqual([JSON.stringify(clientEvent)]);
    expect(receivedEvents).toEqual([
      {
        type: SERVER_EVENT_NAMES.roomState,
        payload: {
          roomId: "room-1",
          roomCode: "ABCDE",
          players: [{ playerId: "player-1", displayName: "Host" }]
        }
      }
    ]);
  });

  it("lets the runtime intercept non-server control frames", () => {
    const peer = new FakeWebRTCPeer();
    const interceptMessage = (message: string): boolean => message.includes("p2p:recovery");
    const transport = new WebRTCGameClientTransport(peer, { interceptMessage });
    const receivedEvents: ServerEvent[] = [];

    transport.subscribe({
      onServerEvent: (event) => {
        if (event) {
          receivedEvents.push(event);
        }
      }
    });

    peer.emitMessage(JSON.stringify({ type: "p2p:recovery", payload: { controlSessionId: "a", guestSecret: "b" } }));

    expect(receivedEvents).toEqual([]);
  });

  it("disconnects through the peer boundary", () => {
    const peer = new FakeWebRTCPeer();
    const transport = new WebRTCGameClientTransport(peer);
    const statuses: GameClientTransportStatusChange[] = [];

    transport.subscribe({
      onStatusChange: (change) => {
        statuses.push(change);
      }
    });

    peer.emitStatus("connected");

    transport.disconnect();

    expect(peer.disconnectCalls).toBe(1);
    expect(statuses).toEqual([
      { status: "connected" },
      { status: "disconnected" }
    ]);
  });
});
