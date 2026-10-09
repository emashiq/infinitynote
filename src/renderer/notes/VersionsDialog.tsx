import { useEffect, useState } from 'react';
import type { VersionReasonType, VersionSummaryType } from '../../shared/contracts/notes';
import { formatRelative } from '../../shared/time/relative-time';
import { Dialog } from '../ui/Dialog';

export const VERSION_REASON_LABEL: Record<VersionReasonType, string> = {
  auto: 'Automatic',
  conversion: 'Before conversion',
  conflict: 'Before restoring a draft',
  restore: 'Before restoring a version',
  import: 'Before import',
};

/** What the history of a locked note says: it keeps none while locked (D-112). */
export const LOCKED_NO_VERSIONS = 'Locked notes keep no version history. Earlier versions were deleted when the note was locked.';

/** Minimal "Version history" (D-056): the saved versions, newest first, each with Restore. */
export function VersionsDialog({
  load,
  now,
  canRestore,
  locked,
  onRestore,
  onClose,
}: {
  load: () => Promise<{ ok: true; data: { versions: VersionSummaryType[] } } | { ok: false; error: { message: string } }>;
  now: number;
  canRestore: boolean;
  /** The note is locked. */
  locked: boolean;
  onRestore: (version: VersionSummaryType) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionSummaryType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((res) => {
      if (!live) return;
      if (res.ok) setVersions(res.data.versions);
      else setError(res.error.message);
    });
    return () => {
      live = false;
    };
  }, [load]);

  return (
    <Dialog title="Version history" onClose={onClose} className="versions-dialog">
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : versions === null ? (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      ) : versions.length === 0 ? (
        <p className="muted">{locked ? LOCKED_NO_VERSIONS : 'No versions yet'}</p>
      ) : (
        <ul className="version-list" aria-label="Versions">
          {versions.map((v) => (
            <li key={v.id} className="version-row">
              <div className="version-meta">
                <span>{formatRelative(v.createdAt, now)}</span>
                <span className="muted">{VERSION_REASON_LABEL[v.reason]}</span>
                <span className="muted">{v.format === 'rich' ? 'Rich text' : 'Plain text'}</span>
              </div>
              {v.preview ? <p className="version-preview">{v.preview}</p> : null}
              <button type="button" className="btn btn-small" disabled={!canRestore} onClick={() => onRestore(v)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" data-autofocus="" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
