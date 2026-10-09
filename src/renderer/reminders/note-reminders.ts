import { useEffect, useMemo, useState } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { OccurrenceItemType, ReminderDtoType } from '../../shared/contracts/reminders';
import { dueLines, formatShort } from '../../shared/time/format';
import { resolveLocal } from '../../shared/time/resolve';
import type { ChipInfo } from '../editor/reminder-chips';
import { createStore, type Store } from '../state/store';
import { useStore } from '../state/use-store';
import type { DialogState } from '../state/ui-store';
import type { NoteController } from '../notes/note-controller';
import { displayTitle } from '../../shared/names';

export interface NoteRemindersState {
  reminders: ReminderDtoType[];
  displayZone: string | null;
  loaded: boolean;
}

/** The live reminders of one note (chips, chip bar, panel): read on open and again on every `reminder:changed`. */
export class NoteReminders {
  readonly store: Store<NoteRemindersState> = createStore<NoteRemindersState>({ reminders: [], displayZone: null, loaded: false });
  private loading: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly bridge: InfinityBridge,
    readonly noteId: string,
  ) {}

  /** Coalesced: a call during a read schedules exactly one more read. */
  load(): Promise<void> {
    if (this.loading) {
      this.again = true;
      return this.loading;
    }
    this.loading = (async () => {
      try {
        do {
          this.again = false;
          const res = await this.bridge.reminder.listForNote({ noteId: this.noteId });
          if (res.ok) this.store.setState({ reminders: res.data.reminders, displayZone: res.data.displayZone, loaded: true });
        } while (this.again);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }
}

/** When a reminder is next due: its current occurrence, else its own date and time. */
export function reminderInstant(r: ReminderDtoType): number {
  return r.current?.effectiveAtUtc ?? resolveLocal({ date: r.date, time: r.time }, r.zoneId, r.foldPreference).instantUtc;
}

export function chipState(item: OccurrenceItemType | null): ChipInfo['state'] {
  if (!item) return 'pending';
  if (item.state === 'completed') return 'done';
  if (item.overdue) return 'overdue';
  return item.state === 'snoozed' ? 'snoozed' : 'pending';
}

/** "Reminder: Pay rent, Fri 9 Oct 2026, 17:00 · Asia/Dhaka" (the due time in the reminder's zone). */
export function reminderLabel(r: ReminderDtoType, displayZone: string | null): string {
  const due = r.current?.dueAtUtc ?? reminderInstant(r);
  return `Reminder: ${r.title}, ${dueLines(due, r.zoneId, displayZone).primary}`;
}

/** Reminders anchored to a block that is still in the note show as chips inside the text (D-080). */
export function isAnchored(r: ReminderDtoType): r is ReminderDtoType & { blockId: string } {
  return r.blockId !== null && r.anchorState === 'ok';
}

export function chipsOf(reminders: readonly ReminderDtoType[], displayZone: string | null): ChipInfo[] {
  return reminders.filter(isAnchored).map((r) => ({
    reminderId: r.id,
    blockId: r.blockId,
    label: formatShort(reminderInstant(r), r.zoneId),
    state: chipState(r.current),
    ariaLabel: reminderLabel(r, displayZone),
    sourceChanged: r.source?.state === 'changed',
  }));
}

/**
 * The reminders of the active note, loaded on mount and refreshed on `reminder:changed` for this note (or for every
 * note: zone and settings changes).
 */
export function useNoteReminders(bridge: InfinityBridge, noteId: string): NoteRemindersState & { model: NoteReminders; chips: ChipInfo[] } {
  const [model] = useState(() => new NoteReminders(bridge, noteId));
  useEffect(() => {
    void model.load();
    return bridge.subscribe('reminder:changed', ({ noteIds }) => {
      if (noteIds.length === 0 || noteIds.includes(noteId)) void model.load();
    });
  }, [bridge, model, noteId]);
  const state = useStore(model.store);
  const chips = useMemo(() => chipsOf(state.reminders, state.displayZone), [state.reminders, state.displayZone]);
  return { ...state, model, chips };
}

/** The add dialog for the active note: anchored to the paragraph at the cursor (rich notes), titled with its text. */
export function newReminderDialog(controller: NoteController, noteTitle: string): Extract<DialogState, { kind: 'reminder' }> {
  const { format, cursorBlockId } = controller.store.getState();
  const blockId = format === 'rich' ? cursorBlockId : null;
  const text = blockId ? (controller.blockText(blockId) ?? '').trim() : '';
  return { kind: 'reminder', noteId: controller.noteId, reminder: null, blockId, title: text ? text.slice(0, 80) : displayTitle(noteTitle) };
}
