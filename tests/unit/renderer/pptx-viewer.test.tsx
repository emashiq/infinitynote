// @vitest-environment jsdom
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { presenterKey } from '../../../src/renderer/documents/pptx/PptxPresenter';
import PptxViewer from '../../../src/renderer/documents/pptx/PptxViewer';
import { PPTX_MESSAGES } from '../../../src/renderer/documents/pptx/pptx-messages';
import { moved, nudged, resized, snapped } from '../../../src/renderer/documents/pptx/stage-geometry';
import { asEdited, fillEditor, formatSelection, readEditor } from '../../../src/renderer/documents/pptx/text-edit';
import type { DocumentViewerHost, DocumentViewerProps } from '../../../src/renderer/documents/viewer-registry';
import type { DocumentDtoType } from '../../../src/shared/contracts/hierarchy';
import { DOCUMENT_VIEWERS } from '../../../src/renderer/documents/viewer-registry';
import { documentFixture } from './support/fixtures';

const rich = () => documentFixture('sample-rich.pptx');

const DOCUMENT: DocumentDtoType = {
  id: '22222222-2222-4222-8222-222222222222',
  projectId: null,
  folderId: null,
  title: 'Review deck',
  kind: 'pptx',
  storage: 'managed',
  revision: 0,
  sizeBytes: 11562,
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

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
});

const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
};

async function mount(bytes: Uint8Array, props: Partial<DocumentViewerProps> = {}, host = fakeHost()) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes as BodyInit)));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const render = (p: Partial<DocumentViewerProps>) =>
    act(() =>
      root!.render(<PptxViewer document={DOCUMENT} sourceUrl={`infinity-document://${DOCUMENT.id}/?rev=0`} host={host.host} target={null} findRequests={0} readOnly={false} {...props} {...p} />),
    );
  render({});
  await settle();
  return { ...host, el: container, rerender: render };
}

