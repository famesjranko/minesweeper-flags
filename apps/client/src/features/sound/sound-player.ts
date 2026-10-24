import { SOUND_RECIPES } from "./sound-recipes.js";

export type SoundName = "reveal" | "flag" | "bomb" | "your-turn" | "win" | "lose";

export interface ToneSegment {
  wave: OscillatorType;
  startHz: number;
  endHz: number;
  durationMs: number;
  gain: number;
  /** Start offset from the sound's start; omitted means right after the previous segment. */
  offsetMs?: number;
}

export interface SoundRecipe {
  segments: ToneSegment[];
}

export interface SoundPlayer {
  play(name: SoundName): void;
}

const NO_OP_PLAYER: SoundPlayer = { play: () => {} };
const ATTACK_SECONDS = 0.005;
const SILENT_GAIN = 0.0001;

const scheduleSegment = (context: AudioContext, segment: ToneSegment, startAt: number): void => {
  const end = startAt + segment.durationMs / 1000;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();

  oscillator.type = segment.wave;
  oscillator.frequency.setValueAtTime(segment.startHz, startAt);
  oscillator.frequency.linearRampToValueAtTime(segment.endHz, end);
  envelope.gain.setValueAtTime(SILENT_GAIN, startAt);
  envelope.gain.linearRampToValueAtTime(segment.gain, startAt + ATTACK_SECONDS);
  envelope.gain.linearRampToValueAtTime(SILENT_GAIN, end);
  oscillator.connect(envelope);
  envelope.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(end);
};

export const createSoundPlayer = (
  recipes: Record<SoundName, SoundRecipe> = SOUND_RECIPES
): SoundPlayer => {
  if (typeof window === "undefined" || !("AudioContext" in window)) {
    return NO_OP_PLAYER;
  }
  const AudioContextClass = window.AudioContext;
  // Created on the first play so the browser sees it inside a user gesture.
  let context: AudioContext | null = null;

  return {
    play(name) {
      context ??= new AudioContextClass();
      if (context.state === "suspended") {
        void context.resume().catch(() => {});
      }
      const origin = context.currentTime;
      let cursorMs = 0;
      for (const segment of recipes[name].segments) {
        const startMs = segment.offsetMs ?? cursorMs;
        scheduleSegment(context, segment, origin + startMs / 1000);
        cursorMs = startMs + segment.durationMs;
      }
    }
  };
};

let sharedPlayer: SoundPlayer | null = null;

export const getSoundPlayer = (): SoundPlayer => {
  sharedPlayer ??= createSoundPlayer();
  return sharedPlayer;
};
