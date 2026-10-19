import {
  createBrowserGameClientScheduler,
  type GameClientScheduler
} from "../../app/providers/game-client.controller.js";
import type {
  GameClientRuntime,
  GameClientRuntimeController
} from "../../app/providers/game-client.runtime.js";
import { GameClientStore } from "../../app/providers/game-client.store.js";
import { P2P_STUN_URLS } from "../../lib/config/env.js";
import { createP2PSetupController } from "../setup/p2p-setup.controller.js";
import { createP2PRendezvousClient } from "../signaling/p2p-rendezvous-client.js";
import {
  createBrowserP2PRecoveryPersistence,
  type P2PRecoveryPersistence
} from "../storage/p2p-recovery-storage.js";
import { WebRTCPeer } from "../transport/webrtc-peer.js";
import type { WebRTCPeerController } from "../transport/webrtc-peer.types.js";
import { P2PGuestRuntime } from "./p2p-guest-runtime.js";
import { P2PHostRuntime } from "./p2p-host-runtime.js";
import {
  P2PRuntimeContext,
  type P2PRuntimeDependencies,
  type RendezvousClient
} from "./p2p-runtime-context.js";

const UNSUPPORTED_MATCH_ACTION_MESSAGE =
  "Direct Match setup is still loading. Start from the direct-match lobby flow.";
const P2P_CHAT_DISCONNECTED_MESSAGE =
  "Chat is offline. If the direct link stays down, restart the direct match.";
const P2P_ACTION_DISCONNECTED_MESSAGE =
  "Direct connection interrupted. Restart the direct match if it does not recover.";

export interface CreateP2PGameClientRuntimeOptions {
  createPeer?: () => WebRTCPeerController;
  scheduler?: GameClientScheduler;
  rendezvousClient?: RendezvousClient;
  recoveryPersistence?: P2PRecoveryPersistence;
}

// The game client runtime for direct matches. It owns the runtime lifecycle and routes
// each command to the host or guest flow; the active GameClientController plays the match.
class P2PBootstrapController implements GameClientRuntimeController {
  readonly setup: P2PRuntimeDependencies["setup"];
  private readonly store: GameClientStore;
  private readonly context: P2PRuntimeContext;
  private readonly host: P2PHostRuntime;
  private readonly guest: P2PGuestRuntime;

  constructor(dependencies: P2PRuntimeDependencies) {
    this.store = dependencies.store;
    this.setup = dependencies.setup;
    this.context = new P2PRuntimeContext(dependencies);
    this.host = new P2PHostRuntime(this.context);
    this.guest = new P2PGuestRuntime(this.context, this.reconnect);
    this.store.subscribe(() => {
      this.guest.flushPendingRecoveryControl();
      this.context.persistCurrentHostRecoveryRecord();
    });
  }

  start = (): void => {
    this.store.setConnectionStatus("disconnected");
  };

  dispose = (): void => {
    this.context.teardownActiveRuntime();
    this.setup.controller.resetHost();
    this.setup.controller.resetGuest();
  };

  hasStoredSession = (roomCode: string): boolean => {
    const record = this.context.recoveryPersistence.read(roomCode);
    return record?.role === "guest" || record?.role === "host";
  };

  openLobby = (): void => {
    this.context.clearRecoveryForActiveRuntime();
    this.context.teardownActiveRuntime();
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
    this.context.clearRecoveryForActiveRuntime();
    this.context.teardownActiveRuntime();
    this.host.startSetup(trimmedDisplayName);
  };

  joinRoom = (): void => {
    this.store.setError(UNSUPPORTED_MATCH_ACTION_MESSAGE);
  };

  reconnect = (roomCode: string): void => {
    const record = this.context.recoveryPersistence.read(roomCode);

    if (!record) {
      this.store.setError("No local session is stored for that room.");
      return;
    }

    this.store.setError(null);
    this.store.setSession(null);
    this.store.clearTransientRoomState();
    this.setup.controller.resetHost();
    this.setup.controller.resetGuest();
    this.context.teardownActiveRuntime();

    if (record.role === "guest") {
      this.guest.startReconnect(record);
      return;
    }

    this.host.startReconnect(record);
  };

  submitCellAction = (row: number, column: number): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setError(P2P_ACTION_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.context.activeController) {
      this.store.setError("Connect to a direct match before making a move.");
      return;
    }

    this.context.activeController.submitCellAction(row, column);
  };

  setChatDraft = (value: string): void => {
    if (!this.context.activeController) {
      this.store.setChatDraft(value);
      this.store.setChatError(null);
      return;
    }

    this.context.activeController.setChatDraft(value);
  };

  sendChatMessage = (): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setChatError(P2P_CHAT_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.context.activeController) {
      this.store.setChatError("Connect to a direct match before chatting.");
      return;
    }

    this.context.activeController.sendChatMessage();
  };

  toggleBombMode = (): void => {
    this.store.toggleBombMode();
  };

  resignMatch = (): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setError(P2P_ACTION_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.context.activeController) {
      this.store.setError("Connect to a direct match before resigning.");
      return;
    }

    this.context.activeController.resignMatch();
  };

  requestRematch = (): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setError(P2P_ACTION_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.context.activeController) {
      this.store.setError("Connect to a direct match before requesting a rematch.");
      return;
    }

    this.context.activeController.requestRematch();
  };

  cancelRematch = (): void => {
    if (this.shouldBlockHostActionDuringReconnect()) {
      this.store.setError(P2P_ACTION_DISCONNECTED_MESSAGE);
      return;
    }

    if (!this.context.activeController) {
      this.store.setError("Connect to a direct match before changing rematch state.");
      return;
    }

    this.context.activeController.cancelRematch();
  };

  clearError = (): void => {
    this.store.clearError();
  };

  openGuestSetupSession = (sessionId: string): void => {
    this.guest.openSetupSession(sessionId);
  };

  openGuestSetupFromFragment = (): void => {
    this.setup.controller.failGuestSetup(
      "This direct-match link uses an old format. Start a new direct match from the lobby."
    );
  };

  createGuestAnswer = (displayName: string): void => {
    this.guest.createAnswer(displayName);
  };

  setHostGuestAnswerText = (value: string): void => {
    this.setup.controller.clearHostError();
    this.setup.controller.setGuestAnswerText(value);
  };

  applyHostGuestAnswer = (): boolean => this.host.applyGuestAnswerText();

  clearHostSetupError = (): void => {
    this.setup.controller.clearHostError();
  };

  clearGuestSetupError = (): void => {
    this.setup.controller.clearGuestError();
  };

  getSetupSnapshot = () => this.setup.store.getSnapshot();

  private shouldBlockHostActionDuringReconnect(): boolean {
    return this.context.activeRole === "host" && this.context.hostReconnectInFlight;
  }
}

export const createP2PGameClientRuntime = (
  options: CreateP2PGameClientRuntimeOptions = {}
): GameClientRuntime => {
  const store = new GameClientStore();
  const controller = new P2PBootstrapController({
    store,
    setup: createP2PSetupController(),
    createPeer:
      options.createPeer ??
      (() =>
        new WebRTCPeer({
          rtcConfiguration: P2P_STUN_URLS.length
            ? {
                iceServers: [{ urls: P2P_STUN_URLS }]
              }
            : {}
        })),
    scheduler: options.scheduler ?? createBrowserGameClientScheduler(),
    rendezvousClient: options.rendezvousClient ?? createP2PRendezvousClient(),
    recoveryPersistence: options.recoveryPersistence ?? createBrowserP2PRecoveryPersistence()
  });

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
