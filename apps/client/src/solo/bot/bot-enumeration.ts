import { type BoardView, type ClueState, clueStates, type Fact } from "./bot-board.js";

interface Constraint {
  /** Indices into the owning component's `cells`. */
  cells: number[];
  need: number;
}

interface Component {
  cells: number[];
  constraints: Constraint[];
}

/** Valid assignments of one component, grouped by how many mines each one places. */
interface ComponentCounts {
  /** solutions[k]: assignments with k mines. */
  solutions: number[];
  /** mineCounts[k][i]: of those, how many put a mine on cell i. */
  mineCounts: number[][];
}

type Enumeration = ComponentCounts | "over-budget" | "contradiction";

export interface ExactInput {
  board: BoardView;
  facts: Fact[];
  /** Local estimates used for any component the budget cannot cover. */
  estimates: number[];
}

// Grows on demand so any board size works; entry n is ln(n!).
const LOG_FACTORIAL: number[] = [0];

const logFactorial = (n: number): number => {
  for (let i = LOG_FACTORIAL.length; i <= n; i += 1) {
    LOG_FACTORIAL.push(LOG_FACTORIAL[i - 1]! + Math.log(i));
  }
  return LOG_FACTORIAL[n]!;
};

const logChoose = (n: number, k: number): number =>
  k < 0 || k > n ? -Infinity : logFactorial(n) - logFactorial(k) - logFactorial(n - k);

const logSumExp = (logs: number[]): number => {
  const max = Math.max(...logs);
  return max === -Infinity
    ? max
    : max + Math.log(logs.reduce((sum, l) => sum + Math.exp(l - max), 0));
};

const find = (parent: number[], cell: number): number => {
  let root = cell;
  while (parent[root] !== root) {
    root = parent[root]!;
  }
  parent[cell] = root;
  return root;
};

interface Group {
  cells: number[];
  /** Global cell index to its index in `cells`. */
  local: Map<number, number>;
  clues: ClueState[];
}

const buildComponents = (board: BoardView, facts: Fact[]): Component[] => {
  const open = clueStates(board, facts).filter((clue) => clue.unknowns.length > 0);
  const parent = Array.from({ length: board.size }, (_, cell) => cell);
  for (const clue of open) {
    for (const cell of clue.unknowns) {
      parent[find(parent, cell)] = find(parent, clue.unknowns[0]!);
    }
  }
  const byRoot = new Map<number, Group>();
  for (const clue of open) {
    const root = find(parent, clue.unknowns[0]!);
    const group: Group = byRoot.get(root) ?? { cells: [], local: new Map(), clues: [] };
    byRoot.set(root, group);
    group.clues.push(clue);
    // Clues arrive in board order, so cells are numbered in a sweep that closes
    // constraints early and keeps backtracking shallow.
    for (const cell of clue.unknowns) {
      if (!group.local.has(cell)) {
        group.local.set(cell, group.cells.length);
        group.cells.push(cell);
      }
    }
  }
  return [...byRoot.values()].map((group) => ({
    cells: group.cells,
    constraints: group.clues.map((clue) => ({
      cells: clue.unknowns.map((cell) => group.local.get(cell)!),
      need: clue.remaining
    }))
  }));
};

