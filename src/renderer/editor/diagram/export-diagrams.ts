import type { Editor } from '@tiptap/core';
import { MAX_EXPORT_DIAGRAMS, MAX_EXPORT_DIAGRAM_SVG, type NoteDiagramType } from '../../../shared/contracts/portability';
import { MERMAID } from '../code/languages';
import { drawDiagram } from './diagram';

/** The Mermaid sources of a note, in order and without repeats, up to the export limit. */
export function diagramSources(editor: Editor): string[] {
  const sources = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (sources.size >= MAX_EXPORT_DIAGRAMS) return false;
    if (node.type.name === 'codeBlock' && node.attrs.language === MERMAID && node.textContent.trim() !== '') sources.add(node.textContent);
    return !node.isTextblock;
  });
  return [...sources];
}

/**
 * The note's diagrams drawn for an export or print (D-163): the light theme, as on paper; a diagram that cannot be
 * drawn is left out and its source is exported as code.
 */
export async function drawExportDiagrams(editor: Editor | null): Promise<NoteDiagramType[]> {
  if (!editor || editor.isDestroyed) return [];
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const drawn: NoteDiagramType[] = [];
  for (const source of diagramSources(editor)) {
    const result = await drawDiagram(source, 'light', font);
    if (result.ok && result.svg.startsWith('<svg') && result.svg.length <= MAX_EXPORT_DIAGRAM_SVG) drawn.push({ source, svg: result.svg });
  }
  return drawn;
}
