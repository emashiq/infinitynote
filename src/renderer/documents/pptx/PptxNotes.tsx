import { useState } from 'react';
import { MAX_SLIDE_NOTES_CHARS } from '../../../shared/documents/presentation';

interface NotesProps {
  slideNumber: number;
  notes: string;
  readOnly: boolean;
  /** The notes hold a find match. */
  highlighted: boolean;
  /** Text typed and not given to the presentation yet; null once it is. */
  onDraft(text: string | null): void;
  onCommit(text: string): void;
}

/**
 * The speaker notes of the shown slide (F5, D-150): plain text, a paragraph per line. What is typed is handed to the
 * presentation when the field is left (and before saving, through the draft); mounted again for each slide.
 */
export function PptxNotes({ slideNumber, notes, readOnly, highlighted, onDraft, onCommit }: NotesProps) {
  const [text, setText] = useState(notes);
  return (
    <label className={`pptx-notes${highlighted ? ' pptx-notes-hit' : ''}`}>
      <span className="pptx-notes-label">Speaker notes</span>
      <textarea
        className="input pptx-notes-text"
        aria-label={`Speaker notes of slide ${slideNumber}`}
        placeholder={readOnly ? '' : 'Click to add notes'}
        readOnly={readOnly}
        maxLength={MAX_SLIDE_NOTES_CHARS}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onDraft(e.target.value === notes ? null : e.target.value);
        }}
        onBlur={() => text !== notes && onCommit(text)}
      />
    </label>
  );
}
