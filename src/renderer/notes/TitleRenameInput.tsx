import { useEffect, useRef, useState } from 'react';
import type { EditorHandle } from '../editor/editor-handle';
import type { NoteController } from './note-controller';

export type RenameEnd = 'enter' | 'escape' | 'blur';

/**
 * Inline renaming of a note in its tab or its sticky header (D-102). It opens focused with the title selected; typing
 * renames as it goes (saved on blur and Enter, and with the note when its tab or window closes), so renames from
 * elsewhere never replace what is being typed. Enter moves into the text at once (A08-F1); Escape puts the title back.
 */
export function TitleRenameInput({
  controller,
  initial,
  className,
  editor,
  onDone,
}: {
  controller: NoteController;
  initial: string;
  className: string;
  editor: EditorHandle;
  onDone: (end: RenameEnd) => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const end = (how: RenameEnd) => {
    void controller.flush();
    onDone(how);
  };
  return (
    <input
      ref={ref}
      aria-label="Title"
      className={className}
      placeholder="Untitled"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        controller.rename(e.target.value);
      }}
      onBlur={() => end('blur')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          editor.focus('start', e.currentTarget);
          end('enter');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (value !== initial) controller.rename(initial);
          end('escape');
        }
      }}
    />
  );
}
