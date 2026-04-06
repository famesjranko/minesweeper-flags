import { P2P_SIGNALING_PROTOCOL_VERSION, type HostOfferPayload } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { WebRTCPeer } from "./webrtc-peer.js";
import type { WebRTCPeerStatusChange } from "./webrtc-peer.types.js";

type ListenerMap = Map<string, Set<(event?: any) => void>>;

const addListener = (listeners: ListenerMap, type: string, listener: (event?: any) => void): void => {
  const bucket = listeners.get(type) ?? new Set<(event?: any) => void>();
  bucket.add(listener);
  listeners.set(type, bucket);
};

const removeListener = (listeners: ListenerMap, type: string, listener: (event?: any) => void): void => {
  listeners.get(type)?.delete(listener);
};

const emitEvent = (listeners: ListenerMap, type: string, event?: any): void => {
  for (const listener of listeners.get(type) ?? []) {
    listener(event);
  }
};

class FakeRTCDataChannel {
  readonly sentMessages: string[] = [];
  readyState: RTCDataChannelState = "connecting";
  private readonly listeners: ListenerMap = new Map();

  constructor(readonly label: string) {}

  addEventListener(type: string, listener: (event?: any) => void): void {
    addListener(this.listeners, type, listener);
  }

  removeEventListener(type: string, listener: (event?: any) => void): void {
    removeListener(this.listeners, type, listener);
  }

  send(message: string): void {
    this.sentMessages.push(message);
  }

  close(): void {
    this.readyState = "closed";
    emitEvent(this.listeners, "close");
  }

  open(): void {
    this.readyState = "open";
    emitEvent(this.listeners, "open");
  }

  emitMessage(data: unknown): void {
    emitEvent(this.listeners, "message", { data });
  }
}

class FakeRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  readonly createdDataChannels: FakeRTCDataChannel[] = [];
  readonly createOfferResult: RTCSessionDescriptionInit = { type: "offer", sdp: "host-offer-sdp" };
  readonly createAnswerResult: RTCSessionDescriptionInit = { type: "answer", sdp: "guest-answer-sdp" };
  private readonly listeners: ListenerMap = new Map();

  addEventListener(type: string, listener: (event?: any) => void): void {
    addListener(this.listeners, type, listener);
  }

  removeEventListener(type: string, listener: (event?: any) => void): void {
    removeListener(this.listeners, type, listener);
  }

  createDataChannel(label: string): RTCDataChannel {
    const channel = new FakeRTCDataChannel(label);
    this.createdDataChannels.push(channel);
    return channel as unknown as RTCDataChannel;
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve(this.createOfferResult);
  }

  createAnswer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve(this.createAnswerResult);
  }

  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
    return Promise.resolve();
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    return Promise.resolve();
  }

  close(): void {
    this.connectionState = "closed";
    emitEvent(this.listeners, "connectionstatechange");
  }

  completeIceGathering(): void {
    this.iceGatheringState = "complete";
    emitEvent(this.listeners, "icegatheringstatechange");
  }

  setConnectionState(connectionState: RTCPeerConnectionState): void {
    this.connectionState = connectionState;
    emitEvent(this.listeners, "connectionstatechange");
  }

  emitDataChannel(channel: FakeRTCDataChannel): void {
    emitEvent(this.listeners, "datachannel", {
      channel: channel as unknown as RTCDataChannel
    });
  }
}

const createHostOfferPayload = (): HostOfferPayload => ({
  protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
  mode: "p2p",
  role: "host",
  sdp: "host-offer-sdp",
  timestamp: 10
});

describe("WebRTCPeer", () => {
  it("creates a non-trickle host offer and waits for ICE gathering", async () => {
    const connection = new FakeRTCPeerConnection();
    const statuses: WebRTCPeerStatusChange[] = [];
    const peer = new WebRTCPeer({
      createPeerConnection: () => connection as unknown as RTCPeerConnection,
      now: () => 10
    });

    peer.subscribe({
      onStatusChange: (change) => {
        statuses.push(change);
      }
    });

    let resolved = false;
    const offerPromise = peer.createHostOffer().then((payload) => {
      resolved = true;
      return payload;
    });

    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(connection.createdDataChannels[0]?.label).toBe("game-client");
    expect(statuses).toEqual([{ status: "creating-offer" }]);

    connection.completeIceGathering();

    await expect(offerPromise).resolves.toEqual(createHostOfferPayload());
    expect(statuses).toEqual([
      { status: "creating-offer" },
      { status: "waiting-for-answer" }
    ]);
  });

  it("creates a guest answer, wires the remote data channel, and forwards messages", async () => {
    const connection = new FakeRTCPeerConnection();
    const remoteChannel = new FakeRTCDataChannel("game-client");
    const statuses: WebRTCPeerStatusChange[] = [];
    const messages: string[] = [];
    const peer = new WebRTCPeer({
      createPeerConnection: () => connection as unknown as RTCPeerConnection,
      now: () => 20
    });

    peer.subscribe({
      onStatusChange: (change) => {
        statuses.push(change);
      },
      onMessage: (message) => {
        messages.push(message);
      }
    });

    const answerPromise = peer.createGuestAnswer(createHostOfferPayload(), "Guest Player");
    await Promise.resolve();
    connection.completeIceGathering();

    await expect(answerPromise).resolves.toEqual({
      protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
      mode: "p2p",
      role: "guest",
      displayName: "Guest Player",
      sdp: "guest-answer-sdp",
      timestamp: 20
    });

    expect(connection.remoteDescription).toEqual({
      type: "offer",
      sdp: "host-offer-sdp"
    });
    expect(statuses).toEqual([
      { status: "creating-answer" },
      { status: "waiting-for-host-finalize" }
    ]);

    connection.emitDataChannel(remoteChannel);
    remoteChannel.open();
    remoteChannel.emitMessage("server-event");

    expect(statuses.at(-1)).toEqual({ status: "connected" });
    expect(messages).toEqual(["server-event"]);
  });

  it("applies the guest answer, sends messages after open, and reports failures", async () => {
    const connection = new FakeRTCPeerConnection();
    const statuses: WebRTCPeerStatusChange[] = [];
    const peer = new WebRTCPeer({
      createPeerConnection: () => connection as unknown as RTCPeerConnection,
      now: () => 10
    });

    peer.subscribe({
      onStatusChange: (change) => {
        statuses.push(change);
      }
    });

    const offerPromise = peer.createHostOffer();
    await Promise.resolve();
    connection.completeIceGathering();
    await offerPromise;

    await peer.applyGuestAnswer({
      protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
      mode: "p2p",
      role: "guest",
      displayName: "Guest Player",
      sdp: "guest-answer-sdp",
      timestamp: 11
    });

    expect(connection.remoteDescription).toEqual({
      type: "answer",
      sdp: "guest-answer-sdp"
    });
    expect(statuses.at(-1)).toEqual({ status: "connecting" });

    const channel = connection.createdDataChannels[0];

    if (!channel) {
      throw new Error("Expected host data channel.");
    }

    channel.open();
    peer.send("client-event");

    expect(channel.sentMessages).toEqual(["client-event"]);
    expect(statuses.at(-1)).toEqual({ status: "connected" });

    connection.setConnectionState("failed");

    expect(statuses.at(-1)).toEqual({
      status: "failed",
      error: "Peer connection failed."
    });
  });
});
