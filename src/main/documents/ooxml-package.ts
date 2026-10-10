import type { DocumentKind } from '../../shared/documents/kinds';
import { openArchive, type ArchiveLimits, type OpenedArchive } from '../portability/zip-archive';

export type OoxmlKind = Extract<DocumentKind, 'docx' | 'pptx' | 'xlsx'>;

/**
 * Preflight bounds for Office files (plan "Untrusted files"): far fewer entries than a backup, a 1 GiB declared total
 * and a compression ratio that real spreadsheets stay under while zip bombs do not.
 */
export const OOXML_LIMITS: ArchiveLimits = { maxEntries: 10_000, maxTotalBytes: 1024 ** 3, maxRatio: 200, ratioFloorBytes: 1024 * 1024 };

/** The largest single XML part read for text. */
export const MAX_XML_PART_BYTES = 32 * 1024 * 1024;

/** The part every Office package names its parts' content types in. */
export const CONTENT_TYPES = '[Content_Types].xml';

/** The part every package of a kind has. */
export const MAIN_PART: Readonly<Record<OoxmlKind, string>> = {
  docx: 'word/document.xml',
  pptx: 'ppt/presentation.xml',
  xlsx: 'xl/workbook.xml',
};

/**
 * Opens an Office package after the zip preflight. Null when the file is not a zip within the bounds, or lacks the
 * content types or the main part of its kind. The caller closes the archive.
 */
export async function openOoxml(file: string, kind: OoxmlKind): Promise<OpenedArchive | null> {
  let archive: OpenedArchive;
  try {
    archive = await openArchive(file, OOXML_LIMITS);
  } catch {
    return null;
  }
  if (archive.names.has(CONTENT_TYPES) && archive.names.has(MAIN_PART[kind])) return archive;
  archive.close();
  return null;
}

/** Part names matching `pattern` ordered by the number they carry (slide2 before slide10). */
export function numberedParts(names: ReadonlySet<string>, pattern: RegExp): string[] {
  const numbered: Array<[number, string]> = [];
  for (const name of names) {
    const m = pattern.exec(name);
    if (m) numbered.push([Number(m[1]), name]);
  }
  return numbered.sort((a, b) => a[0] - b[0]).map(([, name]) => name);
}
