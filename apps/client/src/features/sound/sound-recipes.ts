import type { SoundName, SoundRecipe } from "./sound-player.js";

// Arcade set (square and triangle, crisp 1-3 ms attacks), chosen from the sound lab.
// Loudness plan, quietest to loudest: reveal, your-turn, flag, lose, win, bomb.
// Filtered noise loses most of its energy in the filter, so the noise layer has a larger gain.
export const SOUND_RECIPES: Record<SoundName, SoundRecipe> = {
  // A 45 ms chip blip that drops in pitch, so a tile feels like it settles; a quiet square adds the click.
  reveal: {
    segments: [
      {
        kind: "tone",
        wave: "square",
        startHz: 1200,
        endHz: 600,
        durationMs: 12,
        gain: 0.035,
        offsetMs: 0,
        attackMs: 1
      },
      {
        kind: "tone",
        wave: "triangle",
        startHz: 900,
        endHz: 600,
        durationMs: 45,
        gain: 0.1,
        offsetMs: 0,
        attackMs: 1
      }
    ]
  },
  // Coin pickup: a B5 grace note jumps up a fourth to a ringing E6, with a triangle E5 for body.
  flag: {
    segments: [
      {
        kind: "tone",
        wave: "square",
        startHz: 987.77,
        endHz: 987.77,
        durationMs: 70,
        gain: 0.088,
        offsetMs: 0,
        attackMs: 2,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "square",
        startHz: 1318.51,
        endHz: 1318.51,
        durationMs: 300,
        gain: 0.088,
        offsetMs: 70,
        attackMs: 2
      },
      {
        kind: "tone",
        wave: "triangle",
        startHz: 659.25,
        endHz: 659.25,
        durationMs: 300,
        gain: 0.1,
        offsetMs: 70,
        attackMs: 2
      }
    ]
  },
  // NES-style explosion: a lowpass noise burst darkens as it fades, over a triangle thump and a square punch.
  bomb: {
    segments: [
      {
        kind: "noise",
        filter: { type: "lowpass", startHz: 3000, endHz: 120, q: 0.8 },
        durationMs: 600,
        gain: 0.42,
        offsetMs: 0,
        attackMs: 1,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "triangle",
        startHz: 150,
        endHz: 40,
        durationMs: 320,
        gain: 0.26,
        offsetMs: 0,
        attackMs: 1
      },
      {
        kind: "tone",
        wave: "square",
        startHz: 90,
        endHz: 40,
        durationMs: 110,
        gain: 0.05,
        offsetMs: 0,
        attackMs: 1
      }
    ]
  },
  // Two soft triangle notes, C5 then G5 (a rising fifth); quiet enough not to compete with flag.
  "your-turn": {
    segments: [
      {
        kind: "tone",
        wave: "triangle",
        startHz: 523.25,
        endHz: 523.25,
        durationMs: 85,
        gain: 0.085,
        offsetMs: 0,
        attackMs: 3,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "triangle",
        startHz: 783.99,
        endHz: 783.99,
        durationMs: 150,
        gain: 0.085,
        offsetMs: 95,
        attackMs: 3
      }
    ]
  },
  // A staccato C-E-G arpeggio lands on a held C6 over a triangle C4: a bright "level clear".
  win: {
    segments: [
      {
        kind: "tone",
        wave: "square",
        startHz: 523.25,
        endHz: 523.25,
        durationMs: 90,
        gain: 0.072,
        offsetMs: 0,
        attackMs: 2,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "square",
        startHz: 659.25,
        endHz: 659.25,
        durationMs: 90,
        gain: 0.072,
        offsetMs: 100,
        attackMs: 2,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "square",
        startHz: 783.99,
        endHz: 783.99,
        durationMs: 90,
        gain: 0.072,
        offsetMs: 200,
        attackMs: 2,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "square",
        startHz: 1046.5,
        endHz: 1046.5,
        durationMs: 750,
        gain: 0.072,
        offsetMs: 300,
        attackMs: 2,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "triangle",
        startHz: 261.63,
        endHz: 261.63,
        durationMs: 750,
        gain: 0.128,
        offsetMs: 300,
        attackMs: 2,
        decay: "linear"
      }
    ]
  },
  // A square line falls G4, Eb4, D4, C4 over a triangle C3; the minor third makes it final, not comic.
  lose: {
    segments: [
      {
        kind: "tone",
        wave: "square",
        startHz: 392,
        endHz: 392,
        durationMs: 170,
        gain: 0.042,
        offsetMs: 0,
        attackMs: 3,
        decay: "linear"
      },
      // The next three notes omit offsetMs: each starts when the previous one ends.
      {
        kind: "tone",
        wave: "square",
        startHz: 311.13,
        endHz: 311.13,
        durationMs: 170,
        gain: 0.042,
        attackMs: 3,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "square",
        startHz: 293.66,
        endHz: 293.66,
        durationMs: 170,
        gain: 0.042,
        attackMs: 3,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "square",
        startHz: 261.63,
        endHz: 261.63,
        durationMs: 480,
        gain: 0.042,
        attackMs: 3,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "triangle",
        startHz: 130.81,
        endHz: 130.81,
        durationMs: 480,
        gain: 0.098,
        offsetMs: 510,
        attackMs: 3,
        decay: "linear"
      }
    ]
  },
  // Snappy chat send: a 6 ms noise tick, then a short triangle chirp that rises, as if the message leaves.
  "chat-sent": {
    segments: [
      {
        kind: "noise",
        durationMs: 6,
        gain: 0.19,
        offsetMs: 0,
        attackMs: 0,
        filter: { type: "bandpass", startHz: 4500, endHz: 4500, q: 2 }
      },
      {
        kind: "tone",
        wave: "triangle",
        startHz: 880,
        endHz: 1046.5,
        durationMs: 45,
        gain: 0.13,
        offsetMs: 0,
        attackMs: 1
      }
    ]
  },
  // Snappy chat arrival: two ticked notes, G5 then a ringing G6 an octave up, avoiding the fifth and fourth of your-turn and flag.
  "chat-received": {
    segments: [
      {
        kind: "noise",
        durationMs: 6,
        gain: 0.14,
        offsetMs: 0,
        attackMs: 0,
        filter: { type: "bandpass", startHz: 3500, endHz: 3500, q: 2 }
      },
      {
        kind: "tone",
        wave: "triangle",
        startHz: 783.99,
        endHz: 783.99,
        durationMs: 45,
        gain: 0.107,
        offsetMs: 0,
        attackMs: 1,
        decay: "linear"
      },
      {
        kind: "noise",
        durationMs: 6,
        gain: 0.14,
        offsetMs: 55,
        attackMs: 0,
        filter: { type: "bandpass", startHz: 5000, endHz: 5000, q: 2 }
      },
      {
        kind: "tone",
        wave: "triangle",
        startHz: 1567.98,
        endHz: 1567.98,
        durationMs: 95,
        gain: 0.107,
        offsetMs: 55,
        attackMs: 1
      }
    ]
  },
  // Plain resign: a square G4 falls to C4, a short sigh quieter than lose, so giving up sounds like giving up.
  resign: {
    segments: [
      {
        kind: "tone",
        wave: "square",
        startHz: 392,
        endHz: 392,
        durationMs: 130,
        gain: 0.06,
        offsetMs: 0,
        attackMs: 3,
        decay: "linear"
      },
      {
        kind: "tone",
        wave: "square",
        startHz: 261.63,
        endHz: 261.63,
        durationMs: 270,
        gain: 0.06,
        attackMs: 3,
        decay: "linear"
      }
    ]
  }
};