const enumerate = (
  component: Component,
  maxMines: number,
  budget: { left: number }
): Enumeration => {
  const size = component.cells.length;
  const need = component.constraints.map((constraint) => constraint.need);
  const open = component.constraints.map((constraint) => constraint.cells.length);
  const touching = component.cells.map((_, cell) =>
    component.constraints.flatMap((constraint, index) =>
      constraint.cells.includes(cell) ? [index] : []
    )
  );
  const mine = new Array<boolean>(size).fill(false);
  const counts: ComponentCounts = {
    solutions: new Array<number>(size + 1).fill(0),
    mineCounts: Array.from({ length: size + 1 }, () => new Array<number>(size).fill(0))
  };

  const fits = (cell: number, value: number): boolean =>
    touching[cell]!.every((c) => need[c]! - value >= 0 && need[c]! - value <= open[c]! - 1);
  const place = (cell: number, value: number, sign: number): void => {
    for (const c of touching[cell]!) {
      need[c]! -= sign * value;
      open[c]! -= sign;
    }
    mine[cell] = sign > 0 && value === 1;
  };
  const record = (mines: number): void => {
    counts.solutions[mines]! += 1;
    const row = counts.mineCounts[mines]!;
    mine.forEach((isMine, cell) => {
      row[cell]! += isMine ? 1 : 0;
    });
    budget.left -= size;
  };
  // Returns false only when the budget runs out.
  const visit = (cell: number, mines: number): boolean => {
    budget.left -= 1;
    if (budget.left < 0) {
      return false;
    }
    if (cell === size) {
      record(mines);
      return true;
    }
    for (const value of [0, 1]) {
      if (mines + value <= maxMines && fits(cell, value)) {
        place(cell, value, 1);
        const finished = visit(cell + 1, mines + value);
        place(cell, value, -1);
        if (!finished) {
          return false;
        }
      }
    }
    return true;
  };

  if (!visit(0, 0)) {
    return "over-budget";
  }
  return counts.solutions.some((count) => count > 0) ? counts : "contradiction";
};

const convolve = (a: number[], b: number[], limit: number): number[] => {
  const out = new Array<number>(Math.min(a.length + b.length - 1, limit + 1)).fill(0);
  a.forEach((x, i) => {
    b.forEach((y, j) => {
      if (i + j <= limit) {
        out[i + j]! += x * y;
      }
    });
  });
  // Only ratios matter; rescaling keeps long products of counts finite.
  const max = Math.max(...out);
  return max > 0 ? out.map((value) => value / max) : out;
};

/**
 * P(k) ∝ weights[k] · Σ_j others[j] · C(free, mines − k − j): a component holding k
 * mines, the other components j, and the cells off the frontier the rest.
 */
const countDistribution = (
  weights: number[],
  others: number[],
  free: { cells: number; mines: number }
): number[] | null => {
  const logs = weights.map((weight, k) =>
    weight === 0
      ? -Infinity
      : Math.log(weight) +
        logSumExp(
          others.map((other, j) =>
            other === 0 ? -Infinity : Math.log(other) + logChoose(free.cells, free.mines - k - j)
          )
        )
  );
  const total = logSumExp(logs);
  return total === -Infinity ? null : logs.map((l) => Math.exp(l - total));
};

// Keeps an approximate probability off 0 and 1, which the policy reads as proof.
const UNPROVEN_MARGIN = 1e-9;

/**
 * With an exact mine budget, a cell is certain when every weighted assignment agrees.
 * With an approximate budget (a group ran past the node budget), the weights may wrongly
 * exclude some counts, so certainty needs every assignment of the group at any count.
 */
const cellProbability = (
  counts: ComponentCounts,
  distribution: number[],
  cell: number,
  approximate: boolean
): number => {
  let probability = 0;
  let alwaysMine = true;
  let neverMine = true;
  distribution.forEach((weight, k) => {
    // A weight would need a ratio near e^-709 to underflow to 0, beyond these board sizes.
    const possible = approximate ? counts.solutions[k]! > 0 : weight > 0;
    if (!possible) return;
    const share = counts.mineCounts[k]![cell]! / counts.solutions[k]!;
    probability += weight * share;
    alwaysMine &&= share === 1;
    neverMine &&= share === 0;
  });
  // Exact 0 and 1 matter: the policy treats p = 1 as a certain mine.
  if (alwaysMine) return 1;
  if (neverMine) return 0;
  return approximate
    ? Math.min(1 - UNPROVEN_MARGIN, Math.max(UNPROVEN_MARGIN, probability))
    : probability;
};

