import { describe, expect, it } from 'vitest';
import { gridFits, MAX_CELL_SPAN, MAX_TABLE_CELLS, tableFits } from '../../src/shared/editor/table-limits';

const plain = (rows: number, columns: number) => Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({ colspan: 1, rowspan: 1 })));

describe('table limits (D-116)', () => {
  it('accepts a grid up to 10,000 cells and refuses a larger one', () => {
    expect(MAX_TABLE_CELLS).toBe(10_000);
    expect(tableFits(plain(100, 100))).toBe(true);
    expect(tableFits(plain(101, 100))).toBe(false);
    expect(tableFits(plain(1, 10_001))).toBe(false);
    expect(tableFits(plain(10_001, 1))).toBe(false);
    expect(tableFits([])).toBe(true);
    expect(gridFits(100, 100)).toBe(true);
    expect(gridFits(5_001, 2)).toBe(false);
  });

  it('refuses a span over 50 columns or rows', () => {
    expect(MAX_CELL_SPAN).toBe(50);
    expect(tableFits([[{ colspan: 50, rowspan: 1 }]])).toBe(true);
    expect(tableFits([[{ colspan: 51, rowspan: 1 }]])).toBe(false);
    expect(tableFits([[{ colspan: 1, rowspan: 51 }]])).toBe(false);
  });

  it('counts the columns that cells spanning down from rows above take', () => {
    // Row 0: a cell 50 wide and 50 tall; each later row adds 1 cell, so the grid is 51 columns wide.
    const rows = [[{ colspan: 50, rowspan: 50 }, { colspan: 1, rowspan: 1 }], ...plain(49, 1)];
    expect(tableFits(rows)).toBe(true);
    // 200 rows of that shape: 51 columns x 200 rows = 10,200 cells.
    expect(tableFits([...rows, ...Array.from({ length: 150 }, () => [{ colspan: 50, rowspan: 1 }, { colspan: 1, rowspan: 1 }])])).toBe(false);
  });

  it("refuses the acceptor's 2,200-node table (100 cells spanning 1,000 columns over 1,000 rows) at once", () => {
    const rows = [Array.from({ length: 100 }, () => ({ colspan: 1000, rowspan: 1 })), ...plain(1000, 1)];
    const started = performance.now();
    expect(tableFits(rows)).toBe(false);
    // The same rows with spans of 50 still describe a 5,000 x 1,001 grid.
    expect(tableFits([Array.from({ length: 100 }, () => ({ colspan: 50, rowspan: 1 })), ...plain(1000, 1)])).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
