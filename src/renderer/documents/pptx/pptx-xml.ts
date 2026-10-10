/**
 * The OOXML layer of the presentation editor (F5, D-150): what @pptx-glimpse/document does not edit, done on the XML of
 * one part with the platform's XML parser. Every function takes a part's text and returns the new text, touching only
 * the element it names; the caller writes the part back into the package.
 */

export const DRAWINGML = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const PRESENTATIONML = 'http://schemas.openxmlformats.org/presentationml/2006/main';

/** How XML is parsed and written: the browser's parser in the app, jsdom's under Node in tests. */
export interface XmlTools {
  parse(xml: string): Document;
  serialize(node: Node): string;
}

export const browserXml: XmlTools = {
  parse: (xml) => new DOMParser().parseFromString(xml, 'application/xml'),
  serialize: (node) => new XMLSerializer().serializeToString(node),
};

/** The explicit character formatting of a run that the editor shows and sets (`a:rPr`). */
export interface RunFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Points. */
  sizePt?: number;
  /** `RRGGBB`. */
  color?: string;
}

/** One piece of a paragraph: text of a run, a line break, or a field (a slide number, a date) kept as it is. */
export type TextItem = { kind: 'run'; text: string; format: RunFormat } | { kind: 'break' } | { kind: 'field'; text: string };

export interface TextParagraph {
  items: TextItem[];
}

/** Where an edited item came from: its paragraph and position in the text read by readShapeText. */
export interface ItemSource {
  paragraph: number;
  item: number;
}

/** An edited item: text with the formatting it keeps from its source and the changes made to it. */
export interface EditedItem {
  kind: TextItem['kind'];
  text: string;
  source: ItemSource | null;
  /** Formatting set on this item; what it does not name stays as its source has it. */
  format: RunFormat;
}

export interface EditedParagraph {
  /** The paragraph whose properties (alignment, level, bullets) this one keeps; null for none. */
  source: number | null;
  items: EditedItem[];
}

export class XmlPartError extends Error {}

const SHAPE_ELEMENTS = new Set(['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp']);
const FILL_ELEMENTS = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);

function parsePart(xml: string, tools: XmlTools): Document {
  const doc = tools.parse(xml);
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) throw new XmlPartError('unreadable XML');
  return doc;
}

/** The part's text with the declaration it started with (the serializer leaves it out). */
function writePart(original: string, doc: Document, tools: XmlTools): string {
  const declaration = /^\s*<\?xml[^>]*\?>\r?\n?/.exec(original)?.[0] ?? '';
  return declaration + tools.serialize(doc.documentElement);
}

const children = (parent: Element, ns: string, name: string): Element[] =>
  Array.from(parent.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === ns && (n as Element).localName === name);

const child = (parent: Element, ns: string, name: string): Element | undefined => children(parent, ns, name)[0];

/** The drawing element (shape, picture, frame, group, connector) whose `cNvPr` has the ID. */
function shapeById(doc: Document, shapeId: string): Element {
  for (const props of Array.from(doc.getElementsByTagNameNS(PRESENTATIONML, 'cNvPr'))) {
    if (props.getAttribute('id') !== shapeId) continue;
    let node: Element | null = props.parentElement;
    while (node && !(node.namespaceURI === PRESENTATIONML && SHAPE_ELEMENTS.has(node.localName))) node = node.parentElement;
    if (node) return node;
  }
  throw new XmlPartError(`no shape ${shapeId}`);
}

function textBodyOf(shape: Element): Element {
  const body = child(shape, PRESENTATIONML, 'txBody');
  if (!body) throw new XmlPartError('the shape has no text');
  return body;
}

const textOf = (element: Element): string => children(element, DRAWINGML, 't').map((t) => t.textContent ?? '').join('');

function readFormat(rPr: Element | undefined): RunFormat {
  if (!rPr) return {};
  const format: RunFormat = {};
  const flag = (name: string) => rPr.getAttribute(name);
  if (flag('b') !== null) format.bold = flag('b') === '1' || flag('b') === 'true';
  if (flag('i') !== null) format.italic = flag('i') === '1' || flag('i') === 'true';
  if (flag('u') !== null) format.underline = flag('u') !== 'none';
  const size = Number(flag('sz'));
  if (flag('sz') !== null && Number.isFinite(size) && size > 0) format.sizePt = size / 100;
  const color = child(rPr, DRAWINGML, 'solidFill')?.getElementsByTagNameNS(DRAWINGML, 'srgbClr')[0]?.getAttribute('val');
  if (color && /^[0-9a-f]{6}$/i.test(color)) format.color = color.toUpperCase();
  return format;
}

