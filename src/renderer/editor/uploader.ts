import { Extension, type Editor, type JSONContent, type Range } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import {
  ATTACHMENT_MESSAGES,
  IMPORT_CONCURRENCY,
  importFailedMessage,
  maxBytes,
  MAX_FILES_PER_ACTION,
  tooLargeMessage,
  type AttachmentKindName,
} from '../../shared/attachments/limits';
import type { AttachmentDtoType } from '../../shared/contracts/attachments';
import type { Result } from '../../shared/contracts/envelope';
import { markPersistent } from './content';

export interface AttachmentLimits {
  imageMaxMb: number;
  documentMaxMb: number;
}

export interface UploaderDeps {
  importBytes: (req: { kind: AttachmentKindName; originalName?: string; bytes: Uint8Array }) => Promise<Result<{ attachment: AttachmentDtoType }>>;
  limits: () => AttachmentLimits;
  notify: (message: string) => void;
  newToken?: () => string;
}

interface Job {
  token: string;
  kind: AttachmentKindName;
  name: string;
  /** Reads the bytes when the job starts, so at most IMPORT_CONCURRENCY files are in memory. */
  read: () => Promise<Uint8Array>;
  /** Size known only after decoding (pasted data images) is checked when the job starts. */
  declaredSize: number;
}

const GENERIC_CLIPBOARD_NAME = 'image.png';
const PASTED_IMAGE_ALT = 'Pasted image';

export function kindOfFile(file: { type: string }): AttachmentKindName {
  return file.type.startsWith('image/') ? 'image' : 'document';
}

/** Alt text for an image file: its name without the extension, or "Pasted image" for clipboard bitmaps. */
export function altFromName(name: string): string {
  if (name === '' || name === GENERIC_CLIPBOARD_NAME) return PASTED_IMAGE_ALT;
  const base = name.replace(/\.[^.]+$/, '');
  return base === '' ? PASTED_IMAGE_ALT : base;
}

/** The editor node for an attachment that is already stored. */
export function attachmentNode(dto: AttachmentDtoType, name: string | null): JSONContent {
  if (dto.kind === 'image') {
    return { type: 'image', attrs: { attachmentId: dto.id, alt: altFromName(name ?? dto.originalName ?? ''), size: 'medium', width: dto.width, height: dto.height } };
  }
  return { type: 'fileAttachment', attrs: { attachmentId: dto.id, name: name ?? dto.originalName ?? 'file', sizeBytes: dto.sizeBytes, mime: dto.mime } };
}

/**
 * Inserts attachment blocks at a range and leaves a text cursor after them (adding an empty paragraph when no text
 * block follows), so the next keystroke or paste never replaces the block just inserted.
 */
