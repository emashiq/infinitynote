// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CommentsStore } from '../../../../src/renderer/comments/comments-store';
import { createNoteCommentHost } from '../../../../src/renderer/comments/note-comment-host';
import { addCommentMark, commentableSelection, commentMarksKey, isCommentShortcut, markedThreads, removeCommentMark, threadRanges, type ShortcutKey } from '../../../../src/renderer/editor/comments/comment-marks';
import { EditorHandle } from '../../../../src/renderer/editor/editor-handle';
import { CommentsSection, COMMENT_EMPTY, TEXT_REMOVED } from '../../../../src/renderer/panel/CommentsSection';
import { createAppServices } from '../../../../src/renderer/state/app-services';
import { AppServicesContext } from '../../../../src/renderer/state/use-store';
import { COMMENT_MESSAGES } from '../../../../src/shared/contracts/comments';
import { createFakeBridge } from '../support/fake-bridge';
import { makeEditor, pasteHtml } from './support';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  document.body.innerHTML = '';
});

const T1 = '11111111-1111-4111-8111-111111111111';
const NOTE = '22222222-2222-4222-8222-222222222222';
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The budget is due' }] }] };

function selectWord(editor: ReturnType<typeof makeEditor>['editor'], word: string) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from < 0 && node.isText) {
      const at = node.text!.indexOf(word);
      if (at >= 0) from = pos + at;
    }
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + word.length)));
}

describe('comment marks in the editor (D-165)', () => {
  it('marks the selected text with the thread, outside the undo history, and finds and removes it again', () => {
    const { editor } = makeEditor({ content });
    selectWord(editor, 'budget');
    const selected = commentableSelection(editor.state);
    expect(selected).toMatchObject({ quote: 'budget' });
    addCommentMark(editor, selected as { from: number; to: number }, T1);
    expect(JSON.stringify(editor.getJSON())).toContain(T1);
    expect(markedThreads(editor.state.doc)).toEqual(new Set([T1]));
    expect(threadRanges(editor.state.doc, T1)).toHaveLength(1);
    editor.commands.undo();
    expect(markedThreads(editor.state.doc)).toEqual(new Set([T1]));
    removeCommentMark(editor, T1);
    expect(markedThreads(editor.state.doc).size).toBe(0);
  });

  it('Ctrl+Alt+M starts a comment in either case and on non-Latin layouts, never as AltGr or with other modifiers (D-181)', () => {
    const key = (over: Partial<ShortcutKey> & { altGraph?: boolean }): ShortcutKey => ({
      key: 'm',
      code: 'KeyM',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
      getModifierState: (m: string) => m === 'AltGraph' && over.altGraph === true,
      ...over,
    });
    expect(isCommentShortcut(key({}))).toBe(true);
    // Caps Lock, and what Playwright's "Control+Alt+M" sends: the Windows CI failure of Run R.
    expect(isCommentShortcut(key({ key: 'M' }))).toBe(true);
    // A Bangla layout puts another letter on the M key.
    expect(isCommentShortcut(key({ key: 'ম' }))).toBe(true);
    // AltGr typing a character on that key (German µ) stays typing.
    expect(isCommentShortcut(key({ key: 'µ', altGraph: true }))).toBe(false);
    expect(isCommentShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isCommentShortcut(key({ metaKey: true }))).toBe(false);
    expect(isCommentShortcut(key({ altKey: false }))).toBe(false);
    expect(isCommentShortcut(key({ ctrlKey: false }))).toBe(false);
    expect(isCommentShortcut(key({ key: 'n', code: 'KeyN' }))).toBe(false);

    const starts = vi.fn(() => true);
    const { editor } = makeEditor({ content, startComment: starts });
    selectWord(editor, 'budget');
    const press = (init: KeyboardEventInit) => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, altKey: true, code: 'KeyM', ...init }));
    expect(press({ key: 'M' })).toBe(false);
    expect(starts).toHaveBeenCalledTimes(1);
    press({ key: 'm', shiftKey: true });
    expect(starts).toHaveBeenCalledTimes(1);
    editor.setEditable(false);
    press({ key: 'm' });
    expect(starts).toHaveBeenCalledTimes(1);
  });

  it('needs selected text', () => {
    const { editor } = makeEditor({ content });
    expect(commentableSelection(editor.state)).toEqual({ error: COMMENT_MESSAGES.quoteNeeded });
  });

  it('typing at the end of commented text does not extend the comment', () => {
    const { editor } = makeEditor({ content });
    selectWord(editor, 'budget');
    addCommentMark(editor, commentableSelection(editor.state) as { from: number; to: number }, T1);
    const end = threadRanges(editor.state.doc, T1)[0]!.to;
    editor.chain().setTextSelection(end).insertContent('s').run();
    expect(editor.state.doc.textBetween(threadRanges(editor.state.doc, T1)[0]!.from, threadRanges(editor.state.doc, T1)[0]!.to)).toBe('budget');
  });

  it('pasted HTML never brings a thread along (no alias of a thread in a copy)', () => {
    const { editor } = makeEditor({ content });
    pasteHtml(editor, `<p>copied <span data-comment-thread="${T1}">budget</span></p>`);
    expect(editor.getText()).toContain('copied budget');
    expect(markedThreads(editor.state.doc).size).toBe(0);
  });
});

