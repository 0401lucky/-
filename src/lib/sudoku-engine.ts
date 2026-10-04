export const SUDOKU_SIZE = 9;
export const SUDOKU_CELL_COUNT = SUDOKU_SIZE * SUDOKU_SIZE;

export function rowOf(index: number): number {
  return Math.floor(index / SUDOKU_SIZE);
}

export function colOf(index: number): number {
  return index % SUDOKU_SIZE;
}

export function boxOf(index: number): number {
  return Math.floor(rowOf(index) / 3) * 3 + Math.floor(colOf(index) / 3);
}

export function isSameUnit(left: number, right: number): boolean {
  return rowOf(left) === rowOf(right)
    || colOf(left) === colOf(right)
    || boxOf(left) === boxOf(right);
}

export function formatSudokuDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
