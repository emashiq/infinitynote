import type { EditedItem, EditedParagraph, RunFormat, TextParagraph } from './pptx-xml';

/**
 * The editable text of a shape in the page (F5, D-151): a block per paragraph, a span per run carrying where it came
 * from (`data-p`, `data-i`) and the formatting set while editing (`data-bold`, …). Chromium copies a span's attributes
 * when Enter splits it, so text typed or split keeps its run; reading the blocks back gives edited paragraphs.
 */

const FORMAT_KEYS = ['bold', 'italic', 'underline', 'sizePt', 'color'] as const;

/** How text is drawn in the editor: points become pixels at the slide's scale. */
export interface TextLook {
  pxPerPt: number;
  defaultSizePt: number;
}

function formatOf(element: HTMLElement): RunFormat {
  const format: RunFormat = {};
  const { bold, italic, underline, size, color } = element.dataset;
  if (bold !== undefined) format.bold = bold === '1';
  if (italic !== undefined) format.italic = italic === '1';
  if (underline !== undefined) format.underline = underline === '1';
  if (size !== undefined && Number(size) > 0) format.sizePt = Number(size);
  if (color !== undefined && /^[0-9A-F]{6}$/.test(color)) format.color = color;
  return format;
}

function setFormat(element: HTMLElement, format: RunFormat) {
  if (format.bold !== undefined) element.dataset.bold = format.bold ? '1' : '0';
  if (format.italic !== undefined) element.dataset.italic = format.italic ? '1' : '0';
  if (format.underline !== undefined) element.dataset.underline = format.underline ? '1' : '0';
  if (format.sizePt !== undefined) element.dataset.size = String(format.sizePt);
  if (format.color !== undefined) element.dataset.color = format.color;
}

/** The run's look: its own formatting from the file under the changes made while editing. */
function styleRun(span: HTMLElement, base: RunFormat, look: TextLook) {
  const format = { ...base, ...formatOf(span) };
  span.style.fontWeight = format.bold ? '700' : '';
  span.style.fontStyle = format.italic ? 'italic' : '';
  span.style.textDecoration = format.underline ? 'underline' : '';
  span.style.fontSize = `${(format.sizePt ?? look.defaultSizePt) * look.pxPerPt}px`;
  span.style.color = format.color ? `#${format.color}` : '';
}

/** The look the editor was filled with, kept on it for formatting later. */
function lookOf(root: HTMLElement): TextLook {
  return { pxPerPt: Number(root.dataset.pxPerPt) || 1, defaultSizePt: Number(root.dataset.defaultSizePt) || 18 };
}

/** Fills the editor with a shape's paragraphs. */
export function fillEditor(root: HTMLElement, paragraphs: readonly TextParagraph[], look: TextLook) {
  const doc = root.ownerDocument;
  root.replaceChildren();
  root.dataset.pxPerPt = String(look.pxPerPt);
  root.dataset.defaultSizePt = String(look.defaultSizePt);
  root.style.fontSize = `${look.defaultSizePt * look.pxPerPt}px`;
  paragraphs.forEach((paragraph, p) => {
    const block = doc.createElement('div');
    block.dataset.p = String(p);
    paragraph.items.forEach((item, i) => {
      if (item.kind === 'break') {
        const br = doc.createElement('br');
        br.dataset.p = String(p);
        br.dataset.i = String(i);
        block.appendChild(br);
        return;
      }
      const span = doc.createElement('span');
      span.dataset.p = String(p);
      span.dataset.i = String(i);
      span.textContent = item.text;
      if (item.kind === 'field') {
        span.dataset.kind = 'field';
        span.contentEditable = 'false';
      } else {
        styleRun(span, item.format, look);
      }
      block.appendChild(span);
    });
    // An empty block has no height; the placeholder break is not part of the text.
    if (block.childNodes.length === 0) block.appendChild(doc.createElement('br'));
    root.appendChild(block);
  });
  if (paragraphs.length === 0) root.appendChild(doc.createElement('div')).appendChild(doc.createElement('br'));
}

const sourceOf = (element: HTMLElement | null): EditedItem['source'] =>
  element && element.dataset.p !== undefined && element.dataset.i !== undefined ? { paragraph: Number(element.dataset.p), item: Number(element.dataset.i) } : null;

const BLOCKS = new Set(['DIV', 'P']);

