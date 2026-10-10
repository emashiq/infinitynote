import '@portone/docx-editor/styles.css';
import { MAX_COMMENT_QUOTE } from '../../../shared/contracts/comments';
import '../../styles/docx.css';
import { DEFAULT_ZOOM_LEVELS, DocxEditor, type DocxEditorHandle, type DocxEditorMode, type DocxEditorZoom, type DocxImportError } from '@portone/docx-editor';
import { documentFidelity, insertPageBreak } from '@portone/docx-editor/commands';
import type { Node as PmNode } from '@tiptap/pm/model';
import { keymap } from '@tiptap/pm/keymap';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { FileText, Save, Search } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { DocumentFindBar } from '../DocumentFindBar';
import type { DocumentViewerProps } from '../viewer-registry';
import { exportForSave } from './docx-export';
import { clearFind, docxFindPlugin, findState, runFind, stepFind } from './docx-find';
import { canPreview, DOCX_IMPORT_MESSAGES, DOCX_MESSAGES, EDIT_REFUSAL_MESSAGES, hasPlaceholders } from './docx-messages';
import { paragraphIndexAt, showPosition, targetPosition } from './docx-targets';

/** The read-only preview of files the editor refuses is its own chunk, fetched only for such a file. */
const DocxPreview = lazy(() => import('./DocxPreview'));

/**
 * Who writes comments made in Infinity Notes (D-147). There are no accounts (CLAUDE.md), so the app is the author;
 * comments made in Word keep their own authors and stay editable, since they carry no identity the editor knows.
 */
const COMMENT_AUTHOR = { id: 'infinity-notes', name: 'Infinity Notes', initials: 'IN' } as const;
const EDIT_MODE: DocxEditorMode = { kind: 'edit', author: COMMENT_AUTHOR };
const READ_ONLY_MODE: DocxEditorMode = { kind: 'readOnly' };

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; bytes: Uint8Array };

/**
 * Ctrl+K is the app's search everywhere (the window opens it before the editor sees the key), so the editor's own
 * link shortcut is turned off; links are added with the toolbar's Link button.
 */
const appKeys = () => keymap({ 'Mod-k': () => true });

