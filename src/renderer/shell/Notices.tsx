import { X } from 'lucide-react';
import { useServices, useStore } from '../state/use-store';
import { IconButton } from '../ui/IconButton';

export function Notices() {
  const { notices } = useServices();
  const { notices: list } = useStore(notices.store);
  return (
    <div role="status" aria-live="polite" className="toasts">
      {list.map((n) => (
        <div key={n.id} className={`toast toast-${n.tone}`}>
          <span>{n.text}</span>
          <IconButton label="Dismiss" icon={X} size={14} onClick={() => notices.dismiss(n.id)} />
        </div>
      ))}
    </div>
  );
}
