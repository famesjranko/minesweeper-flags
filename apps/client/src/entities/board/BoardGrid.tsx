import "./board-motion.css";

import type { MatchStateDto } from "@minesweeper-flags/shared";
import { type CSSProperties, useState } from "react";
import { FlagIcon } from "../../shared-ui/FlagIcon.js";
import { type BombPreviewBounds, getBombPreviewBounds } from "./bomb-preview.js";
import { type LastMoveMarks, NO_LAST_MOVE_MARKS } from "./last-move.js";
import { type AimedCell, type CellPosition, useBoardInput } from "./useBoardInput.js";
import { useTurnedOnSinceMount } from "./useTurnedOnSinceMount.js";

type PlayerTones = Record<string, "blue" | "red">;

interface BoardGridProps {
  match: MatchStateDto;
  canAct: boolean;
  /** Sets the tile colour. It differs from canAct while a move is pending, which only blocks input. */
  isOwnTurn?: boolean;
  bombArmed: boolean;
  playerTones: PlayerTones;
  lastMove?: LastMoveMarks;
  /** The square a mouse or touch player has aimed the bomb at. */
  aimedCell?: CellPosition | null;
  /** The winner's colour, while the win is being celebrated. */
  celebrateTone?: "blue" | "red" | undefined;
  onSelectCell: (row: number, column: number) => void;
  /** With this set, a click or tap on an armed board aims the bomb, and the caller confirms it. */
  onAimCell?: (cell: AimedCell) => void;
}

type BoardCellState = MatchStateDto["board"]["cells"][number][number];
type LastMoveCellMark = LastMoveMarks["cells"][number];

const claimTone = (cell: BoardCellState, playerTones: PlayerTones): "blue" | "red" =>
  (cell.claimedByPlayerId && playerTones[cell.claimedByPlayerId]) || "blue";

const renderCellContent = (cell: BoardCellState, playerTones: PlayerTones) => {
  if (cell.status === "claimed") {
    return <FlagIcon color={claimTone(cell, playerTones)} size={20} />;
  }

  if (cell.status === "mine-revealed") {
    return <span className="mine-burst">✹</span>;
  }

  if (cell.status === "revealed" && cell.adjacentMines) {
    return <span className={`cell-number number-${cell.adjacentMines}`}>{cell.adjacentMines}</span>;
  }

  return "";
};

const describeCellState = (cell: BoardCellState, playerTones: PlayerTones): string => {
  switch (cell.status) {
    case "claimed":
      return `${claimTone(cell, playerTones)} flag`;
    case "mine-revealed":
      return "mine";
    case "revealed":
      if (!cell.adjacentMines) return "no adjacent mines";
      return `${cell.adjacentMines} adjacent ${cell.adjacentMines === 1 ? "mine" : "mines"}`;
    default:
      return "hidden";
  }
};

// Places an overlay over a block of cells, using the grid's own padding and gap.
const getOverlayStyle = (bounds: BombPreviewBounds) => {
  const rowSpan = bounds.maxRow - bounds.minRow + 1;
  const columnSpan = bounds.maxColumn - bounds.minColumn + 1;

  return {
    left: `calc(var(--board-pad) + ${bounds.minColumn} * (var(--board-cell-size) + var(--board-gap)))`,
    top: `calc(var(--board-pad) + ${bounds.minRow} * (var(--board-cell-size) + var(--board-gap)))`,
    width: `calc(${columnSpan} * var(--board-cell-size) + ${columnSpan - 1} * var(--board-gap))`,
    height: `calc(${rowSpan} * var(--board-cell-size) + ${rowSpan - 1} * var(--board-gap))`
  };
};

interface BoardCellProps {
  cell: BoardCellState;
  canAct: boolean;
  bombArmed: boolean;
  playerTones: PlayerTones;
  lastMoveCell: LastMoveCellMark | undefined;
  isPreviewed: boolean;
  isPreviewCenter: boolean;
  isHovered: boolean;
  isTabStop: boolean;
  onSelectCell: (row: number, column: number) => void;
  onHoverCell: (cell: CellPosition | null) => void;
  onFocusCell: (cell: CellPosition) => void;
}

