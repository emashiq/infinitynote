import { X } from 'lucide-react';
import { useServices, useStore } from '../state/use-store';
import { IconButton } from '../ui/IconButton';
import { InfoSection } from './InfoSection';
import { ReferencesSections } from './ReferencesSection';
import { RemindersSection } from './RemindersSection';

/** The Details panel: Info, Reminders and the note's links. Docked, it has its own compact close control. */
export function ContextPanel({ onClose }: { onClose?: () => void }) {
  const { tabs } = useServices();
  const { session, controllerNoteId } = useStore(tabs.store);
  const active = session.tabs.find((t) => t.id === session.activeTabId);
  const controller = active?.kind === 'note' && controllerNoteId === active.noteId ? tabs.activeController() : null;
  return (
    <aside className="context-panel" id="context-panel" aria-label="Details">
      {onClose ? <IconButton className="panel-close" label="Close details panel" icon={X} size={14} onClick={onClose} /> : null}
      <InfoSection key={controller?.noteId ?? 'none'} controller={controller} />
      <RemindersSection key={`reminders:${controller?.noteId ?? 'none'}`} controller={controller} />
      <ReferencesSections key={`refs:${controller?.noteId ?? 'none'}`} controller={controller} />
    </aside>
  );
}
