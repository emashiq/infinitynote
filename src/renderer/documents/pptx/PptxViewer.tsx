import '../../styles/pptx.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { MAX_COMMENT_QUOTE } from '../../../shared/contracts/comments';
import { DOCUMENT_MESSAGES } from '../../../shared/documents/messages';
import { MAX_SHAPE_TEXT_CHARS, MAX_SLIDE_IMAGE_BYTES, MAX_SLIDE_NOTES_CHARS } from '../../../shared/documents/presentation';
import { useStore } from '../../state/use-store';
import { DocumentFindBar } from '../DocumentFindBar';
import type { DocumentViewerProps } from '../viewer-registry';
import { findInSlides } from './pptx-find';
import { slideImage } from './pptx-image';
import { PPTX_MESSAGES } from './pptx-messages';
import { contentNotShown, slideShapes, slideSize } from './pptx-model';
import { readPresentation, type PackageRefusal } from './pptx-package';
import { renderSlides } from './pptx-render';
import { EditRefused, PptxSession } from './pptx-session';
import { browserXml, type RunFormat } from './pptx-xml';
import { PptxNotes } from './PptxNotes';
import { PptxPresenter } from './PptxPresenter';
import { PptxStage, type TextEditing, type Zoom } from './PptxStage';
import { PptxThumbnails } from './PptxThumbnails';
import { PptxToolbar } from './PptxToolbar';
import { asEdited, editedLength, formatSelection, readEditor, shownFormat } from './text-edit';

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'refused'; reason: PackageRefusal } | { status: 'ready'; session: PptxSession };

/**
 * The PowerPoint viewer and editor (F5, D-149..D-154): slide thumbnails, the slide with its drawings to select, move,
 * resize and edit text in, speaker notes, insert text boxes and pictures, add, duplicate, reorder and delete slides,
 * undo and redo, find across slides and notes, and presentation mode. Saving writes the edited presentation through the
 * tab (revision, versions, linked originals); parts nobody edited keep their bytes.
 */
export default function PptxViewer(props: DocumentViewerProps) {
  // The bytes are read once: saving changes the URL (a new revision), but the session already holds what it saved.
  const [source] = useState(props.sourceUrl);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const { host } = props;

  useEffect(() => {
    const abort = new AbortController();
    let session: PptxSession | null = null;
    fetch(source, { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        const read = readPresentation(new Uint8Array(await res.arrayBuffer()));
        if (abort.signal.aborted) return;
        if (!read.ok) return setLoaded({ status: 'refused', reason: read.reason });
        let warned = false;
        session = new PptxSession(read.model, browserXml, renderSlides, () => {
          if (!warned) host.notify(PPTX_MESSAGES.drawFailed, 'error');
          warned = true;
        });
        setLoaded({ status: 'ready', session });
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoaded({ status: 'error' });
      });
    return () => {
      abort.abort();
      session?.dispose();
    };
  }, [source, host]);

  if (loaded.status === 'loading') {
    return (
      <span className="muted pptx-message" aria-busy="true">
        {PPTX_MESSAGES.opening}
      </span>
    );
  }
  if (loaded.status === 'error') {
    return (
      <p role="alert" className="pptx-message">
        {PPTX_MESSAGES.unreadable}
      </p>
    );
  }
  if (loaded.status === 'refused') {
    return (
      <div role="alert" className="banner pptx-refused">
        <strong>{PPTX_MESSAGES.refusedTitle}</strong>
        <span>{PPTX_MESSAGES.refused[loaded.reason]}</span>
      </div>
    );
  }
  return <PresentationEditor {...props} session={loaded.session} />;
}

/** Edited paragraphs as a key, to tell whether editing changed anything. */
const editKey = (value: unknown) => JSON.stringify(value);

