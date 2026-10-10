import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { EMU_PER_PX, shapeLabel, type SlideShape } from './pptx-model';
import type { RunFormat, ShapeBox, TextParagraph } from './pptx-xml';
import { HANDLES, moved, nudged, resized, snapped, type Handle } from './stage-geometry';
import { fillEditor, type TextLook } from './text-edit';

/** The zoom of the slide view: fit the pane, or a fixed scale of the slide's own pixel size. */
export type Zoom = 'fit' | number;

/** Text in the editor is shown at this size where its runs name none (PowerPoint's body text default). */
const DEFAULT_TEXT_PT = 18;
/** Pixels between the slide and the pane's edge when it fits. */
const FIT_MARGIN = 24;
/** Snapping reaches this far on screen. */
const SNAP_PX = 6;

export interface TextEditing {
  shapeId: string;
  paragraphs: TextParagraph[];
}

interface Drag {
  id: string;
  handle: Handle | null;
  x: number;
  y: number;
  box: ShapeBox;
  preview: ShapeBox;
}

export interface StageProps {
  image: string | null;
  slideNumber: number;
  slideCount: number;
  /** Slide size in EMU. */
  size: { width: number; height: number };
  shapes: readonly SlideShape[];
  zoom: Zoom;
  selection: string | null;
  /** A drawing holding the current find match. */
  highlight: string | null;
  readOnly: boolean;
  editing: TextEditing | null;
  editorRef: RefObject<HTMLDivElement | null>;
  onSelect(shapeId: string | null): void;
  onChangeBox(shapeId: string, box: ShapeBox): void;
  onDelete(shapeId: string): void;
  onEditText(shapeId: string): void;
  onStopEditing(): void;
  onFormatKey(format: keyof Pick<RunFormat, 'bold' | 'italic' | 'underline'>): void;
  onPaste(event: ClipboardEvent): void;
  onStep(delta: number): void;
}

/** How text is sized in the editor at a slide scale. */
const textLook = (scale: number): TextLook => ({ pxPerPt: (96 / 72) * scale, defaultSizePt: DEFAULT_TEXT_PT });

/** The fit scale of a slide in a pane of this size; 1 before the pane has a size. */
function fitScale(pane: HTMLElement | null, size: { width: number; height: number }): number {
  if (!pane || pane.clientWidth === 0 || pane.clientHeight === 0) return 1;
  return Math.max(0.05, Math.min((pane.clientWidth - FIT_MARGIN * 2) / (size.width / EMU_PER_PX), (pane.clientHeight - FIT_MARGIN * 2) / (size.height / EMU_PER_PX)));
}

