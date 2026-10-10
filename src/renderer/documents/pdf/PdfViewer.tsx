import 'pdfjs-dist/web/pdf_viewer.css';
import { COMMENT_MESSAGES } from '../../../shared/contracts/comments';
import { PdfCommentMarkers, pdfCommentAnchor } from './pdf-comments';
import '../../styles/pdf.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DOCUMENT_MESSAGES } from '../../../shared/documents/messages';
import { useStore } from '../../state/use-store';
import { LINK_COPIED, LINK_COPY_FAILED } from '../../ui/copy-text';
import type { MenuItem } from '../../ui/Menu';
import { SegmentedControl } from '../../ui/SegmentedControl';
import type { DocumentViewerProps } from '../viewer-registry';
import { dropTarget, NO_SELECTION, pagesToChange, selectionAfterMove, selectPage, stepTarget, type PageSelection } from './page-selection';
import { PDF_MESSAGES } from './pdf-messages';
import {
  deletePages,
  describePages,
  extractPages,
  extractTitle,
  insertBlankPage,
  insertPagesFrom,
  orderAfterMove,
  PDF_PAGE_MESSAGES,
  PdfPageError,
  reorderPages,
  rotatePages,
} from './pdf-pages';
import { createPdfSessionStore, PdfSession, type PdfColorTool, type PdfSessionState } from './pdf-session';
import { PdfFindBar } from './PdfFindBar';
import { PdfOutline } from './PdfOutline';
import { PdfPasswordPrompt } from './PdfPasswordPrompt';
import { PdfThumbnails } from './PdfThumbnails';
import { PdfToolbar } from './PdfToolbar';
import { loadPdfRuntime, type PdfSource } from './pdfjs';

type SidebarPanel = 'pages' | 'outline';

/** The colors new marks start with, as pdf.js draws them by default. */
const DEFAULT_COLORS: Record<PdfColorTool, string> = { highlight: '#ffff98', text: '#000000', draw: '#000000' };

/** The result of a page operation: the new bytes, the selection and page to show afterwards, and what to tell. */
interface PageChange {
  bytes: Uint8Array;
  selection?: PageSelection;
  page?: number;
  message?: string;
}

/**
 * The PDF viewer and editor (F2, D-130, D-131): pdf.js in a continuous page view with thumbnails and the outline,
 * zoom, view rotation, find, text selection, annotation tools, and page operations with pdf-lib. Edits stay in this
 * tab until Save (Ctrl+S), which sends the bytes through the document save of the tab (revision check, versions);
 * leaving or closing the tab saves them first. A version opened from the Versions panel is shown read-only.
 */
