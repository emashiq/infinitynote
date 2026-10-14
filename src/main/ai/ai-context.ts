import fs from 'node:fs';
import { AI_MESSAGES, MAX_AI_FILE_BYTES, MAX_AI_FILE_OPTIONS, MAX_AI_ITEM_CHARS, MAX_AI_TOTAL_BYTES } from '../../shared/ai/limits';
import { extensionFor, sanitizeOriginalName } from '../../shared/attachments/names';
import { sniffImage } from '../../shared/attachments/sniff';
import type { AiFileKindType, AiFileOptionType, AiFileRefType } from '../../shared/contracts/ai';
import type { CommentTargetType } from '../../shared/contracts/comments';
import { DOCUMENT_KIND_INFO, documentKindOf, type DocumentKind } from '../../shared/documents/kinds';
import type { Db } from '../db/driver';
import { AttachmentsRepo } from '../db/repositories/attachments-repo';
import { DocumentsRepo } from '../db/repositories/documents-repo';
import { LinkedFilesRepo } from '../db/repositories/linked-files-repo';
import { NotesRepo } from '../db/repositories/notes-repo';
import { ReferencesRepo } from '../db/repositories/references-repo';
import type { DocumentFiles } from '../documents/document-files';
import type { DocumentText } from '../documents/text/document-text';
import { AppError } from '../services/app-error';
import { containedAttachmentFile } from '../services/attachment-files';
import { inspectLinkedFile } from '../services/linked-file';

/** A file read for one action: its bytes, and its text where the engine gets text. */
export interface PreparedFile {
  name: string;
  sizeBytes: number;
  kind: AiFileKindType;
  mime: string;
  bytes: Buffer;
  /** The text of a text file, or the words of a document (Word, PowerPoint, spreadsheet, web page); null otherwise. */
  text: string | null;
  /** The text was taken out of a document, so a command-line tool gets it as a .txt file instead of the original. */
  extracted: boolean;
}

/**
 * A file of an action and its place, which names its copy in a tool's working folder: the item's files by their place in
 * the thread's file list (from 1), files picked from disk after them, the whole item 0. The places stay the same for every
 * turn of a thread, so a resumed session finds its files under the names it was told (D-195).
 */
export interface PlacedFile {
  file: PreparedFile;
  place: number;
}

/** The place of the whole note or document among an action's files. */
export const WHOLE_ITEM_PLACE = 0;

