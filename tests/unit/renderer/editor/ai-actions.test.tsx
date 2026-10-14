// @vitest-environment jsdom
import { TextSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { answerBlocks, placeAnswer } from '../../../../src/renderer/ai/answer-blocks';
import { CommentsStore } from '../../../../src/renderer/comments/comments-store';
import { createNoteCommentHost } from '../../../../src/renderer/comments/note-comment-host';
import { addCommentMark, commentableSelection, commentMarksKey, markedThreads, threadRanges } from '../../../../src/renderer/editor/comments/comment-marks';
import { EditorHandle } from '../../../../src/renderer/editor/editor-handle';
import { noteMenuItems, type NoteActions } from '../../../../src/renderer/editor/note-actions';
import { AI_EMPTY, CommentsSection } from '../../../../src/renderer/panel/CommentsSection';
import { createAppServices } from '../../../../src/renderer/state/app-services';
import { isAskAiShortcut, matchShortcut } from '../../../../src/renderer/state/shortcuts';
import { AppServicesContext } from '../../../../src/renderer/state/use-store';
import { StickyAi } from '../../../../src/renderer/stickies/sticky-ai';
import { aiNotice } from '../../../../src/shared/ai/engines';
import { AI_MESSAGES } from '../../../../src/shared/ai/limits';
import { createFakeBridge, type FakeBridge } from '../support/fake-bridge';
import { makeEditor } from './support';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  document.body.innerHTML = '';
});

const NOTE = '22222222-2222-4222-8222-222222222222';
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The budget is due' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Next line' }] }] };

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

const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);

