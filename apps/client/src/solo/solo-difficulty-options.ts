import type { SoloDifficulty } from "./bot/bot-profiles.js";

/** Picker order, weakest first. */
export const SOLO_DIFFICULTIES: readonly SoloDifficulty[] = ["easy", "normal", "hard"];

export const SOLO_DIFFICULTY_COPY: Readonly<
  Record<SoloDifficulty, { label: string; description: string }>
> = {
  easy: { label: "Easy", description: "Reads each clue on its own. Good for learning." },
  normal: { label: "Normal", description: "Reads every clue it can see. A steady opponent." },
  hard: { label: "Hard", description: "Works out the odds across the whole board." }
};
