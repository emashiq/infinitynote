import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_MATH_BLOCK, MAX_MATH_INLINE } from '../../../shared/editor/doc-schema';
import { loadKatex, mathError } from './math-render';

/** Draws the formula into the element once KaTeX is loaded; the error text when the TeX is invalid. */
function useFormula(latex: string, display: boolean): { ref: React.RefObject<HTMLSpanElement | null>; error: string | null } {
  const ref = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    void loadKatex().then(({ renderMath }) => {
      const el = ref.current;
      if (stale || !el) return;
      try {
        renderMath(latex, el, display);
        setError(null);
      } catch (err) {
        el.textContent = '';
        setError(mathError(err));
      }
    });
    return () => {
      stale = true;
    };
  }, [latex, display]);
  return { ref, error };
}

/**
 * A formula (D-161): drawn with KaTeX; a click (or Enter on the selected formula) edits its TeX in place. Enter
 * (Ctrl+Enter in a block) or leaving the field keeps the change, Escape drops it, and an empty formula is removed.
 * Block formulas show the drawing under the TeX while it is edited; a new (empty) formula opens for editing.
 */
export function MathView({ node, editor, selected, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const display = node.type.name === 'mathBlock';
  const latex = String(node.attrs.latex ?? '');
  const [draft, setDraft] = useState<string | null>(latex === '' && editor.isEditable ? '' : null);
  const { ref: formulaRef, error: formulaError } = useFormula(draft ?? latex, display);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const editing = draft !== null;
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const edit = () => {
    if (editor.isEditable) setDraft(latex);
  };
  const finish = (keep: boolean) => {
    const next = draft;
    setDraft(null);
    if (keep && next !== null && next.trim() === '') deleteNode();
    else if (keep && next !== null && next !== latex) updateAttributes({ latex: next });
    else if (!keep && latex === '') deleteNode();
    // At once (Tiptap's focus command waits for a frame and would take the focus from a formula opened meanwhile).
    editor.view.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Enter' && (!display || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      finish(true);
    }
  };
  // Enter on a selected formula edits it.
  useEffect(() => {
    if (!selected || editing) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Enter' && editor.isEditable) {
        e.preventDefault();
        setDraft(latex);
      }
    };
    const dom = editor.view.dom;
    dom.addEventListener('keydown', onKey);
    return () => dom.removeEventListener('keydown', onKey);
  }, [selected, editing, editor, latex]);

  const Wrapper = display ? 'div' : 'span';
  return (
    <NodeViewWrapper as={Wrapper} className={`${display ? 'math-block' : 'math-inline'}${selected ? ' is-selected' : ''}`} data-latex={latex}>
      {editing ? (
        <span className="math-edit" contentEditable={false}>
          {display ? (
            <textarea
              ref={field}
              className="text-input math-source"
              aria-label="Formula (TeX)"
              value={draft}
              maxLength={MAX_MATH_BLOCK}
              rows={Math.min(8, Math.max(2, draft.split('\n').length))}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => finish(true)}
            />
          ) : (
            <input
              ref={field}
              className="text-input math-source"
              aria-label="Formula (TeX)"
              value={draft}
              maxLength={MAX_MATH_INLINE}
              size={Math.min(40, Math.max(4, draft.length + 1))}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={() => finish(true)}
            />
          )}
        </span>
      ) : null}
      <span
        className="math-render"
        contentEditable={false}
        hidden={editing && !display}
        role="math"
        aria-label={latex}
        title={editor.isEditable ? 'Click to edit the formula' : latex}
        onClick={edit}
      >
        <span ref={formulaRef} />
        {formulaError ? <span className="math-error">{formulaError}</span> : null}
        {(draft ?? latex) === '' ? <span className="muted">Empty formula</span> : null}
      </span>
    </NodeViewWrapper>
  );
}
