import { useEffect, useState } from 'react';
import { describeTarget } from '../../shared/documents/targets';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { REF_MESSAGES, type BacklinkType, type DocumentBacklinkType, type OutgoingDocRefType, type OutgoingRefType, type RefsListResponseType } from '../../shared/contracts/references';
import { DocumentKindIcon } from '../ui/DocumentKindIcon';
import { REMINDER_MESSAGES } from '../../shared/contracts/reminders';
import { displayTitle } from '../../shared/names';
import type { NoteController } from '../notes/note-controller';
import { useServices } from '../state/use-store';
import { PanelSection } from './PanelSection';

/** How long after a save or tree change the lists are read again (bursts of revisions collapse into one read). */
const REFS_RELOAD_MS = 150;

/** Reads `read` from main, and again after any note revision or tree change (links follow saves, renames and moves). */
function useLinks<T>(bridge: InfinityBridge, key: string, read: () => Promise<{ ok: true; data: T } | { ok: false }>): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let stale = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      void read().then((res) => {
        if (!stale && res.ok) setValue(res.data);
      });
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(load, REFS_RELOAD_MS);
    };
    load();
    const offs = [bridge.subscribe('note:revision', schedule), bridge.subscribe('tree:changed', schedule)];
    return () => {
      stale = true;
      if (timer !== null) clearTimeout(timer);
      for (const off of offs) off();
    };
    // The key names what is read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, key]);
  return value;
}

/** Outgoing references and Backlinks of the active note (INF-REF-03, INF-REF-06); never redirects a broken link. */
export function ReferencesSections({ controller }: { controller: NoteController | null }) {
  if (!controller) {
    return (
      <PanelSection title="References" className="refs-section">
        <p className="muted">Open a note to see its links</p>
      </PanelSection>
    );
  }
  return <NoteReferences noteId={controller.noteId} />;
}

function NoteReferences({ noteId }: { noteId: string }) {
  const { bridge } = useServices();
  const refs = useLinks<RefsListResponseType>(bridge, noteId, () => bridge.refs.list({ noteId }));
  return (
    <>
      <PanelSection title="Outgoing references" className="refs-section">
        {refs && refs.outgoing.length === 0 && refs.documents.length === 0 ? <p className="muted">This note links to no other note or document</p> : null}
        <ul className="ref-list" aria-label="Outgoing references">
          {refs?.outgoing.map((ref) => <OutgoingRow key={`${ref.targetNoteId}:${ref.targetBlockId ?? ''}`} reference={ref} />)}
          {refs?.documents.map((ref) => <OutgoingDocumentRow key={`${ref.targetDocumentId}:${JSON.stringify(ref.target)}`} reference={ref} />)}
        </ul>
      </PanelSection>
      <PanelSection title="Backlinks" className="refs-section">
        {refs && refs.backlinks.length === 0 ? <p className="muted">No other note links here</p> : null}
        <ul className="ref-list" aria-label="Backlinks">
          {refs?.backlinks.map((link, i) => <BacklinkRow key={`${link.sourceNoteId}:${link.sourceBlockId ?? i}`} link={link} />)}
        </ul>
      </PanelSection>
    </>
  );
}

/** Why a link's target cannot open, with Restore (from Trash) and Search for what was meant (INF-REF-06). */
function UnavailableState({ message, title, batch }: { message: string; title: string; batch: string | null }) {
  const { tree, ui, notices } = useServices();
  return (
    <div className="ref-state">
      <span>{message}</span>
      {batch ? (
        <button
          type="button"
          className="btn btn-small"
          onClick={() =>
            void tree.restore(batch).then((res) => {
              if (!res.ok) notices.push(res.message, 'error');
            })
          }
        >
          Restore
        </button>
      ) : null}
      <button type="button" className="btn btn-small" onClick={() => ui.openPalette(title)}>
        Search
      </button>
    </div>
  );
}

function OutgoingRow({ reference: ref }: { reference: OutgoingRefType }) {
  const { tabs } = useServices();
  const title = displayTitle(ref.title);
  const live = ref.state === 'ok' || ref.state === 'blockMissing';
  return (
    <li className={`ref-row ref-${ref.state}`}>
      {live ? (
        <button type="button" className="ref-open" onClick={() => void tabs.openNote(ref.targetNoteId, { blockId: ref.targetBlockId })}>
          <span className="ref-title">{title}</span>
          {ref.blockText ? <span className="ref-context">{ref.blockText}</span> : null}
          {ref.path.length > 0 ? <span className="muted ref-path">{ref.path.join(' › ')}</span> : null}
        </button>
      ) : (
        <span className="ref-title">{title}</span>
      )}
      {ref.state === 'blockMissing' ? <span className="ref-state">{REMINDER_MESSAGES.blockGone}</span> : null}
      {ref.state === 'trashed' || ref.state === 'missing' ? (
        <UnavailableState message={ref.state === 'trashed' ? REF_MESSAGES.trashed : REF_MESSAGES.missing} title={ref.title} batch={ref.trashBatchId} />
      ) : null}
    </li>
  );
}

/** A link to a document (D-156): opens it at its place; a document in Trash or gone shows why. */
function OutgoingDocumentRow({ reference: ref }: { reference: OutgoingDocRefType }) {
  const { tabs } = useServices();
  const title = displayTitle(ref.title);
  return (
    <li className={`ref-row ref-${ref.state}`}>
      {ref.state === 'ok' ? (
        <button type="button" className="ref-open" onClick={() => void tabs.openDocument(ref.targetDocumentId, ref.target ? { target: ref.target } : {})}>
          <span className="ref-title">
            {ref.kind ? <DocumentKindIcon kind={ref.kind} size={12} /> : null}
            {title}
          </span>
          {ref.target ? <span className="ref-context">{describeTarget(ref.target)}</span> : null}
          {ref.path.length > 0 ? <span className="muted ref-path">{ref.path.join(' › ')}</span> : null}
        </button>
      ) : (
        <>
          <span className="ref-title">{title}</span>
          <UnavailableState message={ref.state === 'trashed' ? REF_MESSAGES.documentTrashed : REF_MESSAGES.documentMissing} title={ref.title} batch={ref.trashBatchId} />
        </>
      )}
    </li>
  );
}

function BacklinkRow({ link }: { link: BacklinkType | DocumentBacklinkType }) {
  const { tabs } = useServices();
  return (
    <li className="ref-row">
      <button type="button" className="ref-open" onClick={() => void tabs.openNote(link.sourceNoteId, { blockId: link.sourceBlockId })}>
        <span className="ref-title">{displayTitle(link.title)}</span>
        {link.context ? <span className="ref-context">{link.context}</span> : null}
        {'target' in link && link.target ? <span className="ref-context">› {describeTarget(link.target)}</span> : null}
        <span className="muted ref-path">{link.path.join(' › ')}</span>
      </button>
    </li>
  );
}

/** Notes linking to the open document (D-156), re-read after saves and tree changes. */
export function DocumentBacklinks({ documentId }: { documentId: string }) {
  const { bridge } = useServices();
  const links = useLinks(bridge, `document:${documentId}`, () => bridge.refs.documentBacklinks({ documentId }));
  return (
    <PanelSection title="Backlinks" className="refs-section">
      {links && links.backlinks.length === 0 ? <p className="muted">No note links here</p> : null}
      <ul className="ref-list" aria-label="Backlinks">
        {links?.backlinks.map((link, i) => <BacklinkRow key={`${link.sourceNoteId}:${link.sourceBlockId ?? i}`} link={link} />)}
      </ul>
    </PanelSection>
  );
}
