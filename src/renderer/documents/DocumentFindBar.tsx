import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../ui/IconButton';

export interface FindOptionToggle {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}

export interface DocumentFindBarProps {
  /** What is searched ("PDF", "spreadsheet"), for the field's label. */
  subject: string;
  initialQuery: string;
  /** "3 of 10", "No matches", or empty. */
  summary: string;
  options: FindOptionToggle[];
  /** Counts Ctrl+F presses; each one focuses the field and selects its text. */
  focusRequests: number;
  onQuery(query: string): void;
  /** Next (Enter) or previous (Shift+Enter) match. */
  onStep(previous: boolean): void;
  onClose(): void;
}

/** A viewer's find bar: the field, the match count, previous and next, the viewer's options, and Close (Escape). */
export function DocumentFindBar({ subject, initialQuery, summary, options, focusRequests, onQuery, onStep, onClose }: DocumentFindBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const input = useRef<HTMLInputElement>(null);
  const label = `Find in ${subject}`;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequests]);

  return (
    <div className="document-find" role="search" aria-label={label}>
      <input
        ref={input}
        type="search"
        className="text-input document-find-input"
        aria-label={label}
        placeholder={label}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onStep(e.shiftKey);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="muted document-find-count" role="status">
        {summary}
      </span>
      <IconButton label="Previous match" title="Previous match (Shift+Enter)" icon={ChevronUp} disabled={query === ''} onClick={() => onStep(true)} />
      <IconButton label="Next match" title="Next match (Enter)" icon={ChevronDown} disabled={query === ''} onClick={() => onStep(false)} />
      {options.map((option) => (
        <label key={option.label} className="document-find-option">
          <input type="checkbox" checked={option.checked} onChange={(e) => option.onChange(e.target.checked)} />
          {option.label}
        </label>
      ))}
      <IconButton label="Close find" title="Close (Escape)" icon={X} onClick={onClose} />
    </div>
  );
}
