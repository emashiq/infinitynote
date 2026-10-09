import { describe, expect, it } from 'vitest';
import { richToMarkdown } from '../../src/main/portability/markdown';

const NO_ASSETS = { linkOf: () => null, linkedFileUrl: () => null };
const text = (t: string, marks?: unknown[]) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const cell = (type: 'tableCell' | 'tableHeader', attrs: Record<string, unknown>, ...content: unknown[]) => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null, ...attrs }, content });
const row = (...cells: unknown[]) => ({ type: 'tableRow', content: cells });

describe('Markdown export of tables and text styles (INF-PORT-05, v0.2.0)', () => {
  it('a table becomes a GFM table with its header row, alignment, inline marks and escaped pipes', () => {
    const doc = {
      content: [
        {
          type: 'table',
          content: [
            row(cell('tableHeader', {}, p(text('Item'))), cell('tableHeader', { align: 'right' }, p(text('Price'))), cell('tableHeader', { align: 'center' }, p(text('Note')))),
            row(cell('tableCell', {}, p(text('Tea', [{ type: 'bold' }]))), cell('tableCell', {}, p(text('2'))), cell('tableCell', {}, p(text('a | b')), p(text('second')))),
            row(cell('tableCell', { colspan: 2 }, p(text('spans two'))), cell('tableCell', {}, p())),
          ],
        },
      ],
    };
    expect(richToMarkdown('', doc, NO_ASSETS)).toBe(
      ['| Item | Price | Note |', '| --- | ---: | :---: |', '| **Tea** | 2 | a \\| b<br>second |', '| spans two |  |  |', ''].join('\n'),
    );
  });

  it('a table without a header row uses its first row as the header Markdown requires; nested blocks become text', () => {
    const doc = {
      content: [
        {
          type: 'table',
          content: [
            row(cell('tableCell', {}, p(text('a'))), cell('tableCell', {}, { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('x'))] }, { type: 'listItem', content: [p(text('y'))] }] })),
            row(cell('tableCell', {}, p(text('c'))), cell('tableCell', {}, p(text('d')))),
          ],
        },
      ],
    };
    expect(richToMarkdown('', doc, NO_ASSETS)).toBe(['| a | x<br>y |', '| --- | --- |', '| c | d |', ''].join('\n'));
  });

  it('fonts, sizes, text colors and highlights are dropped; the text and its emphasis stay', () => {
    const styled = { type: 'textStyle', attrs: { color: '#e03131', backgroundColor: '#fff3a3', fontFamily: 'mono', fontSize: '24px' } };
    expect(richToMarkdown('', { content: [p(text('red', [styled, { type: 'italic' }]), text(' plain'))] }, NO_ASSETS)).toBe('*red* plain\n');
  });
});