export default function PdfViewer({ document, sourceUrl, host, target, findRequests, readOnly }: DocumentViewerProps) {
  const root = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [store] = useState(createPdfSessionStore);
  const state = useStore(store);
  const [session, setSession] = useState<PdfSession | null>(null);
  // The bytes the viewer was mounted with; later revisions are this tab's own saves, which it already shows.
  const [firstSource] = useState<PdfSource>(() => ({ url: sourceUrl }));
  const lastSource = useRef<PdfSource | null>(null);
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const [pagesChanged, setPagesChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  // The page operation under way; a save waits for it, so Ctrl+S right after a page change stores that change.
  const pageWork = useRef<Promise<void>>(Promise.resolve());
  const [sidebar, setSidebar] = useState<SidebarPanel | null>('pages');
  // The find bar opens with each Ctrl+F (a new count) and otherwise as last toggled.
  const [findToggle, setFindToggle] = useState(() => ({ open: false, at: findRequests }));
  const findOpen = findRequests > findToggle.at || findToggle.open;
  const setFindOpen = (open: boolean) => setFindToggle({ open, at: findRequests });
  const [selection, setSelection] = useState<PageSelection>(NO_SELECTION);
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const ready = state.status === 'ready' && session !== null;
  // The pages, thumbnails and outline exist (closing the document for new bytes removes them before the state says so).
  const shown = ready && session.document !== null;
  const dirty = !readOnly && (pagesChanged || state.annotationsChanged);

  // Loading new bytes (a page change, a save) disables the toolbar and removes the thumbnails, which drops the focus.
  // While loading, the viewer itself holds it, so keys still reach it (a Ctrl+S waits for the change under way); once
  // ready, it returns to the control last focused in the viewer, or to the thumbnail of the page shown when that was a
  // thumbnail, so the keyboard can go on (Ctrl+S, Alt+arrows, the Pages menu).
  const lastFocused = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const at = root.current;
    const el = lastFocused.current;
    const doc = at?.ownerDocument;
    if (!at || !el || !doc) return;
    const active = doc.activeElement;
    const lost = active === null || active === doc.body;
    if (!shown) {
      if (lost || at.contains(active)) at.focus({ preventScroll: true });
    } else if (lost || active === at) {
      if (el.isConnected) el.focus();
      else if (el.matches('.pdf-thumb')) at.querySelector<HTMLElement>('.pdf-thumb[tabindex="0"]')?.focus();
    }
  }, [shown]);

  const open = useCallback(async (s: PdfSession, source: PdfSource, page?: number) => {
    lastSource.current = source;
    await s.open(source, page);
  }, []);

  useEffect(() => {
    let disposed = false;
    let created: PdfSession | null = null;
    loadPdfRuntime().then(
      (runtime) => {
        if (disposed || !container.current) return;
        created = new PdfSession(runtime, container.current, store);
        setSession(created);
        void open(created, firstSource);
      },
      () => !disposed && setRuntimeFailed(true),
    );
    return () => {
      disposed = true;
      created?.destroy();
    };
  }, [store, open, firstSource]);

  useEffect(() => {
    if (session && target && 'page' in target.target) session.goToPage(target.target.page);
  }, [session, target]);

  // Comments (D-165): the selected text (its area) or the page shown is the anchor; markers sit on the pages.
  useEffect(() => {
    if (!session) return undefined;
    const markers = new PdfCommentMarkers({ pageElement: (n) => session.pageElement(n), rotation: () => store.getState().rotation });
    const offRendered = session.onPageRendered((page) => markers.draw(page));
    const offComments = host.comments({
      current: () => {
        const s = store.getState();
        return s.status === 'ready' && container.current ? pdfCommentAnchor(container.current, s.page, s.rotation) : { error: COMMENT_MESSAGES.notReady };
      },
      show: (threads, activeId, select) => markers.set(threads, activeId, select),
    });
    return () => {
      offComments();
      offRendered();
    };
  }, [session, host, store]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!session || !root.current) return false;
    setSaving(true);
    try {
      await pageWork.current;
      const bytes = await session.currentBytes(root.current).catch(() => null);
      if (!bytes) {
        host.notify(DOCUMENT_MESSAGES.saveFailed, 'error');
        return false;
      }
      if (!(await host.save(bytes))) return false;
      setPagesChanged(false);
      // The saved bytes become the document shown, so annotations are part of the file from now on.
      await open(session, { data: bytes });
      return true;
    } finally {
      setSaving(false);
    }
  }, [session, host, open]);

  useEffect(() => {
    host.setUnsaved(dirty ? save : null);
  }, [dirty, save, host]);
  useEffect(() => () => host.setUnsaved(null), [host]);

  const changePages = (change: (bytes: Uint8Array) => Promise<PageChange | null>): Promise<void> => {
    const at = root.current;
    if (!session || !at || busy || readOnly) return Promise.resolve();
    setBusy(true);
    const work = (async () => {
      try {
        const result = await change(await session.currentBytes(at));
        if (!result) return;
        setSelection(result.selection ?? NO_SELECTION);
        setPagesChanged(true);
        await open(session, { data: result.bytes }, result.page);
        if (result.message) host.notify(result.message);
      } catch (err) {
        host.notify(err instanceof PdfPageError ? err.message : PDF_PAGE_MESSAGES.unreadable, 'error');
      } finally {
        setBusy(false);
      }
    })();
    pageWork.current = work;
    return work;
  };

  const count = state.pageCount;
  const chosen = () => pagesToChange(selection, state.page - 1);
  const move = (moving: number[], to: number | null) =>
    changePages(async (bytes) => {
      if (to === null) return null;
      const order = orderAfterMove(count, moving, to);
      if (order.every((from, i) => from === i)) return null;
      const after = selectionAfterMove(order, moving);
      return { bytes: await reorderPages(bytes, order), selection: after, page: (after.selected[0] ?? 0) + 1 };
    });
  const stepPages = (step: -1 | 1) => {
    const moving = chosen();
    void move(moving, stepTarget(count, moving, step));
  };
  const dropPage = (from: number, slot: number) => {
    const moving = selection.selected.includes(from) ? [...selection.selected] : [from];
    void move(moving, dropTarget(count, moving, slot));
  };
  const insertAt = () => Math.max(...chosen()) + 1;

  const locked = busy || saving;
  const pageItems: MenuItem[] = [
    { id: 'rotate-left', disabled: locked, label: 'Rotate pages left', onSelect: () => void changePages(async (b) => ({ bytes: await rotatePages(b, chosen(), -90), selection })) },
    { id: 'rotate-right', disabled: locked, label: 'Rotate pages right', onSelect: () => void changePages(async (b) => ({ bytes: await rotatePages(b, chosen(), 90), selection })) },
    { id: 'move-up', disabled: locked, label: 'Move pages up', shortcut: 'Alt+Up', separatorBefore: true, onSelect: () => stepPages(-1) },
    { id: 'move-down', disabled: locked, label: 'Move pages down', shortcut: 'Alt+Down', onSelect: () => stepPages(1) },
    {
      id: 'insert-blank',
      disabled: locked,
      label: 'Insert blank page',
      separatorBefore: true,
      onSelect: () => {
        const at = insertAt();
        void changePages(async (b) => ({ bytes: await insertBlankPage(b, at), selection: selectPage(NO_SELECTION, at, 'single'), page: at + 1 }));
      },
    },
    {
      id: 'insert-pdf',
      disabled: locked,
      label: 'Insert pages from a PDF…',
      onSelect: () => {
        const at = insertAt();
        void changePages(async (b) => {
          const picked = await host.pickPdf();
          if (!picked) return null;
          const { bytes, inserted } = await insertPagesFrom(b, picked.bytes, at);
          return { bytes, page: at + 1, message: PDF_MESSAGES.inserted(inserted, picked.name) };
        });
      },
    },
    {
      id: 'extract',
      disabled: locked,
      label: 'Extract pages to a new PDF',
      onSelect: () => {
        const pages = chosen();
        void (async () => {
          if (!session || !root.current) return;
          try {
            const bytes = await extractPages(await session.currentBytes(root.current), pages);
            const title = await host.createBeside(extractTitle(document.title, pages), bytes);
            if (title) host.notify(PDF_MESSAGES.extracted(describePages(pages), title));
          } catch (err) {
            host.notify(err instanceof PdfPageError ? err.message : DOCUMENT_MESSAGES.importFailed, 'error');
          }
        })();
      },
    },
    {
      id: 'delete',
      label: selection.selected.length > 1 ? `Delete ${selection.selected.length} pages` : 'Delete page',
      separatorBefore: true,
      disabled: locked || count <= 1,
      onSelect: () => {
        const pages = chosen();
        void changePages(async (b) => ({ bytes: await deletePages(b, pages), page: Math.min(pages[0]! + 1, count - pages.length) }));
      },
    },
  ];

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty && !saving) void save();
    }
  };

  const pdf = session?.document ?? null;
  return (
    <div
      ref={root}
      className="pdf-viewer"
      onKeyDown={onKeyDown}
      tabIndex={-1}
      onFocus={(e) => {
        if (e.target !== e.currentTarget && e.target instanceof HTMLElement) lastFocused.current = e.target;
      }}
    >
      <PdfToolbar
        ready={ready}
        readOnly={readOnly}
        sidebarOpen={sidebar !== null}
        page={state.page}
        pageCount={count}
        zoom={state.zoom}
        tool={state.tool}
        color={state.tool === 'highlight' || state.tool === 'text' || state.tool === 'draw' ? colors[state.tool] : null}
        dirty={dirty}
        saving={saving}
        findOpen={findOpen}
        pageItems={pageItems}
        onToggleSidebar={() => setSidebar(sidebar ? null : 'pages')}
        onPage={(n) => session?.goToPage(n)}
        onZoom={(z) => session?.setZoom(z)}
        onZoomStep={(step) => session?.zoomBy(step)}
        onRotateView={() => session?.rotateView(90)}
        onTool={(tool) => session?.setTool(tool)}
        onAddImage={() => void session?.addImage()}
        onColor={(tool, color) => {
          setColors({ ...colors, [tool]: color });
          session?.setColor(tool, color);
        }}
        onToggleFind={() => {
          if (findOpen) session?.closeFind();
          setFindOpen(!findOpen);
        }}
        onSave={() => void save()}
      />
      {findOpen && ready ? (
        <PdfFindBar
          find={state.find}
          focusRequests={findRequests}
          onFind={(query, options) => session?.find(query, options)}
          onClose={() => {
            session?.closeFind();
            setFindOpen(false);
          }}
        />
      ) : null}
      <div className="pdf-main">
        {sidebar && ready && pdf ? (
          <aside className="pdf-sidebar" aria-label="Pages and outline">
            <div className="pdf-sidebar-head">
              <SegmentedControl
                label="Show"
                name={`pdf-sidebar-${document.id}`}
                value={sidebar}
                onChange={setSidebar}
                options={[
                  { value: 'pages', label: 'Pages' },
                  { value: 'outline', label: 'Outline' },
                ]}
              />
            </div>
            {sidebar === 'pages' ? (
              <PdfThumbnails
                pdf={pdf}
                generation={state.generation}
                pageCount={count}
                currentPage={state.page}
                rotation={state.rotation}
                selection={selection}
                onSelect={(index, mode) => setSelection(selectPage(selection, index, mode))}
                onOpenPage={(n) => session.goToPage(n)}
                onStep={stepPages}
                onDrop={dropPage}
              />
            ) : (
              <PdfOutline
                pdf={pdf}
                generation={state.generation}
                onGo={(dest) => session.goToDestination(dest)}
                onCopyLink={(url) => void host.copyText(url).then((ok) => host.notify(ok ? LINK_COPIED : LINK_COPY_FAILED, ok ? 'info' : 'error'))}
              />
            )}
          </aside>
        ) : null}
        <div className="pdf-stage">
          <div ref={container} className="pdf-container" tabIndex={0} aria-label={`${document.title} (PDF pages)`}>
            <div className="pdfViewer" />
          </div>
          <PdfOverlay
            status={runtimeFailed ? 'error' : state.status}
            error={runtimeFailed ? PDF_MESSAGES.failed : state.error}
            wrongPassword={state.wrongPassword}
            onPassword={(p) => session?.submitPassword(p)}
            onCancelPassword={() => session?.cancelPassword()}
            onRetry={() => session && void open(session, lastSource.current ?? firstSource)}
          />
        </div>
      </div>
    </div>
  );
}

function PdfOverlay(props: {
  status: PdfSessionState['status'];
  error: string | null;
  wrongPassword: boolean;
  onPassword(password: string): void;
  onCancelPassword(): void;
  onRetry(): void;
}) {
  if (props.status === 'ready') return null;
  return (
    <div className="pdf-overlay">
      {props.status === 'loading' ? (
        <span className="muted" aria-busy="true">
          Opening PDF…
        </span>
      ) : props.status === 'password' ? (
        <PdfPasswordPrompt wrong={props.wrongPassword} onSubmit={props.onPassword} onCancel={props.onCancelPassword} />
      ) : (
        <div role="alert" className="pdf-error">
          <p>{props.error ?? PDF_MESSAGES.failed}</p>
          {props.status === 'locked' ? (
            <button type="button" className="btn" onClick={props.onRetry}>
              Enter password
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
