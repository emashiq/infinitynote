import type { Editor, JSONContent } from '@tiptap/core';
import { fenceBlocks } from '../editor/code-fences';
import { threadRanges } from '../editor/comments/comment-marks';
import type { AnswerPlacement } from './ai-request';

/** Inline Markdown the answers use: **bold**, *italic* or _italic_, `code`. */
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/;

function inline(text: string): JSONContent[] {
  const out: JSONContent[] = [];
  for (const part of text.split(INLINE)) {
    if (part === '') continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push({ type: 'text', text: part.slice(2, -2), marks: [{ type: 'bold' }] });
    else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) out.push({ type: 'text', text: part.slice(1, -1), marks: [{ type: 'code' }] });
    else if (/^([*_]).+\1$/.test(part) && part.length > 2) out.push({ type: 'text', text: part.slice(1, -1), marks: [{ type: 'italic' }] });
    else out.push({ type: 'text', text: part });
  }
  return out;
}

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: inline(text) });

type ListKind = 'bulletList' | 'orderedList' | 'taskList';

/** One line as a list item of its kind, or null when it is not one. */
function listLine(line: string): { kind: ListKind; item: JSONContent } | null {
  const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
  if (task) return { kind: 'taskList', item: { type: 'taskItem', attrs: { checked: task[1] !== ' ' }, content: [paragraph(task[2]!)] } };
  const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
  if (bullet) return { kind: 'bulletList', item: { type: 'listItem', content: [paragraph(bullet[1]!)] } };
  const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
  if (numbered) return { kind: 'orderedList', item: { type: 'listItem', content: [paragraph(numbered[1]!)] } };
  return null;
}

/**
 * An AI answer as note blocks (D-190): the Markdown it is written in becomes headings, bulleted, numbered and check
 * lists, code blocks and paragraphs with bold, italic and inline code; anything else stays as its text.
 */
export function answerBlocks(text: string): JSONContent[] {
  const blocks: JSONContent[] = [];
  let list = null as { kind: ListKind; items: JSONContent[] } | null;
  const closeList = () => {
    if (list) blocks.push({ type: list.kind, content: list.items });
    list = null;
  };
  for (const block of fenceBlocks(text)) {
    if (block.kind === 'code') {
      closeList();
      blocks.push({ type: 'codeBlock', attrs: { language: block.language }, content: block.text === '' ? [] : [{ type: 'text', text: block.text }] });
      continue;
    }
    const line = block.text.trimEnd();
    const item = listLine(line);
    if (item) {
      if (list?.kind !== item.kind) {
        closeList();
        list = { kind: item.kind, items: [] };
      }
      list.items.push(item.item);
      continue;
    }
    closeList();
    if (line.trim() === '' || /^\s*([-*_])\1{2,}\s*$/.test(line)) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    blocks.push(heading ? { type: 'heading', attrs: { level: Math.min(heading[1]!.length, 3) }, content: inline(heading[2]!) } : paragraph(line.trim()));
  }
  closeList();
  return blocks;
}

/**
 * Puts an answer into the note at a thread's text (D-190): "below" adds it after the top-level block holding the end of
 * the text; "replace" puts it in place of the text and keeps the thread on the new text. One undoable edit; false when
 * the thread's text is gone or the note cannot be edited.
 */
export function placeAnswer(editor: Editor, threadId: string, text: string, placement: AnswerPlacement): boolean {
  const ranges = threadRanges(editor.state.doc, threadId);
  const content = answerBlocks(text);
  if (!editor.isEditable || ranges.length === 0 || content.length === 0) return false;
  if (placement === 'below') {
    const end = editor.state.doc.resolve(ranges[ranges.length - 1]!.to);
    return editor.chain().insertContentAt(end.after(1), content).scrollIntoView().run();
  }
  const from = ranges[0]!.from;
  const to = ranges[ranges.length - 1]!.to;
  const mark = editor.schema.marks.comment!.create({ threadId });
  const single = content.length === 1 && content[0]!.type === 'paragraph' ? (content[0]!.content ?? []) : content;
  return editor
    .chain()
    .insertContentAt({ from, to }, single)
    .command(({ tr }) => {
      tr.addMark(from, tr.selection.to, mark);
      return true;
    })
    .scrollIntoView()
    .run();
}
