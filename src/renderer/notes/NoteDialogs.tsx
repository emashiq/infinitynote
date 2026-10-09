import { useCallback } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { CardRequest } from '../reminders/card-request';
import { SuggestionCard } from '../reminders/SuggestionCard';
import type { VersionSummaryType } from '../../shared/contracts/notes';
import { useStore } from '../state/use-store';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CompareDialog } from './CompareDialog';
import type { ActionResult, NoteController } from './note-controller';
import { VersionsDialog } from './VersionsDialog';

export const CONVERT_TITLE = 'Convert to plain text?';
export const CONVERT_BODY = 'Formatting, fonts and colors, checklists, links and images will be removed, and tables become lines of tab-separated text. A version of the current note is saved so you can restore it.';
export const RESTORE_VERSION_TITLE = 'Restore this version?';
export const RESTORE_VERSION_BODY = 'The current content is saved as a version first.';

export type NoteDialog =
  | { kind: 'convert' }
  | { kind: 'versions' }
  | { kind: 'restoreVersion'; version: VersionSummaryType }
  | { kind: 'compare'; draftId: string }
  /** A reminder suggestion's card in a window without the main window's dialog host (a sticky). */
  | { kind: 'suggestion'; request: CardRequest };

/**
 * The note dialogs shared by tabs and sticky windows: plain-text conversion, version history, version restore, the
 * recovered-draft comparison and (in stickies) the suggestion card. Failed actions go to `report`; restores wait while
 * another content operation of the note runs (`busy`).
 */
export function NoteDialogs({
  controller,
  dialog,
  onDialog,
  busy,
  now,
  report,
  bridge,
  notify,
}: {
  controller: NoteController;
  dialog: NoteDialog | null;
  onDialog: (next: NoteDialog | null) => void;
  busy: boolean;
  now: number;
  report: (result: Promise<ActionResult>) => void;
  bridge: Pick<InfinityBridge, 'zones' | 'settings' | 'reminder'>;
  notify: (message: string) => void;
}) {
  const loadVersions = useCallback(() => controller.listVersions(), [controller]);
  const close = () => onDialog(null);
  const { drafts, note } = useStore(controller.store);
  const compareDraft = dialog?.kind === 'compare' ? (drafts.find((d) => d.id === dialog.draftId) ?? null) : null;
  return (
    <>
      {dialog?.kind === 'convert' ? (
        <ConfirmDialog
          title={CONVERT_TITLE}
          body={CONVERT_BODY}
          confirmLabel="Convert"
          confirmFirst={false}
          onClose={close}
          onConfirm={() => {
            close();
            report(controller.convert('plain'));
          }}
        />
      ) : null}
      {dialog?.kind === 'versions' ? (
        <VersionsDialog load={loadVersions} now={now} canRestore={!busy} locked={note?.locked ?? false} onClose={close} onRestore={(version) => onDialog({ kind: 'restoreVersion', version })} />
      ) : null}
      {dialog?.kind === 'restoreVersion' ? (
        <ConfirmDialog
          title={RESTORE_VERSION_TITLE}
          body={RESTORE_VERSION_BODY}
          confirmLabel="Restore"
          confirmFirst
          onClose={close}
          onConfirm={() => {
            close();
            report(controller.restoreVersion(dialog.version.id));
          }}
        />
      ) : null}
      {dialog?.kind === 'suggestion' ? (
        <SuggestionCard
          request={dialog.request}
          bridge={bridge}
          persist={async () => (await controller.flush()).ok}
          persistBlocks={() => controller.persistBlockIds()}
          notify={notify}
          onClose={close}
        />
      ) : null}
      {compareDraft ? (
        <CompareDialog
          current={controller.currentText()}
          draft={compareDraft}
          canRestore={!busy}
          onClose={close}
          onRestore={() => {
            close();
            report(controller.restoreDraft(compareDraft.id));
          }}
        />
      ) : null}
    </>
  );
}
