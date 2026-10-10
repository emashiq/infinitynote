import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes } from '../../../shared/attachments/names';
import type { DocumentVersionDtoType } from '../../../shared/contracts/documents';
import { formatRelative } from '../../../shared/time/relative-time';
import { IconButton } from '../../ui/IconButton';

/** What each version is: the bytes a save or a restore replaced. */
export const DOCUMENT_VERSION_REASON: Record<DocumentVersionDtoType['reason'], string> = {
  save: 'Replaced by a save',
  restore: 'Replaced by a restore',
};

/** "10 Oct 2026, 14:30" in this computer's time. */
export function formatVersionTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export interface DocumentVersionsPanelProps {
  load(): Promise<{ ok: true; versions: DocumentVersionDtoType[] } | { ok: false; message: string }>;
  /** Changes when the list should be read again (after a save or restore). */
  revision: number;
  now: number;
  /** The version shown read-only in the viewer, if any. */
  viewingId: string | null;
  busy: boolean;
  onOpen(version: DocumentVersionDtoType): void;
  onRestore(version: DocumentVersionDtoType): void;
  onCopy(version: DocumentVersionDtoType): void;
  onClose(): void;
}

/**
 * The versions of a document (D-141), newest first, for every viewer: each one can be opened read-only in the tab,
 * restored as the next revision (the current bytes become a version) or saved as a new document next to this one.
 */
export function DocumentVersionsPanel({ load, revision, now, viewingId, busy, onOpen, onRestore, onCopy, onClose }: DocumentVersionsPanelProps) {
  const [state, setState] = useState<{ versions: DocumentVersionDtoType[] | null; error: string | null }>({ versions: null, error: null });
  useEffect(() => {
    let live = true;
    void load().then((res) => live && setState(res.ok ? { versions: res.versions, error: null } : { versions: null, error: res.message }));
    return () => {
      live = false;
    };
  }, [load, revision]);

  return (
    <aside className="document-versions" aria-label="Versions">
      <div className="document-versions-head">
        <h3 className="document-versions-title">Versions</h3>
        <IconButton label="Close versions" icon={X} onClick={onClose} />
      </div>
      {state.error ? (
        <p role="alert" className="field-error">
          {state.error}
        </p>
      ) : state.versions === null ? (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      ) : state.versions.length === 0 ? (
        <p className="muted">No earlier versions yet. Each save keeps the bytes it replaces here.</p>
      ) : (
        <ul className="version-list" aria-label="Versions">
          {state.versions.map((v) => (
            <li key={v.id} className={`version-row${v.id === viewingId ? ' version-row-current' : ''}`} aria-current={v.id === viewingId ? 'true' : undefined}>
              <div className="version-meta">
                <span title={formatVersionTime(v.createdAt)}>
                  Revision {v.revision} · {formatRelative(v.createdAt, now)}
                </span>
                <span className="muted">
                  {DOCUMENT_VERSION_REASON[v.reason]} · {formatBytes(v.sizeBytes)}
                </span>
              </div>
              <div className="button-row">
                <button type="button" className="btn btn-small" disabled={v.id === viewingId} onClick={() => onOpen(v)}>
                  Open
                </button>
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => onRestore(v)}>
                  Restore
                </button>
                <button type="button" className="btn btn-small" disabled={busy} onClick={() => onCopy(v)}>
                  Save as copy
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
