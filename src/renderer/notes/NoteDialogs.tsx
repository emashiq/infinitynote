import { useCallback } from 'react';
import type { VersionSummaryType } from '../../shared/contracts/notes';
import { useStore } from '../state/use-store';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CompareDialog } from './CompareDialog';
import type { ActionResult, NoteController } from './note-controller';
import { VersionsDialog } from './VersionsDialog';

export const CONVERT_TITLE = 'Convert to plain text?';
export const CONVERT_BODY = 'Formatting, checklists, links and images will be removed. A version of the current note is saved so you can restore it.';
export const RESTORE_VERSION_TITLE = 'Restore this version?';
export const RESTORE_VERSION_BODY = 'The current content is saved as a version first.';

export type NoteDialog = { kind: 'convert' } | { kind: 'versions' } | { kind: 'restoreVersion'; version: VersionSummaryType } | { kind: 'compare'; draftId: string };

/**
 * The note dialogs shared by tabs and sticky windows: plain-text conversion, version history, version restore and
 * the recovered-draft comparison. Failed actions go to `report`.
 */
export function NoteDialogs({
  controller,
  dialog,
  onDialog,
  readOnly,
  now,
  report,
}: {
  controller: NoteController;
  dialog: NoteDialog | null;
  onDialog: (next: NoteDialog | null) => void;
  readOnly: boolean;
  now: number;
  report: (result: Promise<ActionResult>) => void;
}) {
  const loadVersions = useCallback(() => controller.listVersions(), [controller]);
  const close = () => onDialog(null);
  const { drafts } = useStore(controller.store);
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
        <VersionsDialog load={loadVersions} now={now} canRestore={!readOnly} onClose={close} onRestore={(version) => onDialog({ kind: 'restoreVersion', version })} />
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
      {compareDraft ? (
        <CompareDialog
          current={controller.currentText()}
          draft={compareDraft}
          canRestore={!readOnly}
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
