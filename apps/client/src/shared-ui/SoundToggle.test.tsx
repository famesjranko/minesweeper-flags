// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { setSoundEnabled } from "../features/sound/sound-settings.js";
import { SoundToggle } from "./SoundToggle.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const play = vi.fn();
vi.mock("../features/sound/sound-player.js", () => ({ getSoundPlayer: () => ({ play }) }));

beforeEach(() => {
  play.mockClear();
  act(() => setSoundEnabled(true));
});

it("mutes and unmutes, remembers the choice, and plays a sound only when turning on", () => {
  // Given the sound toggle rendered with sound on
  const container = document.createElement("div");
  const root = createRoot(container);
  document.body.append(container);
  act(() => root.render(<SoundToggle />));
  const button = container.querySelector<HTMLButtonElement>("button.arcade-sound-button");

  try {
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(button?.getAttribute("aria-label")).toBe("Sound effects");
    expect(button?.title).toBe("Mute sound effects");

    // When the player mutes
    act(() => button?.click());

    // Then the name stays the same, the hint offers unmute, the choice is stored, and nothing plays
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    expect(button?.getAttribute("aria-label")).toBe("Sound effects");
    expect(button?.title).toBe("Unmute sound effects");
    expect(localStorage.getItem("msf:sound:enabled")).toBe("off");
    expect(play).not.toHaveBeenCalled();

    // When the player unmutes
    act(() => button?.click());

    // Then the button shows on, the choice is stored, and reveal plays once
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(button?.getAttribute("aria-label")).toBe("Sound effects");
    expect(localStorage.getItem("msf:sound:enabled")).toBe("on");
    expect(play).toHaveBeenCalledExactlyOnceWith("reveal");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
