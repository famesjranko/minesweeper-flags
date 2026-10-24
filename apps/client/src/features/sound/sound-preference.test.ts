// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readSoundEnabled, SOUND_ENABLED_KEY, writeSoundEnabled } from "./sound-preference.js";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("sound preference", () => {
  it("defaults to on when nothing is stored", () => {
    // Given empty storage
    window.localStorage.clear();

    // When the preference is read
    const enabled = readSoundEnabled();

    // Then sound is on
    expect(enabled).toBe(true);
  });

  it("round-trips off and on through storage", () => {
    // Given sound was switched off
    writeSoundEnabled(false);

    // When the preference is read
    const afterOff = readSoundEnabled();

    // Then it is off and stored under the shared key
    expect(afterOff).toBe(false);
    expect(window.localStorage.getItem(SOUND_ENABLED_KEY)).toBe("off");

    // And switching it on again reads back on
    writeSoundEnabled(true);
    expect(readSoundEnabled()).toBe(true);
    expect(window.localStorage.getItem(SOUND_ENABLED_KEY)).toBe("on");
  });

  it("falls back to on and does not throw when storage throws", () => {
    // Given storage that throws on read and write
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    // When the preference is read and written
    const enabled = readSoundEnabled();

    // Then it reads the default and the write does not throw
    expect(enabled).toBe(true);
    expect(() => writeSoundEnabled(false)).not.toThrow();
  });
});
