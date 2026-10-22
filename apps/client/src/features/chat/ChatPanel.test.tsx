// @vitest-environment jsdom
import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ChatPanel } from "./ChatPanel.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const message = (index: number): ChatMessageDto => ({
  messageId: `message-${index}`,
  playerId: "friend",
  displayName: "Friend",
  text: `Message ${index}`,
  sentAt: 1700000000000 + index
});
const render = (
  messages: ChatMessageDto[],
  options: { offline?: boolean; expand?: () => void; send?: () => void } = {}
) => {
  act(() =>
    root.render(
      <ChatPanel
        roomCode="ABCDE"
        currentPlayerId="self"
        playerTones={{ friend: "red" }}
        connectionStatus={options.offline ? "disconnected" : "connected"}
        messages={messages}
        draft="My reply"
        pending={false}
        error={null}
        onDraftChange={() => {}}
        {...(options.expand ? { onExpand: options.expand } : {})}
        onSend={options.send ?? (() => {})}
      />
    )
  );
};
const mount = () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  document.body.append(container);
  root = createRoot(container);
};
it("shows the latest two messages in the preview and keeps full history available", () => {
  // Given a conversation with older messages and an expandable preview
  mount();
  const expand = vi.fn();
  const messages = [message(1), message(2), message(3)];
  render(messages, { expand });

  // When another message arrives and the player opens full chat
  render([...messages, message(4)], { expand });
  act(() => container.querySelector<HTMLButtonElement>(".chat-expand")!.click());

  // Then the preview advances and full chat can still render all messages
  expect(container.querySelectorAll("article")).toHaveLength(2);
  expect(container.textContent).toContain("Message 3");
  expect(container.textContent).toContain("Message 4");
  expect(container.textContent).not.toContain("Message 2");
  expect(expand).toHaveBeenCalledOnce();
  render([...messages, message(4)]);
  expect(container.querySelectorAll("article")).toHaveLength(4);
});
it("keeps a quick reply while offline and sends it once connected", () => {
  // Given an offline preview containing a draft reply
  mount();
  const send = vi.fn();
  const expand = vi.fn();
  render([], { offline: true, expand, send });

  // When submission is attempted offline and again after connection
  act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );
  expect(send).not.toHaveBeenCalled();
  expect(container.querySelector("input")!.value).toBe("My reply");
  render([], { expand, send });
  act(() =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  );

  // Then only the connected reply is sent and empty chat remains usable
  expect(send).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("No messages yet.");
});
