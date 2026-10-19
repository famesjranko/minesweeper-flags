import {
  GameClientController,
  type GameClientScheduler
} from "../../app/providers/game-client.controller.js";
import type { GameClientStore } from "../../app/providers/game-client.store.js";
import type { SessionPersistence } from "../../lib/socket/session-storage.js";
import type { createP2PSetupController } from "../setup/p2p-setup.controller.js";
import type { P2PRendezvousClient } from "../signaling/p2p-rendezvous-client.js";
import {
  createHostRecoveryRecord,
  type P2PRecoveryPersistence
} from "../storage/p2p-recovery-storage.js";
import type { WebRTCPeerController } from "../transport/webrtc-peer.types.js";
import type { P2PHostGameClientTransport } from "./p2p-host-game-client.transport.js";
import {
  type ActiveReconnectClaimState,
  ReconnectClaimHeartbeat,
  toReconnectCaller
} from "./p2p-reconnect-claim.js";
import {
  DIRECT_MATCH_DISPLACED_MESSAGE,
  DIRECT_MATCH_RECOVERY_UNAVAILABLE_MESSAGE,
  isAbortError,
  isReconnectClaimInactiveError,
  isReconnectRecoveryUnavailableError
} from "./p2p-runtime-errors.js";

const noopSessionPersistence: SessionPersistence = {
  read: () => null,
  write: () => {},
  remove: () => {}
};

export type RendezvousClient = Pick<
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

export type P2PSetup = ReturnType<typeof createP2PSetupController>;

export interface P2PRuntimeDependencies {
  store: GameClientStore;
  setup: P2PSetup;
  createPeer: () => WebRTCPeerController;
  scheduler: GameClientScheduler;
  rendezvousClient: RendezvousClient;
  recoveryPersistence: P2PRecoveryPersistence;
}

export interface P2PHostReconnectControlState {
  controlSessionId: string;
  hostSecret: string;
  guestSecret: string;
  lastInstanceId?: string;
}

export interface PendingGuestRecoveryControlRecord {
  controlSessionId: string;
  guestSecret: string;
}

// The mutable state of the one active P2P runtime, shared by the host and guest flows.
// Teardown lives here so every flow resets the same fields in the same abort order.
export class P2PRuntimeContext {
  readonly store: GameClientStore;
  readonly setup: P2PSetup;
  readonly createPeer: () => WebRTCPeerController;
  readonly scheduler: GameClientScheduler;
  readonly rendezvousClient: RendezvousClient;
  readonly recoveryPersistence: P2PRecoveryPersistence;
  readonly claims: ReconnectClaimHeartbeat;

  activeController: GameClientController | null = null;
  activePeer: WebRTCPeerController | null = null;
  activeRole: "host" | "guest" | null = null;
  hostTransport: P2PHostGameClientTransport | null = null;
  pendingGuestDisplayName: string | null = null;
  hostSessionFinalized = false;
  hostSetupAbortController: AbortController | null = null;
  guestSetupAbortController: AbortController | null = null;
  hostReconnectAbortController: AbortController | null = null;
  hostReconnectRetryTimeoutId: number | null = null;
  hostReconnectControl: P2PHostReconnectControlState | null = null;
  hostReconnectInFlight = false;
  hostReconnectNeedsGuestRebind = false;
  pendingGuestRecoveryControl: PendingGuestRecoveryControlRecord | null = null;
  guestReconnectInFlight = false;

  constructor(dependencies: P2PRuntimeDependencies) {
    this.store = dependencies.store;
    this.setup = dependencies.setup;
    this.createPeer = dependencies.createPeer;
    this.scheduler = dependencies.scheduler;
    this.rendezvousClient = dependencies.rendezvousClient;
    this.recoveryPersistence = dependencies.recoveryPersistence;
    this.claims = new ReconnectClaimHeartbeat({
      rendezvousClient: dependencies.rendezvousClient,
      scheduler: dependencies.scheduler,
      setError: (message) => this.store.setError(message),
      onClaimLost: (claim) => this.handleReconnectClaimLost(claim),
      onRecoveryUnavailable: (claim) => this.handleReconnectRecoveryUnavailable(claim)
    });
  }

