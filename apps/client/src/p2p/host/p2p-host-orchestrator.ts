import {
  type BoardSize,
  createMatchState,
  type MatchAction,
  type MatchState,
  resignMatch,
  resolveAction,
  setPlayerRematchRequested
} from "@minesweeper-flags/game-engine";
import {
  type actionSchema,
  type ChatMessageDto,
  CLIENT_EVENT_NAMES,
  type ClientEvent,
  displayNameSchema,
  SERVER_EVENT_NAMES,
  type ServerEvent
} from "@minesweeper-flags/shared";
import type { z } from "zod";
import { validateHostAuthoritySnapshot } from "../storage/p2p-recovery-storage.js";
import {
  createBroadcastFanoutStep,
  createGuestFanoutStep,
  createHostLocalFanoutStep,
  type P2PHostFanoutStep
} from "./p2p-host-events.js";
import { disconnectGuest, reconnectGuest } from "./p2p-host-guest-connection.js";
import {
  buildChatHistoryEvent,
  buildChatMessageEvent,
  buildChatRejectedEvent,
  buildMatchActionRejectedEvent,
  buildMatchEndedEvent,
  buildMatchStartedEvent,
  buildMatchStateEvent,
  buildRematchUpdatedEvent,
  buildRoomCreatedEvent,
  buildRoomJoinedEvent,
  buildRoomStateEvent
} from "./p2p-host-server-events.js";
import {
  createDefaultP2PHostIdentityFactory,
  createGuestSessionRecord,
  createHostSessionRecord,
  matchesGuestBinding,
  matchesGuestCommandScope,
  type P2PBaseSessionRecord,
  type P2PGuestSessionRecord,
  type P2PHostIdentityFactory,
  type P2PHostSessionRecord
} from "./p2p-host-session.js";
import {
  cloneP2PHostRuntimeState,
  createInitialP2PHostRuntimeState,
  type P2PHostAuthoritySnapshot,
  type P2PHostRoomRecord,
  type P2PHostRuntimeState,
  type P2PRoomPlayerRecord
} from "./p2p-host-state.js";

type MatchActionPayload = z.infer<typeof actionSchema>;

const DEFAULT_CHAT_HISTORY_LIMIT = 25;
const DEFAULT_CHAT_MESSAGE_MAX_LENGTH = 200;

export interface P2PHostOrchestratorOptions {
  now?: () => number;
  identityFactory?: P2PHostIdentityFactory;
  chatHistoryLimit?: number;
  chatMessageMaxLength?: number;
}

export interface P2PGuestAcceptanceOptions {
  displayName: string;
  bindingId?: string | null;
}

export interface P2PHostCommandResult {
  steps: P2PHostFanoutStep[];
}

export interface P2PRemoteGuestCommand {
  bindingId: string | null;
  event: ClientEvent;
}

export interface P2PGuestReconnectOptions {
  bindingId: string | null;
}

const normalizeChatText = (text: string): string => text.replace(/\r\n?/g, "\n").trim();

const normalizeDisplayName = (displayName: string): string => displayNameSchema.parse(displayName);

export class P2PHostOrchestrator {
  private readonly now: () => number;
  private readonly identityFactory: P2PHostIdentityFactory;
  private readonly chatHistoryLimit: number;
  private readonly chatMessageMaxLength: number;
  private state: P2PHostRuntimeState = createInitialP2PHostRuntimeState();

  constructor(options: P2PHostOrchestratorOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.identityFactory = options.identityFactory ?? createDefaultP2PHostIdentityFactory();
    this.chatHistoryLimit = options.chatHistoryLimit ?? DEFAULT_CHAT_HISTORY_LIMIT;
    this.chatMessageMaxLength = options.chatMessageMaxLength ?? DEFAULT_CHAT_MESSAGE_MAX_LENGTH;
  }

  getState(): P2PHostRuntimeState {
    return cloneP2PHostRuntimeState(this.state);
  }

  hydrate(snapshot: P2PHostAuthoritySnapshot): void {
    const restored = validateHostAuthoritySnapshot(snapshot);

    if (!restored) {
      throw new Error("Invalid host recovery snapshot.");
    }

    this.state = restored;
  }

