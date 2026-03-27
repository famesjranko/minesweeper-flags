import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVER_EVENT_NAMES } from "@minesweeper-flags/shared";
import { InMemoryChatRepository } from "../../modules/chat/chat.repository.js";
import { ChatService } from "../../modules/chat/chat.service.js";
import { InMemoryMatchRepository } from "../../modules/matches/match.repository.js";
import { MatchService } from "../../modules/matches/match.service.js";
import { InMemoryRoomRepository } from "../../modules/rooms/room.repository.js";
import { RoomService } from "../../modules/rooms/room.service.js";
import { RematchService } from "../../modules/rematch/rematch.service.js";
import { logger } from "../../lib/logging/logger.js";
import {
  InMemoryPlayerSessionStore,
  PlayerSessionService
} from "../realtime/player-session.service.js";
import { GameCommandService } from "./game-command.service.js";

const TEST_CHAT_HISTORY_LIMIT = 25;
const TEST_CHAT_MESSAGE_MAX_LENGTH = 200;
const FIXED_NOW = 1_717_171_717;

const createCommandService = () => {
  const roomService = new RoomService(new InMemoryRoomRepository());
  const matchService = new MatchService(roomService, new InMemoryMatchRepository());
  const chatService = new ChatService(
    roomService,
    new InMemoryChatRepository(TEST_CHAT_HISTORY_LIMIT),
    {
      historyLimit: TEST_CHAT_HISTORY_LIMIT,
      messageMaxLength: TEST_CHAT_MESSAGE_MAX_LENGTH
    }
  );
  const playerSessionService = new PlayerSessionService(new InMemoryPlayerSessionStore());

  return {
    roomService,
    matchService,
    chatService,
    playerSessionService,
    commandService: new GameCommandService({
      roomService,
      matchService,
      chatService,
      rematchService: new RematchService(roomService, matchService),
      playerSessionService,
      now: () => FIXED_NOW
    })
  };
};

describe("GameCommandService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ordered caller and room delivery steps for room joins", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => {});

    const { commandService } = createCommandService();
    const roomCreated = await commandService.createRoom("Host");
    const hostSession = roomCreated.sessionToBind;

    if (!hostSession) {
      throw new Error("Expected room creation to produce a session.");
    }

    await commandService.sendChat(hostSession, "Hello from the lobby :)");

    const roomCreatedEvent = roomCreated.steps[0];

    if (roomCreatedEvent?.kind !== "direct" || roomCreatedEvent.event.type !== SERVER_EVENT_NAMES.roomCreated) {
      throw new Error("Expected the room create command to produce room:created first.");
    }

    const joined = await commandService.joinRoom(
      roomCreatedEvent.event.payload.inviteToken,
      "Guest"
    );

    expect(joined.steps.map((step) => `${step.kind}:${step.event.type}`)).toEqual([
      "direct:room:joined",
      "direct:chat:history",
      "broadcast:room:state",
      "broadcast:match:started"
    ]);

    const chatHistoryStep = joined.steps[1];

    if (chatHistoryStep?.kind !== "direct" || chatHistoryStep.event.type !== SERVER_EVENT_NAMES.chatHistory) {
      throw new Error("Expected chat history as the second join step.");
    }

    expect(chatHistoryStep.event.payload.messages).toMatchObject([
      {
        displayName: "Host",
        text: "Hello from the lobby :)"
      }
    ]);
  });

  it("returns ordered reconnect steps with direct bootstrap before room broadcasts", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => {});

    const { commandService, matchService } = createCommandService();
    const roomCreated = await commandService.createRoom("Host");
    const hostSession = roomCreated.sessionToBind;

    if (!hostSession) {
      throw new Error("Expected room creation to produce a session.");
    }

    const roomCreatedEvent = roomCreated.steps[0];

    if (roomCreatedEvent?.kind !== "direct" || roomCreatedEvent.event.type !== SERVER_EVENT_NAMES.roomCreated) {
      throw new Error("Expected the room create command to produce room:created first.");
    }

    await commandService.joinRoom(roomCreatedEvent.event.payload.inviteToken, "Guest");
    await matchService.setConnectionState(hostSession.roomCode, hostSession.playerId, false);

    const reconnect = await commandService.reconnectPlayer(
      hostSession.roomCode,
      hostSession.sessionToken
    );

    expect(reconnect.steps.map((step) => `${step.kind}:${step.event.type}`)).toEqual([
      "direct:room:state",
      "direct:chat:history",
      "broadcast:player:reconnected",
      "broadcast:match:state"
    ]);
  });

  it("returns ordered disconnect broadcasts when a player drops from an active match", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => {});

    const { commandService } = createCommandService();
    const roomCreated = await commandService.createRoom("Host");
    const hostSession = roomCreated.sessionToBind;

    if (!hostSession) {
      throw new Error("Expected room creation to produce a session.");
    }

    const roomCreatedEvent = roomCreated.steps[0];

    if (roomCreatedEvent?.kind !== "direct" || roomCreatedEvent.event.type !== SERVER_EVENT_NAMES.roomCreated) {
      throw new Error("Expected the room create command to produce room:created first.");
    }

    await commandService.joinRoom(roomCreatedEvent.event.payload.inviteToken, "Guest");

    const disconnect = await commandService.disconnectPlayer(hostSession);

    expect(disconnect.steps.map((step) => `${step.kind}:${step.event.type}`)).toEqual([
      "broadcast:player:disconnected",
      "broadcast:match:state"
    ]);
  });
});
