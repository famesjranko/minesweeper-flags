import type { MatchStateDto } from "@minesweeper-flags/shared";
import { FlagIcon } from "../../shared-ui/FlagIcon.js";

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
}: BoardGridProps) => (
  <div
    className="board-grid"
    style={{
      gridTemplateColumns: `repeat(${match.board.columns}, minmax(0, 1fr))`
    }}
  >
    {match.board.cells.flat().map((cell) => (
      <button
        key={`${cell.row}-${cell.column}`}
        className={[
          "board-cell",
          `status-${cell.status}`,
          cell.claimedByPlayerId ? "claimed-cell" : "",
          cell.claimedByPlayerId ? `claimed-${playerTones[cell.claimedByPlayerId] ?? "blue"}` : "",
          bombArmed && canAct && cell.status === "hidden" ? "bomb-armed" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={!canAct || cell.status !== "hidden"}
        onClick={() => onSelectCell(cell.row, cell.column)}
        title={`Row ${cell.row + 1}, Column ${cell.column + 1}`}
      >
        {renderCellContent(
          cell.status,
          cell.adjacentMines,
          cell.claimedByPlayerId,
          playerTones
        )}
      </button>
    ))}
  </div>
);
