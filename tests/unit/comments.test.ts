import { describe, expect, it } from 'vitest';
import { anchorFits, CommentAnchor, describeAnchor } from '../../src/shared/comments/anchors';
import { CommentCreateRequest, COMMENT_MESSAGES, MAX_COMMENT_CHARS } from '../../src/shared/contracts/comments';
import { collectCommentAnchors, MAX_COMMENT_MARKS, normalizeRichDoc } from '../../src/shared/editor/doc-schema';
import { noteSchema } from '../../src/shared/editor/schema';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const B1 = '33333333-3333-4333-8333-333333333333';
const B2 = '44444444-4444-4444-8444-444444444444';

const text = (t: string, ...threads: string[]) => ({ type: 'text', text: t, ...(threads.length ? { marks: threads.map((threadId) => ({ type: 'comment', attrs: { threadId } })) } : {}) });
const para = (id: string, ...content: unknown[]) => ({ type: 'paragraph', attrs: { id }, content });
const marksOf = (node: unknown): string[] =>
  ((node as { marks?: Array<{ type: string; attrs?: { threadId?: string } }> }).marks ?? []).filter((m) => m.type === 'comment').map((m) => m.attrs!.threadId!);

describe('comment anchors (D-165)', () => {
  it('each kind of item takes its own anchor', () => {
    expect(anchorFits({ type: 'text', blockId: null }, { kind: 'note' })).toBe(true);
    expect(anchorFits({ type: 'pdf', page: 2, rect: null }, { kind: 'document', documentKind: 'pdf' })).toBe(true);
    expect(anchorFits({ type: 'cell', sheet: 'S', row: 0, col: 0 }, { kind: 'document', documentKind: 'csv' })).toBe(true);
    expect(anchorFits({ type: 'slide', slide: 1, shapeId: null }, { kind: 'document', documentKind: 'pptx' })).toBe(true);
    expect(anchorFits({ type: 'paragraph', paragraph: 0 }, { kind: 'document', documentKind: 'docx' })).toBe(true);
    expect(anchorFits({ type: 'quote', occurrence: 0 }, { kind: 'document', documentKind: 'html' })).toBe(true);
    expect(anchorFits({ type: 'cell', sheet: 'S', row: 0, col: 0 }, { kind: 'note' })).toBe(false);
    expect(anchorFits({ type: 'text', blockId: null }, { kind: 'document', documentKind: 'pdf' })).toBe(false);
  });

  it('validates bounds: pages from 1, areas on the page, cells within the sheet, known fields only', () => {
    expect(CommentAnchor.safeParse({ type: 'pdf', page: 0, rect: null }).success).toBe(false);
    expect(CommentAnchor.safeParse({ type: 'pdf', page: 1, rect: { x: 0.5, y: 0.5, width: 0.6, height: 0.1 } }).success).toBe(false);
    expect(CommentAnchor.safeParse({ type: 'pdf', page: 1, rect: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } }).success).toBe(true);
    expect(CommentAnchor.safeParse({ type: 'cell', sheet: 'S', row: -1, col: 0 }).success).toBe(false);
    expect(CommentAnchor.safeParse({ type: 'cell', sheet: 'x'.repeat(32), row: 0, col: 0 }).success).toBe(false);
    expect(CommentAnchor.safeParse({ type: 'text', blockId: 'not-a-uuid' }).success).toBe(false);
    expect(CommentAnchor.safeParse({ type: 'text', blockId: null, extra: 1 }).success).toBe(false);
  });

  it('names document places as the sidebar shows them', () => {
    expect(describeAnchor({ type: 'pdf', page: 3, rect: null })).toBe('Page 3');
    expect(describeAnchor({ type: 'cell', sheet: 'Budget', row: 1, col: 1 })).toBe('Budget!B2');
    expect(describeAnchor({ type: 'slide', slide: 4, shapeId: null })).toBe('Slide 4');
    expect(describeAnchor({ type: 'paragraph', paragraph: 0 })).toBe('Paragraph 1');
    expect(describeAnchor({ type: 'text', blockId: null })).toBe('');
  });

  it('a comment body is trimmed, never empty and bounded', () => {
    const base = { target: { kind: 'note', id: T1 }, anchor: { type: 'text', blockId: null }, quote: 'q' };
    expect(CommentCreateRequest.parse({ ...base, body: '  hi  ' }).body).toBe('hi');
    const empty = CommentCreateRequest.safeParse({ ...base, body: '   ' });
    expect(empty.success ? null : empty.error.issues[0]!.message).toBe(COMMENT_MESSAGES.empty);
    expect(CommentCreateRequest.safeParse({ ...base, body: 'x'.repeat(MAX_COMMENT_CHARS + 1) }).success).toBe(false);
  });
});

