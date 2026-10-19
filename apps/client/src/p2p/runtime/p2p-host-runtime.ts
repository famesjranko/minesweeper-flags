import type { GuestAnswerPayload, HostOfferPayload } from "@minesweeper-flags/shared";
import { toMatchStateDto } from "@minesweeper-flags/shared";
import { P2PHostOrchestrator } from "../host/p2p-host-orchestrator.js";
import type { P2PHostAuthoritySnapshot } from "../host/p2p-host-state.js";
import { createRandomId } from "../random-id.js";
import { decodeGuestAnswerPayload } from "../signaling/p2p-signaling.codec.js";
import { createP2PJoinUrl } from "../signaling/p2p-signaling-url.js";
import {
  extractHostRecoveryState,
  type P2PRecoveryHostRecord
} from "../storage/p2p-recovery-storage.js";
import { waitForPeerConnected } from "../transport/wait-for-peer-connected.js";
import type {
  WebRTCPeerController,
  WebRTCPeerStatusChange
} from "../transport/webrtc-peer.types.js";
import { P2PHostGameClientTransport } from "./p2p-host-game-client.transport.js";
import type { ActiveReconnectClaimState } from "./p2p-reconnect-claim.js";
import type { P2PHostReconnectControlState, P2PRuntimeContext } from "./p2p-runtime-context.js";
import { isAbortError } from "./p2p-runtime-errors.js";

const HOST_RECONNECT_RETRY_DELAY_MS = 1_000;

// The host side of a direct match: offer setup through signaling, then reconnecting the
// guest into this browser, which stays the gameplay authority.
export class P2PHostRuntime {
  constructor(private readonly context: P2PRuntimeContext) {}

  startSetup(displayName: string): void {
    const context = this.context;

    context.hostSetupAbortController = new AbortController();
    context.hostSessionFinalized = false;

    const peer = context.createPeer();
    const hostTransport = new P2PHostGameClientTransport(new P2PHostOrchestrator(), peer);
    const controller = context.createGameController(hostTransport);

    context.activePeer = peer;
    context.activeRole = "host";
    context.hostTransport = hostTransport;
    context.activeController = controller;
    this.subscribeToPeer(peer);
    controller.start();
    context.setup.controller.startHostOfferCreation(displayName);
    controller.createRoom(displayName);

    void peer
      .createHostOffer()
      .then((offerPayload) => this.publishOfferAndAwaitGuest(peer, displayName, offerPayload))
      .catch((error: unknown) => {
        if (!context.isActivePeer(peer, "host") || isAbortError(error)) {
          return;
        }

        context.teardownFailedRuntime();

        context.setup.controller.failHostSetup(
          error instanceof Error ? error.message : "Failed to create the direct-match offer."
        );
      });
  }

  startReconnect(record: P2PRecoveryHostRecord): void {
    const context = this.context;

    if (!record.reconnect.guestSecret) {
      context.recoveryPersistence.remove(record.room.roomCode);
      context.store.setError(
        "This direct match can no longer be restored. Start a new direct match."
      );
      return;
    }

    const authoritySnapshot = extractHostRecoveryState(record);
    const orchestrator = new P2PHostOrchestrator();

    orchestrator.hydrate(authoritySnapshot);

    const hostPeer = context.createPeer();
    const hostTransport = new P2PHostGameClientTransport(orchestrator, hostPeer);
    const controller = context.createGameController(hostTransport);

    context.activePeer = hostPeer;
    context.activeRole = "host";
    context.hostTransport = hostTransport;
    const reconnectControl: P2PHostReconnectControlState = {
      controlSessionId: record.reconnect.controlSessionId,
      hostSecret: record.reconnect.hostSecret,
      guestSecret: record.reconnect.guestSecret,
      ...(record.reconnect.lastInstanceId
        ? { lastInstanceId: record.reconnect.lastInstanceId }
        : {})
    };
    context.hostReconnectControl = reconnectControl;
    context.hostReconnectNeedsGuestRebind = true;
    context.hostReconnectInFlight = true;
    context.clearHostReconnectRetryTimer();
    context.activeController = controller;
    this.subscribeToPeer(hostPeer);
    controller.start();
    this.restoreHostStore(authoritySnapshot);
    context.setup.controller.setHostStage("connecting");

    context.hostReconnectAbortController = new AbortController();
    const reconnectSignal = context.hostReconnectAbortController.signal;

    void this.runReconnectAttempt({
      peer: hostPeer,
      reconnectControl,
      signal: reconnectSignal,
      roomCode: record.room.roomCode
    })
      .catch((error: unknown) => {
        if (!context.isActivePeer(hostPeer, "host") || isAbortError(error)) {
          return;
        }

        context.teardownFailedRuntime();
        context.store.setSession(null);
        context.store.clearTransientRoomState();
        context.store.setError(
          error instanceof Error ? error.message : "Failed to restore the direct match."
        );
      })
      .finally(() => {
        // safe vs CLAUDE.md hang bug: runReconnectAttempt has already settled (via the .catch above) by the time this .finally runs — no in-flight poll loop to orphan.
        if (context.hostReconnectAbortController?.signal === reconnectSignal) {
          context.hostReconnectInFlight = false;
        }

        if (context.hostReconnectAbortController?.signal === reconnectSignal) {
          context.hostReconnectAbortController = null;
        }
      });
  }

