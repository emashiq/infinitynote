import type { DocumentSummaryType, NoteSummaryType } from '../../shared/contracts/hierarchy';
import { displayTitle } from '../../shared/names';
import { formatRelative } from '../../shared/time/relative-time';
import { useServices, useStore } from '../state/use-store';
import { ColorDot } from '../ui/ColorDot';
import { DocumentKindIcon } from '../ui/DocumentKindIcon';
import { LockMark } from '../ui/LockMark';

const RECENT_SHOWN = 10;

type RecentItem = { kind: 'note'; item: NoteSummaryType } | { kind: 'document'; item: DocumentSummaryType };

/** Recent notes and documents (D-118) together, most recently changed first. */
export function recentItems(notes: readonly NoteSummaryType[], documents: readonly DocumentSummaryType[]): RecentItem[] {
  return [...notes.map((item): RecentItem => ({ kind: 'note', item })), ...documents.map((item): RecentItem => ({ kind: 'document', item }))]
    .sort((a, b) => b.item.updatedAt - a.item.updatedAt)
    .slice(0, RECENT_SHOWN);
}

export function RecentSection() {
  const { home, tabs, now } = useServices();
  const { summary } = useStore(home.store);
  const recent = recentItems(summary?.recent ?? [], summary?.recentDocuments ?? []);
  return (
    <section aria-labelledby="home-recent">
      <h3 id="home-recent" className="section-label">
        Recent
      </h3>
      {recent.length === 0 ? (
        <p className="muted">No notes yet. Create one with New note.</p>
      ) : (
        <ul className="recent-list">
          {recent.map(({ kind, item }) => (
            <li key={item.id}>
              <button type="button" className="recent-row" onClick={() => void (kind === 'note' ? tabs.openNote(item.id) : tabs.openDocument(item.id))}>
                <span className="recent-title">
                  {kind === 'document' ? <DocumentKindIcon kind={item.kind} size={14} /> : null}
                  {kind === 'note' && item.sticky && item.color ? <ColorDot color={item.color} /> : null}
                  {displayTitle(item.title)}
                  {kind === 'note' && item.locked ? <LockMark /> : null}
                </span>
                <span className="muted recent-path">{item.path.join(' › ')}</span>
                <span className="muted recent-time">{formatRelative(item.updatedAt, now())}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
