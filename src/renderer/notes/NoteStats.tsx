import { formatStats, textStats } from '../../shared/text/text-stats';
import type { EditorHandle } from '../editor/editor-handle';
import { useEditorDoc } from '../editor/use-editor-doc';

/** Word and character counts and reading time of the open note, under its text (D-162). */
export function NoteStats({ handle }: { handle: EditorHandle }) {
  const { value: stats } = useEditorDoc(handle, (e) => textStats(e.getText({ blockSeparator: '\n' })));
  if (!stats) return null;
  return (
    <p className="note-stats muted" aria-label="Note statistics">
      {formatStats(stats)}
    </p>
  );
}
