import type { SessionPersistence } from "../../lib/socket/session-storage.js";
import { P2P_STUN_URLS } from "../../lib/config/env.js";
import {
  GameClientController,
  createBrowserGameClientScheduler,
  type GameClientScheduler
} from "../../app/providers/game-client.controller.js";
import { GameClientStore } from "../../app/providers/game-client.store.js";
import type { StoredSession } from "../../lib/socket/session-storage.js";
import type {
  GameClientRuntime,
  GameClientRuntimeController
} from "../../app/providers/game-client.runtime.js";
import type { GuestAnswerPayload } from "@minesweeper-flags/shared";
import { toMatchStateDto } from "@minesweeper-flags/shared";
import { decodeGuestAnswerPayload } from "../signaling/p2p-signaling.codec.js";
import {
  P2PRendezvousRequestError,
  createP2PRendezvousClient,
  type P2PRendezvousClient
} from "../signaling/p2p-rendezvous-client.js";
import { createP2PJoinUrl } from "../signaling/p2p-signaling-url.js";
import { P2PHostOrchestrator } from "../host/p2p-host-orchestrator.js";
import {
  createP2PSetupController,
  getGuestDirectJoinUnavailableMessage
} from "../setup/p2p-setup.controller.js";
import { WebRTCGameClientTransport } from "../transport/webrtc-game-client.transport.js";
import { WebRTCPeer } from "../transport/webrtc-peer.js";
import type { WebRTCPeerController } from "../transport/webrtc-peer.types.js";
import { P2PHostGameClientTransport } from "./p2p-host-game-client.transport.js";
import {
  P2P_RECOVERY_STORAGE_VERSION,
  createBrowserP2PRecoveryPersistence,
  createHostRecoveryRecord,
  extractHostRecoveryState,
  type P2PRecoveryGuestRecord,
  type P2PRecoveryHostRecord,
  type P2PRecoveryPersistence
} from "../storage/p2p-recovery-storage.js";
import { decodeP2PRecoveryControlMessage } from "../recovery/p2p-recovery-control.js";
import type { P2PHostAuthoritySnapshot } from "../host/p2p-host-state.js";

const UNSUPPORTED_MATCH_ACTION_MESSAGE =
  "Direct Match setup is still loading. Start from the direct-match lobby flow.";
const P2P_CHAT_DISCONNECTED_MESSAGE =
  "Chat is offline. If the direct link stays down, restart the direct match.";
const P2P_ACTION_DISCONNECTED_MESSAGE =
  "Direct connection interrupted. Restart the direct match if it does not recover.";
const HOST_RECONNECT_RETRY_DELAY_MS = 1_000;
const RECONNECT_HEARTBEAT_INTERVAL_MS = 3_000;
const DIRECT_MATCH_DISPLACED_MESSAGE =
  "This direct match is active in another tab or window. Use that tab, or reconnect here.";
const DIRECT_MATCH_RECOVERY_UNAVAILABLE_MESSAGE =
  "Direct-match recovery is no longer available for this session. Start a new direct match if the connection drops again.";
const DIRECT_MATCH_AUTHORITATIVE_MESSAGE =
  "You now have control. This direct match is active in this tab.";
const DIRECT_MATCH_CLAIM_ACTIVE_MESSAGE =
  "Reconnected. You now have an active claim.";

const noopSessionPersistence: SessionPersistence = {
  read: () => null,
  write: () => {},
  remove: () => {}
};

type RendezvousClient = Pick<
  P2PRendezvousClient,
  | "createSession"
  | "getSession"
  | "submitAnswer"
  | "pollForAnswer"
  | "finalizeSession"
  | "pollForFinalization"
  | "registerReconnectControlSession"
  | "claimReconnectRole"
  | "heartbeatReconnectRole"
  | "writeReconnectOffer"
  | "pollForReconnectOffer"
  | "writeReconnectAnswer"
  | "pollForReconnectAnswer"
  | "finalizeReconnectAttempt"
  | "pollForReconnectFinalization"
>;

interface P2PHostReconnectControlState {
  controlSessionId: string;
  hostSecret: string;
  guestSecret: string;
  lastInstanceId?: string;
}

interface PendingGuestRecoveryControlRecord {
  controlSessionId: string;
  guestSecret: string;
}

interface ActiveReconnectClaimState {
  controlSessionId: string;
  role: "host" | "guest";
  secret: string;
  instanceId: string;
  roomCode: string | null;
  timerId: number | null;
}

