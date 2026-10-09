// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isUserEdit } from '../../../../src/renderer/editor/content';
import { blockIdAtSelection, chipsMeta, findBlock, reminderChipsKey, type ChipInfo } from '../../../../src/renderer/editor/reminder-chips';
import { attachmentNode, insertBlocks } from '../../../../src/renderer/editor/uploader';
import { makeEditor, type TestEditor } from './support';

const P = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const L = '2b4e28ba-2fa1-41d2-883f-0016d3cca427';
const LP = '3b4e28ba-2fa1-41d2-883f-0016d3cca427';
const IMG = '4b4e28ba-2fa1-41d2-883f-0016d3cca427';
const ATT = '5b4e28ba-2fa1-41d2-883f-0016d3cca427';

const doc = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { id: P }, content: [{ type: 'text', text: 'Pay rent' }] },
    { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: L }, content: [{ type: 'paragraph', attrs: { id: LP }, content: [{ type: 'text', text: 'Item' }] }] }] },
    { type: 'image', attrs: { id: IMG, attachmentId: ATT, alt: null, size: 'medium', width: null, height: null } },
  ],
};
const chip = (reminderId: string, blockId: string, sourceChanged = false): ChipInfo => ({ reminderId, blockId, label: 'Fri 9 Oct, 17:00', state: 'pending', ariaLabel: `Reminder: ${reminderId}`, sourceChanged });

