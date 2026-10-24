// @vitest-environment jsdom

import type { ChatMessageDto } from "@minesweeper-flags/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SoundPlayer } from "./sound-player.js";
import { setSoundEnabled } from "./sound-settings.js";
import { useChatSounds } from "./useChatSounds.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = "me";
const THEM = "them";

const message = (messageId: string, playerId: string): ChatMessageDto => ({
  messageId,
  playerId,
  displayName: playerId,
  text: "hi",
  sentAt: 1
});

const Probe = ({
  messages,
  live,
  player
}: {
  messages: readonly ChatMessageDto[];
  live: boolean;
  player: SoundPlayer;
}) => {
  useChatSounds(messages, ME, live, player);
  return null;
};

const setup = (initial: readonly ChatMessageDto[], initialLive = true) => {
  const play = vi.fn();
  const player: SoundPlayer = { play };
  const root = createRoot(document.createElement("div"));
  const render = (messages: readonly ChatMessageDto[], live = initialLive) =>
    act(() => root.render(<Probe messages={messages} live={live} player={player} />));
  render(initial);
  return { play, render, unmount: () => act(() => root.unmount()) };
};

afterEach(() => {
  setSoundEnabled(true);
});

describe("useChatSounds", () => {
  it("stays silent for the history present on mount", () => {
    // Given a chat with two earlier messages
    // When the hook mounts in a live match
    const { play, unmount } = setup([message("1", THEM), message("2", ME)]);

    // Then nothing plays
    expect(play).not.toHaveBeenCalled();
    unmount();
  });

  it("plays chat-sent for my new message", () => {
    // Given a mounted hook with one earlier message
    const history = [message("1", THEM)];
    const { play, render, unmount } = setup(history);

    // When my message arrives
    render([...history, message("2", ME)]);

    // Then chat-sent plays once
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith("chat-sent");
    unmount();
  });

  it("plays chat-received for the opponent's new message", () => {
    // Given a mounted hook with no messages
    const { play, render, unmount } = setup([]);

    // When the opponent's message arrives
    render([message("1", THEM)]);

    // Then chat-received plays once
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith("chat-received");
    unmount();
  });

  it("plays one sound when two messages arrive in one update", () => {
    // Given a mounted hook with no messages
    const { play, render, unmount } = setup([]);

    // When two opponent messages arrive together
    render([message("1", THEM), message("2", THEM)]);

    // Then a single sound plays
    expect(play).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("plays nothing for a message that arrives while the match is not live", () => {
    // Given a mounted hook in a match that is not live
    const { play, render, unmount } = setup([], false);

    // When the opponent's message arrives
    render([message("1", THEM)], false);

    // Then nothing plays
    expect(play).not.toHaveBeenCalled();
    unmount();
  });

  it("does not replay a message that arrived while not live once the match goes live", () => {
    // Given a message that arrived before the match went live
    const messages = [message("1", THEM)];
    const { play, render, unmount } = setup([], false);
    render(messages, false);

    // When the match goes live with the same messages
    render(messages, true);

    // Then nothing plays
    expect(play).not.toHaveBeenCalled();
    unmount();
  });

  it("plays nothing when sound is disabled", () => {
    // Given sound switched off and a mounted hook
    setSoundEnabled(false);
    const { play, render, unmount } = setup([]);

    // When the opponent's message arrives
    render([message("1", THEM)]);

    // Then nothing plays
    expect(play).not.toHaveBeenCalled();
    unmount();
  });

  it("plays nothing when the same messages are rendered again", () => {
    // Given a message that already sounded
    const messages = [message("1", THEM)];
    const { play, render, unmount } = setup([]);
    render(messages);
    play.mockClear();

    // When a new array with the same messages renders
    render([...messages]);

    // Then nothing plays
    expect(play).not.toHaveBeenCalled();
    unmount();
  });
});