  applyGuestAnswerText(): boolean {
    const context = this.context;
    const hostSetup = context.setup.store.getSnapshot().host;

    if (!context.activePeer || context.activeRole !== "host" || !context.hostTransport) {
      context.setup.controller.failHostSetup(
        "Create a direct link before applying a guest answer."
      );
      return false;
    }

    try {
      const answerPayload = decodeGuestAnswerPayload(hostSetup.guestAnswerText);

      void this.applyGuestAnswerPayload(context.activePeer, answerPayload).catch(
        (error: unknown) => {
          if (isAbortError(error)) {
            return;
          }

          context.setup.controller.failHostSetup(
            error instanceof Error ? error.message : "Failed to apply the guest answer payload."
          );
        }
      );

      return true;
    } catch (error) {
      context.setup.controller.failHostSetup(
        error instanceof Error ? error.message : "Guest answer payload is invalid."
      );
      return false;
    }
  }

  private async publishOfferAndAwaitGuest(
    peer: WebRTCPeerController,
    displayName: string,
    offerPayload: HostOfferPayload
  ): Promise<void> {
    const context = this.context;

    if (!context.isActivePeer(peer, "host")) {
      return;
    }

    context.setup.controller.completeHostOfferCreation({ displayName, offerPayload });

    const createdSession = await context.rendezvousClient.createSession(
      offerPayload,
      context.hostSetupAbortController?.signal
    );

    if (!context.isActivePeer(peer, "host")) {
      return;
    }

    context.setup.controller.completeHostSessionCreation({
      sessionId: createdSession.sessionId,
      hostSecret: createdSession.hostSecret,
      expiresAt: createdSession.expiresAt,
      sessionState: createdSession.state,
      joinUrl: createP2PJoinUrl(createdSession.sessionId)
    });

    const answerResponse = await context.rendezvousClient.pollForAnswer(
      createdSession.sessionId,
      createdSession.hostSecret,
      context.hostSetupAbortController ? { signal: context.hostSetupAbortController.signal } : {}
    );

    if (!context.isActivePeer(peer, "host")) {
      return;
    }

    context.setup.controller.setHostSessionState(answerResponse.state);

    if (answerResponse.state === "expired") {
      throw new Error(
        "This direct-match link expired before a guest connected. Start a new direct match."
      );
    }

    if (!answerResponse.answer) {
      throw new Error(
        "This direct-match link expired before a guest connected. Start a new direct match."
      );
    }

    await this.applyGuestAnswerPayload(peer, answerResponse.answer);

    const finalizedSession = await context.rendezvousClient.finalizeSession(
      createdSession.sessionId,
      createdSession.hostSecret,
      context.hostSetupAbortController?.signal
    );

    if (!context.isActivePeer(peer, "host")) {
      return;
    }

    context.hostSessionFinalized = true;
    context.setup.controller.setHostSessionState(finalizedSession.state);
    this.finalizeGuestIfReady();
  }

  private async applyGuestAnswerPayload(
    peer: WebRTCPeerController,
    answerPayload: GuestAnswerPayload
  ): Promise<void> {
    this.context.pendingGuestDisplayName = answerPayload.displayName;
    this.context.setup.controller.applyGuestAnswer(answerPayload);
    await peer.applyGuestAnswer(answerPayload);
    this.finalizeGuestIfReady();
  }

