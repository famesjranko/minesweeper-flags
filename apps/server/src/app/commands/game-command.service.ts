import {
  SERVER_EVENT_NAMES,
  type ChatMessageDto,
  type MatchStateDto,
  type ServerEvent,
  type RoomStreamEvent,
  type actionSchema
} from "@minesweeper-flags/shared";
import type { z } from "zod";
import { logger } from "../../lib/logging/logger.js";
import type { ChatService } from "../../modules/chat/chat.service.js";
import type { MatchService } from "../../modules/matches/match.service.js";
import type { RematchService } from "../../modules/rematch/rematch.service.js";
import type { RoomRecord } from "../../modules/rooms/room.types.js";
import type { RoomService } from "../../modules/rooms/room.service.js";
import {
  PlayerSessionService,
  type PlayerSession
} from "../realtime/player-session.service.js";
import {
  createBroadcastStep,
  createDirectStep,
  type CommandExecution
} from "./game-command.types.js";

type MatchActionPayload = z.infer<typeof actionSchema>;

interface GameCommandServiceDependencies {
  roomService: RoomService;
  matchService: MatchService;
  chatService: ChatService;
  rematchService: RematchService;
  playerSessionService: PlayerSessionService;
  now?: () => number;
}

export class GameCommandService {
  private readonly now: () => number;

  constructor(private readonly dependencies: GameCommandServiceDependencies) {
    this.now = dependencies.now ?? (() => Date.now());
  }

  async createRoom(displayName: string): Promise<CommandExecution> {
    const { roomService, playerSessionService } = this.dependencies;
    const { room, player } = await roomService.createRoom(displayName);

    if (!room.inviteToken) {
      throw new Error("Created rooms must include an invite token.");
    }

    const session = await playerSessionService.createSession(room.roomCode, player);

    logger.info("room.created", {
      roomId: room.roomId,
      roomCode: room.roomCode,
      playerId: session.playerId
    });

    return {
      sessionToBind: session,
      steps: [
        createDirectStep(this.buildRoomCreatedEvent(room, session)),
        createDirectStep(await this.buildChatHistoryEvent(room.roomCode))
      ]
    };
  }

  async joinRoom(inviteToken: string, displayName: string): Promise<CommandExecution> {
    const { roomService, matchService, playerSessionService } = this.dependencies;
    const { room, player } = await roomService.joinRoomByInviteToken(inviteToken, displayName);
    const session = await playerSessionService.createSession(room.roomCode, player);

    logger.info("room.joined", {
      roomId: room.roomId,
      roomCode: room.roomCode,
      playerId: session.playerId,
      playerCount: room.players.length
    });

    const startedMatch = await matchService.startMatchForRoom(room, this.now());

    return {
      sessionToBind: session,
      steps: [
        createDirectStep(this.buildRoomJoinedEvent(room, session)),
        createDirectStep(await this.buildChatHistoryEvent(room.roomCode)),
        createBroadcastStep(room.roomCode, this.buildRoomStateEvent(room)),
        createBroadcastStep(room.roomCode, {
          type: SERVER_EVENT_NAMES.matchStarted,
          payload: {
            roomCode: room.roomCode,
            match: startedMatch.dto
          }
        })
      ]
    };
  }

  async reconnectPlayer(roomCode: string, sessionToken: string): Promise<CommandExecution> {
    const { playerSessionService, roomService, matchService } = this.dependencies;
    const session = await playerSessionService.requireSession(roomCode, sessionToken);
    const room = await roomService.getRoomByCode(session.roomCode);

    await roomService.touchRoomActivity(session.roomCode);

    if (!room.players.find((player) => player.playerId === session.playerId)) {
      throw new Error("That player is not part of this room.");
    }

    const updated = await matchService.setConnectionState(session.roomCode, session.playerId, true);

    logger.info("realtime.player_reconnected", {
      roomCode: session.roomCode,
      playerId: session.playerId
    });

    const steps: CommandExecution["steps"] = [
      createDirectStep(this.buildRoomStateEvent(room)),
      createDirectStep(await this.buildChatHistoryEvent(session.roomCode)),
      createBroadcastStep(session.roomCode, {
        type: SERVER_EVENT_NAMES.playerReconnected,
        payload: {
          roomCode: session.roomCode,
          playerId: session.playerId
        }
      })
    ];

    if (updated) {
      steps.push(createBroadcastStep(session.roomCode, this.buildMatchStateEvent(session.roomCode, updated.dto)));
    }

    return {
      sessionToBind: session,
      steps
    };
  }

