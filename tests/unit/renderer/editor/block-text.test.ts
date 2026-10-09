// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { textBlocks, textOfBlock } from '../../../../src/renderer/editor/block-text';
import { requestFromText, SELECT_ONE_PARAGRAPH, SELECT_SHORTER } from '../../../../src/renderer/editor/suggestion-requests';
import { richBlockTexts } from '../../../../src/shared/nlp/source-text';
import { makeEditor, tick } from './support';

const R = Date.parse('2026-10-08T07:00:00Z');
const CONTEXT = { asOf: R, defaultZone: 'Asia/Dhaka' };
const NOTE = { noteId: '0f8fad5b-d9cb-469f-a165-70867728950e', noteTitle: 'Plans', format: 'rich' as const };

describe('block text: the renderer reads blocks exactly as main does (R6-06)', () => {
  it('marks, hard breaks, headings, quotes and nested list paragraphs give the same text as the stored JSON', async () => {
    const { editor } = makeEditor({
      content:
        '<h2>Plan for <em>Friday</em></h2><p>Pay <strong>rent</strong><br>tomorrow at 5pm</p><blockquote><p>quoted Oct 20</p></blockquote>' +
        '<ul><li><p>call Bob <code>tomorrow</code></p><ul><li><p>nested next Monday</p></li></ul></li></ul><pre><code>code 9am</code></pre>',
    });
    await tick();
    const blocks = textBlocks(editor.state.doc, 'rich');
    expect(blocks.map((b) => b.node.type.name)).toEqual(['heading', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'codeBlock', 'paragraph']);
    const stored = richBlockTexts(editor.getJSON(), new Set(blocks.map((b) => b.blockId!)));
    for (const b of blocks) expect(textOfBlock(b.node, b.pos + 1).text).toBe(stored.get(b.blockId!));
    expect(stored.get(blocks[1]!.blockId!)).toBe('Pay rent\ntomorrow at 5pm');
  });

  it('offsets and document positions convert both ways, around a hard break too', () => {
    const { editor } = makeEditor({ content: '<p>Pay <strong>rent</strong><br>tomorrow</p>' });
    const [block] = textBlocks(editor.state.doc, 'rich');
    const text = textOfBlock(block!.node, block!.pos + 1);
    const start = text.text.indexOf('tomorrow');
    expect(editor.state.doc.textBetween(text.posAt(start), text.posAt(start + 8))).toBe('tomorrow');
    for (let offset = 0; offset <= text.text.length; offset += 1) expect(text.offsetAt(text.posAt(offset))).toBe(offset);
  });
});

describe('More → Create reminder from text (plan section 9.5)', () => {
  it('a selection within one paragraph is read on its own; offsets are block-relative and the title is the rest', async () => {
    const { editor } = makeEditor({ content: '<p>Lunch with Sam on Oct 20 at 1pm</p><p>Second</p>' });
    await tick();
    editor.commands.setTextSelection({ from: 1, to: 32 });
    const result = requestFromText(editor.state, NOTE, CONTEXT);
    if (!result.ok) throw new Error('expected a request');
    const { request } = result;
    expect(request).toMatchObject({ origin: 'selection', blockText: 'Lunch with Sam on Oct 20 at 1pm', manualTitle: 'Lunch with Sam on Oct 20 at 1pm' });
    expect(request.candidates.map((c) => ({ start: c.start, end: c.end, text: c.text, title: c.title, spanOrdinal: c.spanOrdinal }))).toEqual([
      { start: 18, end: 31, text: 'Oct 20 at 1pm', title: 'Lunch with Sam', spanOrdinal: 0 },
    ]);
    expect(request.blockId).toBe(textBlocks(editor.state.doc, 'rich')[0]!.blockId);
  });

  it('a part of a paragraph keeps the block offsets; across paragraphs or over 2,000 characters it is refused', () => {
    const { editor } = makeEditor({ content: `<p>Rent tomorrow, gym Friday</p><p>${'word '.repeat(450)}</p>` });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 16, 26)));
    const part = requestFromText(editor.state, NOTE, CONTEXT);
    expect(part.ok && part.request.manualTitle).toBe('gym Friday');
    expect(part.ok && part.request.candidates.map((c) => [c.start, c.end, c.text, c.title])).toEqual([[19, 25, 'Friday', 'gym']]);
    editor.commands.setTextSelection({ from: 3, to: 40 });
    expect(requestFromText(editor.state, NOTE, CONTEXT)).toEqual({ ok: false, notice: SELECT_ONE_PARAGRAPH });
    editor.commands.setTextSelection({ from: 30, to: 30 + 2001 });
    expect(requestFromText(editor.state, NOTE, CONTEXT)).toEqual({ ok: false, notice: SELECT_SHORTER });
  });

  it('without a selection the paragraph at the cursor is read; text without a date opens manual entry', () => {
    const { editor } = makeEditor({ content: "<p>Let's do it sometime</p>" });
    editor.commands.setTextSelection(5);
    const result = requestFromText(editor.state, NOTE, CONTEXT);
    expect(result.ok && result.request).toMatchObject({ candidates: [], manualTitle: "Let's do it sometime" });
  });

  it('plain notes: phrases per line, ordinals over the whole text, no block', () => {
    const { editor } = makeEditor({ format: 'plain', content: '<p>Pay rent tomorrow</p><p>Call mum tomorrow</p>' });
    editor.commands.setTextSelection(25);
    const result = requestFromText(editor.state, { ...NOTE, format: 'plain' }, CONTEXT);
    if (!result.ok) throw new Error('expected a request');
    expect(result.request).toMatchObject({ blockId: null, manualBlockId: null, blockText: 'Call mum tomorrow' });
    expect(result.request.candidates.map((c) => [c.start, c.end, c.spanOrdinal])).toEqual([[9, 17, 1]]);
  });
});
