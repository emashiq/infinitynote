// @vitest-environment jsdom
import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { toSavable } from '../../../../src/shared/editor/savable';
import { normalizeRichDoc } from '../../../../src/shared/editor/doc-schema';
import { makeEditor, tick } from './support';

/** The document's structure without IDs: types, levels, marks, text. */
function shape(node: JSONContent): unknown {
  const { attrs, content, marks, text, type } = node;
  const keptAttrs = attrs ? Object.fromEntries(Object.entries(attrs).filter(([k, v]) => k !== 'id' && v !== null)) : undefined;
  return {
    type,
    ...(text !== undefined ? { text } : {}),
    ...(keptAttrs && Object.keys(keptAttrs).length > 0 ? { attrs: keptAttrs } : {}),
    ...(marks ? { marks: marks.map((m) => (m.type === 'link' ? { type: 'link', href: m.attrs?.href } : { type: m.type })) } : {}),
    ...(content ? { content: content.map(shape) } : {}),
  };
}

/** Removes attributes the normalizer is allowed to drop, so the comparison shows only real losses. */
function withoutDroppable(node: JSONContent): JSONContent {
  const out: JSONContent = { ...node };
  if (node.marks) out.marks = node.marks.map((m) => (m.type === 'link' ? { type: 'link', attrs: { href: m.attrs?.href } } : { type: m.type }));
  if (node.attrs) out.attrs = Object.fromEntries(Object.entries(node.attrs).filter(([k, v]) => !(k === 'id' && v === null)));
  if (node.attrs && Object.keys(out.attrs!).length === 0) delete out.attrs;
  if (node.content) out.content = node.content.map(withoutDroppable);
  return out;
}

async function expectSchemaRoundTrip(run: (e: ReturnType<typeof makeEditor>['editor']) => void, expected: (json: JSONContent) => void) {
  const { editor } = makeEditor({ content: '<p>word</p>' });
  await tick();
  editor.commands.selectAll();
  run(editor);
  const json = editor.getJSON();
  expected(json);
  const normalized = normalizeRichDoc(toSavable(json));
  expect(normalized).toEqual(withoutDroppable(toSavable(json) as JSONContent));
  const reloaded = makeEditor({ content: normalized as JSONContent });
  await tick();
  expect(shape(reloaded.editor.getJSON())).toEqual(shape(json));
  expect(reloaded.editor.getText()).toBe(editor.getText());
}

const firstBlock = (json: JSONContent) => json.content![0]!;