/** Files read as text by their extension; any other file is text when it is valid UTF-8 without NUL bytes. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'ini', 'toml', 'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx',
  'py', 'java', 'c', 'h', 'cpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'ps1', 'sql', 'rtf', 'tex',
]);
/** Documents whose words the app can take out (D-129); the files themselves are sent as their text. */
const EXTRACTED_KINDS: ReadonlySet<DocumentKind> = new Set(['docx', 'pptx', 'xlsx', 'html']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const SNIFF_BYTES = 8192;

/** How a file reaches an engine, judged by its name before it is read (the panel's list). */
export function fileKindByName(name: string): AiFileKindType | null {
  const ext = extensionFor(name);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  const kind = documentKindOf(name);
  if ((kind && EXTRACTED_KINDS.has(kind)) || TEXT_EXTENSIONS.has(ext)) return 'text';
  return null;
}

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const capText = (text: string): string => (text.length > MAX_AI_ITEM_CHARS ? `${text.slice(0, MAX_AI_ITEM_CHARS)}\n[… cut at ${MAX_AI_ITEM_CHARS.toLocaleString('en')} characters]` : text);

/** A source the app resolved to a real file, with the name it shows. */
interface SourceFile {
  name: string;
  path: string;
  sizeBytes: number;
}

const tooLarge = (size: number): string | null => (size > MAX_AI_FILE_BYTES ? AI_MESSAGES.fileTooLarge : null);

/**
 * What an AI action can send about an item (D-190): the files a note attached or linked and the documents it links to
 * (never a locked document), the whole note or document, and files picked from disk. Files are read only for an action,
 * within the size limits; images and PDFs go as they are, documents as their words, other files as text when they are
 * text. Paths come from the database or main's file dialog, never from a renderer.
 */
export class AiContext {
  private readonly notes: NotesRepo;
  private readonly documents: DocumentsRepo;
  private readonly attachments: AttachmentsRepo;
  private readonly links: LinkedFilesRepo;
  private readonly references: ReferencesRepo;

  constructor(
    db: Db,
    private readonly deps: { dataDir: string; files: DocumentFiles; text: DocumentText },
  ) {
    this.notes = new NotesRepo(db);
    this.documents = new DocumentsRepo(db);
    this.attachments = new AttachmentsRepo(db);
    this.links = new LinkedFilesRepo(db);
    this.references = new ReferencesRepo(db);
  }

  /** The files of a note the Ask AI panel offers, with why one cannot be sent. Documents offer none (their whole text is one switch). */
  async options(target: CommentTargetType): Promise<AiFileOptionType[]> {
    if (target.kind !== 'note') return [];
    const refs: AiFileRefType[] = [
      ...this.attachments.linkedIds(target.id).map((id) => ({ type: 'attachment' as const, id })),
      ...this.links.usedBy(target.id).map((id) => ({ type: 'link' as const, id })),
      ...this.linkedDocumentIds(target.id).map((id) => ({ type: 'document' as const, id })),
    ].slice(0, MAX_AI_FILE_OPTIONS);
    const options: AiFileOptionType[] = [];
    for (const ref of refs) {
      const source = await this.resolve(target, ref).catch(() => null);
      if (!source) continue;
      const kind = fileKindByName(source.name);
      options.push({ ref, name: source.name, sizeBytes: source.sizeBytes, kind: kind ?? 'text', problem: kind ? tooLarge(source.sizeBytes) : 'This kind of file cannot be sent' });
    }
    return options;
  }

  /**
   * Reads the chosen files of the item and the picked paths within the limits: NOT_FOUND, LIMIT_EXCEEDED or UNSUPPORTED
   * otherwise. A follow-up skips the item's files that are gone since (`skipMissing`).
   */
  async gather(target: CommentTargetType, refs: readonly AiFileRefType[], picked: readonly string[], opts: { skipMissing?: boolean } = {}): Promise<PlacedFile[]> {
    const sources: Array<{ source: SourceFile; place: number }> = [];
    for (const [i, ref] of refs.entries()) {
      const source = await this.resolve(target, ref).catch(() => null);
      if (source) sources.push({ source, place: i + 1 });
      else if (!opts.skipMissing) throw new AppError('NOT_FOUND', AI_MESSAGES.fileMissing);
    }
    for (const [i, path] of picked.entries()) {
      const stat = await fs.promises.stat(path).catch(() => null);
      if (!stat?.isFile()) throw new AppError('NOT_FOUND', AI_MESSAGES.fileMissing);
      sources.push({ source: { name: sanitizeOriginalName(path) ?? 'file', path, sizeBytes: stat.size }, place: refs.length + i + 1 });
    }
    if (sources.some(({ source }) => source.sizeBytes > MAX_AI_FILE_BYTES)) throw new AppError('LIMIT_EXCEEDED', AI_MESSAGES.fileTooLarge);
    if (sources.reduce((sum, { source }) => sum + source.sizeBytes, 0) > MAX_AI_TOTAL_BYTES) throw new AppError('LIMIT_EXCEEDED', AI_MESSAGES.tooMuch);
    const files: PlacedFile[] = [];
    for (const { source, place } of sources) files.push({ file: await this.read(source), place });
    return files;
  }

  /** The whole note's text or document: a note's or web page's words, a PDF as its file. */
  async wholeItem(target: CommentTargetType): Promise<{ text: string } | { file: PreparedFile }> {
    if (target.kind === 'note') return { text: capText(this.notes.getContentRow(target.id)?.plain_text ?? '') };
    const row = this.documents.get(target.id);
    const resolved = row ? await this.deps.files.resolveLive(row.id) : null;
    if (!row || !resolved) throw new AppError('NOT_FOUND', AI_MESSAGES.fileMissing);
    if (row.kind === 'pdf') return { file: await this.read({ name: `${row.title}.pdf`, path: resolved.file, sizeBytes: resolved.sizeBytes }) };
    return { text: capText(await this.deps.text.of(row.kind, resolved.file)) };
  }

  /** The item as the prompt names it ("the note “Plan”", "the PDF document “Report”"). */
  describe(target: CommentTargetType): string {
    if (target.kind === 'note') return `the note “${this.notes.getContentRow(target.id)?.title || 'Untitled'}”`;
    const row = this.documents.get(target.id);
    if (!row) return 'the document';
    return `the ${row.kind === 'html' ? 'web page' : `${DOCUMENT_KIND_INFO[row.kind].label} document`} “${row.title}”`;
  }

  /** Live documents the note links to that are not locked. */
  private linkedDocumentIds(noteId: string): string[] {
    const ids = new Set(this.references.documentOutgoing(noteId, MAX_AI_FILE_OPTIONS).map((r) => r.target_document_id));
    return [...ids].filter((id) => {
      const row = this.documents.get(id);
      return row !== undefined && row.deleted_at === null && row.locked === 0;
    });
  }

  /** The real file behind a reference of the item, checked to belong to it; null when it is gone or not the item's. */
  private async resolve(target: CommentTargetType, ref: AiFileRefType): Promise<SourceFile | null> {
    if (target.kind !== 'note') return null;
    if (ref.type === 'attachment') {
      const row = this.attachments.isLinked(target.id, ref.id) ? this.attachments.get(ref.id) : undefined;
      const file = row ? await containedAttachmentFile(this.deps.dataDir, row.managed_relative_path) : null;
      if (!row || !file) return null;
      const name = row.original_name ?? `attachment.${row.managed_relative_path.split('.').pop() ?? 'bin'}`;
      return { name, path: file, sizeBytes: row.size_bytes };
    }
    if (ref.type === 'link') {
      const row = this.links.isUsedBy(target.id, ref.id) ? this.links.get(ref.id) : undefined;
      const check = row ? await inspectLinkedFile(row.path) : null;
      if (!row || !check?.real || check.sizeBytes === null) return null;
      return { name: row.name, path: check.real, sizeBytes: check.sizeBytes };
    }
    if (!this.linkedDocumentIds(target.id).includes(ref.id)) return null;
    const row = this.documents.get(ref.id)!;
    const resolved = await this.deps.files.resolveLive(ref.id);
    if (!resolved || resolved.blob?.sealed) return null;
    return { name: `${row.title}.${DOCUMENT_KIND_INFO[row.kind].extension}`, path: resolved.file, sizeBytes: resolved.sizeBytes };
  }

  private async read(source: SourceFile): Promise<PreparedFile> {
    const bytes = await fs.promises.readFile(source.path).catch(() => {
      throw new AppError('NOT_FOUND', AI_MESSAGES.fileMissing);
    });
    if (bytes.length > MAX_AI_FILE_BYTES) throw new AppError('LIMIT_EXCEEDED', AI_MESSAGES.fileTooLarge);
    const base = { name: source.name, sizeBytes: bytes.length, bytes };
    const image = sniffImage(bytes);
    if (image.ok) return { ...base, kind: 'image', mime: image.mime, text: null, extracted: false };
    if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return { ...base, kind: 'pdf', mime: 'application/pdf', text: null, extracted: false };
    const documentKind = documentKindOf(source.name);
    if (documentKind && EXTRACTED_KINDS.has(documentKind)) {
      return { ...base, kind: 'text', mime: 'text/plain', text: capText(await this.deps.text.of(documentKind, source.path)), extracted: true };
    }
    if (isUtf8Text(bytes)) return { ...base, kind: 'text', mime: 'text/plain', text: capText(bytes.toString('utf8')), extracted: false };
    throw new AppError('UNSUPPORTED', `${source.name} cannot be sent: only images, PDFs, documents and text files can`);
  }
}
