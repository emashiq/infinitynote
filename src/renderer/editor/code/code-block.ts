import type { Editor } from '@tiptap/core';
import { CodeBlockLowlight, type CodeBlockLowlightOptions } from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CodeBlockView } from './CodeBlockView';
import { codeHighlighter } from './languages';

export interface CodeBlockViewOptions {
  /** Shows a short message (a diagram copied, or why it could not be). */
  notify: (message: string) => void;
}

/** A Markdown code fence on a line of its own: three backticks and an optional language ("```mermaid"). */
const FENCE_LINE = /^```([A-Za-z][\w+#-]{0,31})?$/;

/**
 * The language a paragraph that is a code fence asks for when Enter is pressed at its end ('' for none), or null when
 * the cursor is not at the end of such a paragraph or no code block may stand in its place (the first line of a list
 * item). Typing "```mermaid" then a space works through the input rule.
 */
export function fenceBeforeEnter(editor: Editor): string | null {
  const { selection, schema } = editor.state;
  const { $from } = selection;
  if (!selection.empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return null;
  const match = FENCE_LINE.exec($from.parent.textContent);
  const codeBlock = schema.nodes.codeBlock;
  if (!match || !codeBlock || !$from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), codeBlock)) return null;
  return (match[1] ?? '').toLowerCase();
}

/**
 * The code block of rich notes (D-159): StarterKit's node and schema (main applies live-sync steps with that schema),
 * highlighted with lowlight, with a language picker and, for `mermaid`, the diagram (D-158) in its view. Enter after a
 * fence line ("```mermaid") turns that line into a code block of the language (D-183).
 */
export const CodeBlock = CodeBlockLowlight.extend<CodeBlockLowlightOptions & CodeBlockViewOptions>({
  addOptions() {
    return { ...this.parent!(), lowlight: codeHighlighter, defaultLanguage: null, notify: () => undefined };
  },

  addAttributes() {
    const prefix = this.options.languageClassPrefix ?? 'language-';
    return {
      // As Tiptap's code block declares it, with a wider search for the language class.
      language: {
        default: this.options.defaultLanguage,
        rendered: false,
        // Pasted pages often wrap the code element (a header with a copy button first); its class still names the language.
        parseHTML: (element: HTMLElement) => {
          for (const el of [element, element.firstElementChild, element.querySelector('code')]) {
            const name = el ? [...el.classList].find((c) => c.startsWith(prefix))?.slice(prefix.length) : undefined;
            if (name) return name.toLowerCase();
          }
          return null;
        },
      },
    };
  },

  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      Enter: (props) => {
        const language = fenceBeforeEnter(props.editor);
        if (language === null) return parent.Enter?.(props) ?? false;
        const { $from } = props.editor.state.selection;
        return props.editor
          .chain()
          .deleteRange({ from: $from.start(), to: $from.end() })
          .setCodeBlock(language === '' ? undefined : { language })
          .run();
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