describe('the note tab as comment host and the Comments section (D-165)', () => {
  function setup() {
    const fake = createFakeBridge();
    const handle = new EditorHandle();
    const { editor } = makeEditor({ content });
    handle.attach(editor);
    const showPanel = vi.fn();
    const notices: string[] = [];
    const store = new CommentsStore({ bridge: fake.bridge, notify: (m) => notices.push(m), showPanel });
    const unregister = store.register(createNoteCommentHost(NOTE, handle));
    return { fake, handle, editor, store, showPanel, notices, unregister };
  }

  it('Comment on a selection opens the composer; saving creates the thread, marks the text and highlights it', async () => {
    const { editor, store, showPanel, fake } = setup();
    await flush();
    expect(store.store.getState().status).toBe('ready');
    selectWord(editor, 'budget');
    store.start();
    expect(showPanel).toHaveBeenCalled();
    expect(store.store.getState().draft).toMatchObject({ quote: 'budget', anchor: { type: 'text' } });
    expect(commentMarksKey.getState(editor.state)!.pending).not.toBeNull();

    expect((await store.submitDraft('Check the numbers')).ok).toBe(true);
    const [thread] = store.store.getState().threads;
    expect(thread).toMatchObject({ quote: 'budget', target: { kind: 'note', id: NOTE } });
    expect(fake.callsTo('comment:create')).toHaveLength(1);
    expect(markedThreads(editor.state.doc)).toEqual(new Set([thread!.id]));
    expect(commentMarksKey.getState(editor.state)!.open.has(thread!.id)).toBe(true);
    expect(editor.view.dom.querySelector('.comment-anchor')?.textContent).toBe('budget');
  });

  it('without a selection nothing opens and the user is told why', () => {
    const { store, notices } = setup();
    store.start();
    expect(store.store.getState().draft).toBeNull();
    expect(notices).toEqual([COMMENT_MESSAGES.quoteNeeded]);
  });

  it('resolving hides the highlight; deleting the thread removes the mark; removed text is reported as orphaned', async () => {
    const { editor, store } = setup();
    await flush();
    selectWord(editor, 'budget');
    store.start();
    await store.submitDraft('One');
    const id = store.store.getState().threads[0]!.id;

    await store.resolve(id, true);
    expect(commentMarksKey.getState(editor.state)!.open.has(id)).toBe(false);
    await store.resolve(id, false);

    // Deleting the text leaves the thread without its anchor.
    const range = threadRanges(editor.state.doc, id)[0]!;
    editor.view.dispatch(editor.state.tr.delete(range.from, range.to));
    await act(async () => new Promise((r) => setTimeout(r, 250)));
    expect(store.store.getState().orphans).toEqual(new Set([id]));

    await store.deleteThread(id);
    expect(store.store.getState().threads).toEqual([]);
  });

  it('renders threads with replies, open and resolved filters, and "Text removed" for orphans', async () => {
    const fake = createFakeBridge();
    const services = createAppServices(fake.bridge, { themeEnv: null, lifecycle: null });
    await services.ready;
    const handle = new EditorHandle();
    const { editor } = makeEditor({ content });
    handle.attach(editor);
    services.comments.register(createNoteCommentHost(NOTE, handle));
    await flush();
    selectWord(editor, 'budget');
    services.comments.start();
    await services.comments.submitDraft('First');
    const id = services.comments.store.getState().threads[0]!.id;
    await services.comments.reply(id, 'A reply');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <AppServicesContext.Provider value={services}>
          <CommentsSection />
        </AppServicesContext.Provider>,
      ),
    );
    expect(host.querySelector('.comment-quote')?.textContent).toBe('budget');
    expect([...host.querySelectorAll('.comment-body')].map((b) => b.textContent)).toEqual(['First', 'A reply']);
    expect(host.textContent).toContain('Open (1)');

    await act(async () => (host.querySelector('.comment-actions button:nth-child(2)') as HTMLButtonElement).click());
    await flush();
    expect(host.textContent).toContain(COMMENT_EMPTY.open);
    await act(async () => services.comments.setFilter('resolved'));
    expect(host.textContent).toContain('Resolved (1)');

    await act(async () => services.comments.setFilter('open'));
    await services.comments.resolve(id, false);
    const range = threadRanges(editor.state.doc, id)[0]!;
    await act(async () => {
      editor.view.dispatch(editor.state.tr.delete(range.from, range.to));
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(host.textContent).toContain(TEXT_REMOVED);
    await act(async () => root.unmount());
    await services.dispose();
  });
});
