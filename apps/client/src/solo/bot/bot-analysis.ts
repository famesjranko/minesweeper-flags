import type { MatchStateDto } from "@minesweeper-flags/shared";
import {
  type BoardView,
  type ClueState,
  cellDistance,
  clueStates,
  type Fact,
  isUnknown,
  readBoard,
  settledCluesHold,
  summarise
} from "./bot-board.js";
import { refineExactly } from "./bot-enumeration.js";
import type { Deduction } from "./bot-profiles.js";

export interface BotAnalysis {
  board: BoardView;
  facts: Fact[];
  /** Mine probability of each hidden cell; 0 for cells that are not hidden. */
  probabilities: number[];
}

export interface AnalysisOptions {
  /** Backtracking steps allowed per decision before exact analysis falls back. */
  nodeBudget?: number;
}

type Step = "unchanged" | "changed" | "contradiction";

const DEFAULT_NODE_BUDGET = 20_000;
// Two clues can share an unknown neighbour only when they are at most two cells apart.
const PAIR_REACH = 2;

const setFacts = (facts: Fact[], cells: number[], fact: Fact): Step => {
  let step: Step = "unchanged";
  for (const cell of cells) {
    if (facts[cell] === fact) {
      continue;
    }
    // A cell already proven the other way means the public clues disagree.
    if (facts[cell] !== "unknown") {
      return "contradiction";
    }
    facts[cell] = fact;
    step = "changed";
  }
  return step;
};

const merge = (current: Step, next: Step): Step =>
  current === "contradiction" || next === "contradiction"
    ? "contradiction"
    : current === "changed" || next === "changed"
      ? "changed"
      : "unchanged";

const applySingleRule = (facts: Fact[], clue: ClueState): Step => {
  if (clue.remaining < 0 || clue.remaining > clue.unknowns.length) {
    return "contradiction";
  }
  if (clue.remaining === 0) {
    return setFacts(facts, clue.unknowns, "safe");
  }
  return clue.remaining === clue.unknowns.length
    ? setFacts(facts, clue.unknowns, "mine")
    : "unchanged";
};

const singleRound = (board: BoardView, facts: Fact[]): Step => {
  let step: Step = "unchanged";
  for (const cell of board.clueCells) {
    step = merge(step, applySingleRule(facts, summarise(board, facts, cell)));
    if (step === "contradiction") {
      return step;
    }
  }
  return step;
};

// When every unknown of `inner` is also an unknown of `outer`, the mines that
// `outer` needs beyond `inner` must lie in the cells only `outer` touches.
const applySubsetRule = (facts: Fact[], inner: ClueState, outer: ClueState): Step => {
  if (!inner.unknowns.every((cell) => outer.unknowns.includes(cell))) {
    return "unchanged";
  }
  const difference = outer.unknowns.filter((cell) => !inner.unknowns.includes(cell));
  const mines = outer.remaining - inner.remaining;
  if (mines < 0 || mines > difference.length) {
    return "contradiction";
  }
  if (mines === 0) {
    return setFacts(facts, difference, "safe");
  }
  return mines === difference.length ? setFacts(facts, difference, "mine") : "unchanged";
};

const pairRound = (board: BoardView, facts: Fact[]): Step => {
  const open = clueStates(board, facts).filter((clue) => clue.unknowns.length > 0);
  let step: Step = "unchanged";
  for (const inner of open) {
    for (const outer of open) {
      if (step === "contradiction") {
        return step;
      }
      if (outer !== inner && cellDistance(board, outer.cell, inner.cell) <= PAIR_REACH) {
        step = merge(step, applySubsetRule(facts, inner, outer));
      }
    }
  }
  return step;
};

// Every clue is read once against the claimed flags only, so a fact deduced
// from one clue never helps another. This is the shallowest useful reasoning.
const applyDirectly = (board: BoardView, facts: Fact[]): boolean =>
  clueStates(board, facts).reduce<Step>(
    (step, clue) => merge(step, applySingleRule(facts, clue)),
    "unchanged"
  ) !== "contradiction";

const settleFacts = (board: BoardView, facts: Fact[], deduction: Deduction): boolean => {
  if (deduction === "direct") {
    return applyDirectly(board, facts);
  }
  const usePairs = deduction !== "single";
  // Every changing round proves at least one more cell, so this cap is never the binding limit.
  for (let round = 0; round <= board.size; round += 1) {
    const single = singleRound(board, facts);
    if (single !== "unchanged") {
      if (single === "contradiction") {
        return false;
      }
      continue;
    }
    const pairs = usePairs ? pairRound(board, facts) : "unchanged";
    if (pairs !== "changed") {
      return pairs === "unchanged";
    }
  }
  return false;
};

/** Mines not yet accounted for and the hidden cells they may occupy, or null if impossible. */
export const unresolvedMines = (
  board: BoardView,
  facts: Fact[]
): { mines: number; cells: number } | null => {
  let knownMines = 0;
  let cells = 0;
  for (let cell = 0; cell < board.size; cell += 1) {
    if (facts[cell] === "mine") {
      knownMines += 1;
    } else if (isUnknown(board, facts, cell)) {
      cells += 1;
    }
  }
  const mines = board.mineCount - knownMines;
  return mines < 0 || mines > cells ? null : { mines, cells };
};

// Each unknown cell takes the average mine ratio of the clues around it, and
// cells with no clue take the board-wide ratio. This is the original bot's estimate.
// `clueFacts` are the facts the clues are read against, which can be fewer than `facts`.
const estimateLocally = (
  board: BoardView,
  facts: Fact[],
  clueFacts: Fact[],
  fallback: number
): number[] => {
  const ratios = new Array<number>(board.size).fill(-1);
  for (const clue of clueStates(board, clueFacts)) {
    if (clue.unknowns.length > 0) {
      ratios[clue.cell] = clue.remaining / clue.unknowns.length;
    }
  }
  return facts.map((fact, cell) => {
    if (!board.hidden[cell] || fact === "safe") {
      return 0;
    }
    if (fact === "mine") {
      return 1;
    }
    let total = 0;
    let count = 0;
    for (const neighbor of board.neighbors[cell]!) {
      if (ratios[neighbor]! >= 0) {
        total += ratios[neighbor]!;
        count += 1;
      }
    }
    return count === 0 ? fallback : total / count;
  });
};

export const analyse = (
  match: MatchStateDto,
  deduction: Deduction,
  options: AnalysisOptions = {}
): BotAnalysis | null => {
  const board = readBoard(match);
  const claimedOnly = board.claimed.map((claimed): Fact => (claimed ? "mine" : "unknown"));
  const facts = [...claimedOnly];
  if (!settledCluesHold(board) || !settleFacts(board, facts, deduction)) {
    return null;
  }
  const unresolved = unresolvedMines(board, facts);
  if (!unresolved) {
    return null;
  }
  const fallback = unresolved.cells === 0 ? 0 : unresolved.mines / unresolved.cells;
  // The direct level reads every clue against claimed mines only, here as in its deductions.
  const clueFacts = deduction === "direct" ? claimedOnly : facts;
  const probabilities = estimateLocally(board, facts, clueFacts, fallback);
  if (deduction !== "exact") {
    return { board, facts, probabilities };
  }
  const refined = refineExactly(
    { board, facts, estimates: probabilities },
    unresolved.mines,
    options.nodeBudget ?? DEFAULT_NODE_BUDGET
  );
  return refined ? { board, facts, probabilities: refined } : null;
};