describe('AI answers in the note (D-190)', () => {
  it('turns the Markdown of an answer into note blocks', () => {
    const blocks = answerBlocks('## Summary\nThe **budget** is `late` and *risky*.\n\n- one\n- two\n\n1. first\n2. second\n\n- [ ] call Ann\n- [x] pay\n\n```js\nx = 1\n```\n---');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList', 'taskList', 'codeBlock']);
    expect(blocks[0]).toMatchObject({ attrs: { level: 2 }, content: [{ type: 'text', text: 'Summary' }] });
    expect(blocks[1]!.content).toEqual([
      { type: 'text', text: 'The ' },
      { type: 'text', text: 'budget', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' is ' },
      { type: 'text', text: 'late', marks: [{ type: 'code' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'risky', marks: [{ type: 'italic' }] },
      { type: 'text', text: '.' },
    ]);
    expect(blocks[4]!.content!.map((i) => i.attrs?.checked)).toEqual([false, true]);
    expect(blocks[5]).toMatchObject({ attrs: { language: 'js' }, content: [{ type: 'text', text: 'x = 1' }] });
  });

  it('Insert below adds the answer after the block of the thread’s text; Replace selection keeps the thread on the new text', () => {
    const { editor } = makeEditor({ content });
    selectWord(editor, 'budget');
    addCommentMark(editor, commentableSelection(editor.state) as { from: number; to: number }, NOTE);
    expect(placeAnswer(editor, NOTE, '- a\n- b', 'below')).toBe(true);
    expect(editor.getJSON().content!.map((b) => b.type)).toEqual(['paragraph', 'bulletList', 'paragraph']);
    expect(placeAnswer(editor, NOTE, 'spending plan', 'replace')).toBe(true);
    expect(editor.state.doc.firstChild!.textContent).toBe('The spending plan is due');
    const [range] = threadRanges(editor.state.doc, NOTE);
    expect(editor.state.doc.textBetween(range!.from, range!.to)).toBe('spending plan');
    editor.commands.undo();
    expect(editor.state.doc.firstChild!.textContent).toBe('The budget is due');
    editor.setEditable(false);
    expect(placeAnswer(editor, NOTE, 'x', 'below')).toBe(false);
  });

  it('Ctrl+Shift+I asks AI in every window; Ask AI is in the note menu only while AI actions are on', () => {
    const key = (over: Partial<KeyboardEvent>) => ({ key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, ...over });
    expect(isAskAiShortcut(key({}))).toBe(true);
    expect(isAskAiShortcut(key({ key: 'Ш' }))).toBe(true);
    expect(isAskAiShortcut(key({ altKey: true }))).toBe(false);
    expect(isAskAiShortcut(key({ shiftKey: false, key: 'i' }))).toBe(false);
    expect(matchShortcut(key({}))).toBe('ai.ask');
    const actions: NoteActions = { insertAttachment: vi.fn(), openFind: vi.fn(), convert: vi.fn(), openVersions: vi.fn() };
    expect(noteMenuItems(actions, { format: 'rich', editable: true }).map((i) => i.id)).not.toContain('askAi');
    const ask = vi.fn();
    const items = noteMenuItems({ ...actions, askAi: ask }, { format: 'rich', editable: true });
    items.find((i) => i.id === 'askAi')!.onSelect();
    expect(ask).toHaveBeenCalled();
  });
});

describe('AI threads in the comments store (D-190)', () => {
  function setup() {
    const fake = createFakeBridge();
    const handle = new EditorHandle();
    const { editor } = makeEditor({ content });
    handle.attach(editor);
    const notices: string[] = [];
    const showPanel = vi.fn();
    const store = new CommentsStore({ bridge: fake.bridge, notify: (m) => notices.push(m), showPanel });
    store.register(createNoteCommentHost(NOTE, handle));
    return { fake, editor, store, notices, showPanel };
  }
  const choices = { action: 'summarize' as const, prompt: '', wholeItem: false, files: [], picked: null };

  it('Ask AI on a selection anchors a running thread with the AI highlight, then shows the answer', async () => {
    const { fake, editor, store, showPanel } = setup();
    await flush();
    selectWord(editor, 'budget');
    store.startAi();
    expect(showPanel).toHaveBeenCalled();
    expect(store.store.getState().aiDraft).toMatchObject({ quote: 'budget', text: 'budget', anchor: { type: 'text' } });
    expect((await store.submitAi(choices)).ok).toBe(true);
    expect(fake.callsTo('ai:ask')[0]!.req).toMatchObject({ target: { kind: 'note', id: NOTE }, quote: 'budget', selection: 'budget', action: 'summarize' });
    await flush();
    const [thread] = store.store.getState().threads;
    expect(thread).toMatchObject({ kind: 'ai', running: false });
    expect(thread!.comments.map((c) => [c.role, c.body])).toEqual([
      ['user', 'Summarize'],
      ['assistant', 'The fake answer'],
    ]);
    expect(markedThreads(editor.state.doc)).toEqual(new Set([thread!.id]));
    expect(commentMarksKey.getState(editor.state)!.ai.has(thread!.id)).toBe(true);
    expect(editor.view.dom.querySelector('.ai-anchor')?.textContent).toBe('budget');
    expect(store.store.getState().aiDraft).toBeNull();

    expect((await store.followUpAi(thread!.id, 'And why?')).ok).toBe(true);
    await flush();
    expect(store.store.getState().threads[0]!.comments.map((c) => c.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(store.placeAnswer(thread!.id, 'New text', 'replace')).toBe(true);
    expect(editor.state.doc.firstChild!.textContent).toBe('The New text is due');

    await store.deleteThread(thread!.id);
    expect(fake.callsTo('ai:deleteThread')).toHaveLength(1);
    expect(markedThreads(editor.state.doc).size).toBe(0);
  });

  it('without a selection Ask AI says so in its own words; a refused action keeps the panel with the reason', async () => {
    const { fake, editor, store, notices } = setup();
    store.startAi();
    expect(notices).toEqual([AI_MESSAGES.selectText]);
    selectWord(editor, 'budget');
    store.startAi();
    fake.failNext('ai:ask', { code: 'FORBIDDEN', message: AI_MESSAGES.locked });
    expect(await store.submitAi(choices)).toMatchObject({ ok: false, message: AI_MESSAGES.locked });
    expect(store.store.getState().aiDraft).not.toBeNull();
    store.cancelAi();
    expect(commentMarksKey.getState(editor.state)!.pending).toBeNull();
  });
});

describe('the Ask AI panel and AI threads in the Comments section (D-190)', () => {
  async function render(setupFake?: (fake: FakeBridge) => void) {
    const fake = createFakeBridge();
    setupFake?.(fake);
    const services = createAppServices(fake.bridge, { themeEnv: null, lifecycle: null });
    await services.ready;
    const handle = new EditorHandle();
    const { editor } = makeEditor({ content });
    handle.attach(editor);
    services.comments.register(createNoteCommentHost(NOTE, handle));
    await flush();
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
    selectWord(editor, 'budget');
    await act(async () => services.comments.startAi());
    await flush();
    return { fake, services, host, editor, unmount: () => act(async () => root.unmount()) };
  }

  it('the first action shows what is sent where, confirms it once and runs; the thread shows its AI badge and actions', async () => {
    const { fake, host, unmount } = await render((f) => {
      f.data.ai.files = [{ ref: { type: 'attachment', id: '33333333-3333-4333-8333-333333333333' }, name: 'minutes.txt', sizeBytes: 12, kind: 'text', problem: null }];
    });
    const dialog = host.querySelector('dialog.ask-ai-dialog')!;
    expect(dialog.querySelector('[role="note"]')?.textContent).toBe(aiNotice('claude-code'));
    expect(dialog.textContent).toContain('Runs on Claude Code (headless).');
    await click([...dialog.querySelectorAll('label.checkbox')].find((l) => l.textContent?.includes('minutes.txt'))!.querySelector('input'));
    await click([...dialog.querySelectorAll('label.checkbox')].find((l) => l.textContent?.includes('The whole note'))!.querySelector('input'));
    await click(button(dialog, 'Action items'));
    await flush();
    expect(fake.callsTo('ai:acknowledge')).toHaveLength(1);
    expect(fake.callsTo('ai:ask')[0]!.req).toMatchObject({ action: 'actionItems', wholeItem: true, files: [{ type: 'attachment', id: '33333333-3333-4333-8333-333333333333' }] });
    expect(host.querySelector('dialog.ask-ai-dialog')).toBeNull();
    const card = host.querySelector('.comment-thread.is-ai')!;
    expect(card.querySelector('.ai-badge')?.textContent).toBe('AI');
    expect([...card.querySelectorAll('.ai-speaker')].map((s) => s.textContent)).toEqual(['You', 'Claude Code']);
    expect(card.textContent).toContain('The fake answer');
    for (const label of ['Insert below', 'Replace selection', 'Copy', 'Delete thread']) expect(button(card, label), label).toBeTruthy();
    expect(host.textContent).toContain('AI (1)');
    expect(host.textContent).toContain('Comments (0)');
    await unmount();
  });

  it('a follow-up continues the thread; the AI filter lists only AI threads', async () => {
    const { services, host, unmount } = await render();
    await click(button(host.querySelector('dialog.ask-ai-dialog')!, 'Explain'));
    await flush();
    const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Follow-up question"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(field, 'Tell me more');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button(host.querySelector('.comment-thread.is-ai')!, 'Ask'));
    await flush();
    expect([...host.querySelectorAll('.ai-message .ai-body')].map((b) => b.textContent)).toEqual(['Explain', 'The fake answer', 'Tell me more', 'The fake answer']);
    await act(async () => services.comments.setKind('comment'));
    expect(host.querySelector('.comment-thread.is-ai')).toBeNull();
    await act(async () => services.comments.setKind('ai'));
    expect(host.querySelectorAll('.comment-thread.is-ai')).toHaveLength(1);
    await unmount();
  });

  it('while AI actions are off or not set up the panel says so and offers Settings', async () => {
    const off = await render((f) => {
      f.data.ai.status = { enabled: false, engine: 'claude-code', acknowledged: false, problem: null };
    });
    expect(off.host.querySelector('dialog.ask-ai-dialog')!.textContent).toContain(AI_MESSAGES.off);
    expect(button(off.host, 'Open Settings')).toBeTruthy();
    expect(button(off.host, 'Summarize')).toBeUndefined();
    await off.unmount();

    const noKey = await render((f) => {
      f.data.ai.status = { enabled: true, engine: 'openai-api', acknowledged: true, problem: AI_MESSAGES.noKey('OpenAI') };
    });
    const dialog = noKey.host.querySelector('dialog.ask-ai-dialog')!;
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(AI_MESSAGES.noKey('OpenAI'));
    expect(button(dialog, 'Summarize')).toBeUndefined();
    await noKey.unmount();
    document.body.innerHTML = '';
    const empty = await render();
    await act(async () => empty.services.comments.cancelAi());
    await act(async () => empty.services.comments.setKind('ai'));
    expect(empty.host.textContent).toContain(AI_EMPTY);
    await empty.unmount();
  });
});

describe('AI in a sticky window (D-190)', () => {
  it('asks on its own note, shows the thread, puts the answer into the text and deletes the thread', async () => {
    const fake = createFakeBridge();
    const handle = new EditorHandle();
    const { editor } = makeEditor({ content });
    handle.attach(editor);
    const notices: string[] = [];
    const ai = new StickyAi({ bridge: fake.bridge, noteId: NOTE, handle, notify: (m) => notices.push(m), enabled: () => true });
    ai.start();
    expect(notices).toEqual([AI_MESSAGES.selectText]);
    selectWord(editor, 'budget');
    ai.starter.start();
    expect(ai.store.getState().draft).toMatchObject({ quote: 'budget' });
    expect((await ai.submit({ action: 'custom', prompt: 'Is it late?', wholeItem: false, files: [], picked: null })).ok).toBe(true);
    expect(fake.callsTo('ai:ask')[0]!.req).toMatchObject({ target: { kind: 'note', id: NOTE }, prompt: 'Is it late?' });
    await flush();
    const thread = ai.store.getState().thread!;
    expect(thread.comments.map((c) => c.role)).toEqual(['user', 'assistant']);
    expect(commentMarksKey.getState(editor.state)!.ai.has(thread.id)).toBe(true);
    expect(ai.place('- yes', 'below')).toBe(true);
    expect(editor.getJSON().content!.map((b) => b.type)).toEqual(['paragraph', 'bulletList', 'paragraph']);
    expect((await ai.remove()).ok).toBe(true);
    expect(ai.store.getState().thread).toBeNull();
    expect(markedThreads(editor.state.doc).size).toBe(0);
  });
});
