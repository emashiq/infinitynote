// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { createFakeBridge } from './support/fake-bridge';
import { setupDom } from './support/dom';

const dom = setupDom();

async function seeded() {
  const fake = createFakeBridge();
  const project = await fake.bridge.project.create({ name: 'Alpha' });
  if (!project.ok) throw new Error('project');
  const pid = project.data.project.id;
  const folder = await fake.bridge.folder.create({ location: { projectId: pid, parentId: null }, name: 'Specs' });
  if (!folder.ok) throw new Error('folder');
  const note = await fake.bridge.note.create({ location: { projectId: pid, folderId: folder.data.folder.id }, sticky: false, title: 'Plan' });
  const common = await fake.bridge.note.create({ location: { projectId: null, folderId: null }, sticky: false, title: 'Reading' });
  if (!note.ok || !common.ok) throw new Error('note');
  return { fake, pid, fid: folder.data.folder.id, nid: note.data.note.id, cid: common.data.note.id };
}

const item = (el: ParentNode, key: string) => el.querySelector<HTMLElement>(`[id="tree-${key}"]`);

describe('tree pane (INF-HIER-12, INF-HIER-01)', () => {
  it('renders APG attributes: levels, set sizes, expanded, selected and a single roving tab stop', async () => {
    const s = await seeded();
    const { el } = await dom.mount(s.fake);
    const tree = el.querySelector('[role="tree"]')!;
    expect(tree.getAttribute('aria-label')).toBe('Notes tree');
    const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    expect(items[0]!.id).toBe('tree-common');
    expect(items[0]!.getAttribute('aria-level')).toBe('1');
    expect(items[0]!.getAttribute('aria-expanded')).toBe('true');
    const reading = item(el, `note:${s.cid}`)!;
    expect(reading.getAttribute('aria-level')).toBe('2');
    expect(reading.getAttribute('aria-setsize')).toBe('1');
    expect(reading.getAttribute('aria-posinset')).toBe('1');
    expect(reading.hasAttribute('aria-expanded')).toBe(false);
    const alpha = item(el, `project:${s.pid}`)!;
    expect(alpha.getAttribute('aria-expanded')).toBe('false');
    expect(items.filter((i) => i.tabIndex === 0)).toHaveLength(1);
    expect(items.every((i) => i.hasAttribute('aria-selected'))).toBe(true);
    expect(item(el, `folder:${s.fid}`)).toBeNull();
  });

  it('Right expands, Left collapses and moves to the parent, Home and End jump to the ends', async () => {
    const s = await seeded();
    const { el } = await dom.mount(s.fake);
    const alpha = item(el, `project:${s.pid}`)!;
    await act(async () => alpha.focus());
    await dom.key(alpha, 'ArrowRight');
    expect(item(el, `project:${s.pid}`)!.getAttribute('aria-expanded')).toBe('true');
    const folder = item(el, `folder:${s.fid}`)!;
    expect(folder.getAttribute('aria-level')).toBe('3');
    await dom.key(item(el, `project:${s.pid}`)!, 'ArrowRight');
    expect(document.activeElement).toBe(folder);
    expect(folder.getAttribute('aria-selected')).toBe('true');
    await dom.key(folder, 'ArrowLeft');
    expect(document.activeElement).toBe(item(el, `project:${s.pid}`));
    await dom.key(document.activeElement!, 'End');
    expect((document.activeElement as HTMLElement).id).toBe('tree-trash');
    await dom.key(document.activeElement!, 'Home');
    expect((document.activeElement as HTMLElement).id).toBe('tree-common');
  });

  it('F2 renames with the keyboard and keeps the row focused', async () => {
    const s = await seeded();
    const { el } = await dom.mount(s.fake);
    const alpha = item(el, `project:${s.pid}`)!;
    await act(async () => alpha.focus());
    await dom.key(alpha, 'F2');
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Rename"]')!;
    expect(input.value).toBe('Alpha');
    await dom.type(input, 'Alpha 2');
    await dom.key(input, 'Enter');
    await dom.settle(6);
    expect(item(el, `project:${s.pid}`)!.textContent).toContain('Alpha 2');
    expect(s.fake.callsTo('project:rename')).toHaveLength(1);
    expect(document.activeElement).toBe(item(el, `project:${s.pid}`));
  });

  it('F2 on Common shows the notice and no input; Delete shows its notice and no dialog', async () => {
    const s = await seeded();
    const { el } = await dom.mount(s.fake);
    const common = item(el, 'common')!;
    await act(async () => common.focus());
    await dom.key(common, 'F2');
    expect(el.querySelector('input[aria-label="Rename"]')).toBeNull();
    expect(el.querySelector('.toast')?.textContent).toContain('Common cannot be renamed');
    await dom.key(common, 'Delete');
    expect(el.textContent).toContain('Common cannot be moved to Trash');
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('Delete then Enter trashes a note and hands the focus to the parent row (no focus loss to body)', async () => {
    const s = await seeded();
    const { el } = await dom.mount(s.fake);
    const row = item(el, `note:${s.cid}`)!;
    await act(async () => row.focus());
    await dom.key(row, 'Delete');
    const dialog = document.querySelector<HTMLElement>('dialog[open]')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Move to Trash?');
    const confirm = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Move to Trash')!;
    expect(document.activeElement).toBe(confirm);
    await dom.click(confirm);
    await dom.settle(8);
    expect(item(el, `note:${s.cid}`)).toBeNull();
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest('[role="tree"]')).not.toBeNull();
    expect((document.activeElement as HTMLElement).id).toBe('tree-common');
  });

  it('Delete then Escape cancels and returns the focus to the row', async () => {
    const s = await seeded();
    const { el } = await dom.mount(s.fake);
    const row = item(el, `note:${s.cid}`)!;
    await act(async () => row.focus());
    await dom.key(row, 'Delete');
    const dialog = document.querySelector<HTMLElement>('dialog[open]')!;
    await act(async () => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    await dom.settle();
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(item(el, `note:${s.cid}`)).not.toBeNull();
    expect(document.activeElement).toBe(item(el, `note:${s.cid}`));
    expect(s.fake.callsTo('note:trash')).toHaveLength(0);
  });

  it('Shift+F10 opens the context menu with the Common item list and Escape restores the focus', async () => {
    const s = await seeded();
    const { el } = await dom.mount(s.fake);
    const common = item(el, 'common')!;
    await act(async () => common.focus());
    await dom.key(common, 'F10', { shiftKey: true });
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent)).toEqual(['New note', 'New sticky', 'New folder']);
    await dom.key(menu, 'Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(item(el, 'common'));
  });

  it('the splitter handles Home and End as well as the arrows (INF-SHELL-02)', async () => {
    const { el } = await dom.mount();
    const sep = el.querySelector<HTMLElement>('[role="separator"]')!;
    expect(sep.getAttribute('aria-valuemin')).toBe('220');
    expect(sep.getAttribute('aria-valuemax')).toBe('280');
    expect(sep.getAttribute('aria-valuenow')).toBe('248');
    await dom.key(sep, 'End');
    expect(sep.getAttribute('aria-valuenow')).toBe('280');
    await dom.key(sep, 'Home');
    expect(sep.getAttribute('aria-valuenow')).toBe('220');
    await dom.key(sep, 'ArrowRight');
    expect(sep.getAttribute('aria-valuenow')).toBe('228');
  });
});
