export type SoloDifficulty = "easy" | "normal" | "hard";

/**
 * How far the bot reasons from public clues:
 * - direct: each clue alone, counting only claimed mines.
 * - single: single-clue rules repeated until nothing changes.
 * - pairs: single plus the subset rule between overlapping clues.
 * - exact: pairs plus enumeration of every consistent frontier assignment.
 */
export type Deduction = "direct" | "single" | "pairs" | "exact";

export interface BotProfile {
  deduction: Deduction;
  /** Softmax temperature over cell scores; 0 always takes the best score. */
  temperature: number;
  /** Only the best `topK` cells by score are ever drawn. */
  topK: number;
  /** Score bonus for a cell next to the focus point, scaled by 1 / distance. */
  localityWeight: number;
  /** A bomb is drawn uniformly from this many best expected-yield centres. */
  bombCandidates: number;
}

// The levels differ in how much they deduce. Temperature and topK are kept small:
// they only vary the choice between cells the bot already rates as close, so a
// weaker level plays plausible moves rather than deliberate blunders. Normal
// reasons exactly like the original bot.
export const BOT_PROFILES: Readonly<Record<SoloDifficulty, BotProfile>> = {
  easy: {
    deduction: "direct",
    temperature: 0.04,
    topK: 3,
    localityWeight: 0.1,
    bombCandidates: 5
  },
  normal: {
    deduction: "single",
    temperature: 0.03,
    topK: 3,
    localityWeight: 0.08,
    bombCandidates: 3
  },
  hard: {
    deduction: "exact",
    temperature: 0,
    topK: 1,
    localityWeight: 0.06,
    bombCandidates: 1
  }
};

export const DEFAULT_SOLO_DIFFICULTY: SoloDifficulty = "normal";
