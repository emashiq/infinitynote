import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { displayTitle } from '../../shared/names';
import { NoteEditor } from '../editor/NoteEditor';
import { useNoteReminders } from '../reminders/note-reminders';
import { ReminderChipBar } from '../reminders/ReminderChipBar';
import { NoteBanners } from '../notes/NoteBanners';
import type { ActionResult } from '../notes/note-controller';
import { NoteDialogs, type NoteDialog } from '../notes/NoteDialogs';
import { NoteTitleInput } from '../notes/NoteTitleInput';
import { NoticeList } from '../shell/Notices';
import { useStore } from '../state/use-store';
import { ConfirmRunner, TRASH_CONFIRM } from '../ui/ConfirmDialog';
import { useSticky } from './sticky-context';
import { StickyHeader } from './StickyHeader';
import { StickyTrashState } from './StickyTrashState';

export const INVALID_WINDOW = 'This window could not be opened.';

/** Shown for an unknown route, or when main does not confirm the sticky's note. */
export function InvalidWindow() {
  return (
    <main className="screen-center">
      <p role="alert">{INVALID_WINDOW}</p>
      <button type="button" className="btn" onClick={() => window.close()}>
        Close
      </button>
    </main>
  );
}

/** The editor part of a sticky: the same banners, editor, find, links and conversions as a tab (INF-EDIT-01). */
function StickyNote({ editorRef, findRequest, onFindHandled }: { editorRef: RefObject<Editor | null>; findRequest: object | null; onFindHandled: () => void }) {
  const { controller, core, now } = useSticky();
  const state = useStore(controller.store);
  const [dialog, setDialog] = useState<NoteDialog | null>(null);
  // The sticky shows its note's reminders read-only; a click opens the reminder in the main window (D-080).
  const noteReminders = useNoteReminders(core.bridge, controller.noteId);
  const openReminder = (reminderId: string) =>
    void core.bridge.reminder.open({ reminderId }).then((res) => {
      if (!res.ok) core.notices.push(res.error.message, 'error');
    });
  const report = (result: Promise<ActionResult>) => {
    void result.then((r) => {
      if (!r.ok) core.notices.push(r.message, 'error');
    });
  };
  if (state.status === 'loading') return <p className="muted sticky-message">Opening note…</p>;
  if (state.status === 'missing' || state.status === 'error' || state.content === null) {
    return <p className="muted sticky-message">{state.status === 'missing' ? 'This note no longer exists' : 'This note could not be opened'}</p>;
  }
  const readOnly = state.status === 'readOnly';
  return (
    <>
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
      <ReminderChipBar reminders={noteReminders.reminders} displayZone={noteReminders.displayZone} onSelect={(r) => openReminder(r.id)} />
      <NoteEditor
        key={`${state.format}:${state.contentKey}`}
        host={controller}
        format={state.format}
        content={state.content}
        editable={!readOnly}
        variant="sticky"
        chips={noteReminders.chips}
        onChipClick={openReminder}
        scrollTop={0}
        onScroll={() => undefined}
        services={core.editor}
        findRequest={findRequest}
        onFindRequestHandled={onFindHandled}
        editorRef={editorRef}
        onConvert={(target) => (target === 'plain' ? setDialog({ kind: 'convert' }) : report(controller.convert('rich')))}
        onOpenVersions={() => setDialog({ kind: 'versions' })}
      />
      <NoteDialogs controller={controller} dialog={dialog} onDialog={setDialog} readOnly={readOnly} now={now()} report={report} />
    </>
  );
}

/** A sticky window (plan section 9.4, D-070). */
export function StickyView() {
  const services = useSticky();
  const { controller, actions, core } = services;
  const { phase } = useStore(services.phase);
  const sticky = useStore(services.sticky).current;
  const caps = useStore(services.caps).current;
  const note = useStore(controller.store);
  const { request: focusRequest } = useStore(services.focusEditor);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [findRequest, setFindRequest] = useState<object | null>(null);
  const trashed = sticky?.trashed != null || note.status === 'trashed';
  const collapsed = sticky?.collapsed ?? false;

  // Ctrl+W hides the window and Ctrl+F finds in the note (UX_SPEC section 7). The window closes when the W key is
  // released, so the key's release never reaches a closed window or the window that gets the focus next.
  useEffect(() => {
    let hidePending = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'w') {
        e.preventDefault();
        hidePending = true;
      } else if (key === 'f' && !collapsed && !trashed) {
        e.preventDefault();
        setFindRequest({});
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!hidePending || e.key.toLowerCase() !== 'w') return;
      hidePending = false;
      void actions.hide();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [actions, collapsed, trashed]);

  // Float of an open sticky: bring the caret into the editor.
  useEffect(() => {
    if (focusRequest > 0) editorRef.current?.commands.focus('end');
  }, [focusRequest, note.contentKey]);

  if (phase === 'invalid') return <InvalidWindow />;
  if (phase === 'loading' || !sticky) return <main className="sticky-window" aria-busy="true" />;

  return (
    <main className="sticky-window" data-sticky-color={sticky.color} data-collapsed={collapsed ? 'true' : undefined}>
      <h1 className="sr-only">{displayTitle(sticky.title)}</h1>
      <StickyHeader
        state={sticky}
        trashed={trashed}
        pinSupported={caps?.alwaysOnTop.status !== 'unsupported'}
        titleField={
          <NoteTitleInput
            controller={controller}
            liveTitle={sticky.title}
            readOnly={trashed || note.status !== 'ready'}
            className="sticky-title-input"
            inputRef={titleRef}
            editorRef={editorRef}
          />
        }
        actions={{
          setColor: (color) => void actions.setColor(color),
          togglePinned: () => void actions.togglePinned(),
          toggleCollapsed: () => void actions.toggleCollapsed(),
          openInApp: () => void actions.dock(),
          hide: () => void actions.hide(),
          remove: () => void actions.remove(),
          trash: () => setConfirmTrash(true),
          quit: () => void actions.quit(),
        }}
      />
      <div className="sticky-body" hidden={collapsed}>
        {trashed ? (
          <StickyTrashState onRestore={() => void actions.restore()} onClose={() => void actions.hide()} />
        ) : (
          <StickyNote editorRef={editorRef} findRequest={findRequest} onFindHandled={() => setFindRequest(null)} />
        )}
      </div>
      <NoticeList notices={core.notices} />
      {confirmTrash ? (
        <ConfirmRunner
          title={TRASH_CONFIRM.title}
          body={TRASH_CONFIRM.body(displayTitle(sticky.title))}
          confirmLabel={TRASH_CONFIRM.confirmLabel}
          confirmFirst
          run={actions.trash}
          onClose={() => setConfirmTrash(false)}
        />
      ) : null}
    </main>
  );
}
