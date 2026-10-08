import type { Editor } from '@tiptap/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VersionSummaryType } from '../../shared/contracts/notes';
import { NoteEditor } from '../editor/NoteEditor';
import { useServices, useStore } from '../state/use-store';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CompareDialog } from './CompareDialog';
import { useLiveNote } from './live-note';
import { NoteBanners } from './NoteBanners';
import type { ActionResult, NoteController } from './note-controller';
import { VersionsDialog } from './VersionsDialog';

const SAVE_LABEL = { saved: 'Saved', pending: 'Editing…', saving: 'Saving…', retrying: 'Not saved - retrying', error: 'Not saved' } as const;

export const CONVERT_TITLE = 'Convert to plain text?';
export const CONVERT_BODY = 'Formatting, checklists, links and images will be removed. A version of the current note is saved so you can restore it.';
export const RESTORE_VERSION_TITLE = 'Restore this version?';
export const RESTORE_VERSION_BODY = 'The current content is saved as a version first.';

type NoteDialog = { kind: 'convert' } | { kind: 'versions' } | { kind: 'restoreVersion'; version: VersionSummaryType } | { kind: 'compare'; draftId: string };

export function NoteView({ controller, tabId }: { controller: NoteController; tabId: string }) {
  const services = useServices();
  const { tabs, tree, ui, notices, now } = services;
  const state = useStore(controller.store);
  const uiState = useStore(ui.store);
  const session = useStore(tabs.store).session;
  const live = useLiveNote(controller);
  const liveTitle = live?.title ?? state.title;
  // Text typed into the title field; null means the field shows the current title from the tree.
  const [typed, setTyped] = useState<string | null>(null);
  const title = typed ?? liveTitle;
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [dialog, setDialog] = useState<NoteDialog | null>(null);
  const tab = session.tabs.find((t) => t.id === tabId);
  const savedScroll = tab?.kind === 'note' ? (tab.scrollTop ?? 0) : 0;

  // Follow renames from elsewhere (tree, other windows) unless the field has focus: in-progress typing is never replaced.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTyped(null);
  }, [liveTitle]);

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
  const loadVersions = useCallback(() => controller.listVersions(), [controller]);

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
  const compareDraft = dialog?.kind === 'compare' ? (state.drafts.find((d) => d.id === dialog.draftId) ?? null) : null;
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
              editorRef.current?.commands.focus('start');
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
      {dialog?.kind === 'convert' ? (
        <ConfirmDialog
          title={CONVERT_TITLE}
          body={CONVERT_BODY}
          confirmLabel="Convert"
          confirmFirst={false}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            report(controller.convert('plain'));
          }}
        />
      ) : null}
      {dialog?.kind === 'versions' ? (
        <VersionsDialog
          load={loadVersions}
          now={now()}
          canRestore={!readOnly}
          onClose={() => setDialog(null)}
          onRestore={(version) => setDialog({ kind: 'restoreVersion', version })}
        />
      ) : null}
      {dialog?.kind === 'restoreVersion' ? (
        <ConfirmDialog
          title={RESTORE_VERSION_TITLE}
          body={RESTORE_VERSION_BODY}
          confirmLabel="Restore"
          confirmFirst
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const { version } = dialog;
            setDialog(null);
            report(controller.restoreVersion(version.id));
          }}
        />
      ) : null}
      {compareDraft ? (
        <CompareDialog
          current={controller.currentText()}
          draft={compareDraft}
          canRestore={!readOnly}
          onClose={() => setDialog(null)}
          onRestore={() => {
            setDialog(null);
            report(controller.restoreDraft(compareDraft.id));
          }}
        />
      ) : null}
    </div>
  );
}
