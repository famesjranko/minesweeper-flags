import {
  P2P_SIGNALING_PROTOCOL_VERSION,
  type GuestAnswerPayload,
  type HostOfferPayload,
  type ReconnectAnswerPayload,
  type ReconnectOfferPayload
} from "@minesweeper-flags/shared";
import type {
  WebRTCPeerController,
  WebRTCPeerListener,
  WebRTCPeerOptions,
  WebRTCPeerStatus,
  WebRTCPeerStatusChange
} from "./webrtc-peer.types.js";

const DEFAULT_DATA_CHANNEL_LABEL = "game-client";

const waitForIceGatheringComplete = async (connection: RTCPeerConnection): Promise<void> => {
  if (connection.iceGatheringState === "complete") {
    return;
  }

  await new Promise<void>((resolve) => {
    const handleStateChange = (): void => {
      if (connection.iceGatheringState !== "complete") {
        return;
      }

      connection.removeEventListener("icegatheringstatechange", handleStateChange);
      resolve();
    };

    connection.addEventListener("icegatheringstatechange", handleStateChange);
  });
};

export class WebRTCPeer implements WebRTCPeerController {
  private readonly createPeerConnection: (configuration: RTCConfiguration) => RTCPeerConnection;
  private readonly dataChannelLabel: string;
  private readonly dataChannelOptions: RTCDataChannelInit | undefined;
  private readonly now: () => number;
  private readonly rtcConfiguration: RTCConfiguration;
  private readonly listeners = new Set<WebRTCPeerListener>();
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private status: WebRTCPeerStatus = "idle";

  constructor(options: WebRTCPeerOptions = {}) {
    this.createPeerConnection =
      options.createPeerConnection ?? ((configuration) => new RTCPeerConnection(configuration));
    this.dataChannelLabel = options.dataChannelLabel ?? DEFAULT_DATA_CHANNEL_LABEL;
    this.dataChannelOptions = options.dataChannelOptions;
    this.now = options.now ?? (() => Date.now());
    this.rtcConfiguration = options.rtcConfiguration ?? {};
  }

  getStatus = (): WebRTCPeerStatus => this.status;

  subscribe = (listener: WebRTCPeerListener): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  createHostOffer = async (): Promise<HostOfferPayload> => {
    return this.createOfferPayload("p2p") as Promise<HostOfferPayload>;
  };

  createReconnectOffer = async (): Promise<ReconnectOfferPayload> => {
    return this.createOfferPayload("p2p-reconnect") as Promise<ReconnectOfferPayload>;
  };

  createGuestAnswer = async (
    offerPayload: HostOfferPayload,
    displayName: string
  ): Promise<GuestAnswerPayload> => {
    return this.createAnswerPayload(offerPayload.sdp, {
      protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
      mode: "p2p",
      role: "guest",
      displayName
    });
  };

  createReconnectAnswer = async (offerPayload: ReconnectOfferPayload): Promise<ReconnectAnswerPayload> => {
    return this.createAnswerPayload(offerPayload.sdp, {
      protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
      mode: "p2p-reconnect",
      role: "guest"
    });
  };

  applyGuestAnswer = async (answerPayload: GuestAnswerPayload): Promise<void> => {
    await this.applyAnswerPayload(answerPayload.sdp, "Failed to apply guest answer.");
  };

  applyReconnectAnswer = async (answerPayload: ReconnectAnswerPayload): Promise<void> => {
    await this.applyAnswerPayload(answerPayload.sdp, "Failed to apply reconnect answer.");
  };

  private async createOfferPayload(mode: "p2p" | "p2p-reconnect"): Promise<HostOfferPayload | ReconnectOfferPayload> {
    try {
      this.emitStatus({ status: "creating-offer" });

      const connection = this.replaceConnection();
      const channel = connection.createDataChannel(this.dataChannelLabel, this.dataChannelOptions);
      this.attachChannel(channel);

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await waitForIceGatheringComplete(connection);

      const sdp = connection.localDescription?.sdp;

      if (!sdp) {
        throw new Error("Host offer SDP was not available after ICE gathering completed.");
      }

      this.emitStatus({ status: "waiting-for-answer" });

      return {
        protocolVersion: P2P_SIGNALING_PROTOCOL_VERSION,
        mode,
        role: "host",
        sdp,
        timestamp: this.now()
      };
    } catch (error) {
      this.handleFailure(error, "Failed to create host offer.");
    }
  };

