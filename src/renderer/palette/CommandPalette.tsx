import { useEffect, useId, useRef, useState } from 'react';
import type { NoteSummaryType } from '../../shared/contracts/hierarchy';
import { displayTitle } from '../../shared/names';
import { filterActions, PALETTE_ACTIONS } from '../state/palette-actions';
import { useServices, useStore } from '../state/use-store';
import { openModal, useReturnFocus } from '../ui/Dialog';

type Option = { kind: 'note'; note: NoteSummaryType } | { kind: 'action'; id: (typeof PALETTE_ACTIONS)[number]['id']; label: string; shortcut?: string };

export function CommandPalette() {
  const { ui } = useServices();
  const { paletteOpen } = useStore(ui.store);
  return paletteOpen ? <PaletteDialog /> : null;
}

function PaletteDialog() {
  const { ui, bridge, commands, tabs } = useServices();
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<NoteSummaryType[]>([]);
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  useReturnFocus();

  useEffect(() => {
    if (dialogRef.current) openModal(dialogRef.current);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (query.trim() === '') return undefined;
    let stale = false;
    const handle = setTimeout(() => {
      void bridge.palette.searchTitles({ query }).then((res) => {
        if (!stale) setNotes(res.ok ? res.data.results : []);
      });
    }, 150);
    return () => {
      stale = true;
      clearTimeout(handle);
    };
  }, [query, bridge]);

  const options: Option[] = [
    ...(query.trim() === '' ? [] : notes.map((note): Option => ({ kind: 'note', note }))),
    ...filterActions(PALETTE_ACTIONS, query).map((a): Option => ({ kind: 'action', id: a.id, label: a.label, shortcut: a.shortcut })),
  ];
  const current = Math.min(active, Math.max(0, options.length - 1));
  const noteCount = options.filter((o) => o.kind === 'note').length;

  const run = (option: Option | undefined) => {
    if (!option) return;
    ui.closePalette();
    if (option.kind === 'note') void tabs.openNote(option.note.id);
    else void commands.run(option.id);
  };

  const renderOption = (option: Option, index: number) => (
    <li
      key={option.kind === 'note' ? `n-${option.note.id}` : `a-${option.id}`}
      id={`palette-opt-${index}`}
      role="option"
      aria-selected={index === current}
      className={`option ${index === current ? 'is-active' : ''}`}
      onMouseMove={() => setActive(index)}
      onClick={() => run(option)}
    >
      {option.kind === 'note' ? (
        <>
          <span>{displayTitle(option.note.title)}</span>
          <span className="muted option-path">{option.note.path.join(' › ')}</span>
        </>
      ) : (
        <>
          <span>{option.label}</span>
          {option.shortcut ? <kbd>{option.shortcut}</kbd> : null}
        </>
      )}
    </li>
  );

  return (
    <dialog
      ref={dialogRef}
      className="palette"
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        ui.closePalette();
      }}
    >
      <input
        ref={inputRef}
        role="combobox"
        className="palette-input"
        aria-expanded="true"
        aria-controls={listId}
        aria-label="Type a command or note title"
        aria-activedescendant={options.length > 0 ? `palette-opt-${current}` : undefined}
        value={query}
        placeholder="Type a command or note title"
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
            run(options[current]);
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label="Results" className="listbox palette-list">
        {noteCount > 0 ? (
          <li role="presentation" className="group-label">
            Notes
          </li>
        ) : null}
        {options.slice(0, noteCount).map((o, i) => renderOption(o, i))}
        {options.length > noteCount ? (
          <li role="presentation" className="group-label">
            Actions
          </li>
        ) : null}
        {options.slice(noteCount).map((o, i) => renderOption(o, noteCount + i))}
        {options.length === 0 ? (
          <li role="presentation" className="muted palette-empty">
            No matches
          </li>
        ) : null}
      </ul>
    </dialog>
  );
}
