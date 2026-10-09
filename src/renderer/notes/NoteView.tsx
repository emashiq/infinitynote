import { useCallback, useEffect, useState } from 'react';
import { REMINDER_MESSAGES } from '../../shared/contracts/reminders';
import { NoteEditor } from '../editor/NoteEditor';
import { newReminderDialog, useNoteReminders } from '../reminders/note-reminders';
import { ReminderChipBar } from '../reminders/ReminderChipBar';
import { useServices, useStore } from '../state/use-store';
import { useLiveNote } from './live-note';
import { LockScreen } from './LockScreen';
import { NoteBanners } from './NoteBanners';
import type { ActionResult, NoteController } from './note-controller';
import { NoteDialogs, type NoteDialog } from './NoteDialogs';

const SAVE_LABEL = { saved: 'Saved', pending: 'Editing…', saving: 'Saving…', retrying: 'Not saved - retrying', error: 'Not saved' } as const;

/**
 * The save state, read out by screen readers as it changes. It is visible only when the note is not saved (D-102);
 * the reason (for example a note too large to save) is shown below it.
 */
function SaveStatus({ save, message }: { save: keyof typeof SAVE_LABEL; message?: string }) {
  const attention = save === 'retrying' || save === 'error';
  return (
    <span role="status" className={attention ? 'save-status save-status-alert' : 'save-status sr-only'} title={save === 'error' ? message : undefined}>
      {SAVE_LABEL[save]}
    </span>
  );
}

export function NoteView({ controller, tabId }: { controller: NoteController; tabId: string }) {
  const services = useServices();
  const { tabs, tree, ui, notices, commands, now } = services;
  const state = useStore(controller.store);
  const uiState = useStore(ui.store);
  const session = useStore(tabs.store).session;
  const live = useLiveNote(controller);
  const liveTitle = live?.title ?? state.title;
  const [dialog, setDialog] = useState<NoteDialog | null>(null);
  const noteReminders = useNoteReminders(services.bridge, controller.noteId);
  const tab = session.tabs.find((t) => t.id === tabId);
  const savedScroll = tab?.kind === 'note' ? (tab.scrollTop ?? 0) : 0;
  const reopen = useCallback(() => void controller.reopen(), [controller]);
  const locked = live?.locked ?? false;

  // The tab is the note's title (D-102): a title request renames the tab once the note is open. Ctrl+F requests are
  // handed to the editor below.
  const request = uiState.focusRequest;
  const shown = state.status === 'ready';
  useEffect(() => {
    if (request?.target === 'noteTitle' && request.noteId === controller.noteId && shown) {
      ui.consumeFocus();
      ui.startTabRename(tabId);
    }
  }, [request, shown, controller.noteId, tabId, ui]);
  const findRequest = request?.target === 'noteFind' && request.noteId === controller.noteId ? request : null;
  const referenceRequest = request?.target === 'noteReference' && request.noteId === controller.noteId ? request : null;
  // A reference to this note may have brought the user here: offer to look for what they meant (INF-REF-06).
  const searchButton = (
    <button type="button" className="btn" onClick={() => ui.openPalette(state.title)}>
      Search
    </button>
  );

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
          {searchButton}
          <button type="button" className="btn" onClick={() => void tabs.close(tabId)}>
            Close tab
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'locked') {
    // Mounted again when the lock changes elsewhere (removed in Lock settings), so it checks the note's state again.
    return <LockScreen key={String(locked)} noteId={controller.noteId} title={liveTitle} bridge={services.bridge} onUnlocked={reopen} />;
  }

  if (state.status === 'missing' || state.status === 'error' || state.content === null) {
    return (
      <div className="note-empty">
        <h2 className="view-title">{state.status === 'missing' ? 'This note no longer exists' : 'This note could not be opened'}</h2>
        {state.message && state.status === 'error' ? <p className="muted">{state.message}</p> : null}
        <div className="button-row">
          {state.status === 'missing' ? searchButton : null}
          <button type="button" className="btn" onClick={() => void tabs.close(tabId)}>
            Close tab
          </button>
        </div>
      </div>
    );
  }

  const busy = state.busy !== null;
  const editReminder = (reminderId: string) => {
    const reminder = noteReminders.reminders.find((r) => r.id === reminderId);
    if (reminder) ui.openDialog({ kind: 'reminder', noteId: reminder.noteId, reminder, blockId: reminder.blockId, title: reminder.title });
  };
  return (
    <div className="note-view">
      <h2 className="sr-only">{liveTitle.trim() === '' ? 'Untitled note' : liveTitle}</h2>
      <div className="note-header">
        <SaveStatus save={state.save} message={state.message} />
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
          compare: (draftId) => setDialog({ kind: 'compare', draftId }),
          restoreDraft: (draftId) => report(controller.restoreDraft(draftId)),
          dismissDraft: (draftId) => report(controller.dismissDraft(draftId)),
          restoreFormatted: (versionId) => report(controller.restoreVersion(versionId)),
          dismissConverted: () => controller.dismissConverted(),
        }}
      />
      <ReminderChipBar reminders={noteReminders.reminders} displayZone={noteReminders.displayZone} onSelect={(r) => editReminder(r.id)} />
      <NoteEditor
        key={`${state.format}:${state.contentKey}`}
        host={controller}
        format={state.format}
        content={state.content}
        sync={{ version: state.syncVersion, clientID: controller.viewId }}
        editable={!busy}
        variant="tab"
        scrollTop={savedScroll}
        onScroll={(px) => tabs.setScrollTop(tabId, px)}
        services={services.editor}
        findRequest={findRequest}
        onFindRequestHandled={() => ui.consumeFocus()}
        referenceRequest={referenceRequest}
        onReferenceRequestHandled={() => ui.consumeFocus()}
        handle={services.noteEditor}
        onConvert={(target) => (target === 'plain' ? setDialog({ kind: 'convert' }) : report(controller.convert('rich')))}
        onOpenVersions={() => setDialog({ kind: 'versions' })}
        chips={noteReminders.chips}
        onChipClick={editReminder}
        reveal={state.reveal}
        onRevealDone={(found) => {
          if (!found) notices.push(REMINDER_MESSAGES.blockGone, 'error');
          controller.revealDone();
        }}
        onAddReminder={() => ui.openDialog(newReminderDialog(controller, liveTitle))}
        // A locked note never floats and keeps no reminder source text (D-111, D-112).
        onFloat={locked ? undefined : () => void commands.float(controller.noteId)}
        lock={{ locked, open: () => commands.openLock(controller.noteId), lockNow: () => void commands.lockNow(controller.noteId) }}
        suggestions={
          locked
            ? undefined
            : {
                noteId: controller.noteId,
                noteTitle: liveTitle,
                reminders: noteReminders.reminders,
                openCard: (request) => ui.openDialog({ kind: 'suggestion', request }),
              }
        }
      />
      <NoteDialogs
        controller={controller}
        dialog={dialog}
        onDialog={setDialog}
        busy={busy}
        now={now()}
        report={report}
        bridge={services.bridge}
        notify={(message) => notices.push(message, 'info')}
      />
    </div>
  );
}