  private subscribeToPeer(peer: WebRTCPeerController): void {
    peer.subscribe({
      onStatusChange: (change) => {
        if (!this.context.isActivePeer(peer, "host")) {
          return;
        }

        if (change.status === "connected") {
          this.handlePeerConnected(peer);
          return;
        }

        if (change.status === "failed" || change.status === "closed") {
          this.handlePeerDown(peer, change);
        }
      }
    });
  }

  private handlePeerConnected(peer: WebRTCPeerController): void {
    const context = this.context;

    if (
      context.hostReconnectNeedsGuestRebind &&
      context.activePeer === peer &&
      context.hostTransport
    ) {
      context.hostTransport.rebindGuestPeer();
      context.hostReconnectNeedsGuestRebind = false;
    }

    this.finalizeGuestIfReady();
  }

  private handlePeerDown(peer: WebRTCPeerController, change: WebRTCPeerStatusChange): void {
    const context = this.context;

    if (context.hostReconnectControl && context.hostTransport?.hasGuestSession()) {
      if (!context.hostReconnectInFlight) {
        void this.handlePeerClosed(peer).catch((error: unknown) => {
          if (isAbortError(error)) {
            return;
          }
        });
      }

      return;
    }

    if (change.status === "failed") {
      context.setup.controller.failHostSetup(change.error ?? "Direct connection failed.");
      return;
    }

    context.setup.controller.setHostStage("closed");
  }

  private finalizeGuestIfReady(): void {
    const context = this.context;

    if (
      !context.activePeer ||
      context.activeRole !== "host" ||
      !context.hostTransport ||
      !context.pendingGuestDisplayName ||
      !context.hostSessionFinalized ||
      context.activePeer.getStatus() !== "connected"
    ) {
      return;
    }

    const displayName = context.pendingGuestDisplayName;

    context.pendingGuestDisplayName = null;
    context.hostTransport.acceptGuest(displayName);
    context.setup.controller.setHostStage("connected");
    void this.ensureReconnectControlRegistered().catch((error: unknown) => {
      if (isAbortError(error)) {
        return;
      }

      context.hostReconnectControl = null;
      context.store.setError(
        error instanceof Error
          ? error.message
          : "Direct-match recovery is unavailable for this session."
      );
    });
  }

  private async ensureReconnectControlRegistered(): Promise<void> {
    const context = this.context;

    if (!context.hostTransport?.hasGuestSession()) {
      return;
    }

    if (!context.hostReconnectControl) {
      context.hostReconnectControl = {
        controlSessionId: createRandomId(),
        hostSecret: createRandomId(),
        guestSecret: createRandomId()
      };
    }

    const reconnectControl = context.hostReconnectControl;

    await context.rendezvousClient.registerReconnectControlSession(
      reconnectControl.controlSessionId,
      reconnectControl.hostSecret,
      reconnectControl.guestSecret,
      context.hostSetupAbortController?.signal
    );

    if (!context.hostTransport || context.hostReconnectControl !== reconnectControl) {
      return;
    }

    await context.claims.ensure(
      {
        controlSessionId: reconnectControl.controlSessionId,
        role: "host",
        secret: reconnectControl.hostSecret,
        instanceId: createRandomId(),
        roomCode: context.store.getSnapshot().session?.roomCode ?? null,
        timerId: null
      },
      context.hostSetupAbortController?.signal
    );

    context.hostTransport.sendRecoveryControlMessage({
      type: "p2p:recovery",
      payload: {
        controlSessionId: reconnectControl.controlSessionId,
        guestSecret: reconnectControl.guestSecret
      }
    });
    context.persistCurrentHostRecoveryRecord();
  }

  private async handlePeerClosed(peer: WebRTCPeerController): Promise<void> {
    const context = this.context;

    if (!context.isActivePeer(peer, "host")) {
      return;
    }

    if (
      !context.hostTransport?.hasGuestSession() ||
      !context.hostReconnectControl ||
      context.hostReconnectInFlight
    ) {
      context.setup.controller.setHostStage("closed");
      return;
    }

    context.hostReconnectInFlight = true;
    context.clearHostReconnectRetryTimer();
    context.hostReconnectNeedsGuestRebind = true;
    context.hostReconnectAbortController = new AbortController();

    const nextPeer = context.createPeer();
    const reconnectControl = context.hostReconnectControl;
    const reconnectSignal = context.hostReconnectAbortController.signal;

    context.activePeer = nextPeer;
    context.hostTransport.replacePeer(nextPeer);
    this.subscribeToPeer(nextPeer);

    try {
      await this.runReconnectAttempt({
        peer: nextPeer,
        reconnectControl,
        signal: reconnectSignal,
        roomCode: context.store.getSnapshot().session?.roomCode ?? null
      });
    } catch (error) {
      if (!isAbortError(error)) {
        context.store.setError(error instanceof Error ? error.message : "Guest reconnect failed.");
        this.scheduleReconnectRetry(nextPeer, reconnectControl);
      }
    } finally {
      // safe vs CLAUDE.md hang bug: the awaited runReconnectAttempt above has already settled by the time this finally runs — no in-flight poll loop to orphan.
      context.hostReconnectInFlight = false;
      context.hostReconnectAbortController = null;
    }
  }

