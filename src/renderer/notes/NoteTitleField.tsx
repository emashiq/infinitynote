import { useEffect, useRef, useState, type RefObject } from 'react';
import type { EditorHandle } from '../editor/editor-handle';
import type { NoteController } from './note-controller';

export type TitleEditEnd = 'enter' | 'escape' | 'blur';

/**
 * The note's title as a field (D-102): over a note tab while it is renamed, and always in a sticky header. It shows
 * the live title until it is edited; typing renames as it goes (saved on blur and Enter, and with the note when its
 * view closes), so renames from elsewhere never replace what is being typed. Enter moves into the text at once
 * (A08-F1); Escape puts back the title it had when the editing started.
 */
export function NoteTitleField({
  controller,
  title,
  className,
  editor,
  readOnly = false,
  autoFocus = false,
  inputRef,
  onDone,
}: {
  controller: NoteController;
  title: string;
  className: string;
  editor: EditorHandle;
  readOnly?: boolean;
  /** Focuses the field with the title selected when it mounts (a tab being renamed). */
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onDone?: (end: TitleEditEnd) => void;
}) {
  // Text typed since the field got the focus; null shows the live title.
  const [typed, setTyped] = useState<string | null>(null);
  const original = useRef(title);
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;
  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus();
    ref.current?.select();
  }, [autoFocus, ref]);
  const finish = (end: TitleEditEnd) => {
    setTyped(null);
    void controller.flush();
    onDone?.(end);
  };
  return (
    <input
      ref={ref}
      aria-label="Title"
      className={className}
      placeholder="Untitled"
      value={typed ?? title}
      readOnly={readOnly}
      onFocus={() => {
        original.current = title;
      }}
      onChange={(e) => {
        setTyped(e.target.value);
        controller.rename(e.target.value);
      }}
      onBlur={() => finish('blur')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          editor.focus('start', e.currentTarget);
          finish('enter');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (typed !== null && typed !== original.current) controller.rename(original.current);
          finish('escape');
        }
      }}
    />
  );
}
