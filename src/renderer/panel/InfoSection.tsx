import { displayTitle } from '../../shared/names';
import { useLiveNote } from '../notes/live-note';
import type { NoteController } from '../notes/note-controller';
import { useServices, useStore } from '../state/use-store';
import { Switch } from '../ui/Switch';
import { PanelSection } from './PanelSection';
import { TagsEditor } from './TagsEditor';

const fmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export function InfoSection({ controller }: { controller: NoteController | null }) {
  return <PanelSection title="Info">{controller ? <NoteInfo controller={controller} /> : <p className="muted">Open a note to see its details</p>}</PanelSection>;
}

function NoteInfo({ controller }: { controller: NoteController }) {
  const services = useServices();
  const { tree, notices } = services;
  const state = useStore(controller.store);
  const { snapshot } = useStore(tree.store);
  const live = snapshot.notes.find((n) => n.id === controller.noteId);
  const note = state.note;
  const where = useLiveNote(controller);
  if (!note) return <p className="muted">Loading…</p>;
  const fail = (res: { ok: boolean; message?: string }) => {
    if (!res.ok && res.message) notices.push(res.message, 'error');
  };
  return (
    <>
      <dl className="info-list">
        <dt>Title</dt>
        <dd>{displayTitle(where?.title ?? state.title)}</dd>
        <dt>Location</dt>
        <dd>{(where?.path ?? note.path).join(' › ')}</dd>
        <dt>Type</dt>
        <dd>{note.sticky ? 'Sticky' : 'Note'}</dd>
        <dt>Created</dt>
        <dd>{fmt.format(note.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{fmt.format(live?.updatedAt ?? note.updatedAt)}</dd>
        <dt>Revision</dt>
        <dd>{state.revision}</dd>
      </dl>
      <Switch label="Pinned to Home" checked={!!(live ? live.pinnedAt : note.pinnedAt)} onChange={(v) => void tree.setPinned(note.id, v).then(fail)} />
      <Switch label="Favorite" checked={live ? live.favorite : note.favorite} onChange={(v) => void tree.setFavorite('note', note.id, v).then(fail)} />
      <TagsEditor noteId={note.id} />
    </>
  );
}
