// @vitest-environment jsdom
import type { Editor, JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { fenceBeforeEnter } from '../../../../src/renderer/editor/code/code-block';
import { fencedTextSlice, hasCodeFence } from '../../../../src/renderer/editor/code-fences';
import { DIAGRAM_STARTER, insertDiagram, toggleDiagram } from '../../../../src/renderer/editor/note-actions';
import { makeEditor, pasteEvent, pasteHtml } from './support';

const p = (text: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
/** Each top-level block as [type, language, text]; the empty paragraph the editor keeps after a final code block is left out. */
function blocks(json: JSONContent) {
  const out = (json.content ?? []).map((n) => [n.type, n.attrs?.language ?? null, (n.content ?? []).map((c) => c.text ?? '').join('')]);
  const last = out.at(-1);
  return out.length > 1 && last?.[0] === 'paragraph' && last[2] === '' && out.at(-2)?.[0] === 'codeBlock' ? out.slice(0, -1) : out;
}

/** Enter as the keyboard sends it, through ProseMirror's key handling. */
function pressEnter(editor: Editor) {
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

/** A rich editor holding the paragraphs, with the cursor at the end of the last one. */
function editorWith(...paragraphs: string[]) {
  const { editor } = makeEditor({ content: { type: 'doc', content: paragraphs.map(p) } });
  editor.commands.focus('end');
  return editor;
}

describe('finding diagrams (D-183)', () => {
  it('Insert diagram puts the starter flowchart in a Mermaid block', () => {
    const editor = editorWith('Before');
    insertDiagram(editor);
    expect(blocks(editor.getJSON())).toContainEqual(['codeBlock', 'mermaid', DIAGRAM_STARTER]);
  });

  it('the toolbar button starts a diagram on an empty line, turns selected text into one, and back', () => {
    const empty = editorWith('');
    toggleDiagram(empty);
    expect(blocks(empty.getJSON())[0]).toEqual(['codeBlock', 'mermaid', DIAGRAM_STARTER]);

    const editor = editorWith('graph TD; A-->B');
    editor.commands.setTextSelection({ from: 1, to: 16 });
    toggleDiagram(editor);
    expect(blocks(editor.getJSON())).toEqual([['codeBlock', 'mermaid', 'graph TD; A-->B']]);
    toggleDiagram(editor);
    expect(blocks(editor.getJSON())[0]).toEqual(['paragraph', null, 'graph TD; A-->B']);
  });

  it('a fence line before Enter names the language; not mid-line, not with text before it, not as a list item first line', () => {
    expect(fenceBeforeEnter(editorWith('```mermaid'))).toBe('mermaid');
    expect(fenceBeforeEnter(editorWith('```Mermaid'))).toBe('mermaid');
    expect(fenceBeforeEnter(editorWith('```'))).toBe('');
    expect(fenceBeforeEnter(editorWith('see ```mermaid'))).toBeNull();
    expect(fenceBeforeEnter(editorWith('```mermaid diagram'))).toBeNull();
    const mid = editorWith('```mermaid');
    mid.commands.setTextSelection(3);
    expect(fenceBeforeEnter(mid)).toBeNull();
    const { editor: list } = makeEditor({ content: { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('```mermaid')] }] }] } });
    list.commands.focus('end');
    expect(fenceBeforeEnter(list)).toBeNull();
  });

  it('Enter after ```mermaid makes a diagram block, and the other text stays', () => {
    const editor = editorWith('Intro', '```mermaid');
    pressEnter(editor);
    expect(blocks(editor.getJSON())).toEqual([
      ['paragraph', null, 'Intro'],
      ['codeBlock', 'mermaid', ''],
    ]);
    editor.commands.insertContent('flowchart LR\n  A --> B');
    expect(blocks(editor.getJSON())[1]).toEqual(['codeBlock', 'mermaid', 'flowchart LR\n  A --> B']);
    // An ordinary Enter still splits the paragraph.
    const plain = editorWith('Just text');
    pressEnter(plain);
    expect(blocks(plain.getJSON())).toEqual([
      ['paragraph', null, 'Just text'],
      ['paragraph', null, ''],
    ]);
  });

  it('reads Markdown fences in pasted text: complete fences only, backticks or tildes, any language', () => {
    const { schema } = makeEditor().editor;
    const text = 'Intro\r\n\r\n```mermaid\r\nflowchart TD\r\n  A-->B\r\n```\r\nAfter\n~~~~ js\nconst a = 1;\n~~~~\n';
    expect(hasCodeFence(text)).toBe(true);
    const slice = fencedTextSlice(text, schema)!;
    expect([slice.openStart, slice.openEnd]).toEqual([1, 0]);
    expect(slice.content.toJSON().map((n: JSONContent) => [n.type, n.attrs?.language ?? null, n.content?.[0]?.text ?? ''])).toEqual([
      ['paragraph', null, 'Intro'],
      ['codeBlock', 'mermaid', 'flowchart TD\n  A-->B'],
      ['paragraph', null, 'After'],
      ['codeBlock', 'js', 'const a = 1;'],
    ]);
    expect(fencedTextSlice('no fences here', schema)).toBeNull();
    expect(fencedTextSlice('```mermaid\nflowchart TD\nnever closed', schema)).toBeNull();
    expect(fencedTextSlice('```\n```', schema)!.content.toJSON()).toMatchObject([{ type: 'codeBlock', attrs: { language: null } }]);
    // A shorter or other closing fence does not close it.
    expect(hasCodeFence('````md\n```\nstill code\n~~~~')).toBe(false);
  });

  it('pasting Markdown text with a mermaid fence gives a diagram, also when an editor adds styled HTML', () => {
    const fromText = editorWith('');
    pasteEvent(fromText, { text: 'Plan:\n```mermaid\nflowchart TD\n  A-->B\n```' });
    expect(blocks(fromText.getJSON())).toEqual([
      ['paragraph', null, 'Plan:'],
      ['codeBlock', 'mermaid', 'flowchart TD\n  A-->B'],
    ]);

    const fromEditor = editorWith('');
    pasteEvent(fromEditor, {
      text: '```mermaid\nsequenceDiagram\n  A->>B: hi\n```',
      html: '<div style="color: #333"><div><span>```mermaid</span></div><div><span>sequenceDiagram</span></div><div><span>  A-&gt;&gt;B: hi</span></div><div><span>```</span></div></div>',
    });
    expect(blocks(fromEditor.getJSON())).toContainEqual(['codeBlock', 'mermaid', 'sequenceDiagram\n  A->>B: hi']);

    // Ctrl+Shift+V (paste as plain text) keeps the fences as text.
    const plain = editorWith('');
    plain.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }));
    pasteEvent(plain, { text: '```mermaid\nflowchart TD\n```', html: '<div><span>```mermaid</span></div><div><span>flowchart TD</span></div><div><span>```</span></div>' });
    plain.view.dom.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    expect(blocks(plain.getJSON()).some(([type]) => type === 'codeBlock')).toBe(false);
    expect(plain.getText()).toContain('```mermaid');

    // A page whose HTML has its own code block is pasted as HTML; the language is found on the inner code element.
    const fromPage = editorWith('');
    pasteHtml(fromPage, '<pre><div class="header">mermaid</div><code class="language-mermaid">flowchart LR\n  X--&gt;Y</code></pre>');
    expect(blocks(fromPage.getJSON())[0]?.[1]).toBe('mermaid');
  });
});
