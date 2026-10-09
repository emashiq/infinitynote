import { displayTitle } from '../../shared/names';
import { formatRelative } from '../../shared/time/relative-time';
import { useServices, useStore } from '../state/use-store';
import { ColorDot } from '../ui/ColorDot';
import { LockMark } from '../ui/LockMark';

export function RecentSection() {
  const { home, tabs, now } = useServices();
  const { summary } = useStore(home.store);
  const recent = summary?.recent ?? [];
  return (
    <section aria-labelledby="home-recent">
      <h3 id="home-recent" className="section-label">
        Recent
      </h3>
      {recent.length === 0 ? (
        <p className="muted">No notes yet. Create one with New note.</p>
      ) : (
        <ul className="recent-list">
          {recent.map((note) => (
            <li key={note.id}>
              <button type="button" className="recent-row" onClick={() => void tabs.openNote(note.id)}>
                <span className="recent-title">
                  {note.sticky && note.color ? <ColorDot color={note.color} /> : null}
                  {displayTitle(note.title)}
                  {note.locked ? <LockMark /> : null}
                </span>
                <span className="muted recent-path">{note.path.join(' › ')}</span>
                <span className="muted recent-time">{formatRelative(note.updatedAt, now())}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
