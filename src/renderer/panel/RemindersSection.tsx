import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ReminderDtoType } from '../../shared/contracts/reminders';
import { updateRequestFromText } from '../editor/suggestion-requests';
import { useLiveNote } from '../notes/live-note';
import type { NoteController } from '../notes/note-controller';
import { DueTime } from '../reminders/DueTime';
import { newReminderDialog, reminderInstant, useNoteReminders } from '../reminders/note-reminders';
import { BLOCK_REMOVED } from '../reminders/ReminderChipBar';
import { ReminderBadges } from '../reminders/ReminderRow';
import { SnoozeButton } from '../reminders/SnoozeMenu';
import { useServices, useStore } from '../state/use-store';

/**
 * The active note's reminders in the context panel (plan section 9.10): add, Done, Snooze, Edit, Delete, re-anchor, and
 * for a reminder whose source text changed, Update from text or Keep current time (Phase 06, D-092).
 */
export function RemindersSection({ controller }: { controller: NoteController | null }) {
  const [open, setOpen] = useState(true);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="info-section reminders-section">
      <h2 className="panel-heading">
        <button type="button" className="disclosure" aria-expanded={open} aria-controls="reminders-body" onClick={() => setOpen(!open)}>
          <Chevron size={14} strokeWidth={1.75} aria-hidden />
          Reminders
        </button>
      </h2>
      <div id="reminders-body" hidden={!open}>
        {controller ? <NoteRemindersList controller={controller} /> : <p className="muted">Open a note to see its reminders</p>}
      </div>
    </section>
  );
}

function NoteRemindersList({ controller }: { controller: NoteController }) {
  const { bridge, ui, reminders, editor } = useServices();
  const state = useStore(controller.store);
  const live = useLiveNote(controller);
  const { reminders: list, displayZone } = useNoteReminders(bridge, controller.noteId);
  const canAttach = state.format === 'rich' && state.cursorBlockId !== null;
  const edit = (r: ReminderDtoType) => ui.openDialog({ kind: 'reminder', noteId: r.noteId, reminder: r, blockId: r.blockId, title: r.title });
  const updateFromText = async (r: ReminderDtoType & { source: NonNullable<ReminderDtoType['source']> }) => {
    const context = await editor.suggestions.load(controller.noteId);
    if (!context) return;
    const note = { noteId: controller.noteId, noteTitle: live?.title ?? state.title, format: state.format };
    ui.openDialog({ kind: 'suggestion', request: updateRequestFromText(note, r, controller.phraseText(r.source.blockId), context) });
  };
  return (
    <>
      <button type="button" className="btn btn-small" onClick={() => ui.openDialog(newReminderDialog(controller, live?.title ?? state.title))}>
        Add reminder
      </button>
      <ul className="panel-reminders">
        {list.map((r) => {
          const current = r.current;
          const isOpen = current !== null && (current.state === 'pending' || current.state === 'snoozed');
          return (
            <li key={r.id} className="panel-reminder" aria-label={r.title}>
              <span className="reminder-title">{r.title}</span>
              <DueTime instant={current?.dueAtUtc ?? reminderInstant(r)} zoneId={r.zoneId} displayZone={displayZone} />
              {current ? <ReminderBadges item={current} /> : null}
              {r.source?.state === 'changed' ? (
                <div className="source-changed">
                  <span>The text this reminder came from changed: “{r.source.text}”.</span>
                  <button type="button" className="btn btn-small" onClick={() => void updateFromText({ ...r, source: r.source! })}>
                    Update from text…
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => void reminders.keepSource(r.id)}>
                    Keep current time
                  </button>
                </div>
              ) : null}
              {r.anchorState === 'block_missing' ? (
                <div className="anchor-missing">
                  <span className="muted">{BLOCK_REMOVED}</span>
                  {r.source?.state === 'missing' ? <span className="muted">Created from “{r.source.text}”</span> : null}
                  <button type="button" className="btn btn-small" disabled={!canAttach} onClick={() => void reminders.setAnchor(r, state.cursorBlockId)}>
                    Attach to current paragraph
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => void reminders.setAnchor(r, null)}>
                    Keep note-level
                  </button>
                </div>
              ) : null}
              <div className="reminder-actions">
                {isOpen ? (
                  <button type="button" className="btn btn-small" onClick={() => void reminders.complete(current)}>
                    Done
                  </button>
                ) : null}
                {current?.overdue ? <SnoozeButton onSnooze={(preset) => void reminders.snooze(current, preset)} /> : null}
                <button type="button" className="btn btn-small" onClick={() => edit(r)}>
                  Edit
                </button>
                <button type="button" className="btn btn-small" onClick={() => void reminders.delete(r.id)}>
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
