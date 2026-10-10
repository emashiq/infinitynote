import { CodeBlockLowlight, type CodeBlockLowlightOptions } from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CodeBlockView } from './CodeBlockView';
import { codeHighlighter } from './languages';

export interface CodeBlockViewOptions {
  /** Shows a short message (a diagram copied, or why it could not be). */
  notify: (message: string) => void;
}

/**
 * The code block of rich notes (D-159): StarterKit's node and schema (main applies live-sync steps with that schema),
 * highlighted with lowlight, with a language picker and, for `mermaid`, the diagram (D-158) in its view.
 */
export const CodeBlock = CodeBlockLowlight.extend<CodeBlockLowlightOptions & CodeBlockViewOptions>({
  addOptions() {
    return { ...this.parent!(), lowlight: codeHighlighter, defaultLanguage: null, notify: () => undefined };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