  private scheduleReconnectRetry(
    peer: WebRTCPeerController,
    reconnectControl: P2PHostReconnectControlState
  ): void {
    const context = this.context;

    context.clearHostReconnectRetryTimer();
    context.hostReconnectRetryTimeoutId = context.scheduler.setTimeout(() => {
      context.hostReconnectRetryTimeoutId = null;

      if (
        context.isActivePeer(peer, "host") &&
        !context.hostReconnectInFlight &&
        context.hostTransport?.hasGuestSession() &&
        context.hostReconnectControl === reconnectControl
      ) {
        void this.handlePeerClosed(peer).catch((error: unknown) => {
          if (isAbortError(error)) {
            return;
          }
        });
      }
    }, HOST_RECONNECT_RETRY_DELAY_MS);
  }

  private async runReconnectAttempt({
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
    const context = this.context;
    const instanceId = createRandomId();
    const { controlSessionId, hostSecret } = reconnectControl;
    const claimFor = (): ActiveReconnectClaimState => ({
      controlSessionId,
      role: "host",
      secret: hostSecret,
      instanceId,
      roomCode,
      timerId: null
    });

    reconnectControl.lastInstanceId = instanceId;
    context.persistCurrentHostRecoveryRecord();

    try {
      await context.rendezvousClient.claimReconnectRole(
        controlSessionId,
        "host",
        hostSecret,
        instanceId,
        signal
      );

      context.claims.start(claimFor());

      const offer = await peer.createReconnectOffer();

      await context.rendezvousClient.writeReconnectOffer(
        controlSessionId,
        hostSecret,
        instanceId,
        offer,
        signal
      );

      const answerResponse = await context.rendezvousClient.pollForReconnectAnswer(
        controlSessionId,
        hostSecret,
        instanceId,
        { signal }
      );

      if (answerResponse.state === "expired" || !answerResponse.answer) {
        throw new Error("Guest reconnect expired before the direct match could recover.");
      }

      await peer.applyReconnectAnswer(answerResponse.answer);
      await waitForPeerConnected(peer, signal);

      await context.rendezvousClient.finalizeReconnectAttempt(
        controlSessionId,
        "host",
        hostSecret,
        instanceId,
        "reconnected",
        signal
      );
      context.setup.controller.setHostStage("connected");
    } catch (error) {
      const claimError = context.handleReconnectAttemptClaimError(claimFor(), error);

      if (claimError) {
        throw claimError;
      }

      if (!isAbortError(error)) {
        await context.finalizeReconnectAttemptBestEffort(claimFor(), signal);
      }

      throw error;
    }
  }

  private restoreHostStore(snapshot: P2PHostAuthoritySnapshot): void {
    const store = this.context.store;

    if (!snapshot.room || !snapshot.hostSession) {
      throw new Error("Invalid host recovery snapshot.");
    }

    store.setSession({
      roomId: snapshot.hostSession.roomId,
      roomCode: snapshot.hostSession.roomCode,
      playerId: snapshot.hostSession.playerId,
      displayName: snapshot.hostSession.displayName,
      sessionToken: snapshot.hostSession.sessionToken,
      ...(snapshot.room.inviteToken ? { inviteToken: snapshot.room.inviteToken } : {}),
      players: snapshot.room.players.map((player) => ({ ...player }))
    });
    store.setChatMessages(snapshot.chatMessages.map((message) => ({ ...message })));
    store.setMatch(snapshot.match ? toMatchStateDto(snapshot.match) : null);
    store.setBombArmed(false);
    store.setChatError(null);
    store.setChatPendingText(null);
    store.setError(null);
  }
}