const BoardCell = ({
  cell,
  canAct,
  bombArmed,
  playerTones,
  lastMoveCell,
  isPreviewed,
  isPreviewCenter,
  isHovered,
  isTabStop,
  onSelectCell,
  onHoverCell,
  onFocusCell
}: BoardCellProps) => {
  const canSelect = canAct && cell.status === "hidden";
  const isBombTarget = bombArmed && canSelect;
  const position = { row: cell.row, column: cell.column };
  const isNew = useTurnedOnSinceMount(cell.status !== "hidden");

  return (
    // A native button would drop focus when disabled, so finished cells stay focusable and
    // readable. aria-disabled and the click guard keep them from acting.
    // biome-ignore lint/a11y/useSemanticElements: A table cannot sit in this CSS grid, and each cell must stay a button.
    <button
      type="button"
      role="gridcell"
      className={[
        "board-cell",
        `status-${cell.status}`,
        cell.claimedByPlayerId ? `claimed-cell claimed-${claimTone(cell, playerTones)}` : "",
        isBombTarget ? "bomb-targetable" : "",
        isPreviewed ? "bomb-preview-cell" : "",
        isPreviewCenter ? "bomb-preview-center" : "",
        lastMoveCell ? `is-last-move last-move-${lastMoveCell.tone}` : "",
        isNew ? "is-new" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      aria-disabled={canSelect ? undefined : true}
      aria-label={[
        `Row ${cell.row + 1}, column ${cell.column + 1}`,
        describeCellState(cell, playerTones),
        lastMoveCell ? "opponent's last move" : ""
      ]
        .filter(Boolean)
        .join(", ")}
      data-cell={`${cell.row}-${cell.column}`}
      tabIndex={isTabStop ? 0 : -1}
      style={
        cell.status === "claimed"
          ? ({ "--wave-step": cell.row + cell.column } as CSSProperties)
          : undefined
      }
      onClick={() => {
        if (canSelect) onSelectCell(cell.row, cell.column);
      }}
      onMouseEnter={() => {
        if (isBombTarget) onHoverCell(position);
      }}
      onFocus={() => {
        onFocusCell(position);
        if (isBombTarget) onHoverCell(position);
      }}
      onBlur={() => {
        if (isHovered) {
          onHoverCell(null);
        }
      }}
    >
      {renderCellContent(cell, playerTones)}
    </button>
  );
};

const isWithinBounds = (cell: BoardCellState, bounds: BombPreviewBounds): boolean =>
  cell.row >= bounds.minRow &&
  cell.row <= bounds.maxRow &&
  cell.column >= bounds.minColumn &&
  cell.column <= bounds.maxColumn;

const isSameCell = (cell: BoardCellState, position: CellPosition | null): boolean =>
  position?.row === cell.row && position?.column === cell.column;

const BoardOverlays = ({
  previewBounds,
  lastMove
}: {
  previewBounds: BombPreviewBounds | null;
  lastMove: LastMoveMarks;
}) => (
  <>
    {previewBounds ? (
      <div className="board-bomb-preview" style={getOverlayStyle(previewBounds)} />
    ) : null}

    {lastMove.areas.map((area) => (
      <div
        key={`last-move-area-${area.bounds.minRow}-${area.bounds.minColumn}`}
        className={`board-last-move-area last-move-${area.tone}`}
        style={getOverlayStyle(area.bounds)}
      />
    ))}
  </>
);

export const BoardGrid = ({
  match,
  canAct,
  isOwnTurn = canAct,
  bombArmed,
  playerTones,
  lastMove = NO_LAST_MOVE_MARKS,
  aimedCell = null,
  celebrateTone,
  onSelectCell,
  onAimCell
}: BoardGridProps) => {
  const [hoveredCell, setHoveredCell] = useState<CellPosition | null>(null);
  const input = useBoardInput({
    columns: match.board.columns,
    bombArmed,
    onSelectCell,
    onAimCell
  });
  const previewCell = bombArmed && canAct ? (aimedCell ?? hoveredCell) : null;
  const previewBounds = previewCell
    ? getBombPreviewBounds(
        match.board.rows,
        match.board.columns,
        previewCell.row,
        previewCell.column
      )
    : null;

  const gridStyle = {
    "--board-columns": match.board.columns,
    gridTemplateColumns: `repeat(${match.board.columns}, minmax(0, 1fr))`
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: A table cannot sit in this CSS grid, and each cell must stay a button.
    <div
      role="grid"
      aria-label="Minefield"
      aria-rowcount={match.board.rows}
      aria-colcount={match.board.columns}
      tabIndex={-1}
      className={[
        "board-grid",
        previewBounds ? "is-bomb-preview-active" : "",
        match.phase === "live" && !isOwnTurn ? "is-waiting" : "",
        celebrateTone ? `celebrate-${celebrateTone}` : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={gridStyle}
      onKeyDown={input.onKeyDown}
      onPointerDown={input.onPointerDown}
      onMouseLeave={() => setHoveredCell(null)}
    >
      <BoardOverlays previewBounds={previewBounds} lastMove={lastMove} />

      {match.board.cells.map((row, rowIndex) => (
        // biome-ignore lint/a11y/useFocusableInteractive: Rows only group cells for assistive technology; the cells take focus.
        // biome-ignore lint/a11y/useSemanticElements: A table cannot sit in this CSS grid, and each cell must stay a button.
        // biome-ignore lint/suspicious/noArrayIndexKey: A board row keeps its index for the whole match.
        <div key={rowIndex} role="row" className="board-row">
          {row.map((cell) => (
            <BoardCell
              key={`${cell.row}-${cell.column}`}
              cell={cell}
              canAct={canAct}
              bombArmed={bombArmed}
              playerTones={playerTones}
              lastMoveCell={lastMove.cells.find(
                (mark) => mark.row === cell.row && mark.column === cell.column
              )}
              isPreviewed={previewBounds !== null && isWithinBounds(cell, previewBounds)}
              isPreviewCenter={isSameCell(cell, previewCell)}
              isHovered={isSameCell(cell, hoveredCell)}
              isTabStop={isSameCell(cell, input.tabStop)}
              onSelectCell={input.selectCell}
              onHoverCell={setHoveredCell}
              onFocusCell={input.setTabStop}
            />
          ))}
        </div>
      ))}
    </div>
  );
};
