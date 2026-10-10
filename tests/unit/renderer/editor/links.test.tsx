// @vitest-environment jsdom
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LinkPicker, type PickedLink } from '../../../../src/renderer/editor/LinkPicker';
import type { LinkRequest } from '../../../../src/renderer/editor/link-trigger';
import { createFakeBridge } from '../support/fake-bridge';
import { makeEditor, tick } from './support';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  document.body.innerHTML = '';
});

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function arrange() {
  const fake = createFakeBridge();
  const at = { projectId: null, folderId: null };
  const note = await fake.bridge.note.create({ location: at, sticky: false, title: 'Road trip' });
  if (!note.ok) throw new Error('note');
  const deck = fake.addDocument({ ...at, title: 'Roadmap deck', kind: 'pptx', storage: 'managed', sizeBytes: 10 });
  const page = fake.addDocument({ ...at, title: 'Roads page', kind: 'html', storage: 'managed', sizeBytes: 10 });
  const picks: PickedLink[] = [];
  const created: string[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onCreateNote = async (title: string) => {
    created.push(title);
    return { id: crypto.randomUUID(), title };
  };
  await act(async () => root.render(<LinkPicker bridge={fake.bridge} initialQuery="road" onPick={(p) => picks.push(p)} onCreateNote={onCreateNote} onClose={() => undefined} />));
  await wait(200);
  const input = () => document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const options = () => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  const key = (k: string) => act(async () => void input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
  const type = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await wait(200);
  };
  return { note: note.data.note, deck, page, picks, created, input, options, key, type };
}

describe('the link picker (D-157)', () => {
  it('lists notes and documents with their kind and a create option, then links a place in a presentation', async () => {
    const t = await arrange();
    expect(t.options()).toEqual(['Road tripCommon', 'Roads pageCommon', 'Roadmap deckCommon', 'Create note “road”']);
    expect(document.querySelectorAll('[role="option"] [data-document-kind]')).toHaveLength(2);
    await t.key('ArrowDown');
    await t.key('ArrowDown');
    await t.key('Enter');
    expect(t.input().getAttribute('aria-label')).toBe('Slide number');
    expect(t.options()).toEqual(['Whole document']);
    await t.type('3');
    expect(t.options()).toEqual(['Slide 3', 'Whole document']);
    await t.key('Enter');
    expect(t.picks).toEqual([{ kind: 'document', documentId: t.deck.id, target: { slide: 3 }, label: 'Roadmap deck' }]);
  });

  it('links a document without places at once, a whole note after its step, and creates a note with the typed title', async () => {
    const t = await arrange();
    await t.key('ArrowDown');
    await t.key('Enter');
    expect(t.picks.at(-1)).toEqual({ kind: 'document', documentId: t.page.id, target: null, label: 'Roads page' });
    await t.key('ArrowUp');
    await t.key('Enter');
    expect(t.options()[0]).toBe('Whole note');
    await t.key('Enter');
    expect(t.picks.at(-1)).toEqual({ kind: 'note', noteId: t.note.id, blockId: null, label: 'Road trip', excerpt: null });
    // Backspace on the empty filter went nowhere: the picker is still on the note; go back and create.
    await t.key('Backspace');
    await t.type('Road trip');
    expect(t.options()).not.toContain('Create note “Road trip”');
    await t.type('Fresh idea');
    expect(t.options()).toEqual(['Create note “Fresh idea”']);
    await t.key('Enter');
    await wait(10);
    expect(t.created).toEqual(['Fresh idea']);
    expect(t.picks.at(-1)).toMatchObject({ kind: 'note', label: 'Fresh idea', blockId: null });
  });
});

/** Types text through ProseMirror's text input path, so input rules run as they do for keys. */
function typeText(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) => f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}

describe('keys that open the link picker (D-157)', () => {
  it('"[[" opens the picker and removes the brackets; where the picker cannot open the brackets stay', async () => {
    const requests: LinkRequest[] = [];
    const { editor } = makeEditor({ content: '<p>see</p>', requestLink: (r) => (requests.push(r), true) });
    await tick();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    typeText(editor, '[[');
    expect(requests).toEqual([{ typed: true }]);
    expect(editor.getText()).toBe('see');

    const off = makeEditor({ content: '<p>a</p>', requestLink: () => false });
    await tick();
    off.editor.commands.setTextSelection(off.editor.state.doc.content.size - 1);
    typeText(off.editor, '[[');
    expect(off.editor.getText()).toBe('a[[');
  });

  it('"[[" in a code block is code', async () => {
    const request = vi.fn(() => true);
    const { editor } = makeEditor({ content: '<pre><code>x</code></pre>', requestLink: request });
    await tick();
    editor.commands.setTextSelection(2);
    typeText(editor, '[[');
    expect(request).not.toHaveBeenCalled();
    expect(editor.state.doc.firstChild!.textContent).toBe('x[[');
  });

  it('Ctrl+Shift+K links the selected text; Ctrl+Shift+L opens the picker; a selection with a chip has no alias', async () => {
    const requests: LinkRequest[] = [];
    const { editor } = makeEditor({ content: '<p>the design doc</p>', requestLink: (r) => (requests.push(r), true) });
    await tick();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 5, 11)));
    editor.commands.keyboardShortcut('Mod-Shift-k');
    expect(requests.at(-1)).toEqual({ selection: { from: 5, to: 11, text: 'design' } });
    editor.commands.keyboardShortcut('Mod-Shift-l');
    expect(requests.at(-1)).toEqual({});
    editor.commands.insertContentAt(1, { type: 'noteRef', attrs: { noteId: crypto.randomUUID(), label: 'X' } });
    editor.commands.selectAll();
    editor.commands.keyboardShortcut('Mod-Shift-k');
    expect(requests.at(-1)).toEqual({});
  });
});
