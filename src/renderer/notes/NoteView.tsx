import { useEffect, useRef, useState } from 'react';
import type { NoteController } from './note-controller';
import { useServices, useStore } from '../state/use-store';
import { useLiveNote } from './live-note';
import { TempTextEditor } from './TempTextEditor';

const SAVE_LABEL = { saved: 'Saved', pending: 'Editing…', saving: 'Saving…', retrying: 'Not saved - retrying', error: 'Not saved' } as const;

export function NoteView({ controller, tabId }: { controller: NoteController; tabId: string }) {
  const services = useServices();
  const { tabs, tree, ui } = services;
  const state = useStore(controller.store);
  const uiState = useStore(ui.store);
  const session = useStore(tabs.store).session;
  const live = useLiveNote(controller);
  const liveTitle = live?.title ?? state.title;
  // Text typed into the title field; null means the field shows the current title from the tree.
  const [typed, setTyped] = useState<string | null>(null);
  const title = typed ?? liveTitle;
  const titleRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const tab = session.tabs.find((t) => t.id === tabId);
  const savedScroll = tab?.kind === 'note' ? (tab.scrollTop ?? 0) : 0;

  // Follow renames from elsewhere (tree, other windows) unless the field has focus: in-progress typing is never replaced.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTyped(null);
  }, [liveTitle]);

  // Focus request after creating a note.
  const request = uiState.focusRequest;
  const editable = state.status === 'ready' || state.status === 'readOnly';
  useEffect(() => {
    if (request?.target === 'noteTitle' && request.noteId === controller.noteId && editable && titleRef.current) {
      ui.consumeFocus();
      titleRef.current.focus();
    }
  }, [request, editable, controller.noteId, ui]);

  if (state.status === 'loading') return <div className="note-loading" aria-busy="true" />;

  if (state.status === 'trashed') {
    const batch = state.trashBatchId;
    return (
      <div className="note-empty">
        <h2 className="view-title">This note is in Trash</h2>
        <div className="button-row">
          {batch ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                void tree.restore(batch).then(async (res) => {
                  if (!res.ok) {
                    services.notices.push(res.message, 'error');
                    return;
                  }
                  await tabs.close(tabId);
                  await tabs.openNote(controller.noteId);
                })
              }
            >
              Restore
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => void tabs.close(tabId)}>
            Close tab
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'missing' || state.status === 'error') {
    return (
      <div className="note-empty">
        <h2 className="view-title">{state.status === 'missing' ? 'This note no longer exists' : 'This note could not be opened'}</h2>
        {state.message && state.status === 'error' ? <p className="muted">{state.message}</p> : null}
        <div className="button-row">
          <button type="button" className="btn" onClick={() => void tabs.close(tabId)}>
            Close tab
          </button>
        </div>
      </div>
    );
  }

  const readOnly = state.status === 'readOnly';
  const note = state.note;
  return (
    <div className="note-view">
      <h2 className="sr-only">{liveTitle.trim() === '' ? 'Untitled note' : liveTitle}</h2>
      <div className="note-header">
        <input
          ref={titleRef}
          aria-label="Title"
          className="note-title"
          placeholder="Untitled"
          value={title}
          readOnly={readOnly}
          onChange={(e) => {
            setTyped(e.target.value);
            controller.rename(e.target.value);
          }}
          onBlur={() => void controller.flush()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void controller.flush();
              textRef.current?.focus();
            }
          }}
        />
        <div className="note-meta">
          {note?.sticky ? (
            <span className="badge">
              {note.color ? <span className={`dot dot-${note.color}`} aria-hidden /> : null}
              Sticky
            </span>
          ) : null}
          <span className="muted">{(live?.path ?? note?.path ?? []).join(' › ')}</span>
          <span role="status" className="save-status">
            {SAVE_LABEL[state.save]}
          </span>
        </div>
        {state.titleError ? (
          <p role="alert" className="field-error">
            {state.titleError}
          </p>
        ) : null}
      </div>
      {readOnly ? <div className="banner">{state.message ?? 'This note is read-only.'}</div> : null}
      <TempTextEditor
        textareaRef={textRef}
        text={state.text}
        readOnly={readOnly}
        scrollTop={savedScroll}
        onChange={(t) => controller.setText(t)}
        onBlur={() => void controller.flush()}
        onScroll={(px) => tabs.setScrollTop(tabId, px)}
      />
    </div>
  );
}
