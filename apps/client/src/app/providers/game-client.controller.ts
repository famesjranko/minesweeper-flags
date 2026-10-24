// biome-ignore lint/style/noExcessiveLinesPerFile: The controller owns one transport lifecycle.
import {
  CLIENT_EVENT_NAMES,
  type ClientEvent,
  SERVER_EVENT_NAMES,
  type ServerEvent
} from "@minesweeper-flags/shared";
import type { SessionPersistence, StoredSession } from "../../lib/socket/session-storage.js";
import { ChatDraftRecovery } from "./game-client.chat-recovery.js";
import {
  buildReconnectEvent,
  buildSessionFromRoomEvent,
  shouldApplyServerEvent,
  shouldQueueWhileOffline,
  shouldReconnectAfterClose
} from "./game-client.state.js";
import type { GameClientStore } from "./game-client.store.js";
import type {
  GameClientTransport,
  GameClientTransportStatusChange
} from "./game-client.transport.js";

type ServerEventPayload<TType extends ServerEvent["type"]> = Extract<
  ServerEvent,
  { type: TType }
>["payload"];

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const RECONNECT_JITTER_MS = 250;
const ROOM_CANCEL_TIMEOUT_MS = 8_000;
export interface GameClientScheduler {
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (timeoutId: number) => void;
  random: () => number;
}

interface GameClientControllerOptions {
  store: GameClientStore;
  transport: GameClientTransport;
  persistence: SessionPersistence;
  scheduler: GameClientScheduler;
  copy?: {
    chatDisconnectedMessage?: string;
    actionDisconnectedMessage?: string;
  };
}

const DEFAULT_CHAT_DISCONNECTED_MESSAGE =
  "Chat is reconnecting. Try again once the room reconnects.";
const DEFAULT_ACTION_DISCONNECTED_MESSAGE =
  "Connection lost. Reconnecting before your next action.";

export class GameClientController {
  private readonly store: GameClientStore;
  private readonly transport: GameClientTransport;
  private readonly persistence: SessionPersistence;
  private readonly scheduler: GameClientScheduler;
  private readonly chatDisconnectedMessage: string;
  private readonly actionDisconnectedMessage: string;
  private readonly chatRecovery: ChatDraftRecovery;

  private pendingBootstrapEvent: ClientEvent | null = null;
  private joiningInviteToken: string | null = null;
  private reconnectAttempt: StoredSession | null = null;
  private reconnectAttemptCount = 0;
  private reconnectTimeoutId: number | null = null;
  private shouldReconnect = false;
  private unsubscribeTransport: (() => void) | null = null;
  private pendingRoomCancellation: {
    roomCode: string;
    requestId: string;
    timeoutId: number | null;
  } | null = null;
  private nextRoomCancelRequestId = 1;

  constructor({ store, transport, persistence, scheduler, copy }: GameClientControllerOptions) {
    this.store = store;
    this.transport = transport;
    this.persistence = persistence;
    this.scheduler = scheduler;
    this.chatRecovery = new ChatDraftRecovery(store);
    this.chatDisconnectedMessage =
      copy?.chatDisconnectedMessage ?? DEFAULT_CHAT_DISCONNECTED_MESSAGE;
    this.actionDisconnectedMessage =
      copy?.actionDisconnectedMessage ?? DEFAULT_ACTION_DISCONNECTED_MESSAGE;
  }

  start = (): void => {
    this.shouldReconnect = true;
    this.reconnectAttemptCount = 0;
    this.connectTransport();
  };

  dispose = (): void => {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.clearPendingRoomCancellation();
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = null;
    this.transport.disconnect();
  };

  hasStoredSession = (roomCode: string): boolean => this.persistence.read(roomCode) !== null;

  openLobby = (): void => {
    if (
      this.pendingRoomCancellation ||
      (this.store.getSnapshot().roomCancelAttempted && this.store.getSnapshot().session)
    )
      return;
    this.clearActiveRoomState();
    this.restartTransport();
  };

