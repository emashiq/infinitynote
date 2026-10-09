import { Extension, type Editor, type JSONContent, type Range } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { actionFor, canCopy, needsChoice, type AddAction, type AddFilesMode } from '../../shared/attachments/file-choice';
import {
  ATTACHMENT_MESSAGES,
  IMPORT_CONCURRENCY,
  importFailedMessage,
  linkedInsteadMessage,
  maxBytes,
  MAX_FILES_PER_ACTION,
  tooLargeMessage,
  type AttachmentKindName,
} from '../../shared/attachments/limits';
import type { AddedFileType } from '../../shared/contracts/attachments';
import { ok, type Result } from '../../shared/contracts/envelope';
import { markPersistent } from './content';
import { fileSource, type FileSource, type FileSourceIo } from './file-sources';

/** The user's attachment settings: size limits and "When adding files" (D-108). */
export interface AttachmentPrefs {
  imageMaxMb: number;
  /** The copy limit for files: larger files can only be linked. */
  documentMaxMb: number;
  addFiles: AddFilesMode;
}

/** What the "Add files" dialog shows (D-108). */
export interface FileChoiceRequest {
  files: Array<{ name: string; sizeBytes: number; linkable: boolean }>;
  copyLimitMb: number;
}

export interface FileChoice {
  action: AddAction;
  remember: boolean;
}

export interface UploaderDeps extends FileSourceIo {
  prefs: () => AttachmentPrefs;
  notify: (message: string) => void;
  /** Asks how to add files; null is Cancel. */
  chooseFiles: (request: FileChoiceRequest) => Promise<FileChoice | null>;
  /** "Remember my choice": saves the action as the "When adding files" setting. */
  rememberChoice: (action: AddAction) => void;
  newToken?: () => string;
}

interface Job {
  token: string;
  kind: AttachmentKindName;
  action: AddAction;
  /** Size known only after decoding (pasted data images) is checked when the job starts. */
  declaredSize: number;
  /** Reads, copies or links the file when the job starts, so at most IMPORT_CONCURRENCY files are in memory. */
  run: () => Promise<Result<AddedFileType>>;
}

/** A finished node: its type and the attributes the import adds. */
interface Completion {
  type: 'image' | 'fileAttachment' | 'fileLink';
  attrs: Record<string, unknown>;
}

const GENERIC_CLIPBOARD_NAME = 'image.png';
const PASTED_IMAGE_ALT = 'Pasted image';
const DEFAULT_FILE_NAME = 'file';

