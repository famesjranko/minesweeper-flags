import type { MatchStateDto } from "@minesweeper-flags/shared";
import { describe, expect, it } from "vitest";
import { analyse } from "./bot-analysis.js";
import { claim, createMatch, createSizedMatch, reveal } from "./bot-test-support.js";

const at = (row: number, column: number): number => row * 16 + column;

const probabilityAt = (
  analysis: ReturnType<typeof analyse>,
  row: number,
  column: number
): number | undefined => analysis?.probabilities[at(row, column)];

// One hidden-neighbour clue proves a safe cell, and only that safe cell lets a
// second clue prove the mine at (4, 6).
const createChainedPosition = (): MatchStateDto => {
  const match = createMatch();
  match.board.mineCount = 13;
  const claims: [number, number][] = [
    [4, 4],
    [4, 5],
    [5, 4],
    [6, 4],
    [6, 5],
    [6, 6],
    [5, 7],
    [5, 8],
    [6, 8],
    [7, 6],
    [7, 7],
    [7, 8]
  ];
  for (const [row, column] of claims) {
    claim(match, row, column);
  }
  reveal(match, 5, 5, 7);
  reveal(match, 6, 7, 7);
  return match;
};

// (0,0)=1 sees {(1,0),(1,1)}; (0,1)=3 sees those plus {(0,2),(1,2)}. Only the
// subset rule shows that the two extra mines lie in the two extra cells.
const createSubsetPosition = (): MatchStateDto => {
  const match = createMatch();
  reveal(match, 0, 0, 1);
  reveal(match, 0, 1, 3);
  return match;
};

// (0,0)=1 and (0,2)=1 share (0,1) and (1,1). Either one shared cell holds the
// only mine, or (1,0) and one of (0,3), (1,2), (1,3) hold one each.
const createSharedPosition = (mineCount: number): MatchStateDto => {
  const match = createMatch();
  match.board.mineCount = mineCount;
  reveal(match, 0, 0, 1);
  reveal(match, 0, 2, 1);
  return match;
};

const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) {
    return 0;
  }
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
  }
  return result;
};

const neighborsOf = (row: number, column: number): [number, number][] =>
  [-1, 0, 1]
    .flatMap((dr) => [-1, 0, 1].map((dc): [number, number] => [row + dr, column + dc]))
    .filter(([r, c]) => (r !== row || c !== column) && r >= 0 && r < 16 && c >= 0 && c < 16);

// Independent oracle: try every assignment of the given frontier cells, keep
// those that satisfy every clue, and weight each by the ways to place the
// remaining mines on the other hidden cells.
const bruteForce = (match: MatchStateDto, frontier: [number, number][]): number[] => {
  const clues = match.board.cells.flat().filter((cell) => cell.status === "revealed");
  const hidden = match.board.cells.flat().filter((cell) => cell.status === "hidden").length;
  const others = hidden - frontier.length;
  const mineWeight = new Array<number>(frontier.length).fill(0);
  let total = 0;
  for (let mask = 0; mask < 1 << frontier.length; mask += 1) {
    const mines = new Set(frontier.flatMap(([r, c], i) => ((mask >> i) & 1 ? [`${r},${c}`] : [])));
    const fits = clues.every(
      (clue) =>
        neighborsOf(clue.row, clue.column).filter(([r, c]) => mines.has(`${r},${c}`)).length ===
        clue.adjacentMines
    );
    const weight = fits ? choose(others, match.board.mineCount - mines.size) : 0;
    total += weight;
    frontier.forEach((_, i) => {
      mineWeight[i]! += (mask >> i) & 1 ? weight : 0;
    });
  }
  return mineWeight.map((weight) => weight / total);
};