/** The page area announces itself to screen readers as the document's text. */
function labelPlugin(label: string): Plugin {
  return new Plugin({ props: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': label } } });
}

function Refused({ error, bytes }: { error: DocxImportError; bytes: Uint8Array }) {
  return (
    <div className="docx-refused">
      <div role="alert" className="banner docx-refused-banner">
        <strong>{DOCX_MESSAGES.refusedTitle}</strong>
        <span>{DOCX_IMPORT_MESSAGES[error.code]}</span>
        {canPreview(error.code) ? <span className="muted">{DOCX_MESSAGES.previewNote}</span> : null}
      </div>
      {canPreview(error.code) ? (
        <Suspense fallback={<span className="muted docx-message">Opening preview…</span>}>
          <DocxPreview bytes={bytes} />
        </Suspense>
      ) : null}
    </div>
  );
}

/**
 * The Word viewer and editor (F4, D-142): @portone/docx-editor on the document's own OOXML, in page layout with zoom,
 * text editing, character and paragraph formatting, styles, lists, tables, pictures, links, page breaks, undo and redo
 * and the document's comments. Saving writes the edits into the package it opened, so untouched parts keep their bytes;
 * Save (Ctrl+S) goes through the tab like every document (revision, versions, linked originals), and leaving or closing
 * the tab saves first. Find is the app's find bar. A file the editor cannot write back safely opens read-only with its
 * reason and, where possible, a preview.
 */
export default function DocxViewer({ document, sourceUrl, host, target, findRequests, readOnly }: DocumentViewerProps) {
  const editor = useRef<DocxEditorHandle>(null);
  // The bytes are read once: saving changes the URL (a new revision), but the editor already holds what it saved.
  const [source] = useState(sourceUrl);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [view, setView] = useState<EditorView | null>(null);
  /** The document as last saved (or opened); the editor is dirty while it shows another one. */
  const saved = useRef<PmNode | null>(null);
  /** The document at the last change, so a refused edit's message lasts until the next edit. */
  const shown = useRef<PmNode | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [placeholders, setPlaceholders] = useState(false);
  const [zoom, setZoom] = useState<DocxEditorZoom>('fit-width');
  const [findToggle, setFindToggle] = useState(() => ({ open: false, at: findRequests }));
  const findOpen = findRequests > findToggle.at || findToggle.open;
  const [find, setFind] = useState({ query: '', caseSensitive: false, wholeWord: false });
  const [matches, setMatches] = useState({ count: 0, current: -1 });
  // Read by the editor once, when it mounts.
  const plugins = useMemo(() => [appKeys(), docxFindPlugin(), labelPlugin(`${document.title} (Word document)`)], [document.title]);

  useEffect(() => {
    const abort = new AbortController();
    fetch(source, { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        setLoaded({ status: 'ready', bytes: new Uint8Array(await res.arrayBuffer()) });
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoaded({ status: 'error' });
      });
    return () => abort.abort();
  }, [source]);

  const onReady = useCallback((ready: EditorView) => {
    saved.current = ready.state.doc;
    shown.current = ready.state.doc;
    setView(ready);
    setPlaceholders(hasPlaceholders(documentFidelity(ready.state)));
  }, []);

  const onChange = useCallback(() => {
    const state = editor.current?.view.state;
    if (!state) return;
    setDirty(state.doc !== saved.current);
    if (state.doc !== shown.current) {
      shown.current = state.doc;
      setRefusal('');
    }
    const next = findState(state);
    setMatches((m) => (m.count === next.count && m.current === next.current ? m : next));
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const handle = editor.current;
    if (!handle || readOnly) return false;
    const doc = handle.view.state.doc;
    const exported = exportForSave(handle);
    if (!exported.ok) {
      host.notify(exported.message, 'error');
      return false;
    }
    setSaving(true);
    try {
      if (!(await host.save(exported.bytes))) return false;
      saved.current = doc;
      setDirty(handle.view.state.doc !== doc);
      return true;
    } finally {
      setSaving(false);
    }
  }, [readOnly, host]);

  useEffect(() => {
    host.setUnsaved(dirty && !readOnly ? save : null);
  }, [dirty, readOnly, save, host]);
  useEffect(() => () => host.setUnsaved(null), [host]);

  useEffect(() => {
    if (!view || !target) return;
    const place = targetPosition(view.state, target.target);
    if (!place) return;
    if ('pos' in place) showPosition(view, place.pos);
    else host.notify(place.missing, 'error');
  }, [view, target, host]);

  // App-side comments by paragraph (D-165), next to the document's own Word comments (D-147): the paragraph at the
  // selection is the anchor and the selected text (or the paragraph's) the quote.
  useEffect(() => {
    if (!view) return undefined;
    return host.comments({
      current: () => {
        const { from, to, $from } = view.state.selection;
        const text = from === to ? $from.parent.textContent : view.state.doc.textBetween(from, to, ' ', ' ');
        return { anchor: { type: 'paragraph', paragraph: paragraphIndexAt(view.state.doc, from) }, quote: text.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMENT_QUOTE) };
      },
    });
  }, [view, host]);

  const search = (next: typeof find, step: 'first' | 'next' | 'previous') => {
    setFind(next);
    if (!view) return;
    if (step === 'first') runFind(view, next.query, next);
    else stepFind(view, step === 'previous');
  };
  const closeFind = () => {
    if (view) clearFind(view);
    setFindToggle({ open: false, at: findRequests });
  };

  const onKeyDownCapture = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      if (dirty && !saving) void save();
    }
  };

  const pageBreak = () => {
    if (!view) return;
    insertPageBreak(view.state, view.dispatch);
    view.focus();
  };

  const ready = view !== null;
  const summary = find.query === '' ? '' : matches.count === 0 ? DOCX_MESSAGES.noMatches : `${matches.current + 1} of ${matches.count}`;

  return (
    <div className="docx-viewer" onKeyDownCapture={onKeyDownCapture}>
      <div className="document-toolbar docx-toolbar" role="toolbar" aria-label="Word document">
        {readOnly ? null : (
          <button type="button" className="btn btn-small" disabled={!ready} onClick={pageBreak} title="Page break (Ctrl+Enter)">
            <FileText size={14} aria-hidden="true" />
            Page break
          </button>
        )}
        {readOnly ? (
          <select className="select docx-zoom" aria-label="Zoom" disabled={!ready} value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'fit-width' ? 'fit-width' : Number(e.target.value))}>
            <option value="fit-width">Fit width</option>
            {DEFAULT_ZOOM_LEVELS.map((level) => (
              <option key={level} value={String(level)}>{`${Math.round(level * 100)}%`}</option>
            ))}
          </select>
        ) : null}
        <button type="button" className="btn btn-small" disabled={!ready} aria-pressed={findOpen} onClick={() => (findOpen ? closeFind() : setFindToggle({ open: true, at: findRequests }))} title="Find (Ctrl+F)">
          <Search size={14} aria-hidden="true" />
          Find
        </button>
        <span className="docx-toolbar-end">
          <span role="status" className="save-status">
            {readOnly ? 'Read-only' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : refusal}
          </span>
          {readOnly ? null : (
            <button type="button" className="btn btn-small btn-primary" title="Save (Ctrl+S)" disabled={!ready || !dirty || saving} onClick={() => void save()}>
              <Save size={14} aria-hidden="true" />
              Save
            </button>
          )}
        </span>
      </div>
      {placeholders ? (
        <p role="status" className="banner docx-banner">
          {DOCX_MESSAGES.placeholders}
        </p>
      ) : null}
      {findOpen && ready ? (
        <DocumentFindBar
          subject="document"
          initialQuery={find.query}
          summary={summary}
          focusRequests={findRequests}
          onQuery={(query) => search({ ...find, query }, 'first')}
          onStep={(previous) => search(find, previous ? 'previous' : 'next')}
          onClose={closeFind}
          options={[
            { label: 'Match case', checked: find.caseSensitive, onChange: (caseSensitive) => search({ ...find, caseSensitive }, 'first') },
            { label: 'Whole words', checked: find.wholeWord, onChange: (wholeWord) => search({ ...find, wholeWord }, 'first') },
          ]}
        />
      ) : null}
      <div className="docx-surface">
        {loaded.status === 'loading' ? (
          <span className="muted docx-message" aria-busy="true">
            Opening document…
          </span>
        ) : loaded.status === 'error' ? (
          <p role="alert" className="docx-message">
            {DOCX_MESSAGES.unreadable}
          </p>
        ) : (
          <DocxEditor
            ref={editor}
            document={loaded.bytes}
            mode={readOnly ? READ_ONLY_MODE : EDIT_MODE}
            zoom={zoom}
            onZoomChange={setZoom}
            plugins={plugins}
            className="docx-frame"
            onReady={onReady}
            onChange={onChange}
            onEditRefused={(r) => setRefusal(EDIT_REFUSAL_MESSAGES[r.reason])}
            renderImportError={(error) => <Refused error={error} bytes={loaded.bytes} />}
          />
        )}
      </div>
    </div>
  );
}