  async sendChat(session: PlayerSession, text: string): Promise<CommandExecution> {
    const { chatService, roomService } = this.dependencies;

    try {
      const message = await chatService.sendMessage(
        session.roomCode,
        {
          playerId: session.playerId,
          displayName: session.displayName
        },
        text,
        this.now()
      );

      await roomService.touchRoomActivity(session.roomCode, message.sentAt);

      return {
        steps: [
          createBroadcastStep(session.roomCode, this.buildChatMessageEvent(session.roomCode, message))
        ]
      };
    } catch (error) {
      logger.warn("chat.message_rejected", {
        roomCode: session.roomCode,
        playerId: session.playerId,
        reason: error instanceof Error ? error.message : "Chat message rejected."
      });

      return {
        steps: [
          createDirectStep({
            type: SERVER_EVENT_NAMES.chatMessageRejected,
            payload: {
              roomCode: session.roomCode,
              message: error instanceof Error ? error.message : "Chat message rejected."
            }
          })
        ]
      };
    }
  }

  async applyMatchAction(
    session: PlayerSession,
    action: MatchActionPayload
  ): Promise<CommandExecution> {
    const { matchService, roomService } = this.dependencies;

    try {
      const result = await matchService.applyAction(
        session.roomCode,
        session.playerId,
        action,
        this.now()
      );

      await roomService.touchRoomActivity(session.roomCode, result.state.updatedAt);

      return {
        steps: [
          createBroadcastStep(
            result.roomCode,
            result.state.phase === "finished"
              ? this.buildMatchEndedEvent(result.roomCode, result.dto)
              : this.buildMatchStateEvent(result.roomCode, result.dto)
          )
        ]
      };
    } catch (error) {
      logger.warn("match.action_rejected", {
        roomCode: session.roomCode,
        playerId: session.playerId,
        reason: error instanceof Error ? error.message : "The action was rejected."
      });

      return {
        steps: [
          createDirectStep({
            type: SERVER_EVENT_NAMES.matchActionRejected,
            payload: {
              roomCode: session.roomCode,
              message: error instanceof Error ? error.message : "The action was rejected."
            }
          })
        ]
      };
    }
  }

  async resignMatch(session: PlayerSession): Promise<CommandExecution> {
    const { matchService, roomService } = this.dependencies;

    try {
      const result = await matchService.resign(session.roomCode, session.playerId, this.now());

      await roomService.touchRoomActivity(session.roomCode, result.state.updatedAt);

      return {
        steps: [createBroadcastStep(result.roomCode, this.buildMatchEndedEvent(result.roomCode, result.dto))]
      };
    } catch (error) {
      logger.warn("match.resign_rejected", {
        roomCode: session.roomCode,
        playerId: session.playerId,
        reason: error instanceof Error ? error.message : "The resign action was rejected."
      });

      return {
        steps: [
          createDirectStep({
            type: SERVER_EVENT_NAMES.matchActionRejected,
            payload: {
              roomCode: session.roomCode,
              message: error instanceof Error ? error.message : "The resign action was rejected."
            }
          })
        ]
      };
    }
  }

  async requestRematch(session: PlayerSession): Promise<CommandExecution> {
    const { rematchService, roomService } = this.dependencies;

    try {
      const result = await rematchService.requestRematch(
        session.roomCode,
        session.playerId,
        this.now()
      );

      await roomService.touchRoomActivity(session.roomCode);

      const steps: CommandExecution["steps"] = [
        createBroadcastStep(session.roomCode, {
          type: SERVER_EVENT_NAMES.matchRematchUpdated,
          payload: {
            roomCode: session.roomCode,
            players: result.players,
            readyCount: result.readyCount
          }
        })
      ];

      if (result.match) {
        steps.push(
          createBroadcastStep(session.roomCode, {
            type: SERVER_EVENT_NAMES.matchStarted,
            payload: {
              roomCode: session.roomCode,
              match: result.match
            }
          })
        );
      }

      return { steps };
    } catch (error) {
      logger.warn("match.rematch_request_rejected", {
        roomCode: session.roomCode,
        playerId: session.playerId,
        reason: error instanceof Error ? error.message : "Rematch failed."
      });

      return {
        steps: [
          createDirectStep({
            type: SERVER_EVENT_NAMES.serverError,
            payload: {
              message: error instanceof Error ? error.message : "Rematch failed."
            }
          })
        ]
      };
    }
  }

