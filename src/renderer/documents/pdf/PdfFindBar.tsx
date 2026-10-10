import { useRef, useState } from 'react';
import { DocumentFindBar } from '../DocumentFindBar';
import type { PdfFindState } from './pdf-session';

export interface PdfFindBarProps {
  find: PdfFindState;
  /** Counts Ctrl+F presses; each one focuses the field and selects its text. */
  focusRequests: number;
  onFind(query: string, options: { previous?: boolean; again?: boolean; caseSensitive: boolean; entireWord: boolean }): void;
  onClose(): void;
}

export function findSummary(find: PdfFindState): string {
  if (find.status === 'idle' || find.query === '') return '';
  if (find.status === 'notFound') return 'No matches';
  if (find.total === 0) return find.status === 'pending' ? 'Searching…' : 'No matches';
  return `${find.current} of ${find.total}${find.wrapped ? ' (continued from the other end)' : ''}`;
}

/**
 * Find in the PDF (F2): matches are highlighted in the pages as you type; Enter and Shift+Enter go to the next and
 * previous match, Escape closes the bar and clears the highlights.
 */
export function PdfFindBar({ find, focusRequests, onFind, onClose }: PdfFindBarProps) {
  const query = useRef(find.query);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [entireWord, setEntireWord] = useState(false);
  const run = (next: { caseSensitive?: boolean; entireWord?: boolean; previous?: boolean; again?: boolean }) =>
    onFind(query.current, { caseSensitive: next.caseSensitive ?? caseSensitive, entireWord: next.entireWord ?? entireWord, previous: next.previous, again: next.again });

  return (
    <DocumentFindBar
      subject="PDF"
      initialQuery={find.query}
      summary={findSummary(find)}
      focusRequests={focusRequests}
      onQuery={(q) => {
        query.current = q;
        run({});
      }}
      onStep={(previous) => run({ again: true, previous })}
      onClose={onClose}
      options={[
        {
          label: 'Match case',
          checked: caseSensitive,
          onChange: (checked) => {
            setCaseSensitive(checked);
            run({ caseSensitive: checked });
          },
        },
        {
          label: 'Whole words',
          checked: entireWord,
          onChange: (checked) => {
            setEntireWord(checked);
            run({ entireWord: checked });
          },
        },
      ]}
    />
  );
}
