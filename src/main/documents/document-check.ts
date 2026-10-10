import fs from 'node:fs';
import { OOXML_KINDS, type DocumentKind } from '../../shared/documents/kinds';
import { CONTENT_TYPES, openOoxml, type OoxmlKind } from './ooxml-package';
import { looksLikeText } from './text-encoding';

/** A PDF header may follow up to 1 KiB of other bytes (ISO 32000-1, 7.5.2 implementation note). */
const PDF_HEADER_WINDOW = 1024;
const PDF_HEADER = Buffer.from('%PDF-', 'latin1');
const TEXT_SAMPLE_BYTES = 64 * 1024;
/** The VBA project of a macro-enabled Office file (xlsm, docm, pptm), by its usual part name. */
const MACRO_PART = /(^|\/)vbaProject\.bin$/i;
/**
 * What a package's content types declare for macros, whatever the parts are called: a macro-enabled main part
 * (`application/vnd.ms-word.document.macroEnabled.main+xml` and its Excel and PowerPoint siblings) or a VBA project
 * (`application/vnd.ms-office.vbaProject`).
 */
const MACRO_CONTENT_TYPE = /macroEnabled|vbaProject/i;
/** Content types parts are a few KiB; a larger one is not read and the package is refused. */
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;

/** The first `count` bytes of a file (fewer for a shorter file). */
export async function readHead(file: string, count: number): Promise<Buffer> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(count);
    const { bytesRead } = await handle.read(buffer, 0, count, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Whether a file is a document of the given kind by its contents, never by its name (plan "Untrusted files"): a PDF
 * header, an Office package within the zip bounds that has its kind's main part and neither a macro part nor a macro
 * content type, or text for CSV and HTML. Checked
 * when a file is imported and again for every save before the bytes replace anything.
 */
export async function isDocumentOfKind(kind: DocumentKind, file: string): Promise<boolean> {
  try {
    if (OOXML_KINDS.has(kind)) {
      const archive = await openOoxml(file, kind as OoxmlKind);
      if (!archive) return false;
      try {
        // Macro-enabled files are never taken as their plain kind, so macros are neither kept nor handed on (D-136, D-143).
        if ([...archive.names].some((name) => MACRO_PART.test(name))) return false;
        const types = await archive.read(CONTENT_TYPES, MAX_CONTENT_TYPES_BYTES);
        return !MACRO_CONTENT_TYPE.test(types.toString('utf8'));
      } finally {
        archive.close();
      }
    }
    if (kind === 'pdf') return (await readHead(file, PDF_HEADER_WINDOW)).includes(PDF_HEADER);
    return looksLikeText(await readHead(file, TEXT_SAMPLE_BYTES));
  } catch {
    return false;
  }
}
