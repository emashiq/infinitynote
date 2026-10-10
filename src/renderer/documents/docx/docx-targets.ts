import { documentParagraphStyles } from '@portone/docx-editor/commands';
import type { Node as PmNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { DocumentTargetType } from '../../../shared/documents/targets';
import { DOCX_MESSAGES } from './docx-messages';

/** Word's built-in heading and title styles keep these names in styles.xml whatever the language of the UI. */
const HEADING_STYLE_NAME = /^(heading [1-9]|title)$/i;
const STYLE_ID = /<w:pStyle\s+w:val="([^"]*)"/;

const normalized = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Every paragraph of the body in document order (table cells included), with its position. */
function paragraphs(doc: PmNode): Array<{ node: PmNode; pos: number }> {
  const out: Array<{ node: PmNode; pos: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    out.push({ node, pos });
    return false;
  });
  return out;
}

/** The ids of the paragraph styles that are headings. */
function headingStyleIds(state: EditorState): ReadonlySet<string> {
  return new Set(
    documentParagraphStyles(state)
      .filter((style) => HEADING_STYLE_NAME.test(style.name))
      .map((style) => style.id),
  );
}

/**
 * Where a link's place in a Word document is (F4, D-146): the first heading with that text (ignoring case and runs of
 * spaces), or the paragraph at a zero-based index. A message when the document has no such place; null for a target
 * of another kind of document.
 */
export function targetPosition(state: EditorState, target: DocumentTargetType): { pos: number } | { missing: string } | null {
  if ('paragraph' in target) {
    const found = paragraphs(state.doc)[target.paragraph];
    return found ? { pos: found.pos } : { missing: DOCX_MESSAGES.paragraphMissing(target.paragraph) };
  }
  if (!('heading' in target)) return null;
  const headings = headingStyleIds(state);
  const wanted = normalized(target.heading);
  const found = paragraphs(state.doc).find(({ node }) => {
    const styleId = STYLE_ID.exec(String(node.attrs.pPr ?? ''))?.[1];
    return styleId !== undefined && headings.has(styleId) && normalized(node.textContent) === wanted;
  });
  return found ? { pos: found.pos } : { missing: DOCX_MESSAGES.headingMissing(target.heading) };
}

/** Puts the caret at the start of the paragraph at `pos` and scrolls it into view. */
export function showPosition(view: EditorView, pos: number): void {
  const selection = TextSelection.near(view.state.doc.resolve(pos + 1));
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView().setMeta('addToHistory', false));
}

/** The zero-based index among the body's paragraphs of the paragraph holding `pos` (the anchor of a comment, D-165). */
export function paragraphIndexAt(doc: PmNode, pos: number): number {
  const all = paragraphs(doc);
  let index = 0;
  for (let i = 0; i < all.length && all[i]!.pos <= pos; i += 1) index = i;
  return index;
}
