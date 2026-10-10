import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import type { PageSelection, SelectMode } from './page-selection';

const THUMB_WIDTH = 120;
/** The drag data type of a thumbnail, so drops from elsewhere are ignored. */
const DRAG_TYPE = 'application/x-infinity-pdf-page';

export interface PdfThumbnailsProps {
  pdf: PDFDocumentProxy;
  /** Changes when a new document is loaded into the same tab. */
  generation: number;
  pageCount: number;
  /** The page in view, 1-based. */
  currentPage: number;
  rotation: number;
  selection: PageSelection;
  onSelect(index: number, mode: SelectMode): void;
  onOpenPage(page: number): void;
  /** Moves the selected pages one step (Alt+Up/Down). */
  onStep(step: -1 | 1): void;
  /** A thumbnail dropped before `slot` (0-based; `pageCount` = after the last). */
  onDrop(from: number, slot: number): void;
}

/**
 * Page thumbnails (F2, D-131): a list box of pages that renders each page when it scrolls into view. Click, Ctrl+click
 * and Shift+click select; arrows move the focus, Enter shows the page, Space selects, Alt+Up/Down move the selected
 * pages; thumbnails can be dragged to a new place.
 */
export function PdfThumbnails(props: PdfThumbnailsProps) {
  const { pageCount, currentPage } = props;
  const [focus, setFocus] = useState(currentPage - 1);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const focusIndex = Math.min(focus, pageCount - 1);

  const moveFocus = (index: number) => {
    const next = Math.max(0, Math.min(pageCount - 1, index));
    setFocus(next);
    list.current?.querySelector<HTMLElement>(`[data-page-index="${next}"]`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      props.onStep(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    const moves: Record<string, number> = { ArrowUp: focusIndex - 1, ArrowDown: focusIndex + 1, Home: 0, End: pageCount - 1 };
    if (e.key in moves) {
      e.preventDefault();
      moveFocus(moves[e.key]!);
      if (e.shiftKey) props.onSelect(Math.max(0, Math.min(pageCount - 1, moves[e.key]!)), 'range');
    } else if (e.key === ' ') {
      e.preventDefault();
      props.onSelect(focusIndex, e.ctrlKey ? 'toggle' : 'single');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      props.onOpenPage(focusIndex + 1);
    }
  };

  const slotOf = (e: DragEvent, index: number) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY > box.top + box.height / 2 ? index + 1 : index;
  };

  return (
    <div
      ref={list}
      className="pdf-thumbnails"
      role="listbox"
      aria-label="Pages"
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropSlot(null);
      }}
    >
      {Array.from({ length: pageCount }, (_, index) => (
        <Thumbnail
          key={`${props.generation}-${index}`}
          {...props}
          index={index}
          focused={index === focusIndex}
          dropBefore={dropSlot === index}
          dropAfter={dropSlot === pageCount && index === pageCount - 1}
          onFocusIndex={setFocus}
          onDragOverSlot={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropSlot(slotOf(e, index));
          }}
          onDropSlot={(e) => {
            const dragged = e.dataTransfer.getData(DRAG_TYPE);
            setDropSlot(null);
            if (dragged === '') return;
            e.preventDefault();
            props.onDrop(Number(dragged), slotOf(e, index));
          }}
        />
      ))}
    </div>
  );
}

interface ThumbnailProps extends PdfThumbnailsProps {
  index: number;
  focused: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onFocusIndex(index: number): void;
  onDragOverSlot(e: DragEvent): void;
  onDropSlot(e: DragEvent): void;
}

function Thumbnail({ pdf, index, rotation, currentPage, pageCount, selection, focused, dropBefore, dropAfter, ...on }: ThumbnailProps) {
  const item = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const page = index + 1;
  const selected = selection.selected.includes(index);

  useEffect(() => {
    const node = item.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task: RenderTask | null = null;
    let stale = false;
    void pdf
      .getPage(page)
      .then((p) => {
        const target = canvas.current;
        if (stale || !target) return;
        const turn = (p.rotate + rotation) % 360;
        const viewport = p.getViewport({ scale: THUMB_WIDTH / p.getViewport({ scale: 1, rotation: turn }).width, rotation: turn });
        const ratio = window.devicePixelRatio || 1;
        target.width = Math.floor(viewport.width * ratio);
        target.height = Math.floor(viewport.height * ratio);
        target.style.width = `${Math.floor(viewport.width)}px`;
        target.style.height = `${Math.floor(viewport.height)}px`;
        task = p.render({ canvas: target, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        return task.promise;
      })
      // A canceled or failed thumbnail stays blank; the page itself shows its own error.
      .catch(() => undefined);
    return () => {
      stale = true;
      task?.cancel();
    };
  }, [pdf, page, rotation, visible]);

  const select = (e: MouseEvent) => on.onSelect(index, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single');

  return (
    <div
      ref={item}
      role="option"
      aria-selected={selected}
      aria-current={page === currentPage ? 'page' : undefined}
      aria-label={`Page ${page} of ${pageCount}`}
      data-page-index={index}
      tabIndex={focused ? 0 : -1}
      draggable
      className={`pdf-thumb${selected ? ' selected' : ''}${page === currentPage ? ' current' : ''}${dropBefore ? ' drop-before' : ''}${dropAfter ? ' drop-after' : ''}`}
      onFocus={() => on.onFocusIndex(index)}
      onClick={(e) => {
        select(e);
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) on.onOpenPage(page);
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, String(index));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={on.onDragOverSlot}
      onDrop={on.onDropSlot}
    >
      <canvas ref={canvas} className="pdf-thumb-canvas" aria-hidden />
      <span className="pdf-thumb-number">{page}</span>
    </div>
  );
}
