import { History } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { documentVersionUrl } from '../../shared/app-identity';
import { formatBytes } from '../../shared/attachments/names';
import type { DocumentVersionDtoType } from '../../shared/contracts/documents';
import { LINK_MESSAGES } from '../../shared/contracts/attachments';
import type { DocumentDtoType } from '../../shared/contracts/hierarchy';
import { DOCUMENT_KIND_INFO } from '../../shared/documents/kinds';
import { DOCUMENT_MESSAGES, DOCUMENT_VERSION_MESSAGES } from '../../shared/documents/messages';
import { useServices, useStore } from '../state/use-store';
import { copyText } from '../ui/copy-text';
import { DocumentKindIcon } from '../ui/DocumentKindIcon';
import { createDocumentCommentHost } from '../comments/document-comment-host';
import { DocumentController } from './document-controller';
import { DOCUMENT_VIEWERS, type DocumentViewerHost } from './viewer-registry';
import { DocumentVersionsPanel, formatVersionTime } from './versions/DocumentVersionsPanel';

/** Kinds whose viewers edit and save, so they have versions (every kind but the read-only HTML viewer). */
const EDITABLE: ReadonlySet<string> = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'csv']);

/** Kinds Infinity Notes hands to the system app; an HTML page is never opened in a browser, where its scripts would run. */
const OPENS_IN_SYSTEM_APP = (document: DocumentDtoType) => document.kind !== 'html';

/**
 * A document tab (D-118): the header with the document's kind, size and, for a linked one, its original, then the
 * viewer of its kind, loaded on first use. Viewers save through the tab, which reports a conflict with Reload and Save a
 * copy; a kind without a viewer offers the system app and the folder.
 */
