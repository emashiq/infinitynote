import { describe, expect, it } from 'vitest';
import { extractPlainText } from '../../src/shared/text/plain-text';

const text = (t: string) => ({ type: 'text', text: t });
const p = (...c: unknown[]) => ({ type: 'paragraph', content: c });

describe('extractPlainText', () => {
  it('plain: CRLF becomes LF and the rest is unchanged', () => {
    expect(extractPlainText('plain', 'a\r\nb\r\n')).toBe('a\nb\n');
    expect(extractPlainText('plain', '  keep  ')).toBe('  keep  ');
  });

  it('rich: paragraphs, headings and hard breaks', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
        p(text('line one'), { type: 'hardBreak' }, text('line two')),
        p(text('last')),
      ],
    };
    expect(extractPlainText('rich', doc)).toBe('Title\nline one\nline two\nlast');
  });

  it('rich: nested lists and task lists', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [p(text('one')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(text('one-a'))] }] }] },
            { type: 'listItem', content: [p(text('two'))] },
          ],
        },
        { type: 'taskList', content: [{ type: 'taskItem', content: [p(text('todo'))] }] },
      ],
    };
    expect(extractPlainText('rich', doc)).toBe('one\none-a\ntwo\ntodo');
  });

  it('preserves Bangla text and recurses through unknown nodes', () => {
    const doc = { type: 'doc', content: [{ type: 'custom', content: [p(text('বাংলা লেখা'))] }] };
    expect(extractPlainText('rich', doc)).toBe('বাংলা লেখা');
  });

  it('truncates at depth 200 without throwing', () => {
    let node: unknown = text('deep');
    for (let i = 0; i < 300; i += 1) node = { type: 'wrapper', content: [node] };
    expect(() => extractPlainText('rich', { type: 'doc', content: [node] })).not.toThrow();
    expect(extractPlainText('rich', { type: 'doc', content: [node] })).toBe('');
  });

  it('rich: file chips give their name as a line, images no text, rules a block break', () => {
    const doc = {
      type: 'doc',
      content: [
        p(text('before')),
        { type: 'image', attrs: { attachmentId: 'a', alt: 'ignored alt' } },
        p(text('between')),
        { type: 'fileAttachment', attrs: { attachmentId: 'b', name: 'report final.pdf', sizeBytes: 1, mime: 'application/pdf' } },
        { type: 'horizontalRule' },
        p(text('after')),
      ],
    };
    expect(extractPlainText('rich', doc)).toBe('before\nbetween\nreport final.pdf\nafter');
  });

  it('rich: empty paragraphs are empty lines, so plain text round-trips through paragraphs', () => {
    const empty = { type: 'paragraph' };
    expect(extractPlainText('rich', { type: 'doc', content: [p(text('one')), empty, p(text('two'))] })).toBe('one\n\ntwo');
    expect(extractPlainText('rich', { type: 'doc', content: [empty, p(text('x'))] })).toBe('\nx');
    expect(extractPlainText('rich', { type: 'doc', content: [p(text('x')), empty, empty] })).toBe('x');
    expect(extractPlainText('rich', { type: 'doc', content: [empty] })).toBe('');
  });

  it('empty doc gives an empty string', () => {
    expect(extractPlainText('rich', { type: 'doc' })).toBe('');
    expect(extractPlainText('rich', { type: 'doc', content: [] })).toBe('');
    expect(extractPlainText('rich', null)).toBe('');
  });
});

describe('extractPlainText: tables (v0.2.0)', () => {
  const cell = (...c: unknown[]) => ({ type: 'tableCell', content: c });
  const row = (...cells: unknown[]) => ({ type: 'tableRow', content: cells });

  it('a table is one line per row with tab-separated cells; a cell with several blocks stays on one line', () => {
    const doc = {
      type: 'doc',
      content: [
        p(text('Before')),
        { type: 'table', content: [row(cell(p(text('Name'))), cell(p(text('Note')))), row(cell(p(text('Ada'))), cell(p(text('two')), p(text('lines'))))] },
        p(text('After')),
      ],
    };
    expect(extractPlainText('rich', doc)).toBe('Before\nName\tNote\nAda\ttwo lines\nAfter');
  });

  it('empty cells keep their place', () => {
    const doc = { type: 'doc', content: [{ type: 'table', content: [row(cell(p()), cell(p(text('b'))))] }] };
    expect(extractPlainText('rich', doc)).toBe('\tb');
  });
});