/** Alt text for an image file: its name without the extension, or "Pasted image" for clipboard bitmaps. */
export function altFromName(name: string): string {
  if (name === '' || name === GENERIC_CLIPBOARD_NAME) return PASTED_IMAGE_ALT;
  const base = name.replace(/\.[^.]+$/, '');
  return base === '' ? PASTED_IMAGE_ALT : base;
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

/** The "Adding…" node of a file: an image, or a file chip that becomes a copied or linked file. */
function placeholder(source: FileSource, token: string): JSONContent {
  return source.kind === 'image'
    ? { type: 'image', attrs: { uploadToken: token, alt: altFromName(source.name), size: 'medium' } }
    : { type: 'fileAttachment', attrs: { uploadToken: token, name: source.name || DEFAULT_FILE_NAME, sizeBytes: source.sizeBytes } };
}

function completionOf(added: AddedFileType): Completion {
  if (added.type === 'link') return { type: 'fileLink', attrs: { linkId: added.link.id, sizeBytes: added.link.sizeBytes } };
  const dto = added.attachment;
  return dto.kind === 'image'
    ? { type: 'image', attrs: { attachmentId: dto.id, width: dto.width, height: dto.height } }
    : { type: 'fileAttachment', attrs: { attachmentId: dto.id, sizeBytes: dto.sizeBytes, mime: dto.mime } };
}

/** Replaces an "Adding…" node with its finished node, keeping its block ID and name. */
function finish(tr: Transaction, pos: number, node: PmNode, done: Completion): Transaction {
  return tr.setNodeMarkup(pos, node.type.schema.nodes[done.type], { ...node.attrs, ...done.attrs, uploadToken: null });
}

/**
 * Adds pasted, dropped, picked and data-URL files to a note (D-054, D-108, plan section 9.5). Each file first appears
 * as an "Adding…" node with an upload token. Images are copied; for other files the "When adding files" setting
 * decides, or the "Add files" dialog asks once for the whole action, while files over the copy limit are linked and
 * files without a path are copied. At most two imports run at a time and a file's bytes are read only when its import
 * starts. Success turns the node into the copied or linked file; failure or Cancel removes it (failure with the message
 * from main). Completions are not undo steps; a redo of the insertion gets the finished file back.
 */
export class AttachmentUploader {
  private editor: Editor | null = null;
  private readonly queue: Job[] = [];
  private running = 0;
  private disposed = false;
  private readonly completed = new Map<string, Completion>();
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

  /** Dropped or pasted files. */
  insertFiles(files: readonly File[], range: Range): void {
    this.addFiles(
      files.map((file) => fileSource(file, this.deps)),
      range,
    );
  }

  /** Inserts up to 20 files at `range` as "Adding…" nodes, then copies or links them. */
  addFiles(sources: readonly FileSource[], range: Range): void {
    if (sources.length > MAX_FILES_PER_ACTION) this.deps.notify(ATTACHMENT_MESSAGES.tooManyFiles);
    const prefs = this.deps.prefs();
    const placed: Array<{ token: string; source: FileSource }> = [];
    for (const source of sources.slice(0, MAX_FILES_PER_ACTION)) {
      const refusal = this.refusal(source, prefs);
      if (refusal) this.deps.notify(refusal);
      else placed.push({ token: this.newToken(), source });
    }
    if (placed.length === 0 || !this.editor) return;
    insertBlocks(
      this.editor,
      range,
      placed.map((p) => placeholder(p.source, p.token)),
    );
    const documents = placed.filter((p) => p.source.kind === 'document');
    if (!needsChoice(prefs.addFiles, documents.map((d) => d.source))) {
      for (const p of placed) this.enqueueFile(p, prefs.addFiles === 'link' ? 'link' : 'copy', prefs);
      return;
    }
    for (const p of placed) if (p.source.kind === 'image') this.enqueueFile(p, 'copy', prefs);
    void this.askThenAdd(documents, prefs);
  }

  /** Queues the import of a pasted `data:` image whose placeholder node carries `token` (see sanitizePastedHtml). */
  queueDataImage(token: string, _mime: string, base64: string): void {
    this.enqueue({
      token,
      kind: 'image',
      action: 'copy',
      declaredSize: Math.floor((base64.length * 3) / 4),
      run: async () => {
        const res = await this.deps.importBytes({ kind: 'image', bytes: decodeBase64(base64) });
        return res.ok ? ok({ type: 'attachment', attachment: res.data.attachment }) : res;
      },
    });
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
              if (done) tr = finish(tr ?? state.tr, pos, node, done);
            });
            return tr ? markPersistent(tr) : null;
          },
        }),
      ],
    });
  }

  /** Why a file is not added at all: an image over its limit, or a file that can be neither copied nor linked. */
  private refusal(source: FileSource, prefs: AttachmentPrefs): string | null {
    if (source.kind === 'image') return source.sizeBytes > maxBytes(prefs.imageMaxMb) ? tooLargeMessage('image', prefs.imageMaxMb) : null;
    return canCopy(source, prefs.documentMaxMb) || source.linkable ? null : tooLargeMessage('document', prefs.documentMaxMb);
  }

  /** The "Add files" dialog: one question for the action's documents; Cancel removes their "Adding file…" chips. */
  private async askThenAdd(documents: Array<{ token: string; source: FileSource }>, prefs: AttachmentPrefs): Promise<void> {
    const files = documents.map(({ source }) => ({ name: source.name || DEFAULT_FILE_NAME, sizeBytes: source.sizeBytes, linkable: source.linkable }));
    const choice = await this.deps.chooseFiles({ files, copyLimitMb: prefs.documentMaxMb });
    if (this.disposed) return;
    if (!choice) {
      for (const d of documents) this.remove(d.token);
      return;
    }
    if (choice.remember) this.deps.rememberChoice(choice.action);
    for (const d of documents) this.enqueueFile(d, choice.action, prefs);
  }

  /** Queues one placed file: images are copied; a document gets the preferred action when it allows it (D-108). */
  private enqueueFile({ token, source }: { token: string; source: FileSource }, preferred: AddAction, prefs: AttachmentPrefs): void {
    // Never null: files that can be neither copied nor linked were refused before they were inserted.
    const action = source.kind === 'image' ? 'copy' : actionFor(source, preferred, prefs.documentMaxMb)!;
    if (prefs.addFiles === 'copy' && action === 'link') this.deps.notify(linkedInsteadMessage(source.name || DEFAULT_FILE_NAME, prefs.documentMaxMb));
    this.enqueue({ token, kind: source.kind, action, declaredSize: source.sizeBytes, run: () => source.add(action) });
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
    const prefs = this.deps.prefs();
    const limitMb = job.kind === 'image' ? prefs.imageMaxMb : prefs.documentMaxMb;
    if (job.action === 'copy' && job.declaredSize > maxBytes(limitMb)) {
      this.fail(job.token, tooLargeMessage(job.kind, limitMb));
      return;
    }
    let result: Result<AddedFileType>;
    try {
      result = await job.run();
    } catch {
      this.fail(job.token, importFailedMessage(job.kind));
      return;
    }
    if (result.ok) this.complete(job.token, completionOf(result.data));
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

  private complete(token: string, done: Completion): void {
    if (this.disposed || !this.editor) return;
    this.completed.set(token, done);
    const target = this.findNode(token);
    // The node may be gone (undo or deletion); then nothing is inserted.
    if (!target) return;
    this.editor.view.dispatch(markPersistent(finish(this.editor.state.tr, target.pos, target.node, done)));
  }

  private fail(token: string, message: string): void {
    if (this.disposed) return;
    this.deps.notify(message);
    this.remove(token);
  }

  /** Removes an "Adding…" node (a failed import, or Cancel in the "Add files" dialog). */
  private remove(token: string): void {
    const target = this.findNode(token);
    if (!target || !this.editor) return;
    this.editor.view.dispatch(markPersistent(this.editor.state.tr.delete(target.pos, target.pos + target.node.nodeSize)));
  }
}
