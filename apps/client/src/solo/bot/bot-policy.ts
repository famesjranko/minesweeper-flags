import { BOMB_RADIUS } from "@minesweeper-flags/game-engine";
import { getBombDeficit, type MatchStateDto } from "@minesweeper-flags/shared";
import type { BotAnalysis } from "./bot-analysis.js";
import { type BoardShape, columnOf, distance, hasRevealedNeighbor, rowOf } from "./bot-board.js";
import type { BotProfile } from "./bot-profiles.js";

export type SoloBotAction = { type: "select" | "bomb"; row: number; column: number };

/** Why the bot chose its action: a proven mine, a clue-informed pick, a blind pick, or a bomb. */
export type SoloDecisionKind = "certain" | "frontier" | "guess" | "bomb";

export interface SoloDecision {
  action: SoloBotAction;
  kind: SoloDecisionKind;
}

export interface PolicyInput {
  match: MatchStateDto;
  botPlayerId: string;
  analysis: BotAnalysis;
  profile: BotProfile;
  random: () => number;
}

interface Scored {
  cell: number;
  score: number;
}

// Rounding keeps floating-point noise from splitting scores that are really equal.
const roundScore = (score: number): number => Math.round(score * 1e9) / 1e9;

const pickIndex = (length: number, random: () => number): number =>
  Math.min(length - 1, Math.floor(random() * length));

const shuffle = <T>(items: T[], random: () => number): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1, random);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

/** The best `count` items by score; equal scores are ordered at random, never by board position. */
const topByScore = (items: Scored[], count: number, random: () => number): Scored[] =>
  shuffle(items, random)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, count));

const pickWeighted = (items: Scored[], weights: number[], random: () => number): number => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = random() * total;
  for (const [index, item] of items.entries()) {
    target -= weights[index]!;
    if (target < 0) {
      return item.cell;
    }
  }
  return items[items.length - 1]!.cell;
};

const softmaxPick = (items: Scored[], temperature: number, random: () => number): number => {
  const best = items[0]!.score;
  const weights = items.map((item) =>
    temperature > 0 ? Math.exp((item.score - best) / temperature) : item.score === best ? 1 : 0
  );
  return pickWeighted(items, weights, random);
};

const focusOf = (match: MatchStateDto): { row: number; column: number } | null =>
  match.lastAction ? { row: match.lastAction.row, column: match.lastAction.column } : null;

const closeness = (
  shape: BoardShape,
  cell: number,
  focus: { row: number; column: number } | null
): number => (focus ? 1 / Math.max(1, distance(shape, cell, focus)) : 0);

const chooseCertainMine = (input: PolicyInput, hidden: number[]): number | null => {
  const focus = focusOf(input.match);
  const certain = hidden
    .filter((cell) => input.analysis.probabilities[cell] === 1)
    .map((cell) => ({ cell, score: closeness(input.analysis.board, cell, focus) }));
  return certain.length === 0 ? null : topByScore(certain, 1, input.random)[0]!.cell;
};

const canBomb = (match: MatchStateDto, botPlayerId: string): boolean => {
  const bot = match.players.find((player) => player.playerId === botPlayerId);
  const opponent = match.players.find((player) => player.playerId !== botPlayerId);
  return (
    !!bot &&
    !!opponent &&
    bot.bombsRemaining === 1 &&
    opponent.score - bot.score >= getBombDeficit(match.board.mineCount)
  );
};

// Mirrors the engine's bomb bounds: near an edge the square shifts inward, and
// an axis shorter than the square is covered whole.
const bombSpan = (position: number, axisLength: number): [number, number] => {
  const span = Math.min(axisLength, BOMB_RADIUS * 2 + 1);
  const start = Math.min(Math.max(0, position - BOMB_RADIUS), Math.max(0, axisLength - span));
  return [start, start + span - 1];
};

const bombYield = (analysis: BotAnalysis, cell: number): number => {
  const { board } = analysis;
  const [top, bottom] = bombSpan(rowOf(board, cell), board.rows);
  const [left, right] = bombSpan(columnOf(board, cell), board.columns);
  let total = 0;
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      total += analysis.probabilities[row * board.columns + column]!;
    }
  }
  return total;
};

const chooseBomb = (input: PolicyInput, hidden: number[]): number => {
  const yields = hidden.map((cell) => ({
    cell,
    score: roundScore(bombYield(input.analysis, cell))
  }));
  const best = topByScore(yields, input.profile.bombCandidates, input.random);
  return best[pickIndex(best.length, input.random)]!.cell;
};

// Weight grows linearly with distance from the nearest edge on each axis.
const openingWeight = (shape: BoardShape, cell: number): number => {
  const row = rowOf(shape, cell);
  const column = columnOf(shape, cell);
  return (
    (Math.min(row, shape.rows - 1 - row) + 1) * (Math.min(column, shape.columns - 1 - column) + 1)
  );
};

const chooseOpening = (shape: BoardShape, hidden: number[], random: () => number): number => {
  const items = hidden.map((cell) => ({ cell, score: 0 }));
  const weights = hidden.map((cell) => openingWeight(shape, cell));
  return pickWeighted(items, weights, random);
};

const chooseScored = (input: PolicyInput, hidden: number[]): number => {
  const focus = focusOf(input.match);
  const { localityWeight, temperature, topK } = input.profile;
  const scored = hidden.map((cell) => ({
    cell,
    score: roundScore(
      input.analysis.probabilities[cell]! +
        localityWeight * closeness(input.analysis.board, cell, focus)
    )
  }));
  return softmaxPick(topByScore(scored, topK, input.random), temperature, input.random);
};

const select = (shape: BoardShape, cell: number, kind: SoloDecisionKind): SoloDecision => ({
  action: { type: "select", row: rowOf(shape, cell), column: columnOf(shape, cell) },
  kind
});

export const decide = (input: PolicyInput): SoloDecision | null => {
  const { board } = input.analysis;
  const hidden = board.hidden.flatMap((isHidden, cell) => (isHidden ? [cell] : []));
  if (hidden.length === 0) {
    return null;
  }
  const certain = chooseCertainMine(input, hidden);
  if (certain !== null) {
    return select(board, certain, "certain");
  }
  if (canBomb(input.match, input.botPlayerId)) {
    const center = chooseBomb(input, hidden);
    return {
      action: { type: "bomb", row: rowOf(board, center), column: columnOf(board, center) },
      kind: "bomb"
    };
  }
  if (board.clues.every((clue) => clue < 0)) {
    return select(board, chooseOpening(board, hidden, input.random), "guess");
  }
  const cell = chooseScored(input, hidden);
  return select(board, cell, hasRevealedNeighbor(board, cell) ? "frontier" : "guess");
};