export function DocumentView({ documentId, tabId }: { documentId: string; tabId: string }) {
  const services = useServices();
  const { bridge, notices, tabs, comments } = services;
  const [controller] = useState(() => new DocumentController(bridge, documentId));
  const state = useStore(controller.store);
  // Renames and moves elsewhere show at once; the tree is the source of the title.
  const live = useStore(services.tree.store).snapshot.documents.find((d) => d.id === documentId);
  const target = useStore(tabs.documentTargets)[documentId] ?? null;
  // Ctrl+F in this tab reaches a viewer with a find bar as a growing count.
  const documentFind = useStore(services.ui.store).documentFind;
  const findRequests = documentFind?.documentId === documentId ? documentFind.seq : 0;
  /** The bytes of a save main refused, kept for "Save a copy". */
  const refused = useRef<Uint8Array | null>(null);
  /** The viewer's way to save its edits, run before a version is opened or restored. */
  const unsaved = useRef<(() => Promise<boolean>) | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  /** An earlier version shown read-only in the viewer (D-141). */
  const [viewing, setViewing] = useState<DocumentVersionDtoType | null>(null);
  const [busy, setBusy] = useState(false);
  const viewingId = viewing?.id;

  useEffect(() => {
    void controller.open();
    return () => tabs.setDocumentEdits(null);
  }, [controller, tabs]);

  const host = useMemo<DocumentViewerHost>(
    () => ({
      notify: (message, tone = 'info') => notices.push(message, tone),
      copyText,
      save: async (bytes) => {
        refused.current = bytes;
        const result = await controller.save(bytes);
        if (result.ok) {
          refused.current = null;
          return true;
        }
        if (!controller.store.getState().conflict) notices.push(result.message, 'error');
        return false;
      },
      pickPdf: async () => {
        const res = await bridge.document.pickPdf();
        if (!res.ok) notices.push(res.error.message, 'error');
        return res.ok && !res.data.canceled ? { name: res.data.name, bytes: res.data.bytes } : null;
      },
      createBeside: async (title, bytes) => {
        const res = await bridge.document.createBeside({ documentId, title, bytes });
        if (!res.ok) notices.push(res.error.message, 'error');
        return res.ok ? res.data.document.title : null;
      },
      readWorkbook: async () => {
        const res = await bridge.document.readWorkbook({ documentId, ...(viewingId ? { versionId: viewingId } : {}) });
        return res.ok ? { ok: true, data: res.data } : { ok: false, message: res.error.message };
      },
      saveWorkbook: async (workbook, csv) => {
        const result = await controller.saveWorkbook(workbook, csv);
        if (!result.ok && !controller.store.getState().conflict) notices.push(result.message, 'error');
        return result.ok;
      },
      comments: (anchors) =>
        comments.register(
          createDocumentCommentHost({ documentId, anchors, openAt: (target) => void tabs.openDocument(documentId, { target }), select: (threadId) => comments.select(threadId) }),
        ),
      setUnsaved: (flush) => {
        unsaved.current = flush;
        tabs.setDocumentEdits(
          flush ? { documentId, flush: async () => ((await flush()) ? { ok: true } : { ok: false, code: 'INTERNAL', message: DOCUMENT_MESSAGES.saveFailed }) } : null,
        );
      },
    }),
    [bridge, comments, controller, documentId, notices, tabs, viewingId],
  );

  /** Saves the viewer's edits first (joining a save under way); false when they could not be saved (the viewer said why). */
  const flushing = useRef<Promise<boolean> | null>(null);
  const flushEdits = useCallback((): Promise<boolean> => {
    flushing.current ??= (unsaved.current ? unsaved.current() : Promise.resolve(true)).finally(() => {
      flushing.current = null;
    });
    return flushing.current;
  }, []);

  // Ctrl+S saves this tab's edits also when the focus is not in the viewer (which handles it first when it is): a
  // closed menu, editor or presentation, or a document loading again, leaves the focus on the page.
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 's') return;
      const target = e.target instanceof Node ? e.target : null;
      if (target !== window.document.body && !view.current?.contains(target)) return;
      e.preventDefault();
      void flushEdits();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flushEdits]);
  const loadVersions = useCallback(async () => {
    const res = await bridge.document.versions({ documentId });
    return res.ok ? { ok: true as const, versions: res.data.versions } : { ok: false as const, message: res.error.message };
  }, [bridge, documentId]);
  const versionAction = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const openVersion = (version: DocumentVersionDtoType) =>
    versionAction(async () => {
      if (await flushEdits()) setViewing(version);
    });
  const restoreVersion = (version: DocumentVersionDtoType) =>
    versionAction(async () => {
      if (!viewing && !(await flushEdits())) return;
      const res = await controller.restoreVersion(version.id);
      if (res.ok) {
        setViewing(null);
        notices.push(DOCUMENT_VERSION_MESSAGES.restored(version.revision));
      } else if (!controller.store.getState().conflict) notices.push(res.message, 'error');
    });
  const copyVersion = (version: DocumentVersionDtoType) =>
    versionAction(async () => {
      const res = await bridge.document.copyVersion({ documentId, versionId: version.id });
      if (!res.ok) return void notices.push(res.error.message, 'error');
      notices.push(DOCUMENT_VERSION_MESSAGES.copied(version.revision, res.data.document.title));
      await tabs.openDocument(res.data.document.id);
    });
  const exportCopy = () =>
    versionAction(async () => {
      if (!viewing && !(await flushEdits())) return;
      const res = await bridge.document.exportCopy({ documentId, ...(viewing ? { versionId: viewing.id } : {}) });
      if (!res.ok) notices.push(res.error.message, 'error');
      else if (!res.data.canceled) notices.push(DOCUMENT_VERSION_MESSAGES.exported);
    });

  const run = (call: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    void call().then((res) => {
      if (!res.ok && res.error) notices.push(res.error.message, 'error');
    });

  if (state.status === 'loading') {
    return (
      <div className="note-loading" aria-busy="true">
        <span className="muted">Opening document…</span>
      </div>
    );
  }
  if (state.status !== 'ready' || !state.document) {
    const title = state.status === 'trashed' ? 'This document is in Trash' : state.status === 'missing' ? 'This document no longer exists' : 'This document could not be opened';
    return (
      <div className="note-empty">
        <h2 className="view-title">{title}</h2>
        {state.status === 'error' && state.message ? <p className="muted">{state.message}</p> : null}
        <div className="button-row">
          <button type="button" className="btn" onClick={() => void tabs.close(tabId)}>
            Close tab
          </button>
        </div>
      </div>
    );
  }

  const document = { ...state.document, ...(live ? { title: live.title, favorite: live.favorite } : {}) };
  const info = DOCUMENT_KIND_INFO[document.kind];
  const file = state.file;
  const fileState = file?.state ?? 'available';
  const Viewer = DOCUMENT_VIEWERS[document.kind];
  const hasVersions = EDITABLE.has(document.kind);
  const saveCopy = async () => {
    const bytes = refused.current;
    if (!bytes) return;
    const res = await controller.saveCopy(bytes);
    if ('error' in res) notices.push(res.error, 'error');
    else if ('document' in res) {
      refused.current = null;
      await tabs.openDocument(res.document.id);
    }
  };

  return (
    <div ref={view} className="document-view" data-document-kind={document.kind}>
      <h2 className="sr-only">{document.title}</h2>
      <div className="document-header">
        <span className="document-kind">
          <DocumentKindIcon kind={document.kind} />
          {info.label}
        </span>
        {document.storage === 'linked' ? (
          <span className="file-chip-badge" title={file ? `Linked: ${file.path}` : undefined}>
            Linked
          </span>
        ) : null}
        <span className="muted">{formatBytes(document.sizeBytes)}</span>
        {state.saving ? (
          <span role="status" className="save-status">
            Saving…
          </span>
        ) : null}
        <span className="document-actions">
          {OPENS_IN_SYSTEM_APP(document) ? (
            <button type="button" className="btn btn-small" disabled={fileState !== 'available'} onClick={() => run(() => bridge.document.openExternal({ documentId }))}>
              Open in system app
            </button>
          ) : null}
          <button type="button" className="btn btn-small" disabled={fileState === 'missing'} onClick={() => run(() => bridge.document.showInFolder({ documentId }))}>
            Show in folder
          </button>
          <button type="button" className="btn btn-small" disabled={fileState !== 'available' || busy} onClick={() => void exportCopy()}>
            Export a copy…
          </button>
          {hasVersions ? (
            <button type="button" className="btn btn-small" aria-pressed={versionsOpen} onClick={() => setVersionsOpen(!versionsOpen)}>
              <History size={14} aria-hidden="true" />
              Versions
            </button>
          ) : null}
        </span>
      </div>
      {state.conflict ? (
        <div role="alert" className="banner document-conflict">
          <span>{state.conflict.message}</span>
          <span className="banner-actions">
            <button type="button" className="btn btn-small" onClick={() => void controller.reload()}>
              Reload
            </button>
            <button type="button" className="btn btn-small" onClick={() => void saveCopy()}>
              Save a copy…
            </button>
          </span>
        </div>
      ) : null}
      {viewing ? (
        <div role="status" className="banner document-version-banner">
          <span>{DOCUMENT_VERSION_MESSAGES.viewing(viewing.revision, formatVersionTime(viewing.createdAt))}</span>
          <span className="banner-actions">
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void restoreVersion(viewing)}>
              Restore this version
            </button>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void copyVersion(viewing)}>
              Save as copy
            </button>
            <button type="button" className="btn btn-small" onClick={() => setViewing(null)}>
              Back to the current version
            </button>
          </span>
        </div>
      ) : null}
      <div className="document-main">
        {fileState !== 'available' && !viewing ? (
          <p role="alert" className="document-message">
            {fileState === 'missing' && file ? LINK_MESSAGES.notFound(file.path) : DOCUMENT_MESSAGES.damaged(document.kind)}
          </p>
        ) : (
          <Suspense
            fallback={
              <div className="note-loading" aria-busy="true">
                <span className="muted">Opening document…</span>
              </div>
            }
          >
            <div className="document-body">
              <Viewer
                key={`${state.loads}:${viewing?.id ?? 'current'}`}
                document={document}
                sourceUrl={viewing ? documentVersionUrl(documentId, viewing.id) : controller.sourceUrl()}
                host={host}
                target={viewing ? null : target}
                findRequests={findRequests}
                readOnly={viewing !== null}
              />
            </div>
          </Suspense>
        )}
        {versionsOpen && hasVersions ? (
          <DocumentVersionsPanel
            load={loadVersions}
            revision={document.revision}
            now={services.now()}
            viewingId={viewing?.id ?? null}
            busy={busy || state.saving}
            onOpen={(v) => void openVersion(v)}
            onRestore={(v) => void restoreVersion(v)}
            onCopy={(v) => void copyVersion(v)}
            onClose={() => setVersionsOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
