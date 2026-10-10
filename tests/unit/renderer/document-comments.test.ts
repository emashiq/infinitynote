// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { anchorTarget, createDocumentCommentHost } from '../../../src/renderer/comments/document-comment-host';
import { CommentsStore } from '../../../src/renderer/comments/comments-store';
import { occurrenceAt, occurrenceStart, rangeOf, textOffset } from '../../../src/renderer/documents/html/source-anchors';
import { PdfCommentMarkers, pageToView, pdfCommentAnchor, viewToPage } from '../../../src/renderer/documents/pdf/pdf-comments';
import { COMMENT_MESSAGES, type CommentThreadDtoType } from '../../../src/shared/contracts/comments';
import { createFakeBridge } from './support/fake-bridge';

const DOC = '33333333-3333-4333-8333-333333333333';
const flush = () => new Promise((r) => setTimeout(r, 0));

const thread = (id: string, anchor: CommentThreadDtoType['anchor'], resolved = false): CommentThreadDtoType => ({
  id,
  target: { kind: 'document', id: DOC },
  anchor,
  quote: '',
  resolvedAt: resolved ? 1 : null,
  createdAt: 1,
  updatedAt: 1,
  comments: [{ id: `${id.slice(0, 35)}9`, body: 'Look here', createdAt: 1, updatedAt: 1 }],
});

describe('document comment anchors (D-165)', () => {
  it('opens the document at the anchor’s place like a link', () => {
    expect(anchorTarget({ type: 'pdf', page: 3, rect: null })).toEqual({ page: 3 });
    expect(anchorTarget({ type: 'cell', sheet: 'Budget', row: 1, col: 2 })).toEqual({ sheet: 'Budget', row: 1, col: 2 });
    expect(anchorTarget({ type: 'slide', slide: 2, shapeId: '4' })).toEqual({ slide: 2 });
    expect(anchorTarget({ type: 'paragraph', paragraph: 5 })).toEqual({ paragraph: 5 });
    expect(anchorTarget({ type: 'quote', occurrence: 0 })).toBeNull();
  });

  it('a viewer’s anchors make a document comment host: new threads at its place, reveal through the place', async () => {
    const fake = createFakeBridge();
    const openAt = vi.fn();
    const shown = vi.fn();
    const store = new CommentsStore({ bridge: fake.bridge, notify: () => undefined, showPanel: () => undefined });
    store.register(
      createDocumentCommentHost({
        documentId: DOC,
        anchors: { current: () => ({ anchor: { type: 'cell', sheet: 'Budget', row: 0, col: 1 }, quote: '42' }), show: shown },
        openAt,
        select: (id) => store.select(id),
      }),
    );
    await flush();
    store.start();
    expect((await store.submitDraft('Is this final?')).ok).toBe(true);
    const [t] = store.store.getState().threads;
    expect(t).toMatchObject({ target: { kind: 'document', id: DOC }, anchor: { type: 'cell', sheet: 'Budget', row: 0, col: 1 }, quote: '42' });
    expect(shown).toHaveBeenLastCalledWith([t], t!.id, expect.any(Function));
    store.select(t!.id);
    expect(openAt).toHaveBeenCalledWith({ sheet: 'Budget', row: 0, col: 1 });
  });

  it('a viewer that cannot anchor says why', async () => {
    const notices: string[] = [];
    const store = new CommentsStore({ bridge: createFakeBridge().bridge, notify: (m) => notices.push(m), showPanel: () => undefined });
    store.register(createDocumentCommentHost({ documentId: DOC, anchors: { current: () => ({ error: COMMENT_MESSAGES.selectCell }) }, openAt: () => undefined, select: () => undefined }));
    store.start();
    expect(notices).toEqual([COMMENT_MESSAGES.selectCell]);
  });
});

describe('PDF comment areas and markers (D-165)', () => {
  it('areas are kept on the unrotated page, so turning the view does not move them', () => {
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
    for (const rotation of [0, 90, 180, 270]) {
      const back = viewToPage(pageToView(rect, rotation), rotation);
      expect(back.x).toBeCloseTo(rect.x);
      expect(back.y).toBeCloseTo(rect.y);
      expect(back.width).toBeCloseTo(rect.width);
      expect(back.height).toBeCloseTo(rect.height);
    }
    expect(pageToView(rect, 90)).toEqual({ x: expect.closeTo(0.7), y: expect.closeTo(0.1), width: expect.closeTo(0.1), height: expect.closeTo(0.3) });
  });

  it('without a selection the page shown is the anchor', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    expect(pdfCommentAnchor(container, 4, 0)).toEqual({ anchor: { type: 'pdf', page: 4, rect: null }, quote: '' });
    expect(pdfCommentAnchor(container, 0, 0)).toEqual({ error: COMMENT_MESSAGES.notReady });
  });

  it('draws a marker per open thread of a page, outlines its area, and a click selects the thread', () => {
    const page = document.createElement('div');
    page.className = 'page';
    page.dataset.pageNumber = '2';
    const markers = new PdfCommentMarkers({ pageElement: (n) => (n === 2 ? page : null), rotation: () => 0 });
    const select = vi.fn();
    const a = '44444444-4444-4444-8444-444444444444';
    const b = '55555555-5555-4555-8555-555555555555';
    markers.set(
      [thread(a, { type: 'pdf', page: 2, rect: { x: 0.5, y: 0.5, width: 0.2, height: 0.1 } }), thread(b, { type: 'pdf', page: 2, rect: null }, true)],
      a,
      select,
    );
    expect(page.querySelectorAll('.comment-marker')).toHaveLength(1);
    expect(page.querySelector<HTMLElement>('.comment-area')!.style.left).toBe('50%');
    expect(page.querySelector('.comment-marker')!.classList.contains('is-active')).toBe(true);
    page.querySelector<HTMLButtonElement>('.comment-marker')!.click();
    expect(select).toHaveBeenCalledWith(a);
    // Drawn again (pdf.js redrew the page), markers are not doubled.
    markers.draw(2);
    expect(page.querySelectorAll('.comment-marker')).toHaveLength(1);
    markers.set([], null, select);
    expect(page.querySelectorAll('[data-comment-marker]')).toHaveLength(0);
  });
});

describe('HTML source quotes (D-165)', () => {
  it('finds which occurrence was selected and selects it again', () => {
    const pre = document.createElement('pre');
    pre.innerHTML = '<span>&lt;p&gt;</span>Hello <b>world</b>, hello world<span>&lt;/p&gt;</span>';
    document.body.appendChild(pre);
    const text = pre.textContent!;
    const second = text.lastIndexOf('world');
    expect(occurrenceAt(text, 'world', second)).toBe(1);
    expect(occurrenceStart(text, 'world', 1)).toBe(second);
    expect(occurrenceStart(text, 'world', 2)).toBe(-1);
    const range = rangeOf(pre, second, second + 5)!;
    expect(range.toString()).toBe('world');
    expect(textOffset(pre, range.startContainer, range.startOffset)).toBe(second);
    const bold = pre.querySelector('b')!.firstChild!;
    expect(textOffset(pre, bold, 0)).toBe(text.indexOf('world'));
  });
});
