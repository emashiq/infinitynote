// @vitest-environment jsdom
import { importDocx, exportProblems, type ExportProblem } from '@portone/docx-editor/core';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import DocxViewer from '../../../src/renderer/documents/docx/DocxViewer';
import { exportForSave } from '../../../src/renderer/documents/docx/docx-export';
import { findMatches, MAX_FIND_MATCHES, stepIndex } from '../../../src/renderer/documents/docx/docx-find';
import { canPreview, DOCX_IMPORT_MESSAGES, DOCX_MESSAGES, exportProblemMessage, hasPlaceholders } from '../../../src/renderer/documents/docx/docx-messages';
import type { DocumentViewerHost, DocumentViewerProps } from '../../../src/renderer/documents/viewer-registry';
import type { DocumentDtoType } from '../../../src/shared/contracts/hierarchy';
import type { DocumentTargetType } from '../../../src/shared/documents/targets';
import { documentFixture } from './support/fixtures';

const rich = () => documentFixture('sample-rich.docx');

const DOCUMENT: DocumentDtoType = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: null,
  folderId: null,
  title: 'Handbook',
  kind: 'docx',
  storage: 'managed',
  revision: 0,
  sizeBytes: 4861,
  favorite: false,
  createdAt: 0,
  updatedAt: 0,
} as DocumentDtoType;

function fakeHost(overrides: Partial<DocumentViewerHost> = {}) {
  const saves: Uint8Array[] = [];
  const notices: Array<{ message: string; tone?: string }> = [];
  const unsaved: Array<(() => Promise<boolean>) | null> = [];
  const host: DocumentViewerHost = {
    notify: (message, tone) => void notices.push({ message, tone }),
    copyText: async () => true,
    save: async (bytes) => {
      saves.push(bytes);
      return true;
    },
    setUnsaved: (flush) => void unsaved.push(flush),
    comments: () => () => undefined,
    pickPdf: async () => null,
    createBeside: async () => null,
    readWorkbook: async () => ({ ok: false, message: 'not a workbook' }),
    saveWorkbook: async () => false,
    ...overrides,
  };
  return { host, saves, notices, unsaved };
}

let root: Root | null = null;
let container: HTMLElement | null = null;
/** Every ProseMirror view's plugin update, so a test can reach the editor's view (the viewer keeps it to itself). */
const viewUpdates = vi.spyOn(EditorView.prototype as unknown as { updatePluginViews(...args: unknown[]): void }, 'updatePluginViews');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  viewUpdates.mockClear();
  vi.unstubAllGlobals();
});

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

/** Mounts the viewer on bytes served by a stubbed document protocol. */
async function mount(bytes: Uint8Array, props: Partial<DocumentViewerProps> = {}, host = fakeHost()) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes as BodyInit)));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const render = (p: Partial<DocumentViewerProps>) =>
    act(() =>
      root!.render(
        <DocxViewer document={DOCUMENT} sourceUrl={`infinity-document://${DOCUMENT.id}/?rev=0`} host={host.host} target={null} findRequests={0} readOnly={false} {...props} {...p} />,
      ),
    );
  render({});
  await settle();
  const sheet = () => container!.querySelector<HTMLElement>('.docx-editor-sheet');
  return { ...host, el: container, sheet, rerender: render };
}

/** The ProseMirror view behind the page. */
function viewOf(sheet: HTMLElement | null): EditorView {
  const view = (viewUpdates.mock.contexts as unknown as EditorView[]).find((v) => v.dom === sheet);
  if (!view) throw new Error('no editor view');
  return view;
}

const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