function PresentationEditor({ session, host, target, findRequests, readOnly }: DocumentViewerProps & { session: PptxSession }) {
  const state = useStore(session.store);
  const { model, slides, current, selection } = state;
  const [notShown] = useState(() => contentNotShown(model));
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [editing, setEditing] = useState<TextEditing | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  /** The editor's last selection, put back before formatting it from the toolbar's fields. */
  const editorRange = useRef<Range | null>(null);
  const notesDraft = useRef<{ index: number; text: string } | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [presenting, setPresenting] = useState<number | null>(null);
  const [findToggle, setFindToggle] = useState(() => ({ open: false, at: findRequests }));
  const findOpen = findRequests > findToggle.at || findToggle.open;
  const [find, setFind] = useState({ query: '', caseSensitive: false, wholeWord: false });
  const [matchIndex, setMatchIndex] = useState(0);
  const picker = useRef<HTMLInputElement>(null);

  const shapes = useMemo(() => slideShapes(model, current), [model, current]);
  const size = useMemo(() => slideSize(model), [model]);
  const notes = useMemo(() => slides.map((s) => s.notes), [slides]);
  const matches = useMemo(() => (findOpen ? findInSlides(model, notes, find.query, find) : []), [findOpen, model, notes, find]);
  const match = matches.length > 0 ? matches[Math.min(matchIndex, matches.length - 1)] : undefined;

  const refuse = useCallback(
    (err: unknown) => {
      if (!(err instanceof EditRefused)) throw err;
      host.notify(PPTX_MESSAGES.editRefused, 'error');
    },
    [host],
  );
  const run = useCallback(
    (change: () => void) => {
      try {
        change();
      } catch (err) {
        refuse(err);
      }
    },
    [refuse],
  );

  /** Ends text editing, giving the presentation what was typed. */
  const commitText = useCallback(() => {
    const element = editorRef.current;
    if (!editing) return;
    setEditing(null);
    editorRange.current = null;
    if (!element) return;
    const edited = readEditor(element);
    if (editedLength(edited) > MAX_SHAPE_TEXT_CHARS) return host.notify(PPTX_MESSAGES.textTooLong, 'error');
    if (editKey(edited) !== editKey(asEdited(editing.paragraphs))) run(() => session.setShapeText(editing.shapeId, edited));
  }, [editing, host, run, session]);

  /** Gives the presentation everything typed and not given yet: text being edited, then notes. */
  const commitDrafts = useCallback(() => {
    commitText();
    const draft = notesDraft.current;
    if (!draft) return;
    notesDraft.current = null;
    setDraftDirty(false);
    if (draft.text.length > MAX_SLIDE_NOTES_CHARS) host.notify(PPTX_MESSAGES.notesTooLong, 'error');
    else run(() => session.setNotes(draft.index, draft.text));
  }, [commitText, host, run, session]);

  const save = useCallback(async (): Promise<boolean> => {
    if (readOnly) return false;
    commitDrafts();
    const { model: saving, dirty } = session.state;
    if (!dirty) return true;
    let bytes: Uint8Array;
    try {
      bytes = session.bytes();
    } catch {
      host.notify(DOCUMENT_MESSAGES.saveFailed, 'error');
      return false;
    }
    setSaving(true);
    try {
      if (!(await host.save(bytes))) return false;
      session.markSaved(saving);
      return true;
    } finally {
      setSaving(false);
    }
  }, [commitDrafts, host, readOnly, session]);

  const unsaved = !readOnly && (state.dirty || draftDirty || editing !== null);
  useEffect(() => {
    host.setUnsaved(unsaved ? save : null);
  }, [unsaved, save, host]);
  useEffect(() => () => host.setUnsaved(null), [host]);

  useEffect(() => {
    if (!target || !('slide' in target.target)) return;
    const n = target.target.slide;
    if (n <= session.state.slides.length) session.goTo(n - 1);
    else host.notify(PPTX_MESSAGES.noSlide(n), 'error');
  }, [target, session, host]);

  // Comments on slides (D-165): the current slide and the selected shape are the anchor; revealing selects them again.
  useEffect(
    () =>
      host.comments({
        current: () => {
          const { current: index, selection: shapeId } = session.state;
          const shape = shapeId ? slideShapes(session.state.model, index).find((s) => s.id === shapeId) : undefined;
          return { anchor: { type: 'slide', slide: index + 1, shapeId: shape ? shape.id : null }, quote: shape?.name.slice(0, MAX_COMMENT_QUOTE) ?? '' };
        },
        reveal: (thread) => {
          const { anchor } = thread;
          if (anchor.type !== 'slide' || anchor.slide > session.state.slides.length) return false;
          session.goTo(anchor.slide - 1);
          if (anchor.shapeId && slideShapes(session.state.model, anchor.slide - 1).some((s) => s.id === anchor.shapeId)) session.select(anchor.shapeId);
          return true;
        },
      }),
    [host, session],
  );

  // The editor's selection, kept while the toolbar's size and color fields have the focus.
  useEffect(() => {
    if (!editing) return;
    const doc = editorRef.current?.ownerDocument;
    if (!doc) return;
    const remember = () => {
      const range = doc.getSelection()?.rangeCount ? doc.getSelection()!.getRangeAt(0) : null;
      if (range && editorRef.current?.contains(range.commonAncestorContainer)) editorRange.current = range.cloneRange();
    };
    doc.addEventListener('selectionchange', remember);
    return () => doc.removeEventListener('selectionchange', remember);
  }, [editing]);

  const goTo = (index: number) => {
    commitDrafts();
    session.goTo(index);
  };
  const startEditing = (shapeId: string) => {
    commitDrafts();
    try {
      setEditing({ shapeId, paragraphs: session.shapeText(shapeId) });
      session.select(shapeId);
    } catch (err) {
      refuse(err);
    }
  };

  const format = (change: RunFormat) => {
    const element = editorRef.current;
    if (editing && element) {
      const selection = element.ownerDocument.getSelection();
      if (editorRange.current && selection && !element.contains(selection.anchorNode)) {
        selection.removeAllRanges();
        selection.addRange(editorRange.current);
      }
      formatSelection(element, change, (span) => shownFormat(span, editing.paragraphs));
      element.focus();
      return;
    }
    if (selection) run(() => session.formatShape(selection, change));
  };
  const toggle = (key: 'bold' | 'italic' | 'underline') => {
    const element = editorRef.current;
    if (editing && element) {
      const anchor = element.ownerDocument.getSelection()?.anchorNode ?? null;
      const span = (anchor && element.contains(anchor) ? (anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement)?.closest<HTMLElement>('span[data-i]') : null) ?? element.querySelector<HTMLElement>('span[data-i]');
      format({ [key]: !(span && shownFormat(span, editing.paragraphs)[key]) });
      return;
    }
    if (!selection) return;
    try {
      const first = session.shapeText(selection).flatMap((p) => p.items).find((item) => item.kind === 'run');
      format({ [key]: !(first?.kind === 'run' && first.format[key]) });
    } catch (err) {
      refuse(err);
    }
  };

  const insertPicture = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > MAX_SLIDE_IMAGE_BYTES) return host.notify(PPTX_MESSAGES.notAnImage, 'error');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = slideImage(bytes);
    if (!image) return host.notify(PPTX_MESSAGES.notAnImage, 'error');
    commitDrafts();
    run(() => void session.addPicture(bytes, image.width, image.height));
  };
  const addTextBox = (text: string) => {
    commitDrafts();
    try {
      const id = session.addTextBox(text);
      if (id) setEditing({ shapeId: id, paragraphs: session.shapeText(id) });
    } catch (err) {
      refuse(err);
    }
  };
  const onPaste = (event: ClipboardEvent) => {
    if (readOnly) return;
    const file = Array.from(event.clipboardData.files).find((f) => f.type === 'image/png' || f.type === 'image/jpeg');
    const text = event.clipboardData.getData('text/plain');
    if (!file && text === '') return;
    event.preventDefault();
    if (file) void insertPicture(file);
    else addTextBox(text.slice(0, MAX_SHAPE_TEXT_CHARS));
  };

  const history = (step: 'undo' | 'redo') => {
    commitDrafts();
    setEditing(null);
    session[step]();
  };

  const isTextField = (element: EventTarget) => element instanceof HTMLElement && (element.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');
  const onKeyDownCapture = (event: KeyboardEvent) => {
    const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
    const key = event.key.toLowerCase();
    if (mod && !event.shiftKey && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      if (!saving) void save();
    } else if (event.key === 'F5' && !mod) {
      event.preventDefault();
      commitDrafts();
      setPresenting(current);
    } else if (mod && !readOnly && !isTextField(event.target) && (key === 'z' || key === 'y')) {
      event.preventDefault();
      history(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    }
  };

  /** Shows the slide of a match. */
  const showMatch = (found: (typeof matches)[number] | undefined) => {
    if (found && found.slide !== session.state.current) goTo(found.slide);
  };
  const search = (next: typeof find) => {
    setFind(next);
    setMatchIndex(0);
    showMatch(findInSlides(model, notes, next.query, next)[0]);
  };
  const step = (previous: boolean) => {
    if (matches.length === 0) return;
    const index = (Math.min(matchIndex, matches.length - 1) + (previous ? matches.length - 1 : 1)) % matches.length;
    setMatchIndex(index);
    showMatch(matches[index]);
  };

  const slide = slides[current];
  const textTarget = editing !== null || (shapes.find((s) => s.id === selection)?.text ?? false);
  const status = readOnly ? 'Read-only' : saving ? 'Saving…' : unsaved ? 'Unsaved changes' : '';
  const summary = find.query === '' ? '' : matches.length === 0 ? PPTX_MESSAGES.noMatches : `${Math.min(matchIndex, matches.length - 1) + 1} of ${matches.length}`;

  return (
    <div className="pptx-viewer" onKeyDownCapture={onKeyDownCapture}>
      <PptxToolbar
        ready
        readOnly={readOnly}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        slideCount={slides.length}
        textTarget={textTarget}
        zoom={zoom}
        findOpen={findOpen}
        status={status}
        canSave={unsaved && !saving}
        onAddSlide={() => {
          commitDrafts();
          run(() => session.addSlide());
        }}
        onDuplicateSlide={() => {
          commitDrafts();
          run(() => session.duplicateSlide(current));
        }}
        onDeleteSlide={() => {
          commitDrafts();
          run(() => session.deleteSlide(current));
        }}
        onAddTextBox={() => addTextBox(PPTX_MESSAGES.newTextBox)}
        onAddPicture={() => picker.current?.click()}
        onUndo={() => history('undo')}
        onRedo={() => history('redo')}
        onFormat={format}
        onToggle={toggle}
        onZoom={setZoom}
        onFind={() => (findOpen ? setFindToggle({ open: false, at: findRequests }) : setFindToggle({ open: true, at: findRequests }))}
        onPresent={() => {
          commitDrafts();
          setPresenting(current);
        }}
        onSave={() => void save()}
      />
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          void insertPicture(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {notShown.length > 0 ? (
        <p role="status" className="banner pptx-banner">
          {PPTX_MESSAGES.notShown(notShown)}
        </p>
      ) : null}
      {findOpen ? (
        <DocumentFindBar
          subject="presentation"
          initialQuery={find.query}
          summary={summary}
          focusRequests={findRequests}
          onQuery={(query) => search({ ...find, query })}
          onStep={step}
          onClose={() => setFindToggle({ open: false, at: findRequests })}
          options={[
            { label: 'Match case', checked: find.caseSensitive, onChange: (caseSensitive) => search({ ...find, caseSensitive }) },
            { label: 'Whole words', checked: find.wholeWord, onChange: (wholeWord) => search({ ...find, wholeWord }) },
          ]}
        />
      ) : null}
      <div className="pptx-body">
        <PptxThumbnails
          slides={slides}
          current={current}
          readOnly={readOnly}
          onSelect={goTo}
          onMove={(from, to) => {
            commitDrafts();
            run(() => session.moveSlide(from, to));
          }}
          onDuplicate={(index) => {
            commitDrafts();
            run(() => session.duplicateSlide(index));
          }}
          onDelete={(index) => {
            commitDrafts();
            if (slides.length <= 1) host.notify(PPTX_MESSAGES.lastSlide, 'error');
            else run(() => session.deleteSlide(index));
          }}
        />
        <div className="pptx-main">
          <PptxStage
            image={slide?.image ?? null}
            slideNumber={current + 1}
            slideCount={slides.length}
            size={size}
            shapes={shapes}
            zoom={zoom}
            selection={selection}
            highlight={match && match.slide === current ? match.shapeId : null}
            readOnly={readOnly}
            editing={editing}
            editorRef={editorRef}
            onSelect={(id) => {
              if (editing && id !== editing.shapeId) commitText();
              session.select(id);
            }}
            onChangeBox={(id, box) => run(() => session.setShapeBox(id, box))}
            onDelete={(id) => run(() => session.deleteShape(id))}
            onEditText={startEditing}
            onStopEditing={commitText}
            onFormatKey={toggle}
            onPaste={onPaste}
            onStep={(delta) => goTo(current + delta)}
          />
          {slide ? (
            <PptxNotes
              key={`${current}:${slide.partPath}:${slide.notes}`}
              slideNumber={current + 1}
              notes={slide.notes}
              readOnly={readOnly}
              highlighted={match !== undefined && match.slide === current && match.shapeId === null}
              onDraft={(text) => {
                notesDraft.current = text === null ? null : { index: current, text };
                setDraftDirty(text !== null);
              }}
              onCommit={() => commitDrafts()}
            />
          ) : null}
        </div>
      </div>
      {presenting !== null ? (
        <PptxPresenter
          slides={slides}
          start={presenting}
          onExit={(index) => {
            setPresenting(null);
            session.goTo(index);
          }}
        />
      ) : null}
    </div>
  );
}
