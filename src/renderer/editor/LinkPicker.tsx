import { FilePlus, FileText, Lock } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { InfinityBridge } from '../../shared/contracts/bridge';
import type { LinkCandidateType, PickBlockType } from '../../shared/contracts/references';
import { SEARCH_DEBOUNCE_MS } from '../../shared/contracts/search';
import type { DocumentKind } from '../../shared/documents/kinds';
import { describeTarget, TARGET_PROMPTS, targetFromInput, type DocumentTargetType } from '../../shared/documents/targets';
import { MAX_REF_EXCERPT, MAX_REF_LABEL } from '../../shared/editor/doc-schema';
import { clipText } from '../../shared/editor/text-blocks';
import { displayTitle } from '../../shared/names';
import { DocumentKindIcon } from '../ui/DocumentKindIcon';
import { Dialog } from '../ui/Dialog';

/** What the picker links to: a note (or one of its blocks), or a document (or a place inside it). */
export type PickedLink =
  | { kind: 'note'; noteId: string; blockId: string | null; label: string; excerpt: string | null }
  | { kind: 'document'; documentId: string; target: DocumentTargetType | null; label: string };

type NoteItem = Extract<LinkCandidateType, { kind: 'note' }>;
type DocumentItem = Extract<LinkCandidateType, { kind: 'document' }>;
type Step = { kind: 'search' } | { kind: 'note'; note: NoteItem } | { kind: 'document'; document: DocumentItem };

type Option =
  | { kind: 'candidate'; item: LinkCandidateType }
  | { kind: 'create'; title: string }
  | { kind: 'whole' }
  | { kind: 'block'; block: PickBlockType }
  | { kind: 'place'; target: DocumentTargetType };

/** Runs `load` after the debounce; the latest answer wins. */
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

const label = (title: string) => clipText(displayTitle(title), MAX_REF_LABEL);

/** "Create note “…”" is offered for a typed title that no listed note has already. */
function createOption(query: string, items: readonly LinkCandidateType[]): Option[] {
  const title = query.trim();
  if (title === '') return [];
  const exists = items.some((i) => i.kind === 'note' && displayTitle(i.title).toLocaleLowerCase() === title.toLocaleLowerCase());
  return exists ? [] : [{ kind: 'create', title: title.slice(0, 200) }];
}

export interface LinkPickerProps {
  bridge: Pick<InfinityBridge, 'links' | 'notes'>;
  /** The text to search for when the picker opens (a selection being linked). */
  initialQuery?: string;
  onPick: (link: PickedLink) => void;
  /** Creates a note with the title beside the current one; null when it failed (the caller reports why). */
  onCreateNote?: (title: string) => Promise<{ id: string; title: string } | null>;
  onClose: () => void;
}

/**
 * "Link to note or document" (INF-REF-01, INF-REF-02, D-157): search notes and documents by title (fuzzy, with their
 * kind and path), then link the whole item, a paragraph or heading of a note, or a place inside a document; or create a
 * note with the typed title. Keyboard: type to filter, Up/Down to move, Enter to choose, Backspace on an empty filter to
 * go back, Escape to close.
 */
