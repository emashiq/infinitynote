import { Bold, Copy, ImagePlus, Italic, Play, Plus, Redo2, Save, Search, Trash2, Type, Underline, Undo2 } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import type { RunFormat } from './pptx-xml';
import type { Zoom } from './PptxStage';

const ZOOMS: readonly number[] = [0.5, 0.75, 1, 1.5, 2];

export interface ToolbarProps {
  ready: boolean;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  slideCount: number;
  /** A drawing with text is selected or being edited, so the formatting tools apply to it. */
  textTarget: boolean;
  zoom: Zoom;
  findOpen: boolean;
  status: string;
  canSave: boolean;
  onAddSlide(): void;
  onDuplicateSlide(): void;
  onDeleteSlide(): void;
  onAddTextBox(): void;
  onAddPicture(): void;
  onUndo(): void;
  onRedo(): void;
  onFormat(format: RunFormat): void;
  onToggle(key: 'bold' | 'italic' | 'underline'): void;
  onZoom(zoom: Zoom): void;
  onFind(): void;
  onPresent(): void;
  onSave(): void;
}

/** Tool buttons do not take the focus, so text being edited keeps its selection while it is formatted. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

function Tool({ label, shortcut, disabled, pressed, onClick, children }: { label: string; shortcut?: string; disabled: boolean; pressed?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="btn btn-small" aria-label={label} aria-pressed={pressed} title={shortcut ? `${label} (${shortcut})` : label} disabled={disabled} onMouseDown={keepFocus} onClick={onClick}>
      {children}
    </button>
  );
}

/** The presentation editor's tools (F5): slides, inserting, history, text formatting, zoom, find, show and Save. */
export function PptxToolbar(p: ToolbarProps) {
  const editable = p.ready && !p.readOnly;
  return (
    <div className="document-toolbar pptx-toolbar" role="toolbar" aria-label="Presentation">
      {p.readOnly ? null : (
        <>
          <Tool label="New slide" disabled={!editable} onClick={p.onAddSlide}>
            <Plus size={14} aria-hidden="true" />
            New slide
          </Tool>
          <Tool label="Duplicate slide" shortcut="Ctrl+D in the slide list" disabled={!editable} onClick={p.onDuplicateSlide}>
            <Copy size={14} aria-hidden="true" />
          </Tool>
          <Tool label="Delete slide" disabled={!editable || p.slideCount <= 1} onClick={p.onDeleteSlide}>
            <Trash2 size={14} aria-hidden="true" />
          </Tool>
          <span className="pptx-toolbar-sep" aria-hidden="true" />
          <Tool label="Text box" disabled={!editable} onClick={p.onAddTextBox}>
            <Type size={14} aria-hidden="true" />
            Text box
          </Tool>
          <Tool label="Picture" disabled={!editable} onClick={p.onAddPicture}>
            <ImagePlus size={14} aria-hidden="true" />
            Picture
          </Tool>
          <span className="pptx-toolbar-sep" aria-hidden="true" />
          <Tool label="Undo" shortcut="Ctrl+Z" disabled={!editable || !p.canUndo} onClick={p.onUndo}>
            <Undo2 size={14} aria-hidden="true" />
          </Tool>
          <Tool label="Redo" shortcut="Ctrl+Y" disabled={!editable || !p.canRedo} onClick={p.onRedo}>
            <Redo2 size={14} aria-hidden="true" />
          </Tool>
          <span className="pptx-toolbar-sep" aria-hidden="true" />
          <span className="pptx-format" data-keeps-editor="">
            <Tool label="Bold" shortcut="Ctrl+B" disabled={!editable || !p.textTarget} onClick={() => p.onToggle('bold')}>
              <Bold size={14} aria-hidden="true" />
            </Tool>
            <Tool label="Italic" shortcut="Ctrl+I" disabled={!editable || !p.textTarget} onClick={() => p.onToggle('italic')}>
              <Italic size={14} aria-hidden="true" />
            </Tool>
            <Tool label="Underline" shortcut="Ctrl+U" disabled={!editable || !p.textTarget} onClick={() => p.onToggle('underline')}>
              <Underline size={14} aria-hidden="true" />
            </Tool>
            <input
              type="number"
              className="input pptx-size"
              aria-label="Font size in points"
              title="Font size (points)"
              min={1}
              max={400}
              placeholder="pt"
              disabled={!editable || !p.textTarget}
              onKeyDown={(e) => {
                const size = Number(e.currentTarget.value);
                if (e.key === 'Enter' && size >= 1 && size <= 400) p.onFormat({ sizePt: size });
              }}
            />
            <input type="color" className="pptx-color" aria-label="Text color" title="Text color" disabled={!editable || !p.textTarget} onChange={(e) => p.onFormat({ color: e.target.value.slice(1).toUpperCase() })} />
          </span>
        </>
      )}
      <select className="select pptx-zoom" aria-label="Zoom" disabled={!p.ready} value={String(p.zoom)} onChange={(e) => p.onZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
        <option value="fit">Fit</option>
        {ZOOMS.map((z) => (
          <option key={z} value={String(z)}>{`${Math.round(z * 100)}%`}</option>
        ))}
      </select>
      <Tool label="Find" shortcut="Ctrl+F" disabled={!p.ready} pressed={p.findOpen} onClick={p.onFind}>
        <Search size={14} aria-hidden="true" />
        Find
      </Tool>
      <Tool label="Present" shortcut="F5" disabled={!p.ready} onClick={p.onPresent}>
        <Play size={14} aria-hidden="true" />
        Present
      </Tool>
      <span className="pptx-toolbar-end">
        <span role="status" className="save-status">
          {p.status}
        </span>
        {p.readOnly ? null : (
          <button type="button" className="btn btn-small btn-primary" title="Save (Ctrl+S)" disabled={!p.canSave} onMouseDown={keepFocus} onClick={p.onSave}>
            <Save size={14} aria-hidden="true" />
            Save
          </button>
        )}
      </span>
    </div>
  );
}
