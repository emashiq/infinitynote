// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isUserEdit } from '../../../../src/renderer/editor/content';
import { blockIdAtSelection, chipsMeta, findBlock, reminderChipsKey, type ChipInfo } from '../../../../src/renderer/editor/reminder-chips';
import { makeEditor } from './support';

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