const freeDensity = (distribution: number[], free: { cells: number; mines: number }): number => {
  const left = distribution.flatMap((weight, k) => (weight > 0 ? [free.mines - k] : []));
  if (left.every((mines) => mines === free.cells)) {
    return 1;
  }
  if (left.every((mines) => mines === 0)) {
    return 0;
  }
  return distribution.reduce((sum, weight, k) => sum + weight * (free.mines - k), 0) / free.cells;
};

const freeCellsOf = (input: ExactInput, frontier: Set<number>): number[] =>
  input.facts.flatMap((fact, cell) =>
    input.board.hidden[cell] && fact === "unknown" && !frontier.has(cell) ? [cell] : []
  );

/**
 * Exact mine probabilities over the frontier, weighted by how many ways the
 * remaining mines fit off the frontier. Returns null when no assignment fits.
 */
export const refineExactly = (
  input: ExactInput,
  mines: number,
  nodeBudget: number
): number[] | null => {
  const components = buildComponents(input.board, input.facts).sort(
    (a, b) => a.cells.length - b.cells.length
  );
  const budget = { left: nodeBudget };
  const solved: { component: Component; counts: ComponentCounts }[] = [];
  let estimatedMines = 0;
  for (const component of components) {
    const result = budget.left > 0 ? enumerate(component, mines, budget) : "over-budget";
    if (result === "contradiction") {
      return null;
    }
    if (result === "over-budget") {
      // The component keeps its local estimates and reserves their expected mines.
      estimatedMines += component.cells.reduce((sum, cell) => sum + input.estimates[cell]!, 0);
    } else {
      solved.push({ component, counts: result });
    }
  }
  const frontier = new Set(components.flatMap((component) => component.cells));
  const freeCells = freeCellsOf(input, frontier);
  const free = { cells: freeCells.length, mines: Math.max(0, mines - Math.round(estimatedMines)) };
  const approximate = solved.length < components.length;
  // A rounded budget can rule out every count without the clues being contradictory, so
  // an approximate failure keeps the local estimates instead of reporting a contradiction.
  return (
    combine({ input, solved, freeCells, free, approximate }) ??
    (approximate ? input.estimates : null)
  );
};

interface CombineInput {
  input: ExactInput;
  solved: { component: Component; counts: ComponentCounts }[];
  freeCells: number[];
  free: { cells: number; mines: number };
  /** True when a group ran past the node budget, so `free.mines` is only an estimate. */
  approximate: boolean;
}

const combine = ({
  input,
  solved,
  freeCells,
  free,
  approximate
}: CombineInput): number[] | null => {
  const weights = solved.map(({ counts }) => counts.solutions);
  const prefix: number[][] = [[1]];
  const suffix: number[][] = new Array<number[]>(weights.length + 1).fill([1]);
  for (const [i, w] of weights.entries()) {
    prefix.push(convolve(prefix[i]!, w, free.mines));
  }
  for (let i = weights.length - 1; i >= 0; i -= 1) {
    suffix[i] = convolve(suffix[i + 1]!, weights[i]!, free.mines);
  }
  const probabilities = [...input.estimates];
  for (const [i, { component, counts }] of solved.entries()) {
    const others = convolve(prefix[i]!, suffix[i + 1]!, free.mines);
    const distribution = countDistribution(weights[i]!, others, free);
    if (!distribution) {
      return null;
    }
    component.cells.forEach((cell, local) => {
      probabilities[cell] = cellProbability(counts, distribution, local, approximate);
    });
  }
  const totals = countDistribution(prefix[weights.length]!, [1], free);
  if (!totals) {
    return null;
  }
  // Off-frontier cells keep their local estimate when the remaining-mine count is a guess.
  if (free.cells > 0 && !approximate) {
    const density = freeDensity(totals, free);
    for (const cell of freeCells) {
      probabilities[cell] = density;
    }
  }
  return probabilities;
};
