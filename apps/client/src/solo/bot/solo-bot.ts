import { BOARD_COLUMNS, BOARD_ROWS, BOMB_RADIUS } from "@minesweeper-flags/game-engine";
import { type MatchStateDto, MIN_BOMB_DEFICIT } from "@minesweeper-flags/shared";

type SoloAction = { type: "select" | "bomb"; row: number; column: number };
type Fact = "unknown" | "safe" | "mine";
type ClueSummary = { knownMines: number; unknownNeighbors: [number, number][] };
type InferenceContext = { match: MatchStateDto; facts: Fact[][]; fallback: number };
type ClueInference = "unchanged" | "changed" | "contradiction";

const MAX_PROPAGATION_ROUNDS = BOARD_ROWS * BOARD_COLUMNS;
export const SOLO_BOT_MAX_OPERATIONS =
  MAX_PROPAGATION_ROUNDS * BOARD_ROWS * BOARD_COLUMNS * 8 +
  BOARD_ROWS * BOARD_COLUMNS * (8 * 8 + (BOMB_RADIUS * 2 + 1) ** 2 + 2);

const isHidden = (cell: MatchStateDto["board"]["cells"][number][number]): boolean =>
  cell.status === "hidden";

const isSupportedCell = (
  cell: MatchStateDto["board"]["cells"][number][number],
  row: number,
  column: number
): boolean => {
  if (cell.row !== row || cell.column !== column) {
    return false;
  }
  if (cell.status === "revealed") {
    return (
      Number.isInteger(cell.adjacentMines) &&
      cell.adjacentMines !== null &&
      cell.adjacentMines >= 0 &&
      cell.adjacentMines <= 8
    );
  }
  return cell.status !== "mine-revealed";
};

const isSupportedMatch = (match: MatchStateDto, botPlayerId: string): boolean => {
  if (
    match.phase !== "live" ||
    match.turnPhase !== "awaiting_action" ||
    match.currentTurnPlayerId !== botPlayerId ||
    match.board.rows !== BOARD_ROWS ||
    match.board.columns !== BOARD_COLUMNS ||
    match.board.cells.length !== BOARD_ROWS ||
    !match.players.some((player) => player.playerId === botPlayerId) ||
    !Number.isInteger(match.board.mineCount) ||
    match.board.mineCount < 0 ||
    match.board.mineCount > BOARD_ROWS * BOARD_COLUMNS
  ) {
    return false;
  }

  return match.board.cells.every(
    (row, rowIndex) =>
      row.length === BOARD_COLUMNS &&
      row.every((cell, columnIndex) => isSupportedCell(cell, rowIndex, columnIndex))
  );
};

const forEachNeighbor = (
  row: number,
  column: number,
  visit: (neighborRow: number, neighborColumn: number) => void
): void => {
  for (
    let neighborRow = Math.max(0, row - 1);
    neighborRow <= Math.min(BOARD_ROWS - 1, row + 1);
    neighborRow += 1
  ) {
    for (
      let neighborColumn = Math.max(0, column - 1);
      neighborColumn <= Math.min(BOARD_COLUMNS - 1, column + 1);
      neighborColumn += 1
    ) {
      if (neighborRow !== row || neighborColumn !== column) {
        visit(neighborRow, neighborColumn);
      }
    }
  }
};

const summarizeClue = (
  match: MatchStateDto,
  facts: Fact[][],
  row: number,
  column: number
): ClueSummary => {
  let knownMines = 0;
  const unknownNeighbors: [number, number][] = [];
  forEachNeighbor(row, column, (neighborRow, neighborColumn) => {
    const fact = facts[neighborRow]![neighborColumn]!;
    if (fact === "mine") {
      knownMines += 1;
    } else if (fact === "unknown" && isHidden(match.board.cells[neighborRow]![neighborColumn]!)) {
      unknownNeighbors.push([neighborRow, neighborColumn]);
    }
  });
  return { knownMines, unknownNeighbors };
};

const applyClueFacts = (
  match: MatchStateDto,
  facts: Fact[][],
  row: number,
  column: number
): ClueInference => {
  const cell = match.board.cells[row]![column]!;
  if (cell.status !== "revealed") {
    return "unchanged";
  }
  const summary = summarizeClue(match, facts, row, column);
  const remaining = cell.adjacentMines! - summary.knownMines;
  if (remaining < 0 || remaining > summary.unknownNeighbors.length) {
    return "contradiction";
  }
  if (remaining !== 0 && remaining !== summary.unknownNeighbors.length) {
    return "unchanged";
  }

  const nextFact: Fact = remaining === 0 ? "safe" : "mine";
  for (const [neighborRow, neighborColumn] of summary.unknownNeighbors) {
    facts[neighborRow]![neighborColumn] = nextFact;
  }
  return summary.unknownNeighbors.length === 0 ? "unchanged" : "changed";
};

