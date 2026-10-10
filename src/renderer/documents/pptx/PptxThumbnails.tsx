import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { SlideEntry } from './pptx-session';

interface ThumbnailsProps {
  slides: readonly SlideEntry[];
  current: number;
  readOnly: boolean;
  onSelect(index: number): void;
  onMove(from: number, to: number): void;
  onDuplicate(index: number): void;
  onDelete(index: number): void;
}

/**
 * The slide list (F5, D-151): a listbox of slide drawings. Arrows, Home and End choose the slide; Alt+Up and Alt+Down
 * move it, Ctrl+D duplicates it, Delete removes it; dragging a slide moves it to where it is dropped.
 */
export function PptxThumbnails({ slides, current, readOnly, onSelect, onMove, onDuplicate, onDelete }: ThumbnailsProps) {
  const list = useRef<HTMLOListElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const onKeyDown = (event: KeyboardEvent) => {
    const go = (index: number) => {
      event.preventDefault();
      onSelect(Math.max(0, Math.min(slides.length - 1, index)));
    };
    if (event.altKey && !readOnly && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      onMove(current, current + (event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') return go(current - 1);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') return go(current + 1);
    if (event.key === 'Home') return go(0);
    if (event.key === 'End') return go(slides.length - 1);
    if (readOnly) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      onDelete(current);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      onDuplicate(current);
    }
  };

  const dropIndex = (event: DragEvent, index: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? index + 1 : index;
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    if (dragging !== null && dropAt !== null) {
      // Dropping below itself counts the gap the slide leaves.
      const to = dropAt > dragging ? dropAt - 1 : dropAt;
      if (to !== dragging) onMove(dragging, to);
    }
    setDragging(null);
    setDropAt(null);
  };

  return (
    <ol
      ref={list}
      className="pptx-thumbnails"
      role="listbox"
      aria-label="Slides"
      aria-activedescendant={`pptx-thumb-${current}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(e) => dragging !== null && e.preventDefault()}
      onDrop={onDrop}
    >
      {slides.map((slide, index) => (
        <li
          key={`${slide.partPath}:${index}`}
          id={`pptx-thumb-${index}`}
          data-index={index}
          role="option"
          aria-selected={index === current}
          aria-label={`Slide ${index + 1}`}
          className={`pptx-thumb${index === current ? ' pptx-thumb-current' : ''}${dropAt === index ? ' pptx-thumb-drop-before' : ''}${dropAt === index + 1 && index === slides.length - 1 ? ' pptx-thumb-drop-after' : ''}`}
          draggable={!readOnly}
          onClick={() => onSelect(index)}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            setDragging(index);
          }}
          onDragOver={(e) => {
            if (dragging === null) return;
            e.preventDefault();
            setDropAt(dropIndex(e, index));
          }}
          onDragEnd={() => {
            setDragging(null);
            setDropAt(null);
          }}
        >
          <span className="pptx-thumb-number" aria-hidden="true">
            {index + 1}
          </span>
          {slide.image ? <img src={slide.image} alt="" draggable={false} /> : <span className="pptx-thumb-wait" />}
        </li>
      ))}
    </ol>
  );
}
