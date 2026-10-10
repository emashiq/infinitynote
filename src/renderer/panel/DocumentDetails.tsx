import { formatBytes } from '../../shared/attachments/names';
import { DOCUMENT_KIND_INFO } from '../../shared/documents/kinds';
import { buildPathIndex, pathOf } from '../../shared/tree/paths';
import { useServices, useStore } from '../state/use-store';
import { PanelSection } from './PanelSection';
import { DocumentBacklinks } from './ReferencesSection';

const fmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

/** The Details panel of a document tab (D-156): what the document is and which notes link to it. */
export function DocumentDetails({ documentId }: { documentId: string }) {
  const { tree } = useServices();
  const { snapshot } = useStore(tree.store);
  const document = snapshot.documents.find((d) => d.id === documentId);
  return (
    <>
      <PanelSection title="Info">
        {document ? (
          <dl className="info-list">
            <dt>Title</dt>
            <dd>{document.title}</dd>
            <dt>Location</dt>
            <dd>{pathOf(buildPathIndex(snapshot.projects, snapshot.folders), { projectId: document.projectId, folderId: document.folderId }).join(' › ')}</dd>
            <dt>Type</dt>
            <dd>{DOCUMENT_KIND_INFO[document.kind].label}</dd>
            <dt>Stored</dt>
            <dd>{document.storage === 'linked' ? 'Linked to the original file' : 'In Infinity Notes'}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(document.sizeBytes)}</dd>
            <dt>Updated</dt>
            <dd>{fmt.format(document.updatedAt)}</dd>
          </dl>
        ) : (
          <p className="muted">This document is not in the tree</p>
        )}
      </PanelSection>
      <DocumentBacklinks documentId={documentId} />
    </>
  );
}
