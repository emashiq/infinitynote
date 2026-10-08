import { useMemo, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { useServices } from '../state/use-store';

export function MoveDialog({ nodeKey, onClose }: { nodeKey: string; onClose: () => void }) {
  const { tree, ui } = useServices();
  const node = tree.store.getState().model.nodes.get(nodeKey);
  const destinations = useMemo(() => tree.moveDestinations(nodeKey), [tree, nodeKey]);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const visible = destinations.filter((d) => d.path.join(' › ').toLowerCase().includes(filter.trim().toLowerCase()));
  const current = Math.min(active, Math.max(0, visible.length - 1));

  const move = async (index: number) => {
    const dest = visible[index];
    if (!dest) return;
    const res = await tree.moveItem(nodeKey, dest);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    tree.reveal(nodeKey);
    ui.requestFocus({ target: 'tree' });
  };

  return (
    <Dialog title={`Move “${node?.label ?? ''}” to`} onClose={onClose} className="move-dialog">
      <input
        className="text-input"
        aria-label="Filter locations"
        role="combobox"
        aria-expanded="true"
        aria-controls="move-locations"
        aria-activedescendant={visible[current] ? `move-opt-${current}` : undefined}
        data-autofocus=""
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(Math.min(current + 1, visible.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(current - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void move(current);
          }
        }}
      />
      <ul id="move-locations" role="listbox" aria-label="Locations" className="listbox">
        {visible.map((d, i) => (
          <li
            key={d.key}
            id={`move-opt-${i}`}
            role="option"
            aria-selected={i === current}
            className={`option ${i === current ? 'is-active' : ''}`}
            onClick={() => setActive(i)}
            onDoubleClick={() => void move(i)}
          >
            {d.path.join(' › ')}
            {d.current ? <span className="muted"> (current)</span> : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" disabled={visible.length === 0} onClick={() => void move(current)}>
          Move
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
