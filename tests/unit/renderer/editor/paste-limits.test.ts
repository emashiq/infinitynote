// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import { createDocLimits, TOO_DEEP_MESSAGE, TOO_MANY_PARTS_MESSAGE } from '../../../../src/renderer/editor/doc-limits';
import { LARGE_PASTE_CHARS, MAX_PASTE_CHARS, PASTE_TOO_LARGE } from '../../../../src/renderer/editor/paste';
import { toSavable } from '../../../../src/renderer/editor/content';
import { MAX_DOC_DEPTH, normalizeRichDoc } from '../../../../src/shared/editor/doc-schema';
import { makeEditor, pasteEvent, tick } from './support';

const nestedList = (levels: number) => '<ul><li><p>l</p>'.repeat(levels) + '</li></ul>'.repeat(levels);

function maxDepth(json: { content?: unknown[] }, level = 0): number {
  return Math.max(level, ...((json.content ?? []) as Array<{ content?: unknown[] }>).map((c) => maxDepth(c, level + 1)));
}

describe('paste size limit and flush (QA-2, D-060)', () => {
  it('a paste over 8 MB is refused before parsing, with the message, and the note is unchanged', async () => {
    const { editor, notices } = makeEditor({ content: '<p>keep</p>' });
    await tick();
    const before = editor.getJSON();
    const event = pasteEvent(editor, { html: `<p>${'x'.repeat(MAX_PASTE_CHARS)}</p>`, text: 'x'.repeat(MAX_PASTE_CHARS + 1) });
    expect(event.defaultPrevented).toBe(true);
    expect(notices).toEqual([PASTE_TOO_LARGE]);
    expect(editor.getJSON()).toEqual(before);
    const plain = makeEditor({ format: 'plain', content: '<p>keep</p>' });
    await tick();
    pasteEvent(plain.editor, { text: 'y'.repeat(MAX_PASTE_CHARS + 1) });
    expect(plain.notices).toEqual([PASTE_TOO_LARGE]);
    expect(plain.editor.getText()).toBe('keep');
  });

  it('a large paste first saves pending edits, then inserts', async () => {
    let release: () => void = () => {};
    const order: string[] = [];
    const { editor } = makeEditor({
      content: '<p>typed</p>',
      flushPending: () => {
        order.push('flush');
        return new Promise<void>((r) => (release = r));
      },
    });
    await tick();
    const html = '<p>chunk of pasted text</p>'.repeat(Math.ceil(LARGE_PASTE_CHARS / 25) + 10);
    pasteEvent(editor, { html, text: 'x' });
    await tick();
    expect(order).toEqual(['flush']);
    expect(editor.state.doc.childCount).toBe(1);
    release();
    while (editor.state.doc.childCount < 100) await tick();
    expect(editor.getText()).toContain('chunk of pasted text');
  });

  it('a small paste is not delayed', async () => {
    const order: string[] = [];
    const { editor } = makeEditor({ content: '<p>a</p>', flushPending: async () => order.push('flush') });
    await tick();
    pasteEvent(editor, { html: '<p>small</p>', text: 'small' });
    expect(editor.getText()).toContain('small');
    expect(order).toEqual([]);
  });
});

describe('document limits match the save limits (QA-3)', () => {
  it('a pasted list nested deeper than a note can store is refused with a message', async () => {
    const { editor, notices } = makeEditor({ content: '<p>before</p>' });
    await tick();
    const before = editor.getJSON();
    pasteEvent(editor, { html: nestedList(40), text: 'l' });
    expect(notices).toEqual([TOO_DEEP_MESSAGE]);
    expect(editor.getJSON()).toEqual(before);
  });

  it('a list nested as deep as allowed is accepted and saves', async () => {
    const { editor, notices } = makeEditor({ content: '<p>before</p>' });
    await tick();
    pasteEvent(editor, { html: nestedList(31), text: 'l' });
    expect(notices).toEqual([]);
    const savable = toSavable(editor.getJSON());
    expect(maxDepth(savable)).toBeLessThanOrEqual(MAX_DOC_DEPTH);
    expect(() => normalizeRichDoc(savable)).not.toThrow();
  });

  it('indenting with Tab stops at the limit instead of producing an unsavable note', async () => {
    // 31 levels is the deepest list that still saves; a new item indented below it would not.
    const { editor, notices } = makeEditor({ content: nestedList(31) });
    await tick();
    let end = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText) end = pos + node.nodeSize;
    });
    editor.commands.setTextSelection(end);
    expect(editor.commands.splitListItem('listItem')).toBe(true);
    expect(notices).toEqual([]);
    const before = editor.getJSON();
    editor.commands.sinkListItem('listItem');
    expect(notices).toEqual([TOO_DEEP_MESSAGE]);
    expect(editor.getJSON()).toEqual(before);
    expect(() => normalizeRichDoc(toSavable(editor.getJSON()))).not.toThrow();
  });

  it('the incremental part count stays exact through splits, joins, typing, undo and deletes (F-03-2)', async () => {
    const notices: string[] = [];
    const limit = 16;
    const editor = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      extensions: [StarterKit, createDocLimits((m) => notices.push(m), { depth: MAX_DOC_DEPTH, nodes: limit })],
      content: '<p>ab</p><p>cd</p><ul><li><p>item</p></li></ul>',
    });
    const parts = () => {
      let n = 0;
      editor.state.doc.descendants(() => {
        n += 1;
      });
      return n;
    };
    expect(parts()).toBe(8);
    editor.commands.setTextSelection(2);
    editor.commands.splitBlock();
    editor.commands.joinBackward();
    editor.commands.insertContent('typed');
    editor.commands.undo();
    editor.commands.setTextSelection({ from: 1, to: 7 });
    editor.commands.deleteSelection();
    editor.commands.undo();
    // If the tracked count had drifted from the real one, the limit would trip early or late.
    const room = limit - parts();
    expect(room).toBeGreaterThan(2);
    const appendParagraph = () => editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.paragraph!.create()));
    for (let i = 0; i < room; i += 1) appendParagraph();
    expect(notices).toEqual([]);
    expect(parts()).toBe(limit);
    appendParagraph();
    expect(notices).toEqual([TOO_MANY_PARTS_MESSAGE]);
    expect(parts()).toBe(limit);
    editor.destroy();
  });

  it('a paste that would exceed 100,000 parts is refused', async () => {
    const { editor, notices } = makeEditor({ content: '<p>start</p>' });
    await tick();
    pasteEvent(editor, { html: '<p>a</p>'.repeat(50_001), text: 'a' });
    while (notices.length === 0 && editor.state.doc.childCount < 50_001) await tick();
    expect(notices).toEqual([TOO_MANY_PARTS_MESSAGE]);
    expect(editor.state.doc.childCount).toBe(1);
  }, 60_000);
});
