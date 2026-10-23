import type { SoloDifficulty } from "./bot/bot-profiles.js";

/** Picker order, weakest first. */
export const SOLO_DIFFICULTIES: readonly SoloDifficulty[] = ["easy", "normal", "hard"];

export const SOLO_DIFFICULTY_COPY: Readonly<
  Record<SoloDifficulty, { label: string; description: string }>
> = {
  easy: { label: "Easy", description: "Beginner that reads each clue on its own." },
  normal: { label: "Normal", description: "Solid player that reads every clue it can see." },
  hard: { label: "Hard", description: "Expert that works out the odds across the whole board." }
};
