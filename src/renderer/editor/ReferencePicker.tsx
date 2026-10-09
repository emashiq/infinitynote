import { useEffect, useId, useState } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { NoteSummaryType } from '../../shared/contracts/hierarchy';
import type { PickBlockType } from '../../shared/contracts/references';
import { SEARCH_DEBOUNCE_MS } from '../../shared/contracts/search';
import { MAX_REF_EXCERPT, MAX_REF_LABEL } from '../../shared/editor/doc-schema';
import { clipText } from '../../shared/editor/text-blocks';
import { displayTitle } from '../../shared/names';
import { Dialog } from '../ui/Dialog';

export interface PickedReference {
  noteId: string;
  blockId: string | null;
  label: string;
  excerpt: string | null;
}

type Option = { kind: 'note'; note: NoteSummaryType } | { kind: 'whole' } | { kind: 'block'; block: PickBlockType };

/** Runs `load` for the query after the debounce; the latest answer wins. */
function useDebounced<T>(load: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let stale = false;
    const handle = setTimeout(() => {
      void load().then((v) => {
        if (!stale) setValue(v);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(handle);
    };
    // The caller lists what the load depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/**
 * "Link to note" (INF-REF-01, INF-REF-02): search notes by title, then link the whole note or one of its paragraphs.
 * Keyboard: type to filter, Up/Down to move, Enter to choose, Backspace on an empty filter to go back, Escape to close.
 */
export function ReferencePicker({ bridge, onPick, onClose }: { bridge: Pick<InfinityBridge, 'palette' | 'notes'>; onPick: (ref: PickedReference) => void; onClose: () => void }) {
  const [target, setTarget] = useState<NoteSummaryType | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();

  const notes = useDebounced(
    async () => {
      if (target || query.trim() === '') return [];
      const res = await bridge.palette.searchTitles({ query, limit: 20 });
      return res.ok ? res.data.results : [];
    },
    [query, target],
    [] as NoteSummaryType[],
  );
  const blocks = useDebounced(
    async () => {
      if (!target) return [];
      const res = await bridge.notes.pick({ noteId: target.id, query });
      return res.ok ? res.data.blocks : [];
    },
    [query, target],
    [] as PickBlockType[],
  );

  const options: Option[] = target
    ? [{ kind: 'whole' }, ...blocks.map((block): Option => ({ kind: 'block', block }))]
    : notes.map((note): Option => ({ kind: 'note', note }));
  const current = Math.min(active, Math.max(0, options.length - 1));

  const reset = (next: NoteSummaryType | null) => {
    setTarget(next);
    setQuery('');
    setActive(0);
  };
  const choose = (option: Option | undefined) => {
    if (!option) return;
    if (option.kind === 'note') {
      reset(option.note);
      return;
    }
    const label = clipText(displayTitle(target!.title), MAX_REF_LABEL);
    onPick({
      noteId: target!.id,
      blockId: option.kind === 'block' ? option.block.blockId : null,
      label,
      excerpt: option.kind === 'block' ? clipText(option.block.text, MAX_REF_EXCERPT) : null,
    });
  };

  const placeholder = target ? 'Filter paragraphs' : 'Search notes by title';
  return (
    <Dialog title={target ? `Link to ${displayTitle(target.title)}` : 'Link to note'} onClose={onClose} returnFocus={false}>
      <input
        role="combobox"
        className="text-input"
        aria-label={placeholder}
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={options.length > 0 ? `ref-opt-${current}` : undefined}
        placeholder={placeholder}
        value={query}
        data-autofocus=""
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(Math.min(current + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(current - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(options[current]);
          } else if (e.key === 'Backspace' && target && query === '') {
            e.preventDefault();
            reset(null);
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label={target ? 'Paragraphs' : 'Notes'} className="listbox ref-picker-list">
        {options.map((option, i) => (
          <li
            key={option.kind === 'note' ? option.note.id : option.kind === 'block' ? option.block.blockId : 'whole'}
            id={`ref-opt-${i}`}
            role="option"
            aria-selected={i === current}
            className={`option ${i === current ? 'is-active' : ''}`}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(option)}
          >
            {option.kind === 'note' ? (
              <>
                <span>{displayTitle(option.note.title)}</span>
                <span className="muted option-path">{option.note.path.join(' › ')}</span>
              </>
            ) : option.kind === 'whole' ? (
              <span>Whole note</span>
            ) : (
              <span>{option.block.text}</span>
            )}
          </li>
        ))}
        {!target && options.length === 0 ? (
          <li role="presentation" className="muted palette-empty">
            {query.trim() === '' ? 'Type a note title' : 'No matching notes'}
          </li>
        ) : null}
      </ul>
      <div className="dialog-actions">
        {target ? (
          <button type="button" className="btn" onClick={() => reset(null)}>
            Back
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
