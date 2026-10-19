import type { GameClientController } from "../../app/providers/game-client.controller.js";
import type { GameClientStore } from "../../app/providers/game-client.store.js";
import type { SessionPersistence, StoredSession } from "../../lib/socket/session-storage.js";
import { createRandomId } from "../random-id.js";
import { decodeP2PRecoveryControlMessage } from "../recovery/p2p-recovery-control.js";
import { getGuestDirectJoinUnavailableMessage } from "../setup/p2p-setup.controller.js";
import type { P2PSetupSnapshot } from "../setup/p2p-setup.types.js";
import {
  P2P_RECOVERY_STORAGE_VERSION,
  type P2PRecoveryGuestRecord,
  type P2PRecoveryPersistence
} from "../storage/p2p-recovery-storage.js";
import { WebRTCGameClientTransport } from "../transport/webrtc-game-client.transport.js";
import type { WebRTCPeerController } from "../transport/webrtc-peer.types.js";
import { type ActiveReconnectClaimState, toReconnectCaller } from "./p2p-reconnect-claim.js";
import type {
  P2PRuntimeContext,
  PendingGuestRecoveryControlRecord
} from "./p2p-runtime-context.js";
import { isAbortError } from "./p2p-runtime-errors.js";

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

const getUnavailableGuestSetupMessage = (
  sessionState: P2PSetupSnapshot["guest"]["sessionState"],
  expiresAt: number | null
): string | null => {
  if (expiresAt !== null && expiresAt <= Date.now()) {
    return getGuestDirectJoinUnavailableMessage("expired");
  }

  return getGuestDirectJoinUnavailableMessage(sessionState);
};

type ActiveSession = NonNullable<ReturnType<GameClientStore["getSnapshot"]>["session"]>;

// The guest side of a direct match: answering the host's offer through signaling, storing
// the recovery control the host sends, and reconnecting into the host after a drop.
export class P2PGuestRuntime {
  constructor(
    private readonly context: P2PRuntimeContext,
    private readonly reconnect: (roomCode: string) => void
  ) {}

  openSetupSession(sessionId: string): void {
    const context = this.context;
    const trimmedSessionId = sessionId.trim();

    if (!trimmedSessionId) {
      context.setup.controller.failGuestSetup("This direct-match link could not be read.");
      return;
    }

    context.store.setError(null);
    context.clearRecoveryForActiveRuntime();
    context.store.setSession(null);
    context.store.clearTransientRoomState();
    context.teardownActiveRuntime();
    context.setup.controller.resetHost();
    context.guestSetupAbortController = new AbortController();
    context.setup.controller.startGuestSessionLoad(trimmedSessionId);

    void context.rendezvousClient
      .getSession(trimmedSessionId, context.guestSetupAbortController.signal)
      .then((fetchedSession) => {
        context.setup.controller.completeGuestSessionLoad({
          sessionId: fetchedSession.sessionId,
          offerPayload: fetchedSession.offer,
          expiresAt: fetchedSession.expiresAt,
          sessionState: fetchedSession.state
        });
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        context.setup.controller.failGuestSetup(
          error instanceof Error ? error.message : "This direct-match link could not be loaded."
        );
      });
  }