  createRoom = (displayName: string): void => {
    if (this.pendingRoomCancellation) return;
    this.startLobbyTransition();
    this.sendEvent({
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName }
    });
  };

  joinRoom = (displayName: string, inviteToken: string): void => {
    if (this.pendingRoomCancellation) return;
    this.startLobbyTransition();
    this.joiningInviteToken = inviteToken;
    this.sendEvent({
      type: CLIENT_EVENT_NAMES.roomJoin,
      payload: { displayName, inviteToken }
    });
  };

  reconnect = (roomCode: string, allowPendingCancellation = false): void => {
    const pendingCancellation = this.pendingRoomCancellation;
    if (
      pendingCancellation &&
      (!allowPendingCancellation || pendingCancellation.roomCode !== roomCode)
    )
      return;
    const storedSession = this.persistence.read(roomCode);

    if (!storedSession) {
      this.store.setError("No local session is stored for that room.");
      return;
    }

    if (this.reconnectAttempt?.roomCode === storedSession.roomCode) {
      return;
    }

    const previousRoomCode = this.store.getSnapshot().session?.roomCode ?? null;
    this.reconnectAttempt = storedSession;

    if (previousRoomCode !== storedSession.roomCode) {
      this.store.setSession(null);
    }

    this.store.clearTransientRoomState({
      preserveChatDraft: previousRoomCode === storedSession.roomCode
    });
    this.store.setError(null);

    if (this.transport.getStatus() === "connected") {
      if (previousRoomCode && previousRoomCode !== storedSession.roomCode) {
        this.restartTransport();
        return;
      }

      this.transport.send(buildReconnectEvent(storedSession));
      return;
    }

    this.connectTransport();
  };

  submitCellAction = (row: number, column: number): void => {
    const activeSession = this.store.getSnapshot().session;

    if (!activeSession) {
      this.store.setError("Join a room before sending actions.");
      return;
    }

    const action = this.store.getSnapshot().bombArmed
      ? { type: "bomb" as const, row, column }
      : { type: "select" as const, row, column };

    if (
      this.sendEvent({
        type: CLIENT_EVENT_NAMES.matchAction,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken,
          action
        }
      })
    ) {
      this.store.setBombArmed(false);
    }
  };

  setChatDraft = (value: string): void => {
    this.chatRecovery.forget();
    this.store.setChatDraft(value);
    this.store.setChatError(null);
  };

  sendChatMessage = (): void => {
    const snapshot = this.store.getSnapshot();
    const activeSession = snapshot.session;

    if (!activeSession) {
      this.store.setChatError("Join a room before chatting.");
      return;
    }

    if (snapshot.chatPendingText) {
      return;
    }

    if (!snapshot.chatDraft.trim()) {
      this.store.setChatError("Type a message before sending.");
      return;
    }

    if (this.transport.getStatus() !== "connected") {
      this.store.setChatError(this.chatDisconnectedMessage);
      this.connectTransport();
      return;
    }

    this.chatRecovery.forget();
    this.store.setChatPendingText(snapshot.chatDraft);
    this.store.setChatDraft("");
    this.store.setChatError(null);

    try {
      this.transport.send({
        type: CLIENT_EVENT_NAMES.chatSend,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken,
          text: snapshot.chatDraft
        }
      });
    } catch {
      this.store.setChatDraft(snapshot.chatDraft);
      this.store.setChatPendingText(null);
      this.store.setChatError("Chat could not be sent. Try again.");
    }
  };

  toggleBombMode = (): void => {
    this.store.toggleBombMode();
  };

  resignMatch = (): void => {
    this.withSession((activeSession) => {
      this.store.setError(null);
      this.store.setBombArmed(false);
      this.sendEvent({
        type: CLIENT_EVENT_NAMES.matchResign,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken
        }
      });
    });
  };

  requestRematch = (): void => {
    this.withSession((activeSession) => {
      this.sendEvent({
        type: CLIENT_EVENT_NAMES.matchRematchRequest,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken
        }
      });
    });
  };

  cancelRematch = (): void => {
    this.withSession((activeSession) => {
      this.sendEvent({
        type: CLIENT_EVENT_NAMES.matchRematchCancel,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken
        }
      });
    });
  };

  cancelRoom = (): void => {
    this.withSession((activeSession) => {
      if (this.store.getSnapshot().match || this.pendingRoomCancellation) return;

      const requestId = `cancel-${this.nextRoomCancelRequestId++}`;
      const sent = this.sendEvent({
        type: CLIENT_EVENT_NAMES.roomCancel,
        payload: {
          roomCode: activeSession.roomCode,
          sessionToken: activeSession.sessionToken,
          requestId
        }
      });
      if (!sent) {
        // Leaving must never depend on the network. The server's reconnect grace releases the
        // slot, and the stored session stays so the host can still return to the room.
        this.clearActiveRoomState();
        this.restartTransport();
        return;
      }
      this.store.setRoomCancelAttempted(true);

      const timeoutId = this.scheduler.setTimeout(() => {
        if (this.pendingRoomCancellation?.requestId !== requestId) return;
        this.pendingRoomCancellation.timeoutId = null;
        this.store.setRoomCancelPending(false);
        this.reconnect(activeSession.roomCode, true);
        this.store.setError("Room cancellation status is unknown. Reconnecting to confirm it.");
      }, ROOM_CANCEL_TIMEOUT_MS);
      this.pendingRoomCancellation = { roomCode: activeSession.roomCode, requestId, timeoutId };
      this.store.setRoomCancelPending(true);
      this.store.setError(null);
    });
  };

  clearError = (): void => {
    this.store.clearError();
  };

  private handleTransportStatusChange = ({
    status,
    closeCode
  }: GameClientTransportStatusChange): void => {
    if (status === "connected") {
      this.store.setConnectionStatus(status);
      this.reconnectAttemptCount = 0;

      const reconnectSession = this.reconnectAttempt ?? this.store.getSnapshot().session;

      if (reconnectSession) {
        this.reconnectAttempt = reconnectSession;
        this.transport.send(buildReconnectEvent(reconnectSession));
      }

      if (this.pendingBootstrapEvent) {
        this.transport.send(this.pendingBootstrapEvent);
        this.pendingBootstrapEvent = null;
      }

      return;
    }

    if (status === "disconnected" && typeof closeCode === "number") {
      const isRetrying = this.handleTransportClosed(closeCode);
      this.store.setConnectionStatus(isRetrying ? "connecting" : status);
      return;
    }

    this.store.setConnectionStatus(status);
  };

  private handleTransportClosed(closeCode: number): boolean {
    this.chatRecovery.recoverPendingOnClose();

    if (!this.shouldReconnect) {
      return false;
    }

    if (!shouldReconnectAfterClose(closeCode)) {
      this.store.setError(
        "This room is active in another tab or window. Use that tab, or reconnect here."
      );
      return false;
    }

    this.clearReconnectTimer();
    this.reconnectTimeoutId = this.scheduler.setTimeout(() => {
      this.connectTransport();
    }, this.getNextReconnectDelayMs());

    return true;
  }

  private handleServerEvent = (event: ServerEvent | null): void => {
    if (!event) {
      this.store.setError("The server sent an unreadable event.");
      return;
    }

    const activeRoomCode =
      this.reconnectAttempt?.roomCode ?? this.store.getSnapshot().session?.roomCode ?? null;

    if (!shouldApplyServerEvent(event, activeRoomCode)) {
      return;
    }

    switch (event.type) {
      case SERVER_EVENT_NAMES.roomCreated:
      case SERVER_EVENT_NAMES.roomJoined: {
        this.clearReconnectAttempt();
        const nextSession = {
          ...buildSessionFromRoomEvent(event),
          // A browser can reopen the original invite when changing its display mode.
          // Keep its association with the seat; reconnect still uses the session token.
          ...(event.type === SERVER_EVENT_NAMES.roomJoined && this.joiningInviteToken
            ? { inviteToken: this.joiningInviteToken }
            : {})
        };
        this.joiningInviteToken = null;
        this.store.setSession(nextSession);
        this.persistence.write(nextSession);
        this.store.clearTransientRoomState();
        this.store.setError(null);
        break;
      }
      case SERVER_EVENT_NAMES.roomState:
        this.applyRoomState(event.payload);
        break;
      case SERVER_EVENT_NAMES.roomCancelled:
        this.handleRoomCancelled(event.payload.roomCode, event.payload.requestId);
        break;
      case SERVER_EVENT_NAMES.chatHistory:
        this.chatRecovery.applyHistory(event.payload.messages);
        break;
      case SERVER_EVENT_NAMES.chatMessage:
        this.chatRecovery.applyMessage(event.payload.message);
        break;
      case SERVER_EVENT_NAMES.chatMessageRejected:
        this.chatRecovery.rejectPending(event.payload.message);
        break;
      case SERVER_EVENT_NAMES.matchStarted:
      case SERVER_EVENT_NAMES.matchState:
      case SERVER_EVENT_NAMES.matchEnded:
        this.store.setMatch(event.payload.match);
        this.store.setBombArmed(false);
        this.settleFailedRoomCancellation();
        break;
      case SERVER_EVENT_NAMES.matchRematchUpdated:
        this.store.applyRematchUpdate(event.payload.players);
        break;
      case SERVER_EVENT_NAMES.matchActionRejected:
        this.store.setError(event.payload.message);
        this.store.setBombArmed(false);
        break;
      case SERVER_EVENT_NAMES.serverError: {
        if (this.reconnectAttempt) {
          this.invalidateRoomSession(
            this.reconnectAttempt.roomCode,
            "Your saved room session is no longer valid. Join the room again."
          );
          break;
        }
        if (this.pendingRoomCancellation) {
          this.clearPendingRoomCancellation();
          // A match can start before the refusal arrives; the refusal is moot by then.
          if (!this.store.getSnapshot().match) this.store.setError(event.payload.message);
          break;
        }

        this.store.setError(event.payload.message);
        this.store.setBombArmed(false);
        break;
      }
      case SERVER_EVENT_NAMES.playerDisconnected:
      case SERVER_EVENT_NAMES.playerReconnected:
        break;
    }
  };

  private applyRoomState(payload: ServerEventPayload<typeof SERVER_EVENT_NAMES.roomState>): void {
    const reconnectSession = this.reconnectAttempt;

    if (reconnectSession && reconnectSession.roomCode === payload.roomCode) {
      this.clearReconnectAttempt();
      const nextSession = {
        ...reconnectSession,
        roomId: payload.roomId,
        players: payload.players
      };

      this.store.setSession(nextSession);
      this.persistence.write(nextSession);
      this.store.setBombArmed(false);
      if (this.pendingRoomCancellation?.roomCode === payload.roomCode) {
        this.clearPendingRoomCancellation();
        this.store.setRoomCancelAttempted(false);
      }
      this.store.setError(null);
      return;
    }

    const activeSession = this.store.getSnapshot().session;

    if (!activeSession || activeSession.roomCode !== payload.roomCode) {
      return;
    }

    const nextSession = {
      ...activeSession,
      roomId: payload.roomId,
      players: payload.players
    };

    this.store.setSession(nextSession);
    this.persistence.write(nextSession);
  }

  private invalidateRoomSession(roomCode: string, message: string): void {
    this.persistence.remove(roomCode);

    if (
      this.store.getSnapshot().session?.roomCode === roomCode ||
      this.reconnectAttempt?.roomCode === roomCode
    ) {
      this.store.setSession(null);
      this.store.clearTransientRoomState();
      this.store.setRoomCancelAttempted(false);
    }

    this.clearPendingRoomCancellation();
    this.clearReconnectAttempt();
    this.store.setError(message);
  }

  private handleRoomCancelled(roomCode: string, requestId: string): void {
    const pending = this.pendingRoomCancellation;
    const session = this.store.getSnapshot().session;
    if (
      !pending ||
      pending.roomCode !== roomCode ||
      pending.requestId !== requestId ||
      session?.roomCode !== roomCode
    )
      return;

    this.persistence.remove(roomCode);
    this.clearPendingRoomCancellation();
    this.store.setRoomCancelAttempted(false);
    this.clearActiveRoomState();
  }

  /** A started match ends any cancellation attempt, so its error must not hold the host back. */
  private settleFailedRoomCancellation(): void {
    if (!this.store.getSnapshot().roomCancelAttempted) return;
    this.store.setRoomCancelAttempted(false);
    this.store.setError(null);
  }

  private clearPendingRoomCancellation(): void {
    const pending = this.pendingRoomCancellation;
    if (pending && pending.timeoutId !== null) this.scheduler.clearTimeout(pending.timeoutId);
    this.pendingRoomCancellation = null;
    this.store.setRoomCancelPending(false);
  }

  private connectTransport(): void {
    // A child page's effect (lobby open, room recovery) can connect before the provider's
    // start effect, so every connect subscribes first. Otherwise "connecting" reaches no one.
    if (!this.unsubscribeTransport) {
      this.unsubscribeTransport = this.transport.subscribe({
        onServerEvent: this.handleServerEvent,
        onStatusChange: this.handleTransportStatusChange
      });
    }
    this.transport.connect();
  }

  private restartTransport(): void {
    this.clearReconnectTimer();
    this.shouldReconnect = false;
    this.transport.disconnect();
    this.store.setConnectionStatus("disconnected");
    this.reconnectAttemptCount = 0;
    this.shouldReconnect = true;
    this.connectTransport();
  }

  private clearReconnectAttempt(): void {
    this.reconnectAttempt = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimeoutId !== null) {
      this.scheduler.clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private getNextReconnectDelayMs(): number {
    const baseDelay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttemptCount,
      MAX_RECONNECT_DELAY_MS
    );
    const jitter = Math.floor(this.scheduler.random() * RECONNECT_JITTER_MS);

    this.reconnectAttemptCount += 1;

    return baseDelay + jitter;
  }

  private clearActiveRoomState(): void {
    this.joiningInviteToken = null;
    this.clearReconnectAttempt();
    this.store.setRoomCancelAttempted(false);
    this.store.setSession(null);
    this.store.clearTransientRoomState();
    this.store.setError(null);
  }

  private startLobbyTransition(): void {
    const hadActiveSession = this.store.getSnapshot().session !== null;

    this.clearActiveRoomState();

    if (hadActiveSession) {
      this.restartTransport();
    }
  }

  private sendEvent(event: ClientEvent): boolean {
    if (this.transport.getStatus() === "connected") {
      try {
        this.transport.send(event);
        return true;
      } catch {
        this.store.setError(this.actionDisconnectedMessage);
        this.connectTransport();
        return false;
      }
    }

    if (shouldQueueWhileOffline(event)) {
      this.pendingBootstrapEvent = event;
      this.connectTransport();
      return true;
    }

    this.store.setError(this.actionDisconnectedMessage);
    this.connectTransport();
    return false;
  }

  private withSession<T>(callback: (session: StoredSession) => T): T | undefined {
    const activeSession = this.store.getSnapshot().session;

    if (!activeSession) {
      return undefined;
    }

    return callback(activeSession);
  }
}

export const createBrowserGameClientScheduler = (): GameClientScheduler => ({
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs) as unknown as number,
  clearTimeout: (timeoutId) => globalThis.clearTimeout(timeoutId),
  random: () => Math.random()
});
