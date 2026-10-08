// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isUserEdit } from '../../../../src/renderer/editor/content';
import { blockIds, makeEditor, pasteHtml, tick, UUID_V4 } from './support';

const twoParagraphs = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] };

function allUnique(ids: Array<{ id: string | null }>): boolean {
  const values = ids.map((x) => x.id);
  return values.every((v) => v !== null) && new Set(values).size === values.length;
}

describe('block IDs (INF-EDIT-06, D-053)', () => {
  it('a document without IDs gets UUID v4 IDs on load, and that is not a user edit', async () => {
    const { editor, updates } = makeEditor({ content: twoParagraphs });
    await tick();
    const ids = blockIds(editor);
    expect(ids).toHaveLength(2);
    for (const { id } of ids) expect(id).toMatch(UUID_V4);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.some((tr) => isUserEdit(tr))).toBe(false);
  });

  it('typing keeps every ID; Enter in the middle gives the new block a new ID and the original keeps its own', async () => {
    const { editor, updates } = makeEditor({ content: twoParagraphs });
    await tick();
    const before = blockIds(editor);
    editor.chain().setTextSelection(3).insertContent('XY').run();
    expect(blockIds(editor).map((b) => b.id)).toEqual(before.map((b) => b.id));
    expect(isUserEdit(updates.at(-1)!)).toBe(true);
    editor.chain().setTextSelection(4).splitBlock().run();
    const after = blockIds(editor);
    expect(after).toHaveLength(3);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after[2]!.id).toBe(before[1]!.id);
    expect(after[1]!.id).toMatch(UUID_V4);
    expect(allUnique(after)).toBe(true);
  });

  it('pasted HTML with a foreign data-id or an existing block data-id gets fresh IDs', async () => {
    const { editor } = makeEditor({ content: twoParagraphs });
    await tick();
    const existing = blockIds(editor)[0]!.id!;
    const foreign = '11111111-1111-4111-8111-111111111111';
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    pasteHtml(editor, `<p data-id="${foreign}">pasted one</p><p data-id="${existing}">pasted two</p>`);
    const ids = blockIds(editor);
    expect(ids.map((b) => b.id)).not.toContain(foreign);
    expect(ids.filter((b) => b.id === existing)).toHaveLength(1);
    expect(ids.find((b) => b.id === existing)!.text).toBe('hello world');
    expect(allUnique(ids)).toBe(true);
    expect(ids.map((b) => b.text).join('|')).toContain('pasted two');
  });

  it('inserting a copy of an existing block gives the copy a fresh ID (the UniqueID gap)', async () => {
    const { editor } = makeEditor({ content: twoParagraphs });
    await tick();
    const first = editor.getJSON().content![0]!;
    editor.commands.insertContentAt(editor.state.doc.content.size, first);
    const ids = blockIds(editor);
    expect(ids).toHaveLength(3);
    expect(ids[2]!.text).toBe('hello world');
    expect(ids[2]!.id).not.toBe(ids[0]!.id);
    expect(ids[2]!.id).toMatch(UUID_V4);
    expect(allUnique(ids)).toBe(true);
  });

  it('inserting a copy before the original keeps the original ID on the original block', async () => {
    const { editor } = makeEditor({ content: twoParagraphs });
    await tick();
    const second = editor.getJSON().content![1]!;
    const secondId = blockIds(editor)[1]!.id;
    editor.commands.insertContentAt(0, second);
    const ids = blockIds(editor);
    expect(ids.map((b) => b.text)).toEqual(['second', 'hello world', 'second']);
    expect(ids[2]!.id).toBe(secondId);
    expect(ids[0]!.id).not.toBe(secondId);
    expect(allUnique(ids)).toBe(true);
  });

  it('list items, task items, headings and code blocks all get unique IDs', async () => {
    const { editor } = makeEditor({
      content: '<h1>H</h1><ul><li><p>a</p></li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>t</p></li></ul><pre><code>c</code></pre><blockquote><p>q</p></blockquote>',
    });
    await tick();
    const ids = blockIds(editor);
    expect(new Set(ids.map((b) => b.type))).toEqual(new Set(['heading', 'listItem', 'paragraph', 'taskItem', 'codeBlock', 'blockquote']));
    expect(allUnique(ids)).toBe(true);
  });
});
