import type { DraftSummaryType } from '../../shared/contracts/notes';
import { formatRelative } from '../../shared/time/relative-time';
import type { NoteControllerState } from './note-controller';

export const CONFLICT_BANNER = 'This note changed elsewhere. Your edits were kept as a recovered draft';
export const CONVERTED_BANNER = 'Converted to plain text. A version with formatting and images was saved.';

export function recoveredDraftsText(drafts: readonly DraftSummaryType[], now: number): string {
  const when = formatRelative(drafts[0]!.createdAt, now);
  return drafts.length === 1 ? `This note has a recovered draft from ${when}.` : `This note has ${drafts.length} recovered drafts. The newest is from ${when}.`;
}

export interface BannerActions {
  compare(draftId: string): void;
  restoreDraft(draftId: string): void;
  dismissDraft(draftId: string): void;
  restoreFormatted(versionId: string): void;
  dismissConverted(): void;
}

function DraftActions({ draftId, busy, actions }: { draftId: string; busy: boolean; actions: BannerActions }) {
  return (
    <>
      <button type="button" className="btn btn-small" onClick={() => actions.compare(draftId)}>
        Compare
      </button>
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => actions.restoreDraft(draftId)}>
        Restore draft
      </button>
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => actions.dismissDraft(draftId)}>
        Dismiss
      </button>
    </>
  );
}

/**
 * Note banners (plan section 10.4): a conflict, a conversion or the recovered drafts of the note. Every view of a note
 * edits at once (D-103), so there is no read-only state to explain.
 */
export function NoteBanners({ state, now, actions }: { state: NoteControllerState; now: number; actions: BannerActions }) {
  const busy = state.busy !== null;
  const banners = [];

  if (state.conflict) {
    banners.push(
      <div key="conflict" className="banner" role="status">
        <span>{CONFLICT_BANNER}</span>
        <span className="banner-actions">
          <DraftActions draftId={state.conflict.draftId} busy={busy} actions={actions} />
        </span>
      </div>,
    );
  } else if (state.converted) {
    const { versionId } = state.converted;
    banners.push(
      <div key="converted" className="banner" role="status">
        <span>{CONVERTED_BANNER}</span>
        <span className="banner-actions">
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => actions.restoreFormatted(versionId)}>
            Restore formatted version
          </button>
          <button type="button" className="btn btn-small" onClick={actions.dismissConverted}>
            Dismiss
          </button>
        </span>
      </div>,
    );
  } else if (state.drafts.length > 0) {
    banners.push(
      <div key="drafts" className="banner" role="status">
        <span>{recoveredDraftsText(state.drafts, now)}</span>
        <span className="banner-actions">
          <DraftActions draftId={state.drafts[0]!.id} busy={busy} actions={actions} />
        </span>
      </div>,
    );
  }
  return banners.length > 0 ? <div className="note-banners">{banners}</div> : null;
}
