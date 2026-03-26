import { describe, expect, it } from "vitest";
import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  type ServerEvent
} from "@minesweeper-flags/shared";
import {
  buildReconnectEvent,
  appendChatMessage,
  buildSessionFromRoomEvent,
  reconcileRecoveredChatDraft,
  replaceChatHistory,
  shouldApplyServerEvent,
  shouldQueueWhileOffline
} from "./game-client.state.js";

describe("game client state helpers", () => {
  it("builds a reconnect event from persisted session data", () => {
    expect(
      buildReconnectEvent({
        roomId: "room-1",
        roomCode: "ABCDE",
        playerId: "player-1",
        displayName: "Host",
        sessionToken: "session-1"
      })
    ).toEqual({
      type: CLIENT_EVENT_NAMES.playerReconnect,
      payload: {
        roomCode: "ABCDE",
        sessionToken: "session-1"
      }
    });
  });

  it("keeps room-scoped server events isolated to the active room", () => {
    const roomStateEvent: ServerEvent = {
      type: SERVER_EVENT_NAMES.roomState,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        players: []
      }
    };

    expect(shouldApplyServerEvent(roomStateEvent, "ABCDE")).toBe(true);
    expect(shouldApplyServerEvent(roomStateEvent, "ZZZZZ")).toBe(false);
  });

  it("deduplicates chat history by message id", () => {
    expect(
      replaceChatHistory([
        {
          messageId: "message-1",
          playerId: "player-1",
          displayName: "Host",
          text: "Hello",
          sentAt: 1
        },
        {
          messageId: "message-1",
          playerId: "player-1",
          displayName: "Host",
          text: "Hello",
          sentAt: 1
        }
      ])
    ).toEqual([
      {
        messageId: "message-1",
        playerId: "player-1",
        displayName: "Host",
        text: "Hello",
        sentAt: 1
      }
    ]);
  });

  it("appends only new chat messages", () => {
    const messages = [
      {
        messageId: "message-1",
        playerId: "player-1",
        displayName: "Host",
        text: "Hello",
        sentAt: 1
      }
    ];

    expect(
      appendChatMessage(messages, {
        messageId: "message-2",
        playerId: "player-2",
        displayName: "Guest",
        text: "Hi",
        sentAt: 2
      })
    ).toEqual([
      ...messages,
      {
        messageId: "message-2",
        playerId: "player-2",
        displayName: "Guest",
        text: "Hi",
        sentAt: 2
      }
    ]);
    expect(
      appendChatMessage(messages, {
        messageId: "message-1",
        playerId: "player-1",
        displayName: "Host",
        text: "Hello",
        sentAt: 1
      })
    ).toBe(messages);
  });

  it("clears a recovered draft once reconnect history confirms delivery", () => {
    expect(
      reconcileRecoveredChatDraft({
        currentDraft: "Hello",
        recoveredDraftText: "Hello",
        playerId: "player-1",
        messages: [
          {
            messageId: "message-1",
            playerId: "player-1",
            displayName: "Host",
            text: "Hello",
            sentAt: 1
          }
        ]
      })
    ).toEqual({
      nextDraft: "",
      shouldClearRecoveredDraft: true
    });
  });

  it("preserves edited text while clearing recovered-send tracking", () => {
    expect(
      reconcileRecoveredChatDraft({
        currentDraft: "Different draft",
        recoveredDraftText: "Hello",
        playerId: "player-1",
        messages: [
          {
            messageId: "message-1",
            playerId: "player-1",
            displayName: "Host",
            text: "Hello",
            sentAt: 1
          }
        ]
      })
    ).toEqual({
      nextDraft: "Different draft",
      shouldClearRecoveredDraft: true
    });
  });

  it("queues only lobby bootstrap events while offline", () => {
    expect(
      shouldQueueWhileOffline({
        type: CLIENT_EVENT_NAMES.roomCreate,
        payload: { displayName: "Host" }
      })
    ).toBe(true);

    expect(
      shouldQueueWhileOffline({
        type: CLIENT_EVENT_NAMES.matchResign,
        payload: {
          roomCode: "ABCDE",
          sessionToken: "session-1"
        }
      })
    ).toBe(false);
  });

  it("builds persisted client session data from room bootstrap events", () => {
    const session = buildSessionFromRoomEvent({
      type: SERVER_EVENT_NAMES.roomCreated,
      payload: {
        roomId: "room-1",
        roomCode: "ABCDE",
        self: {
          playerId: "player-1",
          displayName: "Host",
          sessionToken: "session-1"
        },
        players: [
          {
            playerId: "player-1",
            displayName: "Host"
          }
        ]
      }
    });

    expect(session.sessionToken).toBe("session-1");
    expect(session.players).toHaveLength(1);
  });
});
