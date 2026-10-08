import { HomeView } from '../home/HomeView';
import { NoteView } from '../notes/NoteView';
import { RemindersPage } from '../pages/RemindersPage';
import { SettingsPage } from '../pages/SettingsPage';
import { StickiesPage } from '../pages/StickiesPage';
import { useServices, useStore } from '../state/use-store';

export function TabPanel() {
  const { tabs } = useServices();
  const { session, controllerNoteId } = useStore(tabs.store);
  const active = session.tabs.find((t) => t.id === session.activeTabId) ?? session.tabs[0]!;
  const controller = active.kind === 'note' ? tabs.activeController() : null;

  let body;
  switch (active.kind) {
    case 'home':
      body = <HomeView />;
      break;
    case 'stickies':
      body = <StickiesPage />;
      break;
    case 'reminders':
      body = <RemindersPage />;
      break;
    case 'settings':
      body = <SettingsPage />;
      break;
    default:
      body = controller && controller.noteId === active.noteId && controllerNoteId === active.noteId ? <NoteView key={active.noteId} controller={controller} tabId={active.id} /> : <div aria-busy="true" className="note-loading" />;
  }
  return (
    <div role="tabpanel" id="tabpanel" aria-labelledby={`tab-${active.id}`} className="tab-panel">
      {body}
    </div>
  );
}
