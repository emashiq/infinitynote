import type { Editor } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { DIAGRAM_MESSAGES } from '../diagram/diagram-limits';
import { copyPng, copySvg } from '../diagram/diagram-export';
import { useDiagram } from '../diagram/use-diagram';
import type { CodeBlockViewOptions } from './code-block';
import { canonicalLanguage, CODE_LANGUAGES, languageLabel, MERMAID } from './languages';

/** Whether the editor is editable, following setEditable. */
function useEditable(editor: Editor): boolean {
  return useSyncExternalStore(
    (listener) => {
      editor.on('update', listener);
      editor.on('transaction', listener);
      return () => {
        editor.off('update', listener);
        editor.off('transaction', listener);
      };
    },
    () => editor.isEditable,
  );
}

/** Whether the selection is inside the block at `pos` (of `size`). */
function selectionInside(editor: Editor, pos: number | undefined, size: number): boolean {
  if (pos === undefined) return false;
  const { from, to } = editor.state.selection;
  return from > pos && to < pos + size;
}

/**
 * A code block (D-159) with its language picker; a `mermaid` block (D-158) shows its diagram, with Edit (the source and
 * the diagram below it) and Preview (the diagram only). Moving the cursor into the block shows the source, so the text
 * being typed is always visible.
 */
export function CodeBlockView({ node, editor, getPos, updateAttributes, extension }: ReactNodeViewProps) {
  const language = (node.attrs.language as string | null) ?? null;
  const diagram = language === MERMAID;
  const editable = useEditable(editor);
  const [editing, setEditing] = useState(() => editable && selectionInside(editor, getPos(), node.nodeSize));

  useEffect(() => {
    if (!diagram) return undefined;
    const follow = () => {
      if (editor.isEditable && selectionInside(editor, getPos(), node.nodeSize)) setEditing(true);
    };
    editor.on('selectionUpdate', follow);
    return () => {
      editor.off('selectionUpdate', follow);
    };
  }, [diagram, editor, getPos, node.nodeSize]);

  const picked = canonicalLanguage(language);
  const known = CODE_LANGUAGES.some((l) => l.id === picked);
  const sourceShown = !diagram || editing;
  return (
    <NodeViewWrapper className={`code-block${diagram ? ' is-diagram' : ''}`} data-language={language ?? undefined}>
      <div className="code-block-bar" contentEditable={false}>
        {editable ? (
          <select
            className="code-language"
            aria-label="Code language"
            value={picked}
            onChange={(e) => updateAttributes({ language: e.target.value === 'plaintext' ? null : e.target.value })}
          >
            {known ? null : <option value={picked}>{picked}</option>}
            {CODE_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="code-language-label">{languageLabel(language)}</span>
        )}
        {diagram ? (
          <button type="button" className="btn btn-small" aria-pressed={editing} onClick={() => setEditing(!editing)}>
            {editing ? 'Preview' : editable ? 'Edit' : 'Source'}
          </button>
        ) : null}
      </div>
      <pre className={sourceShown ? undefined : 'is-hidden'}>
        <NodeViewContent<'code'> as="code" />
      </pre>
      {diagram ? <DiagramPreview source={node.textContent} notify={(extension.options as CodeBlockViewOptions).notify} /> : null}
    </NodeViewWrapper>
  );
}

/** The drawing, its error, and Copy as SVG / Copy as PNG. Shown as an image, so nothing in it can run (D-158). */
function DiagramPreview({ source, notify }: { source: string; notify: (message: string) => void }) {
  const { result, theme } = useDiagram(source);
  const svg = result?.ok ? result.svg : null;
  const copy = (run: (svg: string) => Promise<boolean>) => {
    if (svg) void run(svg).then((ok) => notify(ok ? DIAGRAM_MESSAGES.copied : DIAGRAM_MESSAGES.copyFailed));
  };
  return (
    <div className="diagram" contentEditable={false}>
      {result === null ? <p className="diagram-status muted">Drawing…</p> : null}
      {result && !result.ok ? (
        <p className="diagram-error" role="status">
          {result.error}
        </p>
      ) : null}
      {svg ? (
        <>
          <img className="diagram-image" alt="Diagram" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
          <div className="diagram-actions">
            <button type="button" className="btn btn-small" onClick={() => copy(copySvg)}>
              Copy as SVG
            </button>
            <button type="button" className="btn btn-small" onClick={() => copy((s) => copyPng(s, theme === 'dark' ? '#1e1e1e' : '#ffffff'))}>
              Copy as PNG
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
