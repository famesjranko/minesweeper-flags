// @vitest-environment jsdom

import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "./ChatMessageList.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const message = (id: number): ChatMessageDto => ({
  messageId: String(id),
  playerId: "guest",
  displayName: "Guest",
  text: `Message ${id}`,
  sentAt: id * 1000
});

let root: Root;
let container: HTMLDivElement;
let height: number;
let contentHeight: number;
let position: number;
const resizes = new Set<() => void>();

const render = (messages: ChatMessageDto[]) =>
  act(() =>
    root.render(
      <ChatMessageList
        messages={messages}
        currentPlayerId="host"
        playerTones={{ host: "blue", guest: "red" }}
      />
    )
  );
const resize = () =>
  act(() => {
    for (const notify of resizes) notify();
  });
const scroll = (top: number) =>
  act(() => {
    position = top;
    container.querySelector('[role="log"]')!.dispatchEvent(new Event("scroll"));
  });

describe("chat scroll following", () => {
  beforeEach(() => {
    height = 200;
    contentHeight = 600;
    position = 0;
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => contentHeight);
    vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(() => position);
    vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation((value) => {
      position = Math.max(0, Math.min(value, contentHeight - height));
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private notify: () => void) {}
        observe() {
          resizes.add(this.notify);
        }
        disconnect() {
          resizes.delete(this.notify);
        }
      }
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resizes.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens an existing conversation at its latest message", () => {
    // Given an overflowing history on a newly mounted chat
    const messages = [message(1), message(2)];

    // When that history renders
    render(messages);

    // Then the latest message is in view immediately
    expect(position).toBe(400);
  });

  it("follows the latest message when a hidden chat opens", () => {
    // Given messages delivered while the chat has no visible layout
    height = 0;
    contentHeight = 0;
    render([message(1), message(2)]);

    // When the same chat becomes visible without another message arriving
    height = 200;
    contentHeight = 600;
    resize();

    // Then its latest message is visible
    expect(position).toBe(400);
  });

  it("keeps following new messages after an empty chat receives its first message", () => {
    // Given a chat that was initially empty and is now at the bottom
    render([]);
    render([message(1)]);
    scroll(400);

    // When the next message increases the conversation height
    contentHeight = 700;
    render([message(1), message(2)]);

    // Then the chat follows the new bottom
    expect(position).toBe(500);
  });

  it("preserves the reader's place until they return to the bottom", () => {
    // Given an initially empty chat whose reader scrolls back through its history
    render([]);
    render([message(1), message(2)]);
    scroll(100);

    // When another message arrives and the available height changes
    contentHeight = 700;
    render([message(1), message(2), message(3)]);
    height = 150;
    resize();

    // Then their reading position stays fixed
    expect(position).toBe(100);

    // And returning to the bottom enables following again
    scroll(550);
    contentHeight = 800;
    render([message(1), message(2), message(3), message(4)]);
    expect(position).toBe(650);
  });
});
