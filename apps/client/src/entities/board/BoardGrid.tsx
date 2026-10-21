import type { MatchStateDto } from "@minesweeper-flags/shared";
import { useState } from "react";
import { FlagIcon } from "../../shared-ui/FlagIcon.js";
import { type BombPreviewBounds, getBombPreviewBounds } from "./bomb-preview.js";
import { type LastMoveMarks, NO_LAST_MOVE_MARKS } from "./last-move.js";

interface BoardGridProps {
  match: MatchStateDto;
  canAct: boolean;
  bombArmed: boolean;
  playerTones: Record<string, "blue" | "red">;
  lastMove?: LastMoveMarks;
  onSelectCell: (row: number, column: number) => void;
}

const renderCellContent = (
  status: string,
  adjacentMines: number | null,
  claimedByPlayerId: string | null,
  playerTones: Record<string, "blue" | "red">
) => {
  if (status === "claimed") {
    const tone = claimedByPlayerId ? (playerTones[claimedByPlayerId] ?? "blue") : "blue";
    return <FlagIcon color={tone} size={20} />;
  }

  if (status === "mine-revealed") {
    return <span className="mine-burst">✹</span>;
  }

  if (status === "revealed") {
    return adjacentMines && adjacentMines > 0 ? (
      <span className={`cell-number number-${adjacentMines}`}>{adjacentMines}</span>
    ) : (
      ""
    );
  }

  return "";
};

type BoardCellState = MatchStateDto["board"]["cells"][number][number];
type LastMoveCellMark = LastMoveMarks["cells"][number];

// Places an overlay over a block of cells; 8px is the grid padding and 2px the cell gap.
const getOverlayStyle = (bounds: BombPreviewBounds) => {
  const rowSpan = bounds.maxRow - bounds.minRow + 1;
  const columnSpan = bounds.maxColumn - bounds.minColumn + 1;

  return {
    left: `calc(8px + ${bounds.minColumn} * (var(--board-cell-size) + 2px))`,
    top: `calc(8px + ${bounds.minRow} * (var(--board-cell-size) + 2px))`,
    width: `calc(${columnSpan} * var(--board-cell-size) + ${columnSpan - 1} * 2px)`,
    height: `calc(${rowSpan} * var(--board-cell-size) + ${rowSpan - 1} * 2px)`
  };
};

interface BoardCellProps {
  cell: BoardCellState;
  canAct: boolean;
  bombArmed: boolean;
  playerTones: Record<string, "blue" | "red">;
  lastMoveCell: LastMoveCellMark | undefined;
  isPreviewed: boolean;
  isHovered: boolean;
  onSelectCell: (row: number, column: number) => void;
  onHoverCell: (cell: { row: number; column: number } | null) => void;
}

const BoardCell = ({
  cell,
  canAct,
  bombArmed,
  playerTones,
  lastMoveCell,
  isPreviewed,
  isHovered,
  onSelectCell,
  onHoverCell
}: BoardCellProps) => {
  const isBombTarget = bombArmed && canAct && cell.status === "hidden";

  return (
    <button
      type="button"
      className={[
        "board-cell",
        `status-${cell.status}`,
        cell.claimedByPlayerId ? "claimed-cell" : "",
        cell.claimedByPlayerId ? `claimed-${playerTones[cell.claimedByPlayerId] ?? "blue"}` : "",
        isBombTarget ? "bomb-targetable" : "",
        isPreviewed ? "bomb-preview-cell" : "",
        isPreviewed && isHovered ? "bomb-preview-center" : "",
        lastMoveCell
          ? `is-last-move last-move-${lastMoveCell.tone} last-move-age-${lastMoveCell.age}`
          : ""
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={!canAct || cell.status !== "hidden"}
      onClick={() => onSelectCell(cell.row, cell.column)}
      onMouseEnter={() => {
        if (isBombTarget) {
          onHoverCell({ row: cell.row, column: cell.column });
        }
      }}
      onFocus={() => {
        if (isBombTarget) {
          onHoverCell({ row: cell.row, column: cell.column });
        }
      }}
      onBlur={() => {
        if (isHovered) {
          onHoverCell(null);
        }
      }}
      title={`Row ${cell.row + 1}, Column ${cell.column + 1}`}
    >
      {renderCellContent(cell.status, cell.adjacentMines, cell.claimedByPlayerId, playerTones)}
    </button>
  );
};

const isWithinBounds = (cell: BoardCellState, bounds: BombPreviewBounds): boolean =>
  cell.row >= bounds.minRow &&
  cell.row <= bounds.maxRow &&
  cell.column >= bounds.minColumn &&
  cell.column <= bounds.maxColumn;

export const BoardGrid = ({
  match,
  canAct,
  bombArmed,
  playerTones,
  lastMove = NO_LAST_MOVE_MARKS,
  onSelectCell
}: BoardGridProps) => {
  const [hoveredCell, setHoveredCell] = useState<{ row: number; column: number } | null>(null);
  const shouldShowBombPreview = bombArmed && canAct && hoveredCell !== null;
  const previewBounds = hoveredCell
    ? getBombPreviewBounds(
        match.board.rows,
        match.board.columns,
        hoveredCell.row,
        hoveredCell.column
      )
    : null;

  const gridStyle = {
    "--board-columns": match.board.columns,
    gridTemplateColumns: `repeat(${match.board.columns}, minmax(0, 1fr))`
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse leave only clears the hover preview; the cells are buttons.
    <div
      className={["board-grid", shouldShowBombPreview ? "is-bomb-preview-active" : ""]
        .filter(Boolean)
        .join(" ")}
      style={gridStyle}
      onMouseLeave={() => setHoveredCell(null)}
    >
      {shouldShowBombPreview && previewBounds ? (
        <div className="board-bomb-preview" style={getOverlayStyle(previewBounds)} />
      ) : null}

      {lastMove.areas.map((area) => (
        <div
          key={`last-move-area-${area.bounds.minRow}-${area.bounds.minColumn}-${area.age}`}
          className={`board-last-move-area last-move-${area.tone} last-move-age-${area.age}`}
          style={getOverlayStyle(area.bounds)}
        />
      ))}

      {match.board.cells.flat().map((cell) => (
        <BoardCell
          key={`${cell.row}-${cell.column}`}
          cell={cell}
          canAct={canAct}
          bombArmed={bombArmed}
          playerTones={playerTones}
          lastMoveCell={lastMove.cells.find(
            (mark) => mark.row === cell.row && mark.column === cell.column
          )}
          isPreviewed={
            shouldShowBombPreview && previewBounds !== null && isWithinBounds(cell, previewBounds)
          }
          isHovered={hoveredCell?.row === cell.row && hoveredCell?.column === cell.column}
          onSelectCell={onSelectCell}
          onHoverCell={setHoveredCell}
        />
      ))}
    </div>
  );
};