describe('Word viewer and editor (F4, D-142)', () => {
  it('opens the document on its page with the editor toolbar, labelled for screen readers', async () => {
    const { el, sheet } = await mount(rich());
    expect(sheet()?.textContent).toContain('Project handbook');
    expect(sheet()?.getAttribute('aria-label')).toBe('Handbook (Word document)');
    expect(el.querySelector('[role="toolbar"][aria-label="Editor toolbar"]')).not.toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('edits mark the tab unsaved; Save writes the edit into the package and the next edit is unsaved again', async () => {
    const { el, sheet, saves, unsaved } = await mount(rich());
    const view = viewOf(sheet());
    await act(async () => view.dispatch(view.state.tr.insertText('Edited ', 1)));
    expect(el.querySelector('.save-status')?.textContent).toBe('Unsaved changes');
    expect(unsaved.at(-1)).toBeTypeOf('function');
    await act(async () => void (await unsaved.at(-1)!()));
    expect(saves).toHaveLength(1);
    const reopened = importDocx(saves[0]!);
    expect(reopened.doc.child(0).textContent).toBe('Edited Project handbook');
    expect(el.querySelector('.save-status')?.textContent).toBe('');
    expect(unsaved.at(-1)).toBeNull();
  });

  it('Ctrl+S saves; a refused save keeps the edits unsaved', async () => {
    let accept = false;
    const host = fakeHost({ save: async () => accept });
    const { el, sheet } = await mount(rich(), {}, host);
    const view = viewOf(sheet());
    await act(async () => view.dispatch(view.state.tr.insertText('x', 1)));
    const ctrlS = () => el.querySelector('.docx-viewer')!.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    await act(async () => void ctrlS());
    await settle(2);
    expect(el.querySelector('.save-status')?.textContent).toBe('Unsaved changes');
    accept = true;
    await act(async () => void ctrlS());
    await settle(2);
    expect(el.querySelector('.save-status')?.textContent).toBe('');
  });

  it('read-only versions have no editing toolbar, no Save, a zoom choice, and never register unsaved edits', async () => {
    const { el, unsaved } = await mount(rich(), { readOnly: true });
    expect(el.querySelector('[aria-label="Editor toolbar"]')).toBeNull();
    expect(button(el, 'Save')).toBeUndefined();
    expect(button(el, 'Page break')).toBeUndefined();
    expect(el.querySelector('select[aria-label="Zoom"]')).not.toBeNull();
    expect(el.querySelector('.save-status')?.textContent).toBe('Read-only');
    expect(unsaved.every((flush) => flush === null)).toBe(true);
  });

  it('Ctrl+K in the page is left to the app search: the editor opens no link panel', async () => {
    const { el, sheet } = await mount(rich());
    const view = viewOf(sheet());
    await act(async () => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8))));
    const ctrlK = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    // The key handlers run in plugin order, as ProseMirror runs them for a key press in the page.
    await act(async () => void view.someProp('handleKeyDown', (handle) => handle(view, ctrlK)));
    expect(el.querySelector('.docx-editor-link-panel')).toBeNull();
    expect(view.state.selection.from).toBe(1);
  });

  it('inserts a page break from the toolbar', async () => {
    const { el, sheet } = await mount(rich());
    const view = viewOf(sheet());
    await act(async () => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5))));
    const breaks = () => {
      let n = 0;
      view.state.doc.descendants((node) => void (node.type.name === 'hardBreak' && (n += 1)));
      return n;
    };
    const before = breaks();
    await act(async () => button(el, 'Page break')!.click());
    expect(breaks()).toBe(before + 1);
  });

  it('finds text with the app find bar: count, next, previous, and the match is selected', async () => {
    const { el, sheet, rerender } = await mount(rich());
    rerender({ findRequests: 1 });
    await settle(2);
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Find in document"]')!;
    const type = async (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await type('handbook');
    await settle(2);
    const count = () => el.querySelector('.document-find-count')?.textContent;
    // Body only: the title, two sentences; the header is its own story.
    expect(count()).toBe('1 of 3');
    expect(el.querySelectorAll('.docx-find-match')).toHaveLength(3);
    const view = viewOf(sheet());
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('handbook');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(count()).toBe('2 of 3');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })));
    expect(count()).toBe('1 of 3');
    await type('nothing like this');
    expect(count()).toBe(DOCX_MESSAGES.noMatches);
  });

  it('opens at a heading or a paragraph a link names, and says when there is none (D-146)', async () => {
    const { sheet, rerender, notices } = await mount(rich());
    const view = viewOf(sheet());
    const go = async (target: DocumentTargetType, seq: number) => {
      rerender({ target: { target, seq } });
      await settle(2);
    };
    await go({ heading: '  appendix ' }, 1);
    expect(view.state.selection.$from.parent.textContent).toBe('Appendix');
    await go({ paragraph: 3 }, 2);
    expect(view.state.selection.$from.parent.textContent).toBe('Plan the week');
    // A paragraph with the text of a heading is not a heading.
    await go({ heading: 'Last paragraph of the handbook.' }, 3);
    expect(notices.at(-1)).toEqual({ message: DOCX_MESSAGES.headingMissing('Last paragraph of the handbook.'), tone: 'error' });
    await go({ paragraph: 999 }, 4);
    expect(notices.at(-1)?.message).toBe(DOCX_MESSAGES.paragraphMissing(999));
  });

  it('a file the editor cannot open shows why and opens read-only, without an editor', async () => {
    const { el } = await mount(new TextEncoder().encode('not a zip at all'));
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(DOCX_IMPORT_MESSAGES['not-a-docx']);
    expect(el.querySelector('.docx-editor-sheet')).toBeNull();
    expect(button(el, 'Save')?.disabled).toBe(true);
  });

  it('a Strict Open XML file opens read-only with the reason and a preview drawn in a shadow root (D-144)', async () => {
    const parts = unzipSync(documentFixture('sample.docx'));
    const xml = strFromU8(parts['word/document.xml']!).replace('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main');
    const strict = zipSync({ ...parts, 'word/document.xml': strToU8(xml) });
    const { el } = await mount(strict);
    await settle(20);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(DOCX_IMPORT_MESSAGES['unsupported-conformance']);
    expect(el.querySelector('.docx-editor-sheet')).toBeNull();
    const preview = el.querySelector('.docx-preview');
    expect(preview?.shadowRoot?.textContent).toContain('Revenue grew by');
    // Nothing the file brings is placed in the app's own document.
    expect(document.head.querySelectorAll('style').length).toBe(0);
  });

  it('shows the comments of the document beside the page', async () => {
    const { el } = await mount(rich());
    expect(el.querySelector('.docx-editor-comments')?.textContent).toContain('Check this sentence');
    expect(el.querySelector('.docx-editor-comments')?.textContent).toContain('Reviewer');
  });

  it('says so when the bytes cannot be read at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root!.render(<DocxViewer document={DOCUMENT} sourceUrl="infinity-document://x/" host={fakeHost().host} target={null} findRequests={0} readOnly={false} />),
    );
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(DOCX_MESSAGES.unreadable);
  });
});

