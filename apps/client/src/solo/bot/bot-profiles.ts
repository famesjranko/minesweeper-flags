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
  /**
   * Choice spread, part one: how many cells the bot weighs for a pick. The best-scored
   * cell always counts; the others are the next best plausible cells, those next to a
   * revealed clue or a claimed mine. 1 always takes the best cell.
   */
  choicePool: number;
  /**
   * Choice spread, part two: softmax temperature over the pool's scores. 0 always takes
   * the best cell; a higher value takes a less-than-best plausible cell more often.
   */
  choiceTemperature: number;
  /**
   * Attention: the bot notices only cells, certain mines, and clues within this many
   * steps (Chebyshev distance) of the most recent action. When nothing plausible is in
   * reach it doubles the radius until something is. Infinity notices the whole board.
   */
  attentionRadius: number;
  /** Score bonus for a cell next to the focus point, scaled by 1 / distance. */
  localityWeight: number;
  /** A bomb is drawn uniformly from this many best expected-yield centres. */
  bombCandidates: number;
}

// The levels differ in how much they deduce. The choice spread is kept small:
// they only vary the choice between cells the bot already rates as close, so a
// weaker level plays plausible moves rather than deliberate blunders. Normal
// reasons exactly like the original bot.
export const BOT_PROFILES: Readonly<Record<SoloDifficulty, BotProfile>> = {
  easy: {
    deduction: "direct",
    choicePool: 3,
    choiceTemperature: 0.04,
    attentionRadius: Number.POSITIVE_INFINITY,
    localityWeight: 0.1,
    bombCandidates: 5
  },
  normal: {
    deduction: "single",
    choicePool: 3,
    choiceTemperature: 0.03,
    attentionRadius: Number.POSITIVE_INFINITY,
    localityWeight: 0.08,
    bombCandidates: 3
  },
  hard: {
    deduction: "exact",
    choicePool: 1,
    choiceTemperature: 0,
    attentionRadius: Number.POSITIVE_INFINITY,
    localityWeight: 0.06,
    bombCandidates: 1
  }
};

export const DEFAULT_SOLO_DIFFICULTY: SoloDifficulty = "normal";