const button = (el: Element, label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;
const key = (target: Element, init: KeyboardEventInit) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
const thumbs = (el: Element) => [...el.querySelectorAll('[role="option"]')];
const currentSlide = (el: Element) => thumbs(el).findIndex((t) => t.getAttribute('aria-selected') === 'true');
const status = (el: Element) => el.querySelector('.save-status')?.textContent;
const slideNotesOf = (bytes: Uint8Array, part: string) => strFromU8(unzipSync(bytes)[part]!);

/** Types into a textarea the way React sees it. */
function typeInto(field: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('PowerPoint viewer and editor (F5)', () => {
  it('is the lazily loaded viewer for presentations', () => {
    expect(DOCUMENT_VIEWERS.pptx).toBeDefined();
  });

  it('opens with slide thumbnails, the first slide, its notes and what it does not show', async () => {
    const { el } = await mount(rich());
    expect(thumbs(el)).toHaveLength(3);
    expect(currentSlide(el)).toBe(0);
    expect(el.querySelector('[aria-roledescription="slide"]')?.getAttribute('aria-label')).toBe('Slide 1 of 3');
    expect(el.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Thank the team first');
    expect(el.querySelector('.pptx-banner')?.textContent).toBe(PPTX_MESSAGES.notShown(['transitions', 'charts (drawn simplified)']));
    await settle(20);
    expect(el.querySelector<HTMLImageElement>('.pptx-slide-image')?.src).toMatch(/^data:image\/svg\+xml/);
    expect(status(el)).toBe('');
  });

  it('edits speaker notes, shows unsaved changes and saves them with Ctrl+S', async () => {
    const { el, saves, unsaved } = await mount(rich());
    const notes = el.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => typeInto(notes, 'Thank everyone'));
    expect(status(el)).toBe('Unsaved changes');
    expect(unsaved.at(-1)).toBeTypeOf('function');
    await key(el.querySelector('.pptx-viewer')!, { key: 's', ctrlKey: true });
    await settle(2);
    expect(saves).toHaveLength(1);
    expect(slideNotesOf(saves[0]!, 'ppt/notesSlides/notesSlide1.xml')).toContain('<a:t>Thank everyone</a:t>');
    expect(status(el)).toBe('');
    expect(unsaved.at(-1)).toBeNull();
  });

  it('selects, nudges and deletes a drawing with the keyboard, and undoes it', async () => {
    const { el, unsaved } = await mount(rich());
    const slide = el.querySelector<HTMLElement>('[aria-roledescription="slide"]')!;
    await key(slide, { key: 'Tab' });
    expect(slide.getAttribute('aria-label')).toBe('Slide 1 of 3, title 2 selected');
    const before = el.querySelector<HTMLElement>('[data-shape-id="2"]')!.style.left;
    await key(slide, { key: 'ArrowRight' });
    expect(el.querySelector<HTMLElement>('[data-shape-id="2"]')!.style.left).not.toBe(before);
    expect(status(el)).toBe('Unsaved changes');
    await key(slide, { key: 'Tab' });
    await key(slide, { key: 'Tab' });
    await key(slide, { key: 'Delete' });
    expect(el.querySelector('[data-shape-id="4"]')).toBeNull();
    await key(slide, { key: 'z', ctrlKey: true });
    expect(el.querySelector('[data-shape-id="4"]')).not.toBeNull();
    await act(async () => void (await unsaved.at(-1)!()));
  });

  it('edits text in place keeping the run formatting', async () => {
    const { el, saves } = await mount(rich());
    const slide = el.querySelector<HTMLElement>('[aria-roledescription="slide"]')!;
    await key(slide, { key: 'Tab' });
    await key(slide, { key: 'Tab' });
    await key(slide, { key: 'Enter' });
    const editor = el.querySelector<HTMLElement>('.pptx-text-editor')!;
    expect(editor.getAttribute('aria-label')).toBe('Text of body 3');
    expect(editor.textContent).toBe('Revenue grew strongly this quarter');
    const bold = editor.querySelector<HTMLElement>('span[data-i="1"]')!;
    expect(bold.style.fontWeight).toBe('700');
    bold.textContent = 'sharply';
    await key(editor, { key: 'Escape' });
    expect(el.querySelector('.pptx-text-editor')).toBeNull();
    await act(async () => void button(el, 'Save').click());
    await settle(2);
    const xml = slideNotesOf(saves[0]!, 'ppt/slides/slide1.xml');
    expect(xml).toContain('<a:rPr lang="en-US" b="1"/><a:t>sharply</a:t>');
    expect(xml).toContain('<a:t>Revenue grew </a:t>');
  });

  it('adds, duplicates and deletes slides from the toolbar and moves them with Alt+arrows', async () => {
    const { el } = await mount(rich());
    await act(async () => void button(el, 'New slide').click());
    expect(thumbs(el)).toHaveLength(4);
    expect(currentSlide(el)).toBe(1);
    await act(async () => void button(el, 'Duplicate slide').click());
    expect(thumbs(el)).toHaveLength(5);
    await act(async () => void button(el, 'Delete slide').click());
    await act(async () => void button(el, 'Delete slide').click());
    expect(thumbs(el)).toHaveLength(3);
    const list = el.querySelector('[role="listbox"]')!;
    await key(list, { key: 'Home' });
    await key(list, { key: 'ArrowDown', altKey: true });
    expect(currentSlide(el)).toBe(1);
    expect(el.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Thank the team first');
  });

  it('presents from the slide shown: keys step, Esc returns to that slide', async () => {
    const { el } = await mount(rich());
    await key(el.querySelector('.pptx-viewer')!, { key: 'F5' });
    const show = el.querySelector<HTMLElement>('[role="dialog"][aria-label="Presentation"]')!;
    expect(show.querySelector('[role="status"]')?.textContent).toBe('1 / 3');
    await key(show, { key: 'ArrowRight' });
    await key(show, { key: ' ' });
    await key(show, { key: 'PageDown' });
    expect(show.querySelector('[role="status"]')?.textContent).toBe('3 / 3');
    await key(show, { key: 'PageUp' });
    await key(show, { key: 'Escape' });
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(currentSlide(el)).toBe(1);
  });

  it('finds text across slides and notes and opens the slide of a match', async () => {
    const { el, rerender } = await mount(rich());
    rerender({ findRequests: 1 });
    const field = el.querySelector<HTMLInputElement>('input[aria-label="Find in presentation"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'timeline');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(2);
    expect(el.querySelector('.document-find-count')?.textContent).toBe('1 of 1');
    expect(currentSlide(el)).toBe(1);
    expect(el.querySelector('.pptx-notes-hit')).not.toBeNull();
  });

  it('opens at a linked slide and says when there is no such slide', async () => {
    const { el, notices, rerender } = await mount(rich(), { target: { target: { slide: 3 }, seq: 1 } });
    expect(currentSlide(el)).toBe(2);
    rerender({ target: { target: { slide: 9 }, seq: 2 } });
    expect(notices.at(-1)).toEqual({ message: PPTX_MESSAGES.noSlide(9), tone: 'error' });
  });

  it('shows a version read-only: no editing tools, no Save, notes cannot be typed in', async () => {
    const { el, unsaved } = await mount(rich(), { readOnly: true });
    expect(status(el)).toBe('Read-only');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent?.includes('Save'))).toBe(false);
    expect(el.querySelector('button[aria-label="New slide"]')).toBeNull();
    expect(el.querySelector<HTMLTextAreaElement>('textarea')?.readOnly).toBe(true);
    expect(button(el, 'Present')).toBeDefined();
    expect(unsaved.every((u) => u === null)).toBe(true);
  });

  it('refuses a macro-enabled presentation and an unreadable file', async () => {
    const parts = unzipSync(rich());
    parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']!).replace('presentation.main+xml', 'presentation.macroEnabled.main+xml'));
    const { el } = await mount(zipSync(parts));
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(PPTX_MESSAGES.refused.macros);
    act(() => root?.unmount());
    const second = await mount(strToU8('not a zip'));
    expect(second.el.querySelector('[role="alert"]')?.textContent).toContain(PPTX_MESSAGES.refused.notPresentation);
  });
});

describe('presentation editor helpers (D-151)', () => {
  it('presentation keys', () => {
    expect(presenterKey('ArrowRight', 0, 3)).toBe(1);
    expect(presenterKey('Enter', 2, 3)).toBe(2);
    expect(presenterKey('Backspace', 0, 3)).toBe(0);
    expect(presenterKey('End', 0, 3)).toBe(2);
    expect(presenterKey('Escape', 1, 3)).toBe('exit');
    expect(presenterKey('x', 1, 3)).toBeNull();
  });

  it('moves, resizes, nudges and snaps boxes', () => {
    const box = { offsetX: 100_000, offsetY: 100_000, width: 200_000, height: 100_000 };
    expect(moved(box, 5, -5)).toEqual({ ...box, offsetX: 100_005, offsetY: 99_995 });
    expect(resized(box, 'nw', 50_000, 50_000)).toEqual({ offsetX: 150_000, offsetY: 150_000, width: 150_000, height: 50_000 });
    expect(resized(box, 'e', -1_000_000, 0).width).toBe(19_050);
    expect(nudged(box, 'ArrowDown', 10, false)).toEqual({ ...box, offsetY: 100_010 });
    expect(nudged(box, 'ArrowRight', 10, true)).toEqual({ ...box, width: 200_010 });
    expect(nudged(box, 'a', 10, false)).toBeNull();
    // The box's center comes within the tolerance of the slide's center and lines up with it.
    const slide = { width: 1_000_000, height: 600_000 };
    expect(snapped({ ...box, offsetX: 395_000 }, slide, 10_000).offsetX).toBe(400_000);
    expect(snapped({ ...box, offsetX: 380_000 }, slide, 10_000).offsetX).toBe(380_000);
  });

  it('the text editor reads back what it was filled with, and formats a selection as its own run', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const paragraphs = [
      { items: [{ kind: 'run' as const, text: 'Plain ', format: {} }, { kind: 'run' as const, text: 'bold', format: { bold: true } }, { kind: 'break' as const }, { kind: 'field' as const, text: '3' }] },
      { items: [] },
    ];
    fillEditor(root, paragraphs, { pxPerPt: 1, defaultSizePt: 18 });
    expect(readEditor(root)).toEqual(asEdited(paragraphs));
    // Enter in Chromium splits a block, copying its attributes and those of the run it splits.
    const second = root.firstElementChild!.cloneNode(false) as HTMLElement;
    const run = root.querySelector('span[data-i="0"]')!.cloneNode(false) as HTMLElement;
    run.textContent = 'Next';
    second.appendChild(run);
    root.insertBefore(second, root.children[1]!);
    const range = document.createRange();
    const plain = root.querySelector('span[data-i="0"]')!.firstChild!;
    range.setStart(plain, 0);
    range.setEnd(plain, 5);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    formatSelection(root, { italic: true }, () => ({}));
    const edited = readEditor(root);
    expect(edited[0]!.items.slice(0, 2)).toEqual([
      { kind: 'run', text: 'Plain', source: { paragraph: 0, item: 0 }, format: { italic: true } },
      { kind: 'run', text: ' ', source: { paragraph: 0, item: 0 }, format: {} },
    ]);
    expect(edited[1]).toEqual({ source: 0, items: [{ kind: 'run', text: 'Next', source: { paragraph: 0, item: 0 }, format: {} }] });
    expect(edited[2]).toEqual({ source: 1, items: [] });
    root.remove();
  });
});
