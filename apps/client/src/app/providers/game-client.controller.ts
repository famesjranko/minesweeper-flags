import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  type ClientEvent,
  type ServerEvent
} from "@minesweeper-flags/shared";
import type {
  SessionPersistence,
  StoredSession
} from "../../lib/socket/session-storage.js";
import {
  buildReconnectEvent,
  buildSessionFromRoomEvent,
  hasDeliveredChatText,
  reconcileRecoveredChatDraft,
  replaceChatHistory,
  shouldApplyServerEvent,
  shouldReconnectAfterClose,
  shouldQueueWhileOffline
} from "./game-client.state.js";
import { type GameClientStore } from "./game-client.store.js";
import type {
  GameClientTransport,
  GameClientTransportStatusChange
} from "./game-client.transport.js";

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;
const RECONNECT_JITTER_MS = 250;
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

  private pendingBootstrapEvent: ClientEvent | null = null;
  private reconnectAttempt: StoredSession | null = null;
  private reconnectAttemptCount = 0;
  private reconnectTimeoutId: number | null = null;
  private shouldReconnect = false;
  private recoveredChatDraftText: string | null = null;
  private unsubscribeTransport: (() => void) | null = null;

  constructor({
    store,
    transport,
    persistence,
    scheduler,
    copy
  }: GameClientControllerOptions) {
    this.store = store;
    this.transport = transport;
    this.persistence = persistence;
    this.scheduler = scheduler;
    this.chatDisconnectedMessage =
      copy?.chatDisconnectedMessage ?? DEFAULT_CHAT_DISCONNECTED_MESSAGE;
    this.actionDisconnectedMessage =
      copy?.actionDisconnectedMessage ?? DEFAULT_ACTION_DISCONNECTED_MESSAGE;
  }

  start = (): void => {
    this.shouldReconnect = true;
    this.reconnectAttemptCount = 0;

    if (!this.unsubscribeTransport) {
      this.unsubscribeTransport = this.transport.subscribe({
        onServerEvent: this.handleServerEvent,
        onStatusChange: this.handleTransportStatusChange
      });
    }

    this.connectTransport();
  };

  dispose = (): void => {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = null;
    this.transport.disconnect();
  };

  hasStoredSession = (roomCode: string): boolean =>
    this.persistence.read(roomCode) !== null;

  openLobby = (): void => {
    this.clearActiveRoomState();
    this.restartTransport();
  };

  createRoom = (displayName: string): void => {
    this.startLobbyTransition();
    this.sendEvent({
      type: CLIENT_EVENT_NAMES.roomCreate,
      payload: { displayName }
    });
  };

  joinRoom = (displayName: string, inviteToken: string): void => {
    this.startLobbyTransition();
    this.sendEvent({
      type: CLIENT_EVENT_NAMES.roomJoin,
      payload: { displayName, inviteToken }
    });
  };

  reconnect = (roomCode: string): void => {
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
    this.recoveredChatDraftText = null;
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

    this.recoveredChatDraftText = null;
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

  clearError = (): void => {
    this.store.clearError();
  };

  private handleTransportStatusChange = ({
    status,
    closeCode
  }: GameClientTransportStatusChange): void => {
    this.store.setConnectionStatus(status);

    if (status === "connected") {
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
      this.handleTransportClosed(closeCode);
    }
  };

  private handleTransportClosed(closeCode: number): void {
    const pendingText = this.store.getSnapshot().chatPendingText;

    if (pendingText) {
      this.recoveredChatDraftText = pendingText;
      this.store.setChatDraft(this.store.getSnapshot().chatDraft || pendingText);
      this.store.setChatPendingText(null);
    }

    if (!this.shouldReconnect) {
      return;
    }

    if (!shouldReconnectAfterClose(closeCode)) {
      this.store.setError(
        "This room is active in another tab or window. Use that tab, or reconnect here."
      );
      return;
    }

    this.clearReconnectTimer();
    this.reconnectTimeoutId = this.scheduler.setTimeout(() => {
      this.connectTransport();
    }, this.getNextReconnectDelayMs());
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
        const nextSession = buildSessionFromRoomEvent(event);
        this.store.setSession(nextSession);
        this.persistence.write(nextSession);
        this.store.clearTransientRoomState();
        this.store.setError(null);
        break;
      }
      case SERVER_EVENT_NAMES.roomState: {
        const reconnectSession = this.reconnectAttempt;

        if (reconnectSession && reconnectSession.roomCode === event.payload.roomCode) {
          this.clearReconnectAttempt();
          const nextSession = {
            ...reconnectSession,
            roomId: event.payload.roomId,
            players: event.payload.players
          };

          this.store.setSession(nextSession);
          this.persistence.write(nextSession);
          this.store.setBombArmed(false);
          this.store.setError(null);
          break;
        }

        const activeSession = this.store.getSnapshot().session;

        if (!activeSession || activeSession.roomCode !== event.payload.roomCode) {
          break;
        }

        const nextSession = {
          ...activeSession,
          roomId: event.payload.roomId,
          players: event.payload.players
        };

        this.store.setSession(nextSession);
        this.persistence.write(nextSession);
        break;
      }
      case SERVER_EVENT_NAMES.chatHistory: {
        const snapshot = this.store.getSnapshot();
        const activeSession = snapshot.session;
        const nextMessages = replaceChatHistory(event.payload.messages);

        this.store.setChatMessages(nextMessages);

        if (
          snapshot.chatPendingText &&
          activeSession &&
          hasDeliveredChatText(nextMessages, activeSession.playerId, snapshot.chatPendingText)
        ) {
          this.store.setChatPendingText(null);
          this.store.setChatError(null);
        }

        const recoveredDraft = reconcileRecoveredChatDraft({
          currentDraft: snapshot.chatDraft,
          recoveredDraftText: this.recoveredChatDraftText,
          playerId: activeSession?.playerId ?? null,
          messages: nextMessages
        });

        if (recoveredDraft.shouldClearRecoveredDraft) {
          this.recoveredChatDraftText = null;

          if (recoveredDraft.nextDraft !== snapshot.chatDraft) {
            this.store.setChatDraft(recoveredDraft.nextDraft);
          }
        }
        break;
      }
      case SERVER_EVENT_NAMES.chatMessage: {
        this.store.appendChatMessage(event.payload.message);

        if (this.store.getSnapshot().session?.playerId === event.payload.message.playerId) {
          this.store.setChatPendingText(null);
          this.store.setChatError(null);

          if (this.recoveredChatDraftText === event.payload.message.text) {
            this.recoveredChatDraftText = null;

            if (this.store.getSnapshot().chatDraft === event.payload.message.text) {
              this.store.setChatDraft("");
            }
          }
        }
        break;
      }
      case SERVER_EVENT_NAMES.chatMessageRejected: {
        const pendingText = this.store.getSnapshot().chatPendingText;

        this.recoveredChatDraftText = null;

        if (pendingText) {
          this.store.setChatDraft(pendingText);
          this.store.setChatPendingText(null);
        }

        this.store.setChatError(event.payload.message);
        break;
      }
      case SERVER_EVENT_NAMES.matchStarted:
      case SERVER_EVENT_NAMES.matchState:
      case SERVER_EVENT_NAMES.matchEnded:
        this.store.setMatch(event.payload.match);
        this.store.setBombArmed(false);
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

        this.store.setError(event.payload.message);
        this.store.setBombArmed(false);
        break;
      }
      case SERVER_EVENT_NAMES.playerDisconnected:
      case SERVER_EVENT_NAMES.playerReconnected:
        break;
    }
  };

  private invalidateRoomSession(roomCode: string, message: string): void {
    this.persistence.remove(roomCode);

    if (
      this.store.getSnapshot().session?.roomCode === roomCode ||
      this.reconnectAttempt?.roomCode === roomCode
    ) {
      this.store.setSession(null);
      this.store.clearTransientRoomState();
    }

    this.clearReconnectAttempt();
    this.store.setError(message);
  }

  private connectTransport(): void {
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
    this.clearReconnectAttempt();
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