  createRoom(displayName: string, boardSize: BoardSize): P2PHostCommandResult {
    if (this.state.room) {
      throw new Error("A direct match room is already active.");
    }

    const now = this.now();
    const hostPlayer = this.createPlayer(displayName);
    const room: P2PHostRoomRecord = {
      roomId: this.identityFactory.createId(),
      roomCode: this.identityFactory.createRoomCode(),
      inviteToken: this.identityFactory.createInviteToken(),
      players: [hostPlayer],
      nextStarterIndex: 0,
      boardSize,
      createdAt: now,
      updatedAt: now
    };
    const hostSession = createHostSessionRecord(room, hostPlayer, this.identityFactory.createId);

    this.state = {
      room,
      hostSession,
      guestSession: null,
      chatMessages: [],
      match: null
    };

    return {
      steps: [
        createHostLocalFanoutStep(buildRoomCreatedEvent(room, hostSession)),
        createHostLocalFanoutStep(buildChatHistoryEvent(room.roomCode, this.state.chatMessages))
      ]
    };
  }

  acceptGuest({ displayName, bindingId = null }: P2PGuestAcceptanceOptions): P2PHostCommandResult {
    const room = this.requireRoom();

    if (this.state.guestSession || room.players.length >= 2) {
      throw new Error("That room is already full.");
    }

    const guestPlayer = this.createPlayer(displayName);
    const updatedRoom: P2PHostRoomRecord = {
      ...room,
      inviteToken: null,
      players: [...room.players, guestPlayer],
      updatedAt: this.now()
    };
    const guestSession = createGuestSessionRecord(
      updatedRoom,
      guestPlayer,
      this.identityFactory.createId,
      bindingId
    );
    const match = this.startMatch(updatedRoom);

    this.state = {
      ...this.state,
      room: updatedRoom,
      guestSession,
      match
    };

    return {
      steps: [
        createGuestFanoutStep(buildRoomJoinedEvent(updatedRoom, guestSession)),
        createGuestFanoutStep(buildChatHistoryEvent(updatedRoom.roomCode, this.state.chatMessages)),
        createBroadcastFanoutStep(buildRoomStateEvent(updatedRoom)),
        createBroadcastFanoutStep(buildMatchStartedEvent(updatedRoom.roomCode, match))
      ]
    };
  }

  sendHostChat(text: string): P2PHostCommandResult {
    return this.sendChat(this.requireHostSession(), text);
  }

  sendGuestChat(text: string): P2PHostCommandResult {
    return this.sendChat(this.requireGuestSession(), text);
  }

  applyHostAction(action: MatchActionPayload): P2PHostCommandResult {
    return this.applyMatchAction(this.requireHostSession(), action);
  }

  applyGuestAction(action: MatchActionPayload): P2PHostCommandResult {
    return this.applyMatchAction(this.requireGuestSession(), action);
  }

  resignHost(): P2PHostCommandResult {
    return this.resign(this.requireHostSession());
  }

  resignGuest(): P2PHostCommandResult {
    return this.resign(this.requireGuestSession());
  }

  requestHostRematch(): P2PHostCommandResult {
    return this.setRematchRequest(this.requireHostSession(), true);
  }

  requestGuestRematch(): P2PHostCommandResult {
    return this.setRematchRequest(this.requireGuestSession(), true);
  }

  cancelHostRematch(): P2PHostCommandResult {
    return this.setRematchRequest(this.requireHostSession(), false);
  }

  cancelGuestRematch(): P2PHostCommandResult {
    return this.setRematchRequest(this.requireGuestSession(), false);
  }

