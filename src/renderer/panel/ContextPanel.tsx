import { useServices, useStore } from '../state/use-store';
import { InfoSection } from './InfoSection';
import { RemindersSection } from './RemindersSection';

export function ContextPanel() {
  const { tabs } = useServices();
  const { session, controllerNoteId } = useStore(tabs.store);
  const active = session.tabs.find((t) => t.id === session.activeTabId);
  const controller = active?.kind === 'note' && controllerNoteId === active.noteId ? tabs.activeController() : null;
  return (
    <aside className="context-panel" id="context-panel" aria-label="Details">
      <InfoSection key={controller?.noteId ?? 'none'} controller={controller} />
      <RemindersSection key={`reminders:${controller?.noteId ?? 'none'}`} controller={controller} />
    </aside>
  );
}
