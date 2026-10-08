import type { Editor } from '@tiptap/core';
import { useEffect, useState, type RefObject } from 'react';
import type { NoteController } from './note-controller';

/**
 * The note title field of tabs and sticky windows. It follows renames from elsewhere unless it has focus, so
 * in-progress typing is never replaced; blur and Enter save, and Enter moves into the editor.
 */
export function NoteTitleInput({
  controller,
  liveTitle,
  readOnly,
  className,
  inputRef,
  editorRef,
}: {
  controller: NoteController;
  liveTitle: string;
  readOnly: boolean;
  className: string;
  inputRef: RefObject<HTMLInputElement | null>;
  editorRef: RefObject<Editor | null>;
}) {
  // Text typed into the field; null means the field shows the current title.
  const [typed, setTyped] = useState<string | null>(null);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setTyped(null);
  }, [liveTitle, inputRef]);
  return (
    <input
      ref={inputRef}
      aria-label="Title"
      className={className}
      placeholder="Untitled"
      value={typed ?? liveTitle}
      readOnly={readOnly}
      onChange={(e) => {
        setTyped(e.target.value);
        controller.rename(e.target.value);
      }}
      onBlur={() => void controller.flush()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void controller.flush();
          editorRef.current?.commands.focus('start');
        }
      }}
    />
  );
}
