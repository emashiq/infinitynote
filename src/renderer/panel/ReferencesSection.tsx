import { useEffect, useState } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import { REF_MESSAGES, type BacklinkType, type OutgoingRefType, type RefsListResponseType } from '../../shared/contracts/references';
import { REMINDER_MESSAGES } from '../../shared/contracts/reminders';
import { displayTitle } from '../../shared/names';
import type { NoteController } from '../notes/note-controller';
import { useServices } from '../state/use-store';
import { PanelSection } from './PanelSection';

/** How long after a save or tree change the lists are read again (bursts of revisions collapse into one read). */
const REFS_RELOAD_MS = 150;

/** The note's outgoing references and backlinks from main, re-read after any note revision or tree change. */
function useNoteRefs(bridge: InfinityBridge, noteId: string): RefsListResponseType | null {
  const [refs, setRefs] = useState<RefsListResponseType | null>(null);
  useEffect(() => {
    let stale = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      void bridge.refs.list({ noteId }).then((res) => {
        if (!stale && res.ok) setRefs(res.data);
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
  }, [bridge, noteId]);
  return refs;
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
  const refs = useNoteRefs(bridge, noteId);
  return (
    <>
      <PanelSection title="Outgoing references" className="refs-section">
        {refs && refs.outgoing.length === 0 ? <p className="muted">This note links to no other note</p> : null}
        <ul className="ref-list" aria-label="Outgoing references">
          {refs?.outgoing.map((ref) => <OutgoingRow key={`${ref.targetNoteId}:${ref.targetBlockId ?? ''}`} reference={ref} />)}
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

function OutgoingRow({ reference: ref }: { reference: OutgoingRefType }) {
  const { tabs, tree, ui, notices } = useServices();
  const title = displayTitle(ref.title);
  const live = ref.state === 'ok' || ref.state === 'blockMissing';
  const batch = ref.trashBatchId;
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
        <div className="ref-state">
          <span>{ref.state === 'trashed' ? REF_MESSAGES.trashed : REF_MESSAGES.missing}</span>
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
          <button type="button" className="btn btn-small" onClick={() => ui.openPalette(ref.title)}>
            Search
          </button>
        </div>
      ) : null}
    </li>
  );
}

function BacklinkRow({ link }: { link: BacklinkType }) {
  const { tabs } = useServices();
  return (
    <li className="ref-row">
      <button type="button" className="ref-open" onClick={() => void tabs.openNote(link.sourceNoteId, { blockId: link.sourceBlockId })}>
        <span className="ref-title">{displayTitle(link.title)}</span>
        {link.context ? <span className="ref-context">{link.context}</span> : null}
        <span className="muted ref-path">{link.path.join(' › ')}</span>
      </button>
    </li>
  );
}