  private async createAnswerPayload<TAnswer extends GuestAnswerPayload | ReconnectAnswerPayload>(
    offerSdp: string,
    answerBase: Omit<TAnswer, "sdp" | "timestamp">
  ): Promise<TAnswer> {
    try {
      this.emitStatus({ status: "creating-answer" });

      const connection = this.replaceConnection();

      await connection.setRemoteDescription({
        type: "offer",
        sdp: offerSdp
      });

      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      await waitForIceGatheringComplete(connection);

      const sdp = connection.localDescription?.sdp;

      if (!sdp) {
        throw new Error("Guest answer SDP was not available after ICE gathering completed.");
      }

      this.emitStatus({ status: "waiting-for-host-finalize" });

      return {
        ...answerBase,
        sdp,
        timestamp: this.now()
      } as TAnswer;
    } catch (error) {
      this.handleFailure(
        error,
        answerBase.mode === "p2p-reconnect" ? "Failed to create reconnect answer." : "Failed to create guest answer."
      );
    }
  }

  private async applyAnswerPayload(answerSdp: string, fallbackMessage: string): Promise<void> {
    if (!this.connection) {
      throw new Error("Cannot apply a guest answer before creating a host offer.");
    }

    try {
      await this.connection.setRemoteDescription({
        type: "answer",
        sdp: answerSdp
      });

      this.emitStatus({ status: "connecting" });
    } catch (error) {
      this.handleFailure(error, fallbackMessage);
    }
  }

  send = (message: string): void => {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("Peer data channel is not open.");
    }

    this.channel.send(message);
  };

  disconnect = (): void => {
    this.channel?.close();
    this.connection?.close();
    this.channel = null;
    this.connection = null;
    this.emitStatus({ status: "closed" });
  };

  private replaceConnection(): RTCPeerConnection {
    this.channel?.close();
    this.connection?.close();

    const connection = this.createPeerConnection(this.rtcConfiguration);
    this.connection = connection;
    this.channel = null;

    connection.addEventListener("datachannel", (event) => {
      this.attachChannel(event.channel);
    });

    connection.addEventListener("connectionstatechange", () => {
      this.handleConnectionStateChange(connection.connectionState);
    });

    return connection;
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;

    channel.addEventListener("open", () => {
      this.emitStatus({ status: "connected" });
    });

    channel.addEventListener("close", () => {
      if (this.connection || this.channel) {
        this.emitStatus({ status: "closed" });
      }
    });

    channel.addEventListener("error", () => {
      this.emitStatus({
        status: "failed",
        error: "Peer data channel encountered an error."
      });
    });

    channel.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      for (const listener of this.listeners) {
        listener.onMessage?.(event.data);
      }
    });
  }

  private handleConnectionStateChange(connectionState: RTCPeerConnectionState): void {
    switch (connectionState) {
      case "connecting":
        this.emitStatus({ status: "connecting" });
        break;
      case "failed":
        this.emitStatus({
          status: "failed",
          error: "Peer connection failed."
        });
        break;
      case "disconnected":
      case "closed":
        this.emitStatus({ status: "closed" });
        break;
      default:
        break;
    }
  }

  private emitStatus(change: WebRTCPeerStatusChange): void {
    if (this.status === change.status && change.error === undefined) {
      return;
    }

    this.status = change.status;

    for (const listener of this.listeners) {
      listener.onStatusChange?.(change);
    }
  }

  private handleFailure(error: unknown, fallbackMessage: string): never {
    const message = error instanceof Error ? error.message : fallbackMessage;

    this.emitStatus({
      status: "failed",
      error: message
    });

    throw error instanceof Error ? error : new Error(fallbackMessage);
  }
}
