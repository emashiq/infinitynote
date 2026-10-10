import { Files, Highlighter, ImagePlus, Minus, MousePointer2, PanelLeft, PenLine, Plus, RotateCw, Save, Search, Type, type LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { IconButton } from '../../ui/IconButton';
import { Menu, type MenuItem } from '../../ui/Menu';
import type { PdfColorTool, PdfTool, PdfZoom } from './pdf-session';

/** The zoom choices; a factor the user reached otherwise (Ctrl+wheel, +/-) shows as its percentage. */
export const ZOOM_CHOICES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'page-width', label: 'Fit width' },
  { value: 'page-fit', label: 'Fit page' },
  { value: 'auto', label: 'Automatic' },
  ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((f) => ({ value: String(f), label: `${Math.round(f * 100)}%` })),
];

export function zoomChoice(zoom: PdfZoom): string {
  return typeof zoom === 'number' ? String(Math.round(zoom * 100) / 100) : zoom;
}

export function parseZoomChoice(value: string): PdfZoom {
  return value === 'page-width' || value === 'page-fit' || value === 'auto' ? value : Number(value);
}

const TOOLS: ReadonlyArray<{ tool: Exclude<PdfTool, 'image'>; label: string; icon: LucideIcon }> = [
  { tool: 'select', label: 'Select text', icon: MousePointer2 },
  { tool: 'highlight', label: 'Highlight', icon: Highlighter },
  { tool: 'text', label: 'Add text', icon: Type },
  { tool: 'draw', label: 'Draw', icon: PenLine },
];

export interface PdfToolbarProps {
  ready: boolean;
  /** A version shown read-only: no annotation tools, page operations or Save. */
  readOnly: boolean;
  sidebarOpen: boolean;
  page: number;
  pageCount: number;
  zoom: PdfZoom;
  tool: PdfTool;
  color: string | null;
  dirty: boolean;
  saving: boolean;
  findOpen: boolean;
  pageItems: MenuItem[];
  onToggleSidebar(): void;
  onPage(page: number): void;
  onZoom(zoom: PdfZoom): void;
  onZoomStep(step: 1 | -1): void;
  onRotateView(): void;
  onTool(tool: PdfTool): void;
  onAddImage(): void;
  onColor(tool: PdfColorTool, color: string): void;
  onToggleFind(): void;
  onSave(): void;
}

/** The PDF viewer's toolbar (F2): sidebar, page number, zoom, view rotation, annotation tools, page operations, find and Save. */
export function PdfToolbar(props: PdfToolbarProps) {
  const { ready, page, pageCount, zoom, tool, dirty, saving } = props;
  // The page number being typed; the page in view otherwise.
  const [typed, setTyped] = useState<string | null>(null);
  const [pagesMenu, setPagesMenu] = useState<{ x: number; y: number } | null>(null);
  const pagesButton = useRef<HTMLButtonElement>(null);
  const commitPage = () => {
    const n = Number(typed);
    if (typed !== null && Number.isInteger(n) && n >= 1 && n <= pageCount) props.onPage(n);
    setTyped(null);
  };
  const zoomValue = zoomChoice(zoom);
  const colorTool = tool === 'highlight' || tool === 'text' || tool === 'draw' ? tool : null;

  return (
    <div className="document-toolbar pdf-toolbar" role="toolbar" aria-label="PDF">
      <IconButton label="Pages and outline" icon={PanelLeft} aria-pressed={props.sidebarOpen} onClick={props.onToggleSidebar} />
      <span className="pdf-toolbar-group">
        <input
          className="text-input pdf-page-input"
          inputMode="numeric"
          aria-label="Page number"
          disabled={!ready}
          value={typed ?? String(page)}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commitPage}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitPage();
          }}
        />
        <span className="muted">of {pageCount}</span>
      </span>
      <span className="pdf-toolbar-group">
        <IconButton label="Zoom out" icon={Minus} disabled={!ready} onClick={() => props.onZoomStep(-1)} />
        <select className="select pdf-zoom" aria-label="Zoom" disabled={!ready} value={zoomValue} onChange={(e) => props.onZoom(parseZoomChoice(e.target.value))}>
          {ZOOM_CHOICES.some((c) => c.value === zoomValue) ? null : <option value={zoomValue}>{`${Math.round(Number(zoomValue) * 100)}%`}</option>}
          {ZOOM_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <IconButton label="Zoom in" icon={Plus} disabled={!ready} onClick={() => props.onZoomStep(1)} />
        <IconButton label="Rotate view" title="Rotate the view (the file is not changed)" icon={RotateCw} disabled={!ready} onClick={props.onRotateView} />
      </span>
      {props.readOnly ? null : (
        <>
          <span className="pdf-toolbar-group" role="group" aria-label="Annotation tools">
            {TOOLS.map((t) => (
              <IconButton key={t.tool} label={t.label} icon={t.icon} aria-pressed={tool === t.tool} disabled={!ready} onClick={() => props.onTool(t.tool)} />
            ))}
            <IconButton label="Add image" icon={ImagePlus} aria-pressed={tool === 'image'} disabled={!ready} onClick={props.onAddImage} />
            {colorTool && props.color ? (
              <input type="color" className="pdf-color" aria-label="Color" value={props.color} onChange={(e) => props.onColor(colorTool, e.target.value)} />
            ) : null}
          </span>
          <button
            ref={pagesButton}
            type="button"
            className="btn btn-small"
            aria-haspopup="menu"
            aria-expanded={pagesMenu !== null}
            disabled={!ready}
            onClick={() => {
              const r = pagesButton.current?.getBoundingClientRect();
              setPagesMenu(pagesMenu ? null : { x: r?.left ?? 0, y: (r?.bottom ?? 0) + 2 });
            }}
          >
            <Files size={14} strokeWidth={1.75} aria-hidden />
            Pages
          </button>
          {pagesMenu ? <Menu label="Page actions" anchor={pagesMenu} onClose={() => setPagesMenu(null)} items={props.pageItems} /> : null}
        </>
      )}
      <IconButton label="Find in PDF" title="Find in PDF (Ctrl+F)" icon={Search} aria-pressed={props.findOpen} disabled={!ready} onClick={props.onToggleFind} />
      <span className="pdf-toolbar-end">
        <span role="status" className="save-status">
          {props.readOnly ? 'Read-only' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : ''}
        </span>
        {props.readOnly ? null : (
          <button type="button" className="btn btn-small btn-primary" title="Save (Ctrl+S)" disabled={!dirty || saving} onClick={props.onSave}>
            <Save size={14} strokeWidth={1.75} aria-hidden />
            Save
          </button>
        )}
      </span>
    </div>
  );
}
