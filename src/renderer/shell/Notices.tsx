import { X } from 'lucide-react';
import type { NoticeStore } from '../state/notice-store';
import { useServices, useStore } from '../state/use-store';
import { IconButton } from '../ui/IconButton';

/** The toasts of one window's notice store (main window and sticky windows). */
export function NoticeList({ notices }: { notices: NoticeStore }) {
  const { notices: list } = useStore(notices.store);
  return (
    <div role="status" aria-live="polite" className="toasts">
      {list.map((n) => (
        <div key={n.id} className={`toast toast-${n.tone}`}>
          <span>{n.text}</span>
          {n.action ? (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                notices.dismiss(n.id);
                n.action!.run();
              }}
            >
              {n.action.label}
            </button>
          ) : null}
          <IconButton label="Dismiss" icon={X} size={14} onClick={() => notices.dismiss(n.id)} />
        </div>
      ))}
    </div>
  );
}

export function Notices() {
  return <NoticeList notices={useServices().notices} />;
}
