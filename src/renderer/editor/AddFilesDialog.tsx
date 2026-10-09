import { FileText, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { canCopy } from '../../shared/attachments/file-choice';
import { ATTACHMENT_MESSAGES, onlyLinkWarning } from '../../shared/attachments/limits';
import { formatBytes } from '../../shared/attachments/names';
import { Dialog } from '../ui/Dialog';
import type { FileChoice, FileChoiceRequest } from './uploader';

export const ADD_FILES_HELP =
  'A copy is stored in Infinity Notes and travels with your backups and exports. A link points at the file where it is: backups and exports keep only the link, not the file, and the link stops working if the file is moved, renamed or deleted.';

/** One line per file, with why it can only be linked or only be copied. */
function FileRow({ file, copyLimitMb }: { file: FileChoiceRequest['files'][number]; copyLimitMb: number }) {
  const note = !canCopy(file, copyLimitMb) ? onlyLinkWarning(copyLimitMb) : file.linkable ? null : ATTACHMENT_MESSAGES.onlyCopy;
  return (
    <li className="add-files-item">
      <FileText size={16} strokeWidth={1.75} aria-hidden />
      <span className="add-files-name">{file.name}</span>
      <span className="muted">{formatBytes(file.sizeBytes)}</span>
      {note ? (
        <span className="add-files-note">
          <TriangleAlert size={14} strokeWidth={1.75} aria-hidden />
          {note}
        </span>
      ) : null}
    </li>
  );
}

/**
 * "Add files" (D-108): asked once per drop, paste or pick while "When adding files" is Ask. Copy keeps files over the
 * copy limit as links; a choice remembered here becomes the setting (main window only: stickies cannot write settings).
 */
export function AddFilesDialog({
  request,
  canRemember,
  onChoose,
  onCancel,
}: {
  request: FileChoiceRequest;
  canRemember: boolean;
  onChoose: (choice: FileChoice) => void;
  onCancel: () => void;
}) {
  const [remember, setRemember] = useState(false);
  const { files, copyLimitMb } = request;
  const copyable = files.some((f) => canCopy(f, copyLimitMb));
  return (
    <Dialog title={files.length === 1 ? 'Add file' : `Add ${files.length} files`} onClose={onCancel} returnFocus={false} className="add-files">
      <ul className="add-files-list" aria-label="Files">
        {files.map((file, i) => (
          <FileRow key={i} file={file} copyLimitMb={copyLimitMb} />
        ))}
      </ul>
      <p className="muted add-files-help">{ADD_FILES_HELP}</p>
      {canRemember ? (
        <label className="checkbox">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember my choice
        </label>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" disabled={!copyable} data-autofocus={copyable ? '' : undefined} onClick={() => onChoose({ action: 'copy', remember })}>
          Copy into Infinity Notes
        </button>
        <button type="button" className="btn" data-autofocus={copyable ? undefined : ''} onClick={() => onChoose({ action: 'link', remember })}>
          Link to the original
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
