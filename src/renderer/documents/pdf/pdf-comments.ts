import type { CommentAnchorType } from '../../../shared/comments/anchors';
import { COMMENT_MESSAGES, MAX_COMMENT_QUOTE, type CommentThreadDtoType } from '../../../shared/contracts/comments';

/** An area of a page as fractions of its width and height (D-165). */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Point = [number, number];

/** A point of the unrotated page as it shows with the view rotated clockwise by `rotation` degrees, and back. */
function pageToViewPoint([x, y]: Point, rotation: number): Point {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [1 - y, x];
    case 180:
      return [1 - x, 1 - y];
    case 270:
      return [y, 1 - x];
    default:
      return [x, y];
  }
}

function viewToPagePoint([u, v]: Point, rotation: number): Point {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [v, 1 - u];
    case 180:
      return [1 - u, 1 - v];
    case 270:
      return [1 - v, u];
    default:
      return [u, v];
  }
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

function mapRect(rect: PageRect, map: (p: Point) => Point): PageRect {
  const [ax, ay] = map([rect.x, rect.y]);
  const [bx, by] = map([rect.x + rect.width, rect.y + rect.height]);
  const x = clamp(Math.min(ax, bx));
  const y = clamp(Math.min(ay, by));
  return { x, y, width: clamp(Math.max(ax, bx)) - x, height: clamp(Math.max(ay, by)) - y };
}

/** Comment areas are stored on the unrotated page, so rotating the view does not move them. */
export const viewToPage = (rect: PageRect, rotation: number): PageRect => mapRect(rect, (p) => viewToPagePoint(p, rotation));
export const pageToView = (rect: PageRect, rotation: number): PageRect => mapRect(rect, (p) => pageToViewPoint(p, rotation));

/** The page element holding a DOM node (pdf.js marks pages with `data-page-number`). */
function pageOf(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>('.page[data-page-number]') ?? null;
}

/**
 * The anchor of a new PDF comment: the selected text on one page (its area and text) or, without a selection, the page
 * shown (the whole page).
 */
export function pdfCommentAnchor(container: HTMLElement, currentPage: number, rotation: number): { anchor: CommentAnchorType; quote: string } | { error: string } {
  if (currentPage < 1) return { error: COMMENT_MESSAGES.notReady };
  const selection = container.ownerDocument.getSelection();
  const range = selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const page = range ? pageOf(range.startContainer) : null;
  if (!range || !page || !container.contains(page) || pageOf(range.endContainer) !== page) {
    return { anchor: { type: 'pdf', page: currentPage, rect: null }, quote: '' };
  }
  const box = page.getBoundingClientRect();
  const r = range.getBoundingClientRect();
  const quote = range.toString().replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT_QUOTE);
  const pageNumber = Number(page.dataset.pageNumber);
  if (box.width <= 0 || box.height <= 0 || r.width <= 0) return { anchor: { type: 'pdf', page: pageNumber, rect: null }, quote };
  const rect = viewToPage({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, width: r.width / box.width, height: r.height / box.height }, rotation);
  return { anchor: { type: 'pdf', page: pageNumber, rect }, quote };
}

const MARKER_ATTR = 'data-comment-marker';

/**
 * Comment markers over the pages of a PDF (D-165): a numbered marker at the top right of each thread's area (or of its
 * page) and the area outlined. pdf.js redraws pages as they scroll into view and when the zoom or rotation changes, so
 * markers are added again to each page it draws.
 */
export class PdfCommentMarkers {
  private threads: readonly CommentThreadDtoType[] = [];
  private activeId: string | null = null;
  private select: (threadId: string) => void = () => undefined;

  constructor(private readonly pages: { pageElement(page: number): HTMLElement | null; rotation(): number }) {}

  set(threads: readonly CommentThreadDtoType[], activeId: string | null, select: (threadId: string) => void): void {
    const before = new Set(this.threads.flatMap((t) => (t.anchor.type === 'pdf' ? [t.anchor.page] : [])));
    this.threads = threads.filter((t) => t.resolvedAt === null);
    this.activeId = activeId;
    this.select = select;
    const pages = new Set([...before, ...this.threads.flatMap((t) => (t.anchor.type === 'pdf' ? [t.anchor.page] : []))]);
    for (const page of pages) this.draw(page);
  }

  /** Puts the markers of one page (again) on its element. */
  draw(page: number): void {
    const el = this.pages.pageElement(page);
    if (!el) return;
    for (const old of el.querySelectorAll(`[${MARKER_ATTR}]`)) old.remove();
    const rotation = this.pages.rotation();
    this.threads.forEach((thread, i) => {
      const { anchor } = thread;
      if (anchor.type !== 'pdf' || anchor.page !== page) return;
      const rect = anchor.rect ? pageToView(anchor.rect, rotation) : null;
      if (rect) {
        const area = el.ownerDocument.createElement('div');
        area.className = 'comment-area';
        area.setAttribute(MARKER_ATTR, thread.id);
        Object.assign(area.style, { left: pct(rect.x), top: pct(rect.y), width: pct(rect.width), height: pct(rect.height) });
        el.appendChild(area);
      }
      const marker = el.ownerDocument.createElement('button');
      marker.type = 'button';
      marker.className = `comment-marker${thread.id === this.activeId ? ' is-active' : ''}`;
      marker.setAttribute(MARKER_ATTR, thread.id);
      marker.setAttribute('aria-label', `Comment ${i + 1}: ${thread.comments[0]?.body.slice(0, 80) ?? ''}`);
      marker.title = thread.comments[0]?.body.slice(0, 200) ?? '';
      marker.textContent = String(i + 1);
      Object.assign(marker.style, rect ? { left: `calc(${pct(rect.x + rect.width)} - 10px)`, top: `calc(${pct(rect.y)} - 22px)` } : { right: '6px', top: '6px' });
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(thread.id);
      });
      el.appendChild(marker);
    });
  }
}

const pct = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;
