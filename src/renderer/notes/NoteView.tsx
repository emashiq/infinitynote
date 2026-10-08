import type { Editor } from '@tiptap/core';
import { PictureInPicture2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NoteEditor } from '../editor/NoteEditor';
import { useServices, useStore } from '../state/use-store';
import { IconButton } from '../ui/IconButton';
import { useLiveNote } from './live-note';
import { NoteBanners } from './NoteBanners';
import type { ActionResult, NoteController } from './note-controller';
import { NoteDialogs, type NoteDialog } from './NoteDialogs';
import { NoteTitleInput } from './NoteTitleInput';

const SAVE_LABEL = { saved: 'Saved', pending: 'Editing…', saving: 'Saving…', retrying: 'Not saved - retrying', error: 'Not saved' } as const;

export function NoteView({ controller, tabId }: { controller: NoteController; tabId: string }) {
  const services = useServices();
  const { tabs, tree, ui, notices, commands, now } = services;
  const state = useStore(controller.store);
  const uiState = useStore(ui.store);
  const session = useStore(tabs.store).session;
  const live = useLiveNote(controller);
  const liveTitle = live?.title ?? state.title;
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [dialog, setDialog] = useState<NoteDialog | null>(null);
  const tab = session.tabs.find((t) => t.id === tabId);
  const savedScroll = tab?.kind === 'note' ? (tab.scrollTop ?? 0) : 0;

  // Focus request after creating a note; Ctrl+F requests are handed to the editor below.
  const request = uiState.focusRequest;
  const shown = state.status === 'ready' || state.status === 'readOnly';
  useEffect(() => {
    if (request?.target === 'noteTitle' && request.noteId === controller.noteId && shown && titleRef.current) {
      ui.consumeFocus();
      titleRef.current.focus();
    }
  }, [request, shown, controller.noteId, ui]);
  const findRequest = request?.target === 'noteFind' && request.noteId === controller.noteId ? request : null;

  const report = (result: Promise<ActionResult>) => {
    void result.then((r) => {
      if (!r.ok) notices.push(r.message, 'error');
    });
  };

  if (state.status === 'loading') {
    return (
      <div className="note-loading" aria-busy="true">
        <span className="muted">Opening note…</span>
      </div>
    );
  }

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
                    notices.push(res.message, 'error');
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

  if (state.status === 'missing' || state.status === 'error' || state.content === null) {
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
        <div className="note-title-row">
          <NoteTitleInput controller={controller} liveTitle={liveTitle} readOnly={readOnly} className="note-title" inputRef={titleRef} editorRef={editorRef} />
          <IconButton label="Float as sticky" icon={PictureInPicture2} onClick={() => void commands.float(controller.noteId)} />
        </div>
        <div className="note-meta">
          {note?.sticky ? (
            <span className="badge">
              {note.color ? <span className={`dot dot-${note.color}`} aria-hidden /> : null}
              Sticky
            </span>
          ) : null}
          <span className="muted">{(live?.path ?? note?.path ?? []).join(' › ')}</span>
          <span role="status" className="save-status" title={state.save === 'error' ? state.message : undefined}>
            {SAVE_LABEL[state.save]}
          </span>
        </div>
        {state.save === 'error' && state.message ? (
          <p role="alert" className="field-error save-error">
            {state.message}
          </p>
        ) : null}
        {state.titleError ? (
          <p role="alert" className="field-error">
            {state.titleError}
          </p>
        ) : null}
      </div>
      <NoteBanners
        state={state}
        now={now()}
        actions={{
          takeEditControl: () => report(controller.takeEditControl()),
          compare: (draftId) => setDialog({ kind: 'compare', draftId }),
          restoreDraft: (draftId) => report(controller.restoreDraft(draftId)),
          dismissDraft: (draftId) => report(controller.dismissDraft(draftId)),
          restoreFormatted: (versionId) => report(controller.restoreVersion(versionId)),
          dismissConverted: () => controller.dismissConverted(),
        }}
      />
      <NoteEditor
        key={`${state.format}:${state.contentKey}`}
        host={controller}
        format={state.format}
        content={state.content}
        editable={!readOnly}
        variant="tab"
        scrollTop={savedScroll}
        onScroll={(px) => tabs.setScrollTop(tabId, px)}
        services={services.editor}
        findRequest={findRequest}
        onFindRequestHandled={() => ui.consumeFocus()}
        editorRef={editorRef}
        onConvert={(target) => (target === 'plain' ? setDialog({ kind: 'convert' }) : report(controller.convert('rich')))}
        onOpenVersions={() => setDialog({ kind: 'versions' })}
      />
      <NoteDialogs controller={controller} dialog={dialog} onDialog={setDialog} readOnly={readOnly} now={now()} report={report} />
    </div>
  );
}