describe('the comment mark in the shared schema (D-165)', () => {
  it('is part of the rich schema main applies live-sync steps with', () => {
    expect(noteSchema('rich').marks.comment).toBeDefined();
    expect(noteSchema('rich').marks.comment!.spec.inclusive).toBe(false);
    expect(noteSchema('plain').marks.comment).toBeUndefined();
  });

  it('keeps comment marks with a thread ID, one per thread; drops invalid ones; several threads may share text', () => {
    const doc = normalizeRichDoc({
      type: 'doc',
      content: [
        para(B1, {
          type: 'text',
          text: 'abc',
          marks: [
            { type: 'comment', attrs: { threadId: T1 } },
            { type: 'comment', attrs: { threadId: T1 } },
            { type: 'comment', attrs: { threadId: T2 } },
            { type: 'comment', attrs: { threadId: 'bad' } },
            { type: 'comment' },
            { type: 'bold' },
          ],
        }),
      ],
    });
    const node = (doc.content![0] as { content: unknown[] }).content[0];
    expect(marksOf(node)).toEqual([T1, T2]);
    expect((node as { marks: Array<{ type: string }> }).marks.some((m) => m.type === 'bold')).toBe(true);
  });

  it('bounds the threads on one piece of text', () => {
    const ids = Array.from({ length: MAX_COMMENT_MARKS + 3 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
    const doc = normalizeRichDoc({ type: 'doc', content: [para(B1, text('abc', ...ids))] });
    expect(marksOf((doc.content![0] as { content: unknown[] }).content[0])).toHaveLength(MAX_COMMENT_MARKS);
  });

  it('never aliases a thread: after its first run of text, later copies lose the mark (pasted or duplicated content)', () => {
    const doc = normalizeRichDoc({
      type: 'doc',
      content: [para(B1, text('one ', T1), text('two', T1, T2)), para(B2, text('three', T1), text(' plain'), text(' copy', T1, T2))],
    });
    const [p1, p2] = doc.content as Array<{ content: unknown[] }>;
    // The run spans the paragraph boundary; the copy after unmarked text loses T1, and T2 (closed by "three") too.
    expect(marksOf(p1!.content[0])).toEqual([T1]);
    expect(marksOf(p1!.content[1])).toEqual([T1, T2]);
    expect(marksOf(p2!.content[0])).toEqual([T1]);
    expect(marksOf(p2!.content[2])).toEqual([]);
    expect(normalizeRichDoc(doc)).toEqual(doc);
  });

  it('collects each thread’s text and first block', () => {
    const doc = { type: 'doc', content: [para(B1, text('The '), text('budget', T1)), para(B2, text('is due', T1), text(' later', T2))] };
    expect(collectCommentAnchors(doc, 500)).toEqual(
      new Map([
        [T1, { quote: 'budget is due', blockId: B1 }],
        [T2, { quote: ' later', blockId: B2 }],
      ]),
    );
    expect(collectCommentAnchors(doc, 4).get(T1)!.quote).toBe('budg');
  });
});
