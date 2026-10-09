import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { HomeScopeType } from '../../shared/contracts/home';
import { SEARCH_DEBOUNCE_MS, type SearchResultType } from '../../shared/contracts/search';
import type { TagInfoType } from '../../shared/contracts/tags';
import { displayTitle } from '../../shared/names';
import { filterActions, PALETTE_ACTIONS, type PaletteAction } from '../state/palette-actions';
import { useServices, useStore } from '../state/use-store';
import { openModal, useReturnFocus } from '../ui/Dialog';
import { LockMark } from '../ui/LockMark';
import { Highlighted } from './Highlighted';
import { quickNotes, type QuickNote } from './quick-notes';

type Option =
  | { kind: 'result'; result: SearchResultType }
  | { kind: 'quick'; group: 'Pinned' | 'Favorites'; note: QuickNote }
  | { kind: 'action'; action: PaletteAction };

const ALL: HomeScopeType = { kind: 'all' };

const scopeValue = (scope: HomeScopeType): string => (scope.kind === 'project' ? `project:${scope.projectId}` : scope.kind);
const scopeFrom = (value: string): HomeScopeType =>
  value.startsWith('project:') ? { kind: 'project', projectId: value.slice('project:'.length) } : value === 'common' ? { kind: 'common' } : ALL;

export function CommandPalette() {
  const { ui } = useServices();
  const { paletteOpen } = useStore(ui.store);
  return paletteOpen ? <PaletteDialog /> : null;
}

/**
 * Ctrl+K (INF-KEY-03, INF-SRCH-03..06): actions, pinned and favorite notes, and full-text note search with scope and
 * tag filters. Searches are debounced and capped by main, so the list never holds more than 50 notes.
 */
function PaletteDialog() {
  const { ui, bridge, commands, tabs, tree } = useServices();
  const [query, setQuery] = useState(() => ui.store.getState().paletteQuery);
  const [scope, setScope] = useState<HomeScopeType>(ALL);
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState<TagInfoType[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<SearchResultType[]>([]);
  const [active, setActive] = useState(0);
  const { snapshot } = useStore(tree.store);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  useReturnFocus();

  useEffect(() => {
    if (dialogRef.current) openModal(dialogRef.current);
    inputRef.current?.focus();
    inputRef.current?.select();
    void bridge.tags.list({}).then((res) => {
      if (res.ok) setTags(res.data.tags);
    });
  }, [bridge]);

  const searching = query.trim() !== '' || tag !== '';
  useEffect(() => {
    if (!searching) return undefined;
    let stale = false;
    const handle = setTimeout(() => {
      void bridge.search.query({ query, scope, ...(tag ? { tags: [tag] } : {}) }).then((res) => {
        if (!stale) setResults(res.ok ? res.data.results : []);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(handle);
    };
  }, [query, scope, tag, searching, bridge]);

  const quick = useMemo(() => quickNotes(snapshot), [snapshot]);
  const activeFilters = (scope.kind === 'all' ? 0 : 1) + (tag === '' ? 0 : 1);
  const projects = useMemo(() => [...snapshot.projects].sort((a, b) => a.name.localeCompare(b.name)), [snapshot.projects]);
  const options: Option[] = [
    ...(searching
      ? results.map((result): Option => ({ kind: 'result', result }))
      : [
          ...quick.pinned.map((note): Option => ({ kind: 'quick', group: 'Pinned', note })),
          ...quick.favorites.map((note): Option => ({ kind: 'quick', group: 'Favorites', note })),
        ]),
    ...filterActions(PALETTE_ACTIONS, query).map((action): Option => ({ kind: 'action', action })),
  ];
  const current = Math.min(active, Math.max(0, options.length - 1));

  const run = (option: Option | undefined) => {
    if (!option) return;
    ui.closePalette();
    if (option.kind === 'action') void commands.run(option.action.id);
    else void tabs.openNote(option.kind === 'result' ? option.result.note.id : option.note.id);
  };

  const groupOf = (o: Option): string => (o.kind === 'result' ? 'Notes' : o.kind === 'quick' ? o.group : 'Actions');
  const keyOf = (o: Option): string => (o.kind === 'action' ? `a-${o.action.id}` : o.kind === 'result' ? `n-${o.result.note.id}` : `q-${o.group}-${o.note.id}`);
  const renderOption = (option: Option, index: number) => {
    return (
      <li
        id={`palette-opt-${index}`}
        role="option"
        aria-selected={index === current}
        className={`option ${option.kind === 'result' ? 'option-result ' : ''}${index === current ? 'is-active' : ''}`}
        onMouseMove={() => setActive(index)}
        onClick={() => run(option)}
      >
        {option.kind === 'result' ? (
          <>
            <span className="option-line">
              <Highlighted segments={option.result.title} className="option-title" />
              {option.result.note.locked ? <LockMark /> : null}
              <span className="muted option-path">{option.result.note.path.join(' › ')}</span>
            </span>
            {option.result.snippet.length > 0 ? <Highlighted segments={option.result.snippet} className="muted option-snippet" /> : null}
          </>
        ) : option.kind === 'quick' ? (
          <>
            <span>{displayTitle(option.note.title)}</span>
            <span className="muted option-path">{option.note.path.join(' › ')}</span>
          </>
        ) : (
          <>
            <span>{option.action.label}</span>
            {option.action.shortcut ? <kbd>{option.action.shortcut}</kbd> : null}
          </>
        )}
      </li>
    );
  };

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
        aria-label="Type a command or search notes"
        aria-activedescendant={options.length > 0 ? `palette-opt-${current}` : undefined}
        value={query}
        placeholder="Type a command or search notes"
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
      <div className="palette-filters">
        <button type="button" className="btn btn-small" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>
          {activeFilters > 0 ? `Filters (${activeFilters})` : 'Filters'}
        </button>
        {showFilters ? (
          <>
            <select className="select" aria-label="Search in" value={scopeValue(scope)} onChange={(e) => setScope(scopeFrom(e.target.value))}>
              <option value="all">All notes</option>
              <option value="common">Common</option>
              {projects.map((p) => (
                <option key={p.id} value={`project:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </select>
            <select className="select" aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">Any tag</option>
              {tags.map((t) => (
                <option key={t.name} value={t.name}>
                  #{t.name} ({t.count})
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="listbox palette-list">
        {options.map((o, i) => (
          <PaletteGroup key={keyOf(o)} label={i === 0 || groupOf(options[i - 1]!) !== groupOf(o) ? groupOf(o) : null}>
            {renderOption(o, i)}
          </PaletteGroup>
        ))}
        {options.length === 0 ? (
          <li role="presentation" className="muted palette-empty">
            No matches
          </li>
        ) : null}
      </ul>
    </dialog>
  );
}

/** An option, preceded by its group label when it starts a group. */
function PaletteGroup({ label, children }: { label: string | null; children: ReactNode }) {
  return (
    <>
      {label ? (
        <li role="presentation" className="group-label">
          {label}
        </li>
      ) : null}
      {children}
    </>
  );
}