  applyRemoteGuestCommand({ bindingId, event }: P2PRemoteGuestCommand): P2PHostCommandResult {
    const guestSession = this.state.guestSession;

    if (!guestSession || !matchesGuestBinding(guestSession, bindingId)) {
      return { steps: [] };
    }

    if (
      event.type === CLIENT_EVENT_NAMES.roomCreate ||
      event.type === CLIENT_EVENT_NAMES.roomJoin ||
      event.type === CLIENT_EVENT_NAMES.roomCancel
    ) {
      return { steps: [] };
    }

    if (!matchesGuestCommandScope(guestSession, event.payload)) {
      return this.rejectRemoteGuestCommand(guestSession);
    }

    switch (event.type) {
      case CLIENT_EVENT_NAMES.chatSend:
        return this.sendGuestChat(event.payload.text);
      case CLIENT_EVENT_NAMES.matchAction:
        return this.applyGuestAction(event.payload.action);
      case CLIENT_EVENT_NAMES.matchResign:
        return this.resignGuest();
      case CLIENT_EVENT_NAMES.matchRematchRequest:
        return this.requestGuestRematch();
      case CLIENT_EVENT_NAMES.matchRematchCancel:
        return this.cancelGuestRematch();
      case CLIENT_EVENT_NAMES.playerReconnect:
        return this.replayGuestReconnect({ bindingId });
    }
  }

  rebindGuest(bindingId: string | null): void {
    if (!this.state.guestSession) {
      return;
    }

    this.state = {
      ...this.state,
      guestSession: {
        ...this.state.guestSession,
        bindingId
      }
    };
  }

  private createPlayer(displayName: string): P2PRoomPlayerRecord {
    return {
      playerId: this.identityFactory.createId(),
      displayName: normalizeDisplayName(displayName)
    };
  }

  private rejectRemoteGuestCommand(session: P2PGuestSessionRecord): P2PHostCommandResult {
    return {
      steps: [
        this.createActorStep(session, {
          type: SERVER_EVENT_NAMES.serverError,
          payload: {
            message: "That session is not valid for this room."
          }
        })
      ]
    };
  }

  private sendChat(session: P2PBaseSessionRecord, text: string): P2PHostCommandResult {
    const room = this.requireRoom();
    const normalizedText = normalizeChatText(text);

    if (!normalizedText) {
      return {
        steps: [
          this.createActorStep(
            session,
            buildChatRejectedEvent(room.roomCode, "Type a message before sending.")
          )
        ]
      };
    }

    if (normalizedText.length > this.chatMessageMaxLength) {
      return {
        steps: [
          this.createActorStep(
            session,
            buildChatRejectedEvent(
              room.roomCode,
              `Chat messages can be at most ${this.chatMessageMaxLength} characters.`
            )
          )
        ]
      };
    }

    const message: ChatMessageDto = {
      messageId: this.identityFactory.createId(),
      playerId: session.playerId,
      displayName: session.displayName,
      text: normalizedText,
      sentAt: this.now()
    };
    const nextMessages = [...this.state.chatMessages, message].slice(-this.chatHistoryLimit);

    this.state = {
      ...this.state,
      room: {
        ...room,
        updatedAt: message.sentAt
      },
      chatMessages: nextMessages
    };

    return {
      steps: [createBroadcastFanoutStep(buildChatMessageEvent(room.roomCode, message))]
    };
  }

  private applyMatchAction(
    session: P2PBaseSessionRecord,
    action: MatchActionPayload
  ): P2PHostCommandResult {
    const room = this.requireRoom();
    const match = this.requireMatch();
    const resolved = resolveAction(
      match,
      { ...action, playerId: session.playerId } as MatchAction,
      this.now()
    );

    if (!resolved.ok) {
      return {
        steps: [
          this.createActorStep(
            session,
            buildMatchActionRejectedEvent(room.roomCode, resolved.error)
          )
        ]
      };
    }

    this.storeMatch(room, resolved.state, resolved.state.updatedAt);

    return {
      steps: [
        createBroadcastFanoutStep(
          resolved.state.phase === "finished"
            ? buildMatchEndedEvent(room.roomCode, resolved.state)
            : buildMatchStateEvent(room.roomCode, resolved.state)
        )
      ]
    };
  }

  private resign(session: P2PBaseSessionRecord): P2PHostCommandResult {
    const room = this.requireRoom();

    try {
      const nextMatch = resignMatch(this.requireMatch(), session.playerId, this.now());

      this.storeMatch(room, nextMatch, nextMatch.updatedAt);

      return {
        steps: [createBroadcastFanoutStep(buildMatchEndedEvent(room.roomCode, nextMatch))]
      };
    } catch (error) {
      return {
        steps: [
          this.createActorStep(
            session,
            buildMatchActionRejectedEvent(
              room.roomCode,
              error instanceof Error ? error.message : "The resign action was rejected."
            )
          )
        ]
      };
    }
  }

