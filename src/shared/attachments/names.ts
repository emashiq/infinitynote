const MAX_NAME_LENGTH = 255;
/** Control characters and the characters Windows forbids in file names. */
function isUnsafeChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code < 0x20 || code === 0x7f || '<>:"|?*'.includes(ch);
}

/** The display name kept for an imported file: the last path segment, without unsafe characters, at most 255 characters. */
export function sanitizeOriginalName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = [...base].filter((ch) => !isUnsafeChar(ch)).join('').trim();
  if (clean === '' || clean === '.' || clean === '..') return null;
  return clean.length > MAX_NAME_LENGTH ? clean.slice(0, MAX_NAME_LENGTH) : clean;
}

/** The stored extension for a document: the name's extension when it is 1-10 letters or digits, else `bin`. */
export function extensionFor(name: string | null | undefined): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name ?? '');
  return m ? m[1]!.toLowerCase() : 'bin';
}

const DOCUMENT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip',
};

/** The recorded MIME type of a document from its extension (never used to serve or open it). */
export function documentMime(ext: string): string {
  return DOCUMENT_MIME[ext] ?? 'application/octet-stream';
}

/** A file size for people: bytes, KB or MB with one decimal. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'gif', 'webp']);

/**
 * Whether a stored file may be handed to the OS to open (INF-REF-08): only the known document types and the app's
 * image types. Anything else (programs, scripts, shortcuts, unknown types) is never launched; Show in folder still works.
 */
export function isOpenableExtension(ext: string): boolean {
  return Object.hasOwn(DOCUMENT_MIME, ext) || IMAGE_EXTENSIONS.has(ext);
}
