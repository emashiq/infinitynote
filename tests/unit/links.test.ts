import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { columnLetters, describeTarget, targetFromInput } from '../../src/shared/documents/targets';
import { collectDocRefs, collectNoteRefs, DocSchemaError, MAX_REF_LABEL, normalizeRichDoc } from '../../src/shared/editor/doc-schema';
import { textBlocksOf } from '../../src/shared/editor/text-blocks';
import { fuzzyScore, rankByTitle } from '../../src/shared/search/fuzzy';
import { extractPlainText } from '../../src/shared/text/plain-text';

const DOC = randomUUID();
const NOTE = randomUUID();
const P = randomUUID();

const para = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: P }, content }] });

describe('link picker ranking (D-157)', () => {
  it('ranks the whole title, a prefix, a word start, a substring and a subsequence in that order', () => {
    const titles = ['Team meeting', 'Meeting', 'Meetings archive', 'Premeeting checklist', 'Monthly targets', 'Unrelated'];
    expect(rankByTitle('meeting', titles, (t) => t, () => 0)).toEqual(['Meeting', 'Meetings archive', 'Team meeting', 'Premeeting checklist']);
    // Subsequences only: fewer gaps first, then the shorter title.
    expect(rankByTitle('mtg', titles, (t) => t, () => 0)).toEqual(['Meeting', 'Team meeting', 'Monthly targets', 'Meetings archive', 'Premeeting checklist']);
  });

  it('ignores case and accents, and keeps the most recent first on a tie', () => {
    expect(fuzzyScore('cafe', 'Café notes')).not.toBeNull();
    expect(fuzzyScore('CAFÉ', 'cafe notes')).toBe(fuzzyScore('cafe', 'Cafe notes'));
    const items = [
      { t: 'Plan', at: 1 },
      { t: 'Plan', at: 3 },
      { t: 'Plan', at: 2 },
    ];
    expect(rankByTitle('plan', items, (i) => i.t, (i) => i.at).map((i) => i.at)).toEqual([3, 2, 1]);
  });

  it('an empty query matches everything (most recent first); a missing character matches nothing', () => {
    expect(rankByTitle('', ['a', 'b'], (t) => t, (t) => (t === 'b' ? 2 : 1))).toEqual(['b', 'a']);
    expect(fuzzyScore('xyz', 'Meeting')).toBeNull();
  });
});

describe('document targets typed in the picker (D-156)', () => {
  it('reads a page, a slide, a heading and a sheet with or without a cell', () => {
    expect(targetFromInput('pdf', ' 12 ')).toEqual({ page: 12 });
    expect(targetFromInput('pptx', '3')).toEqual({ slide: 3 });
    expect(targetFromInput('docx', 'Scope')).toEqual({ heading: 'Scope' });
    expect(targetFromInput('xlsx', 'Budget')).toEqual({ sheet: 'Budget' });
    expect(targetFromInput('xlsx', 'Budget!B2')).toEqual({ sheet: 'Budget', col: 1, row: 1 });
    expect(targetFromInput('xlsx', "'Q1 plan'!AA10")).toEqual({ sheet: 'Q1 plan', col: 26, row: 9 });
  });

  it('names nothing for text a kind cannot use, out-of-range numbers and kinds without places', () => {
    expect(targetFromInput('pdf', 'two')).toBeNull();
    expect(targetFromInput('pdf', '0')).toBeNull();
    expect(targetFromInput('pptx', '99999')).toBeNull();
    expect(targetFromInput('csv', 'A1')).toBeNull();
    expect(targetFromInput('html', 'top')).toBeNull();
    expect(targetFromInput('docx', '   ')).toBeNull();
  });

  it('describes places the way links show them', () => {
    expect(describeTarget({ page: 4 })).toBe('Page 4');
    expect(describeTarget({ slide: 2 })).toBe('Slide 2');
    expect(describeTarget({ sheet: 'Budget', row: 1, col: 1 })).toBe('Budget!B2');
    expect(describeTarget({ sheet: 'Budget' })).toBe('Budget');
    expect(describeTarget({ paragraph: 0 })).toBe('Paragraph 1');
    expect(describeTarget({ heading: 'Scope' })).toBe('Scope');
    expect([0, 25, 26, 701, 702].map(columnLetters)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
  });
});

describe('docRef nodes and link aliases in the shared schema (D-156)', () => {
  it('keeps a document link with a valid place and drops an invalid place', () => {
    const doc = normalizeRichDoc(
      para(
        { type: 'docRef', attrs: { documentId: DOC, target: { page: 2 }, label: 'Report', alias: null, extra: 1 } },
        { type: 'docRef', attrs: { documentId: DOC, target: { page: -1 }, label: 'Report' } },
      ),
    );
    const inline = (doc.content![0] as { content: Array<{ attrs: unknown }> }).content;
    expect(inline.map((n) => n.attrs)).toEqual([
      { documentId: DOC, target: { page: 2 }, label: 'Report', alias: null },
      { documentId: DOC, target: null, label: 'Report', alias: null },
    ]);
    expect(() => normalizeRichDoc(para({ type: 'docRef', attrs: { documentId: 'nope' } }))).toThrow(DocSchemaError);
  });

  it('keeps an alias within the label limit on both link kinds, and reads links as what they show', () => {
    const long = 'x'.repeat(MAX_REF_LABEL + 50);
    const doc = normalizeRichDoc(
      para(
        { type: 'text', text: 'See ' },
        { type: 'noteRef', attrs: { noteId: NOTE, blockId: null, label: 'Design', excerpt: null, alias: 'the design' } },
        { type: 'text', text: ' and ' },
        { type: 'docRef', attrs: { documentId: DOC, target: null, label: 'Deck', alias: '  ' } },
        { type: 'docRef', attrs: { documentId: DOC, target: null, label: 'Deck', alias: long } },
      ),
    );
    const attrs = (doc.content![0] as { content: Array<{ attrs?: { alias?: unknown } }> }).content.map((n) => n.attrs?.alias);
    expect(attrs).toEqual([undefined, 'the design', undefined, null, 'x'.repeat(MAX_REF_LABEL)]);
    expect(extractPlainText('rich', doc)).toBe(`See the design and Deck${'x'.repeat(MAX_REF_LABEL)}`);
    expect(textBlocksOf(doc)[0]!.text).toBe(`See the design and Deck${'x'.repeat(MAX_REF_LABEL)}`);
  });

  it('collects document links with the block that holds them, apart from note links', () => {
    const doc = para({ type: 'docRef', attrs: { documentId: DOC, target: { slide: 1 }, label: 'Deck' } }, { type: 'noteRef', attrs: { noteId: NOTE, label: 'N' } });
    expect(collectDocRefs(doc)).toEqual([{ sourceBlockId: P, targetDocumentId: DOC, target: { slide: 1 }, label: 'Deck' }]);
    expect(collectNoteRefs(doc).map((r) => r.targetNoteId)).toEqual([NOTE]);
  });
});
