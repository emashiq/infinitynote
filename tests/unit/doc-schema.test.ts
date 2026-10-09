import { describe, expect, it } from 'vitest';
import { collectAttachmentRefs, collectBlockIds, collectNoteRefs, DocSchemaError, MAX_DOC_DEPTH, normalizeRichDoc } from '../../src/shared/editor/doc-schema';

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ATT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const text = (t: string, marks?: unknown[]) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...content: unknown[]) => ({ type: 'paragraph', attrs: { id: ID1 }, content });

function rejects(doc: unknown, message: RegExp): void {
  expect(() => normalizeRichDoc(doc)).toThrow(DocSchemaError);
  expect(() => normalizeRichDoc(doc)).toThrow(message);
}

/** A distinct block ID per call: a document never repeats one (INF-REF-07). */
let seq = 0;
const nextId = () => `33333333-3333-4333-8333-${(seq += 1).toString(16).padStart(12, '0')}`;

describe('normalizeRichDoc (D-053)', () => {
  it('keeps every supported node, mark and attribute', () => {
    const p = (...content: unknown[]) => ({ type: 'paragraph', attrs: { id: nextId() }, content });
    const ref = { type: 'noteRef', attrs: { noteId: ATT, blockId: ID2, label: 'Design', excerpt: 'Goals' } };
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { id: nextId(), level: 2 }, content: [text('Plan')] },
        p(text('b', [{ type: 'bold' }, { type: 'italic' }, { type: 'strike' }, { type: 'underline' }]), text('c', [{ type: 'code' }])),
        p(text('link', [{ type: 'link', attrs: { href: 'https://example.com/docs' } }]), { type: 'hardBreak' }, ref),
        { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: nextId() }, content: [p(text('one'))] }] },
        { type: 'orderedList', attrs: { start: 3, type: null }, content: [{ type: 'listItem', attrs: { id: nextId() }, content: [p(text('two'))] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { id: nextId(), checked: true }, content: [p(text('done'))] }] },
        { type: 'codeBlock', attrs: { id: nextId(), language: 'ts' }, content: [text('let a = 1;')] },
        { type: 'blockquote', attrs: { id: nextId() }, content: [p(text('quote'))] },
        { type: 'horizontalRule' },
        { type: 'image', attrs: { id: nextId(), attachmentId: ATT, alt: 'chart', size: 'full', width: 800, height: 200 } },
        { type: 'fileAttachment', attrs: { id: nextId(), attachmentId: ATT, name: 'report.pdf', sizeBytes: 1234, mime: 'application/pdf' } },
      ],
    };
    expect(normalizeRichDoc(doc)).toEqual(doc);
  });

  it('drops unknown attributes, editor-only attributes and invalid ids', () => {
    const out = normalizeRichDoc({
      type: 'doc',
      attrs: { foo: 1 },
      content: [
        { type: 'paragraph', attrs: { id: 'not-a-uuid', textAlign: 'left' }, content: [text('x', [{ type: 'link', attrs: { href: 'https://a.example/', target: '_blank', rel: 'noopener', class: 'c', title: 't' } }])] },
        { type: 'image', attrs: { id: null, attachmentId: ATT, src: 'http://evil.example/x.png', uploadToken: 'tok', title: 'x', size: 'huge', width: 0, height: 'big', alt: 'a'.repeat(501) } },
        { type: 'codeBlock', attrs: { id: ID1, language: 'x'.repeat(33) } },
        { type: 'orderedList', attrs: { start: -1, type: 'toolongtype' }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    });
    expect(out).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('x', [{ type: 'link', attrs: { href: 'https://a.example/' } }])] },
        { type: 'image', attrs: { attachmentId: ATT, alt: null, size: 'medium', width: null, height: null } },
        { type: 'codeBlock', attrs: { id: ID1, language: null } },
        { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    });
  });

  it('drops links with a disallowed address and keeps their text', () => {
    for (const href of ['javascript:alert(1)', 'vbscript:x', 'data:text/html,x', 'file:///etc/passwd', '/relative', 42]) {
      const out = normalizeRichDoc({ type: 'doc', content: [para(text('click', [{ type: 'link', attrs: { href } }, { type: 'bold' }]))] });
      expect(out.content).toEqual([{ type: 'paragraph', attrs: { id: ID1 }, content: [text('click', [{ type: 'bold' }])] }]);
    }
  });

  it('drops empty text nodes and duplicate marks', () => {
    const out = normalizeRichDoc({ type: 'doc', content: [para(text(''), text('a', [{ type: 'bold' }, { type: 'bold' }]))] });
    expect(out.content).toEqual([{ type: 'paragraph', attrs: { id: ID1 }, content: [text('a', [{ type: 'bold' }])] }]);
  });

  it('accepts an empty document and keeps Unicode text byte-identical', () => {
    expect(normalizeRichDoc({ type: 'doc' })).toEqual({ type: 'doc' });
    expect(normalizeRichDoc({ type: 'doc', content: [] })).toEqual({ type: 'doc' });
    const unicode = 'আমার সোনার বাংলা é 😀';
    expect(normalizeRichDoc({ type: 'doc', content: [para(text(unicode))] }).content).toEqual([para(text(unicode))]);
  });

  it('is idempotent', () => {
    const messy = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: 'x', extra: true }, content: [text('a', [{ type: 'link', attrs: { href: 'https://b.example', rel: 'x' } }]), text('')] }],
    };
    const once = normalizeRichDoc(messy);
    expect(normalizeRichDoc(once)).toEqual(once);
  });

  it('rejects unknown node and mark types, misplaced nodes and missing required attributes', () => {
    rejects({ type: 'doc', content: [{ type: 'iframe' }] }, /Unknown node type: iframe/);
    rejects({ type: 'doc', content: [{ type: 'script', content: [text('x')] }] }, /Unknown node type/);
    rejects({ type: 'doc', content: [para(text('x', [{ type: 'highlight' }]))] }, /Unknown mark type: highlight/);
    rejects({ type: 'doc', content: [{ content: [] }] }, /Node without a type/);
    rejects({ type: 'doc', content: [text('loose text')] }, /not allowed here/);
    rejects({ type: 'doc', content: [para({ type: 'paragraph' })] }, /not allowed here/);
    rejects({ type: 'doc', content: [{ type: 'doc' }] }, /not allowed here/);
    rejects({ type: 'doc', content: [{ type: 'bulletList', content: [para(text('x'))] }] }, /not allowed here/);
    rejects({ type: 'doc', content: [{ type: 'heading', attrs: { level: 4 }, content: [text('H')] }] }, /Heading level/);
    rejects({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://x.example/a.png' } }] }, /Image without an attachment/);
    rejects({ type: 'doc', content: [{ type: 'fileAttachment', attrs: { attachmentId: ATT, name: '', sizeBytes: 1, mime: 'x' } }] }, /File name/);
    rejects({ type: 'doc', content: [{ type: 'horizontalRule', content: [para()] }] }, /leaf node/);
    rejects({ type: 'doc', content: [para({ type: 'text', text: 5 })] }, /Text node without text/);
    rejects({ type: 'paragraph' }, /Not a document/);
    rejects(null, /Not a document/);
    rejects({ type: 'doc', content: 'x' }, /Content must be a list/);
  });

  it('rejects documents nested deeper than 64 levels or with more than 100,000 nodes', () => {
    let node: unknown = { type: 'paragraph' };
    for (let i = 0; i < MAX_DOC_DEPTH; i += 1) node = { type: 'blockquote', content: [node] };
    rejects({ type: 'doc', content: [node] }, /nested too deeply/);
    const many = Array.from({ length: 50_001 }, () => ({ type: 'paragraph', content: [text('x')] }));
    rejects({ type: 'doc', content: many }, /too many parts/);
  });
});

