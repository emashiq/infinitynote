import { useState } from 'react';
import { displayTitle } from '../../shared/names';
import { useServices, useStore } from '../state/use-store';

const LIMIT = 12;

export function PinnedSection() {
  const { home, tabs } = useServices();
  const { summary } = useStore(home.store);
  const [showAll, setShowAll] = useState(false);
  const pinned = summary?.pinned ?? [];
  const total = summary?.pinnedTotal ?? 0;
  const shown = showAll ? pinned : pinned.slice(0, LIMIT);
  return (
    <section aria-labelledby="home-pinned">
      <h3 id="home-pinned" className="section-label">
        Pinned
      </h3>
      {pinned.length === 0 ? (
        <p className="muted">Pin a note to keep it here.</p>
      ) : (
        <>
          <ul className="cards">
            {shown.map((note) => (
              <li key={note.id}>
                <button type="button" className="card" onClick={() => void tabs.openNote(note.id)}>
                  <span className="card-title">
                    {note.sticky && note.color ? <span className={`dot dot-${note.color}`} aria-hidden /> : null}
                    {displayTitle(note.title)}
                  </span>
                  <span className="card-path muted">{note.path.join(' › ')}</span>
                </button>
              </li>
            ))}
          </ul>
          {total > LIMIT ? (
            <button type="button" className="link-btn" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `View all (${total})`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
