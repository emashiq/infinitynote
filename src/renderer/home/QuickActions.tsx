import { FilePlus, FolderPlus, StickyNote } from 'lucide-react';
import { useServices } from '../state/use-store';

export function QuickActions() {
  const { commands } = useServices();
  const tiles = [
    { id: 'note.new', label: 'New note', icon: FilePlus },
    { id: 'sticky.new', label: 'New sticky', icon: StickyNote },
    { id: 'project.new', label: 'New project', icon: FolderPlus },
  ] as const;
  return (
    <section aria-labelledby="home-quick">
      <h3 id="home-quick" className="section-label">
        Quick actions
      </h3>
      <div className="tiles">
        {tiles.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className="tile" onClick={() => void commands.run(id)}>
            <Icon size={20} strokeWidth={1.75} aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
