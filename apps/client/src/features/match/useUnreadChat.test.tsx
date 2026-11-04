// @vitest-environment jsdom

import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUnreadChat } from "./useUnreadChat.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// By default a message is written after the view opened; history uses an old timestamp.
const message = (
  id: number,
  playerId = "them",
  sentAt = Date.now() + 60_000 + id
): ChatMessageDto => ({
  messageId: `m${id}`,
  playerId,
  displayName: playerId,
  text: "hello",
  sentAt
});
const oldMessage = (id: number) => message(id, "them", id);

let latest: ReturnType<typeof useUnreadChat>;
let root: Root;

const Probe = ({ messages }: { messages: ChatMessageDto[] }) => {
  latest = useUnreadChat(messages, "me");
  return null;
};

const render = (messages: ChatMessageDto[]) =>
  act(() => root.render(<Probe messages={messages} />));

describe("useUnreadChat", () => {
  beforeEach(() => {
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("counts each new message from the opponent", () => {
    // Given a chat with nothing new
    render([]);

    // When two messages arrive one at a time
    render([message(1)]);
    render([message(1), message(2)]);

    // Then both count
    expect(latest.unread).toBe(2);
  });

  it("does not count the player's own messages", () => {
    // Given an empty chat
    render([]);

    // When the player sends a message
    render([message(1, "me")]);

    // Then nothing is unread
    expect(latest.unread).toBe(0);
  });

  it("treats history that arrives after a refresh as read", () => {
    // Given a match that mounted before its chat history came back
    render([]);

    // When several old messages arrive together
    render([oldMessage(1), oldMessage(2), oldMessage(3)]);

    // Then no old message counts
    expect(latest.unread).toBe(0);
  });

  it("treats a single old message after a refresh as read", () => {
    // Given a match that mounted before its one-message history came back
    render([]);

    // When that old message arrives
    render([oldMessage(1)]);

    // Then it does not count
    expect(latest.unread).toBe(0);
  });

  it("counts messages written while disconnected, even when they are the first", () => {
    // Given a chat that has been empty since the view opened
    render([]);

    // When a reconnect delivers two messages written in the meantime
    render([message(1), message(2)]);

    // Then both count
    expect(latest.unread).toBe(2);
  });

  it("counts everything new when several messages arrive together after a reconnect", () => {
    // Given one unread message, then a dropped connection
    render([]);
    render([message(1)]);

    // When the reconnect delivers two more at once
    render([message(1), message(2), message(3)]);

    // Then all three are unread
    expect(latest.unread).toBe(3);
  });

  it("treats history present at mount as read", () => {
    // Given a chat that already holds messages
    // When the hook first runs
    render([oldMessage(1), oldMessage(2)]);

    // Then nothing is unread
    expect(latest.unread).toBe(0);
  });

  it("clears the count when the player looks at the chat, and counts on from there", () => {
    // Given one unread message
    render([]);
    render([message(1)]);

    // When the player opens the chat
    act(() => latest.markRead());
    expect(latest.unread).toBe(0);

    // And another message arrives
    render([message(1), message(2)]);

    // Then only the new one counts
    expect(latest.unread).toBe(1);
  });
});