/** The paragraphs the editor holds, with each run's source and the formatting set on it. */
export function readEditor(root: HTMLElement): EditedParagraph[] {
  const out: EditedParagraph[] = [];
  let current: EditedParagraph | null = null;
  const start = (source: number | null) => {
    current = { source, items: [] };
    out.push(current);
    return current;
  };
  const paragraph = (source: number | null) => current ?? start(source);
  const addText = (text: string, span: HTMLElement | null, source: number | null) => {
    // Pasted or typed line breaks end paragraphs.
    text.split('\n').forEach((line, n) => {
      const target = n === 0 ? paragraph(source) : start(source);
      if (line === '') return;
      const from = sourceOf(span);
      const format = span ? formatOf(span) : {};
      const last = target.items[target.items.length - 1];
      if (last && last.kind === 'run' && sameSource(last.source, from) && sameFormat(last.format, format)) last.text += line;
      else target.items.push({ kind: 'run', text: line, source: from, format });
    });
  };
  const walk = (node: Node, span: HTMLElement | null, source: number | null) => {
    if (node.nodeType === 3) return addText(node.textContent ?? '', span, source);
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (BLOCKS.has(element.tagName)) {
      const own = element.dataset.p !== undefined ? Number(element.dataset.p) : source;
      start(own);
      element.childNodes.forEach((n) => walk(n, null, own));
      current = null;
      return;
    }
    if (element.tagName === 'BR') {
      // The break of an empty block, or the one Chromium leaves at a block's end, is not text.
      if (element.dataset.i === undefined && element.nextSibling === null) return;
      paragraph(source).items.push({ kind: 'break', text: '', source: sourceOf(element), format: {} });
      return;
    }
    if (element.dataset.kind === 'field') {
      paragraph(source).items.push({ kind: 'field', text: element.textContent ?? '', source: sourceOf(element), format: {} });
      return;
    }
    // A run's span, or the span formatting made around loose text.
    const runSpan = element.dataset.i !== undefined || Object.keys(formatOf(element)).length > 0 ? element : span;
    element.childNodes.forEach((n) => walk(n, runSpan, source));
  };
  root.childNodes.forEach((n) => {
    walk(n, null, null);
  });
  return out;
}

const sameSource = (a: EditedItem['source'], b: EditedItem['source']) => (a === null ? b === null : b !== null && a.paragraph === b.paragraph && a.item === b.item);
const sameFormat = (a: RunFormat, b: RunFormat) => FORMAT_KEYS.every((k) => a[k] === b[k]);

/** The number of characters the paragraphs hold. */
export const editedLength = (paragraphs: readonly EditedParagraph[]) => paragraphs.reduce((n, p) => n + p.items.reduce((m, item) => m + item.text.length, 0) + 1, 0);

/**
 * Sets formatting on the selected text of the editor: the selected part of each run becomes its own span (same source)
 * with the formatting, drawn at once. With nothing selected the whole text gets it.
 */
export function formatSelection(root: HTMLElement, format: RunFormat, bases: (span: HTMLElement) => RunFormat) {
  const doc = root.ownerDocument;
  const look = lookOf(root);
  const selection = doc.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const inside = range && !range.collapsed && root.contains(range.commonAncestorContainer) ? range : null;
  const walker = doc.createTreeWalker(root, 4);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!inside || inside.intersectsNode(node)) texts.push(node as Text);
  for (const text of texts) {
    if (text.parentElement?.closest('[data-kind="field"]')) continue;
    const run = text.parentElement?.closest<HTMLElement>('span[data-i]') ?? null;
    let target = text;
    if (inside) {
      const from = inside.startContainer === text ? inside.startOffset : 0;
      const to = inside.endContainer === text ? inside.endOffset : text.length;
      if (from >= to) continue;
      if (to < target.length) target.splitText(to);
      if (from > 0) target = target.splitText(from);
    }
    // A run whose whole text is selected (or that holds more than plain text) takes the formatting itself.
    if (run && (run.childNodes.length === 1 || target.parentElement !== run)) {
      setFormat(run, format);
      styleRun(run, bases(run), look);
      continue;
    }
    // Otherwise the selected text becomes its own span between the parts before and after it, all of the same run.
    const piece = (run ? run.cloneNode(false) : doc.createElement('span')) as HTMLElement;
    setFormat(piece, format);
    if (run) {
      const after = run.cloneNode(false) as HTMLElement;
      while (target.nextSibling) after.appendChild(target.nextSibling);
      run.after(piece);
      piece.appendChild(target);
      if (after.hasChildNodes()) piece.after(after);
      if (!run.hasChildNodes()) run.remove();
    } else {
      target.replaceWith(piece);
      piece.appendChild(target);
    }
    styleRun(piece, bases(piece), look);
  }
}

/** Paragraphs as the editor reads them back when nothing was changed: every non-empty item kept from its source. */
export function asEdited(paragraphs: readonly TextParagraph[]): EditedParagraph[] {
  return paragraphs.map((p, paragraph) => ({
    source: paragraph,
    items: p.items.flatMap((item, index): EditedItem[] =>
      item.kind === 'break' || item.text !== '' ? [{ kind: item.kind, text: item.kind === 'break' ? '' : item.text, source: { paragraph, item: index }, format: {} }] : [],
    ),
  }));
}

/** The formatting a run of the editor shows: its own from the file under what was set while editing. */
export function shownFormat(span: HTMLElement, paragraphs: readonly TextParagraph[]): RunFormat {
  const item = paragraphs[Number(span.dataset.p)]?.items[Number(span.dataset.i)];
  return { ...(item?.kind === 'run' ? item.format : {}), ...formatOf(span) };
}