const inferFacts = (match: MatchStateDto): Fact[][] | null => {
  const facts = match.board.cells.map((row) =>
    row.map((cell) => (cell.status === "claimed" ? "mine" : "unknown") as Fact)
  );

  for (let round = 0; round < MAX_PROPAGATION_ROUNDS; round += 1) {
    let changed = false;

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let column = 0; column < BOARD_COLUMNS; column += 1) {
        const result = applyClueFacts(match, facts, row, column);
        if (result === "contradiction") {
          return null;
        }
        changed ||= result === "changed";
      }
    }

    if (!changed) {
      return facts;
    }
  }

  return null;
};

const globalProbability = (match: MatchStateDto, facts: Fact[][]): number | null => {
  let knownMines = 0;
  let unknownCells = 0;
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let column = 0; column < BOARD_COLUMNS; column += 1) {
      if (facts[row]![column] === "mine") {
        knownMines += 1;
      } else if (facts[row]![column] === "unknown" && isHidden(match.board.cells[row]![column]!)) {
        unknownCells += 1;
      }
    }
  }
  const remaining = match.board.mineCount - knownMines;
  if (remaining < 0 || remaining > unknownCells) {
    return null;
  }
  return unknownCells === 0 ? 0 : Math.max(0, Math.min(1, remaining / unknownCells));
};

const estimateMineProbability = (
  context: InferenceContext,
  row: number,
  column: number
): number => {
  const { facts, fallback, match } = context;
  const fact = facts[row]![column]!;
  if (fact === "mine") {
    return 1;
  }
  if (fact === "safe") {
    return 0;
  }

  let estimateTotal = 0;
  let estimateCount = 0;
  forEachNeighbor(row, column, (neighborRow, neighborColumn) => {
    const clue = match.board.cells[neighborRow]![neighborColumn]!;
    if (clue.status !== "revealed") {
      return;
    }

    const summary = summarizeClue(match, facts, neighborRow, neighborColumn);
    if (summary.unknownNeighbors.length > 0) {
      estimateTotal += (clue.adjacentMines! - summary.knownMines) / summary.unknownNeighbors.length;
      estimateCount += 1;
    }
  });

  return estimateCount === 0 ? fallback : Math.max(0, Math.min(1, estimateTotal / estimateCount));
};

const getBombBounds = (position: number): { min: number; max: number } => {
  const span = BOMB_RADIUS * 2 + 1;
  const start = Math.min(Math.max(0, position - BOMB_RADIUS), BOARD_ROWS - span);
  return { min: start, max: start + span - 1 };
};

const estimateBombYield = (
  probabilities: number[][],
  match: MatchStateDto,
  row: number,
  column: number
): number => {
  const rowBounds = getBombBounds(row);
  const columnBounds = getBombBounds(column);
  let yieldEstimate = 0;
  for (let targetRow = rowBounds.min; targetRow <= rowBounds.max; targetRow += 1) {
    for (let targetColumn = columnBounds.min; targetColumn <= columnBounds.max; targetColumn += 1) {
      if (isHidden(match.board.cells[targetRow]![targetColumn]!)) {
        yieldEstimate += probabilities[targetRow]![targetColumn]!;
      }
    }
  }
  return yieldEstimate;
};

const chooseBomb = (probabilities: number[][], match: MatchStateDto): SoloAction | null => {
  let best: SoloAction | null = null;
  let bestYield = -1;
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let column = 0; column < BOARD_COLUMNS; column += 1) {
      if (!isHidden(match.board.cells[row]![column]!)) {
        continue;
      }
      const yieldEstimate = estimateBombYield(probabilities, match, row, column);
      if (yieldEstimate > bestYield) {
        best = { type: "bomb", row, column };
        bestYield = yieldEstimate;
      }
    }
  }
  return best;
};

export const chooseSoloAction = (
  publicMatch: MatchStateDto,
  botPlayerId: string
): SoloAction | null => {
  if (!isSupportedMatch(publicMatch, botPlayerId)) {
    return null;
  }

  const facts = inferFacts(publicMatch);
  if (!facts) {
    return null;
  }
  const fallback = globalProbability(publicMatch, facts);
  if (fallback === null) {
    return null;
  }
  const context = { match: publicMatch, facts, fallback };
  const probabilities = publicMatch.board.cells.map((row, rowIndex) =>
    row.map((_, columnIndex) => estimateMineProbability(context, rowIndex, columnIndex))
  );
  let bestSelect: SoloAction | null = null;
  let bestProbability = -1;
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let column = 0; column < BOARD_COLUMNS; column += 1) {
      if (
        isHidden(publicMatch.board.cells[row]![column]!) &&
        probabilities[row]![column]! > bestProbability
      ) {
        bestSelect = { type: "select", row, column };
        bestProbability = probabilities[row]![column]!;
      }
    }
  }
  if (!bestSelect) {
    return null;
  }
  if (bestProbability === 1) {
    return bestSelect;
  }

  const bot = publicMatch.players.find((player) => player.playerId === botPlayerId);
  const opponent = publicMatch.players.find((player) => player.playerId !== botPlayerId);
  if (
    bot &&
    opponent &&
    bot.bombsRemaining === 1 &&
    opponent.score - bot.score >= MIN_BOMB_DEFICIT
  ) {
    return chooseBomb(probabilities, publicMatch);
  }
  return bestSelect;
};
