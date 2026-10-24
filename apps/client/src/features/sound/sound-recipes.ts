import type { SoundName, SoundRecipe } from "./sound-player.js";

// Provisional bleeps. A follow-up replaces them with values measured from the original game.
export const SOUND_RECIPES: Record<SoundName, SoundRecipe> = {
  reveal: { segments: [{ wave: "sine", startHz: 520, endHz: 440, durationMs: 70, gain: 0.15 }] },
  flag: {
    segments: [
      { wave: "triangle", startHz: 660, endHz: 660, durationMs: 80, gain: 0.18 },
      { wave: "triangle", startHz: 880, endHz: 880, durationMs: 100, gain: 0.18 }
    ]
  },
  bomb: {
    segments: [
      { wave: "sawtooth", startHz: 220, endHz: 50, durationMs: 400, gain: 0.2 },
      { wave: "square", startHz: 120, endHz: 40, durationMs: 300, gain: 0.1, offsetMs: 0 }
    ]
  },
  "your-turn": {
    segments: [
      { wave: "sine", startHz: 600, endHz: 600, durationMs: 60, gain: 0.15 },
      { wave: "sine", startHz: 800, endHz: 800, durationMs: 90, gain: 0.15 }
    ]
  },
  win: {
    segments: [
      { wave: "square", startHz: 523, endHz: 523, durationMs: 120, gain: 0.12 },
      { wave: "square", startHz: 659, endHz: 659, durationMs: 120, gain: 0.12 },
      { wave: "square", startHz: 784, endHz: 1047, durationMs: 220, gain: 0.12 }
    ]
  },
  lose: {
    segments: [
      { wave: "triangle", startHz: 400, endHz: 300, durationMs: 150, gain: 0.18 },
      { wave: "triangle", startHz: 300, endHz: 180, durationMs: 250, gain: 0.18 }
    ]
  }
};
