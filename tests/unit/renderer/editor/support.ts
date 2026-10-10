import { Editor, type Content } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach } from 'vitest';
import { plainExtensions, richExtensions } from '../../../../src/renderer/editor/extensions';
import type { LinkRequest } from '../../../../src/renderer/editor/link-trigger';
import { createPasteProps } from '../../../../src/renderer/editor/paste';
import { AttachmentUploader, type UploaderDeps } from '../../../../src/renderer/editor/uploader';
import { LINK_MESSAGES } from '../../../../src/shared/attachments/link-messages';
import { fail, ok } from '../../../../src/shared/contracts/envelope';

const editors: Editor[] = [];
const roots: Root[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = '';
});

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface TestEditor {
  editor: Editor;
  uploader: AttachmentUploader;
  notices: string[];
  /** Every onUpdate transaction, for the "is this a user edit" checks. */
  updates: import('@tiptap/pm/state').Transaction[];
  /** Reminder ids of clicked chips. */
  chipClicks: string[];
}

/** A real Tiptap editor in jsdom with the production extensions and paste handling. */
export function makeEditor(
  opts: { format?: 'rich' | 'plain'; content?: Content; uploader?: Partial<UploaderDeps>; flushPending?: () => Promise<unknown>; requestLink?: (request: LinkRequest) => boolean; startComment?: () => boolean } = {},
): TestEditor {
  const format = opts.format ?? 'rich';
  const notices: string[] = [];
  const updates: TestEditor['updates'] = [];
  const chipClicks: string[] = [];
  const uploader = new AttachmentUploader({
    importBytes: async (req) =>
      ok({ attachment: { id: crypto.randomUUID(), kind: req.kind, mime: 'image/png', sizeBytes: req.bytes.byteLength, originalName: req.originalName ?? null, width: 4, height: 3 } }),
    // jsdom files are never on disk, like a File made by page script (D-115).
    isOnDisk: () => false,
    linkFile: async () => fail('VALIDATION_FAILED', LINK_MESSAGES.noPath),
    prefs: () => ({ imageMaxMb: 20, documentMaxMb: 25, addFiles: 'ask' }),
    notify: (m) => notices.push(m),
    chooseFiles: async () => null,
    rememberChoice: () => undefined,
    ...opts.uploader,
  });
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: format === 'rich' ? richExtensions({ uploader, notify: (m) => notices.push(m), files: null, links: null, references: null, requestLink: opts.requestLink ?? (() => false), startComment: opts.startComment ?? null }) : plainExtensions(),
    content: opts.content ?? null,
    enableContentCheck: true,
    editorProps: createPasteProps({ format, uploader, notify: (m) => notices.push(m), flushPending: opts.flushPending ?? (async () => {}) }),
    onUpdate: ({ transaction }) => updates.push(transaction),
  });
  uploader.bind(editor);
  editor.view.dom.addEventListener('reminder-chip', (e) => chipClicks.push((e as CustomEvent<string>).detail));
  editors.push(editor);
  return { editor, uploader, notices, updates, chipClicks };
}

/** Block IDs in document order with the node type. */
export function blockIds(editor: Editor): Array<{ type: string; id: string | null; text: string }> {
  const out: Array<{ type: string; id: string | null; text: string }> = [];
  editor.state.doc.descendants((node) => {
    if ('id' in node.attrs) out.push({ type: node.type.name, id: node.attrs.id as string | null, text: node.textContent });
  });
  return out;
}

/** Pastes HTML through ProseMirror's real clipboard parser (jsdom has no ClipboardEvent). */
export function pasteHtml(editor: Editor, html: string): void {
  editor.view.pasteHTML(html, new window.Event('paste') as ClipboardEvent);
}

/**
 * Dispatches a paste event on the editor DOM, so ProseMirror runs its real paste path (handlePaste, then
 * transformPastedHTML and the schema parser). jsdom has no ClipboardEvent, so clipboardData is attached.
 */
export function pasteEvent(editor: Editor, data: { text?: string; html?: string; files?: File[] }): Event {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  const clipboardData = {
    files: data.files ?? [],
    types: [...(data.text !== undefined ? ['text/plain'] : []), ...(data.html !== undefined ? ['text/html'] : [])],
    getData: (type: string) => (type === 'text/plain' ? (data.text ?? '') : type === 'text/html' ? (data.html ?? '') : ''),
  };
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  editor.view.dom.dispatchEvent(event);
  return event;
}

export const tick = () => new Promise((r) => setTimeout(r, 0));

/** makeEditor shown through React's EditorContent, so React node views (code blocks, diagrams, math, chips) render. */
export async function mountEditor(opts: Parameters<typeof makeEditor>[0] = {}): Promise<TestEditor> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const made = makeEditor(opts);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(EditorContent, { editor: made.editor })));
  roots.push(root);
  return made;
}
