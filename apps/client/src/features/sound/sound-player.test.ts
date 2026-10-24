// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSoundPlayer, type SoundName, type SoundRecipe } from "./sound-player.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const RECIPES: Record<SoundName, SoundRecipe> = {
  reveal: {
    segments: [
      { wave: "sine", startHz: 400, endHz: 300, durationMs: 50, gain: 0.1 },
      { wave: "sine", startHz: 300, endHz: 200, durationMs: 50, gain: 0.1 }
    ]
  },
  flag: { segments: [] },
  bomb: { segments: [] },
  "your-turn": { segments: [] },
  win: { segments: [] },
  lose: { segments: [] }
};

const stubAudioContext = (state: "running" | "suspended") => {
  const created: unknown[] = [];
  const oscillators: { start: ReturnType<typeof vi.fn> }[] = [];
  const resume = vi.fn(() => Promise.resolve());
  const param = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  class FakeAudioContext {
    state = state;
    currentTime = 0;
    destination = {};
    resume = resume;
    constructor() {
      created.push(this);
    }
    createOscillator() {
      const oscillator = {
        type: "sine",
        frequency: param(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      return { gain: param(), connect: vi.fn() };
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return { created, oscillators, resume };
};

describe("createSoundPlayer", () => {
  it("returns a player that does nothing when AudioContext is missing", () => {
    // Given a browser without AudioContext
    vi.stubGlobal("AudioContext", undefined);
    delete (window as unknown as Record<string, unknown>).AudioContext;

    // When a sound is played
    const player = createSoundPlayer(RECIPES);

    // Then it does not throw
    expect(() => player.play("reveal")).not.toThrow();
  });

  it("creates the AudioContext on the first play, not on construction", () => {
    // Given a fake AudioContext
    const audio = stubAudioContext("running");

    // When the player is built and then used twice
    const player = createSoundPlayer(RECIPES);
    expect(audio.created).toHaveLength(0);
    player.play("reveal");
    player.play("reveal");

    // Then exactly one context was created
    expect(audio.created).toHaveLength(1);
  });

  it("resumes a suspended context and not a running one", () => {
    // Given a suspended fake context
    const suspended = stubAudioContext("suspended");

    // When a sound is played
    createSoundPlayer(RECIPES).play("reveal");

    // Then resume is called
    expect(suspended.resume).toHaveBeenCalledTimes(1);

    // And a running context is not resumed
    const running = stubAudioContext("running");
    createSoundPlayer(RECIPES).play("reveal");
    expect(running.resume).not.toHaveBeenCalled();
  });

  it("starts one oscillator per segment", () => {
    // Given a recipe with two segments
    const audio = stubAudioContext("running");

    // When it is played
    createSoundPlayer(RECIPES).play("reveal");

    // Then two oscillators start, the second after the first
    expect(audio.oscillators).toHaveLength(2);
    expect(audio.oscillators[0]?.start).toHaveBeenCalledWith(0);
    expect(audio.oscillators[1]?.start).toHaveBeenCalledWith(0.05);
  });
});