/** The pieces of a paragraph in order: runs, line breaks and fields; other children (properties) are not text. */
function paragraphItems(paragraph: Element): Array<{ element: Element; item: TextItem }> {
  return Array.from(paragraph.children).flatMap((element): Array<{ element: Element; item: TextItem }> => {
    if (element.namespaceURI !== DRAWINGML) return [];
    if (element.localName === 'r') return [{ element, item: { kind: 'run', text: textOf(element), format: readFormat(child(element, DRAWINGML, 'rPr')) } }];
    if (element.localName === 'br') return [{ element, item: { kind: 'break' } }];
    if (element.localName === 'fld') return [{ element, item: { kind: 'field', text: textOf(element) } }];
    return [];
  });
}

/** The text of a shape as paragraphs of runs, line breaks and fields with their explicit formatting. */
export function readShapeText(xml: string, shapeId: string, tools: XmlTools): TextParagraph[] {
  const body = textBodyOf(shapeById(parsePart(xml, tools), shapeId));
  return children(body, DRAWINGML, 'p').map((p) => ({ items: paragraphItems(p).map(({ item }) => item) }));
}

function setFlag(rPr: Element, name: string, value: boolean | undefined, on: string, off: string) {
  if (value !== undefined) rPr.setAttribute(name, value ? on : off);
}

function applyFormat(rPr: Element, format: RunFormat) {
  setFlag(rPr, 'b', format.bold, '1', '0');
  setFlag(rPr, 'i', format.italic, '1', '0');
  setFlag(rPr, 'u', format.underline, 'sng', 'none');
  if (format.sizePt !== undefined) rPr.setAttribute('sz', String(Math.round(format.sizePt * 100)));
  if (format.color !== undefined) {
    for (const fill of Array.from(rPr.children)) if (fill.namespaceURI === DRAWINGML && FILL_ELEMENTS.has(fill.localName)) fill.remove();
    const doc = rPr.ownerDocument;
    const solid = doc.createElementNS(DRAWINGML, 'a:solidFill');
    const srgb = doc.createElementNS(DRAWINGML, 'a:srgbClr');
    srgb.setAttribute('val', format.color);
    solid.appendChild(srgb);
    // The fill follows the outline (`a:ln`) and comes before every other child (ECMA-376 CT_TextCharacterProperties).
    const line = child(rPr, DRAWINGML, 'ln');
    rPr.insertBefore(solid, line ? line.nextSibling : rPr.firstChild);
  }
}

const hasFormat = (format: RunFormat) => Object.values(format).some((v) => v !== undefined);

/**
 * Replaces the text of a shape (D-150). Each edited item keeps the XML of its source (a run's `a:rPr`, a field, a line
 * break) and each paragraph its source's `a:pPr` and `a:endParaRPr`; a new run takes the formatting of the run before
 * it, or of its paragraph's first run. Formatting changes are written into the run's `a:rPr`.
 */
