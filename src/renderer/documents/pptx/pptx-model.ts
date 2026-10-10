import { createComputedView, type PptxSourceModel, type SourceShapeNode, type SourceSlide, type SourceTextBody, type SourceTransform } from '@pptx-glimpse/document';
import type { ShapeBox } from './pptx-xml';

/** EMU per CSS pixel at 96 DPI; the renderer draws slides at this scale. */
export const EMU_PER_PX = 9525;
/** PowerPoint's 16:9 slide, for a package that names no size. */
const DEFAULT_SLIDE = { width: 12_192_000, height: 6_858_000 };

/** A drawing on a slide that the editor shows a frame for (F5, D-151). */
export interface SlideShape {
  /** The `cNvPr` ID, unique on its slide. */
  id: string;
  name: string;
  kind: SourceShapeNode['kind'];
  /** Position and size in EMU, its own or inherited from the layout. */
  box: ShapeBox;
  /** Degrees clockwise. */
  rotation: number;
  /** The shape has an `a:xfrm` of its own (the library moves it); otherwise the OOXML layer writes one. */
  ownBox: boolean;
  /** A text body that can be edited. */
  text: boolean;
  placeholder: boolean;
}

export function slideSize(model: PptxSourceModel): { width: number; height: number } {
  const size = model.presentation.slideSize;
  return size && size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : DEFAULT_SLIDE;
}

const KIND_LABELS: Readonly<Record<SourceShapeNode['kind'], string>> = {
  shape: 'Shape',
  connector: 'Line',
  group: 'Group',
  image: 'Picture',
  table: 'Table',
  chart: 'Chart',
  smartArt: 'SmartArt graphic',
  raw: 'Object',
};

/** How a shape is announced: its name, or its kind. */
export function shapeLabel(shape: SlideShape): string {
  if (shape.name.trim() !== '') return shape.name;
  return shape.text ? 'Text box' : KIND_LABELS[shape.kind];
}

const nodeName = (node: SourceShapeNode) => ('name' in node && typeof node.name === 'string' ? node.name : '');

/**
 * The drawings directly on a slide, in drawing order, with the box they are drawn in (the computed view resolves
 * placeholders' inherited positions). Layout and master drawings are not the slide's and get no frame.
 */
export function slideShapes(model: PptxSourceModel, index: number): SlideShape[] {
  const slide = model.slides[index];
  if (!slide) return [];
  const computed = createComputedView(model, { slides: [index + 1] }).slides[0];
  const boxes = new Map<string, SourceTransform>();
  for (const element of computed?.elements ?? []) {
    if (element.sourceLayer !== 'slide' || !('transform' in element) || !element.transform) continue;
    const id = (element.sourceNode as SourceShapeNode | undefined)?.nodeId;
    if (id !== undefined) boxes.set(String(id), element.transform);
  }
  return slide.shapes.flatMap((node): SlideShape[] => {
    if (node.nodeId === undefined || node.kind === 'raw') return [];
    const id = String(node.nodeId);
    const own = 'transform' in node ? node.transform : undefined;
    const transform = own ?? boxes.get(id);
    if (!transform || transform.width <= 0 || transform.height <= 0) return [];
    return [
      {
        id,
        name: nodeName(node),
        kind: node.kind,
        box: { offsetX: transform.offsetX, offsetY: transform.offsetY, width: transform.width, height: transform.height },
        rotation: (transform.rotation ?? 0) / 60_000,
        ownBox: own !== undefined,
        text: node.kind === 'shape' && node.textBody !== undefined,
        placeholder: 'placeholder' in node && node.placeholder !== undefined,
      },
    ];
  });
}

/** The source node of a drawing directly on a slide. */
export function slideNode(slide: SourceSlide, shapeId: string): SourceShapeNode | undefined {
  return slide.shapes.find((node) => node.nodeId !== undefined && String(node.nodeId) === shapeId);
}

const bodyText = (body: SourceTextBody | undefined): string => (body ? body.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : '');

/** The text of a drawing and everything inside it (a group's members, a table's cells), a line per paragraph. */
export function nodeText(node: SourceShapeNode): string {
  switch (node.kind) {
    case 'shape':
      return bodyText(node.textBody);
    case 'group':
      return node.children.map(nodeText).filter((t) => t !== '').join('\n');
    case 'table':
      return node.table.rows.map((row) => row.cells.map((cell) => bodyText(cell.textBody)).join('\t')).join('\n');
    default:
      return '';
  }
}

/** A new drawing's ID: one more than the largest on the slide (IDs are unique per slide). */
export function newestShapeId(before: SourceSlide | undefined, after: SourceSlide | undefined): string | null {
  const known = new Set((before?.shapes ?? []).map((s) => String(s.nodeId)));
  const added = (after?.shapes ?? []).filter((s) => s.nodeId !== undefined && !known.has(String(s.nodeId)));
  return added.length > 0 ? String(added[added.length - 1]!.nodeId) : null;
}

/** What the slides may hold that the editor does not show as PowerPoint does (D-154), by what marks it in slide XML. */
const NOT_SHOWN: ReadonlyArray<{ label: string; mark: RegExp }> = [
  { label: 'transitions', mark: /<(?:\w+:)?transition\b/ },
  { label: 'animations', mark: /<(?:\w+:)?timing\b/ },
  { label: 'video and audio', mark: /<(?:\w+:)?(?:videoFile|audioFile|quickTimeFile|media)\b/ },
  { label: 'SmartArt', mark: /drawingml\/2006\/diagram/ },
  { label: 'charts (drawn simplified)', mark: /drawingml\/2006\/chart/ },
  { label: 'embedded objects', mark: /<(?:\w+:)?oleObj\b/ },
  { label: 'ink', mark: /<(?:\w+:)?contentPart\b/ },
];

/** The kinds of content in a presentation's slides that the editor shows simplified or not at all, in a fixed order. */
export function contentNotShown(model: PptxSourceModel): string[] {
  const slideParts = new Set<string>(model.slides.map((s) => s.partPath));
  const decoder = new TextDecoder();
  const xml = (model.packageGraph.rawParts ?? []).flatMap((part) => (part.kind === 'binary' && slideParts.has(part.partPath) ? [decoder.decode(part.bytes)] : []));
  return NOT_SHOWN.filter(({ mark }) => xml.some((text) => mark.test(text))).map(({ label }) => label);
}
