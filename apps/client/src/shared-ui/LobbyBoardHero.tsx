import "./lobby-board-hero.css";

import { FlagIcon } from "./FlagIcon.js";
import {
  getLobbyPreviewBoard,
  type LobbyPreviewCell,
  type LobbyPreviewSize
} from "./lobby-preview-board.js";

const playerTone: Record<string, "blue" | "red"> = { blue: "blue", red: "red" };

const PreviewCell = ({ cell }: { cell: LobbyPreviewCell }) => {
  const tone = cell.claimedByPlayerId ? playerTone[cell.claimedByPlayerId] : undefined;
  const className = [
    "lobby-board-hero-cell",
    cell.claimedByPlayerId ? `is-flag-${tone}` : "",
    cell.isRevealed ? "is-revealed" : "",
    cell.isRevealed && cell.adjacentMines > 0 ? `is-number-${cell.adjacentMines}` : "",
    !cell.isRevealed && !cell.claimedByPlayerId ? "is-hidden" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={className}>
      {tone ? (
        <FlagIcon color={tone} size={18} />
      ) : cell.isRevealed && cell.adjacentMines > 0 ? (
        cell.adjacentMines
      ) : null}
    </span>
  );
};

/** Phones show a separate 8×8 board beside the heading; larger viewports show a 16×16 board. */
export const LobbyBoardHero = ({ size = "full" }: { size?: LobbyPreviewSize }) => {
  const preview = getLobbyPreviewBoard(size);

  return (
    <aside
      className={`lobby-board-hero lobby-board-hero--${size === "compact" ? "thumb" : "full"}`}
      aria-label="Sample game board"
      data-preview-seed={preview.seed}
      data-preview-size={size}
    >
      <div className="lobby-board-hero-grid">
        {preview.cells.flat().map((cell) => (
          <PreviewCell key={`${cell.row}-${cell.column}`} cell={cell} />
        ))}
      </div>
    </aside>
  );
};