describe("analyse", () => {
  it("chains single-clue facts into a mine that depends on an earlier deduction", () => {
    // Given a clue that proves a mine only after another clue proves a neighbour safe
    const match = createChainedPosition();

    // When the single-clue analysis runs
    const analysis = analyse(match, "single");

    // Then the dependent cell is a certain mine
    expect(probabilityAt(analysis, 4, 6)).toBe(1);
  });

  it("does not chain facts at the direct level", () => {
    // Given a clue that proves a mine only after another clue proves a neighbour safe
    const match = createChainedPosition();

    // When the direct analysis runs
    const analysis = analyse(match, "direct");

    // Then the dependent cell stays uncertain
    expect(probabilityAt(analysis, 4, 6)).toBe(0.5);
  });

  it("proves mines with the subset rule between overlapping clues", () => {
    // Given a clue whose unknown cells all belong to a second clue that needs two more mines
    const match = createSubsetPosition();

    // When the pairs analysis runs
    const analysis = analyse(match, "pairs");

    // Then both cells outside the smaller clue are certain mines
    expect([probabilityAt(analysis, 0, 2), probabilityAt(analysis, 1, 2)]).toEqual([1, 1]);
  });

  it("misses subset-rule mines at the single level", () => {
    // Given a clue whose unknown cells all belong to a second clue that needs two more mines
    const match = createSubsetPosition();

    // When the single-clue analysis runs
    const analysis = analyse(match, "single");

    // Then neither cell outside the smaller clue is certain
    expect(probabilityAt(analysis, 0, 2)).toBeLessThan(1);
    expect(probabilityAt(analysis, 1, 2)).toBeLessThan(1);
  });

  it("weights each frontier assignment by the ways to place the remaining mines", () => {
    // Given two clues that share two cells on a board with 51 mines and 248 cells off the frontier
    const match = createSharedPosition(51);

    // When the exact analysis runs
    const analysis = analyse(match, "exact");

    // Then the shared cell, the private cell, and an outer cell have the counted probabilities
    // And the counts are 2·C(248,50) one-mine worlds against 3·C(248,49) two-mine worlds
    expect(probabilityAt(analysis, 0, 1)).toBeCloseTo(199 / 548, 12);
    expect(probabilityAt(analysis, 1, 0)).toBeCloseTo(150 / 548, 12);
    expect(probabilityAt(analysis, 0, 3)).toBeCloseTo(50 / 548, 12);
  });

  it("averages clue ratios instead of counting worlds at the pairs level", () => {
    // Given two clues that share two cells
    const match = createSharedPosition(51);

    // When the pairs analysis runs
    const analysis = analyse(match, "pairs");

    // Then the shared cell takes the average of one in three and one in five
    expect(probabilityAt(analysis, 0, 1)).toBeCloseTo(4 / 15, 12);
  });

  it("matches a brute-force count when two frontier components compete for few mines", () => {
    // Given two separate clue groups on a board with only three mines
    const match = createSharedPosition(3);
    reveal(match, 15, 15, 1);
    const frontier: [number, number][] = [
      [0, 1],
      [1, 0],
      [1, 1],
      [0, 3],
      [1, 2],
      [1, 3],
      [14, 14],
      [14, 15],
      [15, 14]
    ];

    // When the exact analysis runs
    const analysis = analyse(match, "exact");

    // Then every frontier probability equals the brute-force count
    const expected = bruteForce(match, frontier);
    frontier.forEach(([row, column], i) => {
      expect(probabilityAt(analysis, row, column)).toBeCloseTo(expected[i]!, 12);
    });
  });

  it("gives cells off the frontier the expected density of the remaining mines", () => {
    // Given two clues that share two cells on a board with 51 mines
    const match = createSharedPosition(51);

    // When the exact analysis runs
    const analysis = analyse(match, "exact");

    // Then a far cell has the weighted mean of 50 and 49 remaining mines over 248 cells
    const density = ((398 / 548) * 50 + (150 / 548) * 49) / 248;
    expect(probabilityAt(analysis, 10, 10)).toBeCloseTo(density, 12);
  });

  it("falls back to the local estimate for a component beyond the node budget", () => {
    // Given two clues that share two cells and a node budget too small to enumerate them
    const match = createSharedPosition(51);

    // When the exact analysis runs
    const analysis = analyse(match, "exact", { nodeBudget: 1 });

    // Then the shared cell keeps the local average estimate
    expect(probabilityAt(analysis, 0, 1)).toBeCloseTo(4 / 15, 12);
  });

  it("keeps local estimates when an over-budget group leaves no consistent mine count", () => {
    // Given two one-mine clues on a 2×3 board with two mines and a budget too small for them
    const match = createSizedMatch(2, 3, 2);
    reveal(match, 0, 0, 1);
    reveal(match, 0, 2, 1);

    // When the exact analysis runs
    const analysis = analyse(match, "exact", { nodeBudget: 1 });

    // Then the bot still has probabilities to choose from instead of a contradiction
    expect(analysis).not.toBeNull();
  });

  it("does not prove a mine from an estimated budget", () => {
    // Given a 4×3 board whose groups exceed a small budget and leave one free cell
    const match = createSizedMatch(4, 3, 5);
    reveal(match, 0, 0, 1);
    reveal(match, 0, 2, 1);
    reveal(match, 3, 2, 2);
    claim(match, 2, 0);

    // When the exact analysis runs with that budget
    const analysis = analyse(match, "exact", { nodeBudget: 3 });

    // Then the free cell, a mine in two of three layouts, is not reported as certain
    const freeCell = analysis?.probabilities[3 * 3 + 0];
    expect(freeCell).toBeGreaterThan(0);
    expect(freeCell).toBeLessThan(1);
  });

  it("does not prove a safe cell from an estimated budget", () => {
    // Given a 3×5 board whose groups exceed a small budget
    const match = createSizedMatch(3, 5, 4);
    reveal(match, 1, 0, 2);
    reveal(match, 1, 4, 1);
    reveal(match, 2, 3, 1);

    // When the exact analysis runs with that budget
    const analysis = analyse(match, "exact", { nodeBudget: 3 });

    // Then the free cell, a mine in one of three layouts, is not reported as safe
    const freeCell = analysis?.probabilities[0 * 5 + 2];
    expect(freeCell).toBeGreaterThan(0);
    expect(freeCell).toBeLessThan(1);
  });

  it("rejects clues that together need more mines than the board holds", () => {
    // Given two separate one-mine clues on a board with one mine in total
    const match = createMatch();
    match.board.mineCount = 1;
    reveal(match, 0, 0, 1);
    reveal(match, 15, 15, 1);

    // When the exact analysis runs
    const analysis = analyse(match, "exact");

    // Then the public facts are contradictory
    expect(analysis).toBeNull();
  });
});