  isActivePeer(peer: WebRTCPeerController, role: "host" | "guest"): boolean {
    return this.activePeer === peer && this.activeRole === role;
  }

  createGameController(
    transport: ConstructorParameters<typeof GameClientController>[0]["transport"],
    persistence: SessionPersistence = noopSessionPersistence
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

  teardownActiveRuntime(): void {
    this.teardownRuntime();
    this.hostReconnectControl = null;
  }

  // Unlike teardownActiveRuntime, this leaves hostReconnectControl in place.
  teardownFailedRuntime(): void {
    this.teardownRuntime();
  }

  // Abort every in-flight loop before the claim heartbeat stops, and abort each controller
  // before it is nulled, so no waiter outlives the state it reads.
  private teardownRuntime(): void {
    this.hostSetupAbortController?.abort();
    this.guestSetupAbortController?.abort();
    this.hostReconnectAbortController?.abort();
    this.clearHostReconnectRetryTimer();
    this.hostSetupAbortController = null;
    this.guestSetupAbortController = null;
    this.hostReconnectAbortController = null;
    this.claims.stop();
    this.pendingGuestDisplayName = null;
    this.hostSessionFinalized = false;
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

  clearHostReconnectRetryTimer(): void {
    if (this.hostReconnectRetryTimeoutId !== null) {
      this.scheduler.clearTimeout(this.hostReconnectRetryTimeoutId);
      this.hostReconnectRetryTimeoutId = null;
    }
  }

  // Handles the claim errors of a failed reconnect attempt. Returns the error the attempt
  // must throw instead, or null when the caller still owns the claim and must finalize.
  handleReconnectAttemptClaimError(claim: ActiveReconnectClaimState, error: unknown): Error | null {
    if (isReconnectClaimInactiveError(error)) {
      this.handleReconnectClaimLost(claim);
      return new Error(DIRECT_MATCH_DISPLACED_MESSAGE);
    }

    if (isReconnectRecoveryUnavailableError(error)) {
      this.handleReconnectRecoveryUnavailable(claim);
      return new Error(DIRECT_MATCH_RECOVERY_UNAVAILABLE_MESSAGE);
    }

    return null;
  }

  async finalizeReconnectAttemptBestEffort(
    claim: ActiveReconnectClaimState,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      await this.rendezvousClient.finalizeReconnectAttempt(
        toReconnectCaller(claim),
        "aborted",
        signal
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
    }
  }

  persistCurrentHostRecoveryRecord(): void {
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

  clearRecoveryForActiveRuntime(): void {
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

  private clearHostRecoveryRecord(roomCode: string): void {
    const record = this.recoveryPersistence.read(roomCode);

    if (record?.role === "host") {
      this.recoveryPersistence.remove(roomCode);
    }
  }

  private handleReconnectClaimLost(claim: ActiveReconnectClaimState): void {
    this.claims.release();
    this.forgetHostReconnectControl(claim);
    this.deactivateCurrentRuntimeForReconnectClaim(claim);

    this.store.setError(DIRECT_MATCH_DISPLACED_MESSAGE);
  }

  private handleReconnectRecoveryUnavailable(claim: ActiveReconnectClaimState): void {
    this.claims.release();
    this.forgetHostReconnectControl(claim);

    if (claim.roomCode) {
      this.recoveryPersistence.remove(claim.roomCode);
    }

    this.deactivateCurrentRuntimeForReconnectClaim(claim);

    this.store.setError(DIRECT_MATCH_RECOVERY_UNAVAILABLE_MESSAGE);
  }

  private forgetHostReconnectControl(claim: ActiveReconnectClaimState): void {
    if (
      claim.role === "host" &&
      this.hostReconnectControl?.controlSessionId === claim.controlSessionId
    ) {
      this.hostReconnectControl = null;
    }
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
}
