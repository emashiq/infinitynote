import { documentUrl } from '../../shared/app-identity';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { DocumentConflictReasonType, DocumentFileInfoType, DocumentOpenResponseType, ExpectedFileType } from '../../shared/contracts/documents';
import type { ErrorEnvelope, Result } from '../../shared/contracts/envelope';
import type { DocumentDtoType } from '../../shared/contracts/hierarchy';
import { DOCUMENT_MESSAGES } from '../../shared/documents/messages';
import type { CsvFormatType, WorkbookType } from '../../shared/documents/workbook';
import { createStore, type Store } from '../state/store';
import type { FlushResult } from '../notes/note-controller';

export type DocumentStatus = 'loading' | 'ready' | 'missing' | 'trashed' | 'error';

export interface DocumentViewState {
  status: DocumentStatus;
  document: DocumentDtoType | null;
  /** The original of a linked document as main last saw it; null for a managed one. */
  file: DocumentFileInfoType | null;
  message: string | null;
  saving: boolean;
  /** A save main refused because the document changed elsewhere; the view offers Reload or Save a copy. */
  conflict: { reason: DocumentConflictReasonType; message: string } | null;
  /** Counts the times the document was read from main; a viewer is mounted again when it changes. */
  loads: number;
}

const CONFLICT_REASONS: ReadonlySet<string> = new Set(['revision', 'changedOnDisk', 'inUse']);

function conflictReason(error: ErrorEnvelope): DocumentConflictReasonType | null {
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  return error.code === 'CONFLICT' && typeof reason === 'string' && CONFLICT_REASONS.has(reason) ? (reason as DocumentConflictReasonType) : null;
}

/**
 * One open document tab (D-118): what main says about the document, and its saves. Viewers read the bytes from
 * `sourceUrl()` and hand edited bytes to `save`, which carries the revision and, for a linked document, the original's
 * state from when it was opened, so main can refuse a save over changes made elsewhere.
 */
export class DocumentController {
  readonly store: Store<DocumentViewState> = createStore<DocumentViewState>({
    status: 'loading',
    document: null,
    file: null,
    message: null,
    saving: false,
    conflict: null,
    loads: 0,
  });

  constructor(
    private readonly bridge: Pick<InfinityBridge, 'document'>,
    readonly documentId: string,
  ) {}

  /** The URL the viewer reads the current bytes from; it changes with each revision. */
  sourceUrl(): string {
    return documentUrl(this.documentId, this.store.getState().document?.revision ?? 0);
  }

  async open(): Promise<void> {
    const res = await this.bridge.document.open({ documentId: this.documentId });
    if (res.ok) this.apply(res.data);
    else this.store.setState({ status: this.failedStatus(res.error), message: res.error.message, document: null, file: null });
    this.store.setState({ loads: this.store.getState().loads + 1 });
  }

  /** Reads the document again (after a conflict, or when its original changed). */
  async reload(): Promise<void> {
    this.store.setState({ conflict: null });
    await this.open();
  }

  /** Saves edited bytes as the next revision. A conflict is kept in the state for the view to resolve. */
  save(bytes: Uint8Array): Promise<FlushResult> {
    return this.saving((base) => this.bridge.document.save({ ...base, bytes }));
  }

  /** Saves an edited workbook (F3): main writes it in the document's format, then saves it like bytes. */
  saveWorkbook(workbook: WorkbookType, csv: CsvFormatType | null): Promise<FlushResult> {
    return this.saving((base) => this.bridge.document.saveWorkbook({ ...base, workbook, ...(csv ? { csv } : {}) }));
  }

  /** Puts a version's bytes back as the next revision; the viewer is mounted again on the restored bytes. */
  async restoreVersion(versionId: string): Promise<FlushResult> {
    const res = await this.saving((base) => this.bridge.document.restoreVersion({ ...base, versionId }));
    if (res.ok) this.store.setState({ loads: this.store.getState().loads + 1 });
    return res;
  }

  /**
   * Runs one save with the revision it starts from and, for a linked document, the original's state when it was
   * opened, so main refuses a save over changes made elsewhere.
   */
  private async saving(
    call: (base: { documentId: string; baseRevision: number; expectedFile?: ExpectedFileType }) => Promise<Result<DocumentOpenResponseType>>,
  ): Promise<FlushResult> {
    const { document, file } = this.store.getState();
    if (!document) return { ok: false, code: 'NOT_FOUND', message: DOCUMENT_MESSAGES.missing };
    this.store.setState({ saving: true });
    const expectedFile = file?.sizeBytes != null && file.modifiedAt != null ? { sizeBytes: file.sizeBytes, modifiedAt: file.modifiedAt } : undefined;
    const res = await call({ documentId: this.documentId, baseRevision: document.revision, ...(expectedFile ? { expectedFile } : {}) });
    this.store.setState({ saving: false });
    if (res.ok) {
      this.apply(res.data);
      return { ok: true };
    }
    const reason = conflictReason(res.error);
    if (reason) this.store.setState({ conflict: { reason, message: res.error.message } });
    return { ok: false, code: res.error.code, message: res.error.message, details: res.error.details };
  }

  /** Writes the bytes to a file the user picks, added as a new linked document: the new document, Cancel, or why not. */
  async saveCopy(bytes: Uint8Array): Promise<{ document: DocumentDtoType } | { canceled: true } | { error: string }> {
    const res = await this.bridge.document.saveCopy({ documentId: this.documentId, bytes });
    if (!res.ok) return { error: res.error.message };
    return res.data.canceled ? { canceled: true } : { document: res.data.document };
  }

  private apply(data: DocumentOpenResponseType): void {
    this.store.setState({ status: 'ready', document: data.document, file: data.file, message: null, conflict: null });
  }

  private failedStatus(error: ErrorEnvelope): DocumentStatus {
    if (error.code !== 'NOT_FOUND') return 'error';
    return error.message === DOCUMENT_MESSAGES.inTrash ? 'trashed' : 'missing';
  }
}
