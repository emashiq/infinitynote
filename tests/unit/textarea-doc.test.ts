import { describe, expect, it } from 'vitest';
import { docToText, isTextareaCompatible, textToDoc } from '../../src/shared/text/textarea-doc';

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

  it('normalizes CRLF', () => {
    expect(docToText(textToDoc('a\r\nb'))).toBe('a\nb');
  });

  it('treats hardBreak as a newline inside a paragraph', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] };
    expect(docToText(doc)).toBe('a\nb');
    expect(isTextareaCompatible(doc)).toBe(true);
  });

  it('isTextareaCompatible is false for headings, marks, lists and non-documents', () => {
    expect(isTextareaCompatible({ type: 'doc' })).toBe(true);
    expect(isTextareaCompatible(textToDoc('x'))).toBe(true);
    expect(isTextareaCompatible({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H' }] }] })).toBe(false);
    expect(
      isTextareaCompatible({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b', marks: [{ type: 'bold' }] }] }] }),
    ).toBe(false);
    expect(isTextareaCompatible({ type: 'doc', content: [{ type: 'bulletList', content: [] }] })).toBe(false);
    expect(isTextareaCompatible({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image' }] }] })).toBe(false);
    expect(isTextareaCompatible({ type: 'other' })).toBe(false);
    expect(isTextareaCompatible(null)).toBe(false);
    expect(isTextareaCompatible('text')).toBe(false);
  });
});
