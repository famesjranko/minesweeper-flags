import { useState } from "react";
import type { MatchStateDto } from "@minesweeper-flags/shared";
import { FlagIcon } from "../../shared-ui/FlagIcon.js";
import { getBombPreviewBounds } from "./bomb-preview.js";

interface BoardGridProps {
  match: MatchStateDto;
  canAct: boolean;
  bombArmed: boolean;
  playerTones: Record<string, "blue" | "red">;
  onSelectCell: (row: number, column: number) => void;
}

const renderCellContent = (
  status: string,
  adjacentMines: number | null,
  claimedByPlayerId: string | null,
  playerTones: Record<string, "blue" | "red">
) => {
  if (status === "claimed") {
    const tone = claimedByPlayerId ? playerTones[claimedByPlayerId] ?? "blue" : "blue";
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

export const BoardGrid = ({
  match,
  canAct,
  bombArmed,
  playerTones,
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
  const previewRowSpan =
    previewBounds ? previewBounds.maxRow - previewBounds.minRow + 1 : 0;
  const previewColumnSpan =
    previewBounds ? previewBounds.maxColumn - previewBounds.minColumn + 1 : 0;

  return (
    <div
      className={["board-grid", shouldShowBombPreview ? "is-bomb-preview-active" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{
        gridTemplateColumns: `repeat(${match.board.columns}, minmax(0, 1fr))`
      }}
      onMouseLeave={() => setHoveredCell(null)}
    >
      {shouldShowBombPreview && previewBounds ? (
        <div
          className="board-bomb-preview"
          style={{
            left: `calc(8px + ${previewBounds.minColumn} * (var(--board-cell-size) + 2px))`,
            top: `calc(8px + ${previewBounds.minRow} * (var(--board-cell-size) + 2px))`,
            width: `calc(${previewColumnSpan} * var(--board-cell-size) + ${previewColumnSpan - 1} * 2px)`,
            height: `calc(${previewRowSpan} * var(--board-cell-size) + ${previewRowSpan - 1} * 2px)`
          }}
        />
      ) : null}

      {match.board.cells.flat().map((cell) => {
        const isPreviewed =
          shouldShowBombPreview &&
          previewBounds &&
          cell.row >= previewBounds.minRow &&
          cell.row <= previewBounds.maxRow &&
          cell.column >= previewBounds.minColumn &&
          cell.column <= previewBounds.maxColumn;

        return (
          <button
            key={`${cell.row}-${cell.column}`}
            className={[
              "board-cell",
              `status-${cell.status}`,
              cell.claimedByPlayerId ? "claimed-cell" : "",
              cell.claimedByPlayerId ? `claimed-${playerTones[cell.claimedByPlayerId] ?? "blue"}` : "",
              bombArmed && canAct && cell.status === "hidden" ? "bomb-targetable" : "",
              isPreviewed ? "bomb-preview-cell" : "",
              isPreviewed && hoveredCell?.row === cell.row && hoveredCell?.column === cell.column
                ? "bomb-preview-center"
                : ""
            ]
              .filter(Boolean)
              .join(" ")}
            disabled={!canAct || cell.status !== "hidden"}
            onClick={() => onSelectCell(cell.row, cell.column)}
            onMouseEnter={() => {
              if (bombArmed && canAct && cell.status === "hidden") {
                setHoveredCell({ row: cell.row, column: cell.column });
              }
            }}
            onFocus={() => {
              if (bombArmed && canAct && cell.status === "hidden") {
                setHoveredCell({ row: cell.row, column: cell.column });
              }
            }}
            onBlur={() => {
              if (hoveredCell?.row === cell.row && hoveredCell?.column === cell.column) {
                setHoveredCell(null);
              }
            }}
            title={`Row ${cell.row + 1}, Column ${cell.column + 1}`}
          >
            {renderCellContent(
              cell.status,
              cell.adjacentMines,
              cell.claimedByPlayerId,
              playerTones
            )}
          </button>
        );
      })}
    </div>
  );
};
