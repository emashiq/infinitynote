import type { DraftSummaryType } from '../../shared/contracts/notes';
import { Dialog } from '../ui/Dialog';
import { TAKE_CONTROL_FIRST_TIP } from './NoteBanners';

/** "Compare recovered draft": the current note text next to the draft text (UX_SPEC section 6). */
export function CompareDialog({
  current,
  draft,
  canRestore,
  onRestore,
  onClose,
}: {
  current: string;
  draft: DraftSummaryType;
  canRestore: boolean;
  onRestore: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title="Compare recovered draft" onClose={onClose} className="compare-dialog">
      <div className="compare-columns">
        <section aria-label="Current note">
          <h3 className="compare-heading">Current note</h3>
          <pre className="compare-text">{current}</pre>
        </section>
        <section aria-label="Recovered draft">
          <h3 className="compare-heading">Recovered draft</h3>
          <pre className="compare-text">{draft.plainText}</pre>
          {draft.truncated ? <p className="muted">Draft truncated for display</p> : null}
        </section>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" disabled={!canRestore} title={canRestore ? undefined : TAKE_CONTROL_FIRST_TIP} onClick={onRestore}>
          Restore draft
        </button>
        <button type="button" className="btn" data-autofocus="" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
