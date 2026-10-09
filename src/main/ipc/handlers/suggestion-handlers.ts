import type { ReminderService } from '../../services/reminder-service';
import type { SuggestionService } from '../../services/suggestion-service';
import type { IpcRouter } from '../router';

export interface SuggestionHandlerDeps {
  reminders: () => ReminderService;
  suggestions: () => SuggestionService;
}

/**
 * Reminder suggestions (plan section 6.2, D-089): confirming a phrase, updating a reminder from its changed phrase, and
 * the dismissals. Every request names a note (or a reminder) and is checked against the stored text in main; the
 * router applies the sticky note-ownership rule and the role allowlists.
 */
export function registerSuggestionHandlers(router: IpcRouter, deps: SuggestionHandlerDeps): void {
  router.register('reminder:createFromSuggestion', (req) => deps.reminders().createFromSource(req));
  router.register('reminder:updateFromSource', (req) => deps.reminders().updateFromSource(req));
  router.register('suggestion:dismiss', (req) => deps.suggestions().dismiss(req));
  router.register('suggestion:listDismissed', (req) => deps.suggestions().listDismissed(req.noteId));
}