describe('editor commands produce documents the schema accepts (INF-EDIT-02)', () => {
  it.each([1, 2, 3] as const)('heading %i', async (level) => {
    await expectSchemaRoundTrip(
      (e) => e.commands.toggleHeading({ level }),
      (json) => expect(firstBlock(json)).toMatchObject({ type: 'heading', attrs: { level } }),
    );
  });

  it.each([
    ['bold', (e: ReturnType<typeof makeEditor>['editor']) => e.commands.toggleBold()],
    ['italic', (e: ReturnType<typeof makeEditor>['editor']) => e.commands.toggleItalic()],
    ['code', (e: ReturnType<typeof makeEditor>['editor']) => e.commands.toggleCode()],
    ['strike', (e: ReturnType<typeof makeEditor>['editor']) => e.commands.toggleStrike()],
    ['underline', (e: ReturnType<typeof makeEditor>['editor']) => e.commands.toggleUnderline()],
  ])('%s mark', async (mark, run) => {
    await expectSchemaRoundTrip(run, (json) => expect(firstBlock(json).content![0]!.marks).toEqual([{ type: mark }]));
  });

  it.each([
    ['bulletList', (e: ReturnType<typeof makeEditor>['editor']) => e.commands.toggleBulletList(), 'listItem'],
    ['orderedList', (e: ReturnType<typeof makeEditor>['editor']) => e.commands.toggleOrderedList(), 'listItem'],
    ['taskList', (e: ReturnType<typeof makeEditor>['editor']) => e.commands.toggleTaskList(), 'taskItem'],
  ])('%s', async (list, run, item) => {
    await expectSchemaRoundTrip(run, (json) => {
      expect(firstBlock(json).type).toBe(list);
      expect(firstBlock(json).content![0]!.type).toBe(item);
    });
  });

  it('Ctrl+Enter toggles the checklist item at the cursor', async () => {
    await expectSchemaRoundTrip(
      (e) => {
        e.commands.toggleTaskList();
        e.commands.setTextSelection(3);
        e.commands.keyboardShortcut('Mod-Enter');
      },
      (json) => expect(firstBlock(json).content![0]!.attrs).toMatchObject({ checked: true }),
    );
  });

  it('Ctrl+Enter outside a checklist keeps the default line break and creates no checklist', async () => {
    const { editor } = makeEditor({ content: '<p>word</p>' });
    await tick();
    editor.commands.setTextSelection(2);
    editor.commands.keyboardShortcut('Mod-Enter');
    expect(firstBlock(editor.getJSON()).content!.map((n) => n.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(JSON.stringify(editor.getJSON())).not.toContain('taskItem');
  });

  it('link set and unset; javascript: is refused', async () => {
    await expectSchemaRoundTrip(
      (e) => e.commands.setLink({ href: 'https://example.com/docs' }),
      (json) => expect(firstBlock(json).content![0]!.marks).toEqual([{ type: 'link', attrs: expect.objectContaining({ href: 'https://example.com/docs' }) }]),
    );
    const { editor } = makeEditor({ content: '<p>word</p>' });
    await tick();
    editor.commands.selectAll();
    expect(editor.commands.setLink({ href: 'javascript:alert(1)' })).toBe(false);
    editor.commands.setLink({ href: 'https://example.com' });
    editor.commands.unsetLink();
    expect(JSON.stringify(editor.getJSON())).not.toContain('"link"');
  });

  it('code block', async () => {
    await expectSchemaRoundTrip(
      (e) => e.commands.toggleCodeBlock(),
      (json) => expect(firstBlock(json)).toMatchObject({ type: 'codeBlock', content: [{ type: 'text', text: 'word' }] }),
    );
  });

  it('undo and redo', async () => {
    const { editor } = makeEditor({ content: '<p>abc</p>' });
    await tick();
    editor.commands.focus('end');
    editor.commands.insertContent('XYZ');
    expect(editor.getText()).toBe('abcXYZ');
    editor.commands.undo();
    expect(editor.getText()).toBe('abc');
    editor.commands.redo();
    expect(editor.getText()).toBe('abcXYZ');
  });

  it('image size presets are user edits and stay in the schema', async () => {
    const id = crypto.randomUUID();
    const { editor } = makeEditor({ content: { type: 'doc', content: [{ type: 'image', attrs: { attachmentId: id, width: 800, height: 200 } }] } });
    await tick();
    editor.commands.setNodeSelection(0);
    expect(editor.commands.setImageSize('full')).toBe(true);
    const json = editor.getJSON();
    expect(firstBlock(json).attrs).toMatchObject({ attachmentId: id, size: 'full', width: 800, height: 200 });
    expect(normalizeRichDoc(toSavable(json)).content![0]).toMatchObject({ type: 'image', attrs: { size: 'full' } });
    editor.commands.undo();
    expect(firstBlock(editor.getJSON()).attrs).toMatchObject({ size: 'medium' });
  });

  it('toSavable drops images and files that are still uploading', () => {
    const doc = toSavable({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'image', attrs: { uploadToken: 'tok', attachmentId: null } },
        { type: 'blockquote', content: [{ type: 'fileAttachment', attrs: { uploadToken: 'tok2' } }, { type: 'paragraph' }] },
      ],
    });
    expect(doc).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'blockquote', content: [{ type: 'paragraph' }] }] });
  });
});