  private setRematchRequest(
    session: P2PBaseSessionRecord,
    requested: boolean
  ): P2PHostCommandResult {
    const room = this.requireRoom();
    const match = this.requireMatch();

    if (match.phase !== "finished") {
      return this.rejectRematchBeforeMatchEnd(session);
    }

    const current = setPlayerRematchRequested(match, session.playerId, requested);
    const readyCount = current.players.filter((player) => player.rematchRequested).length;

    if (requested && readyCount === 2) {
      const nextStarterIndex = room.nextStarterIndex === 0 ? 1 : 0;
      const updatedRoom: P2PHostRoomRecord = {
        ...room,
        nextStarterIndex,
        updatedAt: this.now()
      };
      const started = this.startMatch(updatedRoom);

      this.state = {
        ...this.state,
        room: updatedRoom,
        match: started
      };

      return {
        steps: [
          createBroadcastFanoutStep(buildRematchUpdatedEvent(updatedRoom.roomCode, started, 0)),
          createBroadcastFanoutStep(buildMatchStartedEvent(updatedRoom.roomCode, started))
        ]
      };
    }

    this.storeMatch(room, current, this.now());

    return {
      steps: [
        createBroadcastFanoutStep(buildRematchUpdatedEvent(room.roomCode, current, readyCount))
      ]
    };
  }

  disconnectGuest(): P2PHostCommandResult {
    const change = disconnectGuest(this.state);

    this.state = change.state;
    return { steps: change.steps };
  }

  private replayGuestReconnect({ bindingId }: P2PGuestReconnectOptions): P2PHostCommandResult {
    const change = reconnectGuest(
      this.state,
      this.requireRoom(),
      this.requireGuestSession(),
      bindingId
    );

    this.state = change.state;
    return { steps: change.steps };
  }

  private storeMatch(room: P2PHostRoomRecord, match: MatchState, updatedAt: number): void {
    this.state = {
      ...this.state,
      room: {
        ...room,
        updatedAt
      },
      match
    };
  }

  private rejectRematchBeforeMatchEnd(session: P2PBaseSessionRecord): P2PHostCommandResult {
    return {
      steps: [
        this.createActorStep(session, {
          type: SERVER_EVENT_NAMES.serverError,
          payload: {
            message: "Rematch is only available once the current match has ended."
          }
        })
      ]
    };
  }

  private startMatch(room: P2PHostRoomRecord): MatchState {
    const [firstPlayer, secondPlayer] = room.players;
    const startedAt = this.now();

    if (!firstPlayer || !secondPlayer) {
      throw new Error("Two players are required to start a match.");
    }

    return createMatchState({
      roomId: room.roomId,
      players: [firstPlayer, secondPlayer],
      seed: startedAt,
      createdAt: startedAt,
      startingPlayerId: room.players[room.nextStarterIndex]?.playerId ?? firstPlayer.playerId,
      boardSize: room.boardSize
    });
  }

  private createActorStep(session: P2PBaseSessionRecord, event: ServerEvent): P2PHostFanoutStep {
    return session.role === "host"
      ? createHostLocalFanoutStep(event)
      : createGuestFanoutStep(event);
  }

  private requireRoom(): P2PHostRoomRecord {
    if (!this.state.room) {
      throw new Error("Create a direct match room before running host commands.");
    }

    return this.state.room;
  }

  private requireHostSession(): P2PHostSessionRecord {
    if (!this.state.hostSession) {
      throw new Error("Create a direct match room before using the host session.");
    }

    return this.state.hostSession;
  }

  private requireGuestSession(): P2PGuestSessionRecord {
    if (!this.state.guestSession) {
      throw new Error("Accept a guest before using the guest session.");
    }

    return this.state.guestSession;
  }

  private requireMatch(): MatchState {
    if (!this.state.match) {
      throw new Error("The match has not started yet.");
    }

    return this.state.match;
  }
}
