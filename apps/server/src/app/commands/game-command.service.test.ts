import { SERVER_EVENT_NAMES } from "@minesweeper-flags/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyedSerialTaskRunner } from "../../lib/async/keyed-serial-task-runner.js";
import { logger } from "../../lib/logging/logger.js";
import { InMemoryChatRepository } from "../../modules/chat/chat.repository.js";
import { ChatService } from "../../modules/chat/chat.service.js";
import { InMemoryMatchRepository } from "../../modules/matches/match.repository.js";
import { MatchService } from "../../modules/matches/match.service.js";
import { RematchService } from "../../modules/rematch/rematch.service.js";
import { InMemoryRoomRepository } from "../../modules/rooms/room.repository.js";
import { RoomService } from "../../modules/rooms/room.service.js";
import {
  InMemoryPlayerSessionStore,
  PlayerSessionService
} from "../realtime/player-session.service.js";
import { GameCommandService } from "./game-command.service.js";

const TEST_CHAT_HISTORY_LIMIT = 25;
const TEST_CHAT_MESSAGE_MAX_LENGTH = 200;
const FIXED_NOW = 1_717_171_717;

const createCommandService = (maxConcurrentRooms?: number) => {
  const roomRepository = new InMemoryRoomRepository();
  const matchRepository = new InMemoryMatchRepository();
  const roomTaskRunner = new KeyedSerialTaskRunner();
  const roomService = new RoomService(roomRepository, roomTaskRunner);
  const matchService = new MatchService(roomService, matchRepository, roomTaskRunner);
  const chatService = new ChatService(
    roomService,
    new InMemoryChatRepository(TEST_CHAT_HISTORY_LIMIT),
    {
      historyLimit: TEST_CHAT_HISTORY_LIMIT,
      messageMaxLength: TEST_CHAT_MESSAGE_MAX_LENGTH
    }
  );
  const playerSessionService = new PlayerSessionService(new InMemoryPlayerSessionStore());

  const deleteRoomState = vi.fn(
    async (room: Awaited<ReturnType<typeof roomService.getRoomByCode>>) => {
      await roomRepository.delete(room.roomCode);
      await matchRepository.deleteByRoomId(room.roomId);
    }
  );
  return {
    roomRepository,
    matchRepository,
    deleteRoomState,
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
      roomRepository,
      matchRepository,
      roomTaskRunner,
      deleteRoomState,
      ...(maxConcurrentRooms === undefined ? {} : { maxConcurrentRooms }),
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

    if (
      roomCreatedEvent?.kind !== "direct" ||
      roomCreatedEvent.event.type !== SERVER_EVENT_NAMES.roomCreated
    ) {
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

    if (
      chatHistoryStep?.kind !== "direct" ||
      chatHistoryStep.event.type !== SERVER_EVENT_NAMES.chatHistory
    ) {
      throw new Error("Expected chat history as the second join step.");
    }

    expect(chatHistoryStep.event.payload.messages).toMatchObject([
      {
        displayName: "Host",
        text: "Hello from the lobby :)"
      }
    ]);
  });

  it("cancels only the sole host's waiting room and acknowledges that request", async () => {
    // Given a host with a waiting room
    const { commandService, roomService } = createCommandService();
    const created = await commandService.createRoom("Host");
    const hostSession = created.sessionToBind;
    if (!hostSession) throw new Error("Expected a host session.");

    // When the attached host cancels the room
    const cancelled = await commandService.cancelRoom(hostSession, "cancel-1");

    // Then the room and its invite are gone only after the cancellation acknowledgement exists
    await expect(roomService.getRoomByCode(hostSession.roomCode)).rejects.toThrow("does not exist");
    expect(cancelled.steps[0]).toMatchObject({
      kind: "direct",
      event: { type: SERVER_EVENT_NAMES.roomCancelled, payload: { requestId: "cancel-1" } }
    });
  });

  it("does not cancel a room after its guest has claimed the second seat", async () => {
    // Given a room whose join command has started its match
    const { commandService } = createCommandService();
    const created = await commandService.createRoom("Host");
    const hostSession = created.sessionToBind;
    const createdEvent = created.steps[0];
    if (
      !hostSession ||
      createdEvent?.kind !== "direct" ||
      createdEvent.event.type !== SERVER_EVENT_NAMES.roomCreated
    ) {
      throw new Error("Expected a created room.");
    }
    await commandService.joinRoom(createdEvent.event.payload.inviteToken, "Guest");

    // When the original host attempts cancellation
    const cancellation = commandService.cancelRoom(hostSession, "cancel-active");

    // Then the active room is protected
    await expect(cancellation).rejects.toThrow("Only the waiting room host");
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

    if (
      roomCreatedEvent?.kind !== "direct" ||
      roomCreatedEvent.event.type !== SERVER_EVENT_NAMES.roomCreated
    ) {
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

    if (
      roomCreatedEvent?.kind !== "direct" ||
      roomCreatedEvent.event.type !== SERVER_EVENT_NAMES.roomCreated
    ) {
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

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const waitingHost = async (h: ReturnType<typeof createCommandService>) => {
  const session = (await h.commandService.createRoom("Host")).sessionToBind;
  if (!session) throw new Error("Expected session.");
  const room = await h.roomService.getRoomByCode(session.roomCode);
  if (!room.inviteToken) throw new Error("Expected invite.");
  return { session, room, inviteToken: room.inviteToken };
};
describe("waiting-room cancellation contracts", () => {
  it("replaces only its own waiting room when every slot is occupied", async () => {
    // Given an occupied slot and its host
    const h = createCommandService(1);
    const { session, inviteToken } = await waitingHost(h);
    // When a stranger creates and the owner then creates again
    await expect(h.commandService.createRoom("Foreign")).rejects.toThrow("All room slots");
    const replacement = await h.commandService.createRoom("Host again", session);
    // Then only the replacement occupies capacity and the old invite is invalid
    expect(await h.roomRepository.listAll()).toHaveLength(1);
    expect(replacement.sessionToBind?.roomCode).not.toBe(session.roomCode);
    await expect(h.roomService.joinRoomByInviteToken(inviteToken, "Late")).rejects.toThrow(
      "no longer valid"
    );
  });
  it("waits for an admitted join before refusing cancellation", async () => {
    // Given a guest holds the room lock before saving its seat
    const h = createCommandService();
    const { session, inviteToken } = await waitingHost(h);
    const entered = deferred();
    const release = deferred();
    const save = h.roomRepository.save.bind(h.roomRepository);
    vi.spyOn(h.roomRepository, "save").mockImplementation(async (room) => {
      if (room.players.length === 2) {
        entered.resolve();
        await release.promise;
      }
      await save(room);
    });
    const joining = h.roomService.joinRoomByInviteToken(inviteToken, "Guest");
    await entered.promise;
    // When cancellation arrives while the join is pending
    const outcome = h.commandService
      .cancelRoom(session, "join-first")
      .catch((error: unknown) => error);
    await Promise.resolve();
    release.resolve();
    await joining;
    // Then cancellation observes the joined seat and preserves the room
    expect(await outcome).toBeInstanceOf(Error);
    expect(h.deleteRoomState).not.toHaveBeenCalled();
    expect((await h.roomService.getRoomByCode(session.roomCode)).players).toHaveLength(2);
  });
  it("finishes cancellation before a queued guest can claim the deleted room", async () => {
    // Given cancellation holds the room lock during deletion
    const h = createCommandService();
    const { session, inviteToken } = await waitingHost(h);
    const entered = deferred();
    const release = deferred();
    const remove = h.deleteRoomState.getMockImplementation();
    h.deleteRoomState.mockImplementation(async (room) => {
      entered.resolve();
      await release.promise;
      await remove?.(room);
    });
    const cancelling = h.commandService.cancelRoom(session, "cancel-first");
    await entered.promise;
    // When a guest tries joining before deletion finishes
    const outcome = h.roomService
      .joinRoomByInviteToken(inviteToken, "Guest")
      .catch((error: unknown) => error);
    await Promise.resolve();
    release.resolve();
    await cancelling;
    // Then the invite fails and cannot resurrect the room
    expect(await outcome).toBeInstanceOf(Error);
    expect(await h.roomRepository.listAll()).toHaveLength(0);
  });
  it("does not acknowledge a failed deletion", async () => {
    // Given storage rejects deletion of a waiting room
    const h = createCommandService();
    const { session } = await waitingHost(h);
    h.deleteRoomState.mockRejectedValue(new Error("Storage unavailable."));
    // When its host cancels
    const cancellation = h.commandService.cancelRoom(session, "failed");
    // Then cancellation fails and retains the room
    await expect(cancellation).rejects.toThrow("Storage unavailable.");
    expect(await h.roomRepository.listAll()).toHaveLength(1);
  });
  it.each(["live", "finished"] as const)(
    "protects a %s match with a single remaining seat",
    async (phase) => {
      // Given a match and a room record reduced to its host seat
      const h = createCommandService();
      const { session, room, inviteToken } = await waitingHost(h);
      await h.commandService.joinRoom(inviteToken, "Guest");
      const match = await h.matchRepository.getByRoomId(room.roomId);
      if (!match) throw new Error("Expected match.");
      await h.matchRepository.save({ ...match, phase });
      await h.roomRepository.save(room);
      // When the host cancels
      const cancellation = h.commandService.cancelRoom(session, "started");
      // Then the match guard prevents deletion despite the sole-host record
      await expect(cancellation).rejects.toThrow("started room");
      expect(h.deleteRoomState).not.toHaveBeenCalled();
    }
  );
});
