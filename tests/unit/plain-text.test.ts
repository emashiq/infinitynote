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

  it('empty doc gives an empty string', () => {
    expect(extractPlainText('rich', { type: 'doc' })).toBe('');
    expect(extractPlainText('rich', { type: 'doc', content: [] })).toBe('');
    expect(extractPlainText('rich', null)).toBe('');
  });
});
