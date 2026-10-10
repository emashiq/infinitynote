import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { BackupSummaryType, NoteDiagramType } from '../../shared/contracts/portability';
import type { NoticeStore } from './notice-store';
import { failOutcome, okOutcome, type Outcome } from './store';
import type { UiStore } from './ui-store';

/** The last segment of a path main returned (Windows or POSIX separators). */
export const fileName = (file: string): string => file.split(/[\\/]/).pop() ?? file;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function restoreConfirmBody(summary: BackupSummaryType, formatDate: (ms: number) => string): string {
  return (
    `Restore the backup from ${formatDate(summary.createdAt)}? It has ${plural(summary.notes, 'note', 'notes')} and ` +
    `${plural(summary.attachments, 'attachment', 'attachments')}. Your current notes, reminders and settings are replaced by the backup. ` +
    'A copy of your current data is kept, and Infinity Notes restarts to finish.'
  );
}

export interface PortabilityCommands {
  backUp(): Promise<void>;
  /** Chooses and checks a backup, then asks for confirmation (the restoreBackup dialog). */
  restore(): Promise<void>;
  /** The confirmed restore: main schedules it and restarts the app. */
  confirmRestore(): Promise<Outcome<unknown>>;
  exportNote(noteId: string, format: 'markdown' | 'text'): Promise<void>;
  /** "Export as HTML…" and "Export as PDF…" with the note's diagrams drawn (D-163). */
  exportNoteDocument(noteId: string, format: 'html' | 'pdf'): Promise<void>;
  printNote(noteId: string): Promise<void>;
  exportAll(): Promise<void>;
  importNotes(): Promise<void>;
}

/**
 * Backup, restore, export and import from the main window (D-099): main shows the file dialogs and does the work; this
 * reports the result in a notice. Unsaved edits of the active note are flushed before a backup or an export.
 */
export function createPortabilityCommands(deps: {
  bridge: InfinityBridge;
  notices: NoticeStore;
  ui: UiStore;
  flushActive: () => Promise<unknown>;
  /** The open note's Mermaid diagrams, drawn for an export (D-163). */
  noteDiagrams: () => Promise<NoteDiagramType[]>;
}): PortabilityCommands {
  const { bridge, notices, ui } = deps;
  const report = async <T>(request: Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>, done: (data: T) => string | null) => {
    const res = await request;
    if (!res.ok) {
      notices.push(res.error.message, 'error');
      return;
    }
    const text = done(res.data);
    if (text) notices.push(text);
  };
  return {
    async backUp() {
      await deps.flushActive();
      await report(bridge.backup.create(), (r) => (r.canceled ? null : `Backup saved: ${fileName(r.file)}`));
    },
    async restore() {
      const res = await bridge.backup.prepareRestore();
      if (!res.ok) notices.push(res.error.message, 'error');
      else if (!res.data.canceled) ui.openDialog({ kind: 'restoreBackup', summary: res.data.summary });
    },
    async confirmRestore() {
      const res = await bridge.backup.restore();
      return res.ok ? okOutcome(res.data) : failOutcome(res.error.code, res.error.message);
    },
    async exportNote(noteId, format) {
      await deps.flushActive();
      await report(bridge.export.markdown({ noteId, format }), (r) => (r.canceled ? null : `Exported to ${fileName(r.file)}`));
    },
    async exportNoteDocument(noteId, format) {
      await deps.flushActive();
      const diagrams = await deps.noteDiagrams();
      await report(bridge.export.noteDocument({ noteId, format, diagrams }), (r) => (r.canceled ? null : `Exported to ${fileName(r.file)}`));
    },
    async printNote(noteId) {
      await deps.flushActive();
      const diagrams = await deps.noteDiagrams();
      await report(bridge.note.print({ noteId, diagrams }), () => null);
    },
    async exportAll() {
      await deps.flushActive();
      await report(bridge.export.portable(), (r) => {
        if (r.canceled) return null;
        const locked = r.skippedLocked > 0 ? `. ${plural(r.skippedLocked, 'locked note was', 'locked notes were')} not included` : '';
        return `Exported ${plural(r.counts.notes, 'note', 'notes')} to ${fileName(r.file)}${locked}`;
      });
    },
    async importNotes() {
      await report(bridge.import.portable(), (r) => {
        if (r.canceled) return null;
        const into = r.folderName ? ` into “${r.folderName}”` : '';
        const skipped = r.skippedReminders > 0 ? `. ${plural(r.skippedReminders, 'reminder', 'reminders')} could not be added` : '';
        return `Imported ${plural(r.counts.notes, 'note', 'notes')}${into}${skipped}`;
      });
    },
  };
}
