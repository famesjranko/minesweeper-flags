// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSoundPlayer, type SoundName, type SoundRecipe } from "./sound-player.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const RECIPES: Record<SoundName, SoundRecipe> = {
  reveal: {
    segments: [
      { kind: "tone", wave: "sine", startHz: 400, endHz: 300, durationMs: 50, gain: 0.1 },
      { kind: "tone", wave: "sine", startHz: 300, endHz: 200, durationMs: 50, gain: 0.1 }
    ]
  },
  flag: { segments: [] },
  bomb: { segments: [] },
  "your-turn": { segments: [] },
  win: { segments: [] },
  lose: { segments: [] },
  "chat-sent": { segments: [] },
  "chat-received": { segments: [] },
  resign: { segments: [] }
};

interface FakeParam {
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
}

interface FakeSource {
  type?: string;
  loop?: boolean;
  buffer?: unknown;
  frequency: FakeParam;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const stubAudioContext = (state: "running" | "suspended", manualResume = false) => {
  let finishResume: () => void = () => {};
  const created: unknown[] = [];
  const oscillators: FakeSource[] = [];
  const bufferSources: FakeSource[] = [];
  const filters: (FakeSource & { Q: FakeParam })[] = [];
  const gains: { gain: FakeParam }[] = [];
  const buffers: unknown[] = [];
  const resume = vi.fn(() =>
    manualResume
      ? new Promise<void>((resolve) => {
          finishResume = resolve;
        })
      : Promise.resolve()
  );
  const param = (): FakeParam => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn()
  });
  const source = (): FakeSource => ({
    frequency: param(),
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  });
  class FakeAudioContext {
    state = state;
    currentTime = 0;
    sampleRate = 8000;
    destination = {};
    resume = resume;
    constructor() {
      created.push(this);
    }
    createOscillator() {
      const oscillator = { ...source(), type: "sine" };
      oscillators.push(oscillator);
      return oscillator;
    }
    createBufferSource() {
      const node = source();
      bufferSources.push(node);
      return node;
    }
    createBiquadFilter() {
      const filter = { ...source(), type: "lowpass", Q: param() };
      filters.push(filter);
      return filter;
    }
    createBuffer(_channels: number, length: number) {
      const buffer = { length, getChannelData: () => new Float32Array(length) };
      buffers.push(buffer);
      return buffer;
    }
    createGain() {
      const node = { gain: param(), connect: vi.fn(), disconnect: vi.fn() };
      gains.push(node);
      return node;
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  return {
    created,
    oscillators,
    bufferSources,
    filters,
    gains,
    buffers,
    resume,
    finishResume: () => finishResume()
  };
};

const NOISE_RECIPES: Record<SoundName, SoundRecipe> = {
  ...RECIPES,
  bomb: {
    segments: [
      {
        kind: "noise",
        filter: { type: "bandpass", startHz: 3000, endHz: 120, q: 0.8 },
        durationMs: 600,
        gain: 0.4
      }
    ]
  }
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

  it("plays a noise segment through one looped buffer source and a filter of the recipe's type", () => {
    // Given a recipe with one bandpass noise segment
    const audio = stubAudioContext("running");

    // When it is played
    createSoundPlayer(NOISE_RECIPES).play("bomb");

    // Then one buffer source loops, feeds one bandpass filter, and starts
    expect(audio.bufferSources).toHaveLength(1);
    expect(audio.bufferSources[0]?.loop).toBe(true);
    expect(audio.bufferSources[0]?.start).toHaveBeenCalledWith(0);
    expect(audio.filters).toHaveLength(1);
    expect(audio.filters[0]?.type).toBe("bandpass");
    expect(audio.bufferSources[0]?.connect).toHaveBeenCalledWith(audio.filters[0]);

    // And the filter sweeps exponentially with the recipe's Q
    expect(audio.filters[0]?.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(120, 0.6);
    expect(audio.filters[0]?.Q.setValueAtTime).toHaveBeenCalledWith(0.8, 0);
    expect(audio.oscillators).toHaveLength(0);
  });

  it("creates the noise buffer once per context and reuses it across plays", () => {
    // Given a player with a noise recipe
    const audio = stubAudioContext("running");
    const player = createSoundPlayer(NOISE_RECIPES);

    // When the sound is played twice
    player.play("bomb");
    player.play("bomb");

    // Then one buffer exists and both sources use it
    expect(audio.buffers).toHaveLength(1);
    expect(audio.bufferSources[0]?.buffer).toBe(audio.buffers[0]);
    expect(audio.bufferSources[1]?.buffer).toBe(audio.buffers[0]);
  });

  it("starts a segment without offsetMs when the previous segment ends", () => {
    // Given a recipe whose second segment has no offsetMs
    const audio = stubAudioContext("running");
    const recipes: Record<SoundName, SoundRecipe> = {
      ...RECIPES,
      reveal: {
        segments: [
          {
            kind: "tone",
            wave: "sine",
            startHz: 400,
            endHz: 400,
            durationMs: 100,
            gain: 0.1,
            offsetMs: 200
          },
          { kind: "tone", wave: "sine", startHz: 400, endHz: 400, durationMs: 100, gain: 0.1 }
        ]
      }
    };

    // When it is played
    createSoundPlayer(recipes).play("reveal");

    // Then the second segment starts at 200 ms + 100 ms
    expect(audio.oscillators[1]?.start).toHaveBeenCalledWith(0.3);
  });

  it("fades linearly to 0 for decay linear and exponentially to the floor by default", () => {
    // Given a linear-decay segment and a default-decay segment
    const audio = stubAudioContext("running");
    const recipes: Record<SoundName, SoundRecipe> = {
      ...RECIPES,
      reveal: {
        segments: [
          {
            kind: "tone",
            wave: "sine",
            startHz: 400,
            endHz: 400,
            durationMs: 100,
            gain: 0.1,
            offsetMs: 0,
            decay: "linear"
          },
          {
            kind: "tone",
            wave: "sine",
            startHz: 400,
            endHz: 400,
            durationMs: 100,
            gain: 0.1,
            offsetMs: 0
          }
        ]
      }
    };

    // When it is played
    createSoundPlayer(recipes).play("reveal");

    // Then the linear segment ramps its gain linearly to 0 at its end
    const [linear, exponential] = audio.gains;
    expect(linear?.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.1);
    expect(linear?.gain.exponentialRampToValueAtTime).not.toHaveBeenCalled();

    // And the default segment ramps exponentially to the floor
    expect(exponential?.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 0.1);
    expect(exponential?.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
  });

  it("schedules nothing and resumes once while the context is suspended", () => {
    // Given a suspended context whose resume has not finished
    const audio = stubAudioContext("suspended", true);
    const player = createSoundPlayer(RECIPES);

    // When three sounds are requested
    player.play("reveal");
    player.play("reveal");
    player.play("reveal");

    // Then no node is scheduled
    expect(audio.oscillators).toHaveLength(0);

    // And resume is called once
    expect(audio.resume).toHaveBeenCalledTimes(1);
  });

  it("plays only the latest requested sound, once, when the resume finishes", async () => {
    // Given a suspended context and a bomb recipe with one noise segment
    const audio = stubAudioContext("suspended", true);
    const player = createSoundPlayer(NOISE_RECIPES);

    // When reveal, bomb, reveal, bomb are requested before the resume finishes
    player.play("reveal");
    player.play("bomb");
    player.play("reveal");
    player.play("bomb");
    audio.finishResume();
    await vi.waitFor(() => expect(audio.bufferSources).toHaveLength(1));

    // Then only the bomb segment is scheduled, once, and no reveal tone
    expect(audio.bufferSources[0]?.start).toHaveBeenCalledTimes(1);
    expect(audio.oscillators).toHaveLength(0);
  });

  it("schedules a sound immediately while the context is running", () => {
    // Given a running context
    const audio = stubAudioContext("running", true);

    // When a sound is requested
    createSoundPlayer(RECIPES).play("reveal");

    // Then both segments are scheduled at once and resume is not called
    expect(audio.oscillators).toHaveLength(2);
    expect(audio.resume).not.toHaveBeenCalled();
  });
});