describe('Word helpers', () => {
  const doc = () => importDocx(rich()).doc;

  it('find: whole words, case, matches across runs but never across paragraphs, bounded', () => {
    expect(findMatches(doc(), 'the', { caseSensitive: false, wholeWord: true }).length).toBeGreaterThan(2);
    expect(findMatches(doc(), 'The', { caseSensitive: true, wholeWord: true })).toHaveLength(1);
    expect(findMatches(doc(), 'hand', { caseSensitive: false, wholeWord: true })).toHaveLength(0);
    expect(findMatches(doc(), 'stepsplan', { caseSensitive: false, wholeWord: false })).toHaveLength(0);
    expect(findMatches(doc(), 'a.b', { caseSensitive: false, wholeWord: false })).toHaveLength(0);
    expect(findMatches(doc(), '', { caseSensitive: false, wholeWord: false })).toEqual([]);
    const many = importDocx(rich()).doc;
    const state = EditorState.create({ doc: many });
    const long = state.apply(state.tr.insertText('e'.repeat(MAX_FIND_MATCHES + 50), 1)).doc;
    expect(findMatches(long, 'e', { caseSensitive: false, wholeWord: false })).toHaveLength(MAX_FIND_MATCHES);
    expect([stepIndex(3, 2, false), stepIndex(3, 0, true), stepIndex(0, 0, false), stepIndex(3, -1, true)]).toEqual([0, 2, -1, 2]);
  });

  it('save refuses what the editor could not write back, in words, and passes clean exports', () => {
    const { doc: d, session } = importDocx(rich());
    expect(exportProblems(d, session)).toEqual([]);
    const problem = { code: 'invalid-table', message: 'x', reason: { kind: 'vertical-merge-past-table', story: null } } as ExportProblem;
    expect(exportForSave({ exportProblems: () => [problem], exportBytes: () => new Uint8Array() })).toEqual({ ok: false, message: exportProblemMessage(problem) });
    expect(exportForSave({ exportProblems: () => [], exportBytes: () => new Uint8Array([1]) })).toEqual({ ok: true, bytes: new Uint8Array([1]) });
    expect(() => exportForSave({ exportProblems: () => [], exportBytes: () => { throw new TypeError('bug'); } })).toThrow('bug');
  });

  it('messages: every import code has words; only readable packages get a preview; placeholders are noticed', () => {
    expect(Object.values(DOCX_IMPORT_MESSAGES).every((m) => m.length > 10)).toBe(true);
    expect(['not-a-docx', 'too-large', 'no-xml-parser'].some((code) => canPreview(code as never))).toBe(false);
    expect(canPreview('unsupported-content')).toBe(true);
    expect(hasPlaceholders([{ severity: 'approximated', code: 'paragraph-demoted', part: null, block: 0, pos: 0, element: 'w:p' }])).toBe(false);
    expect(hasPlaceholders([{ severity: 'placeholder', code: 'preserved-block', part: null, block: 0, pos: 0, element: 'w:sdt' }])).toBe(true);
  });
});