  createAnswer(displayName: string): void {
    const context = this.context;
    const trimmedDisplayName = displayName.trim();
    const guestSetup = context.setup.store.getSnapshot().guest;
    const sessionId = guestSetup.sessionId;

    if (!trimmedDisplayName || !guestSetup.offerPayload || !sessionId) {
      return;
    }

    const unavailableMessage = getUnavailableGuestSetupMessage(
      guestSetup.sessionState,
      guestSetup.expiresAt
    );

    if (unavailableMessage) {
      context.setup.controller.failGuestSetup(unavailableMessage);
      return;
    }

    context.store.setError(null);
    context.clearRecoveryForActiveRuntime();
    context.store.setSession(null);
    context.store.clearTransientRoomState();
    context.teardownActiveRuntime();
    context.guestSetupAbortController = new AbortController();
    let guestPeer: WebRTCPeerController | null = null;

    void context.rendezvousClient
      .getSession(sessionId, context.guestSetupAbortController.signal)
      .then(async (refreshedSession) => {
        const refreshedUnavailableMessage = getUnavailableGuestSetupMessage(
          refreshedSession.state,
          refreshedSession.expiresAt
        );

        context.setup.controller.completeGuestSessionLoad({
          sessionId: refreshedSession.sessionId,
          offerPayload: refreshedSession.offer,
          expiresAt: refreshedSession.expiresAt,
          sessionState: refreshedSession.state
        });

        if (refreshedUnavailableMessage) {
          context.setup.controller.failGuestSetup(refreshedUnavailableMessage);
          return;
        }

        guestPeer = this.startGuestPeer().peer;
        context.setup.controller.startGuestAnswerCreation(trimmedDisplayName);

        const createdAnswerPayload = await guestPeer.createGuestAnswer(
          refreshedSession.offer,
          trimmedDisplayName
        );

        if (!context.isActivePeer(guestPeer, "guest")) {
          return;
        }

        context.setup.controller.completeGuestAnswerCreation({
          displayName: trimmedDisplayName,
          answerPayload: createdAnswerPayload
        });

        const submittedAnswer = await context.rendezvousClient.submitAnswer(
          sessionId,
          createdAnswerPayload,
          context.guestSetupAbortController?.signal
        );

        if (!context.isActivePeer(guestPeer, "guest")) {
          return;
        }

        context.setup.controller.completeGuestAnswerSubmission(submittedAnswer.state);

        const finalizedSession = await context.rendezvousClient.pollForFinalization(
          sessionId,
          context.guestSetupAbortController
            ? { signal: context.guestSetupAbortController.signal }
            : {}
        );

        if (!context.isActivePeer(guestPeer, "guest")) {
          return;
        }

        context.setup.controller.setGuestSessionState(finalizedSession.state);

        if (finalizedSession.state === "expired") {
          throw new Error(
            "This direct-match link expired before the host finished setup. Start a new direct match."
          );
        }

        if (context.activePeer?.getStatus() !== "connected") {
          context.setup.controller.setGuestStage("connecting");
        }
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        if (guestPeer && !context.isActivePeer(guestPeer, "guest")) {
          return;
        }

        context.setup.controller.failGuestSetup(
          error instanceof Error ? error.message : "Failed to join the direct match."
        );
      });
  }

  startReconnect(record: P2PRecoveryGuestRecord): void {
    const context = this.context;

    context.guestReconnectInFlight = true;

    context.guestSetupAbortController = new AbortController();
    record.reconnect.lastInstanceId = createRandomId();
    context.recoveryPersistence.write(record);

    const { peer: guestPeer, controller } = this.startGuestPeer(
      createGuestRecoverySessionPersistence(record, context.recoveryPersistence)
    );

    controller.reconnect(record.roomCode);

    void this.performReconnect(record, guestPeer).catch((error: unknown) => {
      if (!context.isActivePeer(guestPeer, "guest") || isAbortError(error)) {
        return;
      }

      context.teardownFailedRuntime();
      context.store.setError(
        error instanceof Error ? error.message : "Failed to restore the direct match."
      );
    });
  }

  // The host can send recovery control before the guest has a session; it waits here.
  flushPendingRecoveryControl(): void {
    const context = this.context;
    const pendingControl = context.pendingGuestRecoveryControl;
    const activeSession = context.store.getSnapshot().session;

    if (!pendingControl || !activeSession) {
      return;
    }

    context.pendingGuestRecoveryControl = null;
    this.persistRecoveryControl(activeSession, pendingControl);
  }

  private startGuestPeer(persistence?: SessionPersistence): {
    peer: WebRTCPeerController;
    controller: GameClientController;
  } {
    const context = this.context;
    const peer = context.createPeer();
    const controller = context.createGameController(
      new WebRTCGameClientTransport(peer, {
        interceptMessage: this.handlePeerMessage
      }),
      persistence
    );

    context.activePeer = peer;
    context.activeRole = "guest";
    context.activeController = controller;
    this.subscribeToPeer(peer);
    controller.start();

    return { peer, controller };
  }

  private subscribeToPeer(peer: WebRTCPeerController): void {
    peer.subscribe({
      onStatusChange: (change) => {
        if (!this.context.isActivePeer(peer, "guest")) {
          return;
        }

        if (change.status === "connected") {
          this.context.setup.controller.setGuestStage("connected");
          return;
        }

        if (change.status === "failed") {
          if (this.tryAutoReconnect()) {
            return;
          }

          this.context.setup.controller.failGuestSetup(change.error ?? "Direct connection failed.");
          return;
        }

        if (change.status === "closed") {
          if (this.tryAutoReconnect()) {
            return;
          }

          this.context.setup.controller.setGuestStage("closed");
        }
      }
    });
  }

