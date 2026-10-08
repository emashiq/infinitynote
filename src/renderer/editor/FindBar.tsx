import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../ui/IconButton';
import { findState } from './find';
import { MAX_FIND_QUERY } from './find-core';

/**
 * "Find in note" bar (INF-KEY-04, D-058). Enter and Shift+Enter move between matches with wrap; Escape closes
 * it and returns focus to the editor with the current match selected.
 */
export function FindBar({ editor, prefill, onClose }: { editor: Editor; prefill: string; onClose: () => void }) {
  const [query, setQuery] = useState(prefill);
  const inputRef = useRef<HTMLInputElement>(null);
  const { index, total } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = findState(e.state);
      return { index: s.index, total: s.matches.length };
    },
  });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    if (prefill) editor.commands.setFindQuery(prefill);
    return () => {
      if (!editor.isDestroyed) editor.commands.clearFind();
    };
  }, [editor, prefill]);

  const close = () => {
    const current = findState(editor.state).matches[findState(editor.state).index];
    editor.commands.clearFind();
    onClose();
    if (current) editor.chain().setTextSelection(current).focus().scrollIntoView().run();
    else editor.commands.focus();
  };

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        className="text-input find-input"
        aria-label="Find in note"
        placeholder="Find in note"
        maxLength={MAX_FIND_QUERY}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          editor.commands.setFindQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) editor.commands.findPrevious();
            else editor.commands.findNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      />
      <span className="find-count" role="status">
        {query === '' ? '' : total === 0 ? 'No results' : `${index + 1} of ${total}`}
      </span>
      <IconButton label="Previous match" title="Previous match (Shift+Enter)" icon={ChevronUp} disabled={total === 0} onClick={() => editor.commands.findPrevious()} />
      <IconButton label="Next match" title="Next match (Enter)" icon={ChevronDown} disabled={total === 0} onClick={() => editor.commands.findNext()} />
      <IconButton label="Close find" title="Close find (Escape)" icon={X} onClick={close} />
    </div>
  );
}