describe('collectAttachmentRefs', () => {
  it('lists image and file references with their block ids in document order', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { id: ID1, attachmentId: ATT } },
        { type: 'blockquote', content: [{ type: 'fileAttachment', attrs: { id: 'bad', attachmentId: ID2, name: 'a' } }] },
        { type: 'image', attrs: { attachmentId: 'not-a-uuid' } },
      ],
    };
    expect(collectAttachmentRefs(doc)).toEqual([
      { attachmentId: ATT, blockId: ID1 },
      { attachmentId: ID2, blockId: null },
    ]);
    expect(collectAttachmentRefs(null)).toEqual([]);
  });
});

describe('note references in documents (INF-REF-02, INF-REF-07, D-098)', () => {
  const ref = (attrs: Record<string, unknown>) => ({ type: 'noteRef', attrs });

  it('keeps reference IDs, cuts long labels and refuses a reference without a note', () => {
    const out = normalizeRichDoc({
      type: 'doc',
      content: [para(ref({ noteId: ATT, blockId: 'not-a-uuid', label: 'x'.repeat(201), excerpt: 'e'.repeat(81), extra: 1 }))],
    });
    expect(out.content).toEqual([{ type: 'paragraph', attrs: { id: ID1 }, content: [{ type: 'noteRef', attrs: { noteId: ATT, blockId: null, label: '', excerpt: null } }] }]);
    rejects({ type: 'doc', content: [para(ref({ noteId: 'nope' }))] }, /Reference without a note/);
    rejects({ type: 'doc', content: [ref({ noteId: ATT })] }, /not allowed here/);
    rejects({ type: 'doc', content: [{ type: 'codeBlock', content: [ref({ noteId: ATT })] }] }, /not allowed here/);
  });

  it('a repeated block ID keeps only its first occurrence, so a copy never aliases the original block', () => {
    const out = normalizeRichDoc({
      type: 'doc',
      content: [para(text('original')), para(text('pasted copy')), { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: ID1 }, content: [{ type: 'paragraph', attrs: { id: ID2 }, content: [text('x')] }] }] }],
    });
    const ids = (out.content as Array<{ attrs?: { id?: string }; content?: unknown[] }>).map((n) => n.attrs?.id ?? null);
    expect(ids).toEqual([ID1, null, null]);
    expect(normalizeRichDoc(out)).toEqual(out);
  });

  it('collectNoteRefs lists references in order with the ID of the block that holds them', () => {
    const doc = {
      type: 'doc',
      content: [
        para(text('a'), ref({ noteId: ATT, blockId: null, label: 'A' })),
        { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: ID2 }, content: [{ type: 'paragraph', content: [ref({ noteId: ATT, blockId: ID1, label: 'B' })] }] }] },
        { type: 'paragraph', content: [ref({ noteId: 'bad' })] },
      ],
    };
    expect(collectNoteRefs(doc)).toEqual([
      { sourceBlockId: ID1, targetNoteId: ATT, targetBlockId: null, label: 'A' },
      { sourceBlockId: ID2, targetNoteId: ATT, targetBlockId: ID1, label: 'B' },
    ]);
  });
});

