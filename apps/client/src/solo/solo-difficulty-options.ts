import type { SoloDifficulty } from "./bot/bot-profiles.js";

/** Picker order, weakest first. */
export const SOLO_DIFFICULTIES: readonly SoloDifficulty[] = ["easy", "normal", "hard"];

export const SOLO_DIFFICULTY_COPY: Readonly<Record<SoloDifficulty, { label: string }>> = {
  easy: { label: "Easy" },
  normal: { label: "Normal" },
  hard: { label: "Hard" }
};
