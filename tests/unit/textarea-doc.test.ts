import { describe, expect, it } from 'vitest';
import { docToText, textToDoc } from '../../src/shared/text/textarea-doc';

describe('textarea-doc', () => {
  it('round-trips text including empty lines, a trailing newline and Bangla', () => {
    for (const t of ['', 'one', 'a\nb', 'a\n\nb', 'a\n', '\n', '\n\nx', 'বাংলা\nক', '  indented  ']) {
      expect(docToText(textToDoc(t)), JSON.stringify(t)).toBe(t);
    }
  });

  it('maps lines to paragraphs and empty lines to empty paragraphs', () => {
    expect(textToDoc('a\n\nb')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    });
  });

  it('gives every paragraph a block id when an id generator is passed', () => {
    let n = 0;
    const id = () => `00000000-0000-4000-8000-00000000000${++n}`;
    expect(textToDoc('a\n\nb', { id })).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: '00000000-0000-4000-8000-000000000001' }, content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', attrs: { id: '00000000-0000-4000-8000-000000000002' } },
        { type: 'paragraph', attrs: { id: '00000000-0000-4000-8000-000000000003' }, content: [{ type: 'text', text: 'b' }] },
      ],
    });
  });

  it('normalizes CRLF', () => {
    expect(docToText(textToDoc('a\r\nb'))).toBe('a\nb');
  });

  it('treats hardBreak as a newline inside a paragraph', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] };
    expect(docToText(doc)).toBe('a\nb');
  });
});