describe('tables and text styles in documents (v0.2.0)', () => {
  const cell = (type: 'tableCell' | 'tableHeader', attrs: Record<string, unknown>, ...content: unknown[]) => ({ type, attrs, content: content.length ? content : [{ type: 'paragraph' }] });
  const table = (...rows: unknown[][]) => ({ type: 'table', attrs: { id: ID2 }, content: rows.map((cells) => ({ type: 'tableRow', content: cells })) });

  it('keeps a table with header cells, spans, widths and alignment; a cell holds blocks', () => {
    const doc = {
      type: 'doc',
      content: [
        table(
          [cell('tableHeader', { colspan: 2, rowspan: 1, colwidth: [100, 140], align: 'center' }, para(text('Head')))],
          [
            cell('tableCell', { colspan: 1, rowspan: 1, colwidth: null, align: null }, { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: nextId() }, content: [{ type: 'paragraph', attrs: { id: nextId() }, content: [text('x')] }] }] }),
            cell('tableCell', { colspan: 1, rowspan: 1, colwidth: null, align: 'right' }),
          ],
        ),
      ],
    };
    expect(normalizeRichDoc(doc)).toEqual(doc);
  });

  it('cell attributes out of range fall back to their defaults', () => {
    const doc = { type: 'doc', content: [table([cell('tableCell', { colspan: 0, rowspan: 'x', colwidth: [100, 200], align: 'justify', style: 'color:red' })])] };
    const out = normalizeRichDoc(doc) as { content: Array<{ content: Array<{ content: Array<{ attrs: unknown }> }> }> };
    expect(out.content[0]!.content[0]!.content[0]!.attrs).toEqual({ colspan: 1, rowspan: 1, colwidth: null, align: null });
    const widths = normalizeRichDoc({ type: 'doc', content: [table([cell('tableCell', { colspan: 1, colwidth: [0] })])] });
    expect(JSON.stringify(widths)).toContain('"colwidth":null');
  });

  it('refuses a cell spanning over 50 columns or rows and a table over 10,000 grid cells (D-116)', () => {
    rejects({ type: 'doc', content: [table([cell('tableCell', { colspan: 51 })])] }, /spans too many columns or rows/);
    rejects({ type: 'doc', content: [table([cell('tableCell', { rowspan: 51 })])] }, /spans too many columns or rows/);
    expect(() => normalizeRichDoc({ type: 'doc', content: [table([cell('tableCell', { colspan: 50, rowspan: 50 })])] })).not.toThrow();
    const row = (n: number) => Array.from({ length: n }, () => cell('tableCell', {}));
    expect(() => normalizeRichDoc({ type: 'doc', content: [table(...Array.from({ length: 100 }, () => row(100)))] })).not.toThrow();
    rejects({ type: 'doc', content: [table(...Array.from({ length: 101 }, () => row(100)))] }, /table has too many cells/);
    // A table inside a cell is measured too.
    const nested = table(...Array.from({ length: 101 }, () => row(100)));
    rejects({ type: 'doc', content: [table([cell('tableCell', {}, nested)])] }, /table has too many cells/);
  });

  it("refuses the acceptor's ~2,200-node table (100 cells spanning 1,000 columns, then 1,000 one-cell rows) quickly", () => {
    const doc = {
      type: 'doc',
      content: [table(Array.from({ length: 100 }, () => cell('tableCell', { colspan: 1000 })), ...Array.from({ length: 1000 }, () => [cell('tableCell', {})]))],
    };
    const started = performance.now();
    rejects(doc, /spans too many columns or rows/);
    // With spans of 50 it still describes a 5,000 x 1,001 grid.
    const capped = JSON.parse(JSON.stringify(doc).replaceAll('"colspan":1000', '"colspan":50')) as unknown;
    rejects(capped, /table has too many cells/);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('refuses table parts outside a table and rows outside their place', () => {
    rejects({ type: 'doc', content: [{ type: 'tableRow', content: [] }] }, /tableRow node is not allowed here/);
    rejects({ type: 'doc', content: [{ type: 'table', content: [para(text('x'))] }] }, /paragraph node is not allowed here/);
    rejects({ type: 'doc', content: [para({ type: 'tableCell', content: [] })] }, /tableCell node is not allowed here/);
  });

  it('the table carries a block ID like other blocks; the paragraphs in its cells keep theirs', () => {
    const doc = { type: 'doc', content: [table([cell('tableCell', {}, { type: 'paragraph', attrs: { id: ID1 }, content: [text('in cell')] })])] };
    expect([...collectBlockIds(normalizeRichDoc(doc))].sort()).toEqual([ID1, ID2].sort());
  });

  it('a text style keeps valid colors, listed fonts and sizes; it is dropped when nothing valid is left', () => {
    const styled = (attrs: Record<string, unknown>) => ({ type: 'doc', content: [para(text('x', [{ type: 'textStyle', attrs }]))] });
    expect(normalizeRichDoc(styled({ color: '#E03131', backgroundColor: '#fff3a3', fontFamily: 'times', fontSize: '24px' }))).toEqual(
      styled({ color: '#e03131', backgroundColor: '#fff3a3', fontFamily: 'times', fontSize: '24px' }),
    );
    expect(normalizeRichDoc(styled({ color: 'red; background: url(x)', backgroundColor: null, fontFamily: 'Papyrus', fontSize: '15px' }))).toEqual({
      type: 'doc',
      content: [para(text('x'))],
    });
    expect(JSON.stringify(normalizeRichDoc(styled({ color: 'expression(alert(1))', fontSize: '18px' })))).not.toContain('expression');
  });
});
