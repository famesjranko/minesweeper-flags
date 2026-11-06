import "./board-size-select.css";

import { BOARD_SIZES, type BoardSize, OFFERED_BOARD_SIZES } from "@minesweeper-flags/game-engine";

interface BoardSizeSelectProps {
  value: BoardSize;
  onChange: (boardSize: BoardSize) => void;
}

// Sits beside the button it applies to, so choosing a size adds no height to the page.
export const BoardSizeSelect = ({ value, onChange }: BoardSizeSelectProps) => (
  <select
    className="board-size-select"
    aria-label="Board size"
    value={value}
    onChange={(event) => onChange(event.target.value as BoardSize)}
  >
    {OFFERED_BOARD_SIZES.map((size) => (
      <option key={size} value={size}>
        {BOARD_SIZES[size].rows}×{BOARD_SIZES[size].columns}
      </option>
    ))}
  </select>
);
