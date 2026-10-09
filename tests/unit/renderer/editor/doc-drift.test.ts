// @vitest-environment jsdom
import type { Editor, JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { toSavable } from '../../../../src/shared/editor/savable';
import { normalizeRichDoc } from '../../../../src/shared/editor/doc-schema';
import { makeEditor, tick } from './support';

function rangeOf(editor: Editor, text: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    const i = node.text!.indexOf(text);
    if (i >= 0) found = { from: pos + i, to: pos + i + text.length };
    return !found;
  });
  if (!found) throw new Error(`text not found: ${text}`);
  return found;
}

const SOURCE = [
  '<h1>Heading one</h1><h2>Heading two</h2><h3>Heading three</h3>',
  '<p>styled words</p><p>code words</p><p>a link here</p>',
  '<ul><li><p>bullet</p><ul><li><p>nested</p></li></ul></li></ul>',
  '<ol start="3"><li><p>numbered</p></li></ol>',
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>task</p></li></ul>',
  '<blockquote><p>quoted</p></blockquote>',
  '<p>line<br>break</p>',
  '<pre><code class="language-ts">let x = 1;</code></pre>',
  '<hr>',
].join('');

/**
 * Drift guard (R3-03): a document with every feature, built with setContent and real editor commands, passes the
 * shared normalizer with only the documented drops, and loads back into a fresh editor identically.
 */
describe('editor output and normalizeRichDoc stay in step (D-053)', () => {
  it('every feature survives normalize and reload', async () => {
    const { editor } = makeEditor({ content: '<p>start</p>' });
    await tick();
    editor.commands.setContent(SOURCE);
    editor.chain().setTextSelection(rangeOf(editor, 'styled')).toggleBold().toggleItalic().toggleStrike().toggleUnderline().run();
    editor.chain().setTextSelection(rangeOf(editor, 'code')).toggleCode().run();
    editor.chain().setTextSelection(rangeOf(editor, 'link')).setLink({ href: 'https://example.com/docs' }).run();
    editor.chain().setTextSelection(rangeOf(editor, 'task').from).run();
    editor.commands.keyboardShortcut('Mod-Enter');
    editor.commands.insertContentAt(editor.state.doc.content.size, [
      { type: 'image', attrs: { attachmentId: crypto.randomUUID(), alt: 'chart', size: 'small', width: 640, height: 480 } },
      { type: 'fileAttachment', attrs: { attachmentId: crypto.randomUUID(), name: 'report final.pdf', sizeBytes: 2048, mime: 'application/pdf' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'see ' }, { type: 'noteRef', attrs: { noteId: crypto.randomUUID(), blockId: crypto.randomUUID(), label: 'Design', excerpt: 'Goals' } }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'বাংলা 😀 é' }] },
    ]);

    const json = editor.getJSON();
    const used = new Set(JSON.stringify(json).match(/"type":"[a-zA-Z]+"/g)!.map((t) => t.slice(8, -1)));
    for (const type of ['heading', 'paragraph', 'bold', 'italic', 'strike', 'underline', 'code', 'link', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'hardBreak', 'codeBlock', 'horizontalRule', 'image', 'fileAttachment', 'noteRef']) {
      expect(used, type).toContain(type);
    }
    expect(JSON.stringify(json)).toContain('"checked":true');
    expect(JSON.stringify(json)).toContain('"start":3');
    expect(JSON.stringify(json)).toContain('"language":"ts"');

    const savable = toSavable(json);
    const normalized = normalizeRichDoc(savable);
    expect(normalizeRichDoc(normalized)).toEqual(normalized);
    // Only the documented drops differ: link target/rel/class/title and the editor-only upload token.
    const drop = (s: string) => s.replace(/,"(target|rel|class|title)":(null|"[^"]*")/g, '').replace(/,"uploadToken":null/g, '');
    expect(normalized).toEqual(JSON.parse(drop(JSON.stringify(savable))));

    const reloaded = makeEditor({ content: normalized as JSONContent });
    await tick();
    expect(reloaded.editor.getJSON()).toEqual(json);
  });
});
