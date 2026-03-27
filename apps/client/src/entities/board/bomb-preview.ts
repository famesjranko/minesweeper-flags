export interface BombPreviewBounds {
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
}

const BOMB_RADIUS = 2;

const getAxisBounds = (
  axisLength: number,
  position: number,
  radius = BOMB_RADIUS
): { min: number; max: number } => {
  const span = Math.min(axisLength, (radius * 2) + 1);
  const maxStart = Math.max(0, axisLength - span);
  const start = Math.min(Math.max(0, position - radius), maxStart);

  return {
    min: start,
    max: start + span - 1
  };
};

export const getBombPreviewBounds = (
  rows: number,
  columns: number,
  row: number,
  column: number,
  radius = BOMB_RADIUS
): BombPreviewBounds => {
  const rowBounds = getAxisBounds(rows, row, radius);
  const columnBounds = getAxisBounds(columns, column, radius);

  return {
    minRow: rowBounds.min,
    maxRow: rowBounds.max,
    minColumn: columnBounds.min,
    maxColumn: columnBounds.max
  };
};
