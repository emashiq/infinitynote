import { displayTitle } from '../../shared/names';
import { buildPathIndex, pathOf } from '../../shared/tree/paths';
import { useServices, useStore } from '../state/use-store';

export function StickiesPage() {
  const { tree, tabs, commands } = useServices();
  const { snapshot } = useStore(tree.store);
  const index = buildPathIndex(
    snapshot.projects.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
    snapshot.folders.map((f) => ({ id: f.id, projectId: f.projectId, parentId: f.parentId, name: f.name, createdAt: f.createdAt })),
  );
  const stickies = snapshot.notes.filter((n) => n.sticky).sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="page">
      <div className="page-header">
        <h2 className="view-title">Stickies</h2>
        <button type="button" className="btn btn-primary" onClick={() => void commands.run('sticky.new')}>
          New sticky
        </button>
      </div>
      {stickies.length === 0 ? (
        <p className="muted">No stickies yet.</p>
      ) : (
        <ul className="sticky-list">
          {stickies.map((n) => (
            <li key={n.id} className="sticky-row">
              {n.color ? <span className={`dot dot-${n.color}`} aria-hidden /> : null}
              <span className="sticky-title">{displayTitle(n.title)}</span>
              <span className="muted sticky-path">{pathOf(index, { projectId: n.projectId, folderId: n.folderId }).join(' › ')}</span>
              <button type="button" className="btn" aria-label={`Open ${displayTitle(n.title)}`} onClick={() => void tabs.openNote(n.id)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