  async cancelRematch(session: PlayerSession): Promise<CommandExecution> {
    const { rematchService, roomService } = this.dependencies;

    try {
      const result = await rematchService.cancelRematch(session.roomCode, session.playerId);

      await roomService.touchRoomActivity(session.roomCode);

      return {
        steps: [
          createBroadcastStep(session.roomCode, {
            type: SERVER_EVENT_NAMES.matchRematchUpdated,
            payload: {
              roomCode: session.roomCode,
              players: result.players,
              readyCount: result.readyCount
            }
          })
        ]
      };
    } catch (error) {
      logger.warn("match.rematch_cancel_rejected", {
        roomCode: session.roomCode,
        playerId: session.playerId,
        reason: error instanceof Error ? error.message : "Rematch update failed."
      });

      return {
        steps: [
          createDirectStep({
            type: SERVER_EVENT_NAMES.serverError,
            payload: {
              message: error instanceof Error ? error.message : "Rematch update failed."
            }
          })
        ]
      };
    }
  }

  async disconnectPlayer(session: PlayerSession): Promise<CommandExecution> {
    const { roomService, matchService } = this.dependencies;
    const room = await roomService.getRoomByPlayerId(session.playerId);

    if (!room) {
      return { steps: [] };
    }

    await roomService.touchRoomActivity(room.roomCode);

    const updated = await matchService.setConnectionState(room.roomCode, session.playerId, false);

    logger.info("realtime.player_disconnected", {
      roomCode: room.roomCode,
      playerId: session.playerId
    });

    const steps: CommandExecution["steps"] = [
      createBroadcastStep(room.roomCode, {
        type: SERVER_EVENT_NAMES.playerDisconnected,
        payload: {
          roomCode: room.roomCode,
          playerId: session.playerId
        }
      })
    ];

    if (updated) {
      steps.push(createBroadcastStep(room.roomCode, this.buildMatchStateEvent(room.roomCode, updated.dto)));
    }

    return { steps };
  }

  private async buildChatHistoryEvent(roomCode: string): Promise<ServerEvent> {
    const messages = await this.dependencies.chatService.listRecentMessages(roomCode);

    return {
      type: SERVER_EVENT_NAMES.chatHistory,
      payload: {
        roomCode,
        messages
      }
    };
  }

  private buildRoomCreatedEvent(room: RoomRecord, session: PlayerSession): ServerEvent {
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
        players: room.players
      }
    };
  }

  private buildRoomJoinedEvent(room: RoomRecord, session: PlayerSession): ServerEvent {
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
        players: room.players
      }
    };
  }

  private buildRoomStateEvent(room: RoomRecord): RoomStreamEvent {
    return {
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: room.roomId,
        roomCode: room.roomCode,
        players: room.players
      }
    };
  }

  private buildChatMessageEvent(roomCode: string, message: ChatMessageDto): RoomStreamEvent {
    return {
      type: SERVER_EVENT_NAMES.chatMessage,
      payload: {
        roomCode,
        message
      }
    };
  }

  private buildMatchStateEvent(roomCode: string, match: MatchStateDto): RoomStreamEvent {
    return {
      type: SERVER_EVENT_NAMES.matchState,
      payload: {
        roomCode,
        match
      }
    };
  }

  private buildMatchEndedEvent(roomCode: string, match: MatchStateDto): RoomStreamEvent {
    return {
      type: SERVER_EVENT_NAMES.matchEnded,
      payload: {
        roomCode,
        match
      }
    };
  }
}
