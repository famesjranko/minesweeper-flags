import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

export interface CellPosition {
  row: number;
  column: number;
}

// A target off the board matches no cell, so focus stays where it is at the edge.
const getKeyboardTarget = (
  key: string,
  from: CellPosition,
  columns: number
): CellPosition | null => {
  switch (key) {
    case "ArrowUp":
      return { ...from, row: from.row - 1 };
    case "ArrowDown":
      return { ...from, row: from.row + 1 };
    case "ArrowLeft":
      return { ...from, column: from.column - 1 };
    case "ArrowRight":
      return { ...from, column: from.column + 1 };
    case "Home":
      return { ...from, column: 0 };
    case "End":
      return { ...from, column: columns - 1 };
    default:
      return null;
  }
};

export interface AimedCell extends CellPosition {
  pointerType: string;
}

interface BoardInputOptions {
  columns: number;
  bombArmed: boolean;
  onSelectCell: (row: number, column: number) => void;
  onAimCell: ((cell: AimedCell) => void) | undefined;
}

/** How a keyboard, a mouse and a touch each move around the board and choose a square. */
export const useBoardInput = ({
  columns,
  bombArmed,
  onSelectCell,
  onAimCell
}: BoardInputOptions) => {
  // The board is one tab stop; arrow keys move within it and Tab leaves it.
  const [tabStop, setTabStop] = useState<CellPosition>({ row: 0, column: 0 });
  // The bomb can be used once, so a click or tap only aims and one stray press cannot spend it.
  // A keyboard press has no pointer, and its focus has already shown the preview.
  const lastPointerType = useRef<string | null>(null);

  const selectCell = (row: number, column: number) => {
    const pointerType = lastPointerType.current;
    lastPointerType.current = null;
    if (bombArmed && pointerType && onAimCell) onAimCell({ row, column, pointerType });
    else onSelectCell(row, column);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A key press after a tap is keyboard input, so it must not inherit the tap's aiming step.
    lastPointerType.current = null;
    // Browser shortcuts such as Alt+Left must keep working.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = getKeyboardTarget(event.key, tabStop, columns);
    if (!target) return;
    event.preventDefault();
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-cell="${target.row}-${target.column}"]`)
      ?.focus();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = event.pointerType;
  };

  return { tabStop, setTabStop, selectCell, onKeyDown, onPointerDown };
};
