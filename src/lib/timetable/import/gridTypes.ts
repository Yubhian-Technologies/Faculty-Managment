// The shape both format-specific extractors (parseWordTable, parseExcelGrid)
// reduce their source file to, so parseGrid's orientation-detection/matching
// logic never needs to know whether a cell came from a .docx or .xlsx file.

/** One physical cell, positioned at its top-left corner in a virtual grid. */
export interface GridCell {
  row: number;
  col: number;
  /** How many virtual rows this cell covers (>1 for a merged/rowspan cell). */
  rowSpan: number;
  /** How many virtual columns this cell covers (>1 for a merged/colspan cell). */
  colSpan: number;
  text: string;
}

export interface ParsedGrid {
  rowCount: number;
  colCount: number;
  /** One entry per physical cell - covered-but-not-anchor positions have no entry. */
  cells: GridCell[];
}

/** rowCount x colCount lookup where every covered position points at its owning cell. */
export function buildMatrix(grid: ParsedGrid): (GridCell | undefined)[][] {
  const matrix: (GridCell | undefined)[][] = Array.from({ length: grid.rowCount }, () => []);
  for (const cell of grid.cells) {
    for (let r = cell.row; r < cell.row + cell.rowSpan && r < grid.rowCount; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan && c < grid.colCount; c++) {
        matrix[r][c] = cell;
      }
    }
  }
  return matrix;
}
