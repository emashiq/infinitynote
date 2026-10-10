import { decodeXmlEntities } from './entities';

/** The element names that carry text in one Office XML vocabulary. */
export interface TextVocabulary {
  /** Holds characters (`a:t` in PowerPoint, `t` in Excel strings). */
  text: string;
  /** Ends a line of text (a paragraph, or a shared string). */
  block: string;
  lineBreak?: string;
}

export const DRAWING_TEXT: TextVocabulary = { text: 'a:t', block: 'a:p', lineBreak: 'a:br' };
export const SHARED_STRING_TEXT: TextVocabulary = { text: 't', block: 'si' };

/**
 * The text of an Office XML part for search: the characters of every text element in document order, a line break
 * after each block and each line break. A regular scan is enough here; the part is never rendered from this.
 */
export function officeXmlText(xml: string, v: TextVocabulary): string {
  const alternatives = [`<${v.text}(?:\\s[^>]*)?>([^<]*)</${v.text}>`, `</${v.block}>`];
  if (v.lineBreak) alternatives.push(`<${v.lineBreak}(?:\\s[^>]*)?/>`);
  let out = '';
  for (const m of xml.matchAll(new RegExp(alternatives.join('|'), 'g'))) out += m[1] !== undefined ? decodeXmlEntities(m[1]) : '\n';
  return out;
}

/**
 * The text of a WordprocessingML part (body, header, footer, notes, comments) for search (D-145): like officeXmlText,
 * with each table row on one line and its cells separated by a tab (paragraphs inside a cell joined by a space), so
 * a row reads as it does on the page. Deleted text of tracked changes (`w:delText`) and field codes (`w:instrText`)
 * are not text.
 */
export function wordXmlText(xml: string): string {
  let out = '';
  let cells = 0;
  const trimEnd = (chars: string) => {
    while (out.length > 0 && chars.includes(out[out.length - 1]!)) out = out.slice(0, -1);
  };
  // A tab in a run has no attributes; `<w:tab w:val=… w:pos=…/>` is a tab stop definition.
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\s*\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>|<w:tc(?:\s[^>]*)?>|<\/w:tc>|<\/w:tr>/g)) {
    const token = m[0];
    if (m[1] !== undefined) out += decodeXmlEntities(m[1]);
    else if (token === '</w:p>') out += cells > 0 ? ' ' : '\n';
    else if (token.startsWith('<w:tab')) out += '\t';
    else if (token.startsWith('<w:br') || token.startsWith('<w:cr')) out += cells > 0 ? ' ' : '\n';
    else if (token.startsWith('<w:tc')) cells += 1;
    else if (token === '</w:tc>') {
      cells = Math.max(0, cells - 1);
      trimEnd(' ');
      out += cells > 0 ? ' ' : '\t';
    } else {
      // </w:tr>: the row ends its line.
      trimEnd('\t ');
      out += cells > 0 ? ' ' : '\n';
    }
  }
  return out;
}

/** The decoded values of one attribute on every element of a name (sheet names in a workbook). */
export function attributeValues(xml: string, element: string, attribute: string): string[] {
  const re = new RegExp(`<${element}\\s[^>]*\\b${attribute}="([^"]*)"`, 'g');
  return [...xml.matchAll(re)].map((m) => decodeXmlEntities(m[1]!));
}

/**
 * The values a worksheet part holds itself (F3, D-138): numbers, formula results and inline strings, a tab between
 * cells and a line per row. Cells of shared strings (`t="s"`) hold only an index, so they are skipped: their text comes
 * from the shared strings part. Booleans and errors carry no searchable text.
 */
export function worksheetCellText(xml: string): string {
  let out = '';
  let line: string[] = [];
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)|<\/row>/g)) {
    if (m[0] === '</row>') {
      if (line.length > 0) out += `${line.join('\t')}\n`;
      line = [];
      continue;
    }
    const type = /\bt="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? 'n';
    const body = m[2] ?? '';
    const value =
      type === 'inlineStr'
        ? [...body.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join('')
        : type === 'n' || type === 'str'
          ? (/<v>([^<]*)<\/v>/.exec(body)?.[1] ?? '')
          : '';
    if (value !== '') line.push(decodeXmlEntities(value));
  }
  return line.length > 0 ? `${out}${line.join('\t')}` : out;
}
