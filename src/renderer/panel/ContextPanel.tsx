import { X } from 'lucide-react';
import { useServices, useStore } from '../state/use-store';
import { IconButton } from '../ui/IconButton';
import { LocalGraphSection } from '../graph/LocalGraphSection';
import { CommentsSection } from './CommentsSection';
import { DocumentDetails } from './DocumentDetails';
import { InfoSection } from './InfoSection';
import { OutlineSection } from './OutlineSection';
import { ReferencesSections } from './ReferencesSection';
import { RemindersSection } from './RemindersSection';

/** The Details panel: Info, Outline, Comments, Reminders and the note's links, or a document's Info, Backlinks and Comments. Docked, it has its own compact close control. */
export function ContextPanel({ onClose }: { onClose?: () => void }) {
  const { tabs } = useServices();
  const { session, controllerNoteId } = useStore(tabs.store);
  const active = session.tabs.find((t) => t.id === session.activeTabId);
  const controller = active?.kind === 'note' && controllerNoteId === active.noteId ? tabs.activeController() : null;
  return (
    <aside className="context-panel" id="context-panel" aria-label="Details">
      {onClose ? <IconButton className="panel-close" label="Close details panel" icon={X} size={14} onClick={onClose} /> : null}
      {active?.kind === 'document' ? (
        <>
          <DocumentDetails key={active.documentId} documentId={active.documentId} />
          <CommentsSection />
          <LocalGraphSection key={`graph:${active.documentId}`} item={{ kind: 'document', id: active.documentId }} />
        </>
      ) : (
        <>
          <InfoSection key={controller?.noteId ?? 'none'} controller={controller} />
          {controller ? <OutlineSection key={`outline:${controller.noteId}`} /> : null}
          {controller ? <CommentsSection /> : null}
          <RemindersSection key={`reminders:${controller?.noteId ?? 'none'}`} controller={controller} />
          <ReferencesSections key={`refs:${controller?.noteId ?? 'none'}`} controller={controller} />
          {controller ? <LocalGraphSection key={`graph:${controller.noteId}`} item={{ kind: 'note', id: controller.noteId }} /> : null}
        </>
      )}
    </aside>
  );
}