const createRandomId = (): string =>
  globalThis.crypto?.randomUUID() ?? `p2p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const toStoredSession = (record: P2PRecoveryGuestRecord): StoredSession => ({
  roomId: record.roomId,
  roomCode: record.roomCode,
  playerId: record.playerId,
  displayName: record.displayName,
  sessionToken: record.sessionToken
});

const createGuestRecoverySessionPersistence = (
  recoveryRecord: P2PRecoveryGuestRecord,
  recoveryPersistence: P2PRecoveryPersistence
): SessionPersistence => ({
  read: (roomCode) => {
    if (roomCode !== recoveryRecord.roomCode) {
      return null;
    }

    return toStoredSession(recoveryRecord);
  },
  write: (session) => {
    if (session.roomCode !== recoveryRecord.roomCode) {
      return;
    }

    recoveryRecord.roomId = session.roomId;
    recoveryRecord.roomCode = session.roomCode;
    recoveryRecord.playerId = session.playerId;
    recoveryRecord.displayName = session.displayName;
    recoveryRecord.sessionToken = session.sessionToken;
    recoveryPersistence.write(recoveryRecord);
  },
  remove: (roomCode) => {
    if (roomCode !== recoveryRecord.roomCode) {
      return;
    }

    recoveryPersistence.remove(roomCode);
  }
});

export interface CreateP2PGameClientRuntimeOptions {
  createPeer?: () => WebRTCPeerController;
  scheduler?: GameClientScheduler;
  rendezvousClient?: RendezvousClient;
  recoveryPersistence?: P2PRecoveryPersistence;
}

class P2PBootstrapController implements GameClientRuntimeController {
  private activeController: GameClientController | null = null;
  private activePeer: WebRTCPeerController | null = null;
  private activeRole: "host" | "guest" | null = null;
  private hostTransport: P2PHostGameClientTransport | null = null;
  private pendingGuestDisplayName: string | null = null;
  private hostSessionFinalized = false;
  private hostSetupAbortController: AbortController | null = null;
  private guestSetupAbortController: AbortController | null = null;
  private hostReconnectAbortController: AbortController | null = null;
  private hostReconnectRetryTimeoutId: number | null = null;
  private hostReconnectControl: P2PHostReconnectControlState | null = null;
  private hostReconnectInFlight = false;
  private hostReconnectNeedsGuestRebind = false;
  private pendingGuestRecoveryControl: PendingGuestRecoveryControlRecord | null = null;
  private activeReconnectClaim: ActiveReconnectClaimState | null = null;
  private guestReconnectInFlight = false;
  private lastClaimWasVictory = false;
  private readonly noopPersistence = noopSessionPersistence;

  constructor(
    private readonly store: GameClientStore,
    private readonly createPeer: () => WebRTCPeerController,
    private readonly scheduler: GameClientScheduler,
    private readonly rendezvousClient: RendezvousClient,
    private readonly recoveryPersistence: P2PRecoveryPersistence,
    readonly setup = createP2PSetupController()
    ) {
      this.store.subscribe(() => {
        this.flushPendingGuestRecoveryControl();
        this.persistCurrentHostRecoveryRecord();
      });
    }

  start = (): void => {
    this.store.setConnectionStatus("disconnected");
  };

  dispose = (): void => {
    this.teardownActiveRuntime();
    this.setup.controller.resetHost();
    this.setup.controller.resetGuest();
  };

  hasStoredSession = (roomCode: string): boolean => {
    const record = this.recoveryPersistence.read(roomCode);
    return record?.role === "guest" || record?.role === "host";
  };

  openLobby = (): void => {
    this.clearRecoveryForActiveRuntime();
    this.teardownActiveRuntime();
    this.setup.controller.resetHost();
    this.setup.controller.resetGuest();
    this.store.setSession(null);
    this.store.clearTransientRoomState();
    this.store.setError(null);
    this.store.setConnectionStatus("disconnected");
  };

  createRoom = (displayName: string): void => {
    const trimmedDisplayName = displayName.trim();

    if (!trimmedDisplayName) {
      return;
    }

    this.store.setError(null);
    this.store.clearTransientRoomState();
    this.setup.controller.resetHost();
    this.setup.controller.resetGuest();
    this.clearRecoveryForActiveRuntime();
    this.teardownActiveRuntime();
    this.hostSetupAbortController = new AbortController();
    this.hostSessionFinalized = false;

    const peer = this.createPeer();
    const hostTransport = new P2PHostGameClientTransport(new P2PHostOrchestrator(), peer);
    const controller = this.createGameController(hostTransport);

    this.activePeer = peer;
    this.activeRole = "host";
    this.hostTransport = hostTransport;
    this.activeController = controller;
    this.subscribeToPeer(peer, "host");
    controller.start();
    this.setup.controller.startHostOfferCreation(trimmedDisplayName);
    controller.createRoom(trimmedDisplayName);

    void peer
      .createHostOffer()
      .then(async (offerPayload) => {
        if (!this.isActivePeer(peer, "host")) {
          return;
        }

        this.setup.controller.completeHostOfferCreation({
          displayName: trimmedDisplayName,
          offerPayload
        });

        const createdSession = await this.rendezvousClient.createSession(
          offerPayload,
          this.hostSetupAbortController?.signal
        );

        if (!this.isActivePeer(peer, "host")) {
          return;
        }

        this.setup.controller.completeHostSessionCreation({
          sessionId: createdSession.sessionId,
          hostSecret: createdSession.hostSecret,
          expiresAt: createdSession.expiresAt,
          sessionState: createdSession.state,
          joinUrl: createP2PJoinUrl(createdSession.sessionId)
        });

        const answerResponse = await this.rendezvousClient.pollForAnswer(
          createdSession.sessionId,
          createdSession.hostSecret,
          this.hostSetupAbortController ? { signal: this.hostSetupAbortController.signal } : {}
        );

        if (!this.isActivePeer(peer, "host")) {
          return;
        }

        this.setup.controller.setHostSessionState(answerResponse.state);

        if (answerResponse.state === "expired") {
          throw new Error("This direct-match link expired before a guest connected. Start a new direct match.");
        }

        if (!answerResponse.answer) {
          throw new Error("This direct-match link expired before a guest connected. Start a new direct match.");
        }

        await this.applyHostGuestAnswerPayload(peer, answerResponse.answer);

        const finalizedSession = await this.rendezvousClient.finalizeSession(
          createdSession.sessionId,
          createdSession.hostSecret,
          this.hostSetupAbortController?.signal
        );

        if (!this.isActivePeer(peer, "host")) {
          return;
        }

        this.hostSessionFinalized = true;
        this.setup.controller.setHostSessionState(finalizedSession.state);
        this.finalizeHostGuestIfReady();
      })
      .catch((error: unknown) => {
        if (!this.isActivePeer(peer, "host") || this.isAbortError(error)) {
          return;
        }

        this.teardownFailedRuntime();

        this.setup.controller.failHostSetup(
          error instanceof Error ? error.message : "Failed to create the direct-match offer."
        );
      });
  };

  joinRoom = (): void => {
    this.store.setError(UNSUPPORTED_MATCH_ACTION_MESSAGE);
  };

  reconnect = (roomCode: string): void => {
    const record = this.recoveryPersistence.read(roomCode);

    if (!record) {
      this.store.setError("No local session is stored for that room.");
      return;
    }

    this.store.setError(null);
    this.store.setSession(null);
    this.store.clearTransientRoomState();
    this.setup.controller.resetHost();
    this.setup.controller.resetGuest();
    this.teardownActiveRuntime();

    if (record.role === "guest") {
      this.startGuestReconnect(record);
      return;
    }

    this.startHostReconnect(record);
  };

  private startGuestReconnect(record: P2PRecoveryGuestRecord): void {
    this.guestReconnectInFlight = true;

    this.guestSetupAbortController = new AbortController();
    record.reconnect.lastInstanceId = createRandomId();
    this.recoveryPersistence.write(record);

    const guestPeer = this.createPeer();
    const controller = this.createGameController(
      new WebRTCGameClientTransport(guestPeer, {
        interceptMessage: this.handleGuestPeerMessage
      }),
      createGuestRecoverySessionPersistence(record, this.recoveryPersistence)
    );

    this.activePeer = guestPeer;
    this.activeRole = "guest";
    this.activeController = controller;
    this.subscribeToPeer(guestPeer, "guest");
    controller.start();
    controller.reconnect(record.roomCode);

    void this.performGuestReconnect(record, guestPeer).catch((error: unknown) => {
      if (!this.isActivePeer(guestPeer, "guest") || this.isAbortError(error)) {
        return;
      }

      this.teardownFailedRuntime();
      this.store.setError(error instanceof Error ? error.message : "Failed to restore the direct match.");
    });
  }

  private startHostReconnect(record: P2PRecoveryHostRecord): void {
    if (!record.reconnect.guestSecret) {
      this.recoveryPersistence.remove(record.room.roomCode);
      this.store.setError("This direct match can no longer be restored. Start a new direct match.");
      return;
    }

    const authoritySnapshot = extractHostRecoveryState(record);
    const orchestrator = new P2PHostOrchestrator();

    orchestrator.hydrate(authoritySnapshot);

    const hostPeer = this.createPeer();
    const hostTransport = new P2PHostGameClientTransport(orchestrator, hostPeer);
    const controller = this.createGameController(hostTransport);

    this.activePeer = hostPeer;
    this.activeRole = "host";
    this.hostTransport = hostTransport;
    const reconnectControl: P2PHostReconnectControlState = {
      controlSessionId: record.reconnect.controlSessionId,
      hostSecret: record.reconnect.hostSecret,
      guestSecret: record.reconnect.guestSecret,
      ...(record.reconnect.lastInstanceId ? { lastInstanceId: record.reconnect.lastInstanceId } : {})
    };
    this.hostReconnectControl = reconnectControl;
    this.hostReconnectNeedsGuestRebind = true;
    this.hostReconnectInFlight = true;
    this.clearHostReconnectRetryTimer();
    this.activeController = controller;
    this.subscribeToPeer(hostPeer, "host");
    controller.start();
    this.restoreHostStore(authoritySnapshot);
    this.setup.controller.setHostStage("connecting");

    this.hostReconnectAbortController = new AbortController();
    const reconnectSignal = this.hostReconnectAbortController.signal;

    void this.runHostReconnectAttempt({
      peer: hostPeer,
      reconnectControl,
      signal: reconnectSignal,
      roomCode: record.room.roomCode
    }).catch((error: unknown) => {
      if (!this.isActivePeer(hostPeer, "host") || this.isAbortError(error)) {
        return;
      }

      this.teardownFailedRuntime();
      this.store.setSession(null);
      this.store.clearTransientRoomState();
      this.store.setError(error instanceof Error ? error.message : "Failed to restore the direct match.");
    }).finally(() => {
      // safe vs CLAUDE.md hang bug: runHostReconnectAttempt has already settled (via the .catch above) by the time this .finally runs — no in-flight poll loop to orphan.
      if (this.hostReconnectAbortController?.signal === reconnectSignal) {
        this.hostReconnectInFlight = false;
      }

      if (this.hostReconnectAbortController?.signal === reconnectSignal) {
        this.hostReconnectAbortController = null;
      }
    });
  }

  submitCellAction = (row: number, column: number): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setError(P2P_ACTION_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.activeController) {
      this.store.setError("Connect to a direct match before making a move.");
      return;
    }

    this.activeController.submitCellAction(row, column);
  };

  setChatDraft = (value: string): void => {
    if (!this.activeController) {
      this.store.setChatDraft(value);
      this.store.setChatError(null);
      return;
    }

    this.activeController.setChatDraft(value);
  };

  sendChatMessage = (): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setChatError(P2P_CHAT_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.activeController) {
      this.store.setChatError("Connect to a direct match before chatting.");
      return;
    }

    this.activeController.sendChatMessage();
  };

  toggleBombMode = (): void => {
    this.store.toggleBombMode();
  };

  resignMatch = (): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setError(P2P_ACTION_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.activeController) {
      this.store.setError("Connect to a direct match before resigning.");
      return;
    }

    this.activeController.resignMatch();
  };

  requestRematch = (): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setError(P2P_ACTION_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.activeController) {
      this.store.setError("Connect to a direct match before requesting a rematch.");
      return;
    }

    this.activeController.requestRematch();
  };

  cancelRematch = (): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setError(P2P_ACTION_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.activeController) {
      this.store.setError("Connect to a direct match before changing rematch state.");
      return;
    }

    this.activeController.cancelRematch();
  };

  clearError = (): void => {
    this.store.clearError();
  };

  openGuestSetupSession = (sessionId: string): void => {
    const trimmedSessionId = sessionId.trim();

    if (!trimmedSessionId) {
      this.setup.controller.failGuestSetup("This direct-match link could not be read.");
      return;
    }

    this.store.setError(null);
    this.clearRecoveryForActiveRuntime();
    this.store.setSession(null);
    this.store.clearTransientRoomState();
    this.teardownActiveRuntime();
    this.setup.controller.resetHost();
    this.guestSetupAbortController = new AbortController();
    this.setup.controller.startGuestSessionLoad(trimmedSessionId);

    void this.rendezvousClient
      .getSession(trimmedSessionId, this.guestSetupAbortController.signal)
      .then((fetchedSession) => {
        this.setup.controller.completeGuestSessionLoad({
          sessionId: fetchedSession.sessionId,
          offerPayload: fetchedSession.offer,
          expiresAt: fetchedSession.expiresAt,
          sessionState: fetchedSession.state
        });
      })
      .catch((error: unknown) => {
        if (this.isAbortError(error)) {
          return;
        }

        this.setup.controller.failGuestSetup(
          error instanceof Error ? error.message : "This direct-match link could not be loaded."
        );
      });
  };

  openGuestSetupFromFragment = (): void => {
    this.setup.controller.failGuestSetup(
      "This direct-match link uses an old format. Start a new direct match from the lobby."
    );
  };

  createGuestAnswer = (displayName: string): void => {
    const trimmedDisplayName = displayName.trim();
    const guestSetup = this.setup.store.getSnapshot().guest;
    const sessionId = guestSetup.sessionId;

    if (!trimmedDisplayName || !guestSetup.offerPayload || !sessionId) {
      return;
    }

    const unavailableMessage = this.getUnavailableGuestSetupMessage(guestSetup.sessionState, guestSetup.expiresAt);

    if (unavailableMessage) {
      this.setup.controller.failGuestSetup(unavailableMessage);
      return;
    }

    this.store.setError(null);
    this.clearRecoveryForActiveRuntime();
    this.store.setSession(null);
    this.store.clearTransientRoomState();
    this.teardownActiveRuntime();
    this.guestSetupAbortController = new AbortController();
    let guestPeer: WebRTCPeerController | null = null;

    void this.rendezvousClient
      .getSession(sessionId, this.guestSetupAbortController.signal)
      .then(async (refreshedSession) => {
        const refreshedUnavailableMessage = this.getUnavailableGuestSetupMessage(
          refreshedSession.state,
          refreshedSession.expiresAt
        );

        this.setup.controller.completeGuestSessionLoad({
          sessionId: refreshedSession.sessionId,
          offerPayload: refreshedSession.offer,
          expiresAt: refreshedSession.expiresAt,
          sessionState: refreshedSession.state
        });

        if (refreshedUnavailableMessage) {
          this.setup.controller.failGuestSetup(refreshedUnavailableMessage);
          return;
        }

        guestPeer = this.createPeer();
        const controller = this.createGameController(
          new WebRTCGameClientTransport(guestPeer, {
            interceptMessage: this.handleGuestPeerMessage
          })
        );

        this.activePeer = guestPeer;
        this.activeRole = "guest";
        this.activeController = controller;
        this.subscribeToPeer(guestPeer, "guest");
        controller.start();
        this.setup.controller.startGuestAnswerCreation(trimmedDisplayName);

        const createdAnswerPayload = await guestPeer.createGuestAnswer(refreshedSession.offer, trimmedDisplayName);

        if (!this.isActivePeer(guestPeer, "guest")) {
          return;
        }

        this.setup.controller.completeGuestAnswerCreation({
          displayName: trimmedDisplayName,
          answerPayload: createdAnswerPayload
        });

        const submittedAnswer = await this.rendezvousClient.submitAnswer(
          sessionId,
          createdAnswerPayload,
          this.guestSetupAbortController?.signal
        );

        if (!this.isActivePeer(guestPeer, "guest")) {
          return;
        }

        this.setup.controller.completeGuestAnswerSubmission(submittedAnswer.state);

        const finalizedSession = await this.rendezvousClient.pollForFinalization(
          sessionId,
          this.guestSetupAbortController ? { signal: this.guestSetupAbortController.signal } : {}
        );

        if (!this.isActivePeer(guestPeer, "guest")) {
          return;
        }

        this.setup.controller.setGuestSessionState(finalizedSession.state);

        if (finalizedSession.state === "expired") {
          throw new Error("This direct-match link expired before the host finished setup. Start a new direct match.");
        }

        if (this.activePeer?.getStatus() !== "connected") {
          this.setup.controller.setGuestStage("connecting");
        }
      })
      .catch((error: unknown) => {
        if (this.isAbortError(error)) {
          return;
        }

        if (guestPeer && !this.isActivePeer(guestPeer, "guest")) {
          return;
        }

        this.setup.controller.failGuestSetup(
          error instanceof Error ? error.message : "Failed to join the direct match."
        );
      });
  };

  setHostGuestAnswerText = (value: string): void => {
    this.setup.controller.clearHostError();
    this.setup.controller.setGuestAnswerText(value);
  };

  applyHostGuestAnswer = (): boolean => {
    const hostSetup = this.setup.store.getSnapshot().host;

    if (!this.activePeer || this.activeRole !== "host" || !this.hostTransport) {
      this.setup.controller.failHostSetup("Create a direct link before applying a guest answer.");
      return false;
    }

    try {
      const answerPayload = decodeGuestAnswerPayload(hostSetup.guestAnswerText);

      void this.applyHostGuestAnswerPayload(this.activePeer, answerPayload).catch((error: unknown) => {
        if (this.isAbortError(error)) {
          return;
        }

        this.setup.controller.failHostSetup(
          error instanceof Error ? error.message : "Failed to apply the guest answer payload."
        );
      });

      return true;
    } catch (error) {
      this.setup.controller.failHostSetup(
        error instanceof Error ? error.message : "Guest answer payload is invalid."
      );
      return false;
    }
  };

  clearHostSetupError = (): void => {
    this.setup.controller.clearHostError();
  };

  clearGuestSetupError = (): void => {
    this.setup.controller.clearGuestError();
  };

  getSetupSnapshot = () => this.setup.store.getSnapshot();

  private async applyHostGuestAnswerPayload(
    peer: WebRTCPeerController,
    answerPayload: GuestAnswerPayload
  ): Promise<void> {
    this.pendingGuestDisplayName = answerPayload.displayName;
    this.setup.controller.applyGuestAnswer(answerPayload);
    await peer.applyGuestAnswer(answerPayload);
    this.finalizeHostGuestIfReady();
  }

  private createGameController(
    transport: ConstructorParameters<typeof GameClientController>[0]["transport"],
    persistence: SessionPersistence = this.noopPersistence
  ) {
    return new GameClientController({
      store: this.store,
      transport,
      persistence,
      scheduler: this.scheduler,
      copy: {
        chatDisconnectedMessage:
          "Chat is offline. If the direct link stays down, restart the direct match.",
        actionDisconnectedMessage:
          "Direct connection interrupted. Restart the direct match if it does not recover."
      }
    });
  }

  private subscribeToPeer(peer: WebRTCPeerController, role: "host" | "guest"): void {
    peer.subscribe({
      onStatusChange: (change) => {
        if (!this.isActivePeer(peer, role)) {
          return;
        }

        if (role === "host") {
          if (change.status === "connected") {
            if (this.hostReconnectNeedsGuestRebind && this.activePeer === peer && this.hostTransport) {
              this.hostTransport.rebindGuestPeer();
              this.hostReconnectNeedsGuestRebind = false;
            }

            this.finalizeHostGuestIfReady();
            return;
          }

        if (change.status === "failed" || change.status === "closed") {
          if (this.hostReconnectControl && this.hostTransport?.hasGuestSession()) {
            if (!this.hostReconnectInFlight) {
                void this.handleHostPeerClosed(peer).catch((error: unknown) => {
                  if (this.isAbortError(error)) {
                    return;
                  }
                });
              }

              return;
            }

            if (change.status === "failed") {
              this.setup.controller.failHostSetup(change.error ?? "Direct connection failed.");
              return;
            }

            this.setup.controller.setHostStage("closed");
          }

          return;
        }

        if (change.status === "connected") {
          this.setup.controller.setGuestStage("connected");
          return;
        }

        if (change.status === "failed") {
          if (this.tryAutoReconnectGuest()) {
            return;
          }

          this.setup.controller.failGuestSetup(change.error ?? "Direct connection failed.");
          return;
        }

        if (change.status === "closed") {
          if (this.tryAutoReconnectGuest()) {
            return;
          }

          this.setup.controller.setGuestStage("closed");
        }
      }
    });
  }

  private finalizeHostGuestIfReady(): void {
    if (
      !this.activePeer ||
      this.activeRole !== "host" ||
      !this.hostTransport ||
      !this.pendingGuestDisplayName ||
      !this.hostSessionFinalized ||
      this.activePeer.getStatus() !== "connected"
    ) {
      return;
    }

    const displayName = this.pendingGuestDisplayName;

    this.pendingGuestDisplayName = null;
    this.hostTransport.acceptGuest(displayName);
    this.setup.controller.setHostStage("connected");
    void this.ensureHostReconnectControlRegistered().catch((error: unknown) => {
      if (this.isAbortError(error)) {
        return;
      }

      this.hostReconnectControl = null;
      this.store.setError(
        error instanceof Error ? error.message : "Direct-match recovery is unavailable for this session."
      );
    });
  }

  private readonly handleGuestPeerMessage = (message: string): boolean => {
    const controlMessage = decodeP2PRecoveryControlMessage(message);

    if (!controlMessage) {
      return false;
    }

    const activeSession = this.store.getSnapshot().session;

    if (!activeSession) {
      this.pendingGuestRecoveryControl = {
        controlSessionId: controlMessage.payload.controlSessionId,
        guestSecret: controlMessage.payload.guestSecret
      };
      return true;
    }

    this.persistGuestRecoveryControl(activeSession, controlMessage.payload);
    return true;
  };

  private persistGuestRecoveryControl(
    activeSession: NonNullable<ReturnType<GameClientStore["getSnapshot"]>["session"]>,
    control: PendingGuestRecoveryControlRecord
  ): void {
    const existingRecord = this.recoveryPersistence.read(activeSession.roomCode);
    const instanceId =
      existingRecord?.role === "guest" && existingRecord.reconnect.controlSessionId === control.controlSessionId
        ? (existingRecord.reconnect.lastInstanceId ?? createRandomId())
        : createRandomId();
    const recoveryRecord: P2PRecoveryGuestRecord = {
      version: P2P_RECOVERY_STORAGE_VERSION,
      role: "guest",
      roomId: activeSession.roomId,
      roomCode: activeSession.roomCode,
      playerId: activeSession.playerId,
      displayName: activeSession.displayName,
      sessionToken: activeSession.sessionToken,
      players: activeSession.players.map((player) => ({ ...player })),
      reconnect: {
        controlSessionId: control.controlSessionId,
        guestSecret: control.guestSecret,
        lastInstanceId: instanceId
      }
    };

    this.recoveryPersistence.write(recoveryRecord);

    void this.ensureReconnectRoleClaim(
      recoveryRecord.reconnect.controlSessionId,
      "guest",
      recoveryRecord.reconnect.guestSecret,
      instanceId,
      recoveryRecord.roomCode,
      this.guestSetupAbortController?.signal
    ).catch((error: unknown) => {
      if (this.isAbortError(error)) {
        return;
      }

      this.handleReconnectClaimFailure(
        {
          controlSessionId: recoveryRecord.reconnect.controlSessionId,
          role: "guest",
          secret: recoveryRecord.reconnect.guestSecret,
          instanceId: recoveryRecord.reconnect.lastInstanceId ?? "",
          roomCode: recoveryRecord.roomCode,
          timerId: null
        },
        error
      );
    });
  }

  private flushPendingGuestRecoveryControl(): void {
    const pendingControl = this.pendingGuestRecoveryControl;
    const activeSession = this.store.getSnapshot().session;

    if (!pendingControl || !activeSession) {
      return;
    }

    this.pendingGuestRecoveryControl = null;
    this.persistGuestRecoveryControl(activeSession, pendingControl);
  }

  private async ensureHostReconnectControlRegistered(): Promise<void> {
    if (!this.hostTransport?.hasGuestSession()) {
      return;
    }

    if (!this.hostReconnectControl) {
      this.hostReconnectControl = {
        controlSessionId: createRandomId(),
        hostSecret: createRandomId(),
        guestSecret: createRandomId()
      };
    }

    const reconnectControl = this.hostReconnectControl;

    await this.rendezvousClient.registerReconnectControlSession(
      reconnectControl.controlSessionId,
      reconnectControl.hostSecret,
      reconnectControl.guestSecret,
      this.hostSetupAbortController?.signal
    );

    if (!this.hostTransport || this.hostReconnectControl !== reconnectControl) {
      return;
    }

    await this.ensureReconnectRoleClaim(
      reconnectControl.controlSessionId,
      "host",
      reconnectControl.hostSecret,
      createRandomId(),
      this.store.getSnapshot().session?.roomCode ?? null,
      this.hostSetupAbortController?.signal
    );

    this.hostTransport.sendRecoveryControlMessage({
      type: "p2p:recovery",
      payload: {
        controlSessionId: reconnectControl.controlSessionId,
        guestSecret: reconnectControl.guestSecret
      }
    });
    this.persistCurrentHostRecoveryRecord();
  }

  private async performGuestReconnect(
    record: P2PRecoveryGuestRecord,
    peer: WebRTCPeerController
  ): Promise<void> {
    const instanceId = record.reconnect.lastInstanceId;

    if (!instanceId) {
      throw new Error("Direct Match recovery metadata is incomplete. Start a new direct match.");
    }

    try {
      await this.rendezvousClient.claimReconnectRole(
        record.reconnect.controlSessionId,
        "guest",
        record.reconnect.guestSecret,
        instanceId,
        this.guestSetupAbortController?.signal
      );

      this.startReconnectHeartbeat({
        controlSessionId: record.reconnect.controlSessionId,
        role: "guest",
        secret: record.reconnect.guestSecret,
        instanceId,
        roomCode: record.roomCode,
        timerId: null
      });

      const reconnectOffer = await this.rendezvousClient.pollForReconnectOffer(
        record.reconnect.controlSessionId,
        record.reconnect.guestSecret,
        instanceId,
        this.guestSetupAbortController ? { signal: this.guestSetupAbortController.signal } : {}
      );

      if (reconnectOffer.state === "expired" || !reconnectOffer.offer) {
        throw new Error("This direct match can no longer be restored. Start a new direct match.");
      }

      const answer = await peer.createReconnectAnswer(reconnectOffer.offer);

      if (!this.isActivePeer(peer, "guest")) {
        return;
      }

      await this.rendezvousClient.writeReconnectAnswer(
        record.reconnect.controlSessionId,
        record.reconnect.guestSecret,
        instanceId,
        answer,
        this.guestSetupAbortController?.signal
      );

      const finalization = await this.rendezvousClient.pollForReconnectFinalization(
        record.reconnect.controlSessionId,
        record.reconnect.guestSecret,
        instanceId,
        this.guestSetupAbortController ? { signal: this.guestSetupAbortController.signal } : {}
      );

      if (finalization.state === "expired" || finalization.attempt.finalizationOutcome !== "reconnected") {
        throw new Error("This direct match can no longer be restored. Start a new direct match.");
      }
    } catch (error) {
      if (this.isReconnectClaimInactiveError(error)) {
        this.handleReconnectClaimLost({
          controlSessionId: record.reconnect.controlSessionId,
          role: "guest",
          secret: record.reconnect.guestSecret,
          instanceId,
          roomCode: record.roomCode,
          timerId: null
        });
        throw new Error(DIRECT_MATCH_DISPLACED_MESSAGE);
      }

      if (this.isReconnectRecoveryUnavailableError(error)) {
        this.handleReconnectRecoveryUnavailable({
          controlSessionId: record.reconnect.controlSessionId,
          role: "guest",
          secret: record.reconnect.guestSecret,
          instanceId,
          roomCode: record.roomCode,
          timerId: null
        });
        throw new Error(DIRECT_MATCH_RECOVERY_UNAVAILABLE_MESSAGE);
      }

      if (!this.isAbortError(error)) {
        await this.finalizeReconnectAttemptBestEffort(
          record.reconnect.controlSessionId,
          "guest",
          record.reconnect.guestSecret,
          instanceId,
          this.guestSetupAbortController?.signal
        );
      }

      throw error;
    } finally {
      if (this.activePeer === peer && this.activeRole === "guest") {
        this.guestReconnectInFlight = false;
      }
    }
  }

  private async handleHostPeerClosed(peer: WebRTCPeerController): Promise<void> {
    if (!this.isActivePeer(peer, "host")) {
      return;
    }

    if (!this.hostTransport?.hasGuestSession() || !this.hostReconnectControl || this.hostReconnectInFlight) {
      this.setup.controller.setHostStage("closed");
      return;
    }

    this.hostReconnectInFlight = true;
    this.clearHostReconnectRetryTimer();
    this.hostReconnectNeedsGuestRebind = true;
    this.hostReconnectAbortController = new AbortController();

    const nextPeer = this.createPeer();
    const reconnectControl = this.hostReconnectControl;
    const reconnectSignal = this.hostReconnectAbortController.signal;

    this.activePeer = nextPeer;
    this.hostTransport.replacePeer(nextPeer);
    this.subscribeToPeer(nextPeer, "host");

    try {
      await this.runHostReconnectAttempt({
        peer: nextPeer,
        reconnectControl,
        signal: reconnectSignal,
        roomCode: this.store.getSnapshot().session?.roomCode ?? null
      });
    } catch (error) {
      if (!this.isAbortError(error)) {
        this.store.setError(error instanceof Error ? error.message : "Guest reconnect failed.");
        this.scheduleHostReconnectRetry(nextPeer, reconnectControl);
      }
    } finally {
      // safe vs CLAUDE.md hang bug: the awaited runHostReconnectAttempt above has already settled by the time this finally runs — no in-flight poll loop to orphan.
      this.hostReconnectInFlight = false;
      this.hostReconnectAbortController = null;
    }
  }

  private teardownActiveRuntime(): void {
    this.hostSetupAbortController?.abort();
    this.guestSetupAbortController?.abort();
    this.hostReconnectAbortController?.abort();
    this.clearHostReconnectRetryTimer();
    this.hostSetupAbortController = null;
    this.guestSetupAbortController = null;
    this.hostReconnectAbortController = null;
    this.stopReconnectHeartbeat();
    this.pendingGuestDisplayName = null;
    this.hostSessionFinalized = false;
    this.hostReconnectInFlight = false;
    this.hostReconnectNeedsGuestRebind = false;
    this.pendingGuestRecoveryControl = null;
    this.guestReconnectInFlight = false;
    this.hostReconnectControl = null;
    this.hostTransport = null;
    this.activeRole = null;
    this.activePeer = null;
    this.activeController?.dispose();
    this.activeController = null;
  }

  private teardownFailedRuntime(): void {
    this.stopReconnectHeartbeat();
    this.pendingGuestDisplayName = null;
    this.hostSessionFinalized = false;
    this.hostSetupAbortController?.abort();
    this.guestSetupAbortController?.abort();
    this.hostReconnectAbortController?.abort();
    this.hostSetupAbortController = null;
    this.guestSetupAbortController = null;
    this.hostReconnectAbortController = null;
    this.clearHostReconnectRetryTimer();
    this.hostReconnectInFlight = false;
    this.hostReconnectNeedsGuestRebind = false;
    this.pendingGuestRecoveryControl = null;
    this.guestReconnectInFlight = false;
    this.hostTransport = null;
    this.activeRole = null;
    this.activePeer = null;
    this.activeController?.dispose();
    this.activeController = null;
  }

  private getUnavailableGuestSetupMessage(
    sessionState: ReturnType<typeof this.setup.store.getSnapshot>["guest"]["sessionState"],
    expiresAt: number | null
  ): string | null {
    if (expiresAt !== null && expiresAt <= Date.now()) {
      return getGuestDirectJoinUnavailableMessage("expired");
    }

    return getGuestDirectJoinUnavailableMessage(sessionState);
  }

  private shouldBlockHostActionDuringReconnect(): boolean {
    return this.activeRole === "host" && this.hostReconnectInFlight;
  }

  private isActivePeer(peer: WebRTCPeerController, role: "host" | "guest"): boolean {
    return this.activePeer === peer && this.activeRole === role;
  }

  private waitForPeerConnected(peer: WebRTCPeerController, signal?: AbortSignal): Promise<void> {
    if (peer.getStatus() === "connected") {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const abortListener = () => {
        unsubscribe();
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      const unsubscribe = peer.subscribe({
        onStatusChange: (change) => {
          if (change.status === "connected") {
            cleanup();
            resolve();
            return;
          }

          if (change.status === "failed" || change.status === "closed") {
            cleanup();
            reject(new Error(change.error ?? "Direct connection failed."));
          }
        }
      });
      const cleanup = () => {
        unsubscribe();
        signal?.removeEventListener("abort", abortListener);
      };

      signal?.addEventListener("abort", abortListener, { once: true });
    });
  }

  private scheduleHostReconnectRetry(
    peer: WebRTCPeerController,
    reconnectControl: P2PHostReconnectControlState
  ): void {
    this.clearHostReconnectRetryTimer();
    this.hostReconnectRetryTimeoutId = this.scheduler.setTimeout(() => {
      this.hostReconnectRetryTimeoutId = null;

      if (
        this.isActivePeer(peer, "host") &&
        !this.hostReconnectInFlight &&
        this.hostTransport?.hasGuestSession() &&
        this.hostReconnectControl === reconnectControl
      ) {
        void this.handleHostPeerClosed(peer).catch((error: unknown) => {
          if (this.isAbortError(error)) {
            return;
          }
        });
      }
    }, HOST_RECONNECT_RETRY_DELAY_MS);
  }

  private clearHostReconnectRetryTimer(): void {
    if (this.hostReconnectRetryTimeoutId !== null) {
      this.scheduler.clearTimeout(this.hostReconnectRetryTimeoutId);
      this.hostReconnectRetryTimeoutId = null;
    }
  }

  private tryAutoReconnectGuest(): boolean {
    const roomCode = this.store.getSnapshot().session?.roomCode;

    if (!roomCode || this.guestReconnectInFlight) {
      return false;
    }

    const record = this.recoveryPersistence.read(roomCode);

    if (!record || record.role !== "guest") {
      return false;
    }

    this.reconnect(roomCode);
    return true;
  }

  private restoreHostStore(snapshot: P2PHostAuthoritySnapshot): void {
    if (!snapshot.room || !snapshot.hostSession) {
      throw new Error("Invalid host recovery snapshot.");
    }

    this.store.setSession({
      roomId: snapshot.hostSession.roomId,
      roomCode: snapshot.hostSession.roomCode,
      playerId: snapshot.hostSession.playerId,
      displayName: snapshot.hostSession.displayName,
      sessionToken: snapshot.hostSession.sessionToken,
      ...(snapshot.room.inviteToken ? { inviteToken: snapshot.room.inviteToken } : {}),
      players: snapshot.room.players.map((player) => ({ ...player }))
    });
    this.store.setChatMessages(snapshot.chatMessages.map((message) => ({ ...message })));
    this.store.setMatch(snapshot.match ? toMatchStateDto(snapshot.match) : null);
    this.store.setBombArmed(false);
    this.store.setChatError(null);
    this.store.setChatPendingText(null);
    this.store.setError(null);
  }

  private persistCurrentHostRecoveryRecord(): void {
    if (this.activeRole !== "host" || !this.hostTransport || !this.hostReconnectControl) {
      return;
    }

    try {
      const snapshot = this.hostTransport.getAuthoritySnapshot();
      const roomCode = snapshot.room?.roomCode ?? null;

      if (!roomCode) {
        return;
      }

      if (!snapshot.guestSession || !this.hostTransport.hasGuestSession()) {
        this.clearHostRecoveryRecord(roomCode);
        return;
      }

      this.recoveryPersistence.write(
        createHostRecoveryRecord({
          state: snapshot,
          reconnect: {
            controlSessionId: this.hostReconnectControl.controlSessionId,
            hostSecret: this.hostReconnectControl.hostSecret,
            guestSecret: this.hostReconnectControl.guestSecret,
            ...(this.hostReconnectControl.lastInstanceId
              ? { lastInstanceId: this.hostReconnectControl.lastInstanceId }
              : {})
          }
        })
      );
    } catch {
      const roomCode = this.store.getSnapshot().session?.roomCode ?? null;

      if (roomCode) {
        this.clearHostRecoveryRecord(roomCode);
      }
    }
  }

  private clearHostRecoveryRecord(roomCode: string): void {
    const record = this.recoveryPersistence.read(roomCode);

    if (record?.role === "host") {
      this.recoveryPersistence.remove(roomCode);
    }
  }

  private clearRecoveryForActiveRuntime(): void {
    const roomCode = this.store.getSnapshot().session?.roomCode ?? null;

    if (!roomCode) {
      return;
    }

    if (this.activeRole === "host") {
      this.clearHostRecoveryRecord(roomCode);
      return;
    }

    if (this.activeRole === "guest") {
      const record = this.recoveryPersistence.read(roomCode);

      if (record?.role === "guest") {
        this.recoveryPersistence.remove(roomCode);
      }
    }
  }

  private async runHostReconnectAttempt({
    peer,
    reconnectControl,
    signal,
    roomCode
  }: {
    peer: WebRTCPeerController;
    reconnectControl: P2PHostReconnectControlState;
    signal: AbortSignal;
    roomCode: string | null;
  }): Promise<void> {
    const instanceId = createRandomId();

    reconnectControl.lastInstanceId = instanceId;
    this.persistCurrentHostRecoveryRecord();

    try {
      await this.rendezvousClient.claimReconnectRole(
        reconnectControl.controlSessionId,
        "host",
        reconnectControl.hostSecret,
        instanceId,
        signal
      );

      this.startReconnectHeartbeat({
        controlSessionId: reconnectControl.controlSessionId,
        role: "host",
        secret: reconnectControl.hostSecret,
        instanceId,
        roomCode,
        timerId: null
      });

      const offer = await peer.createReconnectOffer();

      await this.rendezvousClient.writeReconnectOffer(
        reconnectControl.controlSessionId,
        reconnectControl.hostSecret,
        instanceId,
        offer,
        signal
      );

      const answerResponse = await this.rendezvousClient.pollForReconnectAnswer(
        reconnectControl.controlSessionId,
        reconnectControl.hostSecret,
        instanceId,
        { signal }
      );

      if (answerResponse.state === "expired" || !answerResponse.answer) {
        throw new Error("Guest reconnect expired before the direct match could recover.");
      }

      await peer.applyReconnectAnswer(answerResponse.answer);
      await this.waitForPeerConnected(peer, signal);

      await this.rendezvousClient.finalizeReconnectAttempt(
        reconnectControl.controlSessionId,
        "host",
        reconnectControl.hostSecret,
        instanceId,
        "reconnected",
        signal
      );
      this.setup.controller.setHostStage("connected");
    } catch (error) {
      if (this.isReconnectClaimInactiveError(error)) {
        this.handleReconnectClaimLost({
          controlSessionId: reconnectControl.controlSessionId,
          role: "host",
          secret: reconnectControl.hostSecret,
          instanceId,
          roomCode,
          timerId: null
        });
        throw new Error(DIRECT_MATCH_DISPLACED_MESSAGE);
      }

      if (this.isReconnectRecoveryUnavailableError(error)) {
        this.handleReconnectRecoveryUnavailable({
          controlSessionId: reconnectControl.controlSessionId,
          role: "host",
          secret: reconnectControl.hostSecret,
          instanceId,
          roomCode,
          timerId: null
        });
        throw new Error(DIRECT_MATCH_RECOVERY_UNAVAILABLE_MESSAGE);
      }

      if (!this.isAbortError(error)) {
        await this.finalizeReconnectAttemptBestEffort(
          reconnectControl.controlSessionId,
          "host",
          reconnectControl.hostSecret,
          instanceId,
          signal
        );
      }

      throw error;
    }
  }

  private async ensureReconnectRoleClaim(
    controlSessionId: string,
    role: "host" | "guest",
    secret: string,
    instanceId: string,
    roomCode: string | null,
    signal?: AbortSignal
  ): Promise<void> {
    const existingClaim = this.activeReconnectClaim;

    if (
      existingClaim &&
      existingClaim.controlSessionId === controlSessionId &&
      existingClaim.role === role &&
      existingClaim.secret === secret &&
      existingClaim.instanceId === instanceId
    ) {
      return;
    }

    await this.rendezvousClient.claimReconnectRole(controlSessionId, role, secret, instanceId, signal);
    this.startReconnectHeartbeat({
      controlSessionId,
      role,
      secret,
      instanceId,
      roomCode,
      timerId: null
    });
  }

  private startReconnectHeartbeat(claim: ActiveReconnectClaimState): void {
    const existingClaim = this.activeReconnectClaim;

    if (
      existingClaim &&
      existingClaim.controlSessionId === claim.controlSessionId &&
      existingClaim.role === claim.role &&
      existingClaim.secret === claim.secret &&
      existingClaim.instanceId === claim.instanceId
    ) {
      return;
    }

    const wasDisplaced = existingClaim !== null && this.lastClaimWasVictory === false;
    const isNewClaim = existingClaim === null || existingClaim.controlSessionId !== claim.controlSessionId;

    this.stopReconnectHeartbeat();
    this.activeReconnectClaim = claim;
    this.lastClaimWasVictory = true;

    if (wasDisplaced || (isNewClaim && existingClaim !== null)) {
      const message = claim.role === "host" ? DIRECT_MATCH_AUTHORITATIVE_MESSAGE : DIRECT_MATCH_CLAIM_ACTIVE_MESSAGE;
      this.store.setError(message);
    }

    this.scheduleReconnectHeartbeat(claim);
  }

  private scheduleReconnectHeartbeat(claim: ActiveReconnectClaimState): void {
    if (this.activeReconnectClaim !== claim) {
      return;
    }

    claim.timerId = this.scheduler.setTimeout(() => {
      claim.timerId = null;
      void this.runReconnectHeartbeat(claim);
    }, RECONNECT_HEARTBEAT_INTERVAL_MS);
  }

  private async runReconnectHeartbeat(claim: ActiveReconnectClaimState): Promise<void> {
    if (this.activeReconnectClaim !== claim) {
      return;
    }

    try {
      const response = await this.rendezvousClient.heartbeatReconnectRole(
        claim.controlSessionId,
        claim.role,
        claim.secret,
        claim.instanceId
      );

      if (this.activeReconnectClaim !== claim) {
        return;
      }

      const activeRole = response[claim.role];

      if (activeRole.claimStatus !== "claimed" || activeRole.instanceId !== claim.instanceId) {
        this.handleReconnectClaimLost(claim);
        return;
      }

      this.scheduleReconnectHeartbeat(claim);
    } catch (error) {
      if (this.activeReconnectClaim !== claim || this.isAbortError(error)) {
        return;
      }

      this.handleReconnectClaimFailure(claim, error);
    }
  }

  private handleReconnectClaimFailure(claim: ActiveReconnectClaimState, error: unknown): void {
    if (this.isReconnectClaimInactiveError(error)) {
      this.handleReconnectClaimLost(claim);
      return;
    }

    if (this.isReconnectRecoveryUnavailableError(error)) {
      this.handleReconnectRecoveryUnavailable(claim);
      return;
    }

    this.scheduleReconnectHeartbeat(claim);
  }

  private handleReconnectClaimLost(claim: ActiveReconnectClaimState): void {
    this.stopReconnectHeartbeat();
    this.lastClaimWasVictory = false;

    if (claim.role === "host" && this.hostReconnectControl?.controlSessionId === claim.controlSessionId) {
      this.hostReconnectControl = null;
    }

    this.deactivateCurrentRuntimeForReconnectClaim(claim);

    this.store.setError(DIRECT_MATCH_DISPLACED_MESSAGE);
  }

  private handleReconnectRecoveryUnavailable(claim: ActiveReconnectClaimState): void {
    this.stopReconnectHeartbeat();
    this.lastClaimWasVictory = false;

    if (claim.role === "host" && this.hostReconnectControl?.controlSessionId === claim.controlSessionId) {
      this.hostReconnectControl = null;
    }

    if (claim.roomCode) {
      this.clearAllRecoveryRecords(claim.roomCode);
    }

    this.deactivateCurrentRuntimeForReconnectClaim(claim);

    this.store.setError(DIRECT_MATCH_RECOVERY_UNAVAILABLE_MESSAGE);
  }

  private clearAllRecoveryRecords(roomCode: string): void {
    this.recoveryPersistence.remove(roomCode);
  }

  private deactivateCurrentRuntimeForReconnectClaim(claim: ActiveReconnectClaimState): void {
    if (this.activeRole !== claim.role) {
      return;
    }

    const activeRoomCode = this.store.getSnapshot().session?.roomCode ?? null;

    if (claim.roomCode && activeRoomCode && claim.roomCode !== activeRoomCode) {
      return;
    }

    this.teardownFailedRuntime();
    this.setup.controller.resetHost();
    this.setup.controller.resetGuest();
    this.store.setSession(null);
    this.store.clearTransientRoomState();
    this.store.setConnectionStatus("disconnected");
  }

  private stopReconnectHeartbeat(): void {
    const activeReconnectClaim = this.activeReconnectClaim;

    if (activeReconnectClaim && activeReconnectClaim.timerId !== null) {
      this.scheduler.clearTimeout(activeReconnectClaim.timerId);
    }

    this.activeReconnectClaim = null;
  }

  private async finalizeReconnectAttemptBestEffort(
    sessionId: string,
    role: "host" | "guest",
    secret: string,
    instanceId: string,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      await this.rendezvousClient.finalizeReconnectAttempt(
        sessionId,
        role,
        secret,
        instanceId,
        "aborted",
        signal
      );
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }
    }
  }

  private isAbortError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
  }

  private isReconnectClaimInactiveError(error: unknown): boolean {
    return error instanceof P2PRendezvousRequestError && error.status === 403;
  }

  private isReconnectRecoveryUnavailableError(error: unknown): boolean {
    return error instanceof P2PRendezvousRequestError && (error.status === 404 || error.status === 410);
  }
}

export const createP2PGameClientRuntime = (
  options: CreateP2PGameClientRuntimeOptions = {}
): GameClientRuntime => {
  const store = new GameClientStore();
  const controller = new P2PBootstrapController(
    store,
    options.createPeer ??
      (() =>
        new WebRTCPeer({
          rtcConfiguration: P2P_STUN_URLS.length
            ? {
                iceServers: [{ urls: P2P_STUN_URLS }]
              }
            : {}
        })),
    options.scheduler ?? createBrowserGameClientScheduler(),
    options.rendezvousClient ?? createP2PRendezvousClient(),
    options.recoveryPersistence ?? createBrowserP2PRecoveryPersistence()
  );

  return {
    controller,
    store,
    p2p: {
      subscribe: controller.setup.store.subscribe,
      getSnapshot: controller.setup.store.getSnapshot,
      controller: {
        openGuestSetupSession: controller.openGuestSetupSession,
        openGuestSetupFromFragment: controller.openGuestSetupFromFragment,
        createGuestAnswer: controller.createGuestAnswer,
        setHostGuestAnswerText: controller.setHostGuestAnswerText,
        applyHostGuestAnswer: controller.applyHostGuestAnswer,
        clearHostSetupError: controller.clearHostSetupError,
        clearGuestSetupError: controller.clearGuestSetupError
      }
    }
  };
};
