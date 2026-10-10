import type { DocumentKind } from '../../../shared/documents/kinds';
import { MAX_DOCUMENT_TEXT_CHARS } from '../../../shared/documents/limits';
import type { Logger } from '../../services/logger';
import { readHead } from '../document-check';
import { MAX_XML_PART_BYTES, numberedParts, openOoxml, type OoxmlKind } from '../ooxml-package';
import { decodeText } from '../text-encoding';
import { htmlToText } from './html-text';
import { presentationReadingOrder, type PartReader } from './presentation-text';
import { attributeValues, DRAWING_TEXT, officeXmlText, SHARED_STRING_TEXT, wordXmlText, worksheetCellText, type TextVocabulary } from './office-xml-text';

/** Reads the searchable text of a document file. Throwing is allowed; the caller indexes the title only then. */
export type DocumentTextExtractor = (file: string) => Promise<string>;

/** CSV and HTML files are indexed from their first 8 MiB. */
const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;

async function textFile(file: string): Promise<string> {
  const head = await readHead(file, MAX_TEXT_FILE_BYTES);
  return decodeText(head, head.length === MAX_TEXT_FILE_BYTES);
}

/** The parts of a package to read for text, in reading order, and how each one's text is found. */
type PartPlan = (names: ReadonlySet<string>, read: PartReader) => Promise<Array<{ part: string; read: (xml: string) => string }>>;

async function packageText(file: string, kind: OoxmlKind, plan: PartPlan): Promise<string> {
  const archive = await openOoxml(file, kind);
  if (!archive) return '';
  try {
    const readXml: PartReader = async (part) =>
      archive.names.has(part) && archive.size(part) <= MAX_XML_PART_BYTES ? (await archive.read(part, MAX_XML_PART_BYTES)).toString('utf8') : null;
    const out: string[] = [];
    let length = 0;
    for (const { part, read } of await plan(archive.names, readXml)) {
      if (length >= MAX_DOCUMENT_TEXT_CHARS) break;
      const xml = await readXml(part);
      if (xml === null) continue;
      const text = read(xml);
      out.push(text);
      length += text.length;
    }
    return out.join('\n');
  } finally {
    archive.close();
  }
}

/** Word's body is read first, then headers and footers, then notes and comments (D-145). */
const WORD_BODY = ['word/document.xml'];
const WORD_NOTES = ['word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml'];

const using = (v: TextVocabulary) => (xml: string) => officeXmlText(xml, v);

export type DocumentTextExtractors = Readonly<Partial<Record<DocumentKind, DocumentTextExtractor>>>;

/**
 * The extractors that read files in main itself (D-121). PDF text comes from a worker thread (D-129), so it is added
 * by documentTextExtractors with the worker's location. A kind without an extractor is found by its title only.
 */
export const DOCUMENT_TEXT_EXTRACTORS: DocumentTextExtractors = {
  docx: (file) =>
    packageText(file, 'docx', async (names) =>
      [...WORD_BODY, ...numberedParts(names, /^word\/header(\d+)\.xml$/), ...numberedParts(names, /^word\/footer(\d+)\.xml$/), ...WORD_NOTES].map((part) => ({
        part,
        read: wordXmlText,
      })),
    ),
  pptx: (file) =>
    packageText(file, 'pptx', async (names, read) =>
      ((await presentationReadingOrder(read)) ?? [...numberedParts(names, /^ppt\/slides\/slide(\d+)\.xml$/), ...numberedParts(names, /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/)]).map(
        (part) => ({ part, read: using(DRAWING_TEXT) }),
      ),
    ),
  xlsx: (file) =>
    packageText(file, 'xlsx', async (names) => [
      { part: 'xl/workbook.xml', read: (xml) => attributeValues(xml, 'sheet', 'name').join('\n') },
      { part: 'xl/sharedStrings.xml', read: using(SHARED_STRING_TEXT) },
      ...numberedParts(names, /^xl\/worksheets\/sheet(\d+)\.xml$/).map((part) => ({ part, read: worksheetCellText })),
    ]),
  csv: textFile,
  html: async (file) => htmlToText(await textFile(file)),
};

/** At most MAX_DOCUMENT_TEXT_CHARS, never ending inside a surrogate pair. */
function capped(text: string): string {
  if (text.length <= MAX_DOCUMENT_TEXT_CHARS) return text;
  const cut = text.slice(0, MAX_DOCUMENT_TEXT_CHARS);
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** Every kind's extractor: the in-process ones, and PDF through its worker. */
export function documentTextExtractors(pdf: DocumentTextExtractor): DocumentTextExtractors {
  return { ...DOCUMENT_TEXT_EXTRACTORS, pdf };
}

/** Reads the searchable text of document files with the extractors it is given. */
export class DocumentText {
  constructor(
    private readonly extractors: DocumentTextExtractors,
    private readonly logger: Logger,
  ) {}

  /** The searchable text of a document file; empty when its kind has no extractor or the file cannot be read. */
  async of(kind: DocumentKind, file: string): Promise<string> {
    const extract = this.extractors[kind];
    if (!extract) return '';
    try {
      return capped((await extract(file)).trim());
    } catch (err) {
      // The error names the file path, which stays out of the log.
      this.logger.warn(`documents: text extraction failed kind=${kind} error=${(err as NodeJS.ErrnoException).code ?? (err as Error).name}`);
      return '';
    }
  }
}