export function insertBlocks(editor: Editor, range: Range, nodes: JSONContent[]): void {
  editor
    .chain()
    .insertContentAt(range, nodes)
    .command(({ tr }) => {
      if (!(tr.selection instanceof NodeSelection)) return true;
      const after = tr.selection.to;
      if (!tr.doc.nodeAt(after)?.isTextblock) tr.insert(after, editor.schema.nodes.paragraph!.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      return true;
    })
    .run();
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Imports pasted, dropped and data-URL files into managed attachments (D-054, plan section 9.5). Each file first
 * appears as an "Adding…" node with an upload token; at most two imports run at a time and a file's bytes are
 * read only when its import starts. Success fills in the attachment, failure removes the node with the message
 * from main. Completions are not undo steps; a redo of the insertion gets the finished attachment back.
 */
export class AttachmentUploader {
  private editor: Editor | null = null;
  private readonly queue: Job[] = [];
  private running = 0;
  private disposed = false;
  private readonly completed = new Map<string, Record<string, unknown>>();
  private readonly idleWaiters = new Set<() => void>();
  private readonly newToken: () => string;

  constructor(private readonly deps: UploaderDeps) {
    this.newToken = deps.newToken ?? (() => crypto.randomUUID());
  }

  /** Connects the uploader to its editor (again after a dispose, as React may unmount and remount effects). */
  bind(editor: Editor): void {
    this.editor = editor;
    this.disposed = false;
  }

  pending(): number {
    return this.running + this.queue.length;
  }

  /** Resolves true once no import is pending, or false after `ms`. */
  waitIdle(ms: number): Promise<boolean> {
    if (this.pending() === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.idleWaiters.delete(done);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.idleWaiters.delete(done);
        resolve(false);
      }, ms);
      this.idleWaiters.add(done);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    for (const done of [...this.idleWaiters]) done();
  }

  /** Inserts up to 20 files at `range` as uploading nodes and queues their imports. */
  insertFiles(files: readonly File[], range: Range): void {
    if (files.length > MAX_FILES_PER_ACTION) this.deps.notify(ATTACHMENT_MESSAGES.tooManyFiles);
    const limits = this.deps.limits();
    const nodes: JSONContent[] = [];
    const jobs: Job[] = [];
    for (const file of files.slice(0, MAX_FILES_PER_ACTION)) {
      const kind = kindOfFile(file);
      const limitMb = kind === 'image' ? limits.imageMaxMb : limits.documentMaxMb;
      if (file.size > maxBytes(limitMb)) {
        this.deps.notify(tooLargeMessage(kind, limitMb));
        continue;
      }
      const token = this.newToken();
      nodes.push(
        kind === 'image'
          ? { type: 'image', attrs: { uploadToken: token, alt: altFromName(file.name), size: 'medium' } }
          : { type: 'fileAttachment', attrs: { uploadToken: token, name: file.name || 'file', sizeBytes: file.size } },
      );
      jobs.push({ token, kind, name: file.name, read: async () => new Uint8Array(await file.arrayBuffer()), declaredSize: file.size });
    }
    if (nodes.length === 0 || !this.editor) return;
    insertBlocks(this.editor, range, nodes);
    for (const job of jobs) this.enqueue(job);
  }

  /** Queues the import of a pasted `data:` image whose placeholder node carries `token` (see sanitizePastedHtml). */
  queueDataImage(token: string, _mime: string, base64: string): void {
    this.enqueue({ token, kind: 'image', name: '', read: async () => decodeBase64(base64), declaredSize: Math.floor((base64.length * 3) / 4) });
  }

  /** Keeps finished uploads finished when undo history re-inserts their placeholder (redo). */
  extension() {
    return Extension.create({
      name: 'uploadCompletion',
      addProseMirrorPlugins: () => [
        new Plugin({
          key: new PluginKey('uploadCompletion'),
          appendTransaction: (trs, _old, state) => {
            if (this.completed.size === 0 || !trs.some((tr) => tr.docChanged)) return null;
            let tr: Transaction | null = null;
            state.doc.descendants((node, pos) => {
              const done = typeof node.attrs.uploadToken === 'string' ? this.completed.get(node.attrs.uploadToken) : undefined;
              if (!done) return;
              tr ??= state.tr;
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...done, uploadToken: null });
            });
            return tr ? markPersistent(tr) : null;
          },
        }),
      ],
    });
  }

  private enqueue(job: Job): void {
    if (this.disposed) return;
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.running < IMPORT_CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running += 1;
      void this.run(job).finally(() => {
        this.running -= 1;
        this.pump();
        if (this.pending() === 0) for (const done of [...this.idleWaiters]) done();
      });
    }
  }

  private async run(job: Job): Promise<void> {
    const limitMb = job.kind === 'image' ? this.deps.limits().imageMaxMb : this.deps.limits().documentMaxMb;
    if (job.declaredSize > maxBytes(limitMb)) {
      this.fail(job.token, tooLargeMessage(job.kind, limitMb));
      return;
    }
    let result: Result<{ attachment: AttachmentDtoType }>;
    try {
      const bytes = await job.read();
      result = await this.deps.importBytes({ kind: job.kind, ...(job.name ? { originalName: job.name } : {}), bytes });
    } catch {
      this.fail(job.token, importFailedMessage(job.kind));
      return;
    }
    if (result.ok) this.complete(job, result.data.attachment);
    else this.fail(job.token, result.error.message);
  }

  private findNode(token: string): { node: PmNode; pos: number } | null {
    let found: { node: PmNode; pos: number } | null = null;
    this.editor?.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (node.attrs.uploadToken === token) found = { node, pos };
      return !found;
    });
    return found;
  }

  private complete(job: Job, dto: AttachmentDtoType): void {
    if (this.disposed || !this.editor) return;
    const attrs: Record<string, unknown> =
      dto.kind === 'image'
        ? { attachmentId: dto.id, width: dto.width, height: dto.height }
        : { attachmentId: dto.id, sizeBytes: dto.sizeBytes, mime: dto.mime };
    this.completed.set(job.token, attrs);
    const target = this.findNode(job.token);
    // The node may be gone (undo or deletion); then nothing is inserted.
    if (!target) return;
    const tr = this.editor.state.tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, ...attrs, uploadToken: null });
    this.editor.view.dispatch(markPersistent(tr));
  }

  private fail(token: string, message: string): void {
    if (this.disposed) return;
    this.deps.notify(message);
    const target = this.findNode(token);
    if (!target || !this.editor) return;
    const tr = this.editor.state.tr.delete(target.pos, target.pos + target.node.nodeSize);
    this.editor.view.dispatch(markPersistent(tr));
  }
}
