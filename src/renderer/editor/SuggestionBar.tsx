import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import type { MouseEvent } from 'react';
import { candidateZone, resolveCandidate } from '../../shared/nlp/resolve-candidate';
import { formatShort } from '../../shared/time/format';
import type { SuggestionSettings } from '../reminders/suggestion-context';
import { candidateAt, type LiveCandidate } from './suggestions';

/** The bar's text for a phrase: its due time in its zone, "(past)", or that it needs a choice (UX_SPEC section 5). */
export function barText(live: LiveCandidate, settings: Pick<SuggestionSettings, 'endOfDayTime' | 'dateOnlyTime'>): string {
  const c = live.candidate;
  const res = resolveCandidate(c, { zoneId: c.parseZone, choices: {}, ...settings });
  if (res.status === 'needsChoice') return 'Reminder: needs a choice';
  const zone = candidateZone(c, { zoneId: c.parseZone, choices: {} });
  return `Reminder: ${formatShort(res.instantUtc, zone)}${res.past ? ' (past)' : ''}`;
}

/** Bar buttons keep the editor's focus and selection, and stay out of the tab order (the keyboard uses More). */
const keepFocus = (e: MouseEvent) => e.preventDefault();

export interface SuggestionBarProps {
  editor: Editor;
  settings: SuggestionSettings;
  /** In a sticky, a changed source is updated in the main window ("Open in app to update"). */
  updateInApp: boolean;
  onCreate(live: LiveCandidate): void;
  onUpdate(live: LiveCandidate): void;
  onDismiss(live: LiveCandidate): void;
}

/**
 * The slim bar over the bottom of the editor while the cursor is in a detected phrase (plan section 9.5): it shows
 * the reminder time and offers Create (or Update for a changed source) and Dismiss. It never takes the focus and
 * causes no layout shift.
 */
export function SuggestionBar(props: SuggestionBarProps) {
  const live = useEditorState({
    editor: props.editor,
    selector: ({ editor }) => (editor.state.selection.empty ? candidateAt(editor.state, editor.state.selection.from) : null),
  });
  if (!live) return null;
  const button = (label: string, run: () => void) => (
    <button key={label} type="button" className="btn btn-small" tabIndex={-1} onMouseDown={keepFocus} onClick={run}>
      {label}
    </button>
  );
  return (
    <div className="suggestion-bar" role="group" aria-label="Reminder suggestion">
      <span className="suggestion-bar-text">{barText(live, props.settings)}</span>
      {live.updateFor
        ? [
            button(props.updateInApp ? 'Open in app to update' : 'Update reminder', () => props.onUpdate(live)),
            button('Create new reminder', () => props.onCreate(live)),
          ]
        : button('Create reminder', () => props.onCreate(live))}
      {button('Dismiss', () => props.onDismiss(live))}
    </div>
  );
}
