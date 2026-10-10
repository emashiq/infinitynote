import { describe, expect, it } from 'vitest';
import { dropTarget, NO_SELECTION, pagesToChange, selectionAfterMove, selectPage, stepTarget } from '../../../src/renderer/documents/pdf/page-selection';
import { extractTitle, orderAfterMove } from '../../../src/renderer/documents/pdf/pdf-pages';
import { PDF_MESSAGES, pdfLoadError } from '../../../src/renderer/documents/pdf/pdf-messages';
import { findSummary } from '../../../src/renderer/documents/pdf/PdfFindBar';
import { toOutlineItems } from '../../../src/renderer/documents/pdf/PdfOutline';
import { parseZoomChoice, ZOOM_CHOICES, zoomChoice } from '../../../src/renderer/documents/pdf/PdfToolbar';

describe('PDF page selection (D-131)', () => {
  it('click selects one page, Ctrl+click toggles, Shift+click selects a range from the last clicked page', () => {
    let s = selectPage(NO_SELECTION, 2, 'single');
    expect(s).toEqual({ selected: [2], anchor: 2 });
    s = selectPage(s, 5, 'range');
    expect(s.selected).toEqual([2, 3, 4, 5]);
    s = selectPage(s, 0, 'range');
    expect(s.selected).toEqual([0, 1, 2]);
    s = selectPage(s, 1, 'toggle');
    expect(s).toEqual({ selected: [0, 2], anchor: 1 });
    expect(selectPage(s, 4, 'toggle').selected).toEqual([0, 2, 4]);
    expect(selectPage(NO_SELECTION, 3, 'range')).toEqual({ selected: [3], anchor: 3 });
  });

  it('operations change the selected pages, or the page in view when none is selected', () => {
    expect(pagesToChange(NO_SELECTION, 4)).toEqual([4]);
    expect(pagesToChange({ selected: [1, 3], anchor: 1 }, 4)).toEqual([1, 3]);
  });

  it('moves one step up or down, closes up a scattered selection, and stops at the ends', () => {
    expect(stepTarget(4, [2], -1)).toBe(1);
    expect(orderAfterMove(4, [2], 1)).toEqual([0, 2, 1, 3]);
    expect(stepTarget(4, [2], 1)).toBe(3);
    expect(stepTarget(4, [0], -1)).toBeNull();
    expect(stepTarget(4, [3], 1)).toBeNull();
    expect(stepTarget(4, [0, 2], -1)).toBe(0);
    expect(orderAfterMove(4, [0, 2], 0)).toEqual([0, 2, 1, 3]);
  });

  it('a drop before a page gives its place among the pages not moving; the selection follows the moved pages', () => {
    expect(dropTarget(4, [0], 3)).toBe(2);
    expect(orderAfterMove(4, [0], dropTarget(4, [0], 3))).toEqual([1, 2, 0, 3]);
    expect(dropTarget(4, [3], 0)).toBe(0);
    expect(dropTarget(4, [1], 4)).toBe(3);
    const order = orderAfterMove(4, [1, 2], 0);
    expect(order).toEqual([1, 2, 0, 3]);
    expect(selectionAfterMove(order, [1, 2])).toEqual({ selected: [0, 1], anchor: 0 });
  });
});

describe('PDF viewer text', () => {
  it('names damaged, unreadable and other failures without technical detail', () => {
    expect(pdfLoadError(Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' }))).toBe(PDF_MESSAGES.damaged);
    expect(pdfLoadError(Object.assign(new Error('x'), { name: 'ResponseException' }))).toBe(PDF_MESSAGES.unreadable);
    expect(pdfLoadError(new Error('boom'))).toBe(PDF_MESSAGES.failed);
    expect(pdfLoadError(null)).toBe(PDF_MESSAGES.failed);
  });

  it('summarizes find results', () => {
    const find = { query: 'plan', status: 'found' as const, current: 2, total: 5, wrapped: false };
    expect(findSummary(find)).toBe('2 of 5');
    expect(findSummary({ ...find, wrapped: true })).toBe('2 of 5 (continued from the other end)');
    expect(findSummary({ ...find, status: 'notFound', total: 0, current: 0 })).toBe('No matches');
    expect(findSummary({ ...find, status: 'pending', total: 0 })).toBe('Searching…');
    expect(findSummary({ ...find, status: 'idle' })).toBe('');
  });

  it('zoom choices round-trip and other factors show as themselves', () => {
    for (const choice of ZOOM_CHOICES) expect(zoomChoice(parseZoomChoice(choice.value))).toBe(choice.value);
    expect(zoomChoice(1.3333333)).toBe('1.33');
    expect(parseZoomChoice('page-fit')).toBe('page-fit');
  });

  it('extracted pages are titled after their document, shortened to the title limit', () => {
    expect(extractTitle('Report', [0, 1, 2, 4])).toBe('Report (pages 1-3, 5)');
    const long = extractTitle('x'.repeat(200), [6]);
    expect([...long]).toHaveLength(200);
    expect(long.endsWith(' (page 7)')).toBe(true);
  });

  it('outline items keep their nesting, name untitled ones and keep web addresses apart', () => {
    const node = (title: string, extra: Record<string, unknown> = {}) => ({ title, bold: false, italic: false, color: new Uint8ClampedArray(3), dest: null, url: null, items: [], ...extra });
    const items = toOutlineItems([node('Intro', { dest: [{ num: 3, gen: 0 }, { name: 'XYZ' }], items: [node('  ', { dest: 'named' })] }), node('Site', { url: 'https://example.com' })] as never);
    expect(items).toEqual([
      { title: 'Intro', dest: [{ num: 3, gen: 0 }, { name: 'XYZ' }], url: null, items: [{ title: 'Untitled', dest: 'named', url: null, items: [] }] },
      { title: 'Site', dest: null, url: 'https://example.com', items: [] },
    ]);
    expect(toOutlineItems(null)).toEqual([]);
  });
});
