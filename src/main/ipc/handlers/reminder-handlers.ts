import { AppError } from '../../services/app-error';
import type { ReminderService } from '../../services/reminder-service';
import type { IpcRouter } from '../router';

export interface ReminderHandlerDeps {
  reminders: () => ReminderService;
  /** Shows a reminder's note (and its block) in the main window, which takes the focus. */
  openNote(noteId: string, blockId: string | null): void;
}

/** Reminder, view and occurrence channels (D-074). Main resolves every instant itself from date, time and zone. */
export function registerReminderHandlers(router: IpcRouter, deps: ReminderHandlerDeps): void {
  const { reminders } = deps;
  router.register('zones:list', () => reminders().zones());
  router.register('reminder:create', (req) => reminders().create(req));
  router.register('reminder:update', (req) => reminders().update(req));
  router.register('reminder:delete', (req) => reminders().delete(req.reminderId));
  router.register('reminder:undoDelete', (req) => reminders().undoDelete(req.reminderId));
  router.register('reminder:listForNote', (req) => reminders().listForNote(req.noteId));
  router.register('reminder:open', (req, ctx) => {
    const source = reminders().source(req.reminderId);
    // A sticky window may open only the reminders of its own note (D-074).
    if (ctx.sender.role === 'sticky' && source.noteId !== ctx.sender.noteId) throw new AppError('FORBIDDEN', 'Not allowed');
    deps.openNote(source.noteId, source.blockId);
    return {};
  });
  router.register('reminders:listView', (req) => reminders().listView(req.view, req.scope));
  router.register('reminders:summary', (req) => reminders().summary(req.scope));
  router.register('occurrence:complete', (req) => reminders().complete(req.occurrenceId));
  router.register('occurrence:snooze', (req) => reminders().snooze(req.occurrenceId, req.preset));
}