export function LinkPicker({ bridge, initialQuery = '', onPick, onCreateNote, onClose }: LinkPickerProps) {
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const listId = useId();

  const items = useDebounced(
    async () => {
      if (step.kind !== 'search') return [];
      const res = await bridge.links.search({ query });
      return res.ok ? res.data.items : [];
    },
    [query, step],
    [] as LinkCandidateType[],
  );
  const blocks = useDebounced(
    async () => {
      if (step.kind !== 'note') return [];
      const res = await bridge.notes.pick({ noteId: step.note.id, query });
      return res.ok ? res.data.blocks : [];
    },
    [query, step],
    [] as PickBlockType[],
  );

  const place = step.kind === 'document' ? targetFromInput(step.document.documentKind, query) : null;
  const options: Option[] =
    step.kind === 'search'
      ? [...items.map((item): Option => ({ kind: 'candidate', item })), ...(onCreateNote ? createOption(query, items) : [])]
      : step.kind === 'note'
        ? [{ kind: 'whole' }, ...blocks.map((block): Option => ({ kind: 'block', block }))]
        : [...(place ? [{ kind: 'place', target: place } as const] : []), { kind: 'whole' }];
  const current = Math.min(active, Math.max(0, options.length - 1));

  const go = (next: Step) => {
    setStep(next);
    setQuery('');
    setActive(0);
  };

  const pickDocument = (document: DocumentItem, target: DocumentTargetType | null) =>
    onPick({ kind: 'document', documentId: document.id, target, label: label(document.title) });

  const choose = (option: Option | undefined) => {
    if (!option || busy) return;
    switch (option.kind) {
      case 'candidate': {
        const { item } = option;
        if (item.kind === 'note') go({ kind: 'note', note: item });
        else if (TARGET_PROMPTS[item.documentKind] === null) pickDocument(item, null);
        else go({ kind: 'document', document: item });
        return;
      }
      case 'create':
        setBusy(true);
        void onCreateNote?.(option.title).then((note) => {
          setBusy(false);
          if (note) onPick({ kind: 'note', noteId: note.id, blockId: null, label: label(note.title), excerpt: null });
        });
        return;
      case 'place':
        if (step.kind === 'document') pickDocument(step.document, option.target);
        return;
      default:
        if (step.kind === 'document') pickDocument(step.document, null);
        else if (step.kind === 'note') {
          const block = option.kind === 'block' ? option.block : null;
          onPick({ kind: 'note', noteId: step.note.id, blockId: block?.blockId ?? null, label: label(step.note.title), excerpt: block ? clipText(block.text, MAX_REF_EXCERPT) : null });
        }
    }
  };

  const placeholder = step.kind === 'search' ? 'Search notes and documents' : step.kind === 'note' ? 'Filter paragraphs' : (TARGET_PROMPTS[step.document.documentKind] ?? '');
  const title = step.kind === 'search' ? 'Link to note or document' : `Link to ${displayTitle(step.kind === 'note' ? step.note.title : step.document.title)}`;
  return (
    <Dialog title={title} onClose={onClose} returnFocus={false}>
      <input
        role="combobox"
        className="text-input"
        aria-label={placeholder}
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={options.length > 0 ? `link-opt-${current}` : undefined}
        aria-busy={busy || undefined}
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
          } else if (e.key === 'Backspace' && step.kind !== 'search' && query === '') {
            e.preventDefault();
            go({ kind: 'search' });
          }
        }}
      />
      <ul id={listId} role="listbox" aria-label={step.kind === 'search' ? 'Notes and documents' : step.kind === 'note' ? 'Paragraphs' : 'Places'} className="listbox ref-picker-list">
        {options.map((option, i) => (
          <li
            key={optionKey(option)}
            id={`link-opt-${i}`}
            role="option"
            aria-selected={i === current}
            className={`option ${i === current ? 'is-active' : ''}`}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(option)}
          >
            <OptionContent option={option} wholeLabel={step.kind === 'document' ? 'Whole document' : 'Whole note'} />
          </li>
        ))}
        {step.kind === 'search' && options.length === 0 ? (
          <li role="presentation" className="muted palette-empty">
            {query.trim() === '' ? 'No notes or documents yet' : 'No matching notes or documents'}
          </li>
        ) : null}
      </ul>
      <div className="dialog-actions">
        {step.kind !== 'search' ? (
          <button type="button" className="btn" onClick={() => go({ kind: 'search' })}>
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

function optionKey(option: Option): string {
  switch (option.kind) {
    case 'candidate':
      return `${option.item.kind}:${option.item.id}`;
    case 'block':
      return option.block.blockId;
    case 'place':
      return `place:${JSON.stringify(option.target)}`;
    default:
      return option.kind;
  }
}

function ItemIcon({ kind }: { kind: 'note' | DocumentKind }) {
  return kind === 'note' ? <FileText size={14} strokeWidth={1.75} aria-hidden /> : <DocumentKindIcon kind={kind} size={14} />;
}

function OptionContent({ option, wholeLabel }: { option: Option; wholeLabel: string }): ReactNode {
  switch (option.kind) {
    case 'candidate': {
      const { item } = option;
      return (
        <>
          <span className="link-option-title">
            <ItemIcon kind={item.kind === 'note' ? 'note' : item.documentKind} />
            <span>{displayTitle(item.title)}</span>
            {item.kind === 'note' && item.locked ? <Lock size={12} strokeWidth={1.75} aria-label="Locked" /> : null}
          </span>
          <span className="muted option-path">{item.path.join(' › ')}</span>
        </>
      );
    }
    case 'create':
      return (
        <span className="link-option-title">
          <FilePlus size={14} strokeWidth={1.75} aria-hidden />
          <span>Create note “{option.title}”</span>
        </span>
      );
    case 'block':
      return <span>{option.block.text}</span>;
    case 'place':
      return <span>{describeTarget(option.target)}</span>;
    default:
      return <span>{wholeLabel}</span>;
  }
}
