import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SlideEntry } from './pptx-session';

const NEXT = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N']);
const PREVIOUS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P']);

/** Which slide a key in presentation mode shows next, or 'exit'; null for keys it does not use. */
export function presenterKey(key: string, index: number, count: number): number | 'exit' | null {
  if (key === 'Escape') return 'exit';
  if (NEXT.has(key)) return Math.min(count - 1, index + 1);
  if (PREVIOUS.has(key)) return Math.max(0, index - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Presentation mode (F5, D-151): the slides one at a time over the whole window, black around them. Arrow keys,
 * Page Up and Page Down, Space, Enter and clicks step through them; Home and End go to the ends; Esc returns to the
 * editor at the slide shown. Animations and transitions are not played (D-154).
 */
export function PptxPresenter({ slides, start, onExit }: { slides: readonly SlideEntry[]; start: number; onExit(index: number): void }) {
  const [index, setIndex] = useState(start);
  const root = useRef<HTMLDivElement>(null);
  // Like a dialog: the focus moves in, and back to where it was (the Present button, the slide) on exit.
  useEffect(() => {
    const previous = root.current?.ownerDocument.activeElement;
    root.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    const next = presenterKey(event.key, index, slides.length);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (next === 'exit') onExit(index);
    else setIndex(next);
  };
  const slide = slides[index];
  return (
    <div
      ref={root}
      className="pptx-presenter"
      role="dialog"
      aria-modal="true"
      aria-label="Presentation"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClick={() => setIndex(Math.min(slides.length - 1, index + 1))}
      onContextMenu={(e) => {
        e.preventDefault();
        setIndex(Math.max(0, index - 1));
      }}
    >
      {slide?.image ? <img className="pptx-presenter-slide" src={slide.image} alt={`Slide ${index + 1}`} /> : <span className="pptx-presenter-wait">Drawing slide…</span>}
      <span className="pptx-presenter-counter" role="status">
        {index + 1} / {slides.length}
      </span>
      <button
        type="button"
        className="pptx-presenter-exit"
        onClick={(e) => {
          e.stopPropagation();
          onExit(index);
        }}
      >
        End show (Esc)
      </button>
    </div>
  );
}
