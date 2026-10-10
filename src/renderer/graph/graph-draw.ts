import type { GraphModelType, GraphNodeType } from '../../shared/contracts/graph';
import type { DocumentKind } from '../../shared/documents/kinds';
import type { GraphLayout, LayoutNode } from './graph-layout';

/** Pan and zoom: a world point p is drawn at p * k + (x, y). */
export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 6;
/** Labels are drawn from this zoom on (and always for highlighted nodes). */
const LABEL_ZOOM = 0.9;

/** The colors of the graph, read from the canvas's CSS custom properties so they follow the light and dark themes. */
export interface GraphColors {
  edge: string;
  edgeStrong: string;
  label: string;
  halo: string;
  note: string;
  locked: string;
  ring: string;
  documents: Record<DocumentKind, string>;
}

export function readGraphColors(el: Element): GraphColors {
  const style = getComputedStyle(el);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    edge: v('--graph-edge', '#9aa0b4'),
    edgeStrong: v('--graph-edge-strong', '#6a5ae0'),
    label: v('--graph-label', '#1d2030'),
    halo: v('--graph-halo', '#ffffff'),
    note: v('--graph-note', '#6a5ae0'),
    locked: v('--graph-locked', '#80869a'),
    ring: v('--graph-ring', '#9a5b00'),
    documents: {
      pdf: v('--graph-pdf', '#c0392b'),
      docx: v('--graph-docx', '#2b6cb0'),
      xlsx: v('--graph-xlsx', '#2e7d4f'),
      csv: v('--graph-csv', '#2c8c8c'),
      pptx: v('--graph-pptx', '#c46a1a'),
      html: v('--graph-html', '#6b7280'),
    },
  };
}

export const nodeColor = (node: GraphNodeType, colors: GraphColors): string =>
  node.kind === 'document' && node.documentKind ? colors.documents[node.documentKind] : node.locked ? colors.locked : colors.note;

export interface DrawState {
  /** Nodes to stand out (hover and its neighbors, or search matches); the rest are dimmed. Null: none dimmed. */
  focus: ReadonlySet<number> | null;
  /** Nodes with a ring (search matches, the local graph's own item). */
  ringed: ReadonlySet<number>;
  hovered: number | null;
}

/** Notes are circles, documents rounded squares. */
function nodePath(ctx: CanvasRenderingContext2D, n: LayoutNode, node: GraphNodeType): void {
  ctx.beginPath();
  if (node.kind === 'note') ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
  else ctx.roundRect(n.x - n.radius, n.y - n.radius, n.radius * 2, n.radius * 2, n.radius * 0.35);
}

/** Draws the graph in CSS pixels (the caller has scaled the context for the device pixel ratio). */
export function drawGraph(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  layout: GraphLayout,
  model: Pick<GraphModelType, 'nodes'>,
  view: ViewTransform,
  state: DrawState,
  colors: GraphColors,
): void {
  ctx.save();
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.translate(view.x, view.y);
  ctx.scale(view.k, view.k);
  const dimmed = (i: number) => state.focus !== null && !state.focus.has(i);

  ctx.lineWidth = 1 / view.k;
  ctx.strokeStyle = colors.edge;
  ctx.globalAlpha = state.focus ? 0.15 : 0.6;
  ctx.beginPath();
  for (const l of layout.links) {
    ctx.moveTo(l.source.x, l.source.y);
    ctx.lineTo(l.target.x, l.target.y);
  }
  ctx.stroke();
  if (state.focus) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = colors.edgeStrong;
    ctx.lineWidth = 1.5 / view.k;
    ctx.beginPath();
    for (const l of layout.links) {
      if (dimmed(l.source.index) || dimmed(l.target.index)) continue;
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
    }
    ctx.stroke();
  }

  for (const n of layout.nodes) {
    const node = model.nodes[n.index]!;
    ctx.globalAlpha = dimmed(n.index) ? 0.25 : 1;
    nodePath(ctx, n, node);
    ctx.fillStyle = nodeColor(node, colors);
    ctx.fill();
    if (state.ringed.has(n.index) || state.hovered === n.index) {
      ctx.lineWidth = 2.5 / view.k;
      ctx.strokeStyle = colors.ring;
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.font = `${12 / view.k}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3 / view.k;
  ctx.strokeStyle = colors.halo;
  ctx.fillStyle = colors.label;
  for (const n of layout.nodes) {
    const shown = state.hovered === n.index || state.ringed.has(n.index) || (view.k >= LABEL_ZOOM && !dimmed(n.index)) || (state.focus?.has(n.index) ?? false);
    if (!shown) continue;
    const label = labelOf(model.nodes[n.index]!);
    ctx.strokeText(label, n.x, n.y + n.radius + 2 / view.k);
    ctx.fillText(label, n.x, n.y + n.radius + 2 / view.k);
  }
  ctx.restore();
}

export const labelOf = (node: GraphNodeType): string => {
  const title = node.title.trim() === '' ? 'Untitled' : node.title;
  return title.length > 40 ? `${title.slice(0, 39)}…` : title;
};

/** The view that shows a box in a viewport with a margin, within the zoom limits. */
export function fitView(box: { minX: number; minY: number; maxX: number; maxY: number } | null, size: { width: number; height: number }, margin = 24): ViewTransform {
  if (!box || size.width <= 0 || size.height <= 0) return { x: size.width / 2, y: size.height / 2, k: 1 };
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const k = clampZoom(Math.min((size.width - margin * 2) / w, (size.height - margin * 2) / h, 2));
  return { k, x: size.width / 2 - ((box.minX + box.maxX) / 2) * k, y: size.height / 2 - ((box.minY + box.maxY) / 2) * k };
}

export const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Zooms by `factor` keeping the screen point (px, py) over the same world point. */
export function zoomAt(view: ViewTransform, px: number, py: number, factor: number): ViewTransform {
  const k = clampZoom(view.k * factor);
  const f = k / view.k;
  return { k, x: px - (px - view.x) * f, y: py - (py - view.y) * f };
}

export const toWorld = (view: ViewTransform, px: number, py: number) => ({ x: (px - view.x) / view.k, y: (py - view.y) / view.k });