describe('reminder chips (INF-REM-04, D-080)', () => {
  it('chips are a meta-only transaction: the document is identical and it is not a user edit', () => {
    const t = makeEditor({ content: doc });
    // The trailing-node plugin adds its paragraph after the final image on the first transaction; settle that first.
    t.editor.view.dispatch(t.editor.state.tr);
    t.updates.length = 0;
    const before = JSON.stringify(t.editor.getJSON());
    const tr = chipsMeta(t.editor.state, { chips: [chip('a', P)] });
    expect(tr.docChanged).toBe(false);
    expect(isUserEdit(tr)).toBe(false);
    t.editor.view.dispatch(tr);
    expect(JSON.parse(JSON.stringify(t.editor.getJSON()))).toEqual(JSON.parse(before));
    expect(t.editor.getText()).not.toContain('Fri 9 Oct');
    expect(t.updates.filter(isUserEdit)).toEqual([]);
  });

  it('positions: after a paragraph’s text, after a list item’s first paragraph, right after an image; unknown blocks dropped', () => {
    const t = makeEditor({ content: doc });
    t.editor.view.dispatch(chipsMeta(t.editor.state, { chips: [chip('a', P), chip('b', L), chip('c', IMG), chip('d', '9b4e28ba-2fa1-41d2-883f-0016d3cca427')] }));
    const decos = reminderChipsKey.getState(t.editor.state)!.decorations.find();
    const at = (id: string) => decos.find((d) => (d.spec as { key: string }).key.startsWith(`${id}:`))?.from;
    const p = findBlock(t.editor.state.doc, P)!;
    const lp = findBlock(t.editor.state.doc, LP)!;
    const img = findBlock(t.editor.state.doc, IMG)!;
    expect(at('a')).toBe(p.pos + p.node.nodeSize - 1);
    expect(at('b')).toBe(lp.pos + lp.node.nodeSize - 1);
    expect(at('c')).toBe(img.pos + img.node.nodeSize);
    expect(at('d')).toBeUndefined();
    const dom = t.editor.view.dom.querySelector(`[data-id="${P}"] .reminder-chip`) as HTMLButtonElement;
    expect(dom).not.toBeNull();
    expect(dom.getAttribute('contenteditable')).toBe('false');
    expect(dom.getAttribute('aria-label')).toBe('Reminder: a');
    dom.click();
    expect(t.chipClicks).toEqual(['a']);
  });

  it('a document change maps the chips; typing at the end of the paragraph keeps the chip after the text', () => {
    const t = makeEditor({ content: doc });
    t.editor.view.dispatch(chipsMeta(t.editor.state, { chips: [chip('a', P)] }));
    const p = findBlock(t.editor.state.doc, P)!;
    t.editor.commands.insertContentAt(p.pos + p.node.nodeSize - 1, ' now');
    const moved = findBlock(t.editor.state.doc, P)!;
    expect(moved.node.textContent).toBe('Pay rent now');
    const [d] = reminderChipsKey.getState(t.editor.state)!.decorations.find();
    expect(d!.from).toBe(moved.pos + moved.node.nodeSize - 1);
  });

  /** The reminder ids of the chips drawn inside each block with an id, in document order. */
  function chipsByBlock(t: TestEditor): Array<[string, string[]]> {
    return [...t.editor.view.dom.querySelectorAll('[data-id]')].map((el) => [
      (el as HTMLElement).dataset.id!,
      [...el.querySelectorAll(':scope > .reminder-chip, :scope > p > .reminder-chip')].map((c) => (c as HTMLElement).dataset.reminderId!),
    ]);
  }

  it('Enter at the end of an anchored paragraph and typing keeps the chip on that paragraph (N-D2 a)', () => {
    const t = makeEditor({ content: doc });
    t.editor.view.dispatch(chipsMeta(t.editor.state, { chips: [chip('a', P), chip('b', L)] }));
    const p = findBlock(t.editor.state.doc, P)!;
    t.editor.commands.setTextSelection(p.pos + p.node.nodeSize - 1);
    t.editor.commands.splitBlock();
    t.editor.commands.insertContent('Open me three');
    const second = t.editor.state.doc.child(1);
    expect(second.textContent).toBe('Open me three');
    const byBlock = new Map(chipsByBlock(t));
    expect(byBlock.get(P)).toEqual(['a']);
    expect(byBlock.get(second.attrs.id as string)).toEqual([]);
    expect(byBlock.get(L)).toEqual(['b']);
    // Undo and redo keep it there too.
    t.editor.commands.undo();
    expect(new Map(chipsByBlock(t)).get(P)).toEqual(['a']);
    expect(t.editor.view.dom.querySelectorAll('.reminder-chip')).toHaveLength(2);
  });

  it('a file inserted right after an anchored paragraph leaves its chip in place (N-D2 b)', () => {
    const t = makeEditor({ content: doc });
    t.editor.view.dispatch(chipsMeta(t.editor.state, { chips: [chip('a', P)] }));
    const p = findBlock(t.editor.state.doc, P)!;
    const end = p.pos + p.node.nodeSize - 1;
    t.editor.commands.setTextSelection(end);
    const file = attachmentNode({ id: '6b4e28ba-2fa1-41d2-883f-0016d3cca427', kind: 'document', mime: 'application/pdf', sizeBytes: 10, originalName: 'a.pdf', width: null, height: null }, 'a.pdf');
    insertBlocks(t.editor, { from: end, to: end }, [file]);
    expect(t.editor.state.doc.toJSON().content.some((n: { type: string }) => n.type === 'fileAttachment')).toBe(true);
    expect(new Map(chipsByBlock(t)).get(P)).toEqual(['a']);
    expect(t.editor.view.dom.querySelectorAll('.reminder-chip')).toHaveLength(1);
  });

  it('edits elsewhere and deleting the anchored block: chips stay on their blocks or go with the block', () => {
    const t = makeEditor({ content: doc });
    t.editor.view.dispatch(chipsMeta(t.editor.state, { chips: [chip('a', P), chip('b', LP)] }));
    const lp = findBlock(t.editor.state.doc, LP)!;
    t.editor.commands.insertContentAt(lp.pos + 1, 'First ');
    expect(new Map(chipsByBlock(t)).get(P)).toEqual(['a']);
    const p = findBlock(t.editor.state.doc, P)!;
    t.editor.commands.deleteRange({ from: p.pos, to: p.pos + p.node.nodeSize });
    expect(findBlock(t.editor.state.doc, P)).toBeNull();
    expect(t.editor.view.dom.querySelectorAll('.reminder-chip')).toHaveLength(1);
    expect(t.editor.view.dom.querySelector(`[data-id="${LP}"] .reminder-chip`)).not.toBeNull();
  });

  it('a reminder whose source text changed says so in its chip (D-092)', () => {
    const t = makeEditor({ content: doc });
    t.editor.view.dispatch(chipsMeta(t.editor.state, { chips: [chip('a', P, true), chip('b', LP)] }));
    const changed = t.editor.view.dom.querySelector(`[data-id="${P}"] .reminder-chip`)!;
    expect(changed.getAttribute('aria-label')).toBe('Reminder: a, its text changed');
    expect(changed.classList.contains('reminder-chip-changed')).toBe(true);
    const unchanged = t.editor.view.dom.querySelector(`[data-id="${LP}"] .reminder-chip`)!;
    expect(unchanged.getAttribute('aria-label')).toBe('Reminder: b');
    expect(unchanged.classList.contains('reminder-chip-changed')).toBe(false);
    // The source comes back: the chip is redrawn without the suffix.
    t.editor.view.dispatch(chipsMeta(t.editor.state, { chips: [chip('a', P)] }));
    expect(t.editor.view.dom.querySelector(`[data-id="${P}"] .reminder-chip`)!.getAttribute('aria-label')).toBe('Reminder: a');
  });

  it('the block at the cursor is the innermost block with an id', () => {
    const t = makeEditor({ content: doc });
    const lp = findBlock(t.editor.state.doc, LP)!;
    t.editor.commands.setTextSelection(lp.pos + 2);
    expect(blockIdAtSelection(t.editor.state.selection)).toBe(LP);
    t.editor.commands.setNodeSelection(findBlock(t.editor.state.doc, IMG)!.pos);
    expect(blockIdAtSelection(t.editor.state.selection)).toBe(IMG);
  });
});
