import type { DocumentKind } from '../../shared/documents/kinds';
import { DOCUMENT_MESSAGES } from '../../shared/documents/messages';
import { DocumentKindIcon } from '../ui/DocumentKindIcon';

export interface OfficeOffPanelProps {
  kind: DocumentKind;
  /** Why the file cannot be used right now (a missing linked original, a damaged file); null when it can. */
  problem: string | null;
  /** Why it does not open in the system app (a locked document); null when it does. */
  noSystemApp: string | null;
  busy: boolean;
  onOpenSystemApp(): void;
  onSaveCopy(): void;
  onTurnOn(): void;
}

/**
 * A Word, spreadsheet or PowerPoint document while Office documents are off (D-187): it is kept as it is and can be
 * opened with the system app or saved as a copy; its editor is not loaded.
 */
export function OfficeOffPanel({ kind, problem, noSystemApp, busy, onOpenSystemApp, onSaveCopy, onTurnOn }: OfficeOffPanelProps) {
  return (
    <section className="note-empty office-off" aria-labelledby="office-off-title">
      <DocumentKindIcon kind={kind} size={28} />
      <h3 id="office-off-title" className="office-off-title">
        {DOCUMENT_MESSAGES.officeOffPanel}
      </h3>
      <p className="muted" role={problem ? 'alert' : undefined}>
        {problem ?? DOCUMENT_MESSAGES.officeOffPanelDetail}
      </p>
      <div className="button-row office-off-actions">
        <button type="button" className="btn" disabled={problem !== null || noSystemApp !== null} title={noSystemApp ?? undefined} onClick={onOpenSystemApp}>
          Open with the system app
        </button>
        <button type="button" className="btn" disabled={problem !== null || busy} onClick={onSaveCopy}>
          Save a copy…
        </button>
        <button type="button" className="btn btn-primary" onClick={onTurnOn}>
          Turn on in Settings
        </button>
      </div>
    </section>
  );
}