/** Plain text pasted into a shape's text, without the markup another app put on the clipboard. */
function pastePlainText(event: ClipboardEvent) {
  event.preventDefault();
  const text = event.clipboardData.getData('text/plain');
  const selection = event.currentTarget.ownerDocument.getSelection();
  if (!text || !selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = event.currentTarget.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

const FORMAT_KEYS: Readonly<Record<string, 'bold' | 'italic' | 'underline'>> = { b: 'bold', i: 'italic', u: 'underline' };

/**
 * The slide being edited (F5, D-151): its drawing, a frame for each drawing on it to select, move (with snapping to the
 * slide's edges and center; Alt turns it off) and resize with the mouse or the keyboard, and the text editor of a
 * shape in place. A read-only slide shows only the drawing.
 */
export function PptxStage(props: StageProps) {
  const { image, slideNumber, slideCount, size, shapes, zoom, selection, highlight, readOnly, editing, editorRef } = props;
  const pane = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    const element = pane.current;
    const measure = () => setFit(fitScale(element, size));
    measure();
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [size]);

  const scale = zoom === 'fit' ? fit : zoom;
  const pxPerEmu = scale / EMU_PER_PX;
  const editingId = editing?.shapeId ?? null;
  /** The editing session the editor was filled for: it is filled once, so a zoom change keeps what was typed. */
  const filled = useRef<TextEditing | null>(null);
  const slideRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = editorRef.current;
    if (!element || !editing || filled.current === editing) return;
    filled.current = editing;
    fillEditor(element, editing.paragraphs, textLook(scale));
    element.focus();
  }, [editing, editorRef, scale]);

  const startDrag = (event: PointerEvent, shape: SlideShape, handle: Handle | null) => {
    if (readOnly || event.button !== 0 || editingId === shape.id) return;
    event.stopPropagation();
    props.onSelect(shape.id);
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    setDrag({ id: shape.id, handle, x: event.clientX, y: event.clientY, box: shape.box, preview: shape.box });
  };
  const moveDrag = (event: PointerEvent) => {
    if (!drag) return;
    const dx = (event.clientX - drag.x) / pxPerEmu;
    const dy = (event.clientY - drag.y) / pxPerEmu;
    const next = drag.handle ? resized(drag.box, drag.handle, dx, dy) : moved(drag.box, dx, dy);
    setDrag({ ...drag, preview: drag.handle || event.altKey ? next : snapped(next, size, SNAP_PX / pxPerEmu) });
  };
  const endDrag = () => {
    if (!drag) return;
    setDrag(null);
    const { box, preview } = drag;
    if (preview.offsetX !== box.offsetX || preview.offsetY !== box.offsetY || preview.width !== box.width || preview.height !== box.height) props.onChangeBox(drag.id, preview);
  };

  const selected = shapes.find((s) => s.id === selection) ?? null;
  const onKeyDown = (event: KeyboardEvent) => {
    if (editingId) return;
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      props.onStep(event.key === 'PageDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Tab' && shapes.length > 0 && !readOnly) {
      // Tab goes through the drawings of the slide; past the last one it leaves the slide.
      const at = selected ? shapes.indexOf(selected) : -1;
      const next = at + (event.shiftKey ? -1 : 1);
      if (next < 0 || next >= shapes.length) return props.onSelect(null);
      event.preventDefault();
      props.onSelect(shapes[next]!.id);
      return;
    }
    if (!selected || readOnly) return;
    if (event.key === 'Escape') return props.onSelect(null);
    if (event.key === 'Enter' && selected.text) {
      event.preventDefault();
      return props.onEditText(selected.id);
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      return props.onDelete(selected.id);
    }
    // Arrows move by 10 px of the slide, with Alt by 1 px; Shift resizes.
    const next = nudged(selected.box, event.key, (event.altKey ? 1 : 10) * EMU_PER_PX, event.shiftKey);
    if (next) {
      event.preventDefault();
      props.onChangeBox(selected.id, next);
    }
  };

  const onEditorKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      // Moving the focus to the slide ends the editing (the editor's blur) and gives the slide the keyboard again, with
      // the shape still selected.
      if (slideRef.current) slideRef.current.focus();
      else props.onStopEditing();
      return;
    }
    const format = (event.ctrlKey || event.metaKey) && !event.altKey ? FORMAT_KEYS[event.key.toLowerCase()] : undefined;
    if (format) {
      event.preventDefault();
      props.onFormatKey(format);
    }
  };

  const px = (emu: number) => emu * pxPerEmu;
  const boxStyle = (box: ShapeBox, rotation = 0) => ({
    left: px(box.offsetX),
    top: px(box.offsetY),
    width: px(box.width),
    height: px(box.height),
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  });

  return (
    <div ref={pane} className="pptx-stage">
      <span className="sr-only" aria-live="polite">
        {selected && !readOnly ? `${shapeLabel(selected)} selected. Arrows move it, Shift with arrows resizes it${selected.text ? ', Enter edits its text' : ''}.` : ''}
      </span>
      <div
        ref={slideRef}
        className="pptx-slide"
        role="application"
        aria-roledescription="slide"
        aria-label={`Slide ${slideNumber} of ${slideCount}${selected ? `, ${shapeLabel(selected)} selected` : ''}`}
        tabIndex={0}
        style={{ width: px(size.width), height: px(size.height) }}
        onKeyDown={onKeyDown}
        onPaste={editingId ? undefined : props.onPaste}
        onPointerDown={() => !readOnly && !editingId && props.onSelect(null)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      >
        {image ? <img className="pptx-slide-image" src={image} alt="" draggable={false} /> : <span className="muted pptx-slide-wait">Drawing slide…</span>}
        {shapes.map((shape) => {
          const box = drag?.id === shape.id ? drag.preview : shape.box;
          const isSelected = shape.id === selection && !readOnly;
          return (
            <div
              key={shape.id}
              className={`pptx-frame${isSelected ? ' pptx-frame-selected' : ''}${shape.id === highlight ? ' pptx-frame-hit' : ''}`}
              style={boxStyle(box, shape.rotation)}
              data-shape-id={shape.id}
              aria-hidden="true"
              onPointerDown={(e) => startDrag(e, shape, null)}
              onDoubleClick={() => !readOnly && shape.text && props.onEditText(shape.id)}
            >
              {isSelected && editingId !== shape.id
                ? HANDLES.map((handle) => <span key={handle} className={`pptx-handle pptx-handle-${handle}`} onPointerDown={(e) => startDrag(e, shape, handle)} />)
                : null}
            </div>
          );
        })}
        {editing
          ? (() => {
              const shape = shapes.find((s) => s.id === editing.shapeId);
              return shape ? (
                <div
                  ref={editorRef}
                  className="pptx-text-editor"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-multiline="true"
                  aria-label={`Text of ${shapeLabel(shape)}`}
                  spellCheck
                  style={boxStyle(shape.box, shape.rotation)}
                  onKeyDown={onEditorKeyDown}
                  onPaste={pastePlainText}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    // The formatting tools keep the editor open: their buttons take no focus, their fields hand it back.
                    const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
                    if (!e.currentTarget.contains(next) && !next?.closest('[data-keeps-editor]')) props.onStopEditing();
                  }}
                />
              ) : null;
            })()
          : null}
      </div>
    </div>
  );
}
