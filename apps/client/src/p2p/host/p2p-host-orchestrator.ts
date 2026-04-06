import {
  createMatchState,
  resignMatch,
  resolveAction,
  setPlayerRematchRequested,
  type MatchAction,
  type MatchState
} from "@minesweeper-flags/game-engine";
import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  displayNameSchema,
  toMatchStateDto,
  type ClientEvent,
  type ChatMessageDto,
  type ServerEvent,
  type actionSchema
} from "@minesweeper-flags/shared";
import type { z } from "zod";
import {
  createBroadcastFanoutStep,
  createGuestFanoutStep,
  createHostLocalFanoutStep,
  type P2PHostFanoutStep
} from "./p2p-host-events.js";
import {
  createDefaultP2PHostIdentityFactory,
  createGuestSessionRecord,
  createHostSessionRecord,
  matchesGuestBinding,
  matchesGuestCommandScope,
  type P2PBaseSessionRecord,
  type P2PBoundGuestCommandScope,
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
import { validateHostAuthoritySnapshot } from "../storage/p2p-recovery-storage.js";

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

const cloneRoomPlayers = (players: readonly P2PRoomPlayerRecord[]): P2PRoomPlayerRecord[] =>
  players.map((player) => ({ ...player }));

const cloneChatMessages = (messages: readonly ChatMessageDto[]): ChatMessageDto[] =>
  messages.map((message) => ({ ...message }));

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

  createRoom(displayName: string): P2PHostCommandResult {
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
        createHostLocalFanoutStep(this.buildRoomCreatedEvent(room, hostSession)),
        createHostLocalFanoutStep(this.buildChatHistoryEvent(room.roomCode))
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
        createGuestFanoutStep(this.buildRoomJoinedEvent(updatedRoom, guestSession)),
        createGuestFanoutStep(this.buildChatHistoryEvent(updatedRoom.roomCode)),
        createBroadcastFanoutStep(this.buildRoomStateEvent(updatedRoom)),
        createBroadcastFanoutStep(this.buildMatchStartedEvent(updatedRoom.roomCode, match))
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
    return this.requestRematch(this.requireHostSession());
  }

  requestGuestRematch(): P2PHostCommandResult {
    return this.requestRematch(this.requireGuestSession());
  }

  cancelHostRematch(): P2PHostCommandResult {
    return this.cancelRematch(this.requireHostSession());
  }

  cancelGuestRematch(): P2PHostCommandResult {
    return this.cancelRematch(this.requireGuestSession());
  }

  applyRemoteGuestCommand({ bindingId, event }: P2PRemoteGuestCommand): P2PHostCommandResult {
    const guestSession = this.state.guestSession;

    if (!guestSession || !matchesGuestBinding(guestSession, bindingId)) {
      return { steps: [] };
    }

    switch (event.type) {
      case CLIENT_EVENT_NAMES.chatSend: {
        if (!this.isGuestCommandInScope(guestSession, event.payload)) {
          return this.rejectRemoteGuestCommand(guestSession);
        }

        return this.sendGuestChat(event.payload.text);
      }
      case CLIENT_EVENT_NAMES.matchAction: {
        if (!this.isGuestCommandInScope(guestSession, event.payload)) {
          return this.rejectRemoteGuestCommand(guestSession);
        }

        return this.applyGuestAction(event.payload.action);
      }
      case CLIENT_EVENT_NAMES.matchResign: {
        if (!this.isGuestCommandInScope(guestSession, event.payload)) {
          return this.rejectRemoteGuestCommand(guestSession);
        }

        return this.resignGuest();
      }
      case CLIENT_EVENT_NAMES.matchRematchRequest: {
        if (!this.isGuestCommandInScope(guestSession, event.payload)) {
          return this.rejectRemoteGuestCommand(guestSession);
        }

        return this.requestGuestRematch();
      }
      case CLIENT_EVENT_NAMES.matchRematchCancel: {
        if (!this.isGuestCommandInScope(guestSession, event.payload)) {
          return this.rejectRemoteGuestCommand(guestSession);
        }

        return this.cancelGuestRematch();
      }
      case CLIENT_EVENT_NAMES.playerReconnect: {
        if (!this.isGuestCommandInScope(guestSession, event.payload)) {
          return this.rejectRemoteGuestCommand(guestSession);
        }

        return this.replayGuestReconnect({ bindingId });
      }
      case CLIENT_EVENT_NAMES.roomCreate:
      case CLIENT_EVENT_NAMES.roomJoin:
        return { steps: [] };
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

  private isGuestCommandInScope(
    session: P2PGuestSessionRecord,
    scope: P2PBoundGuestCommandScope
  ): boolean {
    return matchesGuestCommandScope(session, scope);
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
        steps: [this.createActorStep(session, this.buildChatRejectedEvent(room.roomCode, "Type a message before sending."))]
      };
    }

    if (normalizedText.length > this.chatMessageMaxLength) {
      return {
        steps: [
          this.createActorStep(
            session,
            this.buildChatRejectedEvent(
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
      steps: [createBroadcastFanoutStep(this.buildChatMessageEvent(room.roomCode, message))]
    };
  }

  private applyMatchAction(session: P2PBaseSessionRecord, action: MatchActionPayload): P2PHostCommandResult {
    const room = this.requireRoom();
    const match = this.requireMatch();
    const resolved = resolveAction(match, { ...action, playerId: session.playerId } as MatchAction, this.now());

    if (!resolved.ok) {
      return {
        steps: [
          this.createActorStep(session, {
            type: SERVER_EVENT_NAMES.matchActionRejected,
            payload: {
              roomCode: room.roomCode,
              message: resolved.error
            }
          })
        ]
      };
    }

    this.state = {
      ...this.state,
      room: {
        ...room,
        updatedAt: resolved.state.updatedAt
      },
      match: resolved.state
    };

    return {
      steps: [
        createBroadcastFanoutStep(
          resolved.state.phase === "finished"
            ? this.buildMatchEndedEvent(room.roomCode, resolved.state)
            : this.buildMatchStateEvent(room.roomCode, resolved.state)
        )
      ]
    };
  }

  private resign(session: P2PBaseSessionRecord): P2PHostCommandResult {
    const room = this.requireRoom();

    try {
      const nextMatch = resignMatch(this.requireMatch(), session.playerId, this.now());

      this.state = {
        ...this.state,
        room: {
          ...room,
          updatedAt: nextMatch.updatedAt
        },
        match: nextMatch
      };

      return {
        steps: [createBroadcastFanoutStep(this.buildMatchEndedEvent(room.roomCode, nextMatch))]
      };
    } catch (error) {
      return {
        steps: [
          this.createActorStep(session, {
            type: SERVER_EVENT_NAMES.matchActionRejected,
            payload: {
              roomCode: room.roomCode,
              message:
                error instanceof Error ? error.message : "The resign action was rejected."
            }
          })
        ]
      };
    }
  }

  private requestRematch(session: P2PBaseSessionRecord): P2PHostCommandResult {
    const room = this.requireRoom();
    const match = this.requireMatch();

    if (match.phase !== "finished") {
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

    const current = setPlayerRematchRequested(match, session.playerId, true);
    const readyCount = current.players.filter((player) => player.rematchRequested).length;

    if (readyCount === 2) {
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
          createBroadcastFanoutStep(this.buildRematchUpdatedEvent(updatedRoom.roomCode, started, 0)),
          createBroadcastFanoutStep(this.buildMatchStartedEvent(updatedRoom.roomCode, started))
        ]
      };
    }

    this.state = {
      ...this.state,
      room: {
        ...room,
        updatedAt: this.now()
      },
      match: current
    };

    return {
      steps: [createBroadcastFanoutStep(this.buildRematchUpdatedEvent(room.roomCode, current, readyCount))]
    };
  }

  private cancelRematch(session: P2PBaseSessionRecord): P2PHostCommandResult {
    const room = this.requireRoom();
    const match = this.requireMatch();

    if (match.phase !== "finished") {
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

    const current = setPlayerRematchRequested(match, session.playerId, false);
    const readyCount = current.players.filter((player) => player.rematchRequested).length;

    this.state = {
      ...this.state,
      room: {
        ...room,
        updatedAt: this.now()
      },
      match: current
    };

    return {
      steps: [createBroadcastFanoutStep(this.buildRematchUpdatedEvent(room.roomCode, current, readyCount))]
    };
  }

  private replayGuestReconnect({ bindingId }: P2PGuestReconnectOptions): P2PHostCommandResult {
    const room = this.requireRoom();
    const guestSession = this.requireGuestSession();

    this.rebindGuest(bindingId);

    const steps: P2PHostFanoutStep[] = [
      createGuestFanoutStep(this.buildRoomJoinedEvent(room, { ...guestSession, bindingId })),
      createGuestFanoutStep(this.buildChatHistoryEvent(room.roomCode)),
      createBroadcastFanoutStep(this.buildPlayerReconnectedEvent(room.roomCode, guestSession.playerId))
    ];

    if (this.state.match) {
      steps.push(
        createGuestFanoutStep(
          this.state.match.phase === "finished"
            ? this.buildMatchEndedEvent(room.roomCode, this.state.match)
            : this.state.match.lastAction === null
              ? this.buildMatchStartedEvent(room.roomCode, this.state.match)
              : this.buildMatchStateEvent(room.roomCode, this.state.match)
        )
      );
    }

    return { steps };
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
      startingPlayerId: room.players[room.nextStarterIndex]?.playerId ?? firstPlayer.playerId
    });
  }

  private createActorStep(session: P2PBaseSessionRecord, event: ServerEvent): P2PHostFanoutStep {
    return session.role === "host" ? createHostLocalFanoutStep(event) : createGuestFanoutStep(event);
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

  private buildRoomCreatedEvent(
    room: P2PHostRoomRecord,
    session: P2PHostSessionRecord
  ): ServerEvent {
    if (!room.inviteToken) {
      throw new Error("Created rooms must include an invite token.");
    }

    return {
      type: SERVER_EVENT_NAMES.roomCreated,
      payload: {
        roomId: room.roomId,
        roomCode: room.roomCode,
        inviteToken: room.inviteToken,
        self: {
          playerId: session.playerId,
          displayName: session.displayName,
          sessionToken: session.sessionToken
        },
        players: cloneRoomPlayers(room.players)
      }
    };
  }

  private buildRoomJoinedEvent(room: P2PHostRoomRecord, session: P2PGuestSessionRecord): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.roomJoined,
      payload: {
        roomId: room.roomId,
        roomCode: room.roomCode,
        self: {
          playerId: session.playerId,
          displayName: session.displayName,
          sessionToken: session.sessionToken
        },
        players: cloneRoomPlayers(room.players)
      }
    };
  }

  private buildRoomStateEvent(room: P2PHostRoomRecord): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: room.roomId,
        roomCode: room.roomCode,
        players: cloneRoomPlayers(room.players)
      }
    };
  }

  private buildChatHistoryEvent(roomCode: string): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.chatHistory,
      payload: {
        roomCode,
        messages: cloneChatMessages(this.state.chatMessages)
      }
    };
  }

  private buildChatMessageEvent(roomCode: string, message: ChatMessageDto): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.chatMessage,
      payload: {
        roomCode,
        message: { ...message }
      }
    };
  }

  private buildChatRejectedEvent(roomCode: string, message: string): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.chatMessageRejected,
      payload: {
        roomCode,
        message
      }
    };
  }

  private buildMatchStartedEvent(roomCode: string, match: MatchState): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.matchStarted,
      payload: {
        roomCode,
        match: toMatchStateDto(match)
      }
    };
  }

  private buildMatchStateEvent(roomCode: string, match: MatchState): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.matchState,
      payload: {
        roomCode,
        match: toMatchStateDto(match)
      }
    };
  }

  private buildMatchEndedEvent(roomCode: string, match: MatchState): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.matchEnded,
      payload: {
        roomCode,
        match: toMatchStateDto(match)
      }
    };
  }

  private buildRematchUpdatedEvent(roomCode: string, match: MatchState, readyCount: number): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.matchRematchUpdated,
      payload: {
        roomCode,
        players: match.players.map((player) => ({
          playerId: player.playerId,
          rematchRequested: player.rematchRequested
        })),
        readyCount
      }
    };
  }

  private buildPlayerReconnectedEvent(roomCode: string, playerId: string): ServerEvent {
    return {
      type: SERVER_EVENT_NAMES.playerReconnected,
      payload: {
        roomCode,
        playerId
      }
    };
  }
}
