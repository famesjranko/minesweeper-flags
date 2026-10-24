import { SOUND_RECIPES } from "./sound-recipes.js";

export type SoundName =
  | "reveal"
  | "flag"
  | "bomb"
  | "your-turn"
  | "win"
  | "lose"
  | "chat-sent"
  | "chat-received"
  | "resign";

interface SegmentBase {
  durationMs: number;
  gain: number;
  /** Start offset from the sound's start; omitted means right after the previous segment. */
  offsetMs?: number;
  /** Linear fade-in from silence. Defaults to 5 ms. */
  attackMs?: number;
  /** Fade-out shape. Defaults to exponential. */
  decay?: "linear" | "exponential";
}

export interface ToneSegment extends SegmentBase {
  kind: "tone";
  wave: OscillatorType;
  startHz: number;
  endHz: number;
}

export interface NoiseSegment extends SegmentBase {
  kind: "noise";
  filter: { type: BiquadFilterType; startHz: number; endHz: number; q?: number };
}

export type SoundSegment = ToneSegment | NoiseSegment;

export interface SoundRecipe {
  segments: SoundSegment[];
}

export interface SoundPlayer {
  play(name: SoundName): void;
}

const NO_OP_PLAYER: SoundPlayer = { play: () => {} };
const DEFAULT_ATTACK_MS = 5;
// Exponential ramps cannot reach 0, so they end at this level (-80 dB).
const SILENT_GAIN = 0.0001;
// Lets the stop land after the last envelope sample instead of clipping it.
const STOP_PADDING_S = 0.02;
const NOISE_BUFFER_SECONDS = 1;

// One white-noise buffer per context; looped sources cover any segment length.
const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();

const getNoiseBuffer = (context: AudioContext): AudioBuffer => {
  const cached = noiseBuffers.get(context);
  if (cached) {
    return cached;
  }
  const length = Math.ceil(NOISE_BUFFER_SECONDS * context.sampleRate);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    samples[i] = Math.random() * 2 - 1;
  }
  noiseBuffers.set(context, buffer);
  return buffer;
};

// Linear attack from silence to `gain`, then a decay that ends exactly at the segment end.
const applyEnvelope = (param: AudioParam, segment: SoundSegment, startAt: number): void => {
  const durationS = segment.durationMs / 1000;
  const attackS = Math.min(segment.attackMs ?? DEFAULT_ATTACK_MS, segment.durationMs) / 1000;
  const exponential = (segment.decay ?? "exponential") === "exponential";
  if (attackS > 0) {
    param.setValueAtTime(exponential ? SILENT_GAIN : 0, startAt);
    param.linearRampToValueAtTime(segment.gain, startAt + attackS);
  } else {
    param.setValueAtTime(segment.gain, startAt);
  }
  if (attackS >= durationS) {
    return;
  }
  if (exponential) {
    param.exponentialRampToValueAtTime(SILENT_GAIN, startAt + durationS);
  } else {
    param.linearRampToValueAtTime(0, startAt + durationS);
  }
};

// Exponential, so equal times give equal musical intervals.
const applySweep = (
  param: AudioParam,
  { startHz, endHz }: { startHz: number; endHz: number },
  startAt: number,
  durationS: number
): void => {
  if (!(startHz > 0 && endHz > 0)) {
    throw new RangeError(`Frequencies must be positive: ${startHz}, ${endHz}`);
  }
  param.setValueAtTime(startHz, startAt);
  if (endHz !== startHz) {
    param.exponentialRampToValueAtTime(endHz, startAt + durationS);
  }
};

interface SegmentSource {
  source: AudioScheduledSourceNode;
  output: AudioNode;
}

const scheduleTone = (
  context: AudioContext,
  segment: ToneSegment,
  startAt: number
): SegmentSource => {
  const oscillator = context.createOscillator();
  oscillator.type = segment.wave;
  applySweep(oscillator.frequency, segment, startAt, segment.durationMs / 1000);
  return { source: oscillator, output: oscillator };
};

const scheduleNoise = (
  context: AudioContext,
  segment: NoiseSegment,
  startAt: number
): SegmentSource => {
  const source = context.createBufferSource();
  source.buffer = getNoiseBuffer(context);
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = segment.filter.type;
  if (segment.filter.q !== undefined) {
    filter.Q.setValueAtTime(segment.filter.q, startAt);
  }
  applySweep(filter.frequency, segment.filter, startAt, segment.durationMs / 1000);
  source.connect(filter);
  return { source, output: filter };
};

const scheduleSegment = (context: AudioContext, segment: SoundSegment, startAt: number): void => {
  const { source, output } =
    segment.kind === "tone"
      ? scheduleTone(context, segment, startAt)
      : scheduleNoise(context, segment, startAt);
  const envelope = context.createGain();
  applyEnvelope(envelope.gain, segment, startAt);
  output.connect(envelope);
  envelope.connect(context.destination);
  source.onended = () => envelope.disconnect();
  source.start(startAt);
  source.stop(startAt + segment.durationMs / 1000 + STOP_PADDING_S);
};

export const createSoundPlayer = (
  recipes: Record<SoundName, SoundRecipe> = SOUND_RECIPES
): SoundPlayer => {
  if (typeof window === "undefined" || !("AudioContext" in window)) {
    return NO_OP_PLAYER;
  }
  const AudioContextClass = window.AudioContext;
  // Created on the first play. Only the toggle path is inside a user gesture;
  // after a refresh the first play comes from an effect and the context starts suspended.
  let context: AudioContext | null = null;
  // While the context is not running, currentTime is frozen, so scheduling would queue
  // every sound at the same instant. Keep only the latest request and play it on resume.
  let pending: SoundName | null = null;
  let resuming = false;

  const schedule = (ctx: AudioContext, name: SoundName): void => {
    const origin = ctx.currentTime;
    let cursorMs = 0;
    for (const segment of recipes[name].segments) {
      const startMs = segment.offsetMs ?? cursorMs;
      scheduleSegment(ctx, segment, origin + startMs / 1000);
      cursorMs = startMs + segment.durationMs;
    }
  };

  const resumeOnce = (ctx: AudioContext): void => {
    if (resuming) {
      return;
    }
    resuming = true;
    void ctx
      .resume()
      .then(() => {
        const name = pending;
        pending = null;
        if (name) {
          schedule(ctx, name);
        }
      })
      .catch(() => {
        pending = null;
      })
      .finally(() => {
        resuming = false;
      });
  };

  return {
    play(name) {
      context ??= new AudioContextClass();
      if (context.state !== "running") {
        pending = name;
        resumeOnce(context);
        return;
      }
      schedule(context, name);
    }
  };
};

let sharedPlayer: SoundPlayer | null = null;

export const getSoundPlayer = (): SoundPlayer => {
  sharedPlayer ??= createSoundPlayer();
  return sharedPlayer;
};