  private tryAutoReconnect(): boolean {
    const roomCode = this.context.store.getSnapshot().session?.roomCode;

    if (!roomCode || this.context.guestReconnectInFlight) {
      return false;
    }

    const record = this.context.recoveryPersistence.read(roomCode);

    if (record?.role !== "guest") {
      return false;
    }

    this.reconnect(roomCode);
    return true;
  }

  private readonly handlePeerMessage = (message: string): boolean => {
    const controlMessage = decodeP2PRecoveryControlMessage(message);

    if (!controlMessage) {
      return false;
    }

    const activeSession = this.context.store.getSnapshot().session;

    if (!activeSession) {
      this.context.pendingGuestRecoveryControl = {
        controlSessionId: controlMessage.payload.controlSessionId,
        guestSecret: controlMessage.payload.guestSecret
      };
      return true;
    }

    this.persistRecoveryControl(activeSession, controlMessage.payload);
    return true;
  };

  private persistRecoveryControl(
    activeSession: ActiveSession,
    control: PendingGuestRecoveryControlRecord
  ): void {
    const context = this.context;
    const existingRecord = context.recoveryPersistence.read(activeSession.roomCode);
    const instanceId =
      existingRecord?.role === "guest" &&
      existingRecord.reconnect.controlSessionId === control.controlSessionId
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

    context.recoveryPersistence.write(recoveryRecord);

    void context.claims
      .ensure(
        {
          controlSessionId: recoveryRecord.reconnect.controlSessionId,
          role: "guest",
          secret: recoveryRecord.reconnect.guestSecret,
          instanceId,
          roomCode: recoveryRecord.roomCode,
          timerId: null
        },
        context.guestSetupAbortController?.signal
      )
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        context.claims.handleFailure(
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

  private async performReconnect(
    record: P2PRecoveryGuestRecord,
    peer: WebRTCPeerController
  ): Promise<void> {
    const context = this.context;
    const instanceId = record.reconnect.lastInstanceId;

    if (!instanceId) {
      throw new Error("Direct Match recovery metadata is incomplete. Start a new direct match.");
    }

    const { controlSessionId, guestSecret } = record.reconnect;
    const claimFor = (): ActiveReconnectClaimState => ({
      controlSessionId,
      role: "guest",
      secret: guestSecret,
      instanceId,
      roomCode: record.roomCode,
      timerId: null
    });
    const caller = toReconnectCaller(claimFor());
    const pollOptions = () =>
      context.guestSetupAbortController ? { signal: context.guestSetupAbortController.signal } : {};

    try {
      await context.rendezvousClient.claimReconnectRole(
        caller,
        context.guestSetupAbortController?.signal
      );

      context.claims.start(claimFor());

      const reconnectOffer = await context.rendezvousClient.pollForReconnectOffer(
        caller,
        pollOptions()
      );

      if (reconnectOffer.state === "expired" || !reconnectOffer.offer) {
        throw new Error("This direct match can no longer be restored. Start a new direct match.");
      }

      const answer = await peer.createReconnectAnswer(reconnectOffer.offer);

      if (!context.isActivePeer(peer, "guest")) {
        return;
      }

      await context.rendezvousClient.writeReconnectAnswer(
        caller,
        answer,
        context.guestSetupAbortController?.signal
      );

      const finalization = await context.rendezvousClient.pollForReconnectFinalization(
        caller,
        pollOptions()
      );

      if (
        finalization.state === "expired" ||
        finalization.attempt.finalizationOutcome !== "reconnected"
      ) {
        throw new Error("This direct match can no longer be restored. Start a new direct match.");
      }
    } catch (error) {
      const claimError = context.handleReconnectAttemptClaimError(claimFor(), error);

      if (claimError) {
        throw claimError;
      }

      if (!isAbortError(error)) {
        await context.finalizeReconnectAttemptBestEffort(
          claimFor(),
          context.guestSetupAbortController?.signal
        );
      }

      throw error;
    } finally {
      if (context.activePeer === peer && context.activeRole === "guest") {
        context.guestReconnectInFlight = false;
      }
    }
  }
}