export function writeShapeText(xml: string, shapeId: string, paragraphs: readonly EditedParagraph[], tools: XmlTools): string {
  const doc = parsePart(xml, tools);
  const body = textBodyOf(shapeById(doc, shapeId));
  const originals = children(body, DRAWINGML, 'p');
  const sources = originals.map((p) => paragraphItems(p).map(({ element }) => element));
  const firstRunOf = (index: number | null) => (index === null ? undefined : sources[index]?.find((e) => e.localName === 'r'));
  for (const p of originals) p.remove();
  const anchor = Array.from(body.children).find((e) => e.namespaceURI === DRAWINGML && e.localName === 'extLst') ?? null;

  for (const edited of paragraphs.length > 0 ? paragraphs : [{ source: null, items: [] }]) {
    const source = edited.source === null ? undefined : originals[edited.source];
    const paragraph = doc.createElementNS(DRAWINGML, 'a:p');
    const pPr = source && child(source, DRAWINGML, 'pPr');
    if (pPr) paragraph.appendChild(pPr.cloneNode(true));
    let previousRun: Element | undefined;
    for (const item of edited.items) {
      const original = item.source ? sources[item.source.paragraph]?.[item.source.item] : undefined;
      if (item.kind === 'field' || item.kind === 'break') {
        const kept = original && original.localName === (item.kind === 'field' ? 'fld' : 'br') ? original : undefined;
        paragraph.appendChild(kept ? kept.cloneNode(true) : doc.createElementNS(DRAWINGML, 'a:br'));
        continue;
      }
      const template = original?.localName === 'r' ? original : (previousRun ?? firstRunOf(edited.source) ?? firstRunOf(0));
      const run = doc.createElementNS(DRAWINGML, 'a:r');
      const templateProps = template && child(template, DRAWINGML, 'rPr');
      const rPr = templateProps ? (templateProps.cloneNode(true) as Element) : hasFormat(item.format) ? doc.createElementNS(DRAWINGML, 'a:rPr') : undefined;
      if (rPr) {
        applyFormat(rPr, item.format);
        run.appendChild(rPr);
      }
      const t = doc.createElementNS(DRAWINGML, 'a:t');
      t.textContent = item.text;
      run.appendChild(t);
      paragraph.appendChild(run);
      previousRun = run;
    }
    const end = source && child(source, DRAWINGML, 'endParaRPr');
    if (end) paragraph.appendChild(end.cloneNode(true));
    body.insertBefore(paragraph, anchor);
  }
  return writePart(xml, doc, tools);
}

/** A transform in EMU. */
export interface ShapeBox {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/**
 * Gives a shape its own position and size (D-150): placeholders usually inherit both from the layout, and the library
 * moves only shapes with an `a:xfrm` of their own. The transform becomes the first child of the shape properties.
 */
export function setShapeBox(xml: string, shapeId: string, box: ShapeBox, tools: XmlTools): string {
  const doc = parsePart(xml, tools);
  const shape = shapeById(doc, shapeId);
  const properties = child(shape, PRESENTATIONML, shape.localName === 'grpSp' ? 'grpSpPr' : 'spPr');
  if (!properties) throw new XmlPartError('the shape has no properties');
  let xfrm = child(properties, DRAWINGML, 'xfrm');
  if (!xfrm) {
    xfrm = doc.createElementNS(DRAWINGML, 'a:xfrm');
    properties.insertBefore(xfrm, properties.firstChild);
  }
  const off = child(xfrm, DRAWINGML, 'off') ?? xfrm.insertBefore(doc.createElementNS(DRAWINGML, 'a:off'), xfrm.firstChild);
  const ext = child(xfrm, DRAWINGML, 'ext') ?? xfrm.insertBefore(doc.createElementNS(DRAWINGML, 'a:ext'), off.nextSibling);
  off.setAttribute('x', String(Math.round(box.offsetX)));
  off.setAttribute('y', String(Math.round(box.offsetY)));
  ext.setAttribute('cx', String(Math.round(box.width)));
  ext.setAttribute('cy', String(Math.round(box.height)));
  return writePart(xml, doc, tools);
}

/** The `cNvPr` ID of a notes slide's body placeholder (the speaker notes), or null when it has none. */
export function notesBodyId(xml: string, tools: XmlTools): string | null {
  const doc = parsePart(xml, tools);
  for (const ph of Array.from(doc.getElementsByTagNameNS(PRESENTATIONML, 'ph'))) {
    if (ph.getAttribute('type') !== 'body') continue;
    const shape = ph.parentElement?.parentElement?.parentElement;
    const id = shape?.getElementsByTagNameNS(PRESENTATIONML, 'cNvPr')[0]?.getAttribute('id');
    if (shape?.localName === 'sp' && id) return id;
  }
  return null;
}

/** Plain text of paragraphs: a line per paragraph and per line break, fields as their shown text. */
export function plainText(paragraphs: readonly TextParagraph[]): string {
  return paragraphs.map((p) => p.items.map((item) => (item.kind === 'break' ? '\n' : item.text)).join('')).join('\n');
}

/** Paragraphs for plain text, each line a run formatted like the first run of the first paragraph. */
export function plainParagraphs(text: string, hasSource: boolean): EditedParagraph[] {
  return text.split(/\r\n|\r|\n/).map((line) => ({
    source: hasSource ? 0 : null,
    items: line === '' ? [] : [{ kind: 'run', text: line, source: null, format: {} }],
  }));
}
